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

## The UX bar (learned the hard way, from a full-catalogue audit)

Non-negotiable for every drill:

- **The first screen teaches the verb.** Before anyone opens the how-to,
  the hint line plus the visible affordances must say what to do. If a
  player has to guess what the canvas wants, the drill has failed.
- **Nothing is punished for UI reasons.** Accidental taps and too-short
  strokes reset free. Misplacements are recoverable (undo / clear).
  A player never loses points to a control they misunderstood.
- **No dead states.** Trace: do nothing · press done immediately · draw
  during a reveal · resize mid-item · press "new round" mid-round. Every
  one must land somewhere sane, and a finished round must still report
  exactly once. **Store round geometry as fractions of the canvas, not
  pixels** — a phone rotated mid-round takes the canvas from 900px to
  390px, and anything remembered at x=826 is then off the canvas, can
  never be touched, and the round can never finish or report.
- **Reveal after every attempt**, not just at round end: the truth drawn
  over their attempt, in the accent, with the delta named in words.
- **Touch is the default input**: 44px targets, pointerId-guarded
  strokes, `touch-action: none` on the canvas.
- **Anything meaning-bearing painted on canvas must pass AA in both
  themes.** The watercolor accents are decorative-strength on paper —
  mix toward `--ink` (or define a `--canvas-accent` below the CSS
  marker) for marks that carry information.
- **Train the hand where a stroke beats a tap.** Prefer drawing as the
  input unless the lesson is genuinely a decomposition (three sliders
  for hue/saturation/lightness) or a judgement (spot the wrong figure).

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
ArtDaily.onInput(fn)      // hardware changed mid-session
```

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
  `getComputedStyle` inside `draw()`, not once at boot. The sketchbook
  is paper-first: light is the default theme, dark is the night studio.
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
