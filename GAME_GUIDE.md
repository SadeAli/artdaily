# Adding a game to Art Daily

Art Daily is an arcade of tiny art drills. The page knows nothing about
any game except its `js/registry.js` entry; every game is a folder in this
repo, served at `/<slug>/`. That's the whole architecture — page and games
meet through an iframe and three postMessage types, plus the four files
below that both of them load.

```
artdaily repo (all of it)         <slug>/ — a folder, not a repo
┌──────────────────────┐          ┌──────────────────────────────┐
│ index.html  the page │  iframe  │ <slug>/index.html  the drill │
│ js/registry.js  ←────┼──────────┼→ <slug>/js/game.js           │
│ js/app.js   player,  │ ready /  │ <slug>/css/style.css         │
│   streaks, meters    │ result / │    tokens + chrome           │
│ sdk/artdaily-sdk.js  │ theme    │                              │
│ js/main.js           │          │ every drill loads these four │
│ js/support-config.js │          │ from up here: three scripts  │
│ fonts/caveat…   ←────┼──────────┼─ as ../ paths, the font as   │
│                      │          │   ../../ — one copy, not 43  │
└──────────────────────┘          └──────────────────────────────┘
      served at /                        served at /<slug>/
```

Every drill used to be a repo of its own — `artdaily-<slug>`, published at
`sadeali.github.io/artdaily-<slug>/` — so the page and the drill it
embedded were two origins meeting over an iframe, and those four files
were vendored into every drill and into the template, 43 copies to keep in
step. They are folders here now. The protocol did not change and neither
did anything below it; what changed is that there is one copy of each
shared file instead of 43, one origin instead of two, and no address to
keep in sync, because a drill's URL *is* its slug.

## The contract (protocol v1)

A game must:

1. Load the shared files from the page instead of copying them. A drill's
   `index.html` ends with

   ```html
   <script src="../sdk/artdaily-sdk.js"></script>
   <script src="../js/support-config.js"></script>
   <script src="../js/main.js"></script>
   <script src="js/game.js"></script>
   ```

   and its `css/style.css` reaches the handwriting font at
   `url('../../fonts/caveat-latin.woff2')`. Those four used to be vendored
   into every drill, and the rule here was *never edit the vendored copy* —
   43 copies that had to stay byte-identical to be worth anything. There is
   one copy of each now, so the rule turns around: **each of those files is
   shared by the page and every drill, and a change to one changes all 43.**
   Read what the page does with it before you touch it, and never edit one
   to suit a single drill — a drill's own `index.html`, `css/style.css` and
   `js/game.js` (with its `README.md`, that is the whole folder) are the
   only files it owns.
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
   first-thirty-seconds section below before you write that toast. Both
   flags stay honest even where `localStorage` cannot be used at all
   (private mode throws on `setItem`): the SDK mirrors the best in memory
   for the sitting. Without that mirror every round came back `isFirst`, so
   a drill said *"that is your bar now"* after an 84 and then again after
   the 20 that followed, with 20 standing in the HUD's `best` column. That
   failure was found on the arcade's main path, the player dialog, back when
   the drill inside it was a *third-party* iframe and a browser told to
   block third-party storage threw on `getItem` as well. The iframe is
   same-origin now, so the storage a drill sees inside it is the page's own
   and that half of the case is gone; the private-mode half is not, and the
   mirror is what keeps the drill from lying either way.
4. Repaint through `ArtDaily.onTheme(draw)` so embedded theme switches
   restyle the canvas.
5. Work standalone at its own URL (the SDK shows/hides the chrome).

The page in turn:

- embeds `<slug>/?embed=1&theme=<current>` in the player dialog,
- answers the game's `ready` with the current theme and follows the
  toggle live,
