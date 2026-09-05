// The set's shared files, written out from this checkout.
//
//   node scripts/fanout.cjs            # copy source over every stale copy
//   node scripts/fanout.cjs --check    # report drift, write nothing, exit 1
//
// Three files are the same file in five repos, which until now was a promise
// kept by hand and was not being kept: each copy of DESIGN.txt held a paragraph
// the others had lost, and Tyche's crt.css had grown a rule of its own.
//
// It assumes the sibling checkouts are beside this one, which is what a copy
// means here: they are separate repos, so there is no import to do it with. A
// missing sibling is skipped rather than an error, since somebody may have only
// cloned one.

const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const HERE = resolve(__dirname, "..");
const SET = resolve(HERE, "..");

// Opsis is deliberately absent from crt.css: same rules under its own condensed
// comments, which is a decision somebody has to make rather than drift to
// overwrite. See repair item 12.
const FILES = [
  {
    source: "DESIGN.txt",
    copies: ["DESIGN.txt", "Tyche/DESIGN.txt", "Steropes/DESIGN.txt", "Oikos/DESIGN.txt", "Opsis/DESIGN.txt"],
  },
  {
    source: "src/crt.css",
    copies: ["Tyche/src/crt.css", "Steropes/crt.css", "Oikos/crt.css"],
  },
  {
    source: "src/lib/contrast.js",
    copies: ["Tyche/src/lib/contrast.js", "Steropes/src/contrast.js"],
  },
];

const check = process.argv.includes("--check");
let drifted = 0;
let written = 0;

for (const { source, copies } of FILES) {
  const wanted = readFileSync(join(HERE, source));
  for (const copy of copies) {
    const path = join(SET, copy);
    if (!existsSync(path)) {
      console.log(`skip  ${copy} (not cloned)`);
      continue;
    }
    if (readFileSync(path).equals(wanted)) continue;
    drifted++;
    if (check) {
      console.log(`drift ${copy}  (${source})`);
      continue;
    }
    writeFileSync(path, wanted);
    written++;
    console.log(`wrote ${copy}  (${source})`);
  }
}

if (check) {
  console.log(drifted ? `${drifted} copy/copies differ from source` : "every copy matches its source");
  process.exit(drifted ? 1 : 0);
}
console.log(written ? `${written} copy/copies rewritten` : "nothing to do");
