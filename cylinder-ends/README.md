# Cylinder Ends 🥫

The far end of a cylinder is rounder — but how much?

A cylinder is drawn for you in wireframe except one thing: its far end is
still a flat line. Drag the dot out along the barrel until that end is as
round as it really is, then lock it in. Four cylinders, then a score.

A drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/) — zero
build step, zero dependencies, plain files.

## The lesson

The far end of a cylinder is **always** rounder than the near end — never
flatter, never the same — because the further a circle sits from the eye,
the more face-on the eye sees it. It is also *smaller*, which is the part
beginners do get right, and the collision of those two facts is why the
mistake is so persistent: a shape that shrinks feels like it should also
narrow, so the far end gets drawn flat, or copied straight off the near
one. The drill never asks *which way* — it says so on the first screen —
it asks **how much**, which is the only part that takes an eye.

## Real 3D, not a flat guess

The scene is a real cylinder: two circles of radius `r` on a real axis,
seen by a real pinhole eye at the origin looking down `+z` with the image
plane at `z = 1`.

The projection of a circle through a pinhole is a conic. The cone of rays
from the eye through a circle with centre `c`, unit normal `n` and radius
`r` is `v'Qv = 0` with

```
Q = d²I − d(nc' + cn') + (|c|² − r²)nn'      d = c·n
```

Read that same matrix at `v = (x, y, 1)` and you have the image conic;
decomposing it gives the ellipse's centre, both semi-axes and its tilt
**exactly** — no fitting, no sampling, no approximation. The barrel's two
edges are the true silhouette of the surface (the ring angle where the
surface normal is perpendicular to the eye ray, which is what makes a
cylinder's silhouette two straight lines), not a guessed tangent.

So the answer the reveal draws *is* the answer, and the score has an exact
ground truth to be pure about. The node harness cross-checks it the long
way round: it samples the actual 3D circle, projects every point by hand,
and asserts each one lands on the algebraically-derived ellipse (worst
residual ~1e-9 over 400 random scenes).

## Scoring — `auto`

One number per cylinder: **roundness**, the far end's height over its
width. The score is `100 · (1 − |yours − true| / zero)`, so the exact
answer is 100 and it fades to 0 as you drift. Pure functions at the top of
`js/game.js`, nothing else in the file touches them.

`zero` is the wider of two tolerances, both eased through the SDK from
their own base constant:

- **a ratio**, `ease(0.18)` — 0.18 on a pen, 0.36 on a trackpad, 0.27 on a
  finger. Scale-free, so a phone and a desktop ask the identical question.
- **a pixel floor**, `ease(11) / half-width` — because a ratio tolerance
  alone hands a small sheet a stricter drill: the same 0.27 of roundness
  is 31px of drag on a 780px sheet and 15px on a 360px one, and the hand's
  own noise then costs a finger twice what it costs a trackpad. It only
  bites below roughly a 400px sheet.

Calibrated against the mistake the drill exists for: copying the near
end's roundness onto the far one is a miss of about 0.25 on a typical
cylinder and scores **0 / 11 / 0**. Leaving it flat scores 0 everywhere.

## Nothing here is measured in pixels

The round remembers the cylinder in **image space** — the camera's own
normalised coordinates — and the attempt as a **ratio**. Neither depends
on the canvas, so rotating a phone mid-item, or mid-reveal, re-fits the
drawing and leaves the answer, the mark and the scale it was measured
against exactly where they were. The reveal stores the zero-point it was
judged under, so plugging a pen in while it is on screen cannot redraw the
tolerance band at half its width beneath a number measured on the old one.

## Verifying

```sh
node --check js/game.js
cd .. && python3 -m http.server 8080     # then http://localhost:8080/cylinder-ends/
```

Serve the **repo root**, not this folder. The SDK, the shared chrome and
the font are loaded from `../` and `../../fonts/`, so a server rooted here
puts all three above its own root and the drill comes up with no SDK, no
chrome and no font. From the root you can play it standalone at
`/cylinder-ends/`, then embedded from the page at `/`.

Two node suites live outside this folder (they read `js/game.js` directly,
so no copy of the drill's code drifts):

- a **pure-function harness** — perfect ≥ 95, garbage ≤ 30, monotonic in
  the error, finite 0–100 for every degenerate input, the reveal's words
  never disagreeing with the number at any point of the range, and the
  generator's guarantees (the far end is always at least 0.15 rounder, the
  near end never collapses to a line, no round ever falls back to the
  preset cylinder).
- a **headless run of the whole drill** against a stub DOM — every path a
  player can take, including the ones that are only ever bugs: "new round"
  during a reveal, a press while the reveal holds the screen, a resize
  mid-drag, a canvas measuring zero at boot, keyboard-only play, a palm
  landing after a pen. What it proves is that `report()` fires exactly
  once per finished round and never for an abandoned one.

The protocol is not vendored here any more: the page loads
`../sdk/artdaily-sdk.js`, the repo's single copy, so there is nothing in
this folder that can drift out of step with it.