- accepts `result` messages only from the game iframe it opened, clamps
  scores, and turns them into today's-warmup ticks, the daily streak
  and per-skill meters (all in this origin's localStorage).

That last parenthesis is the drill's origin too now, which it was not while
the drills lived on `sadeali.github.io` and could name a key anything they
liked. A drill writing to `localStorage` directly is writing into the same
store the page keeps the record in, so stay on keys nobody else owns: the
page holds `artdaily-progress-v1`, the SDK holds `artdaily-best-<slug>` and
`artdaily-input`, and both read `sadeali-theme`.

## The first thirty seconds (the only thirty a beginner gives you)

Almost every drill that loses a player loses them here, and almost never
to a bug. Open your own drill cold, the way someone who has never drawn
before opens it, and answer four questions honestly:

1. **Does the first screen teach the verb — and say how it marks you?**
   The hint line plus what is visibly drawn, before anyone opens the
   how-to. Name the thing on the canvas in the words for the thing on the
   canvas: if what you drew is a dot in the middle of a ring, the hint says
   *tap the centre dot*, not *tap the bullseye*. Then add the one rule a
   beginner needs *before* the first attempt rather than after it: nothing
   on a bare ring says whether a near miss is worth 90 or nothing at all.
   One clause, on the opening screen only — *"The closer you land, the
   more it scores."* From item two on the reveals have been teaching it in
   numbers, and repeating it is noise in the drill's one live region.
2. **Is the first item genuinely easy?** Not scored more kindly — an
   easier ITEM. Uniform-random placement will sooner or later open a
   round with the target jammed in a corner, and a beginner reads that as
   the drill being unfair before they have any idea what fair looks like
   here. Put item one in the middle, at the gentle end of whatever the
   drill ramps; the ramp belongs *inside* the round.
3. **Is any word jargon the drill does not teach on the spot?** Value,
   hue, ellipse degree, station point, ΔE, foreshortening — every one is
   fine to *use* and none is fine to *assume*. Either show it on the
   canvas in the same breath or use the ordinary word. **A mark can be
   jargon too**, and this is the one that gets missed: the first reveal
   paints a dotted ring the player has never seen and the score is
   measured on it, so unexplained it is an unfamiliar term that happens to
   be drawn instead of typed. Name it once, on the spot, in the sentence
   beside it — the template's first reveal ends *"The dotted ring is where
   a tap stops scoring."* and never mentions it again. Anything you can
   only learn by opening the how-to is not taught on the spot.
4. **Is the first reveal a lesson, or just a number?** A score with no
   correction attached teaches nothing: nobody can tell 58 from 72 by
   feel, and a bare number says nothing about which way to move. Draw the
   truth over the attempt, name the miss in words the player already
   owns — "a little high and left" beats "Δ 14.2 px" every time — and
   draw the *scale* it is measured against, or the picture still cannot be
   read (see the UX bar). Grade those words against the same tolerance the
   score uses, or the sentence and the number will contradict each other
   and the drill will read as broken. Then **time it, by counting the
   words**: a lesson wiped before it can be read is not a lesson, and both
   of this guide's earlier guesses were short — 620ms for a clause needing
   1800ms, then 4000ms for a first reveal needing 6300ms. Measure the line
   you are about to print rather than estimating it. See the beat rule in
   the UX bar.

The very first round of all needs its own copy. With no previous best,
`isNewBest` is trivially true, so an unguarded drill greets every new
player with **"new best!"** — a celebration of nothing, fired on the one
round where they most needed to be told what the number is *for*. Branch
on `report()`'s `isFirst`, say what the score is a bar for, and start
celebrating from round two.

The template's `js/game.js` implements every one of these; it is a
five-tap demo precisely so the pattern is readable. Read its first screen
and its first reveal out loud before you replace them — that is the whole
script a beginner gets:

```
Target 1 of 5 — tap the centre dot. The closer you land, the more it scores.
A hair low and right — 84 out of 100 for that tap. The dotted ring is where
a tap stops scoring.
```

## The UX bar (learned the hard way, from a full-catalogue audit)

Non-negotiable for every drill:

- **The first screen teaches the verb** — see above; it is the single
  most common way a finished, correct drill still fails.
- **Nothing is punished for UI reasons.** Accidental taps and too-short
  strokes reset free. Misplacements are recoverable (undo / clear).
  A player never loses points to a control they misunderstood.
  **Score only presses that mean "here": `if (ev.button > 0) return;`**
  A right-click is a `pointerdown` like any other — primary pointer, real
  coordinates — so an unguarded handler burns an item and scores wherever
  the cursor sat, while the context menu opens over the reveal explaining
  it. Same for a middle-click and for a pen's barrel button. `button` is
  `0` for a finger and for a pen's tip, so the guard costs touch and pen
  nothing. **It is the FIRST line of the handler** — above
  `preventDefault()` and above every state guard, `isPrimary` included.
  This is the one press whose browser default is still wanted, so it has
  to leave before anything cancels it; put it below `preventDefault()` and
  the guard still skips the scoring but the context menu never opens. The
  full order is `button > 0` out · `preventDefault()` · `isPalm` · the
  state guards (`isPrimary` among them) — see the palm snippet in the
  hardware section, which shows the same three lines.
- **Score where you painted, not where the rect says.** The shared sheet is
  `* { box-sizing: border-box }` and `.game-canvas` has a 1px border, so
  `getBoundingClientRect()` measures the **border** box while the bitmap is
  stretched into the **content** box — two pixels narrower and two shorter.
  The reflex `{ x: ev.clientX - rect.left }` then compares a border-box
  coordinate against a drawing-space one: off by the border at one edge and
  by the accumulated stretch at the other. Measured on the template at
  1100px, a tap landing *exactly on the drawn dot* read as **1.26px out —
  97 out of 100** on the pen profile, and a perfect round capped at 99. A
  drill whose 100 depends on where the target happened to spawn is not
  scoring the hand, and "a score of 100 must be possible" quietly stops
  being true anywhere but the middle of the sheet. Map through the content
  box, which `clientWidth`/`clientHeight` already are and which the
  `getBoundingClientRect()` you just called has already flushed layout for:

  ```js
  var rect = canvas.getBoundingClientRect();
  var cw = canvas.clientWidth || rect.width, ch = canvas.clientHeight || rect.height;
  var bx = (rect.width - cw) / 2, by = (rect.height - ch) / 2;
  return { x: (ev.clientX - rect.left - bx) * W / cw,
           y: (ev.clientY - rect.top  - by) * H / ch };
  ```

  With no border that is `bx = by = 0` and a scale of exactly 1 — the plain
  subtraction again, wherever the plain subtraction was already right. The
  same trap eats any padding you add to a canvas, and it gets worse, not
  better, as the border gets thicker.
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
  the sheet. Freeze the reveal's **sizes** the same way — the aim shape's
  radius and the zero-point — or a resize and a mid-reveal hardware change
  each redraw them under a printed number that cannot move. Measured swings
  and the fix are in the performance section.
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
  100 on a mouse, 51 on a pen tablet and 50 on a finger** (it was 75 against
  **16** before the template floored its zero-point — see the acquisition
  floor in the hardware section). Draw the zero-point faintly in
  the reveal (a dotted ring, a tolerance corridor, the accepted colour
  band) so a mark can be read against it. Reveal only: during play it is
  just a second thing to aim at.
- **Name the round's habit, not only each attempt's.** Five misses that all
  go the same way are one mistake, not five, and it is the correction that
  outlives the round — per-item words fix the next attempt, a bias line
  fixes the next round. Hold it to the same bar as the scoring (pure,
  total, at the top of the file) and keep it **silent unless the lean is
  both consistent and worth acting on** — the template requires a mean offset
  over ~10% of the tolerance *and* **not one attempt on the other side**.
  Say what to do, not just what
  happened, and **say how far**: *"most taps landed low and right — aim a
  little high and left next round"*. A direction with no size is not
  something a hand can execute, so the player invents one, and an invented
  correction is how a lean becomes an overcorrection. Take the size from
  the **same ladder as the per-attempt words** (`sizeWord` in the template),
  measured **only along the axes that actually leaned** — a sideways habit
  sized by a vertical wobble names a number about nothing. One vocabulary
  for "how far off", taught five times a round by the reveals and then
  spent once by the correction; two ladders and the player has to learn
  both.

  **A bare majority is not a gate, and a centroid is not a habit detector.**
  This is the rule the template got wrong for longest, and it got it wrong in
  the cruellest direction. The mean of five scattered attempts grows with the
  *scatter* (as `sd/√n`), so a gate that weighs it only against a fixed
  fraction of the tolerance gets **easier** to clear the wilder the round is:
  measured over 200k simulated rounds of pure isotropic noise — attempts with
  no habit whatsoever — "most on the same side + a tenth of the tolerance"
  fired on **53%** of rounds at a 25px average miss and **82–92%** from 50px
  out. The beginner spraying the sheet was the one most reliably told they had
  a lean. And the sentence was not even a description of the round in front of
  it: five taps flung to four different corners have a small centroid and a
  3-2 split on both axes, so the drill printed *"most taps landed low and
  right"* about a round where two of the five were. Across those noise rounds
  it always named both axes, and only **4–7%** of them had all five attempts
  in the named quadrant.

  Gate on **contradiction, not on majority**: fire only when *no* attempt went
  the other way. That turns the line into a description of what happened
  rather than an inference about the player, and a description cannot become a
  superstition. Noise then fires on 4–12% of rounds instead of 10–92%, and
  every one of those really did lean that way; genuine drifts still fire on
  64–100% against the old gate's 78–100%, which is the entire price. Count
  contradictions rather than testing the sign of the mean, so an attempt
  landing exactly on the centre line contradicts nothing — and note the
  printed word can stay *"most"*: a gate stronger than its sentence promises
  is the safe direction for the one line a player is asked to act on.
- **If a reveal holds the screen, the drill must not score what lands on
  it.** A tap during the beat has nothing honest to be judged against —
  the next item is not drawn yet. Ignore it, never count it. Finish the
  last item *synchronously* instead of behind the beat, so `report()` can
  never be raced by "new round" landing during the reveal.
- **Budget the beat against the reading, not against your patience.** A
  reveal that is gone before it can be read is decoration: the drill does
  the entire job of teaching and then wipes the lesson half a second
  later. Measure the text that is *new* on that screen at ~200 words per
  minute — a beginner reading unfamiliar copy while also looking at a
  picture — and make the beat outlast it. On a repeat reveal only the
  clause changes (*"A little low and right — 100"*, six words, 1800ms);
  the rest of the sentence is furniture the eye already knows. On the
  **first** reveal of the sitting nothing is furniture yet, so budget the
  whole sentence. This guide used to say ~0.6s and the template obeyed it:
  620ms for a clause needing 1800ms, which is the same as never having
  written it.

  **Then count the words instead of estimating them.** A hand-tuned
  constant for "long enough to read" goes stale the first time anyone
  edits the copy, and it had: the template's first-reveal beat was set to
  **4000ms** for "the score sentence (~3.1s) with room for the ring note",
  when the score sentence alone is twelve words — 3600ms — and the ring
  note is another nine, 2700ms. The real bill is **6300ms**, so a third of
  the first lesson in the drill was wiped before it could be read, on the
  one screen this entire section was written for. The template now
  *measures* it (`readingMs(text)`, a pure word count × 300ms, with an em
  dash counted as the pause it is and not as a word), keeps 4000ms as a
  **floor** for a terser first reveal, and passes the line it is about to
  print: `revealBeat(seen, text)`. Round one's beats then come to ~11.7s
  and every round after it to ~7.2s — still a beat rather than a
  slideshow, and the number cannot drift away from the copy again.

  Short beats are worse than a reading problem for a screen-reader player:
  `#hint` is the drill's one live region, so a short beat overwrites the
  reveal mid-announcement with the next prompt, and the correction is
  never heard at all. Keep the beat **pure** — a function of how many
  reveals this sitting has already shown, plus the text — so the pacing
  can be reasoned about, and tested, without a canvas.
- **"First of the sitting" is not "round 1, item 1".** They are the same
  screen only until the player touches the primary button, and pressing a
  big button they do not understand yet is the likeliest thing a beginner
  does first. Keyed on the round counter, a single press of *new round*
  before the first tap silently downgraded the exact screen all of the
  above was written for: the beat collapsed to the repeat reveal's 1800ms,
  the opening line stopped saying how the drill marks you, and the dotted
  ring — the scale the printed number is measured on — was never named at
  all. **Anything
  taught once** — a beat, a scale, a rule — hangs off a counter that
  `newRound` does not reset (`revealsSeen` in the template), never off
  `round === 1`.
- **A hidden tab is not a reading player.** Background timers keep running,
  throttled but never cancelled, so a reveal that is alt-tabbed away from
  is spent on a tab nobody is looking at: the player comes back to the next
  item with the lesson already wiped — the same failure as too short a
  beat, only total. Park the advance on `visibilitychange` and hand the
  beat back **in full** on return. It is safe by construction as long as
  the beat only ever advances an *item*: the last item finishes
  synchronously, so nothing on this path can file a round twice.
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
  45%, var(--ink))` clears it for every accent — **worst case 4.54**
  (sunny), measured where the mark actually sits, over the canvas's dot
  grid. Measured against bare `--card` the same worst case flatters itself
  to 5.27, which is the trap named two paragraphs into the accessibility
  section. Full detail there.
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
right — aim a little high and left next round."* The toast is now
`aria-hidden="true"`: a sticker, not a second voice. If your drill wants
to say something the hint does not, put it **in the hint**.

The rule binds the **SDK** too, and that is where it was being broken for
every drill at once. The standalone hand-off bar is written from inside
`report()` — the same tick your `finishRound` writes the hint — so a
standalone screen-reader player heard the whole round-end sentence and
then, queued behind it, *"scored 84 — add it to my Art Daily record"*,
every round, in every drill in the arcade. The score there is not news; the
drill just said it in a fuller sentence. What is news is that a route home
exists, and that is news **once**. The bar now carries `role="status"` for
its first paint of the sitting and drops the role after it: it keeps updating on
screen, stays reachable by tab and in browse mode, and stops interrupting
to repeat a number. Anything you inject into every drill inherits this
rule — count the live regions on the finished page, do not assume.

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

The rule bites hardest inside an accessible **name**, because that is what
gets announced out of context, so audit every link and button before you
audit prose. Two that shipped anyway: the template's own back link read
*"leftwards arrow artdaily"* until its `←` was wrapped, and the SDK's
hand-off sentence separated the round from the session best with a bare
`·` — *"scored 30 middle dot best this session 90"* — four lines from the
`glyph()` helper written to fix precisely that. Both are fixed; the lesson
is that a helper existing is not the same as a helper being used, and the
one place nobody re-reads is the chrome that was written first.

**Do not destroy a control to update the text around it.** Removing a
focused element drops focus to `<body>`. The hand-off bar rebuilt its
whole contents every round, so a keyboard player who had tabbed onto
"add it to my record" lost their place the moment the next round ended.
The bar now reuses the link node and replaces only the sentence in front
of it — and nothing is lost by that. On the first paint `role="status"`
implies `aria-atomic`, so the region is announced in full whether the node
was rebuilt or not; from the second paint on the bar is deliberately silent
(the one-spoken-channel rule above), so rebuilding would buy no
announcement at all and still cost a keyboard player their place.

**And when a control genuinely has to go, *hand the focus over* — do not
just drop it.** The rule above was fixed on the repaint path and left
broken on the other one, which is the path the player does not control:
when the opener replies `artdaily:logged`, the bar swaps the link for
*"sent to your Art Daily record ✓"*, because the score is home and there is
nothing left to click. The link cannot be kept — but focus really can be
sitting on it when the receipt lands, since a drill that cancels its canvas
`pointerdown` (the template does) never blurs a control a keyboard player
tabbed onto, so they can play a whole round still standing on that link.
Tearing it out sent them to the top of the document, mid-round, on a
message from another tab. The SDK now gives the bar `tabIndex = -1` and
moves focus to **the bar itself** before clearing it — but *only* when
focus was already inside it, because taking focus from anywhere else is its
own bug. The player lands on the element whose text just changed, so what
gets announced is the answer to "where did my link go", and the next Tab
carries on from there instead of from the page top. Same shape whenever you
retire a control: pick the nearest sensible container, make it focusable
with `-1` (never `0` — that would add a tab stop nobody asked for), and
move focus there yourself.

**3:1 for every mark that carries information, on both sheets.** See the
UX bar for the palette numbers. Three traps beyond the raw accent:

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
- *Accent **text** owes 4.5, and the chrome inks it one rung **lighter**
  than the canvas.* The shared sheet paints accent text with
  `color-mix(--game-accent 55%, --ink)`, while the canvas uses
  `--canvas-accent`, the 45% mix. So the two surfaces that owe the *higher*
  bar because they are text — the HUD's round/score/best (16.8px/900) and
  the SDK's hand-off link (18.4px bold, which lands just under the 18.66px
  large-text line and therefore owes the full 4.5) — are painted paler than
  a canvas ring that only owes 3:1. On paper that clears AA for five
  accents and misses for `--sunny`: **4.09** in the HUD and **4.11** on the
  link, against 5.27–6.01 for coral, mint, sky, lilac and bubblegum. The
  night studio is fine everywhere. Until the shared 55% moves, spend one
  value for both by adding this **below the marker** — worst case becomes
  5.01, dark is untouched (there `--canvas-accent` *is* the raw accent),
  and the HUD number and the toast sticker, which print the same score in
  the same instant, stay the same colour as each other:

  ```css
  :root[data-theme="light"] .hud-stat dd,
  :root[data-theme="light"] .handoff-link,
  :root[data-theme="light"] .toast .toast-accent { color: var(--canvas-accent); }
  ```

  The template ships it, so a drill copied today inherits it; six live
  drills chose `--sunny` before it existed.

Check a colour before you commit it — no dependencies:

```sh
node -e "const L=h=>{h=h.replace('#','');const s=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)
.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*s[0]+.7152*s[1]+.0722*s[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};
console.log('light',cr('#56A382','#FDFAF1'),' dark',cr('#5FBF97','#221D16'))"
```

**Focus must stay visible, and land somewhere sensible.** The shared
sheet gives every link, button and `[tabindex]` a 3px `--focus` outline
at 3.92:1 on paper and 6.56:1 in the night studio *measured on the sheet*
(`--card`) — the ring has `outline-offset: 3px`, so on the top bar it lands
on `--bg` instead, which is 3.57:1 on paper and 7.12:1 in the night studio.
Both clear the 3:1 a focus indicator owes, but paper has only half a rung
of headroom: **measure the ring against both surfaces** if you ever move
`--focus`, `--bg` or `--card`. Do not switch it off,
do not wrap a control in `overflow: hidden` that clips it, and keep the
DOM order the reading order (the SDK inserts the hand-off bar directly
after `.game-controls` for exactly that reason). Anything you toggle
open needs `aria-expanded` + `aria-controls` on the button that toggles
it, as `#btnHow` does. And keep the chrome inside **landmarks**: the
template's top bar is a `<header>`, not a bare `<div>`, so the back link
and the theme toggle — the only controls outside `<main>` — are reachable
by a player who navigates by region rather than by tab. Content in no
landmark at all is content that kind of navigation never lands on.

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
ArtDaily.isPalm(ev)       // that contact is a resting wrist, not an attempt
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

