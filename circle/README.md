# Full Circle — draw one circle freehand, all the way round

A blank sheet. Draw a circle on it with one stroke — anywhere, any size — all
the way round to where you began, then lift. Six circles per round (~40
seconds). Your last two attempts stay faintly behind the new one, because
redrawing over your own last try is the studio warm-up the drill is built out
of.

The point of it is not the number. Every "draw a perfect circle" toy gives you
a percentage; none of them tells you **why**. This one draws the truest circle
through your line, marks where you strayed furthest from it, and says what
happened in ordinary words — *flat on the left*, *you close early, leaving a
gap at the top right*, *it drifts out as you come back round*.

## Scoring

Pure, closed-form geometry, in three steps. All of it lives in pure functions
at the top of `js/game.js` and lifts straight into node.

**0. Weight every sample by arc length.** A digitizer samples on a **clock** —
120–1000 Hz — so the number of samples in a stretch of line is proportional to
the *time* the hand spent there. Any plain `Σ` over samples is therefore a sum
over time, and this drill scores geometry: whipping through a flat spot put it
in the average a third as often as the arc beside it, and the same shape scored
higher for being drawn unevenly. Every average below is an integral along the
line instead, `(1/L)∫f ds`, discretised on the polyline through the samples:
node *i* carries `wᵢ = (ℓᵢ₋₁ + ℓᵢ)/2`, half the chord on each side, with the
ends of the stroke carrying only the one half-chord they have — and `Σwᵢ = L`
exactly, so dividing by it divides by the length of the line. A duplicate
sample has zero chord on both sides and does not vote; a stroke whose samples
are *all* coincident falls back to uniform weights, where the integral is not
defined. A **lift** — the drill lets a stroke that ran out of trackpad carry on
— gets no chord across it, in the weights, in `pathLength`, or in the drawn
polyline: the run from where you lifted to where you pressed again is not line
you drew.

**1. Fit a circle.** Kåsa's algebraic least-squares fit, derived in the comment
above `fitCircle()`. A circle is `(x−a)² + (y−b)² = r²`; substituting
`g = a²+b²−r²` makes the residual **linear** in `(a, b, g)`, so minimising the
weighted squared residual `Σwᵢfᵢ²` is an ordinary linear least-squares problem
with a closed-form answer — no iteration, nothing to fail to converge. The
weights are the arc-length ones above, and `n` becomes `W = Σwᵢ`; an unweighted
fit is pulled toward whichever arc the hand dawdled on. The points are centred on
their own centroid first, which turns the 3×3 normal equations into a 2×2
system and keeps the arithmetic away from the cancellation that eats precision
when the raw `x²` terms are ~10⁶. Degenerate input (fewer than 8 samples, a
straight line, a single dot, a NaN coordinate) returns `null` rather than a NaN
circle: the determinant is tested against `1e-9 × scale²`, which is scale-free,
so a tiny circle is never mistaken for a straight line.

Checked against an independently derived circumcentre through three of the
sampled points, over 500 random circles: worst disagreement **1.9e-13 of the
radius**.

**2. Roundness.** RMS of `|distance from the fitted centre − fitted radius|`,
in pixels, **along the line**. The RMS is the one reading whose integrand is
quadratic, and the node weights above are the trapezoid rule, which is exact
only for something linear. A polyline says `e` varies linearly along each
chord, and that integral is elementary — `∫₀^ℓ(eᵢ + (eᵢ₊₁−eᵢ)s/ℓ)² ds =
ℓ(eᵢ² + eᵢeᵢ₊₁ + eᵢ₊₁²)/3`, the trapezoid plus the cross term it drops — so the
RMS uses that and the *linear* readings (drift, sector means, the fit's
centroid) keep the node weights, where the trapezoid is exact. The two agree to
a rounding error on any stroke whose deviation moves smoothly between samples,
which is every real one; they part company exactly where `e` swings inside a
single chord, which is the under-sampled fast stroke and the one-sample spike.

