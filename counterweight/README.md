# Counterweight 🪶

> a small shape far out holds up a big one near the middle

A drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/). Zero
build step, zero dependencies, no trackers, no accounts.

A picture frame already holds one to three flat masses, all leaning it
one way. One more shape waits in the tray underneath: press inside the
frame where it belongs, drag to adjust, let go to place it. Four frames,
then a score.

A shape pulls on a picture by its **weight** — how big it is times how
strongly it reads against the paper — and by its **arm**, how far it
sits from the middle of the frame. Beginners count the first half and
never the second, so the counterweight goes in far too close to the
middle and the picture keeps leaning. Naming that habit is what the
round-end line is for. Nothing else in the arcade teaches the lever:
`crop-it` cuts a frame out of a scene and `focal-place` puts the subject
on a thirds anchor — both are about *where the subject goes*, and this
is about *what holds it up*.

## Scoring

Balance is a moment sum, so the answer is not a matter of taste:

```
Σ wᵢ(pᵢ − C) + w(p − C) = 0   ⟹   p = C − Σ wᵢ(pᵢ − C) / w
```

with `w = area × darkness` and `C` the middle of the frame. There is
exactly one spot that balances a given frame, `balanceSpot()` is that
solution, and the item generator runs the same pure function the score
uses — so the answer it validates is the answer it grades. Registered as
**`fit`**: the arithmetic is exact, but *visual weight* is a model of how
a picture reads, not a measurement of it.

The score is the distance from that spot against a zero-point of 26% of
the frame's width — the unit of a composition judgement is the picture,
not the screen — with a pixel floor under it from
`max(ArtDaily.ease(28), ArtDaily.startRadius(28))` so a hand's own noise
can never dominate on a small sheet. On a 600px sheet: 2% of the frame
width out is 92, 5% is 81, 10% is 62, 20% is 23, and a shape dropped
anywhere at random averages under 10.

## The reveal

After every frame: the shape ghosted where it belonged, ringed, your own
shape where you put it, the gap dashed between them, the dotted circle
where the score runs out — and the **lever**, a thin line from the spot
everything already in the picture pulls from, through the pivot, out to
the answer. The three are collinear by construction, so that line is the
arithmetic drawn. The dotted circle is named in words on the first reveal
of the sitting and the lever on the second; neither is mentioned again.

## Verifying

```sh
node --check js/game.js
```

The pure block (`PURE START` … `PURE END`) and the item generator lift
straight into node with no canvas — that is what the shift harness does:
perfect ≥ 95, garbage ≤ 30, monotonic in the error, every degenerate
input finite, 30k generated frames all playable, and the habit line
silent on scatter. The rest of the checklist is the game template's, and
the repo's `GAME_GUIDE.md` has the reasoning behind all of it.

Never edit `../sdk/artdaily-sdk.js` — it is the one canonical copy of the
protocol, loaded straight from the repo root, so there is no copy of it in
this folder to edit either. Everything above the
`game-specific styles below this line` marker in `css/style.css` is the
shared sheet, byte for byte, except the one `--game-accent` line.