**The two knobs measure different things — never multiply one by the
other.** `startRadius` sizes what the player *aims at*; `ease` sizes where
the *score* reaches zero. They rank the hardware in opposite orders on
purpose, because they measure two different difficulties:

| | what it is slack *for* | most | least |
|---|---|---|---|
| `ease` | **executing** a stroke — a mouse pivots at the wrist and cannot creep | mouse ×2.0 | pen ×1.0 |
| `startRadius` | **finding** a target — a screenless tablet works with the hand out of sight | pen ×1.7 | mouse ×1.0 |

So `ease(startRadius(r) * 2)` compounds the two factors and inverts the
result — it scored a finger *more* generously than a trackpad. Always pass
your own base constant to each knob, never one knob's answer to the other:
`startRadius(BASE)` to draw, `ease(BASE * 2)` to score.

**Then ask which difficulty your drill actually grades.** If the score *is*
the finding — tap it, hit it, stop on it, land in it — then `ease` alone is
the wrong ruler, and using it grades your **least-sighted player hardest**.
On the template's `BASE = 22`, scoring a tap that lands exactly on the ring
it drew for you:

```
  zero-point                          pen   mouse   finger
  ease(BASE × 1)                        0      50        0   <- ring edge is a zero
  ease(BASE × 1.7)                      1      71       38
  ease(BASE × 2)                       16      75       47
  ease(BASE × 3)                       44      83       65
  max(ease(BASE×2), startRadius(BASE×2))
                       (the template)  51      75       50
```

