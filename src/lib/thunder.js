// The sound of the weather, as opposed to the sound of the instrument.
//
// The click next door is the instrument's own noise: one tick per arrival, the
// sound a counter makes, and it says nothing about where anything was. This
// says only that. Once the reader has told the map where they are, a strike
// near enough for its sound to reach them is played when the sound would reach
// them — the real distance, at the real speed, worn down the way the air wears
// it down on the way over.
//
// The panel already counts that arrival down (`watch.thunder`), which is the
// same physics written as a number: sound covers about 343 m/s, so the gap
// between the flash and the bang is the distance, and the countdown is the gap.
// What the number cannot show is the second half of it. Air absorbs high
// frequencies far faster than low ones, so a strike two kilometres off still
// arrives with its edge on and cracks, while the same strike at twenty has had
// everything above a few hundred hertz taken out of it and can only rumble.
// Scattering off turbulence and terrain spreads it in time as well: the near
// one is over in half a second and the far one rolls for three. That is the
// whole of why thunder sounds like two different events, and it is a thing an
// instrument can demonstrate rather than assert.
//
// Synthesised, like the click, and for the same reason. No recording of thunder
// is the thunder of this strike at this distance; a sample played at every
// range is a lie with a file size, and the tuning here is the reading.

import { context } from "./audio.js";

// Matches the panel's countdown, and for the same reason: past about this the
// sound has been absorbed to nothing on the way, and offering a rumble for a
// strike nobody could hear would be inventing weather.
export const MAX_KM = 25;

// The longest roll, and so the length of the noise the rolls are cut from. One
// buffer, made once: at 44.1kHz this is a megabyte and change, against a new
// allocation every time it thunders.
const ROLL_S = 3.6;
const CRACK_S = 0.55; // the near end, where there is no roll left to spread

// Absorption, as one curve. The cutoff a strike arrives under, in hertz: full
// bandwidth up close, falling away with range because the top of the spectrum
// is the part the air takes. The scale length is fitted to the audible range
// rather than to a published absorption coefficient — the point it has to get
// right is that twenty kilometres is a rumble and two is a crack, and it does.
const OPEN_HZ = 3400;
const FLOOR_HZ = 130;
const ABSORB_KM = 7;

// Brown noise wanders around zero and the wander is inaudible rubbish that
// costs headroom, so it is cut below where thunder has anything to say.
const RUMBLE_HZ = 22;

// A storm directly overhead can put more strikes inside the radius than there
// is room for in the ear. Past this the extra ones are mud rather than
// information, and the honest thing is to stop stacking them.
const MAX_PENDING = 6;

let noise = null;
// Everything scheduled and not yet played, so the setting can be turned off
// without a minute of thunder still arriving from a map nobody is listening to.
const scheduled = new Set();

/**
 * One buffer of brown noise, reused.
 *
 * Brown rather than white: white noise is hiss, and hiss low-passed is quieter
 * hiss. Thunder's spectrum falls away towards the top, which is what a running
 * sum of white noise does, and it is the difference between this sounding like
 * weather and sounding like a tap running in another room.
 */
function buffer(ctx) {
  if (noise) return noise;
  const frames = Math.ceil(ctx.sampleRate * ROLL_S);
  noise = ctx.createBuffer(1, frames, ctx.sampleRate);
  const channel = noise.getChannelData(0);
  let level = 0;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    // Leaky, so the walk cannot drift away and take the whole buffer with it.
    level = (level + (Math.random() * 2 - 1) * 0.03) / 1.03;
    channel[i] = level;
    if (Math.abs(level) > peak) peak = Math.abs(level);
  }
  // Normalised, because the walk's amplitude is a property of the random seed
  // and the loudness of the thunder must not be.
  const scale = peak ? 0.98 / peak : 1;
  for (let i = 0; i < frames; i++) channel[i] *= scale;
  return noise;
}

/**
 * Schedule one strike's thunder.
 *
 * `km` is how far off it fell and `inSeconds` is how long the sound still has
 * to travel — the caller knows both, because it knows when the flash actually
 * happened and the network runs several seconds behind. Scheduled on the audio
 * clock rather than by timer: this is a measurement of an interval, and the
 * only clock in the browser that will hold one accurately for a minute is the
 * one the sound comes out of.
 */
export function roll(km, inSeconds) {
  const ctx = context();
  if (!ctx || ctx.state !== "running") return;
  if (!(km >= 0) || km > MAX_KM) return;
  if (!(inSeconds > 0)) return; // it has already been and gone
  if (scheduled.size >= MAX_PENDING) return;

  const near = km / MAX_KM;
  const at = ctx.currentTime + inSeconds;
  const length = CRACK_S + (ROLL_S - CRACK_S) * near;

  const source = ctx.createBufferSource();
  source.buffer = buffer(ctx);
  // Started from a different place in the buffer each time, so the same
  // megabyte of noise is not recognisably the same thunder twice.
  const offset = Math.random() * (ROLL_S - length);

  const cut = ctx.createBiquadFilter();
  cut.type = "lowpass";
  cut.frequency.value = FLOOR_HZ + OPEN_HZ * Math.exp(-km / ABSORB_KM);
  // Opened up a touch on the close ones: a crack has a peak at the top of its
  // band and a distant roll has nothing up there to resonate.
  cut.Q.value = 0.7 + (1 - near) * 0.8;

  const floor = ctx.createBiquadFilter();
  floor.type = "highpass";
  floor.frequency.value = RUMBLE_HZ;

  const gain = ctx.createGain();
  // Spreading, mostly: the sound goes out over a growing sphere, and the
  // absorption that took the top off has taken some of the level with it. The
  // near end is capped rather than allowed to reach one — a strike at half a
  // kilometre is a genuinely alarming noise and this is a browser tab.
  const loud = 0.55 / (1 + km / 4);

  // The envelope is the other half of the distance. Close, it is an edge: on in
  // four milliseconds and gone. Far, it swells over a fifth of a second and
  // then rolls, because what is arriving is one flash's worth of sound that has
  // come by a dozen different path lengths.
  const attack = 0.004 + 0.2 * near;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(loud, at + attack);

  // The roll itself: the tail is lumpy rather than a clean decay, which is the
  // audible signature of a sound that arrived by several routes. Only ever
  // drawn on the far ones, since that is the only place the routes differ
  // enough to hear.
  const rolls = Math.round(near * 5);
  for (let i = 1; i <= rolls; i++) {
    const when = at + attack + ((length - attack) * i) / (rolls + 1);
    gain.gain.linearRampToValueAtTime(loud * (0.35 + Math.random() * 0.5) * (1 - i / (rolls + 2)), when);
  }
  // Exponential to a floor rather than to zero: ramping to zero is not a decay
  // in this API, it is a discontinuity, and a discontinuity is a click.
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

  source.connect(floor).connect(cut).connect(gain).connect(ctx.destination);
  source.start(at, offset, length);
  source.stop(at + length);

  scheduled.add(source);
  source.onended = () => scheduled.delete(source);
}

/**
 * Drop everything still on its way.
 *
 * Turning the setting off has to be immediate, and without this it would not
 * be: a strike twenty-five kilometres out is seventy seconds of travel, so the
 * map could go quiet and then thunder at somebody who had switched it off a
 * minute earlier. Called on the way out of a session too, for the same reason.
 */
export function hush() {
  for (const source of scheduled) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped, or never started. Either way it is not coming.
    }
  }
  scheduled.clear();
}
