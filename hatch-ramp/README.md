# Hatch a Ramp — make a gradient with your own hand

A daily drill that bridges line control and value: the first time most
beginners build a gradient with their own hand instead of a slider. Three
panels per round (~3 minutes). Each panel is a sheet of paper with the target
ramp printed on the swatch strip beside it; you hatch inside the paper — many
short parallel strokes, packed tighter where it should be darker — and the ink
accumulates live, so overlapping strokes really do darken.

Panel 1 is a wide light → dark ramp, panel 2 a tall one running top → bottom,
panel 3 a narrow two-stop ramp: up to a mid tone, **hold** it, into the core
dark, then the light band coming back in at the end. Press **done** once the
ramp reads (15 strokes minimum, undo and clear cost nothing).

## Scoring

Pure functions, at the top of `js/game.js`, testable without a canvas.

The rendered panel is read back in **24 bands** along the ramp axis — mean ink
density per band, taken from the *alpha* channel of the ink layer, so the paper
and pencil colours (which differ per theme) cannot move a score. Both the
player's curve and the target get the same `[1 2 1]` blur (squinting), and the
player's is divided by its own darkest band, so a light hand and a heavy hand
score the same shape: **the lesson is spacing, not pressure**. The only
absolute is a normalisation floor, which stops fifteen specks normalising
their way to a perfect ramp.

```
rampScore = 100 · clamp(1 − (meanAbsError − 0.035) / ease(0.22), 0, 1)
panel     = 0.85 · rampScore + 0.15 · parallelism      (parallelism dropped
round     = mean of the three panels                    if unmeasurable)
```

Parallelism is the circular concentration of the strokes' *doubled* principal
angles (hatching has no head or tail, and PCA is used per stroke so a
back-and-forth zigzag reports the axis it zigzags along, not a meaningless net
displacement). Over-hatching is scored honestly rather than specially: stacking
ink past full coverage saturates the alpha and flattens the top of your ramp,
and the graph shows exactly that.

Every zero-point tolerance goes through `ArtDaily.ease()` and every hit zone
through `ArtDaily.startRadius()`, so the drill scores the hardware the player
actually owns; the HUD says which mode it eased for. Measured by feeding
simulated hatching through the real scorer: a beginner's first go on a
trackpad (20 short strokes, dark far too fast, angles wandering ±10°) scores
**0 on the ramp at pen tolerance and 49 at trackpad tolerance** — 13 vs 56
overall. A perfect hatch is 100 on every device, a scribble is 0–17.

## The reveal

After every panel, not just at round end: the panel is re-drawn as flat bands
(your ramp, with your hatching ghosting through), and under it your density
curve is graphed against the target with the miss shaded between them — so
"too dark too fast", the classic beginner error, is visible rather than
asserted. The delta is also named in words.

## Run it

No build step, no dependencies. Serve the repo root one level up, not this
folder — the SDK, the shared chrome and the font are all loaded from above
it, and a server rooted here would start the drill with none of them:

```sh
cd .. && python3 -m http.server 8080
# then visit http://localhost:8080/hatch-ramp/
```

Studio tip the drill is built around: keep every stroke the same length and
the same angle and let **spacing** do the work — a smooth ramp is a spacing
problem, not a pressure problem.

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment.
