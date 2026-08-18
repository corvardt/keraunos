# Tests still to do

Outstanding verification for the three features added on `worktree-thunder-gauge-reach`:
**thunder** (`lib/thunder.js`, `lib/audio.js`), **coverage gauge** (`lib/share.js`), and
**night reach** (`lib/reach.js`). Everything listed here is a thing that was *not* checked,
with what was checked recorded at the bottom so the two are not confused.

Most of it is unverified for one of two reasons: it makes a noise, or it needs longer than a
session to fill. Neither is something a headless probe can answer.

---

## 1. Thunder — none of this has been heard

The audio path has never been listened to. It compiles, it is wired, and that is all that is
known about it. Every item below needs a person with speakers.

- [ ] **It makes a sound at all.** Set Here on the map, turn on Settings → Sound → Thunder,
      and wait for a storm within 25 km. If nothing arrives, force it: temporarily drop
      `MAX_KM` in `lib/thunder.js` to something large and confirm a rumble plays, then put
      it back. Confirming the synth works and confirming the geometry works are two tests
      and should not be run as one.
- [ ] **Near cracks, far rumbles.** The whole claim of the feature. Play a strike at ~2 km
      and one at ~22 km and confirm they are audibly different events — the near one short
      and bright, the far one a slow swell with a lumpy tail. If they sound like the same
      noise at two volumes, the `ABSORB_KM` / `OPEN_HZ` curve needs retuning.
- [ ] **The delay is right.** The panel's Thunder countdown and the sound must agree: when
      the readout says `now`, the rumble should be arriving. They are computed from the same
      constant but by different code paths (the panel from `watch.thunder` in the storm pass,
      the audio from `handleDataReceived`), so agreement is a real test and not a tautology.
- [ ] **The network delay is actually being subtracted.** `roll()` is called with
      `km / SPEED_OF_SOUND_KMS - (arrived - flash) / 1000`. With a typical 4–7 s feed
      latency, a strike at 3 km (8.7 s of travel) should thunder about 2–4 s after it is
      drawn, not 8.7 s after. Watching that gap against the countdown is the check.
- [ ] **Turning it off is immediate.** Switch the toggle off while something is in flight —
      easiest at long range, where there is over a minute of travel — and confirm silence,
      not a rumble a minute later. This is what `hush()` exists for and it is the failure
      most likely to survive casual use.
- [ ] **Rewinding is silent.** Scrub the transport back; no thunder should play from the
      replayed hour. Same guard, different trigger.
- [ ] **Moving Here cancels what was queued.** Set Here, wait for something in flight, set
      Here somewhere else. Nothing should arrive from the old position.
- [ ] **A storm directly overhead is not mud.** `MAX_PENDING` is 6. Sit under an active cell
      and confirm it reads as weather rather than as continuous noise — and that the cap
      drops the excess rather than queueing it up to arrive late.
- [ ] **Clicks and thunder together.** Both on at once, through the one shared context. They
      should not fight, and enabling one must not silence the other — the context extraction
      into `lib/audio.js` is new and this is the thing it could have broken.
- [ ] **The gesture still works after the refactor.** Fresh tab, no prior audio: turning on
      *Detector clicks* alone must still produce ticks. `wake()` moved from `click.js` to
      `audio.js` and `settings.jsx` now imports it from there.
- [ ] **Safari.** `webkitAudioContext`, and its stricter autoplay rules. Untested.

## 2. Night reach — the effect itself is unconfirmed

The accumulator is unit-tested against synthetic paths (see below) and renders live. What has
**not** been observed is the real distributions separating.

- [ ] **The night half fills.** At the one session that was watched (≈23:10 UTC, the world's
      lightning concentrated over Florida and the Americas — the sunlit side) the day median
      was ready at ~3 minutes and night was still `—` at ~3.5 minutes. `ENOUGH` is 200 per
      side. Find out how long the dark half actually takes at an unfavourable hour, and if
      it is more than ten minutes or so, reconsider the threshold: a reading that is a dash
      for the first half hour is a reading nobody sees.
