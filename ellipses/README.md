# Ellipse Orbit — draw clean ellipses inside their bounding planes

A ~40-second daily drill for the classic construction skill: fitting a clean,
confident ellipse into its plane. Five dashed boxes per round, ramping from
near-circles to slim ones — draw the ellipse that touches all four sides.
Accent ticks on the box mark where it should touch.

The drill teaches two words on the spot rather than assuming them: the dashed
box is the **plane** (said once, on box one), and the tilt the reveal animates
is the ellipse's **degree**. Everything else is plain English — the hint copy
says "box" and "loop", not "plane" and "orbit".

**The reveal is real 3D**: a genuine circle of the plane's major radius is
rotated about the major axis (rotation matrix, orthographic projection) until,
at tilt = acos(minor ÷ major), the projection *is* the target ellipse — every
ellipse is a circle seen at an angle, and the reveal animates that fact. A ring
marks where your stroke strayed furthest. The reveal holds until you tap, and
the final plane stays on canvas after the round ends.

Scoring is pure geometry (see the top of `js/game.js`): the stroke is resampled
to even arc length (so a fast loop and a slow trace are judged on the same
geometry), true point-to-curve distance in pixels sets the fit score, angular
coverage multiplies it if you leave gaps, and an unclosed loop costs up to 10
points. The flash label says *why* a score dropped ("gap left in the loop",
"loop left open"). Round score = mean of the five boxes. Viewport resizes
rescale the geometry in place instead of swapping the box.

## Fair on the hardware beginners actually own

- **The loop may be drawn in several presses.** A full orbit of a desktop box
  is ~900px of travel and a trackpad's throw is about a third of that, so
  lifting to reposition is what the hardware *requires*. A press near where you
  lifted continues the same loop. Previously a lift ended the attempt and the
  half loop was scored with coverage as a straight multiplier: an honest
  trackpad attempt took ~22–28/100 and was labelled "gap in the orbit", i.e.
  told the fault was its arc.
- **An unfinished loop is never scored.** Below 75% coverage the drill says what
  happened — "you lifted at 55% of the loop, press near where you stopped and
  carry on, no penalty" — and distinguishes that from a loop drawn in the wrong
  place, which is a different sentence.
- **The tolerance has a pixel floor and is eased per input mode.** The fit score
  reaches zero at 18% of the box's mean radius *or 14px, whichever is larger*,
  times `ArtDaily.ease()` (pen 1x, finger 1.5x, mouse/trackpad 2x). The floor is
  what stops a small phone canvas demanding finer accuracy than a desktop for
  the identical drill; on a phone's slimmest box the old rule zeroed at 8.6px.
- **100 is reachable.** The first 9% of the tolerance is free, so a clean loop
  scores 100 instead of needing literal zero error.
- **A first-ever round never ends on a sliver.** Until there is a personal best
  the aspect ramp stops at 0.40 rather than 0.15, and box one is the round's
  biggest and roundest. Beginners need a first win; returning players get the
  full ramp back.
- Palm rejection (a pen outranks a touch, both directions), a minor-axis floor
  that follows the canvas, and iOS callout/selection defences on the canvas.

## Run it

No build step, no dependencies. Serve the repo root one level up, not this
folder — the SDK, the shared chrome and the font are all loaded from above
it, and a server rooted here would start the drill with none of them:

```sh
cd .. && python3 -m http.server 8080   # then http://localhost:8080/ellipses/
```

Part of [Art Daily](https://artdaily.sadeali.com/), the daily-practice arcade
from [sadeali.com](https://sadeali.com/).
