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
3. Call `ArtDaily.report(score)` — an integer 0–100 — every time a
   player *finishes* a drill (not on partial progress; streaks on the
   page are honest: earned by completing, not by visiting).
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

## Versioning

The SDK carries `version: 1` in every message. If the protocol ever
changes, bump `VERSION` in `sdk/artdaily-sdk.js`, keep the page
accepting older versions, and recopy the SDK into games as they update
— never fork it per-game.
