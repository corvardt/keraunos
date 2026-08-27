// Blitzortung streams LZW-compressed JSON frames. Their decoder, unchanged.
//
// It lives here rather than in the socket that reads it because the relay reads
// them too now: it keeps half an hour of strikes so a visitor arrives at a map
// that is already running, and it cannot keep what it cannot read.
export function decode(b) {
  let e = {};
  let d = Array.from(b);
  let c = d[0];
  let f = c;
  let g = [c];
  let h = 256;
  let o = h;
  for (let i = 1; i < d.length; i++) {
    let a = d[i].charCodeAt ? d[i].charCodeAt(0) : d[i];
    a = h > a ? String.fromCharCode(a) : e[a] || f + c;
    g.push(a);
    c = a[0];
    e[o] = f + c;
    o++;
    f = a;
  }
  return g.join("");
}
