# Art Daily game starter

Copy this folder to start a new drill for [artdaily.sadeali.com](https://artdaily.sadeali.com/).
Zero build step, zero dependencies. It ships as a *working* demo game
(tap-the-centre-dot, with a reveal after every tap) — replace the drill,
keep the skeleton.

Design + protocol details live in the artdaily repo's `GAME_GUIDE.md`;
this file is just the checklist.

## Launch checklist

1. **Copy** this folder to `../<slug>/`. Every drill is a folder in this
   repo, served at `https://artdaily.sadeali.com/<slug>/` — no second repo,
   no cross-origin anything.
2. **Rename**: grep-replace `GAME_NAME`, `GAME_TAGLINE` and `game-slug`
   (title/meta/canonical, term-bar, HUD, `man` line, and `SLUG` in
   `js/game.js`). Pick the emoji favicon and `--game-accent` in
   `css/style.css` (use the accent you'll give its registry card).
3. **Build the drill** in `js/game.js`: one canvas, rounds of ~30–60
   seconds, every finished drill ends in `ArtDaily.report(score0to100)`.
   Never edit `../sdk/artdaily-sdk.js` — it is the one copy of the
   protocol every drill loads, so an edit there lands in all of them.
4. **Verify**: `node --check js/game.js`, then, one level up,
   `python3 -m http.server 8080` — serve the **repo root**, never your own
   folder: the SDK, the shared chrome and the font all live above it, and
   a server rooted in the drill starts it with none of the three. Play it
   standalone at `http://localhost:8080/<slug>/`, then embedded from the
   page at `http://localhost:8080/` — same origin, same server, no dev
   path to point anywhere. Check dark + light, mobile width, touch — and
   **rotate the phone mid-round**, which must not lose the round. Then **tab
   through it**: every stop a control you can operate, in reading order,
   focus ring visible on both sheets. Lift the pure scoring functions into
   node and check the four cases the guide names: perfect ≥ 95, garbage
   ≤ 30, monotonic, degenerate → finite 0–100. Then **land one attempt
   perfectly and confirm it scores 100** — near a corner of the sheet, not
   in the middle, which is the one spot where a border-box coordinate
   mistake hides.
5. **Ship it**: there is no repo to create and no Pages switch to flip —
   the folder rides along with artdaily's own deploy, and pushing `main`
   puts it live at `https://artdaily.sadeali.com/<slug>/`. Add that URL to
   `sitemap.xml` while you are there. (This template stays out of the
   sitemap and carries `<meta name="robots" content="noindex">`; delete
   that line from your copy.)
6. **Register it**: add one entry to `js/registry.js` in the repo root
   (slug, name, tagline, icon, accent, skills, minutes, plus `cat` for its
   chapter and `tag` for how it's scored). The slug is also the folder, so
   the entry needs no URL — the page derives `<slug>/` from it. Push — the
   Art Daily page now lists, embeds and scores your game.

## Before you call it done

The bar every shipped drill is held to (the long version, with the
reasoning, is in the artdaily repo's `GAME_GUIDE.md`):

Open it cold, the way a beginner does, and answer the four
first-thirty-seconds questions before anything else:

- does the **first screen teach the verb** — hint line + visible
  affordances, before anyone opens the how-to — **and say how it marks
  you**? One clause, opening screen only: nothing on a bare ring says
  whether a near miss is worth 90 or nothing at all
- is the **first item genuinely easy** (an easier item, not kinder
  scoring — random placement will eventually open a round in a corner)?
- is any **word jargon** the drill does not teach on the spot — including
  **jargon you drew** rather than typed, like a dotted ring the score is
  measured on that nothing on screen ever names?
- is the **first reveal a lesson or just a number**, and does it **stay up
  long enough to read**? Budget the beat against the text that is new on
  that screen at ~200 wpm — and *count the words*, do not estimate them:
  the demo's beat was 620ms for a clause needing 1800ms, and then 4000ms
  for a first reveal needing 6300ms. It measures the line it is about to
  print now (`readingMs`). And does round one say what the score is *for*,
  instead of "new best!" — which is trivially true on it, so branch on
  `report().isFirst`
- does everything you teach **once** survive a press of the primary
  button? "First of the sitting" and "round 1, item 1" are the same screen
  only until a beginner presses *new round* before their first tap, which
  is the likeliest thing they do with a control they do not understand
  yet. Hang the long beat, the one-off ring note and the opening scoring
  clause off a counter `newRound` does not reset (`revealsSeen`), never off
  `round === 1` — keyed on the round, one press cost all three at once

Then the rest of the bar:

- **nothing is punished for UI reasons**: stray taps and too-short
  strokes reset free, misplacements are undoable, a tap that lands
  while a reveal holds the screen is ignored rather than scored, and a
  press that does not mean "here" — right-click, middle-click, a pen's
  barrel button — is ignored too (`if (ev.button > 0) return;`, which
  costs a finger and a pen tip nothing since both report `button` 0)
- **a palm is not an attempt** — `if (ArtDaily.isPalm(ev)) return;`. The
  heel of the hand lands before the nib, so first-contact-wins burns the
  item on a contact nobody made and the pen arrives to find the reveal
  already up. The SDK owns the test because it is the only thing that sees
  a nib *hovering*, from a capture-phase `window` listener; a guard fed by
  your own canvas events goes blind exactly when the palm is still down. A
  finger-only player is never once tested against a pen
- **the ignored presses still get `preventDefault()`** — a canvas is never
  a text surface, and the presses a drill ignores are the ones a beginner
  makes most. Cancelling below the state guards leaves a poke during the
  1.8s reveal (6.3s on the first) dragging a text selection over the hint
  line, or popping an iOS callout across the picture the beat exists to
  let them read. Order is: `button > 0` out first (the context menu is
  wanted), then cancel, then the ignore rules
- **no dead states** — do nothing · press done immediately · draw during
  a reveal · resize mid-item · press "new round" mid-round
- **reveal after every attempt**, truth over their attempt, delta named
  in words — including the last attempt of the round, whose correction
  the round-end score must not wipe out
- **the scale is drawn too**, faintly, in the reveal: the ring you aim at
  is *not* the ring the score is measured on (`startRadius` vs `ease`
  rank the hardware in opposite orders), so without it a 62 has nothing
  on screen to be read against
- **the acquisition floor** —
  `Math.max(ArtDaily.ease(BASE × 2), ArtDaily.startRadius(BASE × 2))`.
  `ease` is the slack a hand needs to *execute* (most for a mouse);
  `startRadius` is the slack it needs to *find* a target (most for a
  screenless tablet). They rank the hardware in opposite orders on purpose,
  so a drill whose score **is** the finding — tap it, hit it, stop on it —
  and that reads `ease` alone grades its least-sighted player hardest: on
  `ease(BASE × 2)` a landing dead on the drawn ring was worth **16 on a pen
  tablet against 75 on a trackpad**, and five honestly sloppy taps scored
  **18** there against 75. The floor makes it 51 / 75 / 50 and 52 / 75 / 61,
  moving the trackpad column not one point. A max is a floor, never a
  compound — `ease(startRadius(r) × 2)` multiplies the two factors together
  and inverts the ranking all over again. Run the ring-edge check in
  `GAME_GUIDE.md` against your own `BASE`, and read the **pen** column:
  `pointerType` cannot tell a Cintiq from a screenless tablet, so the
  strictest row in the table is also what the player who cannot see their
  own hand gets
- **the round names its own habit** when there is one — five misses that
  all lean the same way are one mistake, and saying "aim **a little** high
  and left next round" is the only correction that outlives the round. Say
  how far as well as which way, from the **same ladder of words** the
  per-attempt reveals spend (`sizeWord`), measured only along the axes that
  actually leaned: a direction with no size is not something a hand can
  execute, so the player invents one, and that is how a lean turns into an
  overcorrection. Gate it on **contradiction, not majority** — fire only when
  no attempt went the other way. A centroid grows with the *scatter*, so
  "most on the same side + a tenth of the tolerance" fires on 82–92% of rounds
  of pure noise, hardest on the beginner spraying the sheet, and names a
  quadrant only two of the five taps were in. Say what happened, not what you
  infer
- **44px touch targets**, pointerId-guarded strokes
- **the loop feels listened to**: full-rate samples (`ArtDaily.samples`)
  with the canvas rect measured **once per event, not once per sample**,
  one repaint per frame, no `getComputedStyle` inside the repaint, nothing
  animated from JS that ignores `prefers-reduced-motion`, and no beat left
  running while the tab is hidden
- **3:1 in both themes** for anything meaning-bearing on canvas — including
  anything you drew at a low `globalAlpha`, because alpha is contrast (the
  demo's "faint" zero-ring was 1.74:1 on paper until it wasn't). The
  watercolor accents are decorative-strength on paper: on the light sheet
  the raw palette measures 1.97–3.48:1, so meaning goes in `--canvas-accent`
  (defined below the CSS marker), never in the raw `--game-accent` wash
- **4.5 for accent *text*, which is a higher bar than the canvas owes.**
  The shared sheet inks the HUD numbers and the hand-off link at
  `color-mix(--game-accent 55%, --ink)` — one rung *lighter* than the
  canvas's 45% — so on paper `--sunny` lands at **4.09** (HUD) and **4.11**
  (link) while the other five accents sit at 5.27–6.01. The template
  re-points all three at `--canvas-accent` below the marker (worst case
  5.01, dark untouched); keep that rule if you change the accent
- **one live region — the hint line.** Two of them written in the same tick
  queue up and say the same thing twice; the toast is a sticker
  (`aria-hidden`), not a second voice. The SDK's standalone hand-off bar
  obeys the same rule from the other side — it announces itself once, on its
  first paint of the sitting, then goes quiet rather than reading the score
  back over your round-end sentence every round
- **the canvas's `aria-label` is the picture, kept current** by
  `describeSheet()` in `js/game.js` — a name set once in the HTML describes
  a blank rectangle for the whole session
- **no `tabindex` on a canvas you cannot play with the keyboard**, and no
  keyboard drill without the `tabindex` — a tab stop that focuses a picture
  and does nothing reads as a broken control. Tab the whole drill before you
  ship: every stop a control, in reading order, ring visible on both sheets
- **draw, don't tap**, unless the lesson really is a decomposition or a
  judgement call

## What's wired in already

- `../sdk/artdaily-sdk.js` — embed detection, theme sync with the parent
  page, `?theme=` no-flash boot, personal-best storage, score reporting
- **Hardware fairness**: the SDK detects pen / mouse / touch silently and
  fills the `#inputMode` HUD chip. Take tolerances from
  `ArtDaily.ease(BASE)` and aim-at sizes from `ArtDaily.startRadius(BASE)`
  — both from your own base constant, never one *multiplied by* the other.
  If what your drill scores is the finding rather than the stroke, take the
  larger of the two (the acquisition floor above); `js/game.js` shows the
  pattern and the numbers behind it
- **Full-rate sampling for strokes**: `ArtDaily.samples(ev)` returns every
  position a `pointermove` actually carried, not just the one the browser
  got round to dispatching. A pen samples far faster than the screen
  repaints, and a drill that scores geometry off the delivered events
  alone loses the corner of every fast stroke — so a confident line scores
  worse than a timid one. Total: always an array, `[ev]` where the browser
  cannot coalesce. Hoist the canvas rect above that loop — the usual
  `pos(ev)` helper measures the element itself, so dropping it in
  re-measures dozens of times a frame for a number that cannot have moved
  between two samples. (And if you only want where the hand is *now*, the
  dispatched event already is the newest sample — `samples` is for the
  shape *between* two frames)
- **Palm rejection for pen users**: `ArtDaily.isPalm(ev)` is true for a
  `touch` contact within 700ms of anything the pen did — contact *or bare
  hover*, which is the half your own canvas handler cannot see. One call at
  the top of `pointerdown`, and the wrist stops stealing the attempt. Total:
  a session with no pen in it never returns true, so a finger-only player is
  untouched
- **A loop that stays out of the way**: inks are resolved once per theme
  instead of once per repaint (a repaint follows a text change, so each
  one was flushing a style recalculation), and both resize sources are
  coalesced into one measure + one repaint per frame — a 40-event resize
  drag costs 1 canvas reallocation, not 40. A drill that draws strokes
  should route its repaints through `requestAnimationFrame` the same way;
  sample at full rate, paint once a frame
- **Correctness scaffolding in `js/game.js`**: pure scoring functions at
  the top of the file, target geometry stored as canvas fractions so a
  rotation cannot lose the round, `report()` on exactly one path, and a
  `pointerPos()` that maps through the canvas's **content** box. The sheet
  is `box-sizing: border-box` with a 1px border, so
  `getBoundingClientRect()` measures a box 2px wider than the one the
  bitmap is painted into: the reflex `ev.clientX - rect.left` scored a tap
  landing *exactly on the drawn dot* as 1.26px out on a 1100px sheet — 97
  out of 100 on a pen, and a flawless round capped at 99
- **A worked reveal**: after every tap the demo holds the ring, draws the
  truth, your mark, the gap between them and — faintly — the ring where
  the score reaches zero (stored *with* the reveal, so plugging a pen in
  while it is up cannot redraw the scale at half its size under a number
  measured on the old one), then names the miss in plain words ("a little
  high and left") from a pure function graded against the same tolerance
  as the score, with its bands cut where the score changes character so
  the adjective never oversells the number. It holds for **1.8s — and for
  as long as the first reveal of the sitting actually takes to read**,
  which is 6.3s for the sentence the demo prints: that one also names the
  dotted ring on the spot, and a beat too short to read is a lesson
  written and then wiped. The long beat is **counted, not guessed**
  (`readingMs` × `revealBeat`, both pure, so the pacing is testable and
  cannot drift when you rewrite the copy; 4s stays as the floor). "Of the
  sitting" is counted by `revealsSeen`, which `newRound` never resets, so a
  beginner pressing the primary button before their first tap cannot
  downgrade that screen; and the beat is **parked while the tab is hidden**
  and handed back in full on return, because a background timer would
  otherwise spend the whole lesson on a tab nobody is looking at. Those words come from
  **one ladder** (`sizeWord`) that the whole drill spends, so "a little" means the
  same thing everywhere it is printed. At round end a second pure
  function names the round's *habit* if the misses leaned one way, and
  says which way **and how far** to aim next time, in that same ladder —
  measured only along the axes that actually leaned. The target is stored as canvas
  fractions but the mark as the **pixel offset that was scored**, so
  rotating the phone while the reveal is up cannot redraw a 26px miss as a
  5px one and contradict the 61 printed under it. The reveal's **sizes** are
  frozen with it too — the zero-ring *and* the ring you aimed at, which comes
  from `startRadius` and therefore *grows* on the same pen plug-in that
  shrinks the scale: a trackpad tap 30px outside a 22px ring, printed as "A
  little right — 66", used to redraw *inside* a 37px ring on one `onInput`.
  Once a number is printed, nothing the player has not done may change the
  picture it describes. Replace the geometry, keep the shape —
  reveal marks read `--canvas-accent` (defined below the CSS marker), not
  the raw `--game-accent` wash, so they stay legible on paper
- Shared studio chrome: HUD (round / score / best), hint line, dot-grid
  canvas, toast, buttons, "how to play" box — all theme-aware
- Standalone mode: backlink to artdaily, theme toggle, footer, Stage-0
  support links; embedded mode (`?embed=1`) sheds all of it. The SDK's
  score hand-off bar keeps its link node across rounds, so a keyboard
  player who tabbed onto it does not lose focus when a round ends — and on
  the one paint where the link genuinely has to go (the opener's
  `artdaily:logged` receipt swaps it for "sent ✓", triggered by another tab
  entirely) focus is *handed* to the bar rather than dropped to `<body>`
- Reduced-motion and keyboard-focus styles (3px `--focus` ring, 3.9:1 on
  paper / 6.6:1 in the night studio on the sheet, 3.6:1 / 7.1:1 on the top
  bar, where `outline-offset` puts it on `--bg`), one live region, landmarks
  around every control (the top bar is a `<header>`, so the back link and
  theme toggle are not stranded outside `<main>`), a visually hidden `<dt>`
  for the `#inputMode` chip so the HUD's description list is a legal one,
  and decorative glyphs (`← → ✓ ↻ ·`) hidden from screen readers rather than
  read out — including inside accessible *names*, which is where it matters
  most: the back link announced "leftwards arrow artdaily" until it didn't,
  and the footer fineprint read "SadeAli middle dot free middle dot no ads"
  until the same three-second fix was applied there too
