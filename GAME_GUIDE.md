# Adding a game to Art Daily

Art Daily is an arcade of tiny art drills. The page (this repo) knows
nothing about any game except its `js/registry.js` entry; every game is
its own repo on its own URL. That's the whole architecture — page and
games only meet through an iframe and three postMessage types.

```
artdaily repo (this)              artdaily-<slug> repo (one per game)
┌──────────────────────┐          ┌──────────────────────────────┐
│ index.html  the page │  iframe  │ index.html   the drill       │
│ js/registry.js  ←────┼──────────┼→ js/game.js                  │
│ js/app.js   player,  │ ready /  │ js/artdaily-sdk.js (vendored │
│   streaks, meters    │ result / │   copy — never edited)       │
│ sdk/artdaily-sdk.js  │ theme    │ css/style.css tokens+chrome  │
│   (canonical copy)   │          │                              │
└──────────────────────┘          └──────────────────────────────┘
```

## The contract (protocol v1)

A game must:

1. Vendor `sdk/artdaily-sdk.js` unmodified as `js/artdaily-sdk.js`.
2. Call `ArtDaily.init({ slug: '<slug>' })` on load.
3. Call `ArtDaily.report(score)` — 0–100, rounded and clamped for you —
   **exactly once** every time a player *finishes* a drill, on every path
   that can finish one: the last item, a timer expiring, a self-rating,
   "new round" pressed during a reveal. Not on partial progress; streaks
   on the page are honest, earned by completing, not by visiting.
   It hands back what the drill needs to say something true about the
   round:

   ```js
   var res = ArtDaily.report(roundScore(attempts));
   // { score: 62,          the clamped, rounded 0–100 that was filed
   //   best: 62,           the standing personal best AFTER this round
   //   isNewBest: true,    this round beat it
   //   isFirst: true }     nothing had ever been recorded before
   ```

   `isFirst` exists because `isNewBest` is trivially true on it — see the
   first-thirty-seconds section below before you write that toast.
4. Repaint through `ArtDaily.onTheme(draw)` so embedded theme switches
   restyle the canvas.
5. Work standalone at its own URL (the SDK shows/hides the chrome).

The page in turn:

- embeds `<game url>?embed=1&theme=<current>` in the player dialog,
- answers the game's `ready` with the current theme and follows the
  toggle live,