Raising `k` does close the gap, but it closes it by making **everyone**
looser — at `k = 3` a trackpad, the most precise thing on the list, gets a
132px zero-point on a 22px ring, and the reveal's zero-ring grows past the
edges of a phone sheet (73% of it visible against 84% at `k = 2`). The
**acquisition floor** closes the same gap without touching the trackpad
column at all:

```js
function zeroPoint() {
  return Math.max(ArtDaily.ease(BASE_R * 2), ArtDaily.startRadius(BASE_R * 2));
}
```

A max is a floor, **not** a compound: whichever reason for slack applies to
the hardware in the player's hand, they get that one, and neither factor is
ever multiplied by the other. Pass `BASE × 2` *into* `startRadius` rather
than doubling its result — the SDK guards that multiply against overflow
and your own `* 2` does not, and an infinite zero-point makes `1 - err/zero`
exactly 1, so every wild attempt scores a fake 100. Five taps at each
device's realistic error, on the template's demo:

```
                     honest round        sloppy round
  ease(BASE × 2)     90 / 80 / 55        75 / 59 / 18   <- trackpad / finger / tablet
  acquisition floor  90 / 81 / 73        75 / 61 / 52
```

The trackpad column does not move by a single point. Nobody was made more
generous; the worst-served device simply stopped being punished for its
hardware — **18 out of 100 for an honestly sloppy round is a player who
closes the tab.** The floor has one more effect worth having: the zero-point
is then always wider than the drawn ring, so the dotted scale in your reveal
can never be swallowed by the target it is measured from.

