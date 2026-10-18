import { scrollElement, useGestureEvents } from "conjure-gestures";
import { useEffect, useRef, useState } from "react";
import { formatDate, money, quantityLabel } from "./format.js";
import { groupTone, itemTone, toneLabel } from "./shopState.js";
import { takeSwipe } from "./swipeGate.js";

const HOLD_MS = 1000;
const GROUP_SELECT_MS = 1000;
const SPLIT_GAP = 0.14;
const JOIN_GAP = 0.16;

export default function ShopBoard({
  plans,
  marks,
  focusId,
  onMark,
  onToggle,
  onInspect,
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
  const [fistSelection, setFistSelection] = useState(null);
  const groupHoldTimer = useRef(null);
  const groupHoldStarted = useRef(0);

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

  useEffect(() => () => {
    clearHold();
    clearGroupSelection();
  }, []);

  function clearHold() {
    clearInterval(holdTimer.current);
    holdTimer.current = null;
    holdStarted.current = 0;
    setHolding(null);
    setHoldProgress(0);
  }

  function clearGroupSelection() {
    clearInterval(groupHoldTimer.current);
    groupHoldTimer.current = null;
    groupHoldStarted.current = 0;
    setFistSelection(null);
  }

  function startGroupSelection(id) {
    clearGroupSelection();
    groupHoldStarted.current = performance.now();
    setFistSelection({ id, progress: 0, complete: false });
    groupHoldTimer.current = setInterval(() => {
      const progress = Math.min(1, (performance.now() - groupHoldStarted.current) / GROUP_SELECT_MS);
      setFistSelection((current) => current?.id === id ? { ...current, progress } : current);
      if (progress >= 1) {
        clearInterval(groupHoldTimer.current);
        groupHoldTimer.current = null;
        setFistSelection({ id, progress: 1, complete: true });
        const plan = plans.find((entry) => entry.id === id);
        if (plan?.allowBreak !== false && plan?.items.length > 1) splitGroup(id);
        else if (plan?.items[0]) openItem(plan.items[0].id);
      }
    }, 40);
  }

  function closeInspect() {
    clearHold();
    setInspect(null);
    onInspect?.(null);
  }

  function splitGroup(id) {
    const plan = plans.find((entry) => entry.id === id);
    if (!plan || plan.allowBreak === false || plan.items.length < 2) return;
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
        onMark(item.id, "cart");
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

  function handleProductPointerDown(product, item) {
    startHold(product, item);
  }

  function handleProductPointerUp() {
    if (holding) clearHold();
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
    if (target.kind === "group") {
      startGroupSelection(target.id);
      return;
    }
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
    if (fistSelection) clearGroupSelection();
  });

  useGestureEvents("cancel", () => clearGroupSelection());

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
    if (fistSelection && event.target_id !== `group:${fistSelection.id}`) clearGroupSelection();
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
          const canBreak = plan.allowBreak !== false && plan.items.length > 1;
          const open = canBreak && plan.id === splitId;
          const tone = groupTone(plan.items, marks);
          const selectedByFist = fistSelection?.id === plan.id;
          return (
            <article
              key={plan.id}
              data-group-id={plan.id}
              data-gesture-object={`group:${plan.id}`}
              data-gesture-group={plan.id}
              data-gesture-kind={open ? "group" : "original"}
              data-product-id={`group:${plan.id}`}
              className={`shop-group is-${tone} ${open ? "is-split" : ""} ${plan.planType === "individual" ? "is-individual" : ""} ${selectedByFist ? "is-fist-selected" : ""}`}
              style={selectedByFist ? { "--fist-progress": fistSelection.progress } : undefined}
              onClick={(event) => {
                if (event.target.closest("button")) return;
                if (canBreak) splitGroup(plan.id);
                else openItem(plan.items[0]?.id);
              }}
            >
              {selectedByFist ? <span className="fist-selection-indicator" aria-live="polite">{fistSelection.complete ? "Selected" : "Close fist · hold"}<i /></span> : null}
              {open ? (
                <>
                  <header className="shop-group-head is-open">
                    <div className="shop-group-copy">
                      <p className="shop-kicker">{toneLabel(tone)} · {plan.items.length} components</p>
                      <h3>{plan.title}</h3>
                      <p className="shop-meta">Scroll sideways to browse each part</p>
                    </div>
                    <div className="shop-group-actions">
                      <button
                        type="button"
                        className="shop-group-action"
                        data-gesture-ignore
                        aria-label={`Recombine ${plan.title}`}
                        onClick={() => recombine(0)}
                      >
                        Recombine group
                      </button>
                    </div>
                  </header>
                  <div ref={stripRef} className="shop-strip" data-gesture-scroll data-gesture-step aria-label={`${plan.title} components`}>
                    {plan.items.map((item) => (
                      <PieceCard
                        key={item.id}
                        planId={plan.id}
                        item={item}
                        tone={itemTone(item, marks)}
                        onOpen={() => openItem(item.id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <header className="shop-group-head">
                  <div className="shop-group-copy">
                    <p className="shop-kicker">{toneLabel(tone)} · {canBreak ? `${plan.items.length} components` : "individual item"}</p>
                    <h3>{plan.title}</h3>
                    <div className="shop-preview" aria-label={canBreak ? "Click to show components" : "Individual item"}>
                      {plan.items.slice(0, 3).map((item) => <span key={item.id}><Thumb image={item.image || item.synthesis?.image} store={item.name} />{item.name}</span>)}
                      {plan.items.length > 3 ? <span>+{plan.items.length - 3} more</span> : null}
                    </div>
                  </div>
                  <div className="shop-group-actions">
                    {canBreak ? <span className="shop-group-action-hint">Click to view components</span> : (
                      <button type="button" className="shop-group-action" data-gesture-ignore aria-label={`Open ${plan.title}`} onClick={() => openItem(plan.items[0].id)}>Open item</button>
                    )}
                  </div>
                </header>
              )}
            </article>
          );
        })}
      </div>

      {inspectItem ? (
        <InspectStage
          item={inspectItem}
          tone={itemTone(inspectItem, marks)}
          holding={holding}
          holdProgress={holdProgress}
          onClose={closeInspect}
          onOwn={() => onMark(inspectItem.id, "owned")}
          onBought={() => onToggle(inspectItem)}
          onHoldStart={handleProductPointerDown}
          onHoldEnd={handleProductPointerUp}
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
      <Thumb image={item.image || item.synthesis?.image || item.products?.[0]?.image} store={item.name} />
      <p className="shop-kicker">{toneLabel(tone)}</p>
      <p className="shop-piece-name">{item.name}</p>
      <p className="shop-meta">{qty || item.reason}</p>
    </button>
  );
}

function InspectStage({ item, tone, holding, holdProgress, onClose, onOwn, onBought, onHoldStart, onHoldEnd }) {
  const products = item.products || [];
  const offer = item.synthesis;
  return (
    <div className="shop-inspect" role="dialog" aria-modal="true" aria-label={`${item.name} product options`}>
      <article className={`shop-focus is-${tone}`}>
        <div>
          <p className="shop-kicker">{toneLabel(tone)} · product options</p>
          <h3>{item.name}</h3>
          <p>{item.reason}{quantityLabel(item) ? ` · ${quantityLabel(item)}` : ""}</p>
          <p className="shop-meta">{offer?.summary || "Compare details, then press and hold a listing for 1 second with the mouse or a closed fist."}</p>
        </div>
        <div className="shop-focus-actions">
          <button type="button" data-gesture-ignore onClick={onOwn}>Mark owned</button>
          <button type="button" data-gesture-ignore onClick={onBought}>{item.purchased ? "Purchased" : "Mark purchased"}</button>
          <button type="button" data-gesture-ignore onClick={onClose}>Close</button>
        </div>
      </article>
      <div
        className="shop-buy"
        data-gesture-scroll
        aria-label="Product options. Scroll horizontally to compare."
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.preventDefault();
          event.currentTarget.scrollBy({ left: event.deltaY, behavior: "smooth" });
        }}
      >
        {products.length ? products.map((product) => {
          const on = holding === product.id;
          return (
            <ProductCard
              key={product.id}
              itemId={item.id}
              product={product}
              active={on}
              holdProgress={holdProgress}
              onStart={() => onHoldStart(product, item)}
              onEnd={onHoldEnd}
            />
          );
        }) : (
          <p className="quiet">No store listings yet. Close this screen to return to the shopping list.</p>
        )}
        {offer?.shippingDate ? <p className="shop-meta">Ships {formatDate(offer.shippingDate)}</p> : null}
      </div>
    </div>
  );
}

function ProductCard({ itemId, product, active, holdProgress, onStart, onEnd }) {
  const value = valueScore(product);
  const details = productDetails(product);
  function begin(event) {
    if (event.button != null && event.button !== 0) return;
    onStart();
  }

  return (
    <button
      type="button"
      className={active ? "shop-buy-card is-holding" : "shop-buy-card"}
      data-gesture-id={`product:${itemId}:${product.id}`}
      data-product-id={`product:${itemId}:${product.id}`}
      aria-pressed={active}
      onPointerDown={begin}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onPointerLeave={onEnd}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) onStart();
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") onEnd();
      }}
    >
      <Thumb image={product.image} store={product.store} />
      <span className="product-card-body">
        <span className="product-store">{product.store}{product.brand ? ` · ${product.brand}` : ""}</span>
        <span className="shop-piece-name">{product.title || product.store}</span>
        <span className="product-price-row">
          <strong>{money(product.price, product.currency)}</strong>
          <span className="value-score">Value score {value}</span>
        </span>
        <span className="product-facts">
          {details.map(([label, detail]) => <span key={label}><b>{label}</b>{detail}</span>)}
        </span>
        {active ? <span className="hold-bar" style={{ "--hold": holdProgress }} /> : <span className="shop-hint">Mouse press-and-hold or close fist-and-hold · 1 second</span>}
      </span>
    </button>
  );
}

