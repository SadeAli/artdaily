# Mix to Target ⚗️

Blend base pigments into the target colour — a colour-mixing drill that
trains ratio judgement: how much of each pigment a mix really needs.
Four colours per round; two bases at first, then three, ending with a
near-duplicate hue pair you have to read by value.

Mixing is a pigment-style subtractive model (weighted geometric mean in
linear RGB), and every target is generated through that same model, so
a perfect match always exists. Scoring is ΔE (CIE76) distance in Lab:
`100 × (1 − ΔE/26)` per colour, round score is the mean of four. After
every lock-in the true ratios are revealed next to yours.

Sliders are relative ratios — only the balance matters — so each row
shows its live normalized share (%), matching the reveal's numbers.
Every colour opens on a random blend rejection-sampled to sit at least
ΔE 12 from the target (or, where an item's pigments sit too close for
that, the most-off blend its gamut allows), so there is always a visible
gap to close and "press lock without touching anything" is never a
strategy — locking the opening blend untouched averages ~18/100.
An all-zero palette shows honest stripes and refuses to lock. The
verdict names the direction of a miss ("too light, a touch too warm",
from the Lab deltas — `missDiagnosis`), a post-lock "squint ◐" toggle
compares target and mix in greyscale (luminance-preserving, `toGrey`),
the HUD score runs as a live mean during the round, the lock button
becomes "new round ↻" at round end, and a mid-round "new round" press
asks "start over?" before discarding locked colours.

Run it: `python3 -m http.server 8080` in the repo root one level up, then open
`http://localhost:8080/mix-to-target/` — the SDK, the page chrome and the font
come from `../`, so a server rooted in this folder serves the drill without
them. No build, no deps.

Part of [Art Daily](https://artdaily.sadeali.com/), a sketchbook of tiny
scored drills from [sadeali.com](https://sadeali.com/).

## What changed in the input-fairness pass

The "squint ◐" greyscale toggle — the drill's own studio tip — is
available WHILE mixing, not only after you lock in. Each pigment row has
±1 steppers and is named for what it looks like ("dark blue") instead of
a bare letter, the first item states that the sliders are ratios, and the
verdict leads with plain English.

## Input fairness

Nothing in this drill is a stroke, so nothing in it is eased per device.
Reading a colour is the same judgement from a pen, a trackpad or a thumb,
and widening the tolerance for a phone would just hand it free points for
the one thing the drill is actually testing. The HUD's "scoring for…"
chip is the shared SDK reporting which pointer it detected; here it
changes no number.

What hardware *can* decide is whether you are able to enter the answer
you meant, and that is what is guaranteed instead:

* ratio sliders on a 44px hit strip with ±1 steppers either side, and —
  under 520px — the pigment's name lifted onto its own line so the track
  keeps the full width (141px at 360px, 115px of travel) no matter which
  pigment the round rolled;
* the true ratios are quantized to whole percents, so the exact answer
  always sits *on* a slider notch and a 100 is reachable by hand.

Measured on the shipping layout: aiming at the true ratio and landing
within 5px of it averages **91/100** on a 360px phone and **97/100** on
the 860px sheet.

