import { geoMercator } from "d3-geo";

export const LAT_LIMIT = 74; // Mercator runs to infinity at the poles
export const PAD = 24; // breathing room around the fitted world
export const MIN_K = 1; // the whole world; there is nothing to see further out
export const MAX_K = 40; // roughly a 200km span across the tube
// There was a margin here once: extra extent built beyond the edges so that a
// small pan would still find land under it. It never reached the screen. The
// layers are drawn to canvases exactly the size of the viewport, so everything
// built outside it was clipped at paint: at 3x zoom, 9,239 of 15,288 dots, 60%
// of the build, discarded on every settle, for an edge that stayed empty anyway.
//
// Covering that edge for real means canvases larger than the viewport, and they
// are already the largest allocation in the app. So this is the honest version:
// build what is drawn. The edge fills on settle, 160ms behind the pointer.

/** The world, fitted to the tube. Everything else is a transform over this. */
export function fitProjection(width, height) {
  const projection = geoMercator().scale(1).translate([0, 0]);
  const [, top] = projection([0, LAT_LIMIT]);
  const [, bottom] = projection([0, -LAT_LIMIT]);
  const scale = Math.min((width - PAD * 2) / (2 * Math.PI), (height - PAD * 2) / (bottom - top));
  return geoMercator()
    .scale(scale)
    .translate([width / 2, height / 2 - ((top + bottom) / 2) * scale]);
}

/**
 * The view is a plain screen transform over the fitted world: screen = k·p + t.
 * Mercator is linear in scale and translate, so that composition folds back
 * into a real projection, which means every caller, including `invert`, keeps
 * working without knowing a view exists at all.
 */
export function zoomed(base, view) {
  if (!base) return null;
  const [tx, ty] = base.translate();
  return geoMercator()
    .scale(base.scale() * view.k)
    .translate([tx * view.k + view.x, ty * view.k + view.y]);
}

/** Screen extent of the whole world under `base`, at k = 1. */
export function worldExtent(base) {
  const [west] = base([-180, 0]);
  const [east] = base([180, 0]);
  const [, top] = base([0, LAT_LIMIT]);
  const [, bottom] = base([0, -LAT_LIMIT]);
  return { west, east, top, bottom };
}

// The world may be dragged around inside the tube but never off it: past the
// edge there is no data, only void that reads as a rendering fault.
export function clampView(view, base, width, height) {
  if (!base) return view;
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k));
  const { west, east, top, bottom } = worldExtent(base);

  const axis = (min, max, size, t) => {
    const span = (max - min) * k;
    // Smaller than the viewport (which is the case at k = 1, by the padding in
    // the fit): centre it rather than pinning it to an edge.
    if (span <= size) return (size - span) / 2 - min * k;
    return Math.max(size - max * k, Math.min(-min * k, t));
  };

  return { k, x: axis(west, east, width, view.x), y: axis(top, bottom, height, view.y) };
}

/** Zoom about a screen point, so whatever is under it stays under it. */
export function zoomAbout(view, x, y, factor) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
  const ratio = k / view.k;
  return { k, x: x * (1 - ratio) + view.x * ratio, y: y * (1 - ratio) + view.y * ratio };
}

/** The view that frames a lon/lat box, as close as the limits allow. */
export function viewForBounds(base, width, height, [west, south, east, north]) {
  const topLeft = base([west, north]);
  const bottomRight = base([east, south]);
  const w = Math.abs(bottomRight[0] - topLeft[0]);
  const h = Math.abs(bottomRight[1] - topLeft[1]);
  const k = Math.min(
    MAX_K,
    Math.max(MIN_K, Math.min((width - PAD * 2) / w, (height - PAD * 2) / h))
  );
  const cx = (topLeft[0] + bottomRight[0]) / 2;
  const cy = (topLeft[1] + bottomRight[1]) / 2;
  return clampView({ k, x: width / 2 - k * cx, y: height / 2 - k * cy }, base, width, height);
}

/**
 * The lon/lat box on screen.
 *
 * The corners are clamped to the world before being inverted, never after:
 * Mercator's inverse wraps longitude, so a point off the left edge comes back
 * as a real coordinate on the far side of the globe. Inverting first and
 * clamping after quietly yields a box that is inside out.
 */
export function visibleBounds(projection, width, height) {
  const [west] = projection([-180, 0]);
  const [east] = projection([180, 0]);
  const [, top] = projection([0, LAT_LIMIT]);
  const [, bottom] = projection([0, -LAT_LIMIT]);

  const x0 = Math.max(0, west);
  const x1 = Math.min(width, east);
  const y0 = Math.max(0, top);
  const y1 = Math.min(height, bottom);
  if (!(x0 < x1) || !(y0 < y1)) return [-180, -LAT_LIMIT, 180, LAT_LIMIT];

  const a = projection.invert([x0, y0]);
  const b = projection.invert([x1, y1]);
  if (!a || !b || !isFinite(a[0]) || !isFinite(b[0])) {
    return [-180, -LAT_LIMIT, 180, LAT_LIMIT];
  }
  return [
    Math.max(-180, Math.min(a[0], b[0])),
    Math.max(-LAT_LIMIT, Math.min(a[1], b[1])),
    Math.min(180, Math.max(a[0], b[0])),
    Math.min(LAT_LIMIT, Math.max(a[1], b[1])),
  ];
}