Graded in a band that is a **plain fraction of the fitted radius**, with no
absolute pixel term in it — which is the whole of what makes a 50 px circle and
a 600 px one the same drill:

```
free  = 1.2% × r            <- still a flat 100
zero  = ease × 13% × r      <- roundness has run out
```

Both ends used to carry a pixel floor (`max(1.2%×r, 1px)` and
`ease×max(13%×r, 6px)`), and **a floor is a fraction in disguise**:
`max(k·r, F)` is exactly `k·max(r, F/k)`, so it grades every circle under `F/k`
as though it were bigger than it is. Those two floors put the break-even at 83
and 46 px of radius while the sheet accepts circles from 40 px up, so the whole
bottom of the reachable range was graded in a wider relative band than the top:
at `r = 40` the band was 2.50%/15.00% of the radius against a big circle's
1.20%/13.00%, and the identical relative wobble bought **+11.2 points at 5%
wobble, +12.0 at 8%, +13.0 at 12%** (mean of 25 seeds). What a floor is
actually for — a sub-pixel tolerance is a circle nobody can draw well enough to
score — is now the job of the **minimum radius** instead: refuse the circle you
cannot measure rather than grade it kindly. The clamp inside `band()` is pinned
to `MIN_RADIUS_PX`, so it can only ever apply to a circle that is being
refused, and every attempt that scores at all is graded in a band exactly
proportional to its own radius.

**3. Closure**, which is scored explicitly, because a stroke that stops
three-quarters of the way round is not a circle. Signed angular travel around
the fitted centre gives the turns covered.

* **Under 0.8 of a turn the stroke is not scored at all** — and not penalised
  either. The drill says how far you got and draws a dashed ring at the lift
  point; press inside it and the same circle carries on. A trackpad cannot
  always throw a whole circle in one go, and that is not a drawing mistake.
  (`lines` refuses a pull that stops short of B the same way.)
* Above that, the missing arc is converted to pixels and costs up to **45
  points**, free under `4% × r` and gone entirely at `ease × 75% × r` — the
  same pure fractions, for the same reason, so closing is size-invariant too. Running *past* your own start is the cheaper
  mistake — the line is closed, it just overlaps — so the first tenth of a turn
  of overlap is free and the rest counts at half weight.

Round score is the mean of the six.

**`ease` is `ArtDaily.ease()`** — 1.0 for a pen, 1.5 for a finger, 2.0 for a
mouse or trackpad. What this drill grades is *executing* a stroke, not *finding*
a target, so the zero-point is eased and deliberately **not** floored against
`startRadius()`: a wrist pivoting a mouse cannot creep the way a nib can. The
one acquisition in the drill — the ring you press inside to carry a lifted
stroke on — does use `startRadius(36)`, and is at least 60 px across on every
profile. No tolerance has an absolute pixel floor; **size appears in this drill
in exactly one place, as a refusal.** `MIN_RADIUS_PX` is 40 px of fitted
radius, and the sheet's own `minRadius()` is the same floor made
canvas-relative (10% of the short side, never under 40 px — about a 118 px
circle on a desktop sheet, 80 px on a phone). The sheet already refused
everything under 40, so raising `MIN_RADIUS_PX` from the 12 px it used to be
changes nothing a player can reach; what it buys is that the two agree, and
that the band's clamp sits where the scoring stops rather than somewhere
inside it. That number is kept low on purpose: it is the one rule that can
refuse a beginner's very first attempt.

### The numbers

Measured by lifting the pure functions into node:

