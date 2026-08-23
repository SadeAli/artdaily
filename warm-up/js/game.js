/* ============================================================
   game.js — Warm Up: three 25-second sets that only ask the arm to
   move. Loose circles, diagonal sweeps, figure eights. The progress
   ring fills with STROKE DISTANCE, not accuracy, because the visible
   reward here has to be motion: 60 of the 100 points are for how much
   ink you moved and only 40 for a deliberately loose shape check.

   This is the gentlest drill on the site — the one a first-timer on a
   laptop trackpad should be able to pass on their first try — so:
     · the whole canvas is live. There is no start dot to miss, no
       target to acquire, and no press is ever refused or swallowed
       (the press that starts a set is also the first mark of it) —
       the one exception is the palm guard below, which exists so the
       pen's marks are the ones that get drawn.
     · strokes are multi-segment BY DESIGN. A trackpad cannot pull a
       long line in one contact; lift as often as you like and every
       stroke in the set is accumulated.
     · every zero-point tolerance goes through ArtDaily.ease() and
       every hardware-sized measurement through ArtDaily.startRadius(),
       so the same honest scribble reads the same from a pen, a mouse
       and a finger. The HUD says which mode it eased for.
   The scoring is pure functions at the top: geometry in, 0–100 out,
   no canvas and no DOM, so they are testable in node.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'warm-up';
  var SETS = 3;
  var SET_MS = 25000;      /* one set of loosening-up */
  var REVEAL_MS = 2800;    /* reveal holds this long; a tap skips ahead */
  var MIN_STEP = 2;        /* px between kept samples — decimates jitter */
  var PX_PER_METRE = 3780; /* 96 CSS px ≈ 1 inch, so ≈ 3780 px ≈ 1 metre */
  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  /* ============================================================
     Pure scoring — geometry in, 0–100 out. No canvas, no DOM.
     Points are {x,y}; a "stroke" is an array of them and a set is an
     array of strokes (lifting the pen mid-set is expected, so nothing
     below ever cares where one stroke ends and the next begins).
     ============================================================ */

  function clamp01(v) {
    v = Number(v);
    if (isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function polyDistance(pts) {
    var d = 0, i;
    if (!pts) return 0;
    for (i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return d;
  }

  /* Total ink moved in a set — the thing the ring fills with. */
  function totalDistance(strokes) {
    var d = 0, i;
    if (!strokes) return 0;
    for (i = 0; i < strokes.length; i++) d += polyDistance(strokes[i]);
    return isFinite(d) ? d : 0;
  }

  /* The ground the set's ink actually covers, corner to corner. circles throws
     away loops under minLoopR and sweeps needs a straight chord across a whole
     window, so both already score a shiver at zero quality; eights counted
     crossings at ANY scale, so a finger trembling inside a 3px box crossed its
     own path hundreds of times and collected the full 40 shape points — the
     same as honest lazy eights across the whole sheet. This is the floor the
     other two kinds already have, spelled for eights. */
  function inkSpan(strokes) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, s, i, p, pts;
    if (!strokes) return 0;
    for (s = 0; s < strokes.length; s++) {
      pts = strokes[s];
      if (!pts) continue;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!isFinite(minX) || !isFinite(minY)) return 0;
    return Math.hypot(maxX - minX, maxY - minY);
  }

  /* Even arc-length resampling: noise control before any angle maths,
     and the only way the O(n²) crossing count stays cheap. */
  function resample(pts, step) {
    if (!pts || !pts.length) return [];
    if (!(step > 0)) step = 1;
    var out = [{ x: pts[0].x, y: pts[0].y }];
    var px = pts[0].x, py = pts[0].y, carry = 0, i, dx, dy, seg, t;
    for (i = 1; i < pts.length; i++) {
      dx = pts[i].x - px; dy = pts[i].y - py;
      seg = Math.hypot(dx, dy);
      while (seg > 0 && carry + seg >= step) {
        t = (step - carry) / seg;
        px += dx * t; py += dy * t;
        out.push({ x: px, y: py });
        carry = 0;
        dx = pts[i].x - px; dy = pts[i].y - py;
        seg = Math.hypot(dx, dy);
      }
      carry += seg;
      px = pts[i].x; py = pts[i].y;
    }
    return out;
  }

  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  /* One loop's shape, measured against its own centre. The spread is
     the 5th→95th percentile radius band as a fraction of the mean
     radius: percentiles rather than min/max so one flicked sample
     cannot condemn an otherwise round loop. */
  function loopMetrics(pts) {
    var n = pts.length, i, cx = 0, cy = 0, mean = 0, radii = [];
    for (i = 0; i < n; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= n; cy /= n;
    for (i = 0; i < n; i++) {
      radii.push(Math.hypot(pts[i].x - cx, pts[i].y - cy));
      mean += radii[i];
    }
    mean /= n;
    radii.sort(function (a, b) { return a - b; });
    var lo = radii[Math.floor(0.05 * (n - 1))];
    var hi = radii[Math.ceil(0.95 * (n - 1))];
    return { cx: cx, cy: cy, r: mean, spread: mean > 0 ? (hi - lo) / mean : 1 };
  }

  /* Split continuous scribbling into loops: walk the resampled path
     summing signed turn, and every full turn closes one loop.

     The turn is summed BETWEEN headings, so k segments yield only k−1
     differences: a clean circle drawn as ONE stroke lands at (k−1)/k of
     2π, and resampling drops a further tail shorter than one step. A
     naive `>= 2π` test therefore found nothing at all — seven tidy
     circles scored as zero loops. 90% of a turn closes a loop instead,
     which is inside both errors for any loop of ten samples or more.

     minRadius comes from ArtDaily.startRadius() — a mouse user's honest
     loops are simply smaller than a pen user's, and a floor set for the
     pen would throw all of them away. */
  var TURN_PER_LOOP = 2 * Math.PI * 0.9;
  var MIN_TURNS = 6;   /* fewer heading changes than this is not a loop */

  function detectLoops(strokes, minRadius) {
    var loops = [], s, pts, i, ang, prev, acc, turns, start, m;
    if (!strokes) return loops;
    for (s = 0; s < strokes.length; s++) {
      pts = resample(strokes[s], 6);
      if (pts.length < 8) continue;
      acc = 0; turns = 0; start = 0; prev = null;
      for (i = 1; i < pts.length; i++) {
        ang = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
        if (prev !== null) { acc += angleDiff(ang, prev); turns += 1; }
        prev = ang;
        if (turns >= MIN_TURNS && Math.abs(acc) >= TURN_PER_LOOP) {
          m = loopMetrics(pts.slice(start, i + 1));
          if (m.r >= minRadius) loops.push(m);
          start = i; acc = 0; turns = 0; prev = null;
        }
      }
    }
    return loops;
  }

  /* Set 1 quality: the fraction of loops round ENOUGH. tol is the
     radius spread at which a loop stops counting, ArtDaily.ease()d by
     the caller — 0.35 from a pen (a 1.5:1 oval is out), 0.70 from a
     mouse (anything loop-shaped is in). */
  function circlesQuality(loops, tol) {
    if (!loops || !loops.length) return 0;
    var good = 0, i;
    for (i = 0; i < loops.length; i++) if (loops[i].spread <= tol) good += 1;
    return clamp01(good / loops.length);
  }

  /* Sweep directions, sampled over a window of arc length (again
     hardware-sized: short windows for the small strokes a trackpad
     makes). A window only votes if it was actually a sweep and not a
     turnaround — chord ≥ 80% of the arc it spans. */
  function sweepAngles(strokes, windowLen) {
    var out = [], s, pts, i, startIdx, arc, seg, chord;
    if (!strokes) return out;
    if (!(windowLen > 0)) windowLen = 34;
    for (s = 0; s < strokes.length; s++) {
      pts = resample(strokes[s], 4);
      startIdx = 0; arc = 0;
      for (i = 1; i < pts.length; i++) {
        seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        arc += seg;
        if (arc >= windowLen) {
          chord = Math.hypot(pts[i].x - pts[startIdx].x, pts[i].y - pts[startIdx].y);
          if (chord >= 0.8 * arc) {
            out.push(Math.atan2(pts[i].y - pts[startIdx].y, pts[i].x - pts[startIdx].x));
          }
          startIdx = i; arc = 0;
        }
      }
    }
    return out;
  }

  /* Circular statistics on DOUBLED angles: direction is undirected
     here, so a sweep and its return count as the same axis — sweeping
     back and forth is the drill, not a mistake. Returns degrees. */
  function axialSpreadDeg(angles) {
    var n = angles ? angles.length : 0, i, sx = 0, sy = 0, R;
    if (n < 2) return 0;
    for (i = 0; i < n; i++) { sx += Math.cos(2 * angles[i]); sy += Math.sin(2 * angles[i]); }
    R = Math.hypot(sx, sy) / n;
    if (!(R > 1e-6)) R = 1e-6;
    if (R > 1) R = 1;
    return (Math.sqrt(-2 * Math.log(R)) / 2) * 180 / Math.PI;
  }

  function axialMeanRad(angles) {
    var n = angles ? angles.length : 0, i, sx = 0, sy = 0;
    if (!n) return 0;
    for (i = 0; i < n; i++) { sx += Math.cos(2 * angles[i]); sy += Math.sin(2 * angles[i]); }
    return 0.5 * Math.atan2(sy, sx);
  }

  /* Set 2 quality: full marks while the sweeps hold within tol of one
     another, fading to zero at twice that. tolDeg is ArtDaily.ease()d
     — 22° from a pen, 44° from a mouse. */
  function sweepsQuality(angles, tolDeg) {
    if (!angles || angles.length < 3) return 0;
    if (!(tolDeg > 0)) return 0;
    return clamp01((2 * tolDeg - axialSpreadDeg(angles)) / tolDeg);
  }

  function segCross(p1, p2, p3, p4) {
    var d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    var d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    var den = d1x * d2y - d1y * d2x;
    if (den === 0) return null;
    var t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
    var u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }

  /* Every place the set's ink crosses itself. Crossings BETWEEN
     strokes count too: lifting halfway through an eight is normal, and
     the figure is still one figure. The step widens with the amount of
     ink so the pair loop stays bounded whatever the player does. */
  function selfCrossings(strokes, minStep, maxSegs, keepPoints) {
    var total = totalDistance(strokes);
    var step = Math.max(minStep, maxSegs > 0 ? total / maxSegs : minStep);
    var segs = [], pts, s, i, j, hit;
    var count = 0, points = [];
    for (s = 0; s < (strokes ? strokes.length : 0); s++) {
      pts = resample(strokes[s], step);
      for (i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    }
    for (i = 0; i < segs.length; i++) {
      for (j = i + 2; j < segs.length; j++) {
        hit = segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
        if (hit) {
          count += 1;
          if (points.length < keepPoints) points.push(hit);
        }
      }
    }
    return { count: count, points: points };
  }

  /* Set 3 quality: the spec is literally "did the path cross itself" —
     needed scales with how many figures the distance implies and is
     relaxed for the modes that draw smaller, tighter eights. A crossing only
     counts once the ink has covered ground the size of a figure (inkSpan):
     an eight has to be an eight of something. */
  function eightsQuality(crossings, needed, span, minSpan) {
    if (!(needed > 0)) return 0;
    if (minSpan > 0 && !(span >= minSpan)) return 0;
    return clamp01(crossings / needed);
  }

  /* THE SCORE. 60 points for showing up and moving the arm, 40 for a
     loose shape check. Deliberately generous: a warm-up you can fail
     is a warm-up nobody comes back to. */
  function setScore(distance, targetDistance, quality) {
    var covered = targetDistance > 0 ? clamp01(distance / targetDistance) : 0;
    var s = 60 * covered + 40 * clamp01(quality);
    if (!isFinite(s)) return 0;
    return Math.max(0, Math.min(100, s));
  }

  /* The same 60/40 split setScore() uses, broken back out so the reveal
     can say where the points went. Without it a set that scribbled a
     third of the ring and nailed the shape read exactly like one that
     filled the ring and missed it — same number, opposite lesson.

     The two parts must ADD UP to the score printed beside them. Rounding
     each half on its own does not: 30.5 + 20.5 is a 51 that reads
     "31 of 60 … 21 of 40", and a player checking the arithmetic of their
     own feedback finds it wrong (it disagreed on ~24% of the possible
     covered/quality pairs). So the total is rounded ONCE, exactly as
     setScore rounds it, and the shape half is whatever the moved half
     leaves — which is within a point of 40·quality and, because
     Math.round is monotonic in the shape term, always inside 0…40. */
  function scoreSplit(distance, targetDistance, quality) {
    var covered = targetDistance > 0 ? clamp01(distance / targetDistance) : 0;
    var q = clamp01(quality);
    var total = Math.round(60 * covered + 40 * q);
    var moved = Math.round(60 * covered);
    return { moved: moved, shape: Math.max(0, Math.min(40, total - moved)) };
  }

  function splitWords(split) {
    return split.moved + ' of 60 for keeping the arm moving, ' +
      split.shape + ' of 40 for the shape';
  }

  /* The shape check is only worth anything once the arm has actually
     moved. Without this, a thumb tremble in one spot draws a few dozen
     accidental self-crossings and collects the full 40 quality points
     for having done nothing. A quarter of the ring — roughly six
     seconds of scribbling — is the whole bar. */
  function qualityGate(distance, targetDistance) {
    if (!(targetDistance > 0)) return 0;
    return clamp01(distance / (0.25 * targetDistance));
  }

  /* One set's quality + score + the numbers the reveal talks about.
     Pure: every hardware-dependent tolerance arrives in `tune`, which
     the game builds from ArtDaily.ease() / ArtDaily.startRadius(). */
  function scoreSet(kind, strokes, distance, targetDistance, tune) {
    var out = { kind: kind, quality: 0, score: 0, detail: {} };
    var loops, angles, cross, figures, needed, span;
    if (kind === 'circles') {
      loops = detectLoops(strokes, tune.minLoopR);
      out.quality = circlesQuality(loops, tune.loopTol);
      out.detail = { loops: loops, tightest: pickLoop(loops, false), loosest: pickLoop(loops, true) };
    } else if (kind === 'sweeps') {
      angles = sweepAngles(strokes, tune.winLen);
      out.quality = sweepsQuality(angles, tune.sweepTolDeg);
      out.detail = {
        n: angles.length,
        spread: angles.length >= 3 ? axialSpreadDeg(angles) : null,
        axis: angles.length >= 3 ? axialMeanRad(angles) : null,
      };
    } else {
      cross = selfCrossings(strokes, 10, 420, 60);
      figures = Math.max(1, distance / (tune.figureLen > 0 ? tune.figureLen : 1));
      /* "at least twice per figure", divided by the ease multiplier so
         a mouse is not asked for a pen's number of clean crossings. */
      needed = Math.max(2, Math.round(2 * figures / (tune.easeMul > 0 ? tune.easeMul : 1)));
      span = inkSpan(strokes);
      out.quality = eightsQuality(cross.count, needed, span, tune.minFigureSpan);
      out.detail = {
        count: cross.count, needed: needed, points: cross.points,
        span: span, minSpan: tune.minFigureSpan,
      };
    }
    out.quality = clamp01(out.quality) * qualityGate(distance, targetDistance);
    out.score = setScore(distance, targetDistance, out.quality);
    return out;
  }

  function pickLoop(loops, loosest) {
    var best = null, i;
    for (i = 0; i < loops.length; i++) {
      if (!best || (loosest ? loops[i].spread > best.spread : loops[i].spread < best.spread)) best = loops[i];
    }
    return best;
  }

  function roundScore(list) {
    if (!list || !list.length) return 0;
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i];
    var v = sum / list.length;
    return isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  }

  /* px → a unit a human brags about. */
  function inkMetres(px) {
    var m = (Number(px) || 0) / PX_PER_METRE;
    return isFinite(m) && m > 0 ? m : 0;
  }

  /* Below half a centimetre the rounded number is 0, and "0 cm of ink" /
     "that’s 0 centimetres of ink" is a sentence that reads as broken
     rather than as small. It is reachable: pushSample only banks a
     sample once it has moved MIN_STEP, so any set with a single short
     drag lands between 2px and ~18px — a real, non-zero amount that
     rounds to nothing. Say "under a centimetre" instead of a zero. */
  function inkAmount(px) {
    var m = inkMetres(px);
    if (m <= 0) return 'no ink yet';
    if (m < 0.005) return 'under 1 cm of ink';
    if (m < 0.6) return Math.round(m * 100) + ' cm of ink';
    return (Math.round(m * 10) / 10) + ' m of ink';
  }

  function inkPhrase(px) {
    var m = inkMetres(px), v;
    if (m <= 0) return 'no ink this time';
    if (m < 0.005) return 'that’s under a centimetre of ink';
    if (m < 0.6) {
      v = Math.round(m * 100);
      return 'that’s ' + v + ' centimetre' + (v === 1 ? '' : 's') + ' of ink';
    }
    v = Math.round(m * 10) / 10;
    return 'that’s ' + v + ' metre' + (v === 1 ? '' : 's') + ' of ink';
  }

  /* ============================================================
     Canvas / DOM from here down.
     ============================================================ */
  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnNext = document.getElementById('btnNext');

  ArtDaily.init({ slug: SLUG });

  var SET_DEFS = [
    {
      kind: 'circles', title: 'loose circles',
      verb: 'fill the box with overlapping circles — speed over accuracy',
    },
    {
      kind: 'sweeps', title: 'diagonal sweeps',
      verb: 'sweep parallel diagonals corner to corner — don’t slow down',
    },
    {
      kind: 'eights', title: 'figure eights',
      verb: 'big lazy eights — keep the pen moving',
    },
  ];

  /* ---- theme-aware inks (re-read on every repaint) ----
     accent is the airy wash used for the guide fills; accentInk is the
     AA-contrast variant for everything meaning-bearing (the ring, the
     set score, the reveal marks). See css/style.css. */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--mint').trim();
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      line: cs.getPropertyValue('--line').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
      accentInk: cs.getPropertyValue('--game-accent-ink').trim() || accent,
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0, box = null, boxDiag = 0, targetDistance = 1;
  var HEADER = 58; /* strip the set title and the progress ring live in */

  function layout() {
    var pad = Math.max(14, Math.min(26, Math.round(W * 0.045)));
    box = { x: pad, y: HEADER, w: Math.max(40, W - pad * 2), h: Math.max(40, H - HEADER - pad) };
    boxDiag = Math.hypot(box.w, box.h);
    /* ~4 box diagonals of ink fills the ring — about 25 seconds of
       unhurried scribbling on any hardware. */
    targetDistance = boxDiag * 4;
  }

  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    /* taller sheet on phones so the box still has room to loop in */
    H = Math.round(W * (W < 520 ? 0.9 : 0.66));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }

  /* Hardware-sized measurement, rebuilt per set so a tablet plugged in
     mid-session is honoured immediately. */
  function tuning() {
    return {
      easeMul: ArtDaily.ease(1),            /* 1.0 pen · 2.0 mouse · 1.5 finger */
      loopTol: ArtDaily.ease(0.35),         /* radius spread a loop may have */
      sweepTolDeg: ArtDaily.ease(22),       /* degrees of scatter that still reads as parallel */
      minLoopR: ArtDaily.startRadius(9),    /* smallest mark that counts as a loop */
      winLen: ArtDaily.startRadius(34),     /* arc length a sweep direction is read over */
      figureLen: boxDiag * 1.6,             /* one lazy eight, roughly */
      /* the smallest ground an eight can cover and still be a figure: four
         minimum loop radii across. Hardware-sized like everything else, so a
         trackpad's small tight eights still count. */
      minFigureSpan: ArtDaily.startRadius(36),
    };
  }

  /* ---- round state ---- */
  var round = 0, setIdx = 0, setScores = [], state = 'idle';
  var strokes = [], cur = null, activePtr = null, activeType = '', dist = 0;
  var deadline = 0, rafId = 0, revealTimer = null, reveal = null, revealAt = 0;
  /* The pointer currently HOLDING the reveal: press cancels the pending
     advance, release advances — the quick tap-to-continue is unchanged
     (still behind SKIP_GUARD_MS), and a press kept down keeps the screen
     (WCAG 2.2.1, the beat as a floor). Cleared by endStroke, nextStep and
     newRound; the visibility re-arm checks it. */
  var holdPointer = null;
  /* A tap on the sheet skips the reveal — but this is a 25-second fast
     scribbling drill, so the clock almost always runs out MID-SCRIBBLE and
     the very next contact is the hand carrying on, not a request to skip.
     Without a guard that contact ate the reveal — the only place the set's
     ink, its score split and its marked-up loops are ever shown. Contacts
     inside this window are swallowed; "next set ›" and the keyboard are
     deliberate presses and skip at once. */
  var SKIP_GUARD_MS = 500;
  var roundDone = true, ringAnnounced = false, clockStartedByTouch = false;
  /* the round's reported result, banked the moment the third set is scored —
     finishRound() is presentation only (see finishSet) */
  var roundResult = null;

  function def() { return SET_DEFS[setIdx] || SET_DEFS[0]; }
  function setLabel() { return 'set ' + (setIdx + 1) + ' of ' + SETS; }
  function secsLeft() {
    if (state !== 'run') return state === 'ready' ? Math.round(SET_MS / 1000) : 0;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  function updateNextBtn() {
    var label, disabled = false;
    if (state === 'reveal') label = setIdx + 1 >= SETS ? 'finish ✓' : 'next set ›';
    else if (state === 'run') label = 'done ✓';
    /* A set that never gets a mark never starts its clock, so it must
       still be skippable — otherwise a player who has done set 1 and
       stops has no way to bank the round at all, and "new round" would
       throw the sets already played away. */
    else if (state === 'ready') label = 'skip set ›';
    else { label = 'done ✓'; disabled = true; }
    btnNext.textContent = label;
    btnNext.disabled = disabled;
  }

  function startSet() {
    strokes = [];
    cur = null;
    activePtr = null;
    activeType = '';
    clockStartedByTouch = false;
    dist = 0;
    reveal = null;
    ringAnnounced = false;
    state = 'ready';
    hint.textContent = setLabel() + ' · ' + def().verb + '. the 25 s clock starts on your first mark.';
    updateNextBtn();
    draw();
  }

  function newRound() {
    clearTimeout(revealTimer);
    revealTimer = null;
    holdPointer = null;
    stopLoop();
    /* A round whose third set is scored but still sitting on its reveal was
       already banked at that score — close it out on screen (toast included)
       before the reset, so an impatient press is never a silent loss. */
    if (!roundDone && roundResult) finishRound();
    round += 1;
    setIdx = 0;
    setScores = [];
    roundResult = null;
    roundDone = false;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startSet();
  }

  /* ---- countdown loop ---- */
  function loop() {
    rafId = 0;
    if (state !== 'run') return;
    if (Date.now() >= deadline) { finishSet(); return; }
    draw();
    rafId = requestAnimationFrame(loop);
  }
  function startLoop() { if (!rafId) rafId = requestAnimationFrame(loop); }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPolyline(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawArrow(c, from, to) {
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    var a = Math.atan2(to.y - from.y, to.x - from.x), head = 12;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(a - 0.4), to.y - head * Math.sin(a - 0.4));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(a + 0.4), to.y - head * Math.sin(a + 0.4));
    ctx.stroke();
    ctx.restore();
  }

  function sweepGuides() {
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var len = Math.hypot(box.w, box.h);
    var dx = box.w / len, dy = -box.h / len;          /* bottom-left → top-right */
    var L = len * 0.55, off = Math.min(box.w, box.h) * 0.15;
    var out = [], k, ox, oy;
    for (k = -1; k <= 1; k += 2) {
      ox = cx + (-dy) * off * k;
      oy = cy + dx * off * k;
      out.push({
        from: { x: ox - dx * L / 2, y: oy - dy * L / 2 },
        to: { x: ox + dx * L / 2, y: oy + dy * L / 2 },
      });
    }
    return out;
  }

  function eightGuidePath() {
    /* Gerono lemniscate — a real lazy eight, not two touching circles. */
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var A = box.w * 0.38, B = box.h * 0.46, pts = [], i, t;
    for (i = 0; i <= 96; i++) {
      t = (i / 96) * Math.PI * 2;
      pts.push({ x: cx + A * Math.sin(t), y: cy + B * Math.sin(t) * Math.cos(t) });
    }
    return pts;
  }

  function drawGuide(c, dim) {
    var kind = def().kind, g, i;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.45;
    /* the zone: a soft rounded box, never a boundary you can fail */
    ctx.save();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = dim ? 0.05 : 0.10;
    roundRectPath(box.x, box.y, box.w, box.h, Math.min(34, box.h / 3));
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 8]);
    roundRectPath(box.x, box.y, box.w, box.h, Math.min(34, box.h / 3));
    ctx.stroke();
    ctx.setLineDash([]);

    if (kind === 'sweeps') {
      g = sweepGuides();
      for (i = 0; i < g.length; i++) drawArrow(c, g[i].from, g[i].to);
    } else if (kind === 'eights') {
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 8]);
      drawPolyline(eightGuidePath());
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawRing(c) {
    var cxr = W - 34, cyr = 30, r = 20;
    var frac = clamp01(dist / targetDistance);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    ctx.arc(cxr, cyr, r, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0) {
      ctx.strokeStyle = c.accentInk;
      ctx.beginPath();
      ctx.arc(cxr, cyr, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    if (state === 'reveal') {
      /* a tick, not a number: the ring must never be mistaken for the
         set score, which is spelled out under the title instead */
      ctx.strokeStyle = c.accentInk;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cxr - 7, cyr);
      ctx.lineTo(cxr - 2, cyr + 5);
      ctx.lineTo(cxr + 7, cyr - 6);
      ctx.stroke();
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = c.ink;
      ctx.font = '900 14px ' + MONO;
      ctx.fillText(String(secsLeft()) + 's', cxr, cyr + 1);
    }
    ctx.restore();
  }

  function drawHeader(c) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.ink;
    ctx.font = '800 12px ' + MONO;
    ctx.fillText(setLabel() + ' · ' + def().title, 14, 22);
    ctx.font = '700 11px ' + MONO;
    ctx.fillStyle = c.muted;
    var amount = inkAmount(dist);
    ctx.fillText(amount, 14, 41);
    if (state === 'reveal' && reveal) {
      /* measured in the font it was drawn in, before switching weights */
      var after = 14 + ctx.measureText(amount).width;
      ctx.fillStyle = c.accentInk;
      ctx.font = '800 11px ' + MONO;
      ctx.fillText(' · ' + Math.round(reveal.score) + '/100', after, 41);
    }
    ctx.restore();
    drawRing(c);
  }

  function drawReveal(c) {
    var d = reveal.detail, i, p;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 11px ' + MONO;
    if (reveal.kind === 'circles') {
      /* interest, not judgement: here is your roundest loop and your
         least round one, both of them fine. */
      if (d.tightest) markLoop(c, d.tightest, 'tightest', false);
      if (d.loosest && d.loosest !== d.tightest) markLoop(c, d.loosest, 'loosest', true);
    } else if (reveal.kind === 'sweeps' && d.axis !== null) {
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2, L = boxDiag * 0.42;
      var band = Math.min(60, d.spread) * Math.PI / 180;
      ctx.strokeStyle = c.accentInk;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(d.axis) * L, cy - Math.sin(d.axis) * L);
      ctx.lineTo(cx + Math.cos(d.axis) * L, cy + Math.sin(d.axis) * L);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1.5;
      for (i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(d.axis + band * i) * L, cy - Math.sin(d.axis + band * i) * L);
        ctx.lineTo(cx + Math.cos(d.axis + band * i) * L, cy + Math.sin(d.axis + band * i) * L);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (reveal.kind === 'eights') {
      ctx.fillStyle = c.accentInk;
      for (i = 0; i < d.points.length; i++) {
        p = d.points[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function markLoop(c, loop, label, dashed) {
    ctx.save();
    ctx.strokeStyle = c.accentInk;
    ctx.lineWidth = 2.5;
    if (dashed) ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(loop.cx, loop.cy, Math.max(8, loop.r), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    var ly = loop.cy - Math.max(8, loop.r) - 7;
    if (ly < box.y + 12) ly = loop.cy + Math.max(8, loop.r) + 15;
    ctx.fillStyle = c.ink;
    ctx.font = '800 11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText(label, Math.max(28, Math.min(W - 28, loop.cx)), ly);
    ctx.restore();
  }

  function draw() {
    var c = inks(), i;
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (state === 'idle') {
      drawGuide(c, true);
      ctx.save();
      ctx.fillStyle = c.muted;
      ctx.font = '800 13px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText('press “new round” to loosen up', box.x + box.w / 2, box.y + box.h / 2);
      ctx.restore();
      return;
    }

    drawGuide(c, state === 'reveal');
    drawHeader(c);

    /* the player's ink — always graphite, never marked up in red */
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2.2;
    ctx.save();
    if (state === 'reveal') ctx.globalAlpha = 0.55;
    for (i = 0; i < strokes.length; i++) drawPolyline(strokes[i]);
    if (cur) drawPolyline(cur);
    ctx.restore();

    if (state === 'reveal' && reveal) drawReveal(c);
  }

  /* ---- input: draw anywhere, lift as often as you like ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, ev.clientX - rect.left)),
      y: Math.max(0, Math.min(H, ev.clientY - rect.top)),
    };
  }

  function pushSample(p) {
    if (!cur) return;
    var last = cur[cur.length - 1];
    var d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < MIN_STEP) return;   /* jitter, not motion */
    cur.push(p);
    dist += d;
    if (!ringAnnounced && dist >= targetDistance) {
      ringAnnounced = true;
      hint.textContent = setLabel() + ' · ring full — that was the whole target. keep going, it all counts.';
    }
  }

  function commitCur() {
    if (cur && cur.length) strokes.push(cur);
    if (activePtr !== null) {
      try { canvas.releasePointerCapture(activePtr); } catch (e) {}
    }
    cur = null;
    activePtr = null;
    activeType = '';
  }

  /* Palm rejection. A pointerId guard on its own only ever rejects the
     SECOND contact — on a tablet the heel of the hand lands FIRST, so it
     was the nib being ignored for as long as the palm rested. A pen now
     takes the stroke off a touch that already owns it (and the palm's
     drift is thrown away rather than inked), and a touch is inert for a
     beat after the pen last spoke. */
  var lastPenAt = -Infinity, PEN_LOCK_MS = 700;
  function notePen(ev) { if (ev.pointerType === 'pen') lastPenAt = Date.now(); }
  function penShadowed(ev) {
    return ev.pointerType === 'touch' && Date.now() - lastPenAt < PEN_LOCK_MS;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    notePen(ev);
    if (state === 'reveal') {
      /* THE BEAT IS A FLOOR (WCAG 2.2.1): the press cancels the pending
         advance and the RELEASE continues — the quick tap is unchanged
         (still behind SKIP_GUARD_MS, so the scribble already in flight
         when the clock ran out changes nothing), and a press kept down
         holds the reveal for as long as the hand does. */
      ev.preventDefault();
      if (Date.now() - revealAt < SKIP_GUARD_MS) return;
      clearTimeout(revealTimer);
      revealTimer = null;
      holdPointer = ev.pointerId;
      return;
    }
    if (state !== 'ready' && state !== 'run') return;
    if (penShadowed(ev)) return;
    if (activePtr !== null) {
      /* one hand at a time — but only a pen may take a stroke off a
         contact already in flight */
      if (ev.pointerType !== 'pen' || activeType === 'pen') return;
      if (cur) dist = Math.max(0, dist - polyDistance(cur));
      try { canvas.releasePointerCapture(activePtr); } catch (e) {}
      cur = null;
      activePtr = null;
      activeType = '';
      /* the palm was also what started the 25 s clock, before the player
         had drawn anything — give the set back */
      if (clockStartedByTouch && !strokes.length) {
        deadline = Date.now() + SET_MS;
        clockStartedByTouch = false;
      }
    }
    ev.preventDefault();
    if (state === 'ready') {
      /* the press that starts the set is also its first mark — nothing
         is swallowed to "start" the drill */
      state = 'run';
      deadline = Date.now() + SET_MS;
      clockStartedByTouch = ev.pointerType !== 'pen';
      hint.textContent = setLabel() + ' · ' + def().verb + '. lift as often as you like — every stroke counts.';
      updateNextBtn();
      startLoop();
    }
    activePtr = ev.pointerId;
    activeType = ev.pointerType || '';
    cur = [pointerPos(ev)];
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    notePen(ev);
    if (state !== 'run' || ev.pointerId !== activePtr || !cur) return;
    ev.preventDefault();
    /* coalesced events: full-fidelity sampling of fast scribbles */
    var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
    if (evs && evs.length) {
      for (var i = 0; i < evs.length; i++) pushSample(pointerPos(evs[i]));
    } else {
      pushSample(pointerPos(ev));
    }
    /* no draw() here — the countdown loop is already repainting every
       frame for as long as the set is running */
  });

  function endStroke(ev) {
    /* The release of a reveal-holding press continues the round; this
       handler serves pointercancel too, and a CANCELLED hold is not a
       deliberate lift — it hands the beat back instead of advancing. */
    if (holdPointer !== null && ev.pointerId === holdPointer) {
      holdPointer = null;
      if (state === 'reveal') {
        if (ev.type === 'pointercancel') {
          if (revealTimer === null && !document.hidden) {
            revealAt = Date.now();
            revealTimer = setTimeout(nextStep, REVEAL_MS);
          }
        } else {
          nextStep();
        }
      }
      return;
    }
    if (ev.pointerId !== activePtr) return;
    commitCur();
    draw();
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);
  /* iOS can drop the capture with NO pointerup and NO pointercancel. Without
     this the contact never ends: activePtr stays set, the one-hand-at-a-time
     guard refuses every later press, and the set runs its clock down on a dead
     sheet. lostpointercapture always fires on the capturing element, and after
     a normal pointerup it is a no-op (activePtr is already null). */
  canvas.addEventListener('lostpointercapture', endStroke);

  canvas.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && state === 'reveal') {
      ev.preventDefault();
      clearTimeout(revealTimer);
      revealTimer = null;
      nextStep();
    }
  });

  /* ---- set end → reveal ---- */
  function finishSet() {
    /* 'ready' counts too: an unmarked set banks as 0 ink / 0 points so the
       round can always be completed — and therefore always reported. */
    if (state !== 'run' && state !== 'ready') return;
    stopLoop();
    commitCur();
    var res = scoreSet(def().kind, strokes, dist, targetDistance, tuning());
    setScores.push(res.score);
    reveal = res;
    state = 'reveal';
    revealAt = Date.now();
    if (setScores.length >= SETS && !roundResult) {
      /* The round is complete NOW — report before the reveal plays out, so
         "new round" (or the embed player closing the tab) during that 2.8s
         hold can never swallow three played sets. finishRound() is
         presentation only; this is the single report site. */
      roundResult = ArtDaily.report(roundScore(setScores));
      hudScore.textContent = String(roundResult.score);
      hudBest.textContent = roundResult.best === null ? '–' : String(roundResult.best);
    }
    hint.textContent = setLabel() + ' done · ' + inkPhrase(dist) + ' · ' + warmLine(res) +
      ' · ' + Math.round(res.score) + '/100 — ' +
      splitWords(scoreSplit(dist, targetDistance, res.quality)) + '.';
    updateNextBtn();
    draw();
    clearTimeout(revealTimer);
    revealTimer = null;
    revealTimer = setTimeout(nextStep, REVEAL_MS);
  }

  function warmLine(res) {
    var d = res.detail;
    /* A set that was skipped, or whose clock never started, has no drawing
       to critique — and every branch below reads as a critique of one. The
       eights branch was the worst of them: with no ink at all the span is 0
       and minSpan is a positive eased radius, so `span < minSpan` fired and
       an untouched sheet was told "that all happened in one spot — swing the
       eights right across the box". Name the actual situation instead. */
    if (!(dist > 0)) return 'the clock only starts on your first mark — press and scribble next time';
    if (res.kind === 'circles') {
      if (!d.loops.length) return 'no closed loops yet — make them bigger and sloppier';
      if (d.loops.length === 1) return 'one loop, circled';
      return d.loops.length + ' loops, tightest and loosest circled';
    }
    if (res.kind === 'sweeps') {
      if (d.spread === null) return 'few full sweeps yet — long ones, corner to corner';
      if (d.spread > 60) return 'your sweeps fanned right out — next time send them all down one diagonal';
      return 'your sweeps held to ±' + Math.round(d.spread) + '° of one another';
    }
    /* crossings without any ground covered are a shiver, not a figure — say
       the useful thing rather than "you crossed your own path 900 times" */
    if (d.minSpan > 0 && d.span < d.minSpan) {
      return 'that all happened in one spot — swing the eights right across the box';
    }
    if (!d.count) return 'no crossings yet — let the loops overlap in the middle';
    return 'you crossed your own path ' + d.count + (d.count === 1 ? ' time' : ' times');
  }

  function nextStep() {
    holdPointer = null;
    if (state !== 'reveal') return;
    clearTimeout(revealTimer);
    revealTimer = null;
    if (setIdx + 1 < SETS) {
      setIdx += 1;
      startSet();
      return;
    }
    finishRound();
  }

  /* Presentation only: finishSet() already reported the round the instant the
     third set was scored, so every completed round reaches ArtDaily.report
     exactly once — even if this never runs. */
  function finishRound() {
    if (roundDone) return;   /* the closing screen plays once */
    roundDone = true;
    stopLoop();
    clearTimeout(revealTimer);
    revealTimer = null;
    state = 'idle';
    reveal = null;
    strokes = [];
    cur = null;
    activePtr = null;
    activeType = '';
    updateNextBtn();
    draw();
    var res = roundResult;
    if (!res) return;
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'arm’s warm — ' + res.score + '/100 across the three sets. ' +
      'warm-ups are for the arm, not the drawing: press “new round” whenever.';
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function showToast(msg, celebrate) {
    toast.innerHTML = '';
    var s = document.createElement('span');
    s.className = celebrate ? 'toast-accent' : '';
    s.textContent = msg;
    toast.appendChild(s);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  /* ---- chrome wiring ---- */
  document.getElementById('btnRound').addEventListener('click', newRound);

  btnNext.addEventListener('click', function () {
    if (state === 'reveal') { nextStep(); return; }
    if (state === 'run' || state === 'ready') finishSet();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  /* hardware swapped mid-session: the HUD chip is the SDK's, the
     tolerances are rebuilt per set, so this only needs a repaint */
  ArtDaily.onInput(function () { draw(); });

  /* setTimeout keeps firing while the page is hidden, so a notification or
     an app switch during the 2.8s reveal used to advance to the next set
     behind the player's back — and the reveal is the only place the set's
     score split, its ink total and its marked-up loops / sweep axis /
     crossings are ever shown. Worse, it also STARTED the next set, whose
     "ready" screen then sat there un-drawn. Park the beat while hidden and
     hand it back in full.

     Nothing can be lost by parking it: finishSet() reports a finished round
     synchronously the moment the third set is scored, so this beat only
     ever advances a SET or plays the closing screen. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (state === 'reveal' && revealTimer === null && holdPointer === null) {
      /* the beat starts over, and so does the guard that stops the
         returning contact from being read as "skip this" */
      revealAt = Date.now();
      revealTimer = setTimeout(nextStep, REVEAL_MS);
    }
  });

  /* Everything already drawn is in CSS pixels placed against the old
     canvas box, so a resize has to carry the ink across or the set the
     player is halfway through strands itself off-screen. */
  function scalePoints(pts, sx, sy) {
    for (var i = 0; i < pts.length; i++) { pts[i].x *= sx; pts[i].y *= sy; }
  }

  window.addEventListener('resize', function () {
    var oldW = W, oldH = H;
    fitCanvas();
    if (W === oldW && H === oldH) { draw(); return; }
    if (oldW > 0 && oldH > 0) {
      var sx = W / oldW, sy = H / oldH, i;
      for (i = 0; i < strokes.length; i++) scalePoints(strokes[i], sx, sy);
      if (cur) scalePoints(cur, sx, sy);
      if (reveal && reveal.detail) {
        if (reveal.detail.loops) {
          for (i = 0; i < reveal.detail.loops.length; i++) {
            var lp = reveal.detail.loops[i];
            lp.cx *= sx; lp.cy *= sy; lp.r *= (sx + sy) / 2;
          }
        }
        if (reveal.detail.points) scalePoints(reveal.detail.points, sx, sy);
        /* the sweep axis is stored as an angle and re-drawn through the
           new box centre, so it needs no rescale */
      }
      /* the ink moved with the canvas, so re-measure it there — the
         ring keeps showing the truth instead of jumping */
      dist = totalDistance(strokes) + polyDistance(cur || []);
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  hint.textContent = 'three 25-second sets — loose circles, diagonal sweeps, figure eights. ' +
    'press “new round” and scribble: the ring fills with distance, not accuracy.';
  updateNextBtn();
  draw();
})();