The spread still does not close *completely* — the identical landing is 51
and 75 — and it never will while one score has to serve three machines. That
is *why* the zero-ring has to be drawn in the reveal: a player cannot read
their mark against a scale nothing on screen shows them. Check your own
numbers before you ship:

```sh
node -e "var S={pen:1.7,mouse:1.0,touch:1.6},E={pen:1,mouse:2,touch:1.5};
var BASE=22, K=2, FLOOR=true;   // <- your drill's constants
for(var m in S){var r=Math.round(BASE*S[m]),
z=Math.max(BASE*K*E[m], FLOOR?Math.round(BASE*K*S[m]):0);
console.log(m.padEnd(6),'ring',r,'zero',z,'| ring edge scores',
  Math.round(Math.max(0,1-r/z)*100));}"
```

A profile switch **lands at a release and nowhere else**: the SDK detects
the hardware on `pointerdown` but queues the change, so `onInput` can
rebuild geometry freely without the target moving under a live stroke,
and a stroke is always scored under the same `ease` it was drawn under.

*Nowhere else* includes the start of a press, and that is the case a tap
drill cares about. The SDK sniffs on `window` in the **capture** phase, so
its `pointerdown` handler runs *before* your canvas handler for the same
event: anything it applies there moves your geometry in the gap between the
last frame the player could see and the moment that very press is scored.
A queued switch used to be flushed right there, whenever the counter said no
gesture was live. Measured on the template, a `mouse`→`pen` switch grows the
aim ring 22px → 37px, and since the ring's radius pads the target inside the
sheet the target itself slides up to **15px on a 900px sheet — 17 points of
score** against the mouse zero-point. The player aimed at the old spot and
was graded against the new one, having never seen it move. The flush is gone
from that path; the release schedules its own, one task later, and a switch
queued by a gesture whose `pointerup` never arrived is picked up by the next
gesture's release instead (the idle repair hands the counter back). One
gesture later, and never inside one.

