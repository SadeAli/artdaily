# Down the Row 🪵

> the gaps close up — draw the next post

A drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/). Zero
build step, zero dependencies, no trackers, no accounts.

A fence runs away from you and two of its posts are drawn. Draw the
next: press at its foot, pull up to its top. Four fences, then a score.

The posts are evenly spaced in the **world** and never in the
**picture** — each gap is smaller than the one before it and each post
shorter — so "the same gap again, the same height again" is the one
answer that is always wrong. It is also the answer nearly everyone
draws, and the reason a beginner's street, corridor, fence or row of
windows reads as flat no matter how carefully the boxes were built. No
other drill in the arcade asks for the *rhythm* of a repeat in depth:
`perspective` and `vp-hunt` aim edges at a vanishing point,
`horizon-read` reads the eye level off a row, `even-spacing` divides a
flat interval. This one asks where the next thing goes.

## How it is scored — `tag: auto`

Nothing is eyeballed. Each scene is a real level pinhole: eye height 1,
ground at Y = −1, posts of equal world height standing at
X = x₀ + i·a, Z = 1 + i·g, every vertex divided by its own depth. The
fit that drops the projection onto the sheet is a uniform scale plus an
offset — which is only a different focal length and principal point — so
the picture stays a picture a real lens could have taken and the third
post is exact by construction.

Two numbers, one tolerance:

| term | share | what it measures |
| --- | --- | --- |
| foot | ½ | distance from your foot to the true foot |
| top | ½ | distance from your top to the true top |

Misplacing the foot carries the top with it, so placement is counted
twice and height once — which is the right weighting: the spacing is the
lesson and the height is its consequence.

The zero-point is **three fifths of the gap the answer sits at**, eased
per hardware, held between 3% and 13% of the sheet's width (floor: a
phone must never be asked for work no finger can do; ceiling: the scale
has to be drawable on the sheet it is measured on). A fixed pixel
tolerance would quietly hold the gentle items to a stricter standard
than the hard ones. On a trackpad that lands the score at zero about one
whole gap out, which is the ladder the drill wants:

```
foot   0% of a gap out -> 100   "Dead on"
foot  20% of a gap out ->  83   "A hair too wide"
foot  50% of a gap out ->  58   "A little too wide"
foot  78% of a gap out ->  35   "Much too wide"      (half-corrected)
foot 156% of a gap out ->   0   "Way too wide"       (same gap again)
```

Scene generation refuses any row whose gap ratio is above 0.52, because
above that the row barely recedes and the mistake the drill exists to
correct would collect a passing mark.

The words come from the **score**, not from a second tolerance of their
own, so the sentence and the number can never contradict each other. At
round end a pure `roundBias` names the round's habit if the misses
leaned one way — that is the correction that outlives the round.

## Hardware

Tolerances go through `ArtDaily.ease()` off this drill's own base
constant; the minimum stroke length that counts as a post rather than a
stray press goes through `ArtDaily.startRadius()`, capped so a genuinely
short far post is never refused as an accident. A post may be drawn
upward or downward — the lower end is the foot. The stroke is captured
by pointer id, a second finger cannot start a second post, a
right-click is ignored, and a press that lands while a reveal holds the
screen is ignored rather than scored.

## Layout

```
index.html            the drill's page (HUD ids are protocol)
css/style.css         shared chrome; this drill's styles below the marker
js/game.js            the drill — camera, scoring and prose between the
                      PURE markers, canvas and DOM below them
```

Everything else `index.html` pulls in — `../sdk/artdaily-sdk.js` (the
protocol), `../js/support-config.js` and `../js/main.js` (the shared chrome
wiring), `../../fonts/caveat-latin.woff2` — is the repo's own single copy,
loaded from above this folder rather than vendored into it. NEVER edit
those from here: one file now serves every drill.

## Verify

```sh
node --check js/game.js
# lift the PURE block into node (it needs no DOM at all):
#   perfect >= 95 · garbage <= 30 · monotonic · degenerate -> finite 0-100
#   plus two independent checks on the camera, neither of which
#   buildScene knows anything about:
#     · the diagonal method — a line from post 1's top through post 2's
#       waist must hit post 3's foot exactly (it does, to 0.000000px)
#     · the feet line and the tops line must meet exactly on the eye level
cd .. && python3 -m http.server 8080
#   serve the REPO ROOT, not this folder — the SDK, the chrome and the
#   font are all loaded from above it, so a server rooted here starts the
#   drill with none of the three. Then http://localhost:8080/down-the-row/
#   to play it standalone, and http://localhost:8080/ to play it embedded
```

Rotate the phone mid-round and mid-reveal: the scene is stored as canvas
fractions and the aspect is fixed, so a resize is a uniform scale; the
reveal's mark is the pixel **offset** that was scored and its zero-point
travels with it, so the gap on screen always matches the number printed
under it.

## Registry entry

```js
{
  slug: 'down-the-row', name: 'Down the Row',
  tagline: 'the gaps close up — draw the next post',
  icon: '🪵', accent: 'mint', skills: ['perspective', 'line'],
  cat: 'form', tag: 'auto', minutes: 3,
  status: 'live',
},
```

No `url` and no `dev`: the slug is also the folder the drill is served
from, so the page derives `down-the-row/` from it and one relative path
covers file://, localhost and the live site alike.

Live entries still need a plain link of their own in the `<noscript>` list
in the repo root's `index.html` — `<a href="down-the-row/">Down the
Row</a>` — two registrations, not one.
