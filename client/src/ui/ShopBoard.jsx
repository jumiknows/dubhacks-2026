import { scrollElement, useGestureEvents } from "conjure-gestures";
import { useEffect, useRef, useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";
import { groupTone, itemTone, toneLabel } from "./shopState.js";
import { takeSwipe } from "./swipeGate.js";

const HOLD_MS = 2000;
const SPLIT_GAP = 0.14;
const JOIN_GAP = 0.16;

export default function ShopBoard({
  plans,
  marks,
  focusId,
  onMark,
  onToggle,
  onInspect,
  onAddListing,
  renderInspector,
}) {
  const listRef = useRef(null);
  const stripRef = useRef(null);
  const fists = useRef({ left: null, right: null });
  const originGap = useRef(null);
  const wasApart = useRef(false);
  const holdTimer = useRef(null);
  const holdStarted = useRef(0);
  const [splitId, setSplitId] = useState(null);
  const [inspect, setInspect] = useState(null);
  const [holding, setHolding] = useState(null);
  const [holdProgress, setHoldProgress] = useState(0);

  const splitPlan = plans.find((plan) => plan.id === splitId) || null;
  const inspectItem = inspect
    ? plans.flatMap((plan) => plan.items).find((item) => item.id === inspect)
    : null;

  useEffect(() => {
    setInspect(focusId || null);
  }, [focusId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !plans.length) return;
    const last = list.querySelector(`[data-group-id="${CSS.escape(plans.at(-1).id)}"]`);
    last?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [plans.length]);

  useEffect(() => () => clearHold(), []);

  function clearHold() {
    clearInterval(holdTimer.current);
    holdTimer.current = null;
    holdStarted.current = 0;
    setHolding(null);
    setHoldProgress(0);
  }

  function closeInspect() {
    clearHold();
    setInspect(null);
    onInspect?.(null);
  }

  function splitGroup(id) {
    if (!id) return;
    closeInspect();
    setSplitId(id);
  }

  function recombine(move = 0) {
    closeInspect();
    setSplitId(null);
    originGap.current = null;
    wasApart.current = false;
    if (!move) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ top: move * 72, behavior: "smooth" });
  }

  function live(node) {
    if (!node || node.closest("[inert], [aria-hidden='true']")) return null;
    return node;
  }

  function startHold(product, item) {
    clearHold();
    holdStarted.current = performance.now();
    setHolding(product.id);
    setHoldProgress(0);
    holdTimer.current = setInterval(() => {
      const elapsed = performance.now() - holdStarted.current;
      setHoldProgress(Math.min(1, elapsed / HOLD_MS));
      if (elapsed >= HOLD_MS) {
        clearHold();
        if (onAddListing) onAddListing(item, product).catch(() => undefined);
        else onMark?.(item.id, "cart");
      }
    }, 50);
  }

  function parseTarget(id) {
    if (!id) return null;
    if (id.startsWith("group:")) return { kind: "group", id: id.slice(6) };
    if (id.startsWith("item:")) return { kind: "item", id: id.slice(5) };
    if (id.startsWith("product:")) {
      const rest = id.slice(8);
      const cut = rest.indexOf(":");
      return { kind: "product", itemId: rest.slice(0, cut), productId: rest.slice(cut + 1) };
    }
    return null;
  }

  function groupFromTarget(target) {
    if (!target) return null;
    if (target.kind === "group") return target.id;
    if (target.kind === "item") {
      return plans.find((plan) => plan.items.some((item) => item.id === target.id))?.id ?? splitId;
    }
    return splitId;
  }

  function openItem(itemId) {
    setInspect(itemId);
    onInspect?.(itemId);
  }

  function rememberFist(event) {
    if (!event.hand_id) return;
    const target = parseTarget(event.target_id);
    fists.current[event.hand_id] = {
      x: event.x,
      y: event.y,
      groupId: groupFromTarget(target),
    };
    const left = fists.current.left;
    const right = fists.current.right;
    if (left && right) originGap.current ??= Math.abs(left.x - right.x);
  }

  function readFists() {
    const left = fists.current.left;
    const right = fists.current.right;
    if (!left || !right) return;
    const gap = Math.abs(left.x - right.x);
    const groupId = left.groupId && left.groupId === right.groupId ? left.groupId : splitId;
    const start = originGap.current ?? gap;
    if (gap - start >= SPLIT_GAP) wasApart.current = true;
    if (groupId && gap - start >= SPLIT_GAP) {
      splitGroup(groupId);
      return;
    }
    if (splitId && wasApart.current && gap <= JOIN_GAP) recombine(0);
  }

  useGestureEvents("expand", (event) => {
    splitGroup(event.group_id);
  });

  useGestureEvents("collapse", (event) => {
    if (event.group_id && event.group_id === splitId) recombine(0);
  });

  useGestureEvents("grab", (event) => {
    rememberFist(event);
    const target = parseTarget(event.target_id);
    if (!target) return;
    if (target.kind === "item") openItem(target.id);
    if (target.kind === "product" && inspectItem) {
      const product = (inspectItem.products || []).find((row) => row.id === target.productId);
      if (product) startHold(product, inspectItem);
    }
  });

  useGestureEvents("release", (event) => {
    if (event.hand_id) fists.current[event.hand_id] = null;
    if (!fists.current.left || !fists.current.right) originGap.current = null;
    if (holding) clearHold();
  });

  useGestureEvents("pointer_down", (event) => {
    const target = parseTarget(event.target_id);
    if (target?.kind === "product" && inspectItem) {
      const product = (inspectItem.products || []).find((row) => row.id === target.productId);
      if (product) startHold(product, inspectItem);
    }
  });

  useGestureEvents("pointer_up", () => {
    if (holding) clearHold();
  });

  useGestureEvents("hover", (event) => {
    if (!event.hand_id || !fists.current[event.hand_id]) return;
    fists.current[event.hand_id] = { ...fists.current[event.hand_id], x: event.x, y: event.y };
    readFists();
  });

  useGestureEvents("scroll", (event) => {
    if (inspectItem) {
      if ((event.delta_y ?? 0) > 0 && takeSwipe()) closeInspect();
      return;
    }
    if (splitPlan) {
      const strip = live(stripRef.current);
      if (strip && scrollElement(event.target_id) === strip) {
        strip.scrollBy({ left: (event.delta_y ?? 0) * strip.clientWidth, behavior: "smooth" });
        return;
      }
      if (!takeSwipe()) return;
      recombine((event.delta_y ?? 0) > 0 ? 1 : -1);
    }
  });

  useGestureEvents("reveal", () => {
    const strip = live(stripRef.current);
    if (!splitPlan || inspectItem || !strip || !takeSwipe()) return;
    strip.scrollBy({ left: strip.clientWidth * 0.72, behavior: "smooth" });
  });

  useGestureEvents("dismiss", () => {
    if (inspectItem) {
      if (takeSwipe()) closeInspect();
      return;
    }
    const strip = live(stripRef.current);
    if (splitPlan && strip && takeSwipe()) {
      strip.scrollBy({ left: -strip.clientWidth * 0.72, behavior: "smooth" });
    }
  });

  if (!plans.length) return null;

  return (
    <section className="shop-board" aria-label="Things to get">
      <div ref={listRef} className="shop-list" data-gesture-scroll aria-label="Queries">
        {plans.map((plan) => {
          const open = plan.id === splitId;
          const tone = groupTone(plan.items, marks);
          return (
            <article
              key={plan.id}
              data-group-id={plan.id}
              data-gesture-object={`group:${plan.id}`}
              data-gesture-group={plan.id}
              data-gesture-kind={open ? "group" : "original"}
              data-product-id={`group:${plan.id}`}
              className={`shop-group is-${tone} ${open ? "is-split" : ""}`}
            >
              {open ? (
                <><button type="button" className="esper-collapse" onClick={() => recombine()}>Back to all lists</button><div ref={stripRef} className="shop-strip" data-gesture-scroll data-gesture-step aria-label="Pieces">
                  {plan.items.map((item) => (
                    <PieceCard
                      key={item.id}
                      planId={plan.id}
                      item={item}
                      tone={itemTone(item, marks)}
                      onOpen={() => openItem(item.id)}
                    />
                  ))}
                </div></>
              ) : (
                <button type="button" className="shop-group-head" onClick={() => splitGroup(plan.id)} aria-label={`Open ${plan.title}`} aria-expanded={false}>
                  <span className="shop-kicker">{toneLabel(tone)} · {plan.items.length} items{plan.status === "pricing" ? " · Finding prices…" : ""}</span>
                  <h3>{plan.title}</h3>
                  <span className="shop-meta">{plan.prompt}</span>
                  <span className="shop-hint">Open list ↗</span>
                </button>
              )}
            </article>
          );
        })}
      </div>

      {inspectItem && renderInspector ? renderInspector({ item: inspectItem, tone: itemTone(inspectItem, marks), holding, holdProgress, onClose: closeInspect }) : inspectItem ? (
        <InspectStage
          item={inspectItem}
          tone={itemTone(inspectItem, marks)}
          holding={holding}
          holdProgress={holdProgress}
          onClose={closeInspect}
          onOwn={() => onMark(inspectItem.id, "owned")}
          onBought={() => onToggle(inspectItem)}
        />
      ) : null}
    </section>
  );
}

