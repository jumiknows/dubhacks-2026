import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Shows two boxes at a time. A swipe or wheel notch moves exactly one box.
 * Selecting a box hides the others and opens its details beside it.
 * Back, a right swipe, or tapping the box again puts it back in the row.
 */
export default function SnapStage({
  items,
  getId,
  selectedId,
  onSelect,
  onBack,
  renderCard,
  renderDetail,
}) {
  const reelRef = useRef(null);
  const fromTop = useRef(null);
  const lastId = useRef(selectedId);
  const busy = useRef(false);
  const swallowed = useRef(false);
  const [shownId, setShownId] = useState(selectedId);
  const [leaving, setLeaving] = useState(false);
  const focused = Boolean(selectedId);
  const shown = items.find((item) => getId(item) === shownId) || null;

  useEffect(() => {
    if (selectedId) lastId.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      setShownId(selectedId);
      setLeaving(false);
      return undefined;
    }
    if (!shownId) return undefined;
    setLeaving(true);
    const timer = setTimeout(() => {
      setShownId(null);
      setLeaving(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [selectedId, shownId]);

  useLayoutEffect(() => {
    const reel = reelRef.current;
    const from = fromTop.current;
    fromTop.current = null;
    if (!reel || from == null) return undefined;
    const id = selectedId || lastId.current;
    const slot = id ? reel.querySelector(`[data-id="${CSS.escape(String(id))}"]`) : null;
    if (!slot) return undefined;

    reel.scrollTop = selectedId ? 0 : slot.offsetTop;

    const dy = from - slot.getBoundingClientRect().top;
    if (Math.abs(dy) < 2) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    slot.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return undefined;
  }, [selectedId]);

  useEffect(() => {
    const reel = reelRef.current;
    if (!reel) return undefined;
    function onWheel(event) {
      if (selectedId) return;
      event.preventDefault();
      if (busy.current) return;
      const direction = event.deltaY > 0 ? 1 : -1;
      busy.current = true;
      reel.scrollBy({ top: direction * (reel.clientHeight / 2), behavior: "smooth" });
      window.setTimeout(() => {
        busy.current = false;
      }, 520);
    }
    reel.addEventListener("wheel", onWheel, { passive: false });
    return () => reel.removeEventListener("wheel", onWheel);
  }, [selectedId]);

  function choose(id, event) {
    const slot = event.currentTarget.closest(".snap-slot");
    if (slot) fromTop.current = slot.getBoundingClientRect().top;
    onSelect(selectedId === id ? null : id);
  }

  function step(direction) {
    const reel = reelRef.current;
    if (!reel || selectedId || busy.current) return;
    busy.current = true;
    reel.scrollBy({ top: direction * (reel.clientHeight / 2), behavior: "smooth" });
    window.setTimeout(() => {
      busy.current = false;
    }, 520);
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    event.currentTarget.dataset.x = String(event.clientX);
    event.currentTarget.dataset.y = String(event.clientY);
  }

  function onPointerUp(event) {
    const stage = event.currentTarget;
    const x = Number(stage.dataset.x);
    const y = Number(stage.dataset.y);
    delete stage.dataset.x;
    if (Number.isNaN(x)) return;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (Math.abs(dx) < 48 && Math.abs(dy) < 48) return;
    if (dx > 64 && Math.abs(dx) > Math.abs(dy)) {
      swallowed.current = true;
      if (selectedId) {
        const slot = stage.querySelector(".snap-slot.is-open");
        if (slot) fromTop.current = slot.getBoundingClientRect().top;
        onSelect(null);
      } else {
        onBack?.();
      }
      return;
    }
    if (!selectedId && Math.abs(dy) > 56 && Math.abs(dy) > Math.abs(dx)) {
      swallowed.current = true;
      step(dy < 0 ? 1 : -1);
    }
  }

  function onClickCapture(event) {
    if (!swallowed.current) return;
    swallowed.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className={focused ? "snap-stage is-focused" : "snap-stage"}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
      onPointerCancel={(event) => delete event.currentTarget.dataset.x}
    >
      <div
        ref={reelRef}
        className={selectedId ? "snap-reel is-focused" : "snap-reel"}
        aria-label="Boxes"
      >
        {items.map((item) => {
          const id = getId(item);
          const selected = id === selectedId;
          return (
            <div
              key={id}
              data-id={id}
              className={selected ? "snap-slot is-open" : "snap-slot"}
            >
              {renderCard(item, { selected, onChoose: (event) => choose(id, event) })}
            </div>
          );
        })}
      </div>
      {shown ? (
        <div className={leaving ? "snap-detail is-leaving" : "snap-detail"} key={shownId}>
          {renderDetail(shown)}
        </div>
      ) : null}
    </div>
  );
}
