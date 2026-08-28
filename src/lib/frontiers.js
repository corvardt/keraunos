import GeoData from "./world.json";

// The world as an outline, taken from the boundary data the map already carries.
//
// A frontier is the edge two countries agree on. The data is topologically
// clean (neighbours share vertices exactly, not approximately) so an interior
// border is an edge that appears in two features, and a coastline is one that
// appears in a single one. That distinction is the whole point of doing this
// rather than stroking country outlines whole: stroked as rings, every interior
// border is drawn twice and cannot be told from a coast, so the two can never
// be given different weight. Of 10,286 edges, 2,630 are shared, across 313
// pairs of countries.
//
// Extracted from what is already bundled, so this costs no bytes over the wire,
// and once per session, so it costs nothing per frame either.

const key = (point) => `${point[0]},${point[1]}`;

const ringsOf = (geometry) =>
  geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();

let cached = null;

/**
 * Chain a heap of segments into polylines, in lon/lat.
 *
 * Chained rather than left as segments because a stroke wants runs: a path per
 * segment is ten thousand subpaths with a join at every one of them, and the
 * corners are the whole look of this map. Runs are cut where a node stops
 * having exactly two edges, which is a tripoint, or a coast meeting a border.
 */
function chain(segments) {
  const nodes = new Map();
  const points = new Map();
  for (const edge of segments) {
    points.set(edge.ka, edge.a);
    points.set(edge.kb, edge.b);
    for (const at of [edge.ka, edge.kb]) {
      const list = nodes.get(at);
      if (list) list.push(edge);
      else nodes.set(at, [edge]);
    }
  }

  const used = new Set();
  const trace = (from) => {
    let at = from;
    const path = [points.get(at)];
    for (;;) {
      const next = nodes.get(at)?.find((edge) => !used.has(edge.id));
      if (!next) return path;
      used.add(next.id);
      at = next.ka === at ? next.kb : next.ka;
      path.push(points.get(at));
    }
  };

  // Start from the ends: a node of degree two is the middle of a run, and
  // anything else is where one run stops and another begins. Starting mid-run
  // instead would split it into two half-runs.
  const paths = [];
  for (const [at, list] of nodes) {
    if (list.length === 2) continue;
    while (list.some((edge) => !used.has(edge.id))) {
      const path = trace(at);
      if (path.length > 1) paths.push(path);
    }
  }

  // Whatever is left is a closed loop with no end to start from: an island, or
  // a country wholly inside another one. Any node will do.
  for (const edge of segments) {
    if (used.has(edge.id)) continue;
    used.add(edge.id);
    const path = [edge.a, ...trace(edge.kb)];
    if (path.length > 1) paths.push(path);
  }
  return paths;
}

/**
 * The outline of the world, as two sets of polylines in lon/lat.
 *
 *   coast: every edge only one country claims, which is a coastline
 *   inner: every edge two of them claim, which is a frontier
 */
export default function outlines() {
  if (cached) return cached;

  // One pass to find the shared edges. `owner` holds the first country to claim
  // an edge; a second, different claimant is what makes it a frontier. Comparing
  // names rather than counting visits keeps an enclave's own doubled-back ring
  // from looking like a border with itself.
  const edges = new Map();
  for (const feature of GeoData.features) {
    const name = feature.properties.name;
    for (const ring of ringsOf(feature.geometry)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [a, b] = [ring[i], ring[i + 1]];
        const [ka, kb] = [key(a), key(b)];
        if (ka === kb) continue;
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const found = edges.get(id);
        if (!found) edges.set(id, { id, a, b, ka, kb, owner: name, shared: false });
        else if (found.owner !== name) found.shared = true;
      }
    }
  }

  const coast = [];
  const inner = [];
  for (const edge of edges.values()) (edge.shared ? inner : coast).push(edge);

  cached = { coast: chain(coast), inner: chain(inner) };
  return cached;
}