- accepts `result` messages only from the game iframe it opened, clamps
  scores, and turns them into today's-warmup ticks, the daily streak
  and per-skill meters (all in this origin's localStorage).

## The first thirty seconds (the only thirty a beginner gives you)

Almost every drill that loses a player loses them here, and almost never
to a bug. Open your own drill cold, the way someone who has never drawn
before opens it, and answer four questions honestly:

1. **Does the first screen teach the verb?** The hint line plus what is
   visibly drawn, before anyone opens the how-to. Name the thing on the
   canvas in the words for the thing on the canvas: if what you drew is a
   dot in the middle of a ring, the hint says *tap the centre dot*, not
   *tap the bullseye*.
2. **Is the first item genuinely easy?** Not scored more kindly — an
   easier ITEM. Uniform-random placement will sooner or later open a
   round with the target jammed in a corner, and a beginner reads that as
   the drill being unfair before they have any idea what fair looks like
   here. Put item one in the middle, at the gentle end of whatever the
   drill ramps; the ramp belongs *inside* the round.
3. **Is any word jargon the drill does not teach on the spot?** Value,
   hue, ellipse degree, station point, ΔE, foreshortening — every one is
   fine to *use* and none is fine to *assume*. Either show it on the
   canvas in the same breath or use the ordinary word.
4. **Is the first reveal a lesson, or just a number?** A score with no
   correction attached teaches nothing: nobody can tell 58 from 72 by
   feel, and a bare number says nothing about which way to move. Draw the
   truth over the attempt, name the miss in words the player already
   owns — "a little high and left" beats "Δ 14.2 px" every time — and
   draw the *scale* it is measured against, or the picture still cannot be
   read (see the UX bar). Grade those words against the same tolerance the
   score uses, or the sentence and the number will contradict each other
   and the drill will read as broken.

The very first round of all needs its own copy. With no previous best,
`isNewBest` is trivially true, so an unguarded drill greets every new
player with **"new best!"** — a celebration of nothing, fired on the one
round where they most needed to be told what the number is *for*. Branch
on `report()`'s `isFirst`, say what the score is a bar for, and start
celebrating from round two.

The template's `js/game.js` implements all five; it is a five-tap demo
precisely so the pattern is readable.

## The UX bar (learned the hard way, from a full-catalogue audit)

Non-negotiable for every drill:

- **The first screen teaches the verb** — see above; it is the single
  most common way a finished, correct drill still fails.
- **Nothing is punished for UI reasons.** Accidental taps and too-short
  strokes reset free. Misplacements are recoverable (undo / clear).
  A player never loses points to a control they misunderstood.
- **No dead states.** Trace: do nothing · press done immediately · draw
  during a reveal · resize mid-item · press "new round" mid-round. Every
  one must land somewhere sane, and a finished round must still report
  exactly once. **Store round geometry as fractions of the canvas, not
  pixels** — a phone rotated mid-round takes the canvas from 900px to
  390px, and anything remembered at x=826 is then off the canvas, can
  never be touched, and the round can never finish or report. **A reveal
  is round geometry too**: the last one stays on screen until "new round"
  is pressed, so a phone rotated while the player reads it redraws the
  mark and the truth at stale pixels and teaches the wrong lesson.
  A reveal's *mark*, though, is not a fraction — it is **the offset that was
  scored**. Store both ends of a miss as fractions and they re-project onto
  the new canvas at different rates, because the truth is inset by the
  target's own radius and the mark is not: in the template a 26px miss
  (61 out of 100, "a little out") redrew as a 5px one — a 92, all but dead
  centre — after a landscape→portrait rotation, and as 32px going back the
  other way. The picture then argues with the number printed under it. Keep
  the target in fractions and the mark at `target + (dx, dy)`, clamped onto
  the sheet.
- **Reveal after every attempt**, not just at round end: the truth drawn
  over their attempt, in the accent, with the delta named in words. The
  *last* attempt of a round is an attempt like any other — do not let the
  round-end score wipe out its correction.
- **Draw the scale the score is measured on**, not only the miss. Truth +
  attempt + gap still leaves the number unreadable if nothing on screen
  says how big a gap is a big gap. The trap: the shape you drew to be
  *aimed at* is not that scale, and is not even proportional to it —
  `startRadius` and `ease` rank the hardware in opposite orders on purpose,
  so in the template a tap landing exactly on the drawn ring is **75 out of
  100 on a mouse and 16 on a pen tablet**. Draw the zero-point faintly in
  the reveal (a dotted ring, a tolerance corridor, the accepted colour
  band) so a mark can be read against it. Reveal only: during play it is
  just a second thing to aim at.
- **Name the round's habit, not only each attempt's.** Five misses that all
  go the same way are one mistake, not five, and it is the correction that
  outlives the round — per-item words fix the next attempt, a bias line
  fixes the next round. Hold it to the same bar as the scoring (pure,
  total, at the top of the file) and keep it **silent unless the lean is
  both consistent and worth acting on** — the template requires most
  attempts on the same side *and* a mean offset over ~10% of the tolerance,
  or it would invent a pattern out of noise. Say what to do, not just what
  happened: *"most taps landed low and right — aim high and left next
  round"*. Tie the count to the same side as the mean, or two wild misses
  one way outvote three small ones the other and the sentence points
  backwards.
- **If a reveal holds the screen, the drill must not score what lands on
  it.** A tap during the beat has nothing honest to be judged against —
  the next item is not drawn yet. Ignore it, never count it, and make the
  beat short enough (~0.6s) that nobody is waiting on it. Finish the last
  item *synchronously* instead of behind the beat, so `report()` can never
  be raced by "new round" landing during the reveal.
- **Touch is the default input**: 44px targets, pointerId-guarded
  strokes, `touch-action: none` on the canvas.
- **Anything meaning-bearing painted on canvas must clear 3:1 in both
  themes.** The watercolor accents are decorative-strength on paper —
  mix toward `--ink` (define a `--canvas-accent` below the CSS marker)
  for marks that carry information. Measured on the light sheet, the raw
  accents come in at **1.97 (sunny), 2.89 (mint), 2.95 (bubblegum), 3.06
  (coral), 3.18 (sky), 3.48 (lilac)** — so on paper the palette is mostly
  *below* the bar for a shape that carries information, and the two that
  scrape over it have no margin. `color-mix(in srgb, var(--game-accent)
  45%, var(--ink))` clears it for every accent, worst case 5.29. Full
  detail in the accessibility section.
- **Train the hand where a stroke beats a tap.** Prefer drawing as the
  input unless the lesson is genuinely a decomposition (three sliders
  for hue/saturation/lightness) or a judgement (spot the wrong figure).

## Playable without a mouse, readable without colour

A drill is a picture plus a sentence. Both have to survive a player who
cannot see the picture, cannot use a pointer, or cannot separate your
accent from the paper it is painted on. None of this is a retrofit — the
template already does all of it, and every rule below was written after
finding the opposite of it shipped.

**One spoken channel: the hint line.** `#hint` is `aria-live="polite"`
and carries the prompt *and* every reveal. Nothing else on the page may
be a live region. Two polite regions written in the same tick do not
merge — they queue, so the player hears the round's correction and then,
behind it, the same score again. The template's score toast used to be
`role="status"` saying `score 84 / 100` half a beat after the hint had
said *"Round done — 84 out of 100 (best 91). Most taps landed low and
right — aim high and left next round."* The toast is now
`aria-hidden="true"`: a sticker, not a second voice. If your drill wants
to say something the hint does not, put it **in the hint**.

**A focusable canvas must be an operable canvas.** `tabindex="0"` on a
`role="img"` canvas with no `keydown` handler is a tab stop that focuses
a picture and then does nothing — a focus ring on something the keyboard
cannot use, which reads as a broken control. The template's demo is
pointer-only, so its canvas carries **no** `tabindex`; screen readers
still reach it in browse mode, because that is what `role="img"` plus a
name is for. If your drill adds key handling, add the `tabindex` in the
same commit. Never one without the other.

**The canvas's accessible name IS the picture — so keep it current.** A
name set once in the HTML ("Lines drill area") describes a blank
rectangle for the whole session. `js/game.js` shows the pattern:
`describeSheet()` is called from `draw()`, so the name and the paint
always leave from the same place, and the write is guarded on "did the
sentence change" so a stroke drill repainting sixty times a second costs
one `setAttribute`, not sixty. A name is **not** a live region — it is
read when the player navigates onto the element, so it never competes
with the hint. Hold it to the same bar as the scoring functions: it runs
inside `draw()`, which runs inside the pointer handler, so a throw stops
the canvas painting and kills the round under the player's finger, and
whatever it builds gets **read out loud** — `NaN out of 100` is worse
than saying nothing. (Watch `isFinite(null)`, which is `true`.)

**Decorative glyphs get `aria-hidden`.** `→ ✓ ↻ · ♥ $` are read as
"rightwards arrow", "check mark", "clockwise open circle arrow". The
SDK's standalone hand-off link is the one that mattered: its accessible
name — what a links-list announces out of context — ended *"add it to my
Art Daily record rightwards arrow"*. Wrap the glyph in an
`aria-hidden="true"` span and leave the sentence clean.

**Do not destroy a control to update the text around it.** Removing a
focused element drops focus to `<body>`. The hand-off bar rebuilt its
whole contents every round, so a keyboard player who had tabbed onto
"add it to my record" lost their place the moment the next round ended.
The bar now reuses the link node and replaces only the sentence in front
of it — and nothing is lost by that, because `role="status"` implies
`aria-atomic`, so the region is re-announced in full either way.

**3:1 for every mark that carries information, on both sheets.** See the
UX bar for the palette numbers. Two traps beyond the raw accent:

- *"Faint" is a look, not a licence to be unreadable.* The reveal's
  dotted zero-ring — the scale the printed number is measured on, the
  thing the how-to tells the player to read their mark against — was
  drawn at `globalAlpha = 0.4`, which composites `--muted` to **1.74:1**
  on paper and **2.02:1** in the night studio. It is now `0.85`: 3.82:1
  on the card, and still 3.30:1 over the darkest dot of the grid it
  crosses. Alpha is contrast; budget for it.
- *Measure against what is actually behind the mark*, which on a drill
  canvas is `--card` **plus the dot grid** (`--ink` at 8%), not the
  swatch in your head.

Check a colour before you commit it — no dependencies:

```sh
node -e "const L=h=>{h=h.replace('#','');const s=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)
.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*s[0]+.7152*s[1]+.0722*s[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};
console.log('light',cr('#56A382','#FDFAF1'),' dark',cr('#5FBF97','#221D16'))"
```

**Focus must stay visible, and land somewhere sensible.** The shared
sheet gives every link, button and `[tabindex]` a 3px `--focus` outline
at 3.92:1 on paper and 6.56:1 in the night studio — do not switch it off,
do not wrap a control in `overflow: hidden` that clips it, and keep the
DOM order the reading order (the SDK inserts the hand-off bar directly
after `.game-controls` for exactly that reason). Anything you toggle
open needs `aria-expanded` + `aria-controls` on the button that toggles
it, as `#btnHow` does.

**Reduced motion, again.** The stylesheet flattens CSS animation and
transition; it cannot reach a canvas tween or a `setInterval`. See the
performance section — and never put information *only* in motion.

**Touch targets come from `startRadius`, not from a hand-rolled floor.**
Any base from 22 up clears 44px on every profile; the numbers are in the
hardware section.

Before you ship, tab through the drill with the mouse in your other hand:
every stop should be a control you can then operate with the keyboard,
in the order you would read the page, with a ring you can see on **both**
sheets. Then play a round with the screen readable but the canvas
ignored — the hint line alone should still tell you what to do and how
you did.

## The hardware people actually own (read this before you set a tolerance)

Most beginners are not on a pen display. They are on a **laptop
trackpad**, a **mouse**, a **cheap screenless tablet**, an **iPad**
(pencil or bare finger), or a **phone**. The same stroke means very
different things across those:

- a **mouse** pivots at the wrist and cannot creep — arcs are hard,
  clicking a small target is easy
- a **trackpad** has a short throw, so a long stroke *physically
  requires* lifting and re-placing: any "one continuous stroke" rule
  fails it silently
- a **screenless tablet** maps absolutely with the hand out of sight —
  long sweeps are its strength, small start targets its nightmare
- a **finger** occludes the very thing it is drawing

The SDK does the adapting; use it instead of raw constants:

```js
ArtDaily.inputMode()      // 'pen' | 'mouse' | 'touch', auto-detected
ArtDaily.inputLabel()     // 'mouse or trackpad' — what the HUD chip says
ArtDaily.ease(0.055)      // widen the zero-point: pen 1.0, mouse 2.0, touch 1.5
ArtDaily.startRadius(28)  // widen a start zone: pen 1.7, touch 1.6, mouse 1.0
ArtDaily.samples(ev)      // every position a pointermove carried, oldest first
ArtDaily.onInput(fn)      // hardware changed mid-session
```

Both are total: `NaN`, `Infinity`, a negative or a **sub-pixel** base all
come back usable. The tiny base matters more than it sounds — a zone sized
off the canvas (`startRadius(Math.min(W, H) * 0.05)`) is computed once at
boot, before layout, and a one-pixel target is every bit as dead a round as
a `NaN` one. Guarding only an exact zero was not enough: a canvas floors its
own measured width at 1px (`Math.max(1, rect.width)` is the standard shape),
so the base arrives as `0.05`, not as a clean `0`, and used to come back as a
1px target. `startRadius` now treats **any base under 1px** as missing and
falls back to its 28px default; `ease` falls back to 1. Both also check the
number *after* the profile factor lands, because a large-but-finite base
overflows to `Infinity` on the multiply — and an infinite zero-point makes
`1 - err/zero` exactly 1, so every attempt, however wild, scores a fake 100.
Neither ever returns a value you cannot draw or divide by.

**The numbers, so you never hand-roll a touch floor.** `startRadius(22)` is
44px across on a mouse, 70 on a finger, 74 on a pen tablet; `startRadius(26)`
is 52 / 84 / 88. Any base from 22 up already clears the 44px touch minimum on
every profile, so a drill needs no coarse-pointer floor of its own — and
`(pointer: coarse)` is the wrong query for one in any case. It asks whether
the *primary* pointer is coarse, so it is **false** on a touchscreen laptop,
the one machine where a finger meets mouse-sized zones. `(any-pointer:
coarse)` is the question you meant.

**The two knobs measure different things — never feed one into the other.**
`startRadius` sizes what the player *aims at*; `ease` sizes where the
*score* reaches zero. They deliberately rank the hardware in opposite
orders (a pen gets the biggest target and the strictest scoring), so
`ease(startRadius(r) * 2)` compounds them and inverts the result — it
scored a finger *more* generously than a trackpad. Always ease your own
base constant: `startRadius(BASE)` to draw, `ease(BASE * 2)` to score.

A profile switch never lands mid-press: the SDK detects the hardware on
`pointerdown` but queues the change until the release, so `onInput` can
rebuild geometry freely without the target moving under a live stroke,
and a stroke is always scored under the same `ease` it was drawn under.
That holds even for a stroke that *pauses* — a held-still nib emits no
move events at all, so the gesture goes idle without ending, and the palm
landing next used to force the queued switch through under the live hand
(a `mouse`→`pen` switch jumped the start dot 28px → 48px and halved the
zero-point mid-stroke). The queue now waits for a release it actually
saw. What a drill must still do is treat `onInput` as *"resize the
geometry"*, never as *"re-judge what is already on screen"* — see the
reveal note under performance.

Rules that follow from this:

- **Ease every zero-point tolerance.** Before this existed, a mouse user
  drawing a 300px line with a realistic 15px wobble scored **9/100**.
  That is the whole retention problem in one number.
- **Snap, don't refuse.** If a press lands near a start dot, move the
  stroke onto the dot. Refusing a near-miss reads as a broken site to
  someone who cannot see their own hand.
- **Accept lifted strokes.** A press that resumes near the last lift
  point continues the same attempt.
- **Put a pixel floor under relative tolerances**, or a phone gets a
  stricter standard than a desktop for the identical drill.
- **Keep `<dd id="inputMode">` in the HUD.** The SDK fills it with
  "scoring for mouse or trackpad" — we ease the score, so we say so.

## Performance, or: the hand has to feel listened to

A drill is one loop — hand moves, screen answers. Latency and lost samples
do not read to a beginner as "this page is slow", they read as *"I cannot
draw"*, which is the thing they were already afraid of. All the numbers
below are measured on the template, before and after.

**Sample at the digitizer's rate; paint at the display's.** These are two
different rates and conflating them costs you one or the other:

- A browser dispatches at most one `pointermove` per frame, but the pen
  samples at 120–1000Hz and hands the frame's whole run of positions over
  on that single event. Read only the event and the rest are thrown away:
  the corner of a fast flick vanishes and a drill that scores geometry
  scores a straight line the player did not draw. That is a *fidelity* bug
  that surfaces as a *fairness* bug — fast confident strokes score worse
  than slow timid ones, the exact opposite of what a drawing drill should
  be teaching. Use `ArtDaily.samples(ev)`: always an array, oldest first,
  `[ev]` where coalescing is unavailable, never a throw.
- Repaint **at most once per frame** — `if (rafId === null) rafId =
  requestAnimationFrame(…)`. A repaint per sample is several full-canvas
  washes inside one frame with all but the last thrown away, and every one
  of them is main-thread time the next sample is queued behind.
- The one exception is the press that just landed. A tap whose own mark
  waits a frame reads as a dropped tap; paint that one inline.

**Never resolve style inside the loop.** `getPropertyValue()` on a computed
style cannot answer until style has been resolved, and `draw()` is
normally called immediately after the hint line's text changed — so every
repaint flushed a style recalculation to fetch four values that only ever
move when the theme does. Cache them per theme and drop the cache in
`onTheme` (never cache an empty read: on a cold boot the stylesheet may
not be parsed yet). One round of five taps in the template: **10
`getComputedStyle` calls and 40 property reads → 0.**

**Coalesce resize.** `window.resize` and `ResizeObserver` both fire in
bursts for one drag, and every fit that really changes size reallocates
the canvas backing store *and* clears it. Measure and repaint at most once
a frame, and only when the size actually moved (a phone's URL bar fires
resize constantly at an unchanged width). One 40-event drag in the
template: **40 measurements / 40 reallocations / 40 repaints → 1 / 1 / 1.**

**A reveal's scale is history, like its mark.** Store the zero-point *with*
the reveal and draw that, never `ease()` again. `ease()` answers for the
hardware in use *now*, and the hardware can change while the reveal is on
screen: plugging a pen in at the end of a round fires `onInput`, the drill
repaints, and the dotted ring redraws at half its radius under a printed
"66 out of 100" — 88px → 44px in the template, the picture arguing with
the number, exactly like re-projecting the mark. The number is history and
so is the scale it was measured against.

**One owner per timer.** A reveal beat, a countdown and a toast all
outlive the frame that started them, so every path that ends a round must
clear the ones it is ending — `newRound` cancels the abandoned round's
queued advance, `finishRound` cancels its own. Two timers racing to call
`report()` is how a round gets filed twice.

**Reduced motion is not only a CSS problem.** The shared stylesheet
flattens every animation and transition under `prefers-reduced-motion`,
but it cannot reach a canvas tween or a `setInterval` you wrote. Check
`matchMedia('(prefers-reduced-motion: reduce)')` yourself before animating
from JS, and never put information *only* in motion — a pulse that a
reduced-motion player never sees has to be a word or a mark as well.

## Real 3D, not flat guesses

If a drill reasons about space or light, build the real model: a proper
pinhole projection, real light vectors against real surface normals,
real circles projected onto real planes. The ground truth is then
correct by construction and the reveal is convincing rather than
approximately right. Keep the scoring functions pure so they can be
unit-tested against an independently derived case.

## Scoring functions: pure, total, monotonic

Keep them as **pure functions at the top of `js/game.js`** — no canvas, no
DOM, no state — so they lift straight into node. Every one must hold:

- **finite 0–100 for any input.** Empty arrays, zero sizes, `NaN`,
  collinear points, a zero-length reference stroke. Never `NaN`, never a
  throw. `NaN` loses every comparison it touches, so one leak makes the
  whole round score `NaN` in silence, and `report()` files it as a bare 0
  the player cannot explain. Guard divisors with `isFinite(x) && x > 0`.
- **monotonic in the error.** More wrong can never score higher.
- **a perfect input ≥ 95, garbage ≤ 30, and 100 reachable.**

The function that turns an error into the reveal's *words* belongs up here
too, and is held to the same bar: total for any input, monotonic in the
same error, and graded against the same tolerance the score uses. Split
them and you eventually print "dead centre" beside a 40.

Grading against the right number is not enough — **cut the adjective bands
where the SCORE changes character**, not at tidy fractions of the tolerance.
The words sit beside the number in the same sentence, so a ladder skewed
toward the good end lies quietly: the template graded correctly and still
printed *"A hair low — 71 out of 100"*, and a beginner told they were a hair
off stops correcting. Its bands are now named in score terms — 92+ dead
centre, 75+ a hair, 50+ a little, 20+ well, under 20 way out — and a test
walks the whole error range asserting the two never disagree at the ends
(no "dead centre" under 90, no score of 0 without "way out").

`report()` is the last line of defence, not the first: it clamps to 0–100
and turns anything non-finite into **0** — a divide-by-zero used to clamp
*upward* to a fake perfect 100 and write it to the permanent best.

Re-verify after any scoring change:

```sh
node --check js/game.js
# then lift the pure functions into node and hammer them:
#   perfect >= 95 · garbage <= 30 · monotonic · degenerate -> finite 0-100
```

## Drill design rules

- **30–60 second rounds.** It's a daily warmup, not a session. Report a
  score per round so one coffee-break visit still counts.
- **Score generously at the bottom, stingily at the top.** 40 should be
  easy, 90 should feel earned. A score of 100 must be possible.
- **One canvas, one verb.** Draw / tap / drag — no menus, no levels
  screen. Difficulty may ramp *within* a round.
- **Honest scoring.** Score the geometry (deviation, ΔE, angle error),
  never time-on-page.
- **Zero build, no trackers.** Plain files, no analytics, no accounts.
  Self-contained is the default (scenes are drawn procedurally on canvas,
  which also hands you exact ground truth for scoring) — external
  resources aren't banned, but you almost never need one.
- **Theme-aware inks.** Read `--ink` / `--muted` / `--game-accent` via
  `getComputedStyle`, keyed on the theme rather than frozen at boot — the
  values move when `data-theme` moves and at no other time, so read them
  once *per theme*, not once per repaint (see the performance section).
  The sketchbook is paper-first: light is the default theme, dark is the
  night studio.
- **Touch is first-class.** Pointer events + `touch-action: none` on
  the canvas (the template does this); targets ≥ 40px.

## Skills

Tag each game with 1–2 skills from `ARTDAILY_SKILLS` in
`js/registry.js` (primary first): line, ellipses, shapes, symmetry,
perspective, colors, values, contour. Add a new skill there first if
none fits — the filter chips, skill meters and the daily-warmup spread
all derive from that table.

## Ship it

The step-by-step checklist (copy template → rename → build → verify →
repo → Pages → registry entry) lives in the game template's README:
`../artdaily-games/game-template/` in the workspace.

**Two registrations, not one.** A registry entry alone leaves the drill
invisible with JavaScript disabled. Every `status: 'live'` entry also
needs its `url` in the `<noscript>` plain-link list in `index.html`.
Check before pushing — three drills once shipped half-listed this way:

```sh
node -e "const fs=require('fs'),vm=require('vm'),c={window:{}};vm.createContext(c);
vm.runInContext(fs.readFileSync('js/registry.js','utf8'),c);
const h=fs.readFileSync('index.html','utf8');
const m=c.window.ARTDAILY_GAMES.filter(g=>g.status==='live'&&h.indexOf(g.url)<0);
console.log(m.length?'MISSING from <noscript>: '+m.map(g=>g.slug):'noscript list complete');"
```

## Versioning

The SDK carries `version: 1` in every message. If the protocol ever
changes, bump `VERSION` in `sdk/artdaily-sdk.js`, keep the page
accepting older versions, and recopy the SDK into games as they update
— never fork it per-game.
