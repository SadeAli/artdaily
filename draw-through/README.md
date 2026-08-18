# Draw Through — three laps that land on each other

A ~40-second daily drill for the one instruction every beginner is given about
ellipses and no drill in the arcade ever checked: **go round it two or three
times without stopping**. Four dashed ellipses per round, each a real circle
turned further away from you than the last; press anywhere on one and draw
three laps in a single go. The loop scores itself the moment the third lap
lands.

The arcade already ships this pair for a straight stroke — **Steady Lines**
scores how close one stroke gets to a target, **Superimposed Lines** scores how
tightly four repeats of it agree. On the ellipse side only the first half
existed: **Ellipse Orbit** scores how well one loop hugs its plane. This is the
missing half. Accuracy and repeatability are different skills, and the second
one is what makes a hand-drawn ellipse look drawn rather than fought:

> Three confident laps of a slightly wrong ellipse beat three timid different
> ones.

So 75 of the 100 is how tightly your own three laps agree, and 25 is drawing
roughly the shape asked for — and the drill says so on its first screen and in
its how-to, rather than letting a player guess.

## How it is measured

All of it is pure geometry at the top of `js/game.js` (no canvas, no DOM, so it
lifts straight into node):

- **The guide is a real circle seen at an angle.** A circle tilted by τ and
  projected is exactly an ellipse with `ry = rx·cos τ`, so the shape asked for
  is correct by construction rather than a hand-picked squash. The round's ramp
  is an honest "turn the plate further away": ~31° · 46° · 57° · 64°.
- **The stroke is unwrapped into an angle** around the guide's centre —
  `atan2` deltas folded into (−π, π] and accumulated — so a lap is 2π of it and
  the drill can count laps while you are still drawing them. You may go round
  either way.
- **Every lap is resampled at the same 64 absolute directions.** That is what
  makes laps comparable: a fast lap and a slow one over the same curve give the
  same radii, so speed is never what is scored, geometry is. It also means the
  laps can be compared with a subtraction instead of a nearest-point search.
- **Agreement** is the mean spread of those radii (each lap's distance from the
  laps' own mean, averaged over the 64 directions). **Drift** is the last lap
  minus the first: positive is the spiral that grows, negative the one that
  tightens. **Fit** is the mean lap against the guide.
- A perfect input scores 100, a three-lap scribble under 30, and every
  degenerate input — no points, points on the centre, NaN, a zero-size guide, a
  stroke that never went round — comes back a finite 0–100 rather than NaN or a
  throw.

## Fair on the hardware beginners actually own

- **Lifting is free.** Three laps is a long way to drag and a trackpad simply
  runs out of room; a press near where you stopped continues the same loop, and
  a press somewhere else starts that loop over at no cost. The drill says this
  in the hint the first time you lift.
- **You may start anywhere on the ellipse.** There is no start dot to acquire —
  the laps are compared by direction, not by where the stroke began — which
  removes the one thing a screenless tablet finds hardest.
- **The tolerance is eased per device and floored.** Agreement reaches zero at
  `ArtDaily.ease(13)` scaled *weakly* by the guide's size (clamped to
  0.85–1.25×): a phone's ellipse is half a desktop's, and a fully relative
  tolerance would hand it half the room for the same hand tremor. Measured:
  27.3px on a trackpad, 20.5px on a finger, 13.7px on a pen, for a
  desktop-sized loop.
- **Nothing is punished for a UI reason.** A right-click, a second finger, a
  stray tap and a press during a reveal are all ignored rather than scored. A
  loop drawn beside the ellipse instead of around it is the one way to get
  stuck, so after a long stroke with no lap the hint says which.
- **A phone rotated mid-loop keeps the round finishable.** The stroke is stored
  as fractions of the canvas and the sheet keeps a fixed aspect, so the loop
  under the hand rescales intact and the lap count is recomputed rather than
  trusted.

## The reveal

Your three laps stay on the sheet exactly as you drew them, with the bold line
they average out to and a dotted corridor either side of it — that corridor is
where laps stop scoring, and it is named in words on the first reveal of the
sitting, on the one screen where it is new. The reveal is frozen in pixels
around a fractional centre, so a resize while you read it re-centres the picture
without ever changing the gap the printed number describes, and it carries its
own tolerance so plugging a pen in mid-reveal cannot redraw the scale under a
score that was measured on the old one.

Every mark clears 3:1 on both sheets, measured over the canvas's dot grid rather
than over bare card: guide 4.49 · your laps 3.92 · corridor 3.41 · mean lap 5.94
(light), and 4.69 · 5.27 · 3.83 · 5.23 (night studio).

## Words

One ladder of sizes (`sizeWord`) is spent by every sentence in the drill, cut
where the *score* changes character rather than at tidy fractions of the
tolerance: `Three laps, one line` · `A hair apart` · `A little apart, drifting
outward` · `Well apart` · `Way apart`. A tidy stack of the wrong ellipse gets a
clause of its own — *"Three laps, one line, but nothing like the ellipse on the
sheet"* — because otherwise the drill would dock 25 points in silence. At round
end, a drift that is both consistent and worth acting on becomes the correction
that outlives the round: *"Every loop grew as it went round — the last lap sat a
little outside the first, so ease the next one back in."*

The reveal's beat is measured from the sentence about to be printed
(`revealBeat`), not guessed: ~8.1s for the first reveal of a sitting, 2.1s
after. A hidden tab parks the beat and gets it back in full.

## Run it

No build step, no dependencies. Serve the repo root one level up, not this
folder — the SDK, the shared chrome and the font are all loaded from above
it, and a server rooted here would start the drill with none of them:

```sh
cd .. && python3 -m http.server 8080   # then http://localhost:8080/draw-through/
```

Part of [Art Daily](https://artdaily.sadeali.com/), the daily-practice arcade
from [sadeali.com](https://sadeali.com/).
