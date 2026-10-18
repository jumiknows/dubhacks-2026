import { useEffect, useRef } from "react";

export default function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function key(event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(ref.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]') || [])];
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  return <div className="esper-modal-back" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} tabIndex={-1} className={`esper-modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="esper-section-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button></header>
      {children}
    </section>
  </div>;
}
