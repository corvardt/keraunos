// The one audio context.
//
// Two things here make noise, the detector click and the thunder. A browser
// counts contexts rather than sounds: a handful per page, each needing
// its own gesture before it will start and its own resume after the tab has
// been away. Two of them would be two things to keep awake and twice as much
// to get wrong, for one loudspeaker.
//
// Built on first use and never before. Nothing here runs until a setting has
// been turned on, and that turning-on is the gesture the browser is waiting
// for, which is exactly the right arrangement: a page that makes noise before
// it is asked is a page nobody opens twice.

let audio = null;

/** The context, or null where the browser has no audio at all. */
export function context() {
  if (audio) return audio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audio = new Ctor();
  return audio;
}

/** Volunteered by the settings panel, so the gesture that enables it starts it. */
export function wake() {
  const ctx = context();
  if (ctx?.state === "suspended") ctx.resume();
}