```
perfect circle, r = 50 / 80 / 150 / 300 / 600   ->  100 on every profile
                    (r = 25 is refused, not scored — under MIN_RADIUS_PX)
scribbles (random walk, 40 seeds x 3 profiles)  ->  worst 0
a zig-zag across the sheet                      ->  0 / 0 / 0
monotonic: 25 wobble ramps x 3 profiles, plus both closure ramps — never rises
degenerate (null, [], 2 points, a dot, a line, NaN, 1e150, r=1e-9, 7 samples,
  duplicate points, numeric strings, reversed traversal)
  -> finite, 0..100, under every ease including 0, -1, NaN, Infinity, '2'

RMS wobble as a % of the radius, mean of 30 seeds at r = 150 (pen/finger/mouse)
   2%  ->  93 / 96 / 97      9%  ->  36 / 58 / 69
   3%  ->  85 / 90 / 93     15%  ->   0 / 28 / 47
   5%  ->  68 / 79 / 85     25%  ->   0 /  0 / 11

arc coverage, otherwise perfect (pen, r = 150)
   0.79 turns -> not scored, resumable      0.98 -> 95
   0.85 turns -> 55                         1.00 -> 100
   0.90 turns -> 63                         1.10 -> 100 (overlap is free)
   0.95 turns -> 83                         1.50 -> 55
```

The wobble ladder is generated as a sum of low harmonics — a hand's tremor runs
at 8–12 Hz against a digitizer's 120–1000, so a real stroke is heavily
oversampled and its deviation moves smoothly from sample to sample. Measured
against the count-weighted scoring this replaced, the top three rungs are
identical and the bottom three move by +2 / +3 / +6 points at most: a stroke
wild enough to swing inside one chord is the only kind the two ever disagree
about.

**Size.** The same shape scores the *same number* at every radius from 41 px to
900 px — scaled about its own fitted centre, mean over 25 seeds and worst
single-shape spread both **0.0000 points**, on either profile. The one residual
is the pixel grid: rounding every coordinate to a whole pixel, a shape scores
**0.85 points lower at r = 41 than at r = 313** at 5% wobble (0.61 at 8%, 0.41
at 12%), because a quantisation error of a fixed fraction of a pixel is a
bigger fraction of a small radius. That residual runs *against* the small
circle, so there is nothing to win by drawing small, and it cannot be removed
without pretending the digitizer is more precise than it is. `r = 40` itself
is the refusal boundary and a coin flip there, exactly as it was before.

**Speed.** One fixed path with a flat spot 9% of the radius deep, sampled at a
constant 120 Hz and drawn at different speeds:

```
                     even   2x through the flat   4x     8x     half speed
  arc-weighted       84.3          84.3           84.6   84.6      84.3
  (count-weighted)   84.0          86.5           89.8   92.6      83.2
```

The count-weighted row is what this replaced: it paid up to **+8.6 points** for
whipping through the flat spot, and it *punished* the drill's own advice — the
round-end line says to slow down through the stretch you go wrong in, and doing
so scored 83.2 against an even 84.0. The same path at 60 / 120 / 240 / 500 /
1000 Hz reads 84.1 / 84.3 / 84.2 / 84.1 / 84.1, so fixing the speed invariance
did not cost the digitizer-rate one. Holding still on a good part of the line moves the score by **0.0** when the samples are
pixel-identical — 50, 200, 600 or 2000 of them — where it used to be worth +3, +8, +14
and +18. That is the clean case, and not the whole story: a real pen resting on glass
jitters below the pixel, and a jittered sample carries a real chord, so a long pause still
buys some fake line — about +3.5 at ±0.25px of tremor and +7.7 at ±1px, against +7.8
before the weighting. Shrunk, not closed, and perverse in a new way, because a bigger
tremor now buys more. Closing it properly means dropping samples that advance less than
some fraction of a pixel; it matters the day scores are compared between people rather
than only against your own.

## The reveal

After every circle: your line in ink, the truest circle through it over the top
in the accent, a dotted band at `± zero` where the score runs out, a dot and a
dash at the point of widest drift, a dashed chord across the gap when there is
one, and the score in the middle of the circle. Both new marks are labelled on
the sheet the first time they appear — a dotted band nobody has seen before is
jargon that happens to be drawn instead of typed.

The sentence beside it names the miss, choosing between three stories by
comparing each error against the tolerance it is graded with: closure, a
systematic drift in the radius, or a local flat spot / bulge and where it sat.
The size word is graded off the **score itself**, so the words and the number
cannot disagree — 7,600 simulated attempts across three profiles, 0
disagreements.

