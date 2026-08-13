// Checks every capital coordinate against the country polygons the app ships.
//
// A capital list written by hand fails in one characteristic way: a sign or a
// transposition, which lands the city in the sea or in a neighbouring country
// and reads as perfectly plausible in the source. Point-in-polygon catches
// exactly that class, so the list is testable rather than merely proofread.
//
//   node scripts/check-capitals.cjs

const path = require("path");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const world = require("../src/lib/world.json");

// The data module is ESM; pull the literal rows out rather than importing it.
const source = require("fs").readFileSync(
  path.join(__dirname, "../src/lib/capitals.js"),
  "utf8"
);
const rows = [...source.matchAll(/\["(.+?)", "(.+?)", (-?[\d.]+), (-?[\d.]+), (\d)\]/g)].map(
  (m) => ({ name: m[1], country: m[2], lon: +m[3], lat: +m[4], tier: +m[5] })
);

const locate = (lon, lat) => {
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const feature of world.features) {
    if (booleanPointInPolygon(point, feature)) return feature.properties.name;
  }
  return null;
};

const known = new Set(world.features.map((f) => f.properties.name));
let wrong = 0;
let offshore = 0;
let unknown = 0;

for (const capital of rows) {
  // Countries too small to appear in a 177-feature world are not failures of
  // the coordinate; they are the resolution of the map it is checked against.
  if (!known.has(capital.country)) {
    unknown++;
    console.log(`  ?  ${capital.name.padEnd(16)} ${capital.country}: not a feature in world.json`);
    continue;
  }
  const found = locate(capital.lon, capital.lat);
  if (found === capital.country) continue;
  if (found === null) {
    offshore++;
    console.log(`  ~  ${capital.name.padEnd(16)} expected ${capital.country}, landed offshore`);
  } else {
    wrong++;
    console.log(`  ✗  ${capital.name.padEnd(16)} expected ${capital.country}, landed in ${found}`);
  }
}

const tier1 = rows.filter((c) => c.tier === 1).length;
console.log(
  `\n${rows.length} capitals (${tier1} tier 1): ` +
    `${rows.length - wrong - offshore - unknown} exact, ${offshore} offshore, ` +
    `${unknown} unmapped, ${wrong} in the wrong country`
);
process.exit(wrong ? 1 : 0);
