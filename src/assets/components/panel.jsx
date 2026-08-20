import { useEffect, useRef } from "react";
import { Ticks } from "./crt.jsx";

/**
 * Modal shell shared by the configuration and key panels: backdrop, focus
 * trap, Escape, and the bracketed terminal chrome.
 */
export default function Panel({ title, width = 380, onClose, children, footer }) {
  const panel = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panel.current?.querySelectorAll("button");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-void/70"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: `min(92vw, ${width}px)` }}
        className="relative max-h-full overflow-y-auto border border-line bg-panel"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-3 touch:py-1">
          <span className="text-2xs uppercase tracking-mark text-text glow">{title}</span>
          {/* The way out of a modal is the one control that must never be
              missed, so it takes the most room of any of them. */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:-mr-2 touch:px-3 touch:py-3"
          >
            [ esc ]
          </button>
        </header>

        {children}

        {footer}
        <Ticks />
      </div>
    </div>
  );
}

/** Caps label trailed by a rule: the terminal section break, reused. */
export function Group({ title, children }) {
  return (
    <section className="border-t border-line px-5 py-3 first:border-t-0">
      <div className="flex items-center gap-2.5 pb-1">
        <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{title}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}
