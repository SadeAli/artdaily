# Color Mixer — mix the exact target color by eye

An [Art Daily](https://artdaily.sadeali.com/) drill for color perception:
five target swatches per round, three sliders (hue / saturation /
lightness), and no numbers until you commit. Match by eye, lock it in,
and the reveal shows both H/S/L triples, how far off you were, and which
axis carried the miss ("biggest miss: lightness — yours lighter by 8").
The first color is an easy warm-up; then vivid, then muted, ending
near-grey, where the eye drifts most (the hint warns you when hue stops
mattering). After the
fifth color a recap lines up all five target/mix pairs with their scores.

## Scoring

Both colors are converted hsl → sRGB → linear RGB → XYZ (D65) → Lab and
compared with CIE76 ΔE. A ΔE of 2 or less is below the eye's
just-noticeable difference and scores a full 100; from there the score
falls linearly to 0 at a zero point that SCALES WITH THE TARGET'S OWN
CHROMA (about ΔE 45 on a vivid colour, about 20 on a near-grey), so a
10° hue miss costs roughly the same on every item; the first two items
carry a small extra allowance so the warm-up is a real first win. The
round score is the mean of the five items.

## What changed in the input-fairness pass

The zero point of the score now scales with the target's own chroma, so
being 10° off costs about the same on a vivid colour as on a near-grey.
Before this the vivid items — which came first — were several times
harder to score than the muted ones, so the first number a beginner saw
was the worst of their round; item 1 is now an easy warm-up and the ramp
runs the way the how-to always claimed. Each slider carries ±1 stepper
buttons for exact landings without thumb-luck, the verdict leads with
plain English and puts ΔE second, and ΔE is defined inline on the first
reveal of every round.

## Input fairness

Nothing in this drill is a stroke, so nothing in it is eased per device.
Reading a colour is the same judgement from a pen, a trackpad or a thumb,
and widening the tolerance for a phone would just hand it free points for
the one thing the drill is actually testing. The HUD's "scoring for…"
chip is the shared SDK reporting which pointer it detected; here it
changes no number.

What hardware *can* decide is whether you are able to enter the answer
you meant, and that is what is guaranteed instead:

* three sliders on a 44px-tall hit strip, a 26px thumb, and ±1 steppers
  either side (44×44, 40×44 under 460px) plus the arrow keys — so an
  exact h/s/l is reachable without thumb-luck on any pointer;
* the zero point of the score scales with the *target's* chroma
  (`ZERO_AT 32 × (0.6 + chroma/78)`, clamped 16–50, then × `ITEM_EASE`
  1.35/1.12/1/1/1), which is what leaves room for a coarse pointer.

Measured on the shipping layout: a player who reads every target
correctly and only ever lands within 5px of where they aimed averages
**85/100** over a round on a 360px phone (134px hue track, 3.3° of hue per
pixel) and **99/100** on the 860px sheet (558px track). Same drill, same
scoring, no easing needed.

## Run it

No build step, no dependencies. Serve the repo root, not this folder: the
drill loads the sdk, the shared chrome and the display font from above it, and
a server rooted here cannot reach any of them.

```sh
cd ..    # the artdaily repo root
python3 -m http.server 8080
# then visit http://localhost:8080/colors/
```

Part of [Art Daily](https://artdaily.sadeali.com/), the daily-practice
arcade — a [SadeAli](https://sadeali.com/) experiment.
