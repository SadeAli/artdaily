/* ============================================================
   game.js — Counterweight. A picture frame already holds one to
   three flat masses, all pulling the composition to one side. One
   more shape waits in the tray under the frame: put it where the
   picture stops leaning.

   The lesson is the oldest rule in pictorial composition and the
   one a beginner never believes until they see it drawn: a shape
   pulls by its WEIGHT (how big it is × how strongly it reads
   against the paper) times its ARM (how far it sits from the
   middle of the frame). So a small pale shape has to sit much
   further out than a big dark one, and the commonest beginner
   error is not "wrong side" — it is placing the counterweight far
   too close to the middle, because the arm is the half of the rule
   nobody feels. The round-end line names exactly that habit.

   The ground truth is not eyeballed. Balance is a moment sum:
   Σ wᵢ(pᵢ − C) + w(p − C) = 0 has exactly ONE solution for the new
   shape's position, and balanceSpot() below is that solution,
   solved per axis (the equation is separable, so working in frame
   fractions and working in pixels are the same arithmetic). The
   item generator runs the SAME pure function the score uses, so
   the answer it validates is the answer it grades.

   Skeleton follows the template: init → round → input → REVEAL →
   score → ArtDaily.report, one theme-aware canvas, no libraries.
   Geometry lives in FRAME fractions so a phone rotated mid-round
   keeps its round; the reveal's mark is the pixel offset that was
   scored, and the reveal's sizes — the answer ring and the dotted
   scale — are frozen with it, so nothing the player has not done
   can change the picture under a printed number.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'counterweight';
  var FRAMES_PER_ROUND = 4;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     PURE START — geometry, scoring and every word the drill says
     about an error. No canvas, no DOM, no module state: numbers in,
     numbers (or a string) out, so the whole block lifts straight
     into node and can be hammered with degenerate input. Two rules
     everything here holds:
       · finite 0–100 (or a usable string) for ANY input — empty
         arrays, zero sizes, NaN, a zero weight, a truth sitting
         exactly on the pivot. Never NaN, never a throw: a NaN loses
         every comparison it touches, so one leak scores the whole
         round 0 in silence and report() files it as a bare 0 the
         player cannot explain.
       · monotonic in the error: more wrong can never score higher.
     ============================================================ */

  /* The sheet and the picture inside it, as fractions. The frame is
     inset on all four sides and a TRAY is left under it, because the
     shape being placed has to be visible — its size and its darkness
     ARE the question — before anyone commits it to the picture. */
  var ASPECT = 0.70;                                     /* canvas height ÷ width */
  var FRAME = { x0: 0.09, y0: 0.05, x1: 0.91, y1: 0.71 };  /* of W, of H */
  var TRAY_FY = 0.855;                                   /* the waiting shape, of H */
  /* Frame height ÷ frame width. A distance is isotropic in pixels but not
     in frame fractions, so every "how far from the middle" below converts
     the y fraction through this. Derived, never hand-typed twice. */
  var FR_ASPECT = ((FRAME.y1 - FRAME.y0) * ASPECT) / (FRAME.x1 - FRAME.x0);

  var A_MIN = 0.006, A_MAX = 0.028;   /* mass area, in (frame width)² units */
  var DARK_MIN = 0.40, DARK_MAX = 1.0;

  /* The zero-point, as a fraction of the FRAME WIDTH. The unit of a
     composition judgement is the picture, not the screen: the same frame on
     a phone and on a desktop has to be the same drill. A pixel floor sits
     under it (see zeroPoint) so a hand's own noise can never dominate on a
     small sheet — the rule GAME_GUIDE.md states for every relative
     tolerance. At 0.26: a placement 5% of the frame's width out scores 81,
     10% out 62, 20% out 23, and a shape flung anywhere in the frame at
     random averages under 10. */
  var REL_TOL = 0.26;

  function clamp(v, lo, hi) {
    var n = Number(v);
    if (!isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /* Visual weight: area × how strongly the shape reads against the paper.
     Both halves matter and beginners only ever count the first, which is
     why the drill varies them independently. Total: junk in, 0 out — a
     weightless shape simply pulls on nothing. */
  function massWeight(a, dark) {
    var A = Number(a), d = Number(dark);
    if (!isFinite(A) || A <= 0 || !isFinite(d) || d <= 0) return 0;
    return A * Math.min(1, d);
  }

  /* THE GROUND TRUTH. Where the new shape of weight `w` has to sit so the
     moments about the pivot C cancel:
         Σ wᵢ(pᵢ − C) + w(p − C) = 0   ⟹   p = C − Σ wᵢ(pᵢ − C) / w
     Separable per axis, so frame fractions and pixels give the same answer
     (each axis is the other scaled by a constant). Total: no masses, a zero
     or non-finite weight, junk coordinates — every one of them falls back
     to the pivot, which is exactly where a shape with nothing to counter
     belongs. */
  function balanceSpot(masses, w, cx, cy) {
    var px = Number(cx), py = Number(cy);
    if (!isFinite(px)) px = 0.5;
    if (!isFinite(py)) py = 0.5;
    var wn = Number(w);
    if (!isFinite(wn) || wn <= 0) return { x: px, y: py };
    var mx = 0, my = 0;
    if (masses && masses.length) {
      for (var i = 0; i < masses.length; i++) {
        var m = masses[i];
        if (!m) continue;
        var wi = massWeight(m.a, m.dark);
        var x = Number(m.x), y = Number(m.y);
        if (!isFinite(wi) || wi <= 0 || !isFinite(x) || !isFinite(y)) continue;
        mx += wi * (x - px);
        my += wi * (y - py);
      }
    }
    var bx = px - mx / wn, by = py - my / wn;
    if (!isFinite(bx) || !isFinite(by)) return { x: px, y: py };
    return { x: bx, y: by };
  }

  /* Where everything ALREADY in the picture pulls from — the weighted
     centroid of the existing masses. Only the reveal needs it (it is the
     far end of the lever line), but it is up here because it is the same
     arithmetic as the truth and must be as total. Null when there is
     nothing to average, which the caller draws as "no lever to show". */
  function loadSpot(masses) {
    if (!masses || !masses.length) return null;
    var w = 0, sx = 0, sy = 0;
    for (var i = 0; i < masses.length; i++) {
      var m = masses[i];
      if (!m) continue;
      var wi = massWeight(m.a, m.dark);
      var x = Number(m.x), y = Number(m.y);
      if (!isFinite(wi) || wi <= 0 || !isFinite(x) || !isFinite(y)) continue;
      w += wi; sx += wi * x; sy += wi * y;
    }
    if (!(w > 0)) return null;
    var ox = sx / w, oy = sy / w;
    if (!isFinite(ox) || !isFinite(oy)) return null;
    return { x: ox, y: oy, w: w };
  }

  /* The scale the score is measured on: a fraction of the frame, floored by
     what the hand itself can do. Never 0 and never non-finite, so no caller
     can divide by it and get a NaN. */
  function zeroPoint(frameW, floorPx) {
    var fw = Number(frameW), fl = Number(floorPx);
    var rel = (isFinite(fw) && fw > 0) ? fw * REL_TOL : 0;
    var flo = (isFinite(fl) && fl > 0) ? fl : 0;
    var z = Math.max(rel, flo);
    return (isFinite(z) && z > 0) ? z : 1;
  }

  /* 100 on the spot, 0 at `zero` px out or beyond. Linear, so the score is
     monotonic in the error by construction and the words below can be cut
     where it changes character. */
  function placeAccuracy(dist, zero) {
    if (!isFinite(dist) || !isFinite(zero) || zero <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - Math.abs(dist) / zero) * 100));
  }

  /* Mean of the round's frames. A round that somehow ends with nothing
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

  /* ---- ONE ladder of sizes for the whole drill ----
     The per-frame words and the round's correction are cut at the SAME
     fractions of the SAME tolerance and spend the same five words, so the
     player learns what "a little" is worth once and the round's correction
     can then use it as a unit. Cut where the SCORE changes character, not
     at tidy fractions of the tolerance — the adjective is printed in the
     same sentence as the number, and "a hair off — 71" reads as the drill
     lying to you. As scores: 92+ spot on · 75+ a hair · 50+ a little ·
     20+ well · under 20 way.
     Total: junk in, the WIDEST word out, never the flattering one. A
     magnitude must ARRIVE as a number — Number(null), Number(''),
     Number(false) and Number([]) are every one of them 0, so a coerced
     measurement that never happened would land on the top rung. */
  function sizeWord(d, z) {
    if (typeof d !== 'number' || typeof z !== 'number') return 'well';
    var m = d, t = z;
    /* A magnitude is never negative: a negative one means the caller handed
       over a signed delta by mistake, and the flattering answer to a broken
       measurement is the dangerous one. */
    if (!isFinite(m) || m < 0 || !isFinite(t) || t <= 0) return 'well';
    if (m <= t * 0.08) return 'dead on';
    if (m <= t * 0.25) return 'a hair';
    if (m <= t * 0.5) return 'a little';
    if (m < t * 0.8) return 'well';
    return 'way';
  }

  /* Which way the placement missed, in the words this drill's lesson is
     made of. The lever gives three of them and they are the ones worth
     printing, because they are corrections a hand can execute:
       · "on the heavy side"  — past the pivot, back where the load already
                                is. The one miss worth naming before size.
       · "too near the middle" / "too far out" — the arm, which is the half
                                of the rule beginners never feel.
     A miss that is mostly sideways to the lever has no lever word, so it
     falls back to plain compass directions. Canvas y grows downward, so a
     negative dy is HIGH.
     dx,dy = placement − truth. ax,ay = placement − pivot. ux,uy = the unit
     lever direction (pivot → truth). Total for every one of them. */
  function missDirection(dx, dy, ax, ay, ux, uy) {
    var x = Number(dx), y = Number(dy);
    if (!isFinite(x) || !isFinite(y)) return '';
    if (x === 0 && y === 0) return '';
    var lx = Number(ux), ly = Number(uy);
    /* A usable lever is a unit vector; anything shorter than half a unit
       means the truth sat on the pivot and there is no arm to talk about. */
    if (isFinite(lx) && isFinite(ly) && (lx * lx + ly * ly) > 0.25) {
      var px = Number(ax), py = Number(ay);
      if (isFinite(px) && isFinite(py) && (px * lx + py * ly) < 0) return 'on the heavy side';
      var along = x * lx + y * ly;
      var across = Math.abs(x * -ly + y * lx);
      if (Math.abs(along) > across * 1.6) return along < 0 ? 'too near the middle' : 'too far out';
    }
    var mx = Math.abs(x), my = Math.abs(y);
    var v = y < 0 ? 'high' : 'low';
    var h = x < 0 ? 'left' : 'right';
    if (my > mx * 2.5) return v;
    if (mx > my * 2.5) return h;
    return v + ' and ' + h;
  }

  /* Graded against the SAME zero-point the score uses, so the words and the
     number can never disagree. The two big bands carry "off" so the
     direction reads as a clause — "Way off, too near the middle" — instead
     of the word salad a bare adjective makes of it. "Spot on" rather than
     "dead centre": the centre of the frame is the pivot in this drill and
     is very often the WRONG answer, so it is the one phrase that must not
     double as praise. Total: NaN, a zero tolerance and a zero-length miss
     all come back a usable sentence. */
  function missPhrase(dx, dy, ax, ay, ux, uy, zero) {
    var d = Math.hypot(Number(dx), Number(dy));
    if (!isFinite(d)) return 'Off the mark';
    /* Number(...) and not the bare value: isFinite('88') is true, so a
       tolerance handed over as a numeric string would reach sizeWord as a
       string. It grades numbers. */
    var z = (isFinite(zero) && zero > 0) ? Number(zero) : 1;
    var much = sizeWord(d, z);
    if (much === 'dead on') return 'Spot on';
    var dir = missDirection(dx, dy, ax, ay, ux, uy);
    if (much === 'well' || much === 'way') {
      var head = (much === 'way' ? 'Way' : 'Well') + ' off';
      return dir ? head + ', ' + dir : head;
    }
    var lead = much.charAt(0).toUpperCase() + much.slice(1);
    return dir ? lead + ' ' + dir : lead + ' out';
  }

  /* The per-frame sentence: the words and the number always travel TOGETHER,
     in that order. A number alone is not a reveal, and words alone leave the
     player unable to place the correction on the scale the HUD and the
     round-end line both use. Total — a non-finite accuracy drops the number
     rather than printing "NaN out of 100" into a live region that gets read
     out loud. */
  function frameWords(words, acc) {
    /* Only a real, non-empty STRING counts as words: [] and {} are truthy,
       so String(x || fallback) would print "" and "[object Object]" into a
       line that is read aloud. */
    var head = (typeof words === 'string' && words.trim()) ? words : 'Off the mark';
    var n = Number(acc);
    if (!isFinite(n)) return head;
    return head + ' — ' + Math.round(Math.max(0, Math.min(100, n))) + ' out of 100 for that frame';
  }

  /* ---- the round's lesson, which no single frame can show ----
     Four placements that all fall short of the arm are not four random
     misses, they are THE habit this drill exists to catch: the arm is the
     half of the balance rule nobody feels, so a beginner reliably tucks the
     counterweight in toward the middle. Naming it is the only correction
     that outlives the round.

     Measured along the lever and in TOLERANCE UNITS, because every frame is
     graded against its own zero-point and a raw pixel mean would let a wide
     frame outvote a narrow one. `u` is (placement − truth)·lever ÷ zero:
     positive is too far out, negative is too near the middle.

     Gated on CONTRADICTION, not on majority — it fires only when not one
     placement went the other way. A mean grows with the SCATTER, so a gate
     that only weighs it against a fixed fraction of the tolerance gets
     EASIER to clear the wilder the round is, and the beginner spraying the
     frame is the one most reliably handed an invented habit. Requiring an
     empty other side makes the line a description of what happened rather
     than an inference about the player, and a description cannot become a
     superstition.

     THE MAGNITUDE HALF OF THE GATE IS 0.15 HERE AND NOT THE TEMPLATE'S 0.10,
     because this drill's round is four frames and the template's is five
     taps. Unanimity is a weaker filter the shorter the round: four
     coin-flips land the same way 2·2⁻⁴ = 12.5% of the time against 6.25% for
     five, so the by-chance ceiling doubles and the size half has to carry
     more. Measured over 200k rounds of pure scatter with no habit in them at
     all, the raised gate takes a tight round from 8.0% to 3.0% and a middling
     one from 11.6% to 9.1%, while a genuine drift still fires on 79–98%
     against the old gate's 82–98% — which is the entire price. At very large
     scatter both gates sit at the 12.5% ceiling, and that is honest: when it
     fires there, all four placements really did land the same side of the
     mark, which is exactly what the sentence says. The printed word stays
     "most", true a fortiori — a gate stronger than its sentence promises is
     the safe direction for the one line a player is asked to ACT on.

     Pure and total: junk marks, a short round and an empty array all come
     back '' — meaning "there is nothing honest to say", which the caller
     must treat as silence rather than print. */
  function roundBias(marks) {
    if (!marks || !marks.length) return '';
    var n = 0, sum = 0, out = 0, inward = 0;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m) continue;
      var u = Number(m.u);
      if (!isFinite(u)) continue;
      n++; sum += u;
      if (u > 0) out++; else if (u < 0) inward++;   /* counted, never signed: a
                                                       placement exactly on the
                                                       lever contradicts nothing */
    }
    if (n < 3) return '';            /* too few to call anything a habit */
    var mean = sum / n;
    if (!isFinite(mean) || Math.abs(mean) < 0.15) return '';
    if (mean > 0 && inward > 0) return '';
    if (mean < 0 && out > 0) return '';
    /* HOW FAR, in the same five words the round's reveals just spent
       teaching. "Push them further out" is a direction, and a hand cannot
       act on a direction without a size, so the player invents one — which
       is how a corrected habit turns into an overcorrected one. The gate
       above is 0.15 of the tolerance and the ladder's top rung ends at 0.08,
       so this can never come back "push them dead on further out". */
    var much = sizeWord(Math.abs(mean), 1);
    if (mean < 0) {
      return 'Most shapes landed too near the middle — push them ' + much +
             ' further out next round; a light shape needs a long arm.';
    }
    return 'Most shapes landed too far out — bring them ' + much +
           ' closer in next round.';
  }

  /* ---- where something sits, in words (pure, total) ----
     Only the canvas knows where anything is, and a canvas is a blank to
     anyone who cannot see it. This feeds the sheet's accessible name — see
     describeSheet(). Junk fractions come back a usable phrase, never NaN. */
  function sheetZone(fx, fy) {
    var x = Number(fx), y = Number(fy);
    if (!isFinite(x) || !isFinite(y)) return 'the middle of the frame';
    var h = x < 0.36 ? 'left' : x > 0.64 ? 'right' : '';
    var v = y < 0.36 ? 'top' : y > 0.64 ? 'bottom' : '';
    if (!h && !v) return 'the middle of the frame';
    return 'the ' + (v && h ? v + ' ' + h : v || h) + ' of the frame';
  }

  /* The shape being placed, said out loud — it is the whole question, so
     the hint line names it and the accessible name repeats it. Total. */
  function shapeWords(t) {
    if (!t) return 'shape';
    var a = Number(t.a), d = Number(t.dark);
    var size = !isFinite(a) ? '' : (a < 0.012 ? 'small ' : (a < 0.021 ? 'mid-sized ' : 'big '));
    var tone = !isFinite(d) ? '' : (d < 0.58 ? 'pale ' : (d < 0.80 ? 'mid-tone ' : 'dark '));
    var kind = t.kind === 'block' ? 'square' : (t.kind === 'bar' ? 'bar' : 'disc');
    return size + tone + kind;
  }

  /* Half-extents of a mass, in FRAME-WIDTH units, from its area alone — the
     three kinds carry the same weight in visibly different outlines, so
     nobody can read weight off one dimension. Total: junk area comes back a
     speck rather than a NaN nothing can be clamped against. */
  function massExtent(kind, a) {
    var A = Number(a);
    if (!isFinite(A) || A <= 0) A = 0.0001;
    if (kind === 'block') { var s = Math.sqrt(A); return { ex: s / 2, ey: s / 2 }; }
    if (kind === 'bar') { var h = Math.sqrt(A / 2); return { ex: h, ey: h / 2 }; }
    var r = Math.sqrt(A / Math.PI);
    return { ex: r, ey: r };
  }

  function massReach(kind, a) {
    var e = massExtent(kind, a);
    return Math.hypot(e.ex, e.ey);
  }

  /* ---- the beat, budgeted against the reading ----
     A reveal wiped before it can be read is not a lesson, it is decoration:
     the drill does the whole job of teaching and then deletes it. Measure
     the text that is NEW on that screen at ~200 words a minute — a beginner
     reading unfamiliar copy while also looking at a picture, and about the
     rate a screen reader speaks the same line out of #hint, which is this
     drill's one live region. Words, not tokens: an em dash is a pause, so
     counting it buys 300ms of budget for a character nobody reads aloud. */
  var MS_PER_WORD = 60000 / 200;
  var REVEAL_MS = 1800;             /* the clause that changes every frame */
  var FIRST_REVEAL_MIN_MS = 4000;   /* a floor, not the budget */

  function readingMs(text) {
    var parts = String(text === null || text === undefined ? '' : text).split(/\s+/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (/[0-9a-z]/i.test(parts[i])) n++;
    return n * MS_PER_WORD;
  }

  /* Pure, so the pacing can be reasoned about — and tested — without a
     canvas. `seen` is how many reveals this SITTING has already shown, not
     how far into a round we are and not which round it is.
     On the FIRST reveal nothing on screen is furniture yet: a frame, a
     ghost, a ring, a dotted circle, a lever and a sentence, all new at once
     — so that one is budgeted against the WHOLE line. From the second on,
     only the clause inside the sentence is new (the rest the eye already
     knows), so the baseline is REVEAL_MS — plus, when the line carries a
     one-off note, however long that NOTE takes to read. This drill teaches
     the dotted scale on reveal one and the lever on reveal two rather than
     stacking both onto a single nine-second screen. */
  function revealBeat(seen, text, extra) {
    var s = Number(seen);
    if (!isFinite(s) || s <= 0) return Math.max(FIRST_REVEAL_MIN_MS, readingMs(text));
    var ex = readingMs(extra);
    return ex > 0 ? REVEAL_MS + ex : REVEAL_MS;
  }

  /* ============================================================
     PURE END — everything below touches the canvas, the SDK or the
     round's state.
     ============================================================ */

  /* ---- theme-aware inks (read once per THEME, not once per repaint) ----
     `accent` is the decorative wash; `mark` is the same accent mixed toward
     --ink, and it is what ANYTHING CARRYING MEANING on the canvas is drawn
     in — the watercolour accents are decorative-strength on light paper, and
     a shape a player cannot see is not a shape. Defined as --canvas-accent
     below the marker in css/style.css.
     Every one of these is a custom property on :root and the only thing that
     moves them is data-theme, so a read per theme is the same answer as a
     read per repaint minus the cost — and getComputedStyle cannot answer
     until style has been resolved, which on this drill would mean flushing a
     style recalculation on every pointer sample of a drag. An empty read (a
     cold boot with the stylesheet unparsed) is never cached. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sunny').trim();
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
    H = Math.max(1, Math.round(W * ASPECT));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function frameRect() {
    var x = FRAME.x0 * W, y = FRAME.y0 * H;
    return { x: x, y: y, w: Math.max(1, (FRAME.x1 - FRAME.x0) * W), h: Math.max(1, (FRAME.y1 - FRAME.y0) * H) };
  }
  function toPx(p, fr) {
    return { x: fr.x + clampNum(p && p.x, 0.5) * fr.w, y: fr.y + clampNum(p && p.y, 0.5) * fr.h };
  }
  function clampNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  /* ---- the two hardware knobs, kept apart on purpose ----
     They measure DIFFERENT difficulties and rank the hardware in opposite
     orders: ease() is the slack a hand needs to EXECUTE (a mouse pivots at
     the wrist and cannot creep, so it gets the most, ×2.0; a pen the least,
     ×1.0), startRadius() is the slack a hand needs to FIND a spot with the
     hand possibly out of sight (a screenless tablet gets the most, ×1.7; a
     mouse the least, ×1.0). Never one knob's answer fed to the other — the
     product compounds the two factors and inverts the ranking.

     What this drill grades is a JUDGEMENT — where in the picture the shape
     belongs — so the tolerance is a fraction of the frame. But the last
     inch of it is still an act of pointing, and the player who cannot see
     their own hand must not be charged for that: the pixel FLOOR under the
     relative tolerance is the acquisition floor, the larger of the two
     knobs. A max is a floor, never a compound. Both terms are finite and
     positive by the SDK's contract, so the max is too. */
  var BASE_HAND = 14;
  var BASE_RING = 16;

  function handFloor() {
    return Math.max(ArtDaily.ease(BASE_HAND * 2), ArtDaily.startRadius(BASE_HAND * 2));
  }
  /* The ring drawn around the balancing spot in the reveal — the mark the
     eye has to FIND on a sheet that already has shapes on it, which is what
     startRadius sizes. Kept clear of the ghost shape it surrounds, and
     clamped so it can never swallow a small frame. Frozen into the reveal,
     like the scale: once a number is printed nothing may resize the picture
     under it. */
  function answerRing(tokenReachPx, fr) {
    var base = Math.max(tokenReachPx + 9, ArtDaily.startRadius(BASE_RING));
    return Math.max(10, Math.min(base, fr.w / 6));
  }

  /* ============================================================
     THE ITEMS — every frame is generated, validated against the same
     pure balanceSpot() the score uses, and stored in FRAME fractions
     so a rotated phone keeps its round.
     ============================================================ */

  /* Difficulty ramps INSIDE the round, and the first frame is a genuinely
     easier ITEM rather than a kindlier score:
       1 — one mass, the same weight as yours: the answer is its mirror.
       2 — one mass, heavier than yours: your arm has to be twice as long.
       3 — two masses to add up first.
       4 — three masses and YOUR shape is the heavy one, so the arm gets
           SHORTER — the case every instinct gets backwards.
     `k` is the arm multiplier: truth − pivot = −k × (load centroid − pivot),
     which falls straight out of the moment sum when the new weight is the
     load's total ÷ k. */
  var PLAN = [
    { n: 1, k: [1.0, 1.0], aMin: 0.014, aMax: 0.026, r: [0.17, 0.25], jit: 0.22 },
    { n: 1, k: [1.7, 2.3], aMin: 0.016, aMax: 0.028, r: [0.09, 0.17], jit: 0.9 },
    { n: 2, k: [1.2, 2.0], aMin: 0.008, aMax: 0.022, r: [0.10, 0.22], jit: 0.6 },
    { n: 3, k: [0.60, 0.95], aMin: 0.005, aMax: 0.012, r: [0.20, 0.34], jit: 0.5 },
  ];
  var KINDS = ['disc', 'block', 'bar'];
  var ARM_MIN = 0.14, ARM_MAX = 0.38;   /* the answer's distance from the pivot */

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
  function pick(list) { return list[Math.floor(Math.random() * list.length) % list.length]; }

  /* A mass on the lean side of the picture, fitting inside the frame with a
     margin. `th` is the direction the whole item leans in, so several masses
     add up to a real load instead of quietly cancelling each other out; `jit`
     is how far each one may wander off it. A radius is in frame-WIDTH units
     for both axes — the frame is close to twice as wide as it is tall, so a
     vertical offset has to be converted or the item leans by half what it
     looks like. */
  function placeMass(kind, a, th, r, jit) {
    var e = massExtent(kind, a);
    var padX = 0.03 + e.ex, padY = 0.05 + e.ey / FR_ASPECT;
    if (padX >= 0.5 || padY >= 0.5) return null;
    var t = th + rnd(-jit, jit);
    var fx = 0.5 + Math.cos(t) * r;
    var fy = 0.5 + Math.sin(t) * r / FR_ASPECT;
    if (fx < padX || fx > 1 - padX || fy < padY || fy > 1 - padY) return null;
    return { kind: kind, a: a, dark: rnd(DARK_MIN, DARK_MAX), x: fx, y: fy };
  }

  function tryItem(idx) {
    var plan = PLAN[Math.max(0, Math.min(PLAN.length - 1, idx))];
    /* Frame one leans sideways at mid height on purpose: with equal weights
       the answer is the mass's mirror, which is the cleanest possible first
       reading of the rule. The ramp is inside the round, not in the scoring. */
    var th = idx === 0 ? (Math.random() < 0.5 ? 0 : Math.PI) : rnd(0, Math.PI * 2);
    var masses = [];
    for (var i = 0; i < plan.n; i++) {
      var m = placeMass(pick(KINDS), rnd(plan.aMin, plan.aMax), th,
                        rnd(plan.r[0], plan.r[1]), plan.jit);
      if (!m) return null;
      masses.push(m);
    }
    var load = loadSpot(masses);
    if (!load) return null;
    /* The picture has to actually lean, or there is nothing to counter. */
    var lean = Math.hypot(load.x - 0.5, (load.y - 0.5) * FR_ASPECT);
    if (!(lean > 0.06)) return null;

    /* SOLVE for the arm multiplier instead of guessing it. k has to satisfy
       three things at once, and every one of them is a plain interval:
         · the frame's own difficulty band              (plan.k)
         · an answer far enough from the pivot to be a real judgement, and
           near enough to stay on the paper              (arm = k × lean)
         · a new shape whose weight can actually be built out of an area and
           a darkness this drill draws  (w = load ÷ k, and w = a × dark with
           a in [A_MIN, A_MAX] and dark in [DARK_MIN, 1])
       Intersecting them turns what was a rejection-heavy hunt into one draw. */
    var kLo = Math.max(plan.k[0], ARM_MIN / lean, load.w / (A_MAX * DARK_MAX));
    var kHi = Math.min(plan.k[1], ARM_MAX / lean, load.w / (A_MIN * DARK_MIN));
    if (!isFinite(kLo) || !isFinite(kHi) || kLo > kHi || kLo <= 0) return null;
    var k = rnd(kLo, kHi);
    var wt = load.w / k;
    if (!(wt > 0) || !isFinite(wt)) return null;
    /* Split that weight into an area and a darkness that BOTH stay in the
       drill's range: the two halves of visual weight have to vary
       independently or the lesson collapses to "bigger is heavier". The
       bounds on dark come straight from the bounds on area, so this cannot
       fail once k is in range. */
    var dLo = Math.max(DARK_MIN, wt / A_MAX), dHi = Math.min(DARK_MAX, wt / A_MIN);
    if (dLo > dHi) return null;
    var dark = rnd(dLo, dHi);
    var a = clamp(wt / dark, A_MIN, A_MAX);
    var kind = pick(KINDS);
    var token = { kind: kind, a: a, dark: dark };

    /* The SAME pure function the score uses answers where it goes. */
    var truth = balanceSpot(masses, massWeight(a, dark), 0.5, 0.5);
    var e = massExtent(kind, a);
    if (truth.x < 0.04 + e.ex || truth.x > 0.96 - e.ex) return null;
    if (truth.y < 0.05 + e.ey / FR_ASPECT || truth.y > 0.95 - e.ey / FR_ASPECT) return null;
    /* A real arm to find, and not one so long the answer is off the paper.
       k was solved to land here, so this is a check on the float, not a hunt. */
    var arm = Math.hypot(truth.x - 0.5, (truth.y - 0.5) * FR_ASPECT);
    if (arm < ARM_MIN * 0.9 || arm > ARM_MAX * 1.1) return null;
    /* …and it must not land under something already in the picture, or the
       reveal draws its answer inside another shape. */
    for (var j = 0; j < masses.length; j++) {
      var d = Math.hypot(truth.x - masses[j].x, (truth.y - masses[j].y) * FR_ASPECT);
      if (d < massReach(kind, a) + massReach(masses[j].kind, masses[j].a) + 0.035) return null;
    }
    return { masses: masses, token: token, truth: truth, load: load };
  }

  /* Generation is random, so it is allowed to fail — but a round is not.
     After a bounded hunt this hands back a frame that is valid by
     construction, so no path can leave the drill without an item. */
  function fallbackItem() {
    var masses = [{ kind: 'disc', a: 0.020, dark: 0.80, x: 0.26, y: 0.50 }];
    var token = { kind: 'block', a: 0.020, dark: 0.80 };
    return {
      masses: masses,
      token: token,
      truth: balanceSpot(masses, massWeight(token.a, token.dark), 0.5, 0.5),
      load: loadSpot(masses),
    };
  }

  function makeItem(idx) {
    for (var t = 0; t < 120; t++) {
      var it = tryItem(idx);
      if (it) return it;
    }
    return fallbackItem();
  }

  /* ============================================================
     ROUND STATE
     ============================================================ */

  var round = 0, itemIdx = 0, accuracies = [], marks = [], item = null, playing = false;
  /* Where the shape is while the hand is on it. Pixels, because it is a
     live pointer position and nothing remembers it past the release. */
  var ghost = null, dragId = null;
  /* The finished frame, held on screen over the truth it was judged
     against. The item keeps its FRACTIONS; the mark is kept as the pixel
     OFFSET that was scored, and the ring and the dotted scale are frozen
     with it — a rotated phone or a pen plugged in mid-reveal must not
     redraw the picture under a number that cannot move. */
  var reveal = null, revealTimer = null;
  /* How many reveals this SITTING has shown. NEVER reset by newRound(): the
     screen that needs the long beat and the one-off naming is the player's
     FIRST reveal, which is not the same thing as round one's first frame
     the moment they press the big primary button before placing anything —
     the likeliest thing a beginner does with a control they do not
     understand yet. */
  var revealsSeen = 0;
  var lastScore = null;
  var NOTE_SCALE = 'The dotted circle is where the score runs out.';
  var NOTE_LEVER = 'The thin line is the lever: the middle is the pivot and the dot is where everything else pulls.';

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
  }

  /* Says the verb and the goal in the words for the things actually drawn —
     the frame, and the shape waiting under it — so the first screen teaches
     without the how-to being opened. On the very first screen it also says
     how the drill MARKS you: nothing about a picture frame says whether a
     near miss is worth 90 or nothing at all, and that is the one rule a
     beginner needs BEFORE their first attempt rather than after it. One
     clause, opening screen only — from frame two on the reveals have been
     teaching it in numbers, and repeating it is noise in the drill's one
     live region. */
  function itemHint(idx, it, teachGoal) {
    var s = 'Frame ' + (idx + 1) + ' of ' + FRAMES_PER_ROUND + ' — press where the ' +
            shapeWords(it && it.token) + ' balances the frame.';
    return teachGoal ? s + ' Drag to adjust, let go to place. The closer you land, the more it scores.' : s;
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    accuracies = [];
    marks = [];
    playing = true;
    lastScore = null;
    ghost = null;
    dragId = null;
    clearReveal();        /* a queued advance from the abandoned round must not fire */
    item = makeItem(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();          /* the last round's score must not hang over this one */
    hint.textContent = itemHint(0, item, revealsSeen === 0);
    draw();
  }

  /* ---- the sheet, in words ----
     The canvas is role="img", so its accessible name IS the picture to
     anyone who cannot see it — and a name fixed at boot describes a blank
     rectangle for the whole session. NOT a live region: a name is spoken
     when the player navigates onto the element, so it costs no announcement
     and never competes with the hint line. Held to the same bar as the
     scoring functions — it runs inside draw(), which runs inside the
     pointer handler, so a throw here would stop the canvas painting and
     leave the round dead under the player's finger, and whatever it builds
     gets READ ALOUD. The write is guarded on "did the sentence change", so
     a drag repainting sixty times a second costs one setAttribute. */
  var sheetName = '';

  function describeSheet() {
    var txt;
    var it = reveal ? reveal.item : item;
    var n = it && it.masses ? it.masses.length : 0;
    var where = it && it.load ? sheetZone(it.load.x, it.load.y) : 'the middle of the frame';
    if (reveal) {
      var words = String(reveal.words || 'off the mark').toLowerCase();
      var pct = isFinite(reveal.acc) ? ', ' + Math.round(reveal.acc) + ' out of 100.' : '.';
      txt = 'Drill sheet: frame ' + itemIdx + ' of ' + FRAMES_PER_ROUND + ' — ' + n +
            (n === 1 ? ' shape' : ' shapes') + ' weighing on ' + where +
            ', your ' + shapeWords(it && it.token) + ' placed in ' +
            sheetZone(reveal.pf && reveal.pf.x, reveal.pf && reveal.pf.y) +
            ', the balancing spot ringed in ' + sheetZone(reveal.tf && reveal.tf.x, reveal.tf && reveal.tf.y) +
            ' — ' + words + pct;
      /* isFinite(null) is true — null coerces to 0 — so the null check has to
         come first or a fresh round says "Round done: null out of 100". */
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else if (playing && it) {
      txt = 'Drill sheet: frame ' + (itemIdx + 1) + ' of ' + FRAMES_PER_ROUND + ' — a picture frame with ' +
            n + (n === 1 ? ' shape' : ' shapes') + ' weighing on ' + where + '; your ' +
            shapeWords(it.token) + (ghost ? ' is over the frame, not let go of yet.' : ' waits in the tray below.');
    } else {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ============================================================
     PAINTING (the canvas background stays clear so the CSS dot grid
     shows through)
     ============================================================ */

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    describeSheet();       /* the name and the picture leave from the same place */
    var fr = frameRect();
    var it = reveal ? reveal.item : item;
    drawFrame(c, fr);
    if (!it) return;
    for (var i = 0; i < it.masses.length; i++) drawMass(c, it.masses[i], fr, false);
    if (reveal) { drawReveal(c, reveal, fr); return; }
    if (!playing) return;
    /* The shape being placed: under the hand once it has landed, otherwise
       waiting in the tray, where its size and its darkness — the whole
       question — can be read before anything is committed. */
    if (ghost) drawToken(c, it.token, ghost.x, ghost.y, fr, insideFrame(ghost, fr));
    else drawToken(c, it.token, W / 2, TRAY_FY * H, fr, false);
  }

  function drawFrame(c, fr) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
    /* The pivot. Everything the drill scores is measured about this cross,
       so it is drawn during play too — hiding it would make the rule
       guesswork rather than a judgement. Faint is a look, not a licence to
       be unreadable: at 0.85 --muted still clears 3:1 over the dot grid. */
    ctx.globalAlpha = 0.85;
    var cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2, t = Math.max(4, fr.w * 0.012);
    ctx.beginPath();
    ctx.moveTo(cx - t, cy); ctx.lineTo(cx + t, cy);
    ctx.moveTo(cx, cy - t); ctx.lineTo(cx, cy + t);
    ctx.stroke();
    ctx.restore();
  }

  /* Weight is area × darkness, so darkness has to be VISIBLE — it is drawn
     as the fill's alpha over the paper, which reads as "how strongly this
     shape sits on the page" in the night studio exactly as it does on paper
     (there --ink is pale and the paper is dark; contrast against the ground
     is the thing either way). The outline is full strength so the SHAPE
     always clears 3:1 even when the mass it carries is a pale one. */
  function massPath(kind, a, x, y, fr) {
    var A = Number(a);
    if (!isFinite(A) || A <= 0) A = 0.0001;
    ctx.beginPath();
    if (kind === 'block') {
      var s = Math.sqrt(A) * fr.w;
      ctx.rect(x - s / 2, y - s / 2, s, s);
    } else if (kind === 'bar') {
      var h = Math.sqrt(A / 2) * fr.w;
      ctx.rect(x - h, y - h / 2, h * 2, h);
    } else {
      var r = Math.sqrt(A / Math.PI) * fr.w;
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  function drawMass(c, m, fr, ghosted) {
    if (!m) return;
    var p = toPx(m, fr);
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, Math.min(1, Number(m.dark) || 0.5));
    ctx.fillStyle = c.ink;
    massPath(m.kind, m.a, p.x, p.y, fr);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    if (ghosted) ctx.setLineDash([4, 4]);
    massPath(m.kind, m.a, p.x, p.y, fr);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* The shape in the player's hand. Same ink as the masses already in the
     picture — it is one of them now — plus a crosshair at its centre, which
     is both "this is the one you are moving" and the only part of it a
     finger does not cover. A shape held outside the frame is drawn dashed:
     letting go there does not place it, and saying so with the outline
     costs no words. */
  function drawToken(c, t, x, y, fr, live) {
    if (!t) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, Math.min(1, Number(t.dark) || 0.5));
    ctx.fillStyle = c.ink;
    massPath(t.kind, t.a, x, y, fr);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.ink;
    if (!live) ctx.setLineDash([5, 4]);
    massPath(t.kind, t.a, x, y, fr);
    ctx.stroke();
    ctx.restore();
    /* The crosshair reaches past the shape's own outline on purpose: on a
       touch screen the finger covers the thing it is placing, and the only
       part of the mark a player can still see is the part sticking out.
       PER AXIS, not off the diagonal — a bar is twice as wide as it is tall,
       so one radius sized off its half-diagonal drew a vertical arm as long
       as the horizontal one, which on the widest shape in the drill hung
       10px BELOW the bottom of the sheet while it waited in the tray. And
       clamped to the sheet regardless, so no shape at any canvas size can
       paint a mark the player only sees half of. */
    var e = massExtent(t.kind, t.a);
    var armX = Math.max(11, e.ex * fr.w * 1.08 + 4);
    var armY = Math.max(11, e.ey * fr.w * 1.08 + 4);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, x - armX), y); ctx.lineTo(Math.min(W, x + armX), y);
    ctx.moveTo(x, Math.max(0, y - armY)); ctx.lineTo(x, Math.min(H, y + armY));
    ctx.stroke();
    ctx.restore();
  }

  /* The truth over the attempt, with the gap between them drawn as the thing
     it is — and the LEVER, which is the whole reason the truth is where it
     is. Every size here comes from the reveal, never from a live call: the
     hardware and the canvas can both change while it is being read. */
  function drawReveal(c, rv, fr) {
    var t = toPx(rv.tf, fr);
    var mark = markPx(rv, fr);

    /* The lever: from where everything already in the picture pulls, through
       the pivot, out to the spot that balances it. The three are collinear
       by construction — the truth is the load's offset scaled by −k about
       the pivot — so this line is the arithmetic, drawn. */
    if (rv.lf) {
      var l = toPx(rv.lf, fr);
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.muted;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.beginPath();
      ctx.arc(l.x, l.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* The scale the number was measured on, drawn faintly — where the score
       runs out. Without it a 62 has nothing on screen to be read against.
       Taken from the reveal and not from the tolerance again: ease() answers
       for the hardware in use NOW, and a pen plugged in while this is up
       would redraw the circle at a different radius under a printed number
       that cannot move. Reveal only; during play it would just be a second
       thing to aim at. "Faint" is a look, not a licence to be unreadable —
       0.85 keeps --muted over 3:1 on the dot grid it crosses. */
    var zr = (isFinite(rv.zero) && rv.zero > 0) ? rv.zero : 1;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.arc(t.x, t.y, zr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* Where it belonged: the shape ghosted in place, ringed so the eye can
       find it, with the exact spot dotted at its centre. */
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.mark;
    ctx.setLineDash([5, 4]);
    massPath(rv.item.token.kind, rv.item.token.a, t.x, t.y, fr);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    ctx.arc(t.x, t.y, rv.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = c.mark;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.fill();

    /* The gap, and then what they actually did, on top. */
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(mark.x, mark.y);
    ctx.stroke();
    ctx.restore();
    drawToken(c, rv.item.token, mark.x, mark.y, fr, true);
  }

  /* The mark is placed by the OFFSET that was scored, so the gap on screen
     is always the gap the number and the words describe, whatever the canvas
     has done since. Two fractions re-projected onto a rotated phone drift
     apart at different rates and the picture ends up arguing with the
     printed number. Kept on the sheet after a hard shrink, clamped by the
     shape's own outer edge rather than its centre: a mark sliced by the
     border is the one reveal a player cannot read the direction off. */
  function markPx(rv, fr) {
    var t = toPx(rv.tf, fr);
    var x = t.x + (isFinite(rv.dx) ? rv.dx : 0);
    var y = t.y + (isFinite(rv.dy) ? rv.dy : 0);
    var e = massExtent(rv.item.token.kind, rv.item.token.a);
    var ex = Math.min(e.ex * fr.w + 2, W / 2), ey = Math.min(e.ey * fr.w + 2, H / 2);
    x = (W > ex * 2) ? Math.max(ex, Math.min(W - ex, x)) : W / 2;
    y = (H > ey * 2) ? Math.max(ey, Math.min(H - ey, y)) : H / 2;
    return { x: x, y: y };
  }

  function insideFrame(p, fr) {
    return !!p && p.x >= fr.x && p.x <= fr.x + fr.w && p.y >= fr.y && p.y <= fr.y + fr.h;
  }

  /* ============================================================
     INPUT → accuracy → score
     ============================================================ */

  /* MAP THROUGH THE CONTENT BOX, not the rect. css/style.css sets
     `* { box-sizing: border-box }` and gives .game-canvas a 1px border, so
     getBoundingClientRect() measures the BORDER box while the bitmap is
     painted into the CONTENT box — two pixels narrower and two shorter. The
     bare `clientX - rect.left` therefore disagrees with the drawing space it
     is compared against, by the border at one edge and by the accumulated
     stretch at the other, and a placement landing EXACTLY on the spot reads
     as a pixel out — which quietly makes 100 impossible anywhere but the
     middle of the sheet. clientWidth/clientHeight ARE the content box, and
     they are free here: the getBoundingClientRect() above has already
     flushed layout for them. A drill with no border gets bx = by = 0 and a
     scale of exactly 1, so this is the plain subtraction again wherever the
     plain subtraction was right. */
  function pointerPos(ev, rect) {
    var r = rect || canvas.getBoundingClientRect();
    var cw = canvas.clientWidth || r.width;
    var ch = canvas.clientHeight || r.height;
    var bx = (r.width - cw) / 2, by = (r.height - ch) / 2;
    return {
      x: (cw > 0) ? (ev.clientX - r.left - bx) * W / cw : 0,
      y: (ch > 0) ? (ev.clientY - r.top - by) * H / ch : 0,
    };
  }

  var rafId = null;
  function repaint() {
    if (rafId !== null) return;
    rafId = raf(function () { rafId = null; draw(); });
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* Only a press that MEANS "here". A right-click is a pointerdown like
       any other — primary pointer, real coordinates — so unguarded it burns
       a frame and places the shape wherever the cursor sat, while the
       context menu opens over the reveal explaining it. Same for a
       middle-click and a pen's barrel button. `button` is 0 for a finger and
       for a pen's tip, so this costs touch and pen nothing. Tested FIRST,
       because it is the one press whose browser default is still wanted. */
    if (ev.button > 0) return;
    /* Cancelled for every press the sheet ACCEPTS and every press it
       IGNORES alike. A canvas is never a text surface, and the ignored
       presses are the ones a beginner makes most: a reveal owns the sheet
       for seconds at a time, which is exactly long enough for an impatient
       hand to press and drift. Left to the browser that gesture drags a text
       selection across the hint line and the HUD, and on a touch screen it
       is a long-press callout over the very picture the beat exists to let
       them read. */
    ev.preventDefault();
    /* A PALM IS NOT AN ATTEMPT. The heel of the hand lands before the nib,
       so first-contact-wins gives the frame to the wrist. The SDK owns the
       test because it is the only thing that sees a nib HOVERING; a guard
       fed by this canvas's own events goes blind exactly when the palm is
       still down. Ignored, never counted against them, and a finger-only
       player is never once tested against a pen. */
    if (ArtDaily.isPalm(ev)) return;
    /* Second finger of a two-finger tap must not move the shape, and neither
       may a press that lands while the reveal still owns the sheet — the
       next frame is not drawn yet, so there is nothing it could honestly be
       judged against. Ignored, never counted. */
    if (!playing || !item || reveal || ev.isPrimary === false || dragId !== null) return;
    dragId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* capture is a nicety */ }
    ghost = pointerPos(ev);
    draw();   /* the press that just landed is the one frame that must not wait */
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (dragId === null || ev.pointerId !== dragId) return;
    ev.preventDefault();
    /* Only where the hand is NOW is wanted here — the dispatched event
       already carries the newest sample, so ArtDaily.samples() would buy the
       SHAPE of a stroke this drill does not draw. One repaint a frame: a
       repaint per sample is several full-canvas washes inside one frame with
       all but the last thrown away, and every one of them is main-thread
       time the next sample queues behind. */
    ghost = pointerPos(ev);
    repaint();
  });

  canvas.addEventListener('pointerup', function (ev) {
    if (dragId === null || ev.pointerId !== dragId) return;
    ev.preventDefault();
    dragId = null;
    /* THE RELEASE IS THE ANSWER, and the release event carries it. Reading
       the last pointermove instead trusts a stream the browser is free to
       coalesce or drop: a hand that leaves the frame between the last move
       and the lift would be scored where it no longer is, and — worse — a
       press with no move at all behind it would be placed at the PRESS
       point however far the pointer travelled. The two agree on every
       ordinary gesture; where they disagree, the lift is the truth. Falls
       back to the drawn ghost if the event somehow carries no usable
       coordinates, so a placement can never be lost. */
    var p = pointerPos(ev);
    if (!isFinite(p.x) || !isFinite(p.y)) p = ghost;
    ghost = null;
    if (!p) { draw(); return; }
    var fr = frameRect();
    /* A release outside the picture places nothing: the shape goes back to
       the tray and the frame is still there to answer. Nothing is punished
       for a UI reason, and the dashed outline said so while the hand was
       out there. */
    if (!insideFrame(p, fr)) { draw(); return; }
    commit(p, fr);
  });

  function abandonDrag(ev) {
    if (dragId === null || (ev && ev.pointerId !== dragId)) return;
    dragId = null;
    ghost = null;
    draw();
  }
  canvas.addEventListener('pointercancel', abandonDrag);
  /* Where setPointerCapture is unavailable a release outside the canvas
     never reaches it, and the shape would follow the pointer forever. The
     canvas's own handler runs first and clears dragId, so this is a no-op
     on every browser that captured properly. */
  window.addEventListener('pointerup', function (ev) {
    if (dragId === null || ev.pointerId !== dragId) return;
    dragId = null;
    var p = pointerPos(ev);
    if (!isFinite(p.x) || !isFinite(p.y)) p = ghost;
    ghost = null;
    var fr = frameRect();
    if (p && insideFrame(p, fr)) commit(p, fr); else draw();
  });

  function commit(p, fr) {
    /* Belt and braces on the ONE path that can file a round. Nothing between
       a press and its release can currently flip these — the press is only
       taken when the drill is playing with no reveal up, and "new round"
       drops the drag rather than racing it — but a second entry here would
       score a fifth frame into a finished round and call report() twice, and
       that is a bug the player could never explain. */
    if (!playing || !item || reveal) return;
    var t = toPx(item.truth, fr);
    var cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    var dx = p.x - t.x, dy = p.y - t.y;
    var d = Math.hypot(dx, dy);
    var zero = zeroPoint(fr.w, handFloor());
    var acc = placeAccuracy(d, zero);
    accuracies.push(acc);

    /* The lever direction, for the words and for the round's habit. A truth
       sitting on the pivot has no direction, and the guards below fall back
       to plain compass words rather than inventing one. */
    var lx = t.x - cx, ly = t.y - cy;
    var ll = Math.hypot(lx, ly);
    var ux = ll > 0 ? lx / ll : 0, uy = ll > 0 ? ly / ll : 0;
    var along = dx * ux + dy * uy;
    marks.push({ u: (ll > 0 && zero > 0) ? along / zero : NaN });

    itemIdx += 1;
    var seen = revealsSeen;      /* reveals shown BEFORE this one, this sitting */
    revealsSeen += 1;
    var words = missPhrase(dx, dy, p.x - cx, p.y - cy, ux, uy, zero);
    /* Everything taught ONCE hangs off revealsSeen, never off round === 1: a
       single press of "new round" before the first placement would otherwise
       downgrade the exact screen this was written for. The dotted circle and
       the lever are both marks the player has never seen, and an unexplained
       mark is jargon that happens to be drawn instead of typed — so each is
       named on the spot, on the one screen where it is new, and never
       mentioned again. Split across the first two reveals rather than stacked
       onto one nine-second screen. */
    var extra = seen === 0 ? NOTE_SCALE : (seen === 1 ? NOTE_LEVER : '');
    /* The sentence is built BEFORE the beat, because the beat is budgeted
       from it — see revealBeat. */
    var line = frameWords(words, acc) + '.' + (extra ? ' ' + extra : '');
    var e = massExtent(item.token.kind, item.token.a);
    reveal = {
      item: item,
      tf: item.truth,
      lf: item.load ? { x: item.load.x, y: item.load.y } : null,
      pf: { x: (p.x - fr.x) / fr.w, y: (p.y - fr.y) / fr.h },   /* for the name only */
      dx: dx,
      dy: dy,
      /* Frozen beside the offset, for the same reason: whether the mark sits
         inside or outside the ring is the first thing the picture says, and
         the ring comes from startRadius, which the profile table ranks
         OPPOSITE to ease — so the same pen being plugged in that shrinks the
         scale would GROW the ring. Once a number is printed, nothing the
         player has not done may change the picture it describes. */
      r: answerRing(Math.hypot(e.ex, e.ey) * fr.w, fr),
      zero: zero,
      words: words,
      acc: Math.round(acc),
      beat: revealBeat(seen, line, extra),
    };
    hint.textContent = line;
    draw();
    /* The last frame does NOT wait on the beat: finishing is synchronous, so
       report() cannot be raced by "new round" landing during the reveal. The
       reveal simply stays on the canvas behind the score. */
    if (itemIdx >= FRAMES_PER_ROUND) { finishRound(); return; }
    revealTimer = setTimeout(nextItem, reveal.beat);
  }

  /* A hidden tab is not a reading player. Background timers keep running
     (throttled, never cancelled), so a reveal that is alt-tabbed away from
     is spent on a tab nobody is looking at: the player comes back to the next
     frame with the lesson already wiped — the exact failure the beat budget
     exists to prevent, only total. Park the advance while the page is hidden
     and hand the beat back in full on return. This timer can never file a
     round: it only advances an ITEM, and the last one finishes synchronously. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    /* `|| REVEAL_MS` because a setTimeout handed `undefined` fires on the
       next tick — a reveal built without a beat would come back from a
       hidden tab and vanish instantly, which is this bug wearing a disguise. */
    if (playing && reveal && revealTimer === null) {
      revealTimer = setTimeout(nextItem, reveal.beat || REVEAL_MS);
    }
  });

  function nextItem() {
    revealTimer = null;
    if (!playing) return;     /* the round was abandoned while the reveal was up */
    reveal = null;
    item = makeItem(itemIdx);
    hint.textContent = itemHint(itemIdx, item, false);
    draw();
  }

  /* A number on its own is not a reveal, and "new best!" on the very first
     round celebrates nothing — it is true of every player's first round ever
     played, fired on the one round where they most need to be told what the
     number MEANS. So the first round says what the score is FOR; after that
     the primary button speaks for itself. The last frame keeps its words
     here too: frame four is an attempt like any other and is owed the same
     correction as one to three. The round's own habit goes last, when there
     is one. `last` arrives already carrying its own NUMBER, or the sentence
     would read as though the round score were what that frame was worth. */
  function roundWords(res, last, bias) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = bias ? ' ' + bias : '';
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  function finishRound() {
    playing = false;                  /* set first: report() fires exactly once */
    clearTimeout(revealTimer);        /* nothing may advance past a finished round */
    revealTimer = null;
    draw();                           /* the last placement stays up as the reveal */
    var res = ArtDaily.report(roundScore(accuracies));
    /* The picture has not changed — only what is known about it has, and the
       score is not known until report() answers. Re-name without repainting. */
    lastScore = res.score;
    describeSheet();
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = roundWords(res, reveal && frameWords(reveal.words, reveal.acc),
                                  roundBias(marks));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* The toast is a STICKER, not a second voice. It says nothing the hint line
     has not already said in a fuller sentence one statement earlier, and two
     polite live regions written in the same tick do not merge — they queue.
     It is aria-hidden in index.html; keep it that way, and if this drill ever
     needs to say something the hint does not, put it in the hint. */
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

  /* The ink cache is keyed on the theme, so it self-heals; dropping it here
     as well means a drill that later reads an ink from somewhere other than
     draw() cannot be caught holding yesterday's colour. */
  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session, and the ring is sized from it —
     but only the LIVE geometry may move: a reveal on screen keeps the ring
     and the scale it was scored under. */
  ArtDaily.onInput(draw);

  /* Both resize sources fire in bursts for a single drag, and a fit that
     really changes size REALLOCATES the canvas backing store plus a full
     clear on top. So measure and repaint at most once a frame, and only when
     the size actually moved (a phone's URL bar fires resize constantly at an
     unchanged width). */
  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () { fitPending = false; if (fitCanvas()) draw(); });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches what window.resize cannot: the canvas
     measuring 0 at boot (opened in a background tab, or laid out late) and
     getting its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
