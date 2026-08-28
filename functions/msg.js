// The Meteosat dishes, borrowed onto our own origin.
//
// EUMETSAT's GeoServer serves the picture and will not say who may read it: no
// `access-control-allow-origin`, on any of its endpoints. That is not a refusal
// to serve, since the PNG comes back 200. It is a refusal to be read back, and
// the IR layer reads every tile back. `flat()` asks whether a tile is a single
// uniform value before it is kept, and a canvas that has drawn an image from an
// origin that did not consent is tainted: `getImageData` throws rather than
// answers. So the request has to be made by something that is not a browser
// tab, and this is the smallest such thing that already exists on the way to
// one.
//
// A Pages Function, so it deploys with the site and there is no second thing to
// keep alive. Cloudflare sits in front of the origin anyway; this only asks it
// to make one hop further and put its name on the answer.
//
// The other three dishes need none of this. RealEarth answers `*` and is called
// directly, and it stays that way: a proxy in front of a service that does not
// need one is a hop, a cache to go stale, and something else that can be down.
//
//   /msg?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=msg_fes:ir108&...
//
// The query is the WMS call `ir.js` already built, forwarded as-is. Nothing
// here knows what a tile is or when a scan was taken; the map decides that, the
// same way it decides it for the dishes it can reach itself.

const UPSTREAM = "https://view.eumetsat.int/geoserver/wms";

// What this is allowed to ask for.
//
// Without it this is an open proxy: anything on the internet could route
// anything through this hostname, and the bill and the blame would both arrive
// here. The map asks for two named layers at exactly one size, so the gate is
// narrow enough to write down, and a request that does not match is either a
// bug or somebody else's traffic, and both want the same answer.
const LAYERS = new Set(["msg_fes:ir108", "msg_iodc:ir108"]);
const MAX_SIDE = 512;

// A tile is the same tile for as long as the scan behind it is. EUMETSAT
// publishes every fifteen minutes and offers a week of caching on its own
// answer; ten minutes is the map's own refresh, which is the longest anything
// here can be stale without the map having asked again anyway.
const CACHE_S = 600;

const no = (why) => new Response(why, { status: 400, headers: { "cache-control": "no-store" } });

export async function onRequestGet({ request }) {
  const asked = new URL(request.url).searchParams;

  if (asked.get("SERVICE") !== "WMS") return no("not a WMS request");
  if (asked.get("REQUEST") !== "GetMap") return no("only GetMap");
  if (!LAYERS.has(asked.get("LAYERS") ?? "")) return no("not a layer this proxy carries");
  if (asked.get("FORMAT") !== "image/png") return no("only png");

  // Both sides, because a GetMap is priced by its area and this is the number
  // that decides how much work the upstream does for one request.
  for (const side of ["WIDTH", "HEIGHT"]) {
    const px = Number(asked.get(side));
    if (!Number.isInteger(px) || px < 1 || px > MAX_SIDE) return no(`${side} out of range`);
  }

  // Rebuilt rather than forwarded whole: what is passed on is the parameters
  // named here and nothing else, so a parameter this file has never heard of
  // cannot be smuggled through it.
  const out = new URLSearchParams();
  for (const key of [
    "SERVICE",
    "VERSION",
    "REQUEST",
    "LAYERS",
    "STYLES",
    "CRS",
    "BBOX",
    "WIDTH",
    "HEIGHT",
    "FORMAT",
    "TRANSPARENT",
    "TIME",
  ]) {
    const value = asked.get(key);
    if (value !== null) out.set(key, value);
  }

  const answer = await fetch(`${UPSTREAM}?${out}`, {
    // Cloudflare's own cache, keyed on the URL we just built. The upstream
    // answers the occasional 500 to a request that succeeds a second later, and
    // `ir.js` retries once for exactly that reason, so only success is worth
    // keeping, and a failure cached for ten minutes would turn a blip into an
    // outage for everybody behind this edge.
    cf: { cacheEverything: true, cacheTtl: CACHE_S, cacheTtlByStatus: { "200-299": CACHE_S, "300-599": 0 } },
  });

  // Passed through rather than smoothed over. A 500 has to reach the image tag
  // as a failure, because the ring is five services and the map is still a map
  // with four of them, and because the retry upstairs is waiting to be told.
  const headers = new Headers();
  headers.set("content-type", answer.headers.get("content-type") ?? "image/png");
  headers.set("access-control-allow-origin", "*");
  headers.set(
    "cache-control",
    answer.ok ? `public, max-age=${CACHE_S}` : "no-store"
  );
  return new Response(answer.body, { status: answer.status, headers });
}