function PieceCard({ planId, item, tone, onOpen }) {
  const qty = quantityLabel(item);
  return (
    <button
      type="button"
      className={`shop-piece is-${tone}`}
      data-gesture-object={`item:${item.id}`}
      data-gesture-group={planId}
      data-gesture-kind="component"
      data-product-id={`item:${item.id}`}
      data-gesture-id={`item:${item.id}`}
      onClick={onOpen}
    >
      <p className="shop-kicker">{toneLabel(tone)}</p>
      <p className="shop-piece-name">{item.name}</p>
      <p className="shop-meta">{qty || item.reason}</p>
    </button>
  );
}

function InspectStage({ item, tone, holding, holdProgress, onClose, onOwn, onBought }) {
  const products = item.products || [];
  const offer = item.synthesis;
  return (
    <div className="shop-inspect" role="dialog" aria-label={item.name}>
      <article className={`shop-focus is-${tone}`}>
        <p className="shop-kicker">{toneLabel(tone)}</p>
        <h3>{item.name}</h3>
        <p>{item.reason}{quantityLabel(item) ? ` · ${quantityLabel(item)}` : ""}</p>
        <p className="shop-meta">{offer?.summary || "Hold a listing for two seconds to put it in the cart."}</p>
        <div className="shop-focus-actions">
          <button type="button" data-gesture-ignore onClick={onOwn}>Mark owned</button>
          <button type="button" data-gesture-ignore onClick={onBought}>{item.purchased ? "Purchased" : "Mark purchased"}</button>
          <button type="button" data-gesture-ignore onClick={onClose}>Close</button>
        </div>
      </article>
      <div className="shop-buy" data-gesture-scroll aria-label="Products to buy">
        {products.length ? products.map((product) => {
          const on = holding === product.id;
          return (
            <article
              key={product.id}
              className={on ? "shop-buy-card is-holding" : "shop-buy-card"}
              data-gesture-id={`product:${item.id}:${product.id}`}
              data-product-id={`product:${item.id}:${product.id}`}
            >
              <Thumb image={product.image} store={product.store} />
              <div>
                <p className="shop-piece-name">{product.title || product.store}</p>
                <p className="shop-meta">
                  {product.store} · {money(product.price, product.currency)}
                  {product.score != null ? ` · ${Math.round(product.score * 100)}` : ""}
                </p>
                {on ? <div className="hold-bar" style={{ "--hold": holdProgress }} /> : <p className="shop-hint">Grab and hold 2s</p>}
              </div>
            </article>
          );
        }) : (
          <p className="quiet">No store listings yet. Swipe up to close.</p>
        )}
        {offer?.shippingDate ? <p className="shop-meta">Ships {formatDate(offer.shippingDate)}</p> : null}
      </div>
    </div>
  );
}

function Thumb({ image, store }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) {
    return (
      <div className="thumb" aria-hidden="true">
        {store ? store.slice(0, 2).toUpperCase() : "—"}
      </div>
    );
  }
  return <img className="thumb" src={image} alt="" onError={() => setFailed(true)} />;
}
