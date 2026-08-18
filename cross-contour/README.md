# Wrap the Form 🍥

> draw the line that wraps around the form

A drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/). Zero
build step, zero dependencies, no trackers, no accounts.

A solid stands on the sheet with one line already drawn around it. Draw
four more at other heights: press the dot on one edge, pull a single
curve across the form, finish on the ring at the other edge. Each
revealed truth stays on the paper, so by the fourth the form is wrapped
like a rope coil.

These are **cross-contour lines** — lines that ride over a surface
instead of across the picture, and the fastest way a drawing says "this
is round" without a drop of shading. The two mistakes the drill exists
to correct are drawing them straight (a cut, not a wrap) and bowing them
away from the viewer instead of toward.

## How it is scored — `tag: fit`

Nothing is eyeballed. The form is a real surface of revolution in 3D: a
real axis tilted in space, real circles around it, a real pinhole
camera, and the visible half of each circle found from the real surface
normal against the real view ray. Because that normal condition is a
plain sinusoid in the angle around the circle, the two silhouette points
and the whole visible arc come out in **closed form** — no root hunting,
and the reveal is exactly the curve the object makes.

One pure function, `judgeWrap(attempt, truth, tol)`, returns the number,
the fault and the sentence together, so the reveal can never print
"dead on" beside a 40:

| term | share | what it measures |
| --- | --- | --- |
| gap | 60 | mean two-way distance between your line and the true circle |
| bow | 40 | how deeply you curved it, against how deeply it really curves |
| coverage | ×  | how much of the wrap you actually crossed, edge to edge |

The two terms are eased differently on purpose. How steadily the hand
held the line is **hardware** — a trackpad wobbles where a pen does
not — so the gap term goes through `ArtDaily.ease()` at full strength.
How deeply the line was bowed is **intent**: no hardware makes you draw
a straight line across a barrel by accident, so easing that as
generously handed trackpad users a pass for drawing the wrong thing
accurately. A flat line across fails on every device; a wrap that really
is nearly straight (a slice seen almost edge-on) is forgiven, because
the bow tolerance is a fraction of the *real* curve with a pixel floor.

## Hardware

Start dot and finish ring are sized with `ArtDaily.startRadius()`; a
near-miss press is snapped onto the dot and told, never refused. A wrap
may be drawn in as many contacts as the hardware needs — a trackpad
cannot pull 300px in one go, so a press back near where you lifted
carries the same wrap on, and a press back on the dot starts it over.
Scoring tolerances come from `ArtDaily.ease()` off this drill's own base
constants, never from `startRadius()`'s output (the two knobs rank the
hardware in opposite orders — see `GAME_GUIDE.md`).

## Layout

```
index.html               the drill's page (HUD ids are protocol)
css/style.css            shared chrome; this drill's styles below the marker
js/game.js               the drill — pure geometry + scoring between the
                         PURE markers, canvas and DOM below them
../sdk/artdaily-sdk.js   the protocol, loaded from the repo's one copy —
                         no copy in here, nothing in here to edit
../js/main.js            shared chrome wiring, from the repo's copy too
```

## Verify

```sh
node --check js/game.js
# lift the PURE block into node (it needs no DOM at all):
#   perfect >= 95 · garbage <= 30 · monotonic · degenerate -> finite 0-100
#   plus: the analytic surface normal against a finite-difference one, and
#   the closed-form visible arc against a brute-force 4000-sample scan
cd .. && python3 -m http.server 8080    # the repo root, not this folder:
#   ../sdk, ../js and ../../fonts are all above it. then open
#   http://localhost:8080/cross-contour/ standalone, and the page embedded
```

Rotate the phone mid-round and mid-reveal: every wrap, the given line and
every revealed truth are stored in the projection's own units and mapped
to pixels at paint time, so a resize only re-fits.

## Registry entry

```js
{
  slug: 'cross-contour', name: 'Wrap the Form',
  tagline: 'draw the line that wraps around the form',
  icon: '🍥', accent: 'lilac', skills: ['contour', 'perspective'],
  cat: 'form', tag: 'fit', minutes: 3,
  status: 'live',
},
```

No `url`: the drill is the `cross-contour/` folder of this repo and the page
derives the address from the slug. Live entries still need a plain link —
`<a href="cross-contour/">` — in the `<noscript>` list in the repo's
`index.html`: two registrations, not one.