- [ ] **Night reads further than day.** The claim the feature is making. Needs a session long
      enough for both halves to be ready. Compare the `far` figures first — that is where the
      waveguide shows; the medians are mostly a fact about where the volunteer stations are
      and may barely separate at all.
- [ ] **What to do if they don't separate.** Decide in advance, so the result is not
      rationalised after the fact. Candidate causes, in order of likelihood: the midpoint
      binning smearing the two populations together; east/west asymmetry (comparable in size,
      per Hutchins 2013) swamping the day/night signal; or station geography dominating both
      distributions. If the effect will not show, the honest move is to say so in the hint
      rather than to keep tuning until it does.
- [ ] **The histogram with both halves populated.** The overlaid draw (day filled, night as a
      line) has only ever been seen with one half in it. Check it is legible when both are
      there and that the night line is readable over the day fill in both media.
- [ ] **The axis behaves as the far end grows.** `span` is the highest occupied bin, so the
      x-axis widens whenever something is heard further than before. Confirm that does not
      make the curves visibly jump about as a session runs.
- [ ] **A session crossing dusk.** The best version of this test: leave a tab open across a
      terminator crossing over an active region and watch the night distribution build.
- [ ] **Cost per strike.** `reach.record()` walks up to 40 stations with a haversine each,
      on every strike. Expected to be negligible at ~6–8 strikes/s but it has not been
      profiled. Check the flame chart during a busy hour before assuming so.

## 3. Coverage gauge

Renders and reads plausibly (6.1 /s, 14% share, against the 44 /s mark). What is left is
mostly visual.

- [ ] **The ±5 band is visible but not loud.** It is drawn in `fill-line` under a
      `fill-text/50` bar. Check it reads as an uncertainty band and not as a second reading,
      in both media and across the phosphor and contrast settings.
- [ ] **The bar at extremes.** A very quiet hour (bar near zero) and a very busy one (bar
      past the 44 mark, which is possible — `SCALE_MAX` is 55). Confirm nothing clips oddly
      and that overshooting the world mark still looks deliberate.
- [ ] **The share figure at session start.** It is suppressed below 60 strikes/min so the
      first seconds do not draw a share off four strikes. Confirm the `—` appears and then
      resolves, rather than flickering between the two.

## 4. Everything both features touch

- [ ] **The panel is now three sections longer.** Check short landscape (`short:` breakpoint,
      phone on its side) and the narrow stacked layout. The panel already scrolls as one
      there; confirm Coverage and Reach have not pushed the feed somewhere useless.
- [ ] **Tap-to-open hints.** The new hints on Coverage, Global share, Reach and Night are
      hover-only on a desktop and become tappable buttons under a coarse pointer. Untested on
      a real touch device.
- [ ] **Saved settings from before this branch.** `thunder` and `reach` are new keys.
      `useSettings` merges over `DEFAULTS`, so an existing `keraunos-settings` in
      localStorage should pick both up — thunder off, reach on. Worth confirming against a
      real saved config rather than trusting the spread.
- [ ] **Light theme.** All the new drawing uses palette tokens, but none of it has been seen
      in light.
- [ ] **The tour.** It walks `data-tour` anchors; two new sections now sit between `stats`
      and `active`. Check the walk still reads sensibly and does not scroll past them oddly.

---

## What *was* checked

Recorded here so the list above is not read as the whole picture.

- `npm run lint` and `npm run build` clean.
- `npm run check` — all seven suites pass, including the new `check:reach`.
- `scripts/check-reach.cjs` covers, against known answers: great-circle midpoints along the
  equator, across the north Pacific, and straddling the antimeridian; day/night binning
  either side of the subsolar point; the D-region terminator sitting 8.4° beyond the ground
  one; median, tail and span read off the histogram for a synthetic session where night paths
  carry 1.5× further; and the rejection of strikes with no locatable stations.
- The real app, driven headless against the live Blitzortung feed for ~3 minutes: loads,
  console clean, Coverage renders (6.1 /s, 14%), Reach renders (0–6k km axis, day median
  1,562 km, night not yet ready).

Note that the first probe run of the session was misleading — it hit an unrelated dev server
already holding port 5173 while this worktree had bound 5174. Check the port before believing
a probe that says a new section is missing.
