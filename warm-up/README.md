# Warm Up — loosen the arm

The gentlest drill in [Art Daily](https://artdaily.sadeali.com/): three
25-second sets of pure motion, on any hardware you happen to own.

1. **loose circles** — fill the box with overlapping loops, speed over accuracy
2. **diagonal sweeps** — parallel diagonals corner to corner, don't slow down
3. **figure eights** — big lazy eights, keep the pen moving

The clock starts on your **first mark**, not on a countdown you have to
catch, and you may lift as often as you like: every stroke in a set is
accumulated. A trackpad cannot pull a long line in one contact, so
multi-segment strokes are the expected input here, not a compromise.

## Scoring

Deliberately effort-weighted — a warm-up you can fail is a warm-up nobody
comes back to:

```
setScore = 60 × clamp(distanceCovered / targetDistance, 0, 1) + 40 × quality
roundScore = mean of the three sets
```

`targetDistance` is 4 × the diagonal of the target box, so it scales with
the canvas: about 25 seconds of unhurried scribbling on any screen. The
live progress ring fills with **stroke distance**, never accuracy — the
visible reward is motion.

`quality` is a loose shape check worth 40 of the 100 points:

- **circles** — the fraction of detected loops whose radius spread
  (5th→95th percentile, over the loop's own mean radius) stays under the
  tolerance. Loops are found by walking the resampled path and closing one
  off every 90% of a turn accumulated — summing *between* headings loses
  one segment's worth of turn, so a whole clean circle drawn as a single
  stroke never quite reaches 2π.
- **sweeps** — angular consistency: the circular (axial) standard
  deviation of sweep directions, sampled over a fixed arc-length window
  and folded modulo 180° so a sweep and its return count as one axis.
  Full marks up to the tolerance, fading to zero at twice it.
- **eights** — simply that the ink crossed its own path: every
  self-intersection in the set is counted, including crossings between
  separate strokes, against "at least twice per figure".

There is no red pen anywhere. After each set the drill says how far your
hand travelled in metres, marks the **tightest and loosest** loop (for
interest, not judgement), draws the axis your sweeps settled on, or dots
every place you crossed yourself.

## Fair on the hardware you own

Every zero-point tolerance goes through `ArtDaily.ease()` and every
hardware-sized measurement through `ArtDaily.startRadius()`, so the same
honest scribble reads the same from a pen, a mouse and a finger — and the
HUD says which mode it eased for:

| measure | pen | mouse / trackpad | finger |
| --- | --- | --- | --- |
| loop radius spread allowed | 0.35 | 0.70 | 0.53 |
| sweep scatter allowed | 22° | 44° | 33° |
| crossings needed per figure | 2 | 1 | 1.3 |
| smallest mark counting as a loop | 15 px | 9 px | 14 px |
| arc a sweep direction is read over | 58 px | 34 px | 54 px |

Scores are only ever compared against your own history, so easing per mode
is fair. The whole canvas is live: there is no start dot to acquire, no
press is ever refused, and the press that starts a set is also its first
mark.

## Run it

No build step, no dependencies — but serve the **repo root**, not this
folder. The drill loads `../sdk/artdaily-sdk.js`, `../js/main.js` and the
font from above itself, so a server rooted here starts it with no SDK, no
chrome and no font:

```sh
cd ..                 # the artdaily repo root
python3 -m http.server 8080
# then visit http://localhost:8080/warm-up/
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment — more at
[sadeali.com](https://sadeali.com/).