The beat is **counted, not guessed** (`readingMs` × `revealBeat`, both pure):
8.4 s for the first reveal of the sitting, which is the only screen where
nothing is furniture yet, and 2.4 s after that, budgeted against the clause
that is actually new. Tap the sheet to skip ahead. The beat is parked while the
tab is hidden and handed back in full on return.

## The round's habit

Nearly everyone is flat in the same place, round after round, and which place
depends on the grip and on whether the circle is coming from the wrist or the
shoulder. At round end the drill names it — but only when it is really there.
Three things make that line honest:

* **Each attempt is centred on itself first.** A local dent drags the fitted
  circle toward it, so the rest of the circle reads as bulging outward — a
  phantom that fires in the wrong direction and names the side opposite the
  real flat spot. Subtracting each attempt's own mean removes it.
* **Contradiction, not majority**, exactly as `GAME_GUIDE.md` requires: it
  fires only when not one circle went the other way in that sector.
* **The lean is measured against the round's own scatter** (1.2×), not against
  a fixed fraction of the tolerance. A fixed fraction is device-dependent — the
  same physical habit clears it on a pen and misses on a trackpad, whose
  zero-point is twice as wide — and it gets *easier* the wilder the round is,
  which is the trap the arcade's bias line was rewritten for.

Measured over 3,000 simulated rounds per level: rounds with **no habit at all**
fire on **5.5–5.8%** whatever the wobble and whichever profile, against the
guide's 4–12% benchmark. Re-checked after the sector means moved to arc-length
weighting, over 800 rounds per level on a pen: no-habit rounds fire on
0.0 / 0.0 / 3.9 / 6.8% at 2 / 5 / 9 / 15% wobble against 0.0 / 0.1 / 6.1 / 6.1%
before, and rounds with a real habit on 100 / 100 / 100 / 99.9% against
100 / 100 / 100 / 98.1%. Rounds with a real flat spot fire on **33–80%** and
name that sector or one beside it **60–83%** of the time. A round too wild to
read anything from — scatter over half the zero-point — says nothing at all,
because the beginner spraying the sheet is exactly the one most likely to be
handed an invented lean.

A spiral gets its own line when it is the stronger reading: *every circle this
round opened out as it came back round*.

## The rest of the bar

`ev.button > 0` leaves first so a right-click never burns an attempt and the
context menu still opens; `preventDefault()` then runs for every press the
sheet sees, including the ones it ignores; `ArtDaily.isPalm(ev)` keeps a
resting wrist from stealing the stroke. Strokes are sampled at full rate
through `ArtDaily.samples(ev)` with the canvas measured **once per event**, and
painted once a frame through `requestAnimationFrame`. Inks are resolved once
per theme, not once per repaint. `pointercancel` and `lostpointercapture` end a
stroke as politely as `pointerup`; a lost release is recovered from the next
primary press of the same pointer type.

The sheet keeps **one aspect ratio at every width**, on purpose: a reveal that
survives a rotation has to be re-projected, and a re-projection is faithful
only when it is uniform — scale x and y differently and the fitted circle the
number was measured against redraws as an ellipse, which is the one shape this
drill is about. With the aspect pinned a resize is a single scale factor, and
because the score is a ratio, a scaled copy of a 71 is still a 71. Verified by
playing an attempt and then rotating 900 → 360 → 1100 px: the picture and the
printed sentence both stay put.

The canvas carries no `tabindex` — a freehand stroke needs a pointer, so a tab
stop there would be a focus ring on something the keyboard cannot operate.
Every control around it is keyboard-operable in reading order, the canvas's
`aria-label` is rewritten from `draw()` to describe what is actually painted,
and the hint line is the drill's one live region: read on its own, it still
says what to do and how the attempt went.

## Run it

No build step, no dependencies. Serve the repo root, not this folder: the SDK,
the page chrome and the font are loaded from `../`, and a server rooted here
puts them above its own root.

```sh
cd ..                 # the artdaily repo root
python3 -m http.server 8080
# then visit http://localhost:8080/circle/
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment — more at
[sadeali.com](https://sadeali.com/).