The queue holds for a stroke that *pauses*, too — a held-still nib emits no
move events at all, so the gesture goes idle without ending, and the palm
landing next used to force the queued switch through under the live hand
(a `mouse`→`pen` switch jumped the start dot 28px → 48px and halved the
zero-point mid-stroke). The queue now waits for a release it actually
saw — and the **newest press cancels a queue that contradicts it**, because
a release can go missing for real: press on the canvas, drag off the
iframe, let go over the page, and the drill never sees that `pointerup`.
The switch queued by that vanished gesture used to be applied at the end
of the *next* one, so a trackpad round was scored under the pen's `ease`
(half the zero-point) with the HUD chip reading "scoring for pen" — and it
only corrected itself a press later, one whole round too late. What a
drill must still do is treat `onInput` as *"resize the geometry"*, never
as *"re-judge what is already on screen"* — see the reveal note under
performance.

Rules that follow from this:

- **Ease every zero-point tolerance.** Before this existed, a mouse user
  drawing a 300px line with a realistic 15px wobble scored **9/100**.
  That is the whole retention problem in one number.
- **`'pen'` is two different machines, and the profile is tuned for the
  kinder one.** `pointerType` cannot tell an iPad or a Cintiq — nib on
  glass, hand right on the line — from a cheap screenless tablet, which
  maps absolutely with the hand somewhere else entirely. Both land on
  `ease: 1.0`, the strictest row in the table, so the bullet above *re-run
  on the pen profile* still says **9/100**: `ease(0.055 × 300)` is 16.5px
  there, and 15px of wobble on a 300px line is 9. The SDK already concedes
  the point in the other direction — a pen gets the **biggest** start zones
  (`1.7`, bigger than a finger's) precisely because acquiring a target with
  the hand out of sight is the hardest thing it does — so any drill whose
  score *is* an acquisition (tap it, hit it, stop on it) and that reads its
  tolerance from `ease` alone is grading its least-sighted player hardest.
  Until the profile splits, that is what the **acquisition floor** above is
  for, and the template now ships it. Five taps at each device's realistic
  radial error (9px trackpad · 13px finger · 20px screenless tablet for an
  honest attempt; 22 · 27 · 36 for a careless one) on the template's demo:

  ```
                       honest          sloppy
    ease(BASE × 2)     90 · 80 · 55    75 · 59 · 18
    acquisition floor  90 · 81 · 73    75 · 61 · 52
  ```

  **Read the pen column of your own numbers before you call the tuning
  done.** An honest attempt on the worst-supported device has to land
  mid-range; 18 out of 100 is not a hard drill, it is a player who closes
  the tab and concludes they cannot draw.
- **A palm is not an attempt — `ArtDaily.isPalm(ev)` on every press.** An
  artist rests the heel of the hand on the glass and the nib lands a moment
  *after* it, so first-contact-wins gives the round to the wrist: a stroke
  drill records palm drift as the player's line, a tap drill burns an item
  on a contact nobody made, and either way the hand that was actually
  drawing is the one the drill ignored. Thirty-three drills hand-rolled
  this guard against their own canvas events, under two spellings of the
  constant and two different clocks. It is one call now:

  ```js
  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.button > 0) return;          // right/middle click, barrel button
    ev.preventDefault();                // see the rule below
    if (ArtDaily.isPalm(ev)) return;    // ignored, never counted against them
    …
  });
  ```

  The SDK owns it because the SDK is the only thing that sees a nib
  **hovering**: it listens on `window` in the capture phase, so a pen that
  has lifted off the sheet — or is hovering over the chrome beside it —
  still holds the lockout open. A guard fed by your own canvas events goes
  blind at exactly the moment the palm is still down. True only for a
  `touch` press within 700ms of the pen's last event; a finger-only player
  is never once tested against a pen, and a missing or unusable
  `timeStamp` answers `false`, because a *false* palm silently eats a tap
  the player really made.
- **Cancel the default on every press the sheet sees — the ones you ignore
  too.** `preventDefault()` tucked below the state guards only ever runs
  for the presses that count, and the presses a drill ignores are the ones
  a beginner makes most: a reveal owns the sheet for 1.8s (6.3s for the
  first one in a sitting), which is exactly long enough for an impatient
  hand to press and drift a few pixels. Left to the browser that gesture
  drags a text selection across the hint line and the HUD, and on a touch
  screen it is a long-press callout sitting over the very picture the beat
  exists to let them read. The press still is not counted; it simply stops
  fighting the hand. The one press to leave alone is `button > 0` — the
  context menu is wanted — so test that first. `touch-action: none` on the
  canvas covers scrolling and pinch, not selection, and the two rules are
  not interchangeable.
- **Snap, don't refuse.** If a press lands near a start dot, move the
  stroke onto the dot. Refusing a near-miss reads as a broken site to
  someone who cannot see their own hand.
- **Accept lifted strokes.** A press that resumes near the last lift
  point continues the same attempt.
- **Put a pixel floor under relative tolerances**, or a phone gets a
  stricter standard than a desktop for the identical drill.
- **Keep `<dd id="inputMode">` in the HUD** — and give it a `<dt>`. The SDK
  fills the `<dd>` with "scoring for mouse or trackpad": we ease the score,
  so we say so. The id is fixed by protocol v1, but a `<dd>` on its own is
  not a legal description-list group, and an orphan value is read either
  with no term at all or hung off the term before it — *"best: scoring for
  mouse or trackpad"*, which is a HUD that lies about the player's record.
  The template pairs it with a visually hidden `<dt class="hud-input-term">`
  (hidden below the CSS marker, with `clip-path` rather than `display:
  none`, which would take it out of the accessibility tree too and fix
  nothing).

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
- **Measure the canvas once per event, not once per sample.** The obvious
  loop — `samples(ev).forEach(function (e) { pts.push(pos(e)); })` — hides
  a `getBoundingClientRect()` inside `pos`, so a fast pen re-measures the
  element dozens of times a frame to learn a number that cannot have moved
  between two samples, and the first of those reads has to flush the layout
  the last repaint dirtied. Hoist the rect above the loop; the whole run
  then costs one measurement. And if all you need is where the hand is
  *now* — a drag handle, a cursor — skip `samples` entirely: the dispatched
  event already carries the newest sample, it **is** the last entry of the
  run. `samples` buys you the *shape* of the stroke between two frames,
  which is the part the dispatched event throws away.
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
repaints, and the dotted ring redraws at a different radius under a printed
"66 out of 100" — the picture arguing with the number, exactly like
re-projecting the mark. On a tolerance read from `ease` alone that swing is
the whole `2.0 / 1.0` of the profile table, **half the radius**; the
template's acquisition floor narrows its own case to 88px → 75px, which is
smaller and still wrong. The number is history and so is the scale it was
measured against.

**So is the shape you were told to hit** — the one the template kept drawing
live after it had already frozen the other two. The ring the player aimed
at comes from `startRadius`, which the profile table ranks *opposite* to
`ease`, so the same pen being plugged in that shrinks the scale **grows** the
aim ring: mouse `×1.0` → pen `×1.7`, 22px → 37px on `BASE = 22`. Measured on
the template, a trackpad tap 30px out drew its mark clearly **outside** a
22px ring under *"A little right — 66 out of 100"*, and one `onInput`
redrew that same frozen mark **inside** a 37px ring. Inside-or-outside is
the first thing a reveal says and the only part of it a player can read at a
glance, so the picture flipped its verdict while the sentence under it did
not move. A resize does it from the other side, because an aim ring is
usually clamped to the canvas as well (`min(W, H) / 4` in the template: 37px
→ 31px on a 200px sheet). Freeze the radius into the reveal beside the
offset and the zero-point, and draw all three from there:

```js
reveal = { tf: target, dx: dx, dy: dy, r: t.r, zero: zero, /* … */ };
// drawReveal: targetAt(rv.tf, rv.r) — never targetRadius() again
```

The test for all three is the same one sentence: **once a number is printed,
nothing the player has not done may change the picture it describes.** Play
one attempt, then change the hardware and rotate the phone without touching
the canvas — every pixel of that reveal should be where you left it.

**One owner per timer.** A reveal beat, a countdown and a toast all
outlive the frame that started them, so every path that ends a round must
clear the ones it is ending — `newRound` cancels the abandoned round's
queued advance, `finishRound` cancels its own, and `visibilitychange`
parks the beat rather than letting a hidden tab spend it (see the beat
rules in the UX bar). Two timers racing to call `report()` is how a round
gets filed twice, so keep every timer that can *pause* on the item path
and never on the reporting one.

**Reduced motion is not only a CSS problem.** The shared stylesheet
flattens every animation and transition under `prefers-reduced-motion`,
but it cannot reach a canvas tween or a `setInterval` you wrote. Ask
before you animate from JS, and ask *totally* — `matchMedia` is missing on
old engines and throws on a few, and the answer must never be the reason a
round dies:

```js
function prefersReducedMotion() {
  try { return !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}
```

Two rules on top of asking:

- **Skip to the end state, never drop the reveal.** If the tween *is* the
  lesson — a plane tilting into its ellipse, a shadow swinging to the light
  — a reduced-motion player still needs the finished picture and the words
  under it. `ellipses` does this right: it paints the settled tilt straight
  away instead of animating to it, and the reveal is identical apart from
  the getting-there.
- **Never put information only in motion.** A pulse, a sweep or a
  shrinking countdown ring that a reduced-motion player never sees has to
  be a word or a mark as well. A ring that is also the clock is a timer
  they cannot read.

Read the preference at the moment you animate rather than caching it at
boot — the player can change it mid-session, and a drill holding a stale
`true` from boot is a drill that quietly stopped teaching.

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
off stops correcting. Its bands are now named in score terms — 92+ dead on,
75+ a hair, 50+ a little, 20+ well, under 20 way — and a test walks the whole
error range asserting the two never disagree at the ends (no "dead centre"
under 90, no score of 0 without "way out").

Keep that ladder in **one function** (`sizeWord`) and let every sentence in
the drill spend it: the per-attempt words, the round's correction, anything
else that has to say how far off something was. Two ladders means two scales
to learn. Two things follow from having only one:

- **Junk in, the WIDEST word out — never the flattering one.** A broken
  measurement that comes back "dead on" prints *"Dead centre — 12 out of
  100"*, which reads as the drill being broken because it is. The template's
  `sizeWord` rejects a negative magnitude for exactly this reason (a caller
  handing over a signed delta instead of a distance), and every non-finite
  input lands on "well".
  **Take the magnitude as a number and do not coerce it.** `Number(null)`,
  `Number('')`, `Number(false)` and `Number([])` are every one of them `0`,
  so the reflex `var m = Number(d)` lands a measurement that never happened
  on the *top* rung of the ladder — the most flattering word in the drill,
  handed out for the absence of a reading. `undefined` is caught only
  because it happens to become `NaN`; `null` is what a degenerate round
  actually produces, and it sailed through. `if (typeof d !== 'number')
  return 'well';` first, then the finite/sign guards. Normalise the
  *tolerance* at the call sites instead (`isFinite('88')` is true, so a
  numeric string reaches the ladder as a string), which is what `missPhrase`
  and `roundBias` now do.
- **Read the sentence out loud before you ship the band.** The words are
  glued to a direction, and an adjective that parses alone can still be
  broken English in place: the template's fourth band printed *"Well low and
  right"* for a full wave. It is *"Well out, low and right"* now, parallel to
  *"Way out, low and right"* — same grade, same number, a sentence instead of
  a word salad, in the one line a beginner reads after every single attempt.

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
push → registry entry) lives in the game template's README:
`game-template/`, here in this repo. There is no repo to create and no
Pages switch to flip any more — `cp -r game-template <slug>/`, build it,
add the entry to `js/registry.js`, push, and it is live at `/<slug>/` with
the rest of the site. Read the header and the field comments in
`js/registry.js` for the entry shape before you write one: the slug *is*
the folder the drill is served from, so there is no `url` to fill in (it
survives only as an override for a drill that is not served from
`/<slug>/`, and nothing uses it), and the `dev` field is gone with it.

