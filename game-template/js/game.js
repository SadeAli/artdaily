/* ============================================================
   game.js — the drill itself. This template ships a tiny working
   demo (tap five targets dead centre) so you can play the pattern
   before replacing it: keep the skeleton — init → round → input →
   REVEAL → score → ArtDaily.report — and swap in your drill's
   geometry. Everything draws on one theme-aware canvas; no libraries.

   The reveal is part of the skeleton, not decoration. A drill that
   answers an attempt with only a number teaches nothing in the first
   thirty seconds, which is the only thirty seconds a beginner gives
   it: they cannot tell 58 from 72 by feel yet, and nothing on screen
   tells them which way to move. So after EVERY item this demo draws
   the truth over the attempt with the gap between them, and names the
   miss in words. Replace the geometry, keep that.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'game-slug'; /* TODO: your slug (matches the registry entry) */
  var TARGETS_PER_ROUND = 5;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     SCORING — pure functions, kept at the top of the file so they can
     be lifted straight into node and hammered with degenerate input.
     Every drill in the arcade follows this shape. Two rules they must
     hold, whatever you replace them with:
       · finite 0–100 for ANY input — empty arrays, zero sizes, NaN,
         collinear points. Never NaN, never a throw. A NaN loses every
         comparison it touches, so one leaks silently through the whole
         round and lands as a bare 0 the player cannot explain.
       · monotonic in the error: more wrong can never score higher.
     ============================================================ */

  /* 100 dead-centre, 0 at `zero` px out or beyond. `zero` comes from
     ArtDaily.ease(), never from a raw constant — see the hardware note
     in GAME_GUIDE.md. */
  function tapAccuracy(dist, zero) {
    if (!isFinite(dist) || !isFinite(zero) || zero <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - Math.abs(dist) / zero) * 100));
  }

  /* Mean of the round's taps. A round that somehow ends with nothing
     recorded scores 0 rather than 0/0 = NaN. */
  function roundScore(accuracies) {
    if (!accuracies || !accuracies.length) return 0;
    var sum = 0;
    for (var i = 0; i < accuracies.length; i++) {
      var a = Number(accuracies[i]);
      sum += isFinite(a) ? Math.max(0, Math.min(100, a)) : 0;
    }
    return sum / accuracies.length;
  }

  /* ---- the reveal, in words (pure too, and held to the same bar) ----
     A bare number teaches nothing on the round that matters most. A
     beginner who reads "58" only learns what 58 feels like after twenty
     rounds; "a little low and right" is a correction they can make on the
     very next tap. Every drill owes its player this — see the UX bar in
     GAME_GUIDE.md. Canvas y grows downward, so a negative dy is HIGH. */
  function missDirection(dx, dy) {
    var x = Number(dx), y = Number(dy);
    if (!isFinite(x) || !isFinite(y)) return '';
    var ax = Math.abs(x), ay = Math.abs(y);
    if (ax === 0 && ay === 0) return '';
    var v = y < 0 ? 'high' : 'low';
    var h = x < 0 ? 'left' : 'right';
    if (ay > ax * 2.5) return v;
    if (ax > ay * 2.5) return h;
    return v + ' and ' + h;
  }

  /* ONE ladder of sizes for the whole drill. The per-attempt words and the
     round-end correction are cut at the SAME fractions of the SAME tolerance
     and spend the same five words, so the player is never taught two scales
     for "how far off" — they learn what "a little" is worth once, from five
     reveals a round, and the round's correction can then use it as a unit.
     Lowercase; missPhrase() capitalises the one that opens a sentence.

     Cut where the SCORE changes character, not at tidy fractions of the
     tolerance. The adjective is printed in the same sentence as the number —
     "A hair low — 71 out of 100" reads as the drill lying to you, and a
     player who is told they were a hair off stops correcting. The score is
     100 - 100*d/z, so these edges are, as scores:
       92+ dead on · 75+ a hair · 50+ a little · 20+ well · under 20 way.
     Total: junk in, a usable word out (the widest one, never a flattering
     one — a broken measurement must not read as a near miss). */
  function sizeWord(d, z) {
    /* A MAGNITUDE MUST ARRIVE AS A NUMBER — no coercion. `Number(null)`,
       `Number('')`, `Number(false)` and `Number([])` are every one of them
       0, so a measurement that never happened coerced its way to the TOP of
       this ladder and came back "dead on": the single most flattering word,
       handed out for the absence of a reading. `undefined` was caught only
       because it happens to become NaN, and `null` is the value a drill
       actually produces when a degenerate round leaves an error unset. The
       two callers below hand over `Math.hypot(...)`, which is always a
       number, so this costs the template nothing and closes the hole for
       every drill that inherits the function. */
    if (typeof d !== 'number' || typeof z !== 'number') return 'well';
    var m = d, t = z;
    /* `m < 0` is rejected rather than folded: a magnitude is never negative,
       so a negative one means the caller handed over a signed delta by
       mistake, and the flattering answer to a broken measurement is the
       dangerous one — "dead on" beside a score of 12 reads as the drill
       being broken, which is exactly what it would be. */
    if (!isFinite(m) || m < 0 || !isFinite(t) || t <= 0) return 'well';
    /* Every rung is CLOSED at its top, `<=`, including this last one. It
       used to be the one `<` in the ladder, which put the band edges half a
       step out of line with the contract three comments up (and with the copy
       in GAME_GUIDE.md): "20+ well · under 20 way" reads 20 as a `well`, and
       a score of exactly 20 came back "Way out". One rung graded on a
       different comparison than its four neighbours is the shape a later
       edit gets wrong, and it is the harshest rung in the drill — the place
       to be exact about which side of the line a player is on. */
    if (m <= t * 0.08) return 'dead on';
    if (m <= t * 0.25) return 'a hair';
    if (m <= t * 0.5) return 'a little';
    if (m <= t * 0.8) return 'well';
    return 'way';
  }

  /* Graded against the SAME zero-point the score uses, so the words and
     the number can never disagree: "dead centre" next to a 40 would read
     as the drill being broken. Total — NaN, a zero tolerance and a
     zero-length miss all come back a usable sentence. */
  function missPhrase(dx, dy, zero) {
    var d = Math.hypot(Number(dx), Number(dy));
    if (!isFinite(d)) return 'Off the mark';
    /* `Number(...)` and not the bare value: `isFinite('88')` is true, so a
       tolerance handed over as a numeric string used to reach sizeWord as a
       string. It grades numbers. */
    var z = (isFinite(zero) && zero > 0) ? Number(zero) : 1;
    var much = sizeWord(d, z);
    if (much === 'dead on') return 'Dead centre';
    var dir = missDirection(dx, dy);
    /* The two big bands carry "out" so the direction reads as a clause:
       "Well out, low and right", parallel to "Way out, low and right". The
       bare adjective printed broken English — "Well low and right" — into
       the one sentence a beginner reads after every single attempt. */
    if (much === 'well' || much === 'way') {
      var head = (much === 'way' ? 'Way' : 'Well') + ' out';
      return dir ? head + ', ' + dir : head;
    }
    var lead = much.charAt(0).toUpperCase() + much.slice(1);
    return dir ? lead + ' ' + dir : lead + ' out';
  }

  /* The per-attempt sentence: the words and the number always travel
     TOGETHER, in that order. A number alone is not a reveal, and words
     alone leave the player unable to place the correction on the scale the
     HUD and the round-end line both use. Total, like everything up here —
     a non-finite accuracy drops the number rather than printing "NaN out
     of 100" into a live region that gets read out loud. */
  function tapWords(words, acc) {
    /* Only a real, non-empty STRING counts as words. `String(x || fallback)`
       is not the same guard: [] and {} are truthy, so they sailed past it and
       printed "" and "[object Object]" into a line that gets read aloud, and
       -Infinity printed itself. */
    var head = (typeof words === 'string' && words.trim()) ? words : 'Off the mark';
    var n = Number(acc);
    if (!isFinite(n)) return head;
    /* Clamped for the same reason report() clamps: the sentence says "out of
       100", so it may not print 1e+308. */
    return head + ' — ' + Math.round(Math.max(0, Math.min(100, n))) + ' out of 100 for that tap';
  }

  /* ---- the round's lesson, which no single attempt can show ----
     Five taps that all land low and right are not five random misses, they
     are one habit, and naming it is the only correction that outlives the
     round: per-item words fix the next tap, this fixes the next round. Fires
     only on a lean that is BOTH unanimous (not one tap on the other side)
     and big enough to be worth aiming off (a tenth of the tolerance) — see
     the gate below for what a bare majority did instead. Pure and total:
     junk offsets, a
     short round and a zero tolerance all come back a string — '' meaning
     "there is nothing honest to say", which the caller must treat as silence
     rather than print. */
  function roundBias(marks, zero) {
    if (!marks || !marks.length) return '';
    var z = (isFinite(zero) && zero > 0) ? Number(zero) : 1;   /* see missPhrase */
    var n = 0, sx = 0, sy = 0, left = 0, right = 0, high = 0, low = 0;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m) continue;
      var x = Number(m.dx), y = Number(m.dy);
      if (!isFinite(x) || !isFinite(y)) continue;
      n++; sx += x; sy += y;
      if (x < 0) left++; else if (x > 0) right++;
      if (y < 0) high++; else if (y > 0) low++;   /* canvas y grows downward */
    }
    if (n < 3) return '';           /* too few attempts to call anything a habit */
    var mx = sx / n, my = sy / n;
    /* NOT ONE ATTEMPT MAY CONTRADICT THE LEAN — the count gate is "zero on the
       other side", not "a majority on this one".

       A centroid is a terrible habit detector on five samples. The mean of
       five scattered taps grows with the SCATTER (as sd/√n), and the old gate
       only ever weighed it against a fixed tenth of the tolerance — so the
       wilder the round, the more reliably it cleared the bar. Measured over
       200k simulated rounds of PURE ISOTROPIC NOISE (taps with no habit at
       all, zero-point 88): a bare majority plus a tenth of the tolerance fired
       on 53% of rounds at a 25px average miss, and on 82–92% of rounds from
       50px out. Backwards, and backwards in the cruellest direction — the
       beginner spraying the sheet is the one most reliably handed a made-up
       habit, and an invented correction is how a scatter problem becomes a
       lean.

       And what it printed was not a description of the round in front of it.
       Five taps flung to four different corners — (70,70) (-80,60) (75,-70)
       (-70,-75) (80,65) — have a centroid of (15,10): a 3-2 split on both
       axes, both over a tenth of 88. Out came "Most taps landed low and
       right", when 2 of the 5 were. That is the general case, not a picked
       one: on those noise rounds the old gate always named BOTH axes, and only
       7% (50px scatter) to 4% (100px) of them actually had all five taps in
       the named quadrant — the average had two thirds of them.

       Requiring an empty other side makes the line a DESCRIPTION of the round
       rather than an inference about the player, and a description cannot be a
       superstition. Noise now fires on 4–12% of rounds instead of 10–92%, and
       on every one of those every tap really did land that way (100%, all
       scatters). Genuine drifts — a lean bigger than the wobble around it —
       still fire on 64–100% where the old gate managed 78–100%, which is the
       whole price. The line still reads "Most taps landed…", true a fortiori:
       the gate is deliberately stronger than the word promises, because this
       is the one sentence in the drill a player is asked to ACT on. Counted
       rather than signed, so a tap landing exactly on the centre line
       contradicts nothing. */
    var h = (Math.abs(mx) >= z * 0.1 && (mx < 0 ? right : left) === 0) ? (mx < 0 ? 'left' : 'right') : '';
    var v = (Math.abs(my) >= z * 0.1 && (my < 0 ? low : high) === 0) ? (my < 0 ? 'high' : 'low') : '';
    if (!h && !v) return '';
    var was = (v && h) ? v + ' and ' + h : (v || h);
    var fv = v === 'high' ? 'low' : v === 'low' ? 'high' : '';
    var fh = h === 'left' ? 'right' : h === 'right' ? 'left' : '';
    var fix = (fv && fh) ? fv + ' and ' + fh : (fv || fh);
    /* HOW FAR to aim off, in the same five words the round's reveals just
       spent teaching (sizeWord). "Aim high and left" is a direction; a hand
       cannot act on a direction without a size, and the player would have to
       invent one — which is how a corrected habit turns into an overcorrected
       one. Measured only along the axes that actually leaned, so a sideways
       habit is never sized by a vertical wobble the sentence says nothing
       about. The gate above is a tenth of the tolerance and the ladder's top
       rung is a twelfth, so this can never come back "aim dead on left". */
    var lean = Math.hypot(h ? mx : 0, v ? my : 0);
    return 'Most taps landed ' + was + ' — aim ' + sizeWord(lean, z) + ' ' + fix + ' next round.';
  }

  /* ---- where a target sits, in words (pure, total) ----
     Only the canvas knows where the target is, and a canvas is a blank to
     anyone who cannot see it. This feeds the sheet's accessible name — see
     describeSheet(). Junk fractions come back a usable phrase, never NaN. */
  function sheetZone(fx, fy) {
    var x = Number(fx), y = Number(fy);
    if (!isFinite(x) || !isFinite(y)) return 'the middle of the sheet';
    var h = x < 0.34 ? 'left' : x > 0.66 ? 'right' : '';
    var v = y < 0.34 ? 'top' : y > 0.66 ? 'bottom' : '';
    if (!h && !v) return 'the middle of the sheet';
    return 'the ' + (v && h ? v + ' ' + h : v || h) + ' of the sheet';
  }

  /* ---- theme-aware inks (read once per THEME, not once per repaint) ----
     `accent` is the decorative wash — a tint, a fill, a flourish. `mark` is
     the same accent mixed toward --ink, and it is what ANYTHING CARRYING
     MEANING on the canvas must be drawn in: the watercolour accents are
     decorative-strength on light paper, and a shape a player cannot see is
     not a shape. Measured on the light sheet, raw --game-accent lands at
     2.9:1 for the template's mint, 3.0 for coral, 2.9 for bubblegum and
     1.97 for sunny — under the 3:1 a graphic that carries information owes.
     Mixed toward --ink, the whole palette clears it with room: worst 4.6
     (sunny), measured WHERE THE MARK ACTUALLY SITS — over the canvas's dot
     grid (--ink at 8% on --card), not over bare --card, where that same
     worst case flatters itself to 5.3. Quote the number you measured
     against the real backdrop; the bare-swatch read is the trap the
     accessibility section of GAME_GUIDE.md names.
     Defined as --canvas-accent below the marker in css/style.css.

     Every one of these is a custom property on :root and the ONLY thing
     that moves them is the data-theme attribute — so a read per theme is
     the same answer as a read per repaint, minus the cost.
     getComputedStyle().getPropertyValue() cannot answer until style has
     been resolved, and draw() is called from the input handler directly
     after the hint line's text changed, so each repaint flushed a style
     recalculation to fetch four values that had not moved since boot. A
     tap drill pays that once per tap; a drawing drill built on this
     skeleton pays it on every pointer sample, in the middle of the
     stroke, which is exactly where a player feels the hand stop being
     listened to. An empty read (stylesheet not parsed yet on a cold
     boot) is never cached, so the next repaint still corrects it. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--mint').trim();
    var c = {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: accent,
      mark: cs.getPropertyValue('--canvas-accent').trim() || accent,
    };
    if (c.ink && c.muted && accent) { inkCache = c; inkTheme = t; }
    return c;
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0, lastDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var dpr = window.devicePixelRatio || 1;
    if (w === W && dpr === lastDpr) return false;   /* mobile URL-bar resizes fire constantly */
    W = w;
    H = Math.max(1, Math.round(W * 0.62));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ----
     The target is stored as FRACTIONS of the canvas, not pixels. Rotate a
     phone mid-round and the canvas can go 900px → 390px wide; a target
     remembered at x=826 was then off the new canvas, impossible to tap,
     and the round could never finish — a dead round that never reported.
     Fractions survive any resize, so every round stays finishable. */
  var round = 0, targetIdx = 0, accuracies = [], target = null, playing = false;
  /* Every tap's scored offset, kept for the round-end bias line. The score
     only needs the accuracies; the LESSON needs to know which way each miss
     went, and that is gone once a distance has been collapsed to a number. */
  var marks = [];

  /* The last tap, held on screen over the target it was judged against —
     the reveal. The target keeps its fractions; the MARK is kept as the
     pixel offset that was actually scored (dx, dy), not as its own fraction
     of the canvas. The round-end reveal stays up until "new round" is
     pressed, and the score under it is an absolute pixel miss judged
     against a canvas-independent zero-point — so a phone rotated while the
     player reads it must not change the gap they are looking at. Two
     fractions re-projected onto a 360px canvas drift apart: a 26px miss
     ("A little", 61) redrew as a 68px one on the way back to landscape,
     which is "Way out", 0. The picture then teaches the opposite of the
     number printed under it. An offset survives every resize exactly. */
  var reveal = null;
  var revealTimer = null;
  /* How many reveals this SITTING has shown. NEVER reset by newRound(): the
     screen that needs the long beat and the one-off naming is the player's
     FIRST reveal, which is not the same thing as round one's first item the
     moment they press the big primary button before tapping anything — the
     likeliest thing a beginner does with a control they do not understand
     yet. Keyed on `round === 1` it silently downgraded exactly the screen
     the budget below was written for: the beat collapsed to the repeat
     reveal's 1800ms, the opening line stopped saying how the drill marks
     you, and the dotted ring — the scale the printed number is measured on
     — was never named at all, on the one screen where it is new. */
  var revealsSeen = 0;
  /* THE BEAT MUST OUTLAST THE READING, or the reveal is decoration.
     Budget it against the text that is NEW on that screen, at ~200 words
     per minute — a beginner reading unfamiliar copy while also looking at
     a picture. On a repeat reveal only the clause changes; the rest of the
     sentence is furniture the eye already knows. The longest clause this
     drill can print is six words ("A little low and right — 100"), which
     is exactly 1800ms — check yours with readingMs() if you change the
     wording. At 620ms, where this started, even that clause was gone
     before it could be read: the drill did the whole job of teaching and
     then wiped the lesson half a second later. It was worse for a
     screen-reader player, because #hint is the drill's ONE live region and
     the next prompt overwrote the reveal mid-sentence.
     Four of these add ~7s to a round — a beat, not a slideshow. */
  var REVEAL_MS = 1800;
  /* The FIRST reveal of the sitting is the only one where nothing is
     furniture yet: a dashed line, a dotted ring, a mark and a sentence, all
     new at once, plus the line that names the ring. So it is the one beat
     that must be budgeted against the WHOLE sentence — and a hand-tuned
     constant for that is a number that goes stale the moment anyone edits
     the copy, which is exactly what happened here. 4000ms was set for "the
     score sentence (~3.1s) with room for the ring note": the score sentence
     is twelve words, which is 3.6s, and the ring note is another nine —
     2.7s — so the whole thing needs 6.3s and got 4.0. A third of the first
     lesson in the drill was being wiped before it could be read, on the one
     screen the entire reveal design was written for.
     So MEASURE IT instead of guessing it. The floor still stands for a
     drill whose first reveal is terser than this one's. */
  var FIRST_REVEAL_MIN_MS = 4000;   /* a floor, not the budget — see revealBeat */
  /* ~200 words a minute: a beginner reading unfamiliar copy while also
     looking at a picture, and about the rate a screen reader speaks the
     same line out of #hint. */
  var MS_PER_WORD = 60000 / 200;

  /* Words, not tokens. An em dash is a pause, not a word — counting the
     "—" in "A hair low and right — 84" as one is a whole extra 300ms of
     budget bought for a character nobody reads aloud, and rounding the
     other way is how a "budget" quietly becomes a guess. Pure and total:
     anything at all in, a finite number of milliseconds out. */
  function readingMs(text) {
    var parts = String(text === null || text === undefined ? '' : text).split(/\s+/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (/[0-9a-z]/i.test(parts[i])) n++;
    return n * MS_PER_WORD;
  }

  /* Pure, so the pacing can be reasoned about (and tested) without a canvas.
     `seen` is how many reveals this SITTING has already shown — not how far
     into a round we are, and not which round it is. See revealsSeen.
     `text` is the line about to be printed, and it is only consulted for the
     first reveal: from the second on, only the clause inside that sentence
     is new and the rest is furniture the eye already knows, so measuring the
     whole sentence again would double every beat into a slideshow. */
  function revealBeat(seen, text) {
    if (seen) return REVEAL_MS;
    return Math.max(FIRST_REVEAL_MIN_MS, readingMs(text));
  }

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
  }

  /* The drill's own reference size. TWO different SDK knobs hang off it,
     and mixing them up quietly inverts the fairness they exist for:
       · startRadius(BASE_R) — how big the thing you AIM AT is drawn. A
         screenless tablet aims with the hand out of sight, so it gets the
         biggest dot even though it is the most precise instrument.
       · ease(BASE_R * 2)    — how much slack a hand needs to EXECUTE. A
         mouse pivots at the wrist and cannot creep, so it gets the most
         room. One TERM of the zero-point, not the whole of it: see below.
     Feed the already-enlarged ring into ease() and the two multipliers
     compound: a finger ended up scored more generously than a trackpad,
     the opposite of what the profile table says. Always pass the BASE to
     each knob, never one knob's answer to the other — and see zeroPoint(),
     which takes the LARGER of the two because this drill's score is an
     acquisition and an acquisition is graded by the finding knob. */
  var BASE_R = 22;

  function targetRadius() {
    /* the drawn ring is also clamped so it can never swallow a tiny canvas */
    return Math.max(12, Math.min(ArtDaily.startRadius(BASE_R), Math.min(W, H) / 4));
  }

  /* Kept off the canvas size on purpose: the same tap must score the same
     on a phone and a desktop.

     AND IT IS THE LARGER OF THE TWO KNOBS, because what this drill scores is
     an ACQUISITION. The two knobs measure different difficulties and rank the
     hardware in opposite orders on purpose: ease() is the slack a hand needs
     to EXECUTE (a mouse pivots at the wrist and cannot creep, so it gets the
     most, x2.0; a pen the least, x1.0), startRadius() is the slack a hand
     needs to FIND a target (a screenless tablet works with the hand out of
     sight, so IT gets the most, x1.7; a mouse the least, x1.0). A drill whose
     score IS the finding must read its tolerance through the finding knob
     too, or it grades its least-sighted player hardest — which is exactly
     what this line used to do. On ease() alone the zero-point was pen 44 /
     mouse 88 / finger 66, so the edge of the very ring the player was told to
     aim at was worth 16 out of 100 on a screenless tablet and 75 on a
     trackpad, and five honestly sloppy taps scored 18 there against 75 on the
     trackpad. Taking the max makes it pen 75 / mouse 88 / finger 70: the same
     sloppy round is 52 / 75 / 61 and the trackpad column does not move by a
     single point. Nobody was made more generous; the worst-served device
     simply stopped being punished for its hardware.

     A MAX IS NOT A COMPOUND. Never ease(startRadius(r) * 2): the PRODUCT
     multiplies the two factors together and inverts the ranking all over
     again (GAME_GUIDE.md). A max is a floor — whichever reason for slack
     applies to the hardware in the player's hand, they get that one, and
     neither factor is ever multiplied by the other.

     Both terms are total (finite, > 0) by the SDK's own contract, so the max
     is too. Note it is startRadius(BASE_R * 2) and not startRadius(BASE_R) * 2:
     doubling the RESULT puts the multiply outside the SDK, where nothing
     checks it, and a large-but-finite base overflows there to Infinity — an
     infinite zero-point makes 1 - err/zero exactly 1, so every wild tap
     scores a fake 100. Inside startRadius the same multiply is guarded.

     One thing the reveal gets for free: the zero-point is now always wider
     than the drawn ring by more than drawReveal's `zr > t.r + 3` guard, on
     every profile at every canvas size — so the scale a score is read
     against can never be swallowed by the target it is measured from. */
  function zeroPoint() {
    return Math.max(ArtDaily.ease(BASE_R * 2), ArtDaily.startRadius(BASE_R * 2));
  }

  /* Fractions → pixels, always inside the canvas whatever its size.
     Takes the fraction pair rather than reading `target`, so the reveal
     can re-place a target that the round has already cleared.

     `r` overrides the LIVE radius, and the reveal always passes one — the
     ring you were told to hit is part of the history the reveal is showing,
     exactly like the mark and the dotted scale. Left live, it moved under a
     finished attempt: a trackpad tap 30px out draws its mark clearly OUTSIDE
     a 22px ring under "A little right — 66 out of 100", and plugging a pen
     in while that reveal is up fires onInput → draw(), which redraws the
     same frozen mark INSIDE a 37px ring. The picture then says the player
     hit the target and the sentence says they were 66. A resize does it from
     the other side, because targetRadius is also clamped to min(W,H)/4: on
     this drill's BASE that bites below a ~239px sheet, and sooner the bigger
     your own base. Total: junk or a missing radius falls back to the live
     one. */
  function targetAt(tf, r) {
    if (!tf) return null;
    var rr = (isFinite(r) && r > 0) ? Number(r) : targetRadius();
    var pad = rr + 10;
    return {
      x: (W > pad * 2) ? pad + tf.fx * (W - pad * 2) : W / 2,
      y: (H > pad * 2) ? pad + tf.fy * (H - pad * 2) : H / 2,
      r: rr,
    };
  }

  /* The first target of a round lands in the middle. A cold beginner's
     very first tap should be a target that is obviously there and
     obviously reachable — a corner-spawned first item reads as the drill
     being unfair before they have any idea what fair looks like here.
     From the second on, anywhere: difficulty ramps WITHIN the round. */
  function nextTarget(idx) {
    target = idx ? { fx: Math.random(), fy: Math.random() }
                 : { fx: 0.4 + Math.random() * 0.2, fy: 0.4 + Math.random() * 0.2 };
  }

  /* Says the verb and the goal in the words for the thing actually drawn,
     so the first screen teaches without the how-to being opened. On the
     very first screen it also says how the drill MARKS you: "tap the
     centre dot" is the verb, but nothing on a bare ring says whether a
     near miss is worth 90 or nothing at all, and that is the one rule a
     beginner needs before their first attempt rather than after it. One
     clause, on the opening screen only — from item two on, the reveals
     have been teaching it in numbers. */
  function itemHint(idx, teachGoal) {
    var s = 'Target ' + (idx + 1) + ' of ' + TARGETS_PER_ROUND + ' — tap the centre dot.';
    return teachGoal ? s + ' The closer you land, the more it scores.' : s;
  }

  function newRound() {
    round += 1;
    targetIdx = 0;
    accuracies = [];
    marks = [];
    playing = true;
    lastScore = null;
    clearReveal();        /* a queued advance from the abandoned round must not fire */
    nextTarget(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();          /* the last round's score must not hang over this one */
    hint.textContent = itemHint(0, revealsSeen === 0);
    draw();
  }

  /* ---- the sheet, in words ----
     The canvas is `role="img"`, so its accessible name IS the picture to
     anyone who cannot see it — and a name fixed at boot ("GAME_NAME drill
     area") describes a blank rectangle for the whole session. It says what
     was actually painted instead, refreshed from draw() so the two can
     never drift apart. NOT a live region: a name is spoken when the player
     navigates onto the element, so this costs no announcement and never
     competes with the hint line, which is the drill's ONE spoken channel.
     The write is guarded because a drill that paints per pointer sample
     calls draw() sixty times a second. */
  var sheetName = '';
  var lastScore = null;     /* the round-end number, for the name only */

  function describeSheet() {
    var txt;
    if (reveal) {
      /* Held to the same bar as the scoring functions: total. This runs
         inside draw(), which runs inside the pointer handler, so a throw
         here would not just garble a sentence — it would stop the canvas
         painting and leave the round dead under the player's finger. And a
         name is READ ALOUD: "NaN out of 100" is worse than saying nothing. */
      var words = String(reveal.words || 'off the mark').toLowerCase();
      var pct = isFinite(reveal.acc) ? ', ' + Math.round(reveal.acc) + ' out of 100.' : '.';
      txt = 'Drill sheet: target ' + targetIdx + ' of ' + TARGETS_PER_ROUND +
            ' in ' + sheetZone(reveal.tf && reveal.tf.fx, reveal.tf && reveal.tf.fy) +
            ', with your mark beside it — ' + words + pct;
      /* `isFinite(null)` is true — null coerces to 0 — so the null check has
         to come first or a fresh round says "Round done: null out of 100". */
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else if (playing && target) {
      txt = 'Drill sheet: target ' + (targetIdx + 1) + ' of ' + TARGETS_PER_ROUND +
            ', a ring with a centre dot, in ' + sheetZone(target.fx, target.fy) + '.';
    } else {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    describeSheet();       /* the name and the picture leave from the same place */
    /* The reveal owns the canvas while it is up: one live target and one
       ghost of the last would just be two rings to choose between. */
    if (reveal) { drawReveal(c, reveal); return; }
    if (!playing) return;
    var t = targetAt(target);
    if (t) drawTarget(c, t);
  }

  /* Every ring here carries meaning — this is the thing being aimed at — so
     it is drawn in `mark`, not in the raw `accent` wash. See inks(). */
  function drawTarget(c, t) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /* The truth over the attempt, with the gap between them drawn as the
     thing it is. This is the pattern every drill owes its player after
     EVERY item, not just at round end — replace the geometry, keep the
     idea: what you did, what was right, and the distance named. */
  function drawReveal(c, rv) {
    /* The stored radius, not the live one — see targetAt(). */
    var t = targetAt(rv.tf, rv.r);
    if (!t) return;
    /* The mark is placed by the offset that was SCORED, so the gap on screen
       is always the gap the number and the words describe, whatever the
       canvas has done since. Kept on the sheet after a hard shrink: the
       dashed line still points the right way, and a mark drawn off the edge
       is no reveal at all. */
    var px = t.x + (isFinite(rv.dx) ? rv.dx : 0);
    var py = t.y + (isFinite(rv.dy) ? rv.dy : 0);
    /* Clamped by the mark's OWN outer edge, not by its centre. The mark is
       a radius-6 circle stroked at lineWidth 2, so its ink reaches 7px out;
       holding the centre 4px in still cut 3px off the ring whenever a tap
       landed near the sheet's edge — and a reveal whose mark is sliced by
       the border is the one reveal a player cannot read the direction off.
       Guarded like targetAt(): a canvas too small to hold the mark at all
       centres it rather than clamping past itself. */
    var MARK_EDGE = 7;
    px = (W > MARK_EDGE * 2) ? Math.max(MARK_EDGE, Math.min(W - MARK_EDGE, px)) : W / 2;
    py = (H > MARK_EDGE * 2) ? Math.max(MARK_EDGE, Math.min(H - MARK_EDGE, py)) : H / 2;
    /* The scale the number is measured on, drawn faintly — where the score
       runs out. Without it the only circle on the sheet is the ring you AIM
       at, which is a different size for a different reason (startRadius vs
       ease): landing exactly on the drawn ring is 75 out of 100 on a mouse,
       51 on a pen tablet and 50 on a finger. A player reading a 62 has
       nothing else on screen to read it against — and before zeroPoint()
       took the acquisition floor, that same landing was 75 against 16, the
       two knobs ranking the hardware in opposite orders in the one picture
       meant to explain the number. Reveal only — during play it would be a
       second ring to
       aim at, and the aim ring is the one that matters then. Taken from the
       reveal, not from ease() again — see the note where it is stored. */
    var zr = (isFinite(rv.zero) && rv.zero > 0) ? rv.zero : zeroPoint();
    if (isFinite(zr) && zr > t.r + 3) {
      ctx.save();
      /* "Faint" is a look, not a licence to be unreadable. This ring is the
         scale the printed number was measured on — the how-to names it, so
         it carries information and owes 3:1 like every other mark. At the
         0.4 alpha it started life with, muted composited to 1.74:1 on paper
         and 2.02:1 in the night studio: a player was told to read their
         mark against a ring they could not see. 0.85 measures 3.8:1 on the
         card and still 3.3:1 over the darkest dot of the grid it crosses,
         and the dash plus the 1.5px stroke keep it clearly subordinate to
         the solid 2px target ring. */
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.muted;
      ctx.beginPath();
      ctx.arc(t.x, t.y, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.ink;                 /* what you were aiming at */
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;                     /* where you landed */
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ---- input → accuracy → score ----
     MAP THROUGH THE CONTENT BOX, not the rect. css/style.css sets
     `* { box-sizing: border-box }` and gives .game-canvas a 1px border, so
     getBoundingClientRect() measures the BORDER box while the bitmap is
     painted into the CONTENT box — two pixels narrower and two shorter. The
     bare `clientX - rect.left` therefore disagrees with the drawing space it
     is compared against, by the border at one edge and by the accumulated
     stretch at the other: on a 1100px sheet a tap landing EXACTLY on the
     drawn dot reads as 1.26px out, which is 97 out of 100 on the pen
     profile. A drill whose 100 depends on where the target happened to spawn
     is not scoring the hand, and it fails the "100 must be possible" rule in
     GAME_GUIDE.md at every position but the middle of the sheet.
     clientWidth/clientHeight ARE the content box, and they are free here —
     the getBoundingClientRect() above has already flushed layout for them.
     A drill with no border gets bx = by = 0 and a scale of exactly 1, so
     this is the plain subtraction again wherever the plain subtraction was
     right. Guarded: a canvas laid out at zero must not divide by zero. */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    var cw = canvas.clientWidth || rect.width;
    var ch = canvas.clientHeight || rect.height;
    /* what sits between the two boxes is the border, even on every sheet in
       the arcade — half of the difference is the left/top one */
    var bx = (rect.width - cw) / 2, by = (rect.height - ch) / 2;
    return {
      x: (cw > 0) ? (ev.clientX - rect.left - bx) * W / cw : 0,
      y: (ch > 0) ? (ev.clientY - rect.top - by) * H / ch : 0,
    };
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* Only a press that MEANS "here". A right-click on the canvas is a
       pointerdown like any other — primary pointer, real coordinates — so it
       used to burn an item and score wherever the cursor happened to be,
       while the context menu opened over the reveal explaining it. Same for
       a middle-click, and for a pen's barrel button. Nothing is punished for
       a UI reason: ignore it, do not count it. (`button` is 0 for a finger
       and for a pen's tip, so touch and pen are untouched; an event that
       carries no `button` at all still passes.) Tested FIRST, because it is
       the one press whose browser default is still wanted. */
    if (ev.button > 0) return;
    /* Cancelled for every press the sheet ACCEPTS and every press it
       IGNORES alike. A canvas is never a text surface, and the ignored
       presses are the ones a beginner makes most: the reveal owns the sheet
       for 1800ms — 6.3s on the first one — which is exactly long enough for
       an impatient hand to press and drift a few pixels. Left to the
       browser, that gesture drags a text selection across the hint line and
       the HUD, and on a touch screen it is a long-press callout over the
       very picture the beat exists to let them read. The press is still not
       counted; it simply stops fighting the hand. Cancelling a press this
       drill ignores costs nothing — the canvas has no text, no drag and no
       tabindex to lose. */
    ev.preventDefault();
    /* A PALM IS NOT AN ATTEMPT. An artist rests the heel of the hand on the
       glass and the nib lands a moment after it, so first-contact-wins hands
       the item to the wrist: the target burns on a tap nobody made, scored
       at whatever distance the palm happened to land, and the pen that was
       about to make the real one arrives to find the reveal already up. The
       SDK owns the test rather than each drill, because it is the only thing
       that sees a nib HOVERING — a guard fed by this canvas's own events
       goes blind the moment the nib lifts, which is precisely when the palm
       is still down (ArtDaily.isPalm). Ignored, never counted against them,
       exactly like the right-click above; a finger-only player is never once
       tested against a pen.
       (The `typeof` is a SYNC GUARD, not a pattern to copy: every drill
       folder vendors its own byte-identical copy of the SDK, and this call
       landed in the canonical file first. Once the copies are re-synced it is
       dead weight — write the plain `if (ArtDaily.isPalm(ev)) return;` in
       your drill, and delete this one when the vendored copy catches up.) */
    if (typeof ArtDaily.isPalm === 'function' && ArtDaily.isPalm(ev)) return;
    /* Second finger of a two-finger tap must not burn a second target,
       and neither may a tap that lands while the previous reveal is still
       up — the next target has not been drawn yet, so there is nothing it
       could honestly be judged against. Ignored, never counted against
       them: nothing is ever punished for a UI reason. */
    if (!playing || !target || reveal || ev.isPrimary === false) return;
    var t = targetAt(target);
    var p = pointerPos(ev);
    var dx = p.x - t.x, dy = p.y - t.y;
    var d = Math.hypot(dx, dy);
    /* Zero-point through the SDK, so an honest miss reads as an honest
       miss on a pen, a trackpad and a finger alike. */
    var zero = zeroPoint();
    var acc = tapAccuracy(d, zero);
    accuracies.push(acc);
    marks.push({ dx: dx, dy: dy });
    targetIdx += 1;
    var seen = revealsSeen;      /* reveals shown BEFORE this one, this sitting */
    revealsSeen += 1;
    var words = missPhrase(dx, dy, zero);
    /* The sentence is built BEFORE the beat, because the beat is budgeted
       from it — see revealBeat. The dotted ring appears for the first time
       UNDER this line, and an unexplained new circle is jargon that happens
       to be drawn instead of written. Named once, on the spot, on the only
       screen where it is new — the third first-thirty-seconds question in
       GAME_GUIDE.md applies to what you draw, not only to what you type. */
    var line = tapWords(words, acc) + '.' +
      (seen ? '' : ' The dotted ring is where a tap stops scoring.');
    reveal = {
      tf: target,
      dx: dx,
      dy: dy,
      /* The ring that was actually on screen when the tap landed. Frozen
         for the same reason `zero` below is: whether the mark sits inside
         or outside it is the first thing the picture says, and the hardware
         (and the canvas) can both change while the reveal is being read. */
      r: t.r,
      /* The zero-point is kept WITH the mark, for the same reason the mark
         is kept as an offset: the reveal outlives the moment it was scored,
         and the dotted ring is the scale the printed number was measured
         on. ease() answers for the hardware in use NOW, and the hardware
         can change while the reveal is up — a pen plugged in at the end of
         a round fires onInput, which repaints, and the ring would redraw at
         half its size with "A little low — 61" still printed under it. The
         number is history; the scale it was measured against is history
         too, and history does not get re-judged. */
      zero: zero,
      words: words,
      acc: Math.round(acc),   /* what the picture is worth, for describeSheet() */
      /* The beat is kept WITH the reveal so the pause/resume below can hand
         back the same budget it interrupted, rather than recomputing one —
         and so it is budgeted against the sentence that is actually up. */
      beat: revealBeat(seen, line),
    };
    hint.textContent = line;
    draw();
    /* The last tap does NOT wait on the beat: finishing is synchronous, so
       report() cannot be raced by "new round" landing during the reveal.
       The reveal simply stays on the canvas behind the score. */
    if (targetIdx >= TARGETS_PER_ROUND) { finishRound(); return; }
    revealTimer = setTimeout(nextItem, reveal.beat);
  });

  /* A hidden tab is not a reading player. Background timers keep running
     (throttled, never cancelled), so a reveal that is alt-tabbed away from
     is spent on a tab nobody is looking at: the player comes back to the
     next target with the lesson already wiped — the exact failure the beat
     budget above exists to prevent, only total. Park the advance while the
     page is hidden and hand the beat back in full on return.
     This timer can never file a round: it only advances an ITEM, and the
     last item finishes synchronously (see finishRound). The re-arm is
     guarded on `playing`, so a round-end reveal — which is meant to stay up
     until "new round" — is never advanced past. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    /* `|| REVEAL_MS` because a setTimeout handed `undefined` fires on the
       next tick — a reveal built without a beat would come back from a
       hidden tab and vanish instantly, which is the bug this exists to fix
       wearing a disguise. */
    if (playing && reveal && revealTimer === null) {
      revealTimer = setTimeout(nextItem, reveal.beat || REVEAL_MS);
    }
  });

  function nextItem() {
    revealTimer = null;
    if (!playing) return;     /* the round was abandoned while the reveal was up */
    reveal = null;
    nextTarget(targetIdx);
    hint.textContent = itemHint(targetIdx, false);
    draw();
  }

  /* A number on its own is not a reveal, and "new best!" on the very first
     round celebrates nothing — it is true of every player's first round
     ever played, fired on the one round where they most need to be told
     what the number MEANS. So the first round says what the score is FOR
     and what to do next; after that the primary button speaks for itself.
     The last tap keeps its words here too: item five is an attempt like
     any other and is owed the same reveal as items one to four. And the
     round's own correction goes last, when there is one — the per-item
     words fix the next tap, the bias line fixes the next round.
     `last` arrives already carrying its own NUMBER (see tapWords): a bare
     "Way out, low and right. Round done — 74 out of 100." reads as though
     74 were what that last tap was worth. */
  function roundWords(res, last, bias) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = bias ? ' ' + bias : '';
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  function finishRound() {
    playing = false;                  /* set first: report() fires exactly once */
    target = null;
    clearTimeout(revealTimer);        /* nothing may advance past a finished round */
    revealTimer = null;
    draw();                           /* the last tap stays up as the reveal */
    var res = ArtDaily.report(roundScore(accuracies));
    /* The picture has not changed — only what is known about it has, and the
       score is not known until report() answers. Re-name without repainting. */
    lastScore = res.score;
    describeSheet();
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The habit is graded against the tolerance the ROUND was scored under,
       taken from the reveal that is still on screen — not from ease() again.
       A pen plugged in during the last item halves the live zero-point, and
       the bias line would then re-judge five finished taps against a
       tolerance none of them were scored with: the same "history does not
       get re-judged" rule the reveal's dotted ring already follows. */
    hint.textContent = roundWords(res, reveal && tapWords(reveal.words, reveal.acc),
                                  roundBias(marks, (reveal && reveal.zero) || zeroPoint()));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* The toast is a STICKER, not a second voice. It says nothing the hint line
     has not already said in a fuller sentence one statement earlier, and both
     used to be aria-live="polite" regions written in the same tick — so a
     screen-reader player heard the round's correction and then, queued behind
     it, "score 84 / 100" again. One drill, one spoken channel: the hint line.
     The toast is aria-hidden in index.html; keep it that way, and if your
     drill ever puts something in here that the hint does NOT say, move it to
     the hint instead. */
  function showToast(msg, celebrate) {
    clearTimeout(toastTimer);
    toast.hidden = false;
    toast.textContent = '';
    var s = document.createElement('span');
    s.className = celebrate ? 'toast-accent' : '';
    s.textContent = msg;
    toast.appendChild(s);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  /* ---- chrome wiring ---- */
  document.getElementById('btnRound').addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  /* The ink cache above is keyed on the theme, so it self-heals; dropping
     it here as well means a drill that later reads an ink from somewhere
     other than draw() cannot be caught holding yesterday's colour. */
  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session; the ring is sized from it. */
  ArtDaily.onInput(draw);

  /* Both resize sources fire in bursts for a single drag, and a fit that
     really changes size REALLOCATES the canvas backing store — the most
     expensive thing in this file, plus a full clear on top. So measure and
     repaint at most once a frame, and only when the size actually moved.
     A drill that draws STROKES should coalesce the same way: the browser
     delivers pointermove faster than it paints, so a repaint per sample is
     several full-canvas washes per frame with all but one thrown away, and
     each one is main-thread time the next sample waits behind. Take the
     samples themselves at full rate — ArtDaily.samples(ev) — and only the
     PAINTING once a frame: fidelity and repaint cost are separate
     questions and the honest answer differs for each. The tap handler
     above still paints inline: the press that just landed is the one frame
     that must not wait for anything. */
  function raf(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () { fitPending = false; if (fitCanvas()) draw(); });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches the case window.resize cannot: the canvas
     measuring 0 at boot (opened in a background tab, or laid out late) and
     getting its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
