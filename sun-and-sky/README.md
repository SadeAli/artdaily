# Sun & Sky 🌤️

The sun warms the light, the sky cools the shade.

A ball stands under a sky. Drag the rail until the ball's shadow side is
the colour that sky would make it, then press “paint it”. Four balls,
then a score.

A drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/) — zero
build step, zero dependencies, plain files.

## The lesson

Beginners paint a shadow as **the same colour, darker** — and the picture
goes dead. Outdoors there are two lights, not one: the sun, and the whole
sky. The sun makes the light side. The **sky fills the shadow side**, so a
shade is never a darker version of the local colour; it is the *sky's*
colour, filtered through the object's own. Blue sky, grey ball: a
blue-grey shade. Blue sky, ochre ball: a grey-green shade, which is the
step nobody takes on their own.

Nothing else in the arcade puts colour and light on a form together —
the seven colour drills are all flat swatches (mix it, sort it, spot the
neutral), and the value drills are grey. This is the one that joins them
up, and it is the same judgement a painter makes on every single shadow
they mix.

The drill never asks *which way* to go in the abstract: the sky is
painted right there, and the cast shadow on the ground is lit by that sky
**alone** — no sun reaches it. Read that patch, then imagine the same
light landing on the ball instead of the ground. That is the whole
technique, and it is the reason this is a judgement rather than a guess.

## Real light, not a flat guess

The ball is a real sphere — a lat/long grid of flat facets, each shaded
from its own outward normal, drawn back-to-front (for a sphere the facet
centre is its normal times a constant, so that ordering is a correct
painter's algorithm) and clipped to a circle so the silhouette stays
crisp at any devicePixelRatio.

Every colour on the sheet comes out of one function, composited in
**linear** RGB and encoded to sRGB exactly once, at the moment it becomes
a CSS string:

```
radiance = albedo ⊙ ( key · max(0, n·L)  +  fill · (0.5 + 0.5 · n.y) )
```

The first term is Lambert against a real light vector. The second is a
hemisphere sky fill: a surface facing straight up sees the whole sky, one
facing straight down sees none of it, and the shadow side of a ball sits
in between — which is *why* a shadow carries the sky and is not black.
The ground is that same function with the normal straight up; the cast
shadow is that same function with the key light removed.

The rail is not a two-colour gradient: it is that function sampled at
twenty temperatures on a point that really exists on the ball, so the
swatch under the handle is the colour the shade actually becomes.

Every fill light on the rail carries **exactly the same luminance**
(Rec.709), so dragging changes the sky's colour and never its strength —
otherwise the answer could be found by value, which is a different drill,
and the arcade already has five of those.

## Scoring

`tag: auto`. The answer is the scene's own fill temperature, so the
ground truth is correct by construction rather than curated.

- error = |your temperature − the sky's|, on a rail that runs −1 (deep
  blue) → 0 (colourless) → +1 (low amber).
- 100 for the exact colour, fading linearly to 0 at the zero-point.
- the zero-point is a **judgement** tolerance (0.62 of temperature) with
  only the *hand's* share run through `ArtDaily.ease()` — the whole rail
  is two units over several hundred pixels, so a hand that can hit a 44px
  target can hit any colour on it to a hundredth. A trackpad adds 0.08 of
  slack, a finger 0.04, a pen none. Underneath it there is a pixel floor
  for a sheet too narrow to give the rail room; on any ordinary canvas
  the judgement term wins, so the same shade scores the same on a phone
  and a desktop.
- the grab zone is `ArtDaily.startRadius(22)` — 44px across on a mouse,
  70 on a finger, 74 on a pen tablet — and the score never runs out
  inside it: the scoring window is 2.5×–15× the grab radius on every
  profile and width the drill can meet.

The pure functions live at the top of `js/game.js` and are hammered in
node: perfect ≥ 95 (a perfect round is exactly 100), garbage ≤ 30,
monotonic in the error, and every degenerate input — empty rounds, NaN,
Infinity, `null`, `[]`, a signed delta handed over as a magnitude —
comes back a finite 0–100 and a sentence with no "NaN" in it.

## The reveal

After **every** ball, not just at the end of the round:

- the same ball painted twice, side by side and the same size — *yours*
  and *the sky's* — because two colours can only be judged against each
  other;
- both settings marked on the rail with the gap between them drawn;
- the tolerance corridor over the rail, dotted, which is the scale the
  printed number is measured on (named in words the first time it is
  ever shown, and never again);
- the miss in words from the same five-rung ladder the round's
  correction spends: *a hair / a little / a good way / a long way too
  warm*.

At the end of the round, if the shades all leaned the same way, it says
so and how far to go the other way — that habit, not any one ball, is
the thing worth fixing.

## Accessibility

The canvas's accessible name is rewritten from `draw()`, so it always
says what is actually painted — which sky is up, what the ball's own
colour is, and what the rail is set to. That, plus arrow keys on the rail
(shift for bigger steps) and Enter to paint it, is a playable path with
the picture ignored. One live region only: the hint line. Marks drawn on
generated colour pick their ink from that colour's own luminance, so
every one of them clears 4.2:1 wherever it lands.

## Files

```
index.html              the sheet, HUD and how-to
js/game.js              the drill (pure scoring + light model at the top)
../sdk/artdaily-sdk.js  the repo's one copy, never edited from here
css/style.css           shared chrome; drill styles below the marker only
```
