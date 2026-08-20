// A PNG decoder for the checks, because there is no canvas out here.
//
// The map reads its two rendered layers back through a browser canvas, which
// these scripts do not have. Both of them — the radar composite and the
// lightning imager — publish their measurement as a colour rather than a
// number, so a check that cannot look at pixels cannot check the only part of
// those layers that can silently be wrong.
//
// Only the one case both services serve: 8-bit RGBA, no interlacing. Anything
// else throws rather than guessing, which is the right failure — a decoder that
// quietly mis-read a format would be a check that passed on nonsense.
const zlib = require("zlib");

function decodePng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colour = buffer[25];
  if (depth !== 8 || colour !== 6) throw new Error(`unexpected PNG: depth ${depth}, type ${colour}`);

  let at = 8;
  const parts = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") parts.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prior = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prior[i];
      const c = i >= bpp ? prior[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 255;
    }
  }
  return { width, height, data: out };
}

module.exports = { decodePng };