function valueScore(product) {
  const score = product.score ?? ((product.bang_per_buck ?? 0.5) * (product.relevancy ?? 1) * (product.trust_multiplier ?? product.trust ?? 0.7));
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}/100`;
}

function productDetails(product) {
  const details = [];
  const dimensions = typeof product.dimensions === "string" ? product.dimensions : product.dimensions?.label;
  if (dimensions) details.push(["Dimensions", dimensions]);
  const reviews = product.reviewCount ?? product.review_count;
  if (product.rating != null) details.push(["Rating", `${Number(product.rating).toFixed(1)} / 5${reviews ? ` · ${Number(reviews).toLocaleString()} reviews` : ""}`]);
  const shipping = product.shippingDays ?? product.shipping_days;
  if (typeof shipping === "number") details.push(["Shipping", `${shipping} day${shipping === 1 ? "" : "s"}`]);
  if (product.condition) details.push(["Condition", product.condition]);
  if (product.seller) details.push(["Seller", product.seller]);
  if (product.inStock === false || product.in_stock === false) details.push(["Availability", "Out of stock"]);
  for (const [key, detail] of Object.entries(product.specs || {}).slice(0, 6)) {
    if (detail && !details.some(([label]) => label.toLowerCase() === key.toLowerCase())) details.push([key, String(detail)]);
  }
  return details.slice(0, 8);
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
