import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chooseListing, compareItems, confirmCheckout, createPlan, getPlan, serverHealth, setPurchased, startCheckout,
} from "./api.js";
import { useAssistant } from "./assistant.js";
import PlannerUI from "./ui/PlannerUI.jsx";
import { money } from "./ui/format.js";
import { bestListingId, isPriced, toValued } from "./ui/listing.js";
import { TONES } from "./ui/shopState.js";

const BOARD_KEY = "esper:board";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [plans, setPlans] = useState([]);
  const [marks, setMarks] = useState({});
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusId, setFocusId] = useState(null);
  const [trustFloor, setTrustFloor] = useState(0.5);
  const [compare, setCompare] = useState(null);
  const [cartStage, setCartStage] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [paying, setPaying] = useState(false);
  const [paymentMode, setPaymentMode] = useState("mock");
  const [restored, setRestored] = useState(false);
  const plansRef = useRef(plans);
  const marksRef = useRef(marks);
  plansRef.current = plans;
  marksRef.current = marks;

  // Applied to the ref right away, so a CART event followed by CHECKOUT in one AI turn sees the item.
  const updateMarks = useCallback((change) => {
    const next = change(marksRef.current);
    marksRef.current = next;
    setMarks(next);
  }, []);

  const upsertPlan = useCallback((plan) => {
    const stamped = stamp(plan);
    const exists = plansRef.current.some((row) => row.id === stamped.id);
    plansRef.current = exists
      ? plansRef.current.map((row) => (row.id === stamped.id ? stamped : row))
      : [...plansRef.current, stamped];
    setPlans(plansRef.current);
    return stamped;
  }, []);

  // --- cart -----------------------------------------------------------------

  const cartLines = useMemo(() => linesInCart(plans, marks), [plans, marks]);
  const cartTotal = Math.round(cartLines.reduce((sum, { item }) => sum + item.synthesis.totalPrice, 0) * 100) / 100;
  const cartCurrency = cartLines[0]?.item.synthesis.currency || "USD";

  const markCart = useCallback((itemId) => {
    updateMarks((current) => ({ ...current, [itemId]: TONES.cart }));
  }, [updateMarks]);

  // --- assistant ------------------------------------------------------------

  const getContext = () => {
    const focused = focusId ? findItem(plansRef.current, focusId) : null;
    const planId = focused?.plan.id ?? compare?.planId ?? plansRef.current.at(-1)?.id ?? null;
    const result = compare?.result;
    return {
      plan_id: planId,
      trust_floor: trustFloor,
      focus_item_id: focusId,
      compare: result ? {
        item_id: compare.item.id,
        left_id: result.left?.id ?? null,
        right_id: result.right?.id ?? null,
        winner_id: result.pick ? result[result.pick]?.id ?? null : null,
      } : null,
    };
  };

  async function applyUi(event) {
    const found = event.item_id ? findItem(plansRef.current, event.item_id) : null;
    switch (event.action) {
      case "PLAN": {
        const full = event.payload?.id ? await getPlan(event.payload.id).catch(() => null) : null;
        if (full) upsertPlan(full);
        break;
      }
      case "COMPARE":
        if (found) {
          setFocusId(found.item.id);
          setCompare({ item: found.item, planId: found.plan.id, result: event.payload, loading: false });
        }
        break;
      case "TRUST_FLOOR":
        if (typeof event.payload?.trust_floor === "number") setTrustFloor(event.payload.trust_floor);
        break;
      case "SHORTLIST":
      case "FOCUS":
        if (found) {
          setCompare(null);
          setFocusId(found.item.id);
        }
        break;
      case "CART":
        if (event.item_id) markCart(event.item_id);
        break;
      case "CHECKOUT":
        await beginCheckout();
        break;
      default:
        break;
    }
  }

  const assistant = useAssistant({ getContext, onUi: applyUi });

  useEffect(() => {
    assistant.syncContext(getContext());
    // getContext reads the values listed here.
  }, [plans.length, focusId, trustFloor, compare?.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- restore the board (refresh, or back from Stripe) -----------------------

  useEffect(() => {
    let cancelled = false;
    serverHealth().then((health) => {
      if (!cancelled && health?.stripe) setPaymentMode(health.stripe);
    });
    (async () => {
      const saved = readBoard();
      if (saved) {
        const loaded = await Promise.all(saved.planIds.map((id) => getPlan(id).catch(() => null)));
        if (cancelled) return;
        for (const plan of loaded) if (plan) upsertPlan(plan);
        updateMarks(() => saved.marks || {});
        if (typeof saved.trustFloor === "number") setTrustFloor(saved.trustFloor);
      }
      await finishStripeReturn();
      if (!cancelled) setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (restored) writeBoard({ planIds: plans.map((plan) => plan.id), marks, trustFloor });
  }, [restored, plans, marks, trustFloor]);

  async function finishStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (!outcome) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (outcome !== "success") {
      setNotice("Checkout cancelled. Nothing was charged, and your cart is as you left it.");
      return;
    }
    try {
      const sessionId = params.get("session_id") || "";
      const result = await confirmCheckout(sessionId);
      for (const plan of result.plans || []) upsertPlan(plan);
      if (result.status === "paid") {
        const paid = (result.plans || []).flatMap((plan) => plan.items)
          .filter((item) => item.order?.checkoutSessionId === sessionId)
          .map((item) => item.id);
        updateMarks((current) => ({ ...current, ...Object.fromEntries(paid.map((id) => [id, TONES.purchased])) }));
        setNotice(`Payment received for ${paid.length} item${paid.length === 1 ? "" : "s"}. They're green on your board.`);
        assistant.note("assistant", `Payment received. ${paid.length} item${paid.length === 1 ? " is" : "s are"} now bought.`);
      } else {
        setNotice("Stripe hasn't confirmed this payment yet. Nothing is marked bought.");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // --- planning ---------------------------------------------------------------

  async function onPlan(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setStatus("loading");
    setError("");
    try {
      const plan = upsertPlan(await createPlan(text));
      setPrompt("");
      setStatus("idle");
      assistant.note("user", text);
      const priced = plan.items.filter(isPriced).length;
      assistant.note("assistant", `${plan.title}: ${plan.items.length} things to get, ${priced} with store offers. `
        + "Open one, or ask me to compare its listings.");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }

  function onMark(itemId, tone) {
    updateMarks((current) => ({ ...current, [itemId]: tone }));
    if (tone === TONES.purchased) {
      const found = findItem(plansRef.current, itemId);
      if (found && !found.item.purchased) patchPurchased(found.plan, found.item, true).catch((err) => setError(err.message));
    }
  }

  async function onToggle(item) {
    const found = findItem(plansRef.current, item.id);
    if (!found) return;
    setError("");
    try {
      await patchPurchased(found.plan, item, !item.purchased);
      updateMarks((current) => ({ ...current, [item.id]: item.purchased ? TONES.needed : TONES.purchased }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function patchPurchased(plan, item, purchased) {
    upsertPlan(await setPurchased(plan.id, item.id, purchased));
  }

  // --- choosing a listing -----------------------------------------------------

  /** Make `product` the item's offer (server-side, so checkout charges it), then put it in the cart. */
  async function addListing(item, product, { toCart = true } = {}) {
    const found = findItem(plansRef.current, item.id);
    if (!found || found.item.purchased) return;
    setError("");
    try {
      let current = found.item;
      if (product && product.id !== bestListingId(current)) {
        const plan = upsertPlan(await chooseListing(found.plan.id, current.id, product.id));
        current = plan.items.find((row) => row.id === current.id) || current;
      }
      if (!toCart) {
        setNotice(`${current.name}: chose ${current.synthesis?.best?.title || "that listing"}.`);
        return;
      }
      if (!isPriced(current)) {
        setError(`${current.name}: that listing has no usable price, so it can't go in the cart.`);
        return;
      }
      markCart(current.id);
      setNotice(`${current.name} is in your cart (${money(current.synthesis.totalPrice, current.synthesis.currency || "USD")}).`);
      assistant.note("assistant", `Added ${current.name} from ${current.synthesis?.best?.store || "the chosen store"} to your cart.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function dropListing(itemId, productId) {
    const found = findItem(plansRef.current, itemId);
    const product = found?.item.products?.find((row) => row.id === productId);
    if (found && product) addListing(found.item, product);
  }

  // --- comparing ----------------------------------------------------------------

  const compareRun = useRef(0);

  async function runCompare(item, planId, leftId, rightId, floor) {
    const left = item.products?.find((row) => row.id === leftId);
    const right = item.products?.find((row) => row.id === rightId);
    if (!left || !right) return;
    const run = ++compareRun.current;
    setCompare((current) => ({ item, planId, result: current?.item.id === item.id ? current.result : null, loading: true }));
    try {
      const result = await compareItems(toValued(left), toValued(right), floor);
      if (run !== compareRun.current) return;
      setCompare({ item, planId, result, loading: false });
      return result;
    } catch (err) {
      if (run === compareRun.current) setCompare({ item, planId, result: null, loading: false, error: err.message });
    }
    return null;
  }

  async function onCompare(item, leftId, rightId) {
    const found = findItem(plansRef.current, item.id);
    if (!found) return;
    const result = await runCompare(found.item, found.plan.id, leftId, rightId, trustFloor);
    if (result) {
      const winner = result.pick ? result[result.pick] : null;
      assistant.note("assistant", winner
        ? `${found.item.name}: ${winner.title || winner.store} from ${winner.store} wins on value.`
        : `${found.item.name}: those two are too close to call.`);
    }
  }

  // Moving the trust floor rescores the open comparison without refetching listings.
  useEffect(() => {
    if (!compare?.result || compare.loading) return undefined;
    if (compare.result.trust_floor === trustFloor) return undefined;
    const timer = setTimeout(() => {
      runCompare(compare.item, compare.planId, compare.result.left?.id, compare.result.right?.id, trustFloor);
    }, 150);
    return () => clearTimeout(timer);
  }, [trustFloor]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chooseFromCompare(productId, toCart) {
    if (!compare) return;
    const found = findItem(plansRef.current, compare.item.id);
    const product = found?.item.products?.find((row) => row.id === productId);
    setCompare(null);
    if (found && product) await addListing(found.item, product, { toCart });
  }

  // --- checkout -------------------------------------------------------------------

  async function beginCheckout() {
    const lines = linesInCart(plansRef.current, marksRef.current);
    setCompare(null);
    if (!lines.length) {
      setCartStage("cart");
      return;
    }
    const groups = [];
    for (const { item, plan } of lines) {
      const group = groups.find((row) => row.planId === plan.id);
      if (group) group.itemIds.push(item.id);
      else groups.push({ planId: plan.id, itemIds: [item.id] });
    }
    setPaying(true);
    setError("");
    try {
      const session = await startCheckout(groups);
      if (session.mock) {
        setCheckout({ ...session, lines });
        setCartStage("review");
      } else {
        writeBoard({ planIds: plansRef.current.map((plan) => plan.id), marks: marksRef.current, trustFloor });
        window.location.assign(session.url);
      }
    } catch (err) {
      setCartStage("cart");
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  async function placeOrder() {
    if (!checkout) return;
    setPaying(true);
    try {
      const result = await confirmCheckout(checkout.id);
      for (const plan of result.plans || []) upsertPlan(plan);
      const ids = checkout.lines.map(({ item }) => item.id);
      updateMarks((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, TONES.purchased])) }));
      setReceipt(result.receipt);
      setCartStage("receipt");
      assistant.note("assistant", `Mock order ${result.receipt.orderId} placed for ${money(result.receipt.amount / 100, "USD")}. `
        + "No card was charged; those items are now green.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  function closeCart() {
    setCartStage(null);
    if (cartStage === "receipt") {
      setCheckout(null);
      setReceipt(null);
    }
  }

  const sheetLines = cartStage === "cart" || !checkout ? cartLines : checkout.lines;
  const cart = {
    lines: cartLines,
    total: cartTotal,
    currency: cartCurrency,
    open: () => setCartStage("cart"),
    sheet: cartStage ? {
      stage: cartStage,
      lines: sheetLines,
      total: cartTotal,
      currency: cartCurrency,
      checkout,
      receipt,
      busy: paying,
      mode: paymentMode,
      onRemove: (itemId) => updateMarks((current) => ({ ...current, [itemId]: TONES.needed })),
      onCheckout: beginCheckout,
      onPlace: placeOrder,
      onBack: () => setCartStage("cart"),
      onClose: closeCart,
    } : null,
  };

  return (
    <PlannerUI
      prompt={prompt}
      plans={plans}
      marks={marks}
      status={status}
      error={error}
      notice={notice}
      focusId={focusId}
      trustFloor={trustFloor}
      compare={compare}
      cart={cart}
      assistant={assistant}
      suggestions={suggestionsFor({ plans, focusId, compare, cartLines })}
      onPromptChange={setPrompt}
      onPlan={onPlan}
      onToggle={onToggle}
      onMark={onMark}
      onInspect={setFocusId}
      onAddListing={(item, product) => addListing(item, product)}
      onDropListing={dropListing}
      onCompare={onCompare}
      onTrustFloor={setTrustFloor}
      onChooseFromCompare={chooseFromCompare}
      onCloseCompare={() => setCompare(null)}
      onDismissNotice={() => setNotice("")}
    />
  );
}

function stamp(plan) {
  return {
    ...plan,
    items: (plan.items || []).map((item) => ({ ...item, planId: plan.id })),
  };
}

function findItem(plans, itemId) {
  for (const plan of plans) {
    const item = plan.items.find((row) => row.id === itemId);
    if (item) return { plan, item };
  }
  return null;
}

function linesInCart(plans, marks) {
  return plans.flatMap((plan) => plan.items
    .filter((item) => marks[item.id] === TONES.cart && !item.purchased && isPriced(item))
    .map((item) => ({ item, plan })));
}

function suggestionsFor({ plans, focusId, compare, cartLines }) {
  if (!plans.length) return ["I'm going camping this weekend", "Weekly groceries for two", "Set me up with a new laptop"];
  const out = [];
  if (compare?.result) out.push("Use the winner and add it to my cart");
  const focused = focusId ? findItem(plans, focusId)?.item : null;
  if (focused && !compare && (focused.products?.length ?? 0) > 1) out.push(`Compare the best two for ${focused.name.toLowerCase()}`);
  if (!focused) {
    const next = plans.flatMap((plan) => plan.items).find((item) => !item.purchased && (item.products?.length ?? 0) > 1);
    if (next) out.push(`Show me the ${next.name.toLowerCase()}`);
  }
  if (cartLines.length) out.push("Check out");
  out.push("What's left to buy?");
  return out.slice(0, 3);
}

function readBoard() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(BOARD_KEY) || "null");
    return saved && Array.isArray(saved.planIds) ? saved : null;
  } catch {
    return null;
  }
}

function writeBoard(board) {
  try {
    window.sessionStorage.setItem(BOARD_KEY, JSON.stringify(board));
  } catch {
    /* private mode: the board just won't survive a reload */
  }
}
