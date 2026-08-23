/* ============================================================
   game.js — Draw Through.

   THE LESSON: an ellipse is not drawn once, it is drawn THROUGH.
   Every beginner curriculum says the same sentence — "go round it two
   or three times without stopping" — and no drill in the arcade scores
   whether the laps actually landed on each other. Ellipse Orbit scores
   how well one loop hugs a given plane (accuracy); this scores how well
   your own laps agree (repeatability). Steady Lines and Superimposed
   Lines are exactly that pair for a straight stroke; this is the missing
   half on the ellipse side.

   So the number here is mostly SELF-referential: 75 points for how
   tightly the three laps stack, 25 for drawing roughly the ellipse that
   was asked for. Three confident laps of a slightly wrong ellipse beat
   three timid different ones — that is the whole point, and the how-to
   says so out loud.

   HOW IT IS MEASURED (all of it pure, at the top of this file):
   the guide is a real circle seen at an angle — a circle of radius R
   tilted by τ and projected, which is exactly an ellipse with
   ry = rx·cos τ — so the shape asked for is correct by construction
   rather than a hand-picked squash. The stroke is unwrapped into an
   angle around the guide's centre; every full 2π is one lap; each lap is
   resampled at the SAME 64 absolute directions, which makes the laps
   directly comparable radius-by-radius no matter how fast or from where
   they were drawn. Agreement is the mean spread of those radii; drift is
   the last lap minus the first, which is the classic "my ellipse
   spirals" failure and the thing the round-end correction names.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'draw-through';

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     SCORING — pure functions, no canvas, no DOM, no state, so they lift
     straight into node and can be hammered with degenerate input. Every
     one of them holds the arcade's three rules: finite 0–100 for ANY
     input (empty arrays, NaN, a stroke that never went round, a
     zero-size guide), monotonic in the error, and a perfect input
     reaches 100.
     ============================================================ */

  var LOOPS_PER_ROUND = 4;
  var LAPS = 3;             /* laps per loop — "draw through it three times" */
  var SAMPLES = 64;         /* directions each lap is resampled at */
  var TAU = Math.PI * 2;
  /* ONE answer to "how many laps is that?", spent by the live pip counter,
     by the finish trigger and by the scorer. They must not each round the
     same number their own way: a stroke that lands on 2.999999999999998 —
     which is what tracing exactly three laps actually produces, the float
     sum of 570-odd angle deltas — was three laps to the scorer and two to
     the trigger, so the tidiest possible loop never finished and the round
     could not end. The epsilon is a hair of angle, far under anything a
     hand can aim, and it is applied in exactly one place. */
  var WIND_EPS = 1e-9;
  function lapsCompleted(winding) {
    var w = Number(winding);
    if (!isFinite(w) || w <= 0) return 0;
    return Math.floor(w + WIND_EPS);
  }

  /* The two tolerance bases. Both go through ArtDaily.ease() at the call
     site (never a raw constant — see the hardware note in GAME_GUIDE.md),
     and they are deliberately different sizes: AGREE_BASE is the number
     the drill is really about and is cut where a stack stops looking like
     one stroke, FIT_BASE is loose on purpose because hugging the guide is
     the OTHER drill's job. */
  var AGREE_BASE = 13;
  var FIT_BASE = 30;
  /* A deviation is partly a fraction of the shape it happens on — a bigger
     loop gives the arm more room to wander proportionally — and partly not:
     hand tremor is much the same number of pixels whatever you are drawing
     round. So the tolerance follows the guide's size only WEAKLY, between
     these two clamps. The lower one is the pixel floor GAME_GUIDE.md asks
     for: without it a phone, whose ellipse is half the size of a desktop's,
     would be handed half the tolerance for the identical wobble and become
     a stricter drill for being smaller. */
  var REF_R = 120;
  var SIZE_MIN = 0.85, SIZE_MAX = 1.25;

  /* The radius of an ellipse (semi-axes rx along `rot`, ry across it),
     measured from its own centre in the absolute direction `phi`. This is
     the whole comparison frame: laps, the mean lap and the guide are all
     reduced to a radius at the same directions, so they can be compared
     with a subtraction instead of a nearest-point search. */
  function guideRadiusAt(rx, ry, rot, phi) {
    var a = Number(rx), b = Number(ry), t = Number(phi) - Number(rot);
    if (!isFinite(a) || !isFinite(b) || !isFinite(t) || a <= 0 || b <= 0) return NaN;
    var c = Math.cos(t), s = Math.sin(t);
    var den = (c * c) / (a * a) + (s * s) / (b * b);
    if (!isFinite(den) || den <= 0) return NaN;
    return 1 / Math.sqrt(den);
  }

  /* Unwrap the stroke into a continuous angle around (cx, cy) and resample
     each lap at SAMPLES absolute directions.

     Unwrapping is what makes "which lap is this point on" answerable at
     all: atan2 jumps by 2π at the cut, so the deltas are folded into
     (−π, π] and accumulated. The total is then the signed winding — the
     player may go round either way, and a lap is 2π of it. Sampling by
     DIRECTION rather than by time is what makes the laps comparable: a
     fast lap and a slow one over the same curve produce the same radii,
     so speed is not scored, geometry is.

     Total: anything at all in, an object out. `radii` is null whenever
     there is nothing honest to measure (too few points, never went round
     enough), and `winding` is always a finite number so the live lap
     counter can use the same function the score does. */
  function lapProfiles(pts, cx, cy, laps, m) {
    var out = { winding: 0, radii: null, a0: 0, dir: 1 };
    var L = Math.round(Number(laps)), M = Math.round(Number(m));
    if (!pts || !pts.length || !isFinite(L) || L < 1 || !isFinite(M) || M < 4) return out;
    if (!isFinite(cx) || !isFinite(cy)) return out;

    var u = [], r = [], prev = 0, acc = 0, n = 0, a0 = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) continue;
      var x = Number(p.x), y = Number(p.y);
      if (!isFinite(x) || !isFinite(y)) continue;
      var dx = x - cx, dy = y - cy;
      var rad = Math.sqrt(dx * dx + dy * dy);
      /* A point sitting exactly on the centre has no direction at all;
         including it would inject a garbage angle into the unwrap. */
      if (!(rad > 1e-6)) continue;
      var a = Math.atan2(dy, dx);
      if (n === 0) { a0 = a; } else {
        var d = a - prev;
        while (d > Math.PI) d -= TAU;
        while (d <= -Math.PI) d += TAU;
        acc += d;
      }
      prev = a;
      n++;
      u.push(acc);
      r.push(rad);
    }
    if (n < 8) return out;

    var total = u[n - 1];
    if (!isFinite(total)) return out;
    var dir = total < 0 ? -1 : 1;
    out.a0 = a0;
    out.dir = dir;
    out.winding = Math.abs(total) / TAU;
    if (lapsCompleted(out.winding) < L) return out;   /* not enough laps yet */

    var radii = [];
    var idx = 1;   /* advances monotonically: the targets below only ever
                      move forward in the direction the player is going */
    for (var k = 0; k < L; k++) {
      var lap = [];
      for (var j = 0; j < M; j++) {
        var t = dir * (k + j / M) * TAU;
        while (idx < n && (u[idx] - t) * dir < 0) idx++;
        if (idx >= n) { lap.push(r[n - 1]); continue; }
        var u0 = u[idx - 1], u1 = u[idx];
        var den = u1 - u0;
        var f = (den === 0) ? 0 : (t - u0) / den;
        if (!isFinite(f)) f = 0;
        f = Math.max(0, Math.min(1, f));
        lap.push(r[idx - 1] + (r[idx] - r[idx - 1]) * f);
      }
      radii.push(lap);
    }
    out.radii = radii;
    return out;
  }

  /* How far apart the laps sit, in pixels: at each direction, the mean
     distance of the laps from their own mean. A perfect stack is 0.
     Infinity means "no honest measurement" and scores 0 below — never a
     flattering fallback. */
  function agreeError(radii) {
    if (!radii || radii.length < 2 || !radii[0] || !radii[0].length) return Infinity;
    var M = radii[0].length, sum = 0, cnt = 0;
    for (var j = 0; j < M; j++) {
      var s = 0, n = 0, k, v;
      for (k = 0; k < radii.length; k++) {
        v = radii[k] ? Number(radii[k][j]) : NaN;
        if (isFinite(v)) { s += v; n++; }
      }
      if (n < 2) continue;
      var mean = s / n, d = 0;
      for (k = 0; k < radii.length; k++) {
        v = radii[k] ? Number(radii[k][j]) : NaN;
        if (isFinite(v)) d += Math.abs(v - mean);
      }
      sum += d / n;
      cnt++;
    }
    return cnt ? sum / cnt : Infinity;
  }

  /* The signed habit: last lap minus first, averaged over the directions.
     Positive = the loop GREW as it went round (the spiral every beginner
     draws), negative = it shrank. 0 when there is nothing to say. */
  function driftError(radii) {
    if (!radii || radii.length < 2) return 0;
    var first = radii[0], last = radii[radii.length - 1];
    if (!first || !last || !first.length) return 0;
    var sum = 0, cnt = 0;
    for (var j = 0; j < first.length; j++) {
      var a = Number(first[j]), b = Number(last[j]);
      if (isFinite(a) && isFinite(b)) { sum += b - a; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }

  /* The ellipse the hand actually agreed on — the average of the laps at
     each direction. It is what the reveal draws in the accent, and what
     the guide is compared against. */
  function meanProfile(radii) {
    if (!radii || !radii.length || !radii[0] || !radii[0].length) return null;
    var M = radii[0].length, out = [];
    for (var j = 0; j < M; j++) {
      var s = 0, n = 0;
      for (var k = 0; k < radii.length; k++) {
        var v = radii[k] ? Number(radii[k][j]) : NaN;
        if (isFinite(v)) { s += v; n++; }
      }
      out.push(n ? s / n : NaN);
    }
    return out;
  }

  /* The guide's own radius at the sample directions — the reveal draws it
     from this too, so the frozen picture cannot drift from the numbers. */
  function guideProfile(g, a0, dir, m) {
    var M = Math.round(Number(m));
    if (!g || !isFinite(M) || M < 4 || !isFinite(a0) || !isFinite(dir)) return null;
    var out = [];
    for (var j = 0; j < M; j++) out.push(guideRadiusAt(g.rx, g.ry, g.rot, a0 + dir * TAU * j / M));
    return out;
  }

  /* How far the mean lap sits from the guide, in pixels. */
  function fitError(mean, guide) {
    if (!mean || !guide || !mean.length || mean.length !== guide.length) return Infinity;
    var sum = 0, cnt = 0;
    for (var j = 0; j < mean.length; j++) {
      var a = Number(mean[j]), b = Number(guide[j]);
      if (isFinite(a) && isFinite(b)) { sum += Math.abs(a - b); cnt++; }
    }
    return cnt ? sum / cnt : Infinity;
  }

  /* 100 at no error, 0 at `zero` px out or beyond. `zero` always comes
     from ArtDaily.ease() at the call site. */
  function accuracyFrom(err, zero) {
    var e = Number(err), z = Number(zero);
    if (!isFinite(e) || e < 0 || !isFinite(z) || z <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - e / z) * 100));
  }

  /* A tolerance is a fraction of the shape it is measured on, with a
     floor and a ceiling so a small sheet is never a stricter drill and a
     big one is never a free pass. */
  function sizedTolerance(zero, meanR) {
    var z = Number(zero);
    if (!isFinite(z) || z <= 0) return 1;
    var r = Number(meanR), f = 1;
    if (isFinite(r) && r > 0) f = Math.max(SIZE_MIN, Math.min(SIZE_MAX, r / REF_R));
    var out = z * f;
    return (isFinite(out) && out > 0) ? out : 1;
  }

  /* 75 agreement + 25 fit. Perfect (three identical laps, on the guide)
     is 100; a wild scribble that still goes round three times lands under
     30; anything unmeasurable is 0. Monotonic in both errors. */
  function loopScore(agree, fit, zAgree, zFit) {
    var s = accuracyFrom(agree, zAgree) * 0.75 + accuracyFrom(fit, zFit) * 0.25;
    if (!isFinite(s)) return 0;
    return Math.max(0, Math.min(100, s));
  }

  /* Mean of the round's loops. A round that somehow ends with nothing
     recorded scores 0 rather than 0/0 = NaN. */
  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0;
    for (var i = 0; i < scores.length; i++) {
      var a = Number(scores[i]);
      sum += isFinite(a) ? Math.max(0, Math.min(100, a)) : 0;
    }
    return sum / scores.length;
  }

  /* One measurement, one entry point, so the impure half of the file
     never touches geometry. Total: junk in, a finite score out. */
  function measureLoop(pts, g, zAgree, zFit) {
    var out = {
      ok: false, score: 0, agree: Infinity, drift: 0, fit: Infinity,
      winding: 0, radii: null, mean: null, guide: null, a0: 0, dir: 1,
    };
    if (!g) return out;
    var lp = lapProfiles(pts, g.cx, g.cy, LAPS, SAMPLES);
    out.winding = lp.winding;
    out.a0 = lp.a0;
    out.dir = lp.dir;
    if (!lp.radii) return out;
    out.radii = lp.radii;
    out.mean = meanProfile(lp.radii);
    out.guide = guideProfile(g, lp.a0, lp.dir, SAMPLES);
    out.agree = agreeError(lp.radii);
    out.drift = driftError(lp.radii);
    out.fit = fitError(out.mean, out.guide);
    out.score = loopScore(out.agree, out.fit, zAgree, zFit);
    out.ok = true;
    return out;
  }

  /* ---- the reveal, in words (pure too, and held to the same bar) ----
     A bare number teaches nothing on the round that matters most: nobody
     can tell 58 from 72 by feel, and "your laps drifted outward" is a
     correction a hand can make on the very next loop. */

  /* ONE ladder of sizes for the whole drill — the per-loop words and the
     round's correction are cut at the same fractions of the same
     tolerance, so the player learns what "a little" is worth once. Cut
     where the SCORE changes character, not at tidy fractions: agreement
     is 75 of the 100, so these edges land at roughly
       92+ dead on · 75+ a hair · 50+ a little · 20+ well · under 20 way.
     Total: junk in, the WIDEST word out, never the flattering one — a
     broken measurement that printed "dead on" beside a 12 would read as
     the drill being broken, because it would be. */
  function sizeWord(d, z) {
    /* A magnitude must ARRIVE as a number: Number(null), Number(''),
       Number(false) and Number([]) are every one of them 0, so a
       measurement that never happened would coerce its way onto the top
       rung of this ladder. */
    if (typeof d !== 'number' || typeof z !== 'number') return 'well';
    var m = d, t = z;
    /* A negative magnitude means the caller handed over a signed delta by
       mistake — answer with the widest word, not the kindest one. */
    if (!isFinite(m) || m < 0 || !isFinite(t) || t <= 0) return 'well';
    if (m <= t * 0.08) return 'dead on';
    if (m <= t * 0.25) return 'a hair';
    if (m <= t * 0.5) return 'a little';
    if (m < t * 0.8) return 'well';
    return 'way';
  }

  /* Which way the stack failed, when it failed one way in particular. A
     spread that is not mostly drift is a wobble, and saying "drifting
     outward" about a wobble would be inventing a pattern. */
  function driftWord(drift, err) {
    var d = Number(drift), e = Number(err);
    if (!isFinite(d) || !isFinite(e)) return '';
    var floor = Math.max(1, Math.abs(e) * 0.35);
    if (Math.abs(d) < floor) return '';
    return d > 0 ? 'drifting outward' : 'drifting inward';
  }

  /* Graded against the SAME tolerances the score uses, so the words and
     the number can never disagree. The shape clause is not decoration: a
     tidy stack of the WRONG ellipse scores 75 (all of the agreement, none
     of the fit), and "Three laps, one line — 75 out of 100" reads as the
     drill docking a player 25 points in silence. It is the one sentence
     that has to carry both halves of the number. Total. */
  function loopPhrase(err, drift, zero, fitErr, fitZero) {
    var e = Number(err), z = Number(zero);
    /* No usable tolerance means no grade — and accuracyFrom() answers a
       broken tolerance with 0, so anything but "unreadable" here would
       print a flattering word beside that 0. The words and the number are
       graded by the same two guards, in the same order, on purpose. */
    if (!isFinite(z) || z <= 0) return 'No loop to read';
    if (!isFinite(e) || e < 0) return 'No loop to read';
    var much = sizeWord(e, z);
    if (much === 'dead on') return 'Three laps, one line' + shapeNote(fitErr, fitZero);
    var way = driftWord(drift, e);
    /* The two big bands read as a clause so the direction can hang off
       them: "Well apart, drifting outward". */
    var head = much === 'way' ? 'Way apart'
             : much === 'well' ? 'Well apart'
             : much.charAt(0).toUpperCase() + much.slice(1) + ' apart';
    return (way ? head + ', ' + way : head) + shapeNote(fitErr, fitZero);
  }

  /* Said only when the shape is far enough out to be worth the words —
     the guide is 25 of the 100 and hugging it is the OTHER drill's job, so
     a near miss on it is silence rather than nagging. Total: no usable fit
     measurement means no clause. */
  function shapeNote(fitErr, fitZero) {
    /* No claim, no clause: a caller that measured no fit at all says
       nothing about the shape. A caller that DID measure and handed over
       something broken is a different case — the score has already zeroed
       that quarter of the number, so the words owe the widest clause, not
       a flattering silence. */
    if (fitErr === undefined || fitZero === undefined) return '';
    var e = Number(fitErr), z = Number(fitZero);
    if (!isFinite(e) || e < 0 || !isFinite(z) || z <= 0) {
      return ', but nothing like the ellipse on the sheet';
    }
    var w = sizeWord(e, z);
    if (w === 'well') return ', though not quite the ellipse on the sheet';
    if (w === 'way') return ', but nothing like the ellipse on the sheet';
    return '';
  }

  /* The per-loop sentence: words and number always travel TOGETHER. A
     non-finite score drops the number rather than printing "NaN out of
     100" into a line that gets read out loud. */
  function loopWords(words, acc) {
    var head = (typeof words === 'string' && words.trim()) ? words : 'No loop to read';
    var n = Number(acc);
    if (!isFinite(n)) return head;
    return head + ' — ' + Math.round(Math.max(0, Math.min(100, n))) + ' out of 100 for that loop';
  }

  /* ---- the round's lesson, which no single loop can show ----
     Four loops that all grew as they went round are one habit, not four
     misses, and it is the only correction that outlives the round. Fires
     only when the lean is BOTH consistent (most loops the same way) and
     worth acting on (a tenth of the tolerance), so it can never invent a
     pattern out of noise. '' means "nothing honest to say" and the caller
     must treat it as silence. */
  function roundBias(marks, zero) {
    if (!marks || !marks.length) return '';
    /* A habit is only worth naming against a scale. With no usable one the
       honest answer is silence, not a sentence sized by a made-up number. */
    var z = Number(zero);
    if (!isFinite(z) || z <= 0) return '';
    var n = 0, sum = 0, out = 0, into = 0;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m) continue;
      var d = Number(m.drift);
      if (!isFinite(d)) continue;
      n++; sum += d;
      if (d > 0) out++; else if (d < 0) into++;
    }
    if (n < 3) return '';            /* too few loops to call anything a habit */
    var mean = sum / n;
    var most = Math.max(2, Math.ceil(n * 0.6));
    /* The count must be on the SAME side as the mean, or one wild loop
       outvotes three small ones and the sentence points backwards. */
    if (Math.abs(mean) < z * 0.1) return '';
    if (mean > 0 && out < most) return '';
    if (mean < 0 && into < most) return '';
    /* HOW FAR, in the same five words the reveals just spent teaching. A
       direction with no size is not something a hand can execute, so the
       player invents one — and an invented correction is how a lean
       becomes an overcorrection. The gate above is a tenth of the
       tolerance and the ladder's top rung is a twelfth, so this can never
       come back "dead on". */
    var word = sizeWord(Math.abs(mean), z);
    if (mean > 0) {
      return 'Every loop grew as it went round — the last lap sat ' + word +
             ' outside the first, so ease the next one back in.';
    }
    return 'Every loop shrank as it went round — the last lap sat ' + word +
           ' inside the first, so let the next one ride wide.';
  }

  /* ---- where the loop sits, in words (pure, total) ----
     Only the canvas knows where the ellipse is, and a canvas is a blank
     to anyone who cannot see it. Feeds the sheet's accessible name. */
  function sheetZone(fx, fy) {
    var x = Number(fx), y = Number(fy);
    if (!isFinite(x) || !isFinite(y)) return 'the middle of the sheet';
    var h = x < 0.34 ? 'left' : x > 0.66 ? 'right' : '';
    var v = y < 0.34 ? 'top' : y > 0.66 ? 'bottom' : '';
    if (!h && !v) return 'the middle of the sheet';
    return 'the ' + (v && h ? v + ' ' + h : v || h) + ' of the sheet';
  }

  /* ---- the beat (pure, so the pacing can be tested without a canvas) ----
     A reveal that is gone before it can be read is decoration: the drill
     does the whole job of teaching and then wipes the lesson. Budget it
     against the text that is NEW on that screen, at ~200 words a minute —
     a beginner reading unfamiliar copy while also looking at a picture,
     and about the rate a screen reader speaks the same line out of the
     hint. On a repeat reveal only the clause changes; on the FIRST reveal
     of the sitting nothing is furniture yet, so the whole sentence is
     measured rather than guessed at. */
  var REVEAL_MS = 2100;             /* longest repeat clause here is ~7 words */
  var FIRST_REVEAL_MIN_MS = 4000;   /* a floor, not the budget */
  var MS_PER_WORD = 60000 / 200;

  /* Words, not tokens: an em dash is a pause, not a word. Total. */
  function readingMs(text) {
    var parts = String(text === null || text === undefined ? '' : text).split(/\s+/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (/[0-9a-z]/i.test(parts[i])) n++;
    return n * MS_PER_WORD;
  }

  /* `seen` is how many reveals this SITTING has shown — not which round
     it is. See revealsSeen. */
  function revealBeat(seen, text) {
    if (seen) return REVEAL_MS;
    return Math.max(FIRST_REVEAL_MIN_MS, readingMs(text));
  }

  /* ---- the guide, built as a real circle seen at an angle ----
     Not a hand-picked squash: a circle of radius `rx` whose plane is
     tilted `tilt` radians away from face-on projects to an ellipse with
     minor radius rx·cos(tilt) — so the shape asked for is correct by
     construction, and the ramp below is an honest "turn the plate
     further away", not a number that looked about right. Pure. */
  function guideFromTilt(rx, tilt) {
    var a = Number(rx), t = Number(tilt);
    if (!isFinite(a) || a <= 0) return { rx: 1, ry: 1 };
    if (!isFinite(t)) t = 0;
    var ry = a * Math.abs(Math.cos(t));
    if (!isFinite(ry) || ry < a * 0.2) ry = a * 0.2;   /* never a razor edge */
    return { rx: a, ry: ry };
  }

  /* ============================================================
     END OF THE PURE HALF — everything below touches the canvas.
     ============================================================ */

  /* ---- theme-aware inks (read once per THEME, not once per repaint) ----
     `accent` is the decorative wash; `mark` is the same accent mixed
     toward --ink and is what anything CARRYING MEANING must be drawn in —
     the watercolour accents are decorative-strength on light paper.
     Defined as --canvas-accent below the marker in css/style.css. Every
     one of these is a custom property on :root and the only thing that
     moves them is data-theme, so a read per theme is the same answer as a
     read per repaint minus the style flush — which matters here, because
     this drill repaints on every pointer sample. An empty read (cold
     boot, stylesheet not parsed yet) is never cached. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--coral').trim();
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
     The guide is stored as FRACTIONS of the canvas and so is the stroke.
     Rotate a phone mid-loop and the sheet goes 900px → 390px wide; a
     stroke remembered in pixels would then sit off the canvas, the laps
     could never be finished, and the round could never report. The sheet
     keeps a fixed 0.62 aspect, so fractions rescale the whole picture
     uniformly — the loop under the hand survives the rotation intact. */
  var round = 0, loopIdx = 0, scores = [], playing = false;
  var guideF = null;        /* { cxf, cyf, rf, tilt, rot } */
  var stroke = null;        /* array of { fx, fy } — the loop being drawn */
  var winding = 0;          /* laps completed so far, live */
  var marks = [];           /* per-loop drift, for the round-end correction */
  var nudged = false;       /* the "go round the ellipse" nudge, once per loop */

  /* The finished loop, held on screen over the guide it was judged
     against. Kept as PIXEL radius profiles around a fractional centre:
     the score under it is an absolute pixel measurement against a
     canvas-independent tolerance, so a phone rotated while the player
     reads it must not change the gap they are looking at. Re-projecting
     the laps as fractions would rescale the picture while the printed
     number stayed put, and the picture would then argue with the number. */
  var reveal = null;
  var revealTimer = null;
  /* The player pressed during the reveal: the auto-advance is cancelled
     and the screen is theirs until they press again (the beat-is-a-floor
     rule in the pointerdown handler). Distinct from a PARKED timer
     (hidden tab), so the visibilitychange re-arm below never un-holds a
     held reveal. */
  var revealHeld = false;
  /* How many reveals this SITTING has shown. NEVER reset by newRound():
     the screen that needs the long beat and the one-off naming is the
     player's FIRST reveal, which is not the same thing as round one's
     first loop the moment they press the big primary button before
     drawing anything — the likeliest thing a beginner does with a control
     they do not understand yet. */
  var revealsSeen = 0;
  var liftsSeen = 0;        /* the "you may lift" line is taught once */

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
    revealHeld = false;
  }

  /* Two different SDK knobs, and mixing them up quietly inverts the
     fairness they exist for:
       · startRadius(RESUME_BASE) — how big the "carry on from here" zone
         is. A screenless tablet aims with the hand out of sight, so it
         gets the biggest one.
       · ease(AGREE_BASE) — where the SCORE reaches zero. A mouse pivots
         at the wrist and cannot creep, so it gets the most room.
     Always ease the base constant, never an already-enlarged zone. */
  var RESUME_BASE = 26;

  /* The round's content generator; see nextGuide(). Starts as Math.random so
     a draw made before the first newRound (there is none today) cannot meet a
     null. */
  var roundRng = Math.random;
  function resumeRadius() { return ArtDaily.startRadius(RESUME_BASE); }
  function agreeZero(meanR) { return sizedTolerance(ArtDaily.ease(AGREE_BASE), meanR); }
  function fitZero(meanR) { return sizedTolerance(ArtDaily.ease(FIT_BASE), meanR); }

  /* Fractions → pixels, always inside the canvas whatever its size. */
  function guideAt(gf) {
    if (!gf) return null;
    var rx = Math.max(14, Math.min(gf.rf * W, W * 0.42, H * 0.42));
    var g = guideFromTilt(rx, gf.tilt);
    var rot = gf.rot;
    /* half-extents of the rotated ellipse's bounding box */
    var bx = Math.sqrt(Math.pow(g.rx * Math.cos(rot), 2) + Math.pow(g.ry * Math.sin(rot), 2));
    var by = Math.sqrt(Math.pow(g.rx * Math.sin(rot), 2) + Math.pow(g.ry * Math.cos(rot), 2));
    var padX = bx + 8, padY = by + 8;
    return {
      cx: (W > padX * 2) ? Math.max(padX, Math.min(W - padX, gf.cxf * W)) : W / 2,
      cy: (H > padY * 2) ? Math.max(padY, Math.min(H - padY, gf.cyf * H)) : H / 2,
      rx: g.rx,
      ry: g.ry,
      rot: rot,
    };
  }

  /* The first loop of a round is the big, nearly-round, dead-centre one:
     a cold beginner's very first stroke should be an obviously reachable
     shape, and a slim ellipse jammed in a corner reads as the drill being
     unfair before they know what fair looks like here. From the second on
     the plate turns further away and the shape shrinks — the ramp belongs
     INSIDE the round. */
  var RAMP = [
    { rf: 0.190, tilt: 0.52, jitter: 0.00 },   /* ~31° — a fat, friendly ellipse */
    { rf: 0.175, tilt: 0.80, jitter: 0.07 },   /* ~46° */
    { rf: 0.160, tilt: 0.99, jitter: 0.11 },   /* ~57° */
    { rf: 0.145, tilt: 1.11, jitter: 0.14 },   /* ~64° */
  ];

  /* ---- where the round's four guides come from -------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS, and this drill
     already stored it that way: guideF is nothing but fractions (rf, tilt,
     rot, cxf, cyf) and guideAt() lays them onto whatever canvas is present.
     So seeding here buys more than it does almost anywhere else — three
     draws, and two players on the same day get the SAME four ellipses, not
     merely the same statistics. (guideAt still clamps a centre inwards on a
     sheet too small to hold the shape, so a very narrow phone can pull a
     corner-ish guide back towards the middle; the fractions are identical
     either way.)

     Round 1 of a sitting is dealt from ArtDaily.roundRandom(1) — seeded off
     today and this slug. Round 2 and on are practice: same generator, same
     distribution, unshared seed. Only the SOURCE of the three uniforms below
     moves; each is still a plain uniform on [0,1), so the rotation is no more
     upright and the centre no more central than it was.

     Called exactly once per loop (newRound for loop 0, nextItem for the
     rest); a resize re-lays the guide it already has rather than re-drawing
     one, so this rolling generator is never walked forward twice for the same
     ellipse — no per-item cache is needed, unlike lines. */
  function nextGuide(idx) {
    var step = RAMP[Math.max(0, Math.min(RAMP.length - 1, idx))];
    var j = step.jitter;
    guideF = {
      rf: step.rf,
      tilt: step.tilt,
      rot: idx ? (roundRng() - 0.5) * Math.PI : (roundRng() - 0.5) * 0.5,
      cxf: 0.5 + (roundRng() - 0.5) * 2 * j,
      cyf: 0.5 + (roundRng() - 0.5) * 2 * j,
    };
    cancelStroke();
    nudged = false;
  }

  /* Drop whatever is under the hand. Called wherever the geometry the
     stroke was drawn against stops existing — a new loop, a new round —
     so a half-drawn loop can never be resumed onto a different ellipse.
     The capture is released too, or a pointer that was down when "new
     round" was pressed would keep the canvas hostage until it lifted. */
  function cancelStroke() {
    if (activeId !== null) {
      try { canvas.releasePointerCapture(activeId); } catch (e) {}
      activeId = null;
    }
    stroke = null;
    winding = 0;
  }

  /* Says the verb in the words for the thing actually drawn, so the first
     screen teaches without the how-to being opened — and on the very
     first screen it also says how the drill MARKS you, which is the one
     rule a beginner needs BEFORE the first attempt rather than after it.
     From loop two on the reveals have been teaching that in numbers. */
  function itemHint(idx, teachGoal) {
    var s = 'Loop ' + (idx + 1) + ' of ' + LOOPS_PER_ROUND +
            ' — press on the dashed ellipse and go round it three times without stopping.';
    return teachGoal ? s + ' The tighter the three laps land on each other, the more it scores.' : s;
  }

  function newRound() {
    round += 1;
    loopIdx = 0;
    scores = [];
    marks = [];
    playing = true;
    lastScore = null;
    clearReveal();        /* a queued advance from the abandoned round must not fire */
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. round is already 1 on the
       first round of a sitting, so round 1 is today's shared round and every
       "new round" after it is practice.

       GUARDED, and the guard is load-bearing. index.html cache-busts its own
       scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
       the two files cache INDEPENDENTLY and roundRandom is new: a returning
       visitor holding a warm SDK from another drill plus a cold copy of this
       file would call a function that does not exist, throw inside newRound()
       before the first guide exists, and sit on "Loading…" with a blank sheet.
       Falling back to Math.random costs today's player nothing but a
       non-comparable round — exactly what they had yesterday — and it
       self-heals when the SDK's max-age expires. */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    nextGuide(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();          /* the last round's score must not hang over this one */
    hint.textContent = itemHint(0, revealsSeen === 0);
    draw();
  }

  /* ---- the sheet, in words ----
     The canvas is role="img", so its accessible name IS the picture to
     anyone who cannot see it — and a name fixed at boot describes a blank
     rectangle for the whole session. NOT a live region: a name is spoken
     when the player navigates onto the element, so it never competes with
     the hint, which is the drill's one spoken channel. Held to the same
     bar as the scoring: it runs inside draw(), which runs inside the
     pointer handler, so a throw here would stop the canvas painting and
     kill the round under the player's finger — and a name is read ALOUD,
     where "NaN out of 100" is worse than saying nothing. */
  var sheetName = '';
  var lastScore = null;     /* the round-end number, for the name only */

  function describeSheet() {
    var txt;
    if (reveal) {
      var words = String(reveal.words || 'no loop to read').toLowerCase();
      var pct = isFinite(reveal.acc) ? ', ' + Math.round(reveal.acc) + ' out of 100.' : '.';
      txt = 'Drill sheet: loop ' + loopIdx + ' of ' + LOOPS_PER_ROUND + ' in ' +
            sheetZone(reveal.cxf, reveal.cyf) +
            ', your three laps drawn over the dashed ellipse — ' + words + pct;
      /* isFinite(null) is true — null coerces to 0 — so the null check has
         to come first or a fresh round says "Round done: null out of 100". */
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else if (playing && guideF) {
      var done = Math.min(LAPS, lapsCompleted(winding));
      txt = 'Drill sheet: loop ' + (loopIdx + 1) + ' of ' + LOOPS_PER_ROUND +
            ', a dashed ellipse in ' + sheetZone(guideF.cxf, guideF.cyf) +
            '. Laps drawn: ' + done + ' of ' + LAPS + '.';
    } else {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */

  function ellipsePath(g) {
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, g.rx, g.ry, g.rot, 0, TAU);
  }

  /* A polar profile (radii at SAMPLES absolute directions) drawn as a
     closed curve. `offset` shifts it radially — that is exactly how the
     tolerance corridor is measured, so it is exactly how it is drawn. */
  function polarPath(cx, cy, a0, dir, radii, offset) {
    if (!radii || !radii.length) return false;
    var M = radii.length, started = false;
    ctx.beginPath();
    for (var j = 0; j <= M; j++) {
      var i = j % M;
      var r = Number(radii[i]) + (Number(offset) || 0);
      if (!isFinite(r)) continue;
      if (r < 1) r = 1;
      var phi = a0 + dir * TAU * i / M;
      var x = cx + r * Math.cos(phi), y = cy + r * Math.sin(phi);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    return started;
  }

  function drawGuide(c, g) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    ellipsePath(g);
    ctx.stroke();
    ctx.restore();
    /* the centre, so the shape reads as a shape and not as a stray arc */
    ctx.fillStyle = c.muted;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, 2, 0, TAU);
    ctx.fill();
  }

  /* Three pips at the foot of the sheet fill as the laps land: the lap
     count is information, so it may not live only in the stroke's own
     shape (which is unreadable while it is being drawn). The hint line is
     left alone — it is a live region, and re-announcing it three times a
     loop would talk over the player. The accessible name carries the same
     count for anyone who cannot see the pips. */
  function drawLapPips(c, done) {
    var n = LAPS, gap = 16, r = 5;
    var x0 = W / 2 - (n - 1) * gap / 2, y = H - 14;
    for (var i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, y, r, 0, TAU);
      if (i < done) { ctx.fillStyle = c.mark; ctx.fill(); }
      else { ctx.lineWidth = 1.5; ctx.strokeStyle = c.muted; ctx.stroke(); }
    }
  }

  function drawStroke(c) {
    if (!stroke || stroke.length < 2) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < stroke.length; i++) {
      var x = stroke[i].fx * W, y = stroke[i].fy * H;
      if (!isFinite(x) || !isFinite(y)) continue;
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* The truth over the attempt, with the gap between them drawn as the
     thing it is: your three laps as you drew them, the ellipse they
     average out to, and the corridor the number was measured in. */
  function drawReveal(c, rv) {
    /* draw() runs inside the pointer handler, so a throw here would not
       garble a picture — it would stop the canvas painting and leave the
       round dead under the player's hand. Nothing below indexes a profile
       without this. */
    if (!rv || !rv.mean || !rv.mean.length) return;
    var maxR = 0, j;
    for (j = 0; j < rv.mean.length; j++) if (isFinite(rv.mean[j])) maxR = Math.max(maxR, rv.mean[j]);
    maxR += rv.z + 4;
    var cx = (W > maxR * 2) ? Math.max(maxR, Math.min(W - maxR, rv.cxf * W)) : W / 2;
    var cy = (H > maxR * 2) ? Math.max(maxR, Math.min(H - maxR, rv.cyf * H)) : H / 2;

    /* the scale the number is measured on, drawn faintly — where the laps
       stop scoring. Taken from the reveal, never from ease() again: the
       hardware can change while a reveal is on screen (a pen plugged in
       at the end of a round fires onInput and repaints), and the number
       is history, so the scale it was measured against is history too.
       0.85 alpha, not 0.4: "faint" is a look, not a licence to be
       unreadable, and this ring is named in the copy. */
    if (isFinite(rv.z) && rv.z > 0) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.muted;
      if (polarPath(cx, cy, rv.a0, rv.dir, rv.mean, rv.z)) ctx.stroke();
      if (polarPath(cx, cy, rv.a0, rv.dir, rv.mean, -rv.z)) ctx.stroke();
      ctx.restore();
    }

    /* the ellipse that was asked for, drawn exactly as it was during the
       loop — same dash, same ink, no fade. It carries information (the fit
       clause in the sentence is about it), and at the 0.6 alpha it started
       life with, muted composited to 2.4:1 on paper: the drill would have
       been pointing at a shape the player could not see. */
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    if (rv.guide && rv.guide.length && polarPath(cx, cy, rv.a0, rv.dir, rv.guide, 0)) ctx.stroke();
    ctx.restore();

    /* the three laps, exactly as they were drawn */
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.62;   /* 3.4:1 on paper over the dot grid — see README */
    for (var k = 0; rv.laps && k < rv.laps.length; k++) {
      var lap = rv.laps[k];
      if (lap && lap.length && polarPath(cx, cy, rv.a0, rv.dir, lap, 0)) ctx.stroke();
    }
    ctx.restore();

    /* the ellipse the hand actually agreed on */
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.mark;
    if (polarPath(cx, cy, rv.a0, rv.dir, rv.mean, 0)) ctx.stroke();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    describeSheet();       /* the name and the picture leave from the same place */
    /* The reveal owns the canvas while it is up: a live guide plus the
       ghost of the last loop would just be two shapes to choose between. */
    if (reveal) { drawReveal(c, reveal); return; }
    if (!playing) return;
    var g = guideAt(guideF);
    if (!g) return;
    drawGuide(c, g);
    drawStroke(c);
    drawLapPips(c, Math.min(LAPS, lapsCompleted(winding)));
  }

  /* ---- input ----
     MAP THROUGH THE CONTENT BOX, not the rect: css/style.css sets
     `* { box-sizing: border-box }` and gives .game-canvas a 1px border, so
     getBoundingClientRect() measures the BORDER box while the bitmap is
     painted into the CONTENT box. The bare `clientX - rect.left` therefore
     disagrees with the drawing space it is compared against — by the
     border at one edge and by the accumulated stretch at the other — and
     a drill whose 100 depends on where the shape happened to spawn is not
     scoring the hand. clientWidth/clientHeight ARE the content box and are
     free here, since the rect above has already flushed layout. With no
     border this is the plain subtraction again. The rect is passed IN
     because a fast pen hands over dozens of samples on one event, and
     re-measuring the element per sample flushes layout for a number that
     cannot have moved. */
  function canvasRect() {
    var rect = canvas.getBoundingClientRect();
    var cw = canvas.clientWidth || rect.width;
    var ch = canvas.clientHeight || rect.height;
    return {
      left: rect.left + (rect.width - cw) / 2,
      top: rect.top + (rect.height - ch) / 2,
      cw: cw,
      ch: ch,
    };
  }
  function posIn(rect, ev) {
    return {
      x: (rect.cw > 0) ? (ev.clientX - rect.left) * W / rect.cw : 0,
      y: (rect.ch > 0) ? (ev.clientY - rect.top) * H / rect.ch : 0,
    };
  }

  var MIN_STEP = 1.6;       /* points closer than this add nothing but cost */
  var MAX_PTS = 6000;

  /* Thinned, but never at the tip. The obvious rule — "drop a sample that
     lands within MIN_STEP of the last one" — quietly throws away the ONE
     sample that matters: the newest. Draw a slim ellipse slowly and the
     samples near its tight ends arrive 1.5px apart, so the last of them is
     dropped and the stroke's recorded end sits a step behind the hand. A
     loop finished dead on the third lap then measured 2.996 laps, the pips
     read 2 of 3, and the item would not end until the player wandered
     another couple of pixels. So the tail is MOVED rather than dropped,
     and a point is only committed once the hand has cleared MIN_STEP from
     the point behind the tail — which keeps the array bounded and keeps
     the last entry exactly where the hand is. */
  function pushPoint(x, y) {
    if (!isFinite(x) || !isFinite(y) || !stroke) return;
    var pt = { fx: W > 0 ? x / W : 0, fy: H > 0 ? y / H : 0 };
    /* At the cap the stroke stops GROWING, but the tail still tracks the
       hand — a cap that froze the recorded position would freeze the lap
       count with it, and an item that cannot reach its third lap is a
       round that can never finish or report. */
    if (stroke.length >= MAX_PTS) { stroke[stroke.length - 1] = pt; return; }
    var anchor = stroke.length >= 2 ? stroke[stroke.length - 2] : null;
    if (anchor) {
      var dx = x - anchor.fx * W, dy = y - anchor.fy * H;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) { stroke[stroke.length - 1] = pt; return; }
    }
    stroke.push(pt);
  }

  function strokePixels() {
    var out = [];
    if (!stroke) return out;
    for (var i = 0; i < stroke.length; i++) out.push({ x: stroke[i].fx * W, y: stroke[i].fy * H });
    return out;
  }

  /* Recomputed from the whole stroke rather than accumulated, so a resize
     mid-loop (a phone rotated) can never leave the live lap count
     disagreeing with what the scorer will find. */
  function recount() {
    var g = guideAt(guideF);
    if (!g || !stroke) { winding = 0; return; }
    winding = lapProfiles(strokePixels(), g.cx, g.cy, LAPS, SAMPLES).winding;
  }

  var activeId = null;
  var paintPending = false;

  function repaintSoon() {
    if (paintPending) return;
    paintPending = true;
    raf(function () { paintPending = false; draw(); });
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* Only a press that MEANS "here". A right-click is a pointerdown like
       any other — primary pointer, real coordinates — so an unguarded
       handler would start a loop and open the context menu over it. Same
       for a middle-click and a pen's barrel button; `button` is 0 for a
       finger and for a pen's tip, so this costs touch and pen nothing.
       Tested FIRST, because it is the one press whose browser default is
       still wanted. */
    if (ev.button > 0) return;
    /* THE BEAT IS A FLOOR, NOT A DEADLINE (WCAG 2.2.1, Timing Adjustable).
       The reveal is where the drill does its teaching, and a timed advance
       wipes it for anyone who reads slower than the budget — a screen
       reader behind 200wpm, a slow reader, someone who looked away. The
       budget stays (it is the pacing for the player who never touches
       anything), but a press during a loop's reveal now HOLDS it: the
       first press cancels the pending advance, the next one asks for the
       next ellipse. Never scored, never counted — a held reveal is the
       player reading, and the drill is not timed. Requires `playing`, so
       the round-end reveal keeps its own rule (it stays until "new
       round"). The first reveal's corridor note teaches the gesture in
       the same breath, and revealBeat budgets the longer line
       automatically. */
    if (playing && reveal && ev.isPrimary !== false) {
      ev.preventDefault();
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; revealHeld = true; return; }
      nextItem();
      return;
    }
    /* Second finger of a two-finger tap must not start a second loop, and
       neither may a press that lands while the reveal is still up — there
       is nothing it could honestly be judged against yet. Ignored, never
       counted against them: nothing is punished for a UI reason. */
    if (!playing || !guideF || reveal || activeId !== null || ev.isPrimary === false) return;
    ev.preventDefault();
    var p = posIn(canvasRect(), ev);
    /* LIFTING IS FREE. A trackpad has a short throw and a phone is small,
       so a three-lap loop in one unbroken press is a rule that fails some
       hardware silently. Press again near where you stopped and the same
       loop carries on; press somewhere else and you are starting over,
       which is the other thing a player means by pressing there. */
    var last = stroke && stroke.length ? stroke[stroke.length - 1] : null;
    var resume = false;
    if (last) {
      var dx = p.x - last.fx * W, dy = p.y - last.fy * H;
      resume = Math.hypot(dx, dy) <= resumeRadius();
    }
    if (!resume) { stroke = []; winding = 0; }
    activeId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    pushPoint(p.x, p.y);
    draw();                 /* the press that just landed must not wait a frame */
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (activeId === null || ev.pointerId !== activeId || !stroke || reveal) return;
    ev.preventDefault();
    /* Sample at the digitizer's rate, paint at the display's: the browser
       dispatches one pointermove a frame but the pen sampled the whole run
       behind it, and throwing that away turns a fast confident loop into a
       polygon the player did not draw. The rect is measured ONCE for the
       whole run. */
    var rect = canvasRect();
    var list = ArtDaily.samples(ev);
    for (var i = 0; i < list.length; i++) {
      var p = posIn(rect, list[i]);
      pushPoint(p.x, p.y);
    }
    recount();
    if (lapsCompleted(winding) >= LAPS) { finishLoop(); return; }
    /* The one way this drill can strand a player: a loop drawn beside the
       ellipse instead of around it never winds, so the laps never land and
       the item never ends. The pips already show nothing happening; this
       says why, once per loop, and only after a stroke long enough that it
       cannot be a false alarm. */
    if (!nudged && stroke.length > 260 && winding < 0.4) {
      nudged = true;
      hint.textContent = 'Laps are counted around the ellipse’s centre dot — go round it, not beside it.';
    }
    repaintSoon();
  });

  function endPress(ev) {
    if (activeId === null || (ev && ev.pointerId !== activeId)) return;
    try { canvas.releasePointerCapture(activeId); } catch (e) {}
    activeId = null;
    /* An accidental tap or a twitch is not an attempt: drop it rather
       than leaving a stub on the sheet for the next press to "resume". */
    if (stroke && stroke.length < 4) { stroke = null; winding = 0; }
    else if (stroke && !reveal && playing && liftsSeen === 0) {
      liftsSeen = 1;
      hint.textContent = 'Lifted — press again near where you stopped and the same loop carries on.';
    }
    draw();
  }
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', endPress);

  /* ---- a loop lands ---- */
  function finishLoop() {
    var g = guideAt(guideF);
    var meanR = g ? (g.rx + g.ry) / 2 : 0;
    var zA = agreeZero(meanR), zF = fitZero(meanR);
    var m = measureLoop(strokePixels(), g, zA, zF);
    /* A measurement that could not be made is not a perfect one: the
       three-lap trigger came from the same function, so this is
       belt-and-braces, and the answer to junk is the worst word and a 0,
       never a flattering fallback. */
    var acc = isFinite(m.score) ? m.score : 0;
    scores.push(acc);
    marks.push({ drift: m.drift });
    loopIdx += 1;
    var seen = revealsSeen;      /* reveals shown BEFORE this one, this sitting */
    /* Counted only when a reveal is actually painted: a loop that could
       not be measured shows nothing, and letting it tick this counter
       would silently downgrade the player's real first reveal — the one
       screen the long beat and the one-off naming exist for. */
    if (m.ok) revealsSeen += 1;

    var words = m.ok ? loopPhrase(m.agree, m.drift, zA, m.fit, zF) : 'No loop to read';
    /* The sentence is built BEFORE the beat, because the beat is budgeted
       from it. The dotted corridor appears for the first time UNDER this
       line, and an unexplained new outline is jargon that happens to be
       drawn instead of written — named once, on the spot, on the only
       screen where it is new. */
    var line = loopWords(words, acc) + '.' +
      /* The hold gesture is taught in the same breath as the corridor, on
         the one screen where both are new; revealBeat budgets the longer
         line automatically, so the extra words buy their own reading
         time. */
      ((seen || !m.ok) ? '' : ' The bold line is your three laps averaged; the dotted pair is where they stop scoring. A press holds this screen; another moves on.');

    reveal = m.ok ? {
      cxf: g ? g.cx / (W || 1) : 0.5,
      cyf: g ? g.cy / (H || 1) : 0.5,
      a0: m.a0,
      dir: m.dir,
      laps: m.radii,
      mean: m.mean,
      guide: m.guide,
      z: zA,
      words: words,
      acc: Math.round(acc),
      beat: revealBeat(seen, line),
    } : null;

    cancelStroke();
    hint.textContent = line;
    draw();
    /* The last loop does NOT wait on the beat: finishing is synchronous,
       so report() can never be raced by "new round" landing during the
       reveal. The reveal simply stays on the canvas behind the score. */
    if (loopIdx >= LOOPS_PER_ROUND) { finishRound(); return; }
    if (reveal) revealTimer = setTimeout(nextItem, reveal.beat);
    else nextItem();
  }

  /* A hidden tab is not a reading player. Background timers keep running
     (throttled, never cancelled), so a reveal that is alt-tabbed away from
     is spent on a tab nobody is looking at. Park the advance while the
     page is hidden and hand the beat back IN FULL on return. This timer
     can never file a round: it only advances an ITEM, and the last one
     finishes synchronously. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (playing && reveal && revealTimer === null && !revealHeld) {
      revealTimer = setTimeout(nextItem, reveal.beat || REVEAL_MS);
    }
  });

  function nextItem() {
    revealTimer = null;
    revealHeld = false;
    if (!playing) return;     /* the round was abandoned while the reveal was up */
    reveal = null;
    nextGuide(loopIdx);
    hint.textContent = itemHint(loopIdx, false);
    draw();
  }

  /* A number on its own is not a reveal, and "new best!" on the very
     first round celebrates nothing — it is true of every player's first
     round ever played, on the one round where they most need to be told
     what the number is FOR. The last loop keeps its words here too: loop
     four is an attempt like any other. The round's own correction goes
     last — per-loop words fix the next loop, the bias line fixes the next
     round. `last` arrives already carrying its own number, or a bare
     "Round done — 74" would read as what that last loop was worth. */
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
    draw();                           /* the last loop stays up as the reveal */
    var res = ArtDaily.report(roundScore(scores));
    /* The picture has not changed — only what is known about it has, and
       the score is not known until report() answers. Re-name, no repaint. */
    lastScore = res.score;
    describeSheet();
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The habit is graded against the tolerance the ROUND was scored
       under — taken from the reveal that is still on screen, not from
       ease() again. A pen plugged in during the last loop halves the live
       zero-point, and the correction would then re-judge four finished
       loops against a tolerance none of them were scored with. */
    var z = (reveal && reveal.z) || agreeZero(0);
    hint.textContent = roundWords(res, reveal && loopWords(reveal.words, reveal.acc),
                                  roundBias(marks, z));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* The toast is a STICKER, not a second voice: it says nothing the hint
     line has not already said in a fuller sentence one statement earlier.
     Two polite live regions written in the same tick do not merge, they
     queue — the player would hear the round's correction and then the
     same score again. It is aria-hidden in index.html; keep it that way. */
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

  /* The ink cache is keyed on the theme so it self-heals; dropping it
     here as well means a drill that later reads an ink from somewhere
     other than draw() cannot be caught holding yesterday's colour. */
  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session; the resume zone is sized from
     it. This resizes GEOMETRY only — it never re-judges what is already
     on screen, which is why the reveal carries its own tolerance. */
  ArtDaily.onInput(draw);

  /* Both resize sources fire in bursts for a single drag, and a fit that
     really changes size REALLOCATES the canvas backing store plus a full
     clear on top. So measure and repaint at most once a frame, and only
     when the size actually moved. The stroke is stored in fractions, so
     the loop under the hand survives — but the live lap count is measured
     in pixels, so it is recomputed rather than trusted. */
  function raf(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () {
      fitPending = false;
      if (!fitCanvas()) return;
      if (playing && !reveal) recount();
      draw();
    });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches the case window.resize cannot: the canvas
     measuring 0 at boot (opened in a background tab, or laid out late)
     and getting its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
