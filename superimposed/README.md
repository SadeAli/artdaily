# Superimposed Lines — draw the same line four times

The classic Drawabox warm-up, and the most useful line drill a beginner can
do. A faint guide line appears with a clear **start dot**; you draw that same
line **four times**, always from the dot, each repeat in darker ink so the fan
of your own repeats is visible. Four sets per round (~3 minutes), ramping from
a short straight to a longer, gently curved line.

It trains commitment, and it shows you your own consistency. You are scored
**against yourself**, never against a machine-perfect line — four confident
copies of a wrong line beat four timid different ones, and the how-to says so.

## Scoring

Pure geometry, in `js/game.js` above the canvas code, unit-testable without a
DOM. Per set:

| term | weight | what it measures |
|---|---|---|
| **fraying** | 55 | RMS perpendicular spread of the 4 repeats from **their own mean path**, normalised by the guide's length. Zero at `ArtDaily.ease(0.06)`, the first 0.5% free, with a 0.7 gamma so a clean 55 is earned and a wide fan still scores. |
| **commitment** | 30 | mean stroke smoothness: RMS turning angle with the *mean* turn removed, so an intended curve costs nothing and only wobble, corrections and stop-starts show. Zero at `ArtDaily.ease(0.095)` rad. |
| **start discipline** | 15 | how tightly the four presses cluster **on the dot** (60% on-the-dot, 40% same-place-every-time), scaled to `ArtDaily.startRadius(30)`. |

Round score is the mean of the four sets, reported exactly once. Deviation is
measured perpendicular to the mean path's own tangent, so drawing one repeat
faster than another never reads as fraying.

## The reveal

After every set: your fraying envelope shaded in sky around **your own mean
path**, inked over it, with the set score and a verdict in words — *tight fan
— confident* / *close fan — the repeats mostly agree* / *the repeats drift
apart — slow down less, commit more*. At round end the drill names the weakest
of the three habits so you know what to fix tomorrow.

## Fair input

Tolerances come from the SDK's input profile and the HUD says which mode it
eased for:

- every zero-point runs through `ArtDaily.ease()` — a trackpad is not held to
  a pen tablet's wobble (the same 15px-RMS hand scores 34 uneased, 66 eased)
- the start zone is `ArtDaily.startRadius(30)` — biggest on a screenless pen
  tablet, where acquiring a small target is the hardest thing the hand does
- a missed press within 3 start-radii is **snapped onto the dot and named**,
  and only ever costs part of the 15-point start term; further out it is
  refused and said so, because the jump it would inject is not ink you drew
  (and the coverage test ignores that jump either way)
- a repeat may be drawn in **as many contacts as it takes** — a trackpad
  cannot pull 400px in one go, so a press back near your lift carries the
  same line on, while a press back on the dot starts that line over
- stray taps reset free, *undo line* takes back the last repeat, *finish line*
  ends one early, a mid-stroke resize drops only that contact
- one repeat = one pointer, **a pen outranks a resting palm** (a touch is
  inert for 700ms after the nib speaks, and a nib takes the repeat off a
  touch that claimed it), fast strokes sampled via coalesced events, and the
  canvas runs taller on phones

## Run it

No build step, no dependencies — but serve the **repo root**, not this
folder. The drill loads `../sdk/artdaily-sdk.js`, `../js/main.js` and the
font from above itself, so a server rooted here starts it with no SDK, no
chrome and no font:

```sh
cd ..                 # the artdaily repo root
python3 -m http.server 8080
# then visit http://localhost:8080/superimposed/
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment — more at
[sadeali.com](https://sadeali.com/).
