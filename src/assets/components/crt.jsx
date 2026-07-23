import { memo } from "react";

/**
 * The glass. Sits above everything, catches no pointer events, and is the only
 * place the retro treatment lives — the components underneath stay clean.
 */
function Crt({ scanlines = true, sweep = true }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {sweep && <div className="crt-sweep absolute inset-x-0 top-0" />}
      {scanlines && <div className="crt-scanlines absolute inset-0" />}
      <div className="crt-vignette absolute inset-0" />
    </div>
  );
}

// Two settings booleans, and nothing else. There is no render of App that
// should also re-render the glass.
export default memo(Crt);

/** Corner ticks for panels and the map — an instrument bezel, not a border. */
export function Ticks() {
  return (
    <>
      <span className="tick left-0 top-0 border-l border-t" />
      <span className="tick right-0 top-0 border-r border-t" />
      <span className="tick bottom-0 left-0 border-b border-l" />
      <span className="tick bottom-0 right-0 border-b border-r" />
    </>
  );
}
