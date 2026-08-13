// The tick.
//
// A lightning detector clicks: that is what the hardware does, and it is the
// oldest way an instrument has of telling you the rate without being watched.
// Off unless asked for, because a page that makes noise uninvited is a page
// nobody opens twice.
//
// Synthesised rather than sampled: a click is 6ms of filtered noise, which is
// cheaper to make than to fetch, and no asset can be wrong about the tuning.

const CLICK_MS = 0.006;
const MAX_PER_SECOND = 14; // past this it is a tone, not a count
const BAND_HZ = 1900;

let audio = null;
let noise = null;
let recent = [];

// Browsers refuse to start audio without a gesture, which is exactly right.
// Nothing here runs until the reader has turned the setting on, and that click
// is the gesture, so the context is built on first use and never before.
function context() {
  if (audio) return audio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audio = new Ctor();

  // One buffer of white noise, reused. Allocating per click would make the
  // garbage collector the loudest thing in the room.
  const frames = Math.ceil(audio.sampleRate * CLICK_MS);
  noise = audio.createBuffer(1, frames, audio.sampleRate);
  const channel = noise.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Shaped as it is written: a click is an attack and a decay, and noise that
    // stops abruptly is a pop rather than a tick.
    channel[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  return audio;
}

/** Volunteered by the settings panel, so the gesture that enables it starts it. */
export function wake() {
  const ctx = context();
  if (ctx?.state === "suspended") ctx.resume();
}

/**
 * One tick. `weight` runs 0 to 1: a hard strike is a heavier knock, the way a
 * closer particle is on a counter.
 */
export function tick(weight = 0) {
  const ctx = context();
  if (!ctx || ctx.state !== "running") return;

  // A global feed at eight strikes a second would otherwise be a buzz. Dropping
  // the overflow keeps the sound a count of arrivals rather than a level.
  const now = ctx.currentTime;
  recent = recent.filter((t) => now - t < 1);
  if (recent.length >= MAX_PER_SECOND) return;
  recent.push(now);

  const source = ctx.createBufferSource();
  source.buffer = noise;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = BAND_HZ * (0.85 + Math.random() * 0.3);
  band.Q.value = 1.4;

  const gain = ctx.createGain();
  gain.gain.value = 0.05 + weight * 0.14;

  source.connect(band).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(now + CLICK_MS * 2);
}