Local dev is the same shape as production now, which is the point of it:
serve the **repo root** — `python3 -m http.server 8080` — and the page is
at `/` with every drill at `/<slug>/`, embedded from the same origin, off
the same server, with nothing to point anywhere. A server rooted inside a
drill folder serves that drill with no SDK, no shared chrome and no font,
because all three live above it.

`game-template/` ships in the repo like any other folder, so it is kept out
of the index deliberately: it carries a `robots` `noindex` meta tag and is
the one game folder missing from `sitemap.xml`. A real drill is the
opposite of both — delete that meta line from your copy and add the drill's
URL to the sitemap.

**Two registrations, not one.** A registry entry alone leaves the drill
invisible with JavaScript disabled. Every `status: 'live'` entry also
needs a plain `<slug>/` link in the `<noscript>` list in `index.html`.
Check before pushing — three drills once shipped half-listed this way:

```sh
node -e "const fs=require('fs'),vm=require('vm'),c={window:{}};vm.createContext(c);
vm.runInContext(fs.readFileSync('js/registry.js','utf8'),c);
const h=fs.readFileSync('index.html','utf8');
const m=c.window.ARTDAILY_GAMES.filter(g=>g.status==='live'&&h.indexOf('href=\"'+(g.url||g.slug+'/')+'\"')<0);
console.log(m.length?'MISSING from <noscript>: '+m.map(g=>g.slug):'noscript list complete');"
```

## Versioning

The SDK carries `version: 1` in every message. If the protocol ever
changes, bump `VERSION` in `sdk/artdaily-sdk.js` and teach the page the new
shape in the same push. There is nothing to recopy any more, and that cuts
both ways: every drill loads the one `../sdk/artdaily-sdk.js`, so a bump
moves all 42 at once and there is no drill left behind to migrate — but
there is also no staggered rollout to hide behind. Keep the page accepting
the older version anyway: a tab left open across the deploy is still
running the old SDK. Never fork it per-drill.
