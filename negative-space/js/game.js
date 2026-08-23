/* ============================================================
   game.js — Negative Space: trace the trapped paper, not the
   objects. Each item builds the gap polygon FIRST (a smooth
   star-shaped blob — exact ground truth), then arranges 2–3 bold
   solid silhouettes around it and punches the gap out, so the
   negative space is literal paper. The gap breathes twice in an
   accent wash, goes silent, and the player traces its outline
   directly on the drawing. Scoring is a pure symmetric chamfer
   between their strokes and the dense-sampled true boundary,
   measured point→path and combined by the WORSE direction so
   neither scribbling the gap full nor tracing half of it pays —
   the pure functions sit at the top, unit-testable without a
   canvas. The chamfer that scores zero has a pixel floor and a
   per-mode hand allowance (ArtDaily.ease), the gap's narrow side
   has a pixel floor of its own, and a short lift is bridged, so a
   trackpad's four swipes read as one line. Round = mean of 3
   items, slimmer gaps later; the first of a round stays tinted.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'negative-space';
  var ITEMS_PER_ROUND = 3;
  var GAP_STEPS = 64;        /* raw gap polygon resolution */
  var TRUTH_SAMPLES = 220;   /* dense, evenly spaced boundary samples */
  var MIN_DONE_POINTS = 20;  /* "done ✓" enables at this many points */
  var MIN_STROKE_POINTS = 3; /* shorter = accidental tap, ignored */
  var MIN_STROKE_PX = 8;     /* …unless it covered real ground        */
  var MAX_SCORED_POINTS = 600;
  var FALLOFF = 0.09;        /* chamfer / diag that scores zero */
  var FLOOR_PX = 12;         /* …but never a tighter window than this */
  var HAND_SLOP_PX = 6;      /* wobble the hardware adds, not the eye  */
  var BRIDGE_FRAC = 0.06;    /* lift shorter than this (of the gap's   */
  var BRIDGE_FLOOR_PX = 12;  /*   diagonal) reads as one line          */
  var MIN_GAP_PX = 30;       /* a gap narrower than the finger tracing
                                it is not a drill, it is a dare       */
  var PULSE_MS = 1200;       /* two breaths of the gap wash */
  var PULSE_DELAY_MS = 420;  /* …after the sheet has actually settled  */
  var REVEAL_MS = 1700;
  var NOISE_FLOOR = 0.004;   /* sampling-noise allowance so a dead-on
                                trace can genuinely reach 100 */

  /* ============================================================
     Pure scoring — geometry in, 0–100 out. No canvas, no DOM.
     ============================================================ */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function bboxDiag(pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }

  function pathLength(pts) {
    var L = 0, i;
    for (i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }

  /* A tap is a tap by either measure: too few samples AND too little
     ink. Sample count alone would drop a fast two-sample drag, which is
     exactly what a device with a slow event rate produces. */
  function isRealStroke(pts) {
    return pts.length >= MIN_STROKE_POINTS || (pts.length >= 2 && pathLength(pts) >= MIN_STROKE_PX);
  }

  /* The gap's narrow dimension — what the tracing finger has to fit in. */
  function bboxMinSide(pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return Math.min(maxX - minX, maxY - minY);
  }

  function flattenStrokes(strokes) {
    var out = [], s, i;
    for (s = 0; s < strokes.length; s++) {
      for (i = 0; i < strokes[s].length; i++) out.push(strokes[s][i]);
    }
    return out;
  }

  function distSqToSegment(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var wx = p.x - a.x, wy = p.y - a.y;
    var len = vx * vx + vy * vy;
    var t = len === 0 ? 0 : clamp01((wx * vx + wy * vy) / len);
    var dx = wx - t * vx, dy = wy - t * vy;
    return dx * dx + dy * dy;
  }

  /* The truth is a closed loop, so the wrap-around segment counts. */
  function distToClosedPath(p, path) {
    var best = Infinity, n = path.length, i, d;
    for (i = 0; i < n; i++) {
      d = distSqToSegment(p, path[i], path[(i + 1) % n]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /* The player's strokes are OPEN polylines and must stay separate —
     joining them would invent a segment across the lift between two
     strokes and forgive whatever the gap between them missed. */
  function distToStrokes(p, strokes) {
    var best = Infinity, s, i, st, d, dx, dy;
    for (s = 0; s < strokes.length; s++) {
      st = strokes[s];
      if (st.length === 1) {
        dx = p.x - st[0].x; dy = p.y - st[0].y;
        d = dx * dx + dy * dy;
        if (d < best) best = d;
        continue;
      }
      for (i = 0; i + 1 < st.length; i++) {
        d = distSqToSegment(p, st[i], st[i + 1]);
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }

  function decimate(pts, maxN) {
    if (pts.length <= maxN) return pts;
    var out = [], step = pts.length / maxN, i;
    for (i = 0; i < maxN; i++) out.push(pts[Math.floor(i * step)]);
    return out;
  }

  /* A trackpad physically cannot pull a long loop in one throw, so the
     honest trace arrives as four swipes with 10px repositioning gaps —
     and the truth samples opposite each gap used to set the whole score.
     Consecutive strokes whose lift is shorter than maxGap are joined
     into one polyline for the truth→ink direction only. A genuinely
     skipped section is far longer than maxGap and is still charged. */
  function bridgeStrokes(strokes, maxGap) {
    if (!(maxGap > 0)) return strokes;
    var out = [], cur = null, i, k, st, tail;
    for (i = 0; i < strokes.length; i++) {
      st = strokes[i];
      if (!st.length) continue;
      if (cur && Math.hypot(st[0].x - tail.x, st[0].y - tail.y) <= maxGap) {
        for (k = 0; k < st.length; k++) cur.push(st[k]);
      } else {
        cur = st.slice();
        out.push(cur);
      }
      tail = cur[cur.length - 1];
    }
    return out;
  }

  /* Symmetric chamfer: theirs → truth punishes stray marks, truth →
     theirs punishes missing sections — combined by taking the WORSE
     direction. Averaging the two would half-forgive both classic
     cheeses: scribbling the gap full of ink zeroes the truth→ink term
     (and scored ~43 with no boundary at all), and tracing only half
     the outline zeroes the ink→truth term. The max keeps both near 0
     while an honest trace, whose error is symmetric, is unaffected.
     Nearest is measured point→opposite *path* (segments, not samples)
     so a trace scores on accuracy, not on how many pointermove events
     the player's device happened to emit.

     Both directions are RETURNED, not just the max, because they are
     two different mistakes and the reveal has to be able to name which
     one was made: ink→truth high is "your line is off the edge", truth
     →ink high is "part of the edge was never traced". The score still
     uses only the worse of them, exactly as before. */
  function chamferParts(strokes, truthPts, bridgeGap) {
    var pPts = decimate(flattenStrokes(strokes), MAX_SCORED_POINTS);
    if (!pPts.length || truthPts.length < 2) {
      return { ink: Infinity, truth: Infinity, worst: Infinity, perTruth: [] };
    }
    var joined = bridgeStrokes(strokes, bridgeGap);
    var sumA = 0, sumB = 0, i, d, per = [];
    for (i = 0; i < pPts.length; i++) sumA += distToClosedPath(pPts[i], truthPts);
    for (i = 0; i < truthPts.length; i++) {
      d = distToStrokes(truthPts[i], joined);
      per.push(d);
      sumB += d;
    }
    var ink = sumA / pPts.length, truth = sumB / truthPts.length;
    return { ink: ink, truth: truth, worst: Math.max(ink, truth), perTruth: per };
  }

  function chamferStrokes(strokes, truthPts, bridgeGap) {
    return chamferParts(strokes, truthPts, bridgeGap).worst;
  }

  /* The mean chamfer at which the item scores zero, in px: 9% of the
     gap's bounding diagonal, floored in pixels so a 330px phone sheet
     is not judged twice as strictly as a 690px desktop one for the same
     drill, plus the hand allowance for whatever is doing the drawing.
     Both pixel terms arrive already eased by the caller. */
  function gapZeroPx(diag, floorPx, slopPx) {
    var f = typeof floorPx === 'number' && isFinite(floorPx) ? floorPx : 0;
    var s = typeof slopPx === 'number' && isFinite(slopPx) ? slopPx : 0;
    return Math.max(FALLOFF * diag, f) + s;
  }

  /* No translation forgiveness — the gap has a place. Takes the stroke
     ARRAY, not a flat point list. Returns the score AND the two error
     directions plus the stretches of the true edge the trace never
     reached, so the reveal can show and name the delta instead of
     flashing a bare number. Score is byte-for-byte the old formula. */
  function gapDetail(strokes, truthPts, floorPx, slopPx, bridgeGap) {
    var blank = { score: 0, ink: Infinity, truth: Infinity, worst: Infinity, zero: 0, missRuns: [] };
    if (!strokes || !strokes.length || !truthPts || truthPts.length < 2) return blank;
    var diag = bboxDiag(truthPts);
    if (!(diag > 0)) return blank;
    var parts = chamferParts(strokes, truthPts, bridgeGap);
    if (!isFinite(parts.worst)) return blank;
    var zero = gapZeroPx(diag, floorPx, slopPx);
    if (!(zero > 0)) return blank;
    var d = Math.max(0, parts.worst - NOISE_FLOOR * diag);
    return {
      score: 100 * clamp01(1 - d / zero),
      ink: parts.ink,
      truth: parts.truth,
      worst: parts.worst,
      zero: zero,
      missRuns: missRuns(parts.perTruth, zero)
    };
  }

  function gapScore(strokes, truthPts, floorPx, slopPx, bridgeGap) {
    return gapDetail(strokes, truthPts, floorPx, slopPx, bridgeGap).score;
  }

  /* Contiguous [from,to] index runs of the true edge that sit further
     from the player's ink than the whole scoring window — i.e. the
     stretches the trace genuinely never went near. The truth is a
     CLOSED loop, so a run spanning index 0 is joined up rather than
     reported as two. Runs shorter than 3 samples are sampling noise. */
  function missRuns(perTruth, zero) {
    var n = perTruth ? perTruth.length : 0, runs = [], i, start = -1;
    if (!n || !(zero > 0)) return runs;
    for (i = 0; i < n; i++) {
      if (perTruth[i] > zero) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        runs.push([start, i - 1]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, n - 1]);
    /* wrap: a run ending at the last sample continues into one starting at 0 */
    if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) {
      runs[0][0] = runs[runs.length - 1][0] - n;
      runs.pop();
    }
    var out = [];
    for (i = 0; i < runs.length; i++) if (runs[i][1] - runs[i][0] >= 2) out.push(runs[i]);
    return out;
  }

  /* How much worse one chamfer direction has to be than the other before
     it names the mistake; the score at which there is no mistake left to
     name; and the score below which "the right shape, misplaced" stops
     being an honest reading of what happened. */
  var DIR_RATIO = 1.25;
  var CLEAN_SCORE = 85;
  var LOST_SCORE = 25;

  /* WHICH of the five things happened, decided in exactly one place.
     gapVerdict() turns a state into the sentence the player reads and
     roundCoach() counts the states across the round, so the line that
     closes a round can never contradict the three that led up to it —
     which is not hypothetical: a trace of the right shape sitting a
     uniform 22px outside the edge is neither "missed" nor "strayed" (both
     chamfer directions are equal), so a round of three of them counted
     zero of everything and closed on "no one habit stood out" while each
     item had just said "the right shape, sitting off the edge". */
  function gapKind(det) {
    if (!det || !isFinite(det.worst) || !(det.zero > 0)) return 'none';
    if (det.score >= CLEAN_SCORE) return 'clean';
    if (det.truth > det.ink * DIR_RATIO) return 'missed';
    if (det.ink > det.truth * DIR_RATIO) return 'strayed';
    /* Both directions equally bad AND both large is not "the right shape
       slightly misplaced" — a scribble balled up inside the gap lands
       here, and telling that player their shape was right is a lie the
       score is already contradicting. */
    if (det.score < LOST_SCORE) return 'lost';
    return 'offset';
  }

  var GAP_WORDS = {
    none: 'nothing to compare — trace right round the trapped paper.',
    clean: 'right on the edge — you read the space, not the objects.',
    strayed: 'your line drifted off the space — follow where the paper meets the black.',
    lost: 'that is not the edge yet — trace where the paper meets the black, right the way round.',
    offset: 'the right shape, sitting off the edge — trust the paper, not the objects.'
  };

  /* The delta, in words. A number on its own teaches nothing: the two
     chamfer directions are two different mistakes and the player has to
     be told which one they made before they can fix it. */
  function gapVerdict(det) {
    var kind = gapKind(det);
    if (kind === 'missed') {
      return (det.missRuns && det.missRuns.length)
        ? 'you left part of the edge untraced — the thick stretches are where your line never went.'
        : 'you traced most of it but stopped short — go the whole way round.';
    }
    return GAP_WORDS[kind] || GAP_WORDS.none;
  }

  /* Each item named its own miss and then the round closed on "press new
     round" — so a player who stops short of the far side of every gap was
     told so three separate times and never once told it was a habit. One
     line, naming the pattern across the round. Takes the gapKind() strings. */
  function roundCoach(kinds) {
    var n = kinds ? kinds.length : 0, i, k;
    var clean = 0, missed = 0, strayed = 0, off = 0;
    if (!n) return 'nothing traced this round.';
    for (i = 0; i < n; i++) {
      k = kinds[i];
      if (k === 'clean') clean += 1;
      else if (k === 'missed') missed += 1;
      else if (k === 'strayed') strayed += 1;
      else if (k === 'lost' || k === 'offset') off += 1;
    }
    if (clean === n) {
      return 'you read the space every time, and the gaps got slimmer as the round went on.';
    }
    if (missed >= strayed && missed >= off && missed * 2 >= n) {
      return 'you kept stopping short of the whole edge — go right the way round, back to where you started.';
    }
    if (strayed >= off && strayed * 2 >= n) {
      return 'your line kept drifting off the space — follow where the paper meets the black, not the object you expect.';
    }
    if (off * 2 >= n) {
      return 'your shapes were close but sat off the edge — put the line exactly where the paper meets the black.';
    }
    return 'no one habit stood out — trace where the paper meets the black, right the way round.';
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    return sum / scores.length;
  }

  /* ============================================================
     Pure geometry — gap construction (no random, no canvas).
     ============================================================ */
  /* Smooth closed blob around the origin: base radius modulated by two
     low harmonics, scaled anisotropically, then rotated. Star-shaped
     about the origin by construction, so a ring with inner radius ≤
     min-radius always encloses it cleanly. */
  function makeGapPoly(base, a2, ph2, a3, ph3, sx, sy, rot, steps) {
    var pts = [], cr = Math.cos(rot), sr = Math.sin(rot), i, th, r, x, y;
    for (i = 0; i < steps; i++) {
      th = (i / steps) * Math.PI * 2;
      r = base * (1 + a2 * Math.cos(2 * th + ph2) + a3 * Math.cos(3 * th + ph3));
      x = Math.cos(th) * r * sx;
      y = Math.sin(th) * r * sy;
      pts.push({ x: x * cr - y * sr, y: x * sr + y * cr });
    }
    return pts;
  }

  /* Even arc-length resampling of a closed polygon. */
  function resampleClosed(pts, n) {
    var m = pts.length, segs = [], per = 0, i, a, b;
    for (i = 0; i < m; i++) {
      a = pts[i];
      b = pts[(i + 1) % m];
      segs.push(Math.hypot(b.x - a.x, b.y - a.y));
      per += segs[i];
    }
    if (per === 0) return pts.slice();
    var out = [], step = per / n, si = 0, acc = 0, target, t, k;
    for (k = 0; k < n; k++) {
      target = k * step;
      while (si < m - 1 && acc + segs[si] < target) { acc += segs[si]; si += 1; }
      a = pts[si];
      b = pts[(si + 1) % m];
      t = segs[si] > 0 ? (target - acc) / segs[si] : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  function polyRadius(pts) {
    var mx = 0, mn = Infinity, i, d;
    for (i = 0; i < pts.length; i++) {
      d = Math.hypot(pts[i].x, pts[i].y);
      if (d > mx) mx = d;
      if (d < mn) mn = d;
    }
    return { max: mx, min: mn };
  }

  function movePoly(pts, s, dx, dy) {
    var out = [], i;
    for (i = 0; i < pts.length; i++) out.push({ x: pts[i].x * s + dx, y: pts[i].y * s + dy });
    return out;
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
  var btnDone = document.getElementById('btnDone');
  var btnUndo = document.getElementById('btnUndo');
  var btnAgain = document.getElementById('btnAgain');
  var btnClear = document.getElementById('btnClear');

  ArtDaily.init({ slug: SLUG });

  /* ---- per-hardware tolerance (the HUD says which mode it eased for) ---- */
  function floorPx() { return ArtDaily.ease(FLOOR_PX); }
  function slopPx() { return ArtDaily.ease(HAND_SLOP_PX); }
  function bridgePx(diag) { return Math.max(BRIDGE_FRAC * diag, ArtDaily.ease(BRIDGE_FLOOR_PX)); }
  /* startRadius, not ease: this is "can the instrument fit inside the
     shape", which is the pen tablet's and the fingertip's problem, not
     the mouse's. */
  function minGapPx() { return ArtDaily.startRadius(MIN_GAP_PX); }

  var REDUCED_MOTION = false;
  try { REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim(),
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ----
     A phone gets a taller sheet: the whole drill is one small shape and
     0.62 left it 205px tall. The ratio is decided once, at boot, so a
     resize stays a uniform rescale (rotating a phone must not stretch a
     trace in progress). */
  var W = 0, H = 0, ASPECT = 0.62;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    if (!ASPECT) ASPECT = 0.62;
    H = Math.round(W * ASPECT);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], item = null, playing = false;
  /* one gapKind() per scored item — what the round-end coaching is built
     from (see roundCoach) */
  var itemKinds = [];
  var strokes = [], cur = [], drawingNow = false, activePtr = null, activeType = '';
  var revealing = null, revealTimer = null, pulsing = null, roundResult = null;
  /* The pointer pressed during the reveal: the auto-advance is cancelled and
     the screen is theirs until they press again (the beat-is-a-floor rule in
     the pointerdown handler). Distinct from a PARKED timer (hidden tab), so
     the visibility re-arm never un-holds a held reveal. Cleared by nextItem
     and newRound. The round is banked in onDone before the last reveal, so
     nothing on this path can file or lose a score. */
  var revealHeld = false;

  /* ---- where the three compositions come from --------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS. Round 1 of a
     sitting is dealt from ArtDaily.roundRandom(1) — seeded from today and
     this slug — so every player traces the same three gaps today, and
     item 2 is the same vocabulary ('arch' or 'ring') for all of them.
     Round 2 and on are practice: same generator, same distribution,
     unshared seed.

     NO PER-ITEM CACHE IS NEEDED HERE, unlike lines. makeItem() is called
     exactly once per item (newRound, then nextItem), and a resize
     MULTIPLIES the whole composition through rather than rebuilding it —
     deliberately, and it predates this (see the resize handler: rebuilding
     would throw away a trace in progress on every phone rotation). So a
     plain rolling generator can never swap the gap under the player's hand.

     WHAT IS SHARED IS THE GAP'S SHAPE, EXACTLY — and that is the part
     being scored. makeGapPoly is fed nothing but draws (base is a fraction
     of H; a2/a3/ph2/ph3/sx/sy/rot are pure numbers), then movePoly applies
     ONE uniform scale and a translation, and scoring is chamfer over the
     bounding diagonal. So a phone and a desktop trace the same outline at
     different sizes for the same score.

     THE ONE PLACE THIS DRILL CANNOT PROMISE MORE — read before adding a
     draw. randIn() below SKIPS its draw when the range has collapsed
     (hi <= lo), returning the midpoint instead. That is not decoration: the
     ranges are built from W, H, pad and D, and D grows when minGapPx()
     stretches a narrow gap up to a fingertip's width on a small sheet, so
     in principle a phone can collapse a range a desktop does not. If that
     ever happens the round's generator is one draw behind for the REST of
     that round and the compositions after it diverge from a wider sheet's —
     still a legitimate gap, still an internally consistent round, just not
     the same round the desktop player got.
     MEASURED, and it did not fire: a full round played at 330px and at
     1100px pulls an identical draw count on every one of eight different
     days (9 / 22 / 36 or 9 / 25 / 39 after each item — the 22-vs-25 split is
     the seeded arch/ring branch, which agrees across both widths). So the
     hazard is real in the code and not reached by today's geometry. Left
     exactly as it was rather than made to draw-and-discard, because the
     branch structure and the values it returns are the drill's, not this
     conversion's, to change. Flagged so it is decided on purpose, and
     re-measure this if the ranges, pad, minGapPx or the aspect ever move.

     GUARDED, and the guard is load-bearing: index.html cache-busts its own
     scripts but every drill loads ../sdk/artdaily-sdk.js BARE, so the two
     cache independently and a returning visitor can hold a warm old SDK
     against a cold copy of this file. An unguarded call would throw inside
     newRound() before the first item exists — blank sheet, "Loading…"
     forever. Only the BARE call form is used: every draw in this drill goes
     through uniform() below, and Math.random is a drop-in for that. */
  var roundRng = null;

  /* One raw uniform in [0,1) — the round's, or the plain one when an old
     SDK is cached. Every random draw in this file goes through here. */
  function uniform() { return roundRng ? roundRng() : Math.random(); }

  /* Unchanged as functions — lo + u * (hi - lo) is exactly what rand always
     was, with Math.random() swapped for the round's uniform, and randIn's
     degenerate branch is untouched. u is uniform on [0,1) either way, so
     every value downstream keeps precisely the shape it had. */
  function rand(lo, hi) { return lo + uniform() * (hi - lo); }
  function randIn(lo, hi) { return hi <= lo ? (lo + hi) / 2 : rand(lo, hi); }
  function itemLabel() { return 'space ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND; }
  function trainingWheels() { return round === 1 && itemIdx === 0 && playing && !revealing; }

  /* ---- composition builders: gap first, silhouettes around it ----
     Every silhouette set union-covers a disk of radius D around the
     gap center (the shapes fuse into one mass near the gap — like
     objects touching in a still life), then the gap is punched out,
     so the enclosed paper region is exactly the ground truth. */
  function makeItem(idx) {
    var m = 14;
    var pad = Math.max(16, 0.045 * W);
    var gh = Math.max(10, 0.035 * H); /* ground-bar height */
    var vocab, base, a2, a3, sx, sy, rot;

    if (idx === 0) {          /* fat, obvious, roundish gap */
      vocab = 'mug';
      base = H * rand(0.17, 0.20); a2 = rand(0.04, 0.09); a3 = rand(0.03, 0.07);
      sx = 1; sy = rand(0.88, 1.04); rot = rand(0, Math.PI);
    } else if (idx === 1) {   /* lumpier, slightly squashed */
      vocab = uniform() < 0.5 ? 'arch' : 'ring';
      base = H * rand(0.14, 0.17); a2 = rand(0.08, 0.14); a3 = rand(0.05, 0.10);
      sx = rand(1.0, 1.2); sy = rand(0.72, 0.92); rot = rand(0, Math.PI);
    } else {                  /* sliver between leaning forms */
      vocab = 'slabs';
      base = H * rand(0.15, 0.18); a2 = rand(0.02, 0.05); a3 = rand(0.05, 0.09);
      sx = rand(0.34, 0.44); sy = rand(1.2, 1.45); rot = rand(-0.35, 0.35);
    }

    var poly = makeGapPoly(base, a2, rand(0, 6.283), a3, rand(0, 6.283), sx, sy, rot, GAP_STEPS);
    var rad = polyRadius(poly);
    var maxRc = 0.42 * H - pad;
    var scale = rad.max > maxRc ? maxRc / rad.max : 1;
    /* Floor the gap's NARROW side in absolute pixels. Item 3's sliver
       came out ~26px wide on a phone — narrower than the fingertip sent
       to trace it, which is not a hard drill, it is an impossible one.
       Grown only as far as the sheet allows. */
    var narrow = bboxMinSide(poly) * scale, want = minGapPx();
    if (narrow > 0 && narrow < want && maxRc > 0 && rad.max > 0) {
      scale = Math.min(scale * (want / narrow), maxRc / rad.max);
    }
    var Rc = rad.max * scale;       /* outermost gap radius */
    var Rmin = rad.min * scale;     /* innermost gap radius */
    var D = Rc + pad;               /* silhouettes must cover this disk */
    var g = { x: W / 2, y: H / 2 };
    var shapes = [];
    var i, ux, uy, lean, cxx, cyy, gy;

    if (vocab === 'mug') {
      /* the gap is the handle hole: body slab + fat handle disk + table */
      g.x = randIn(Math.max(0.5 * W, 1.9 * D + m), W - m - D - 8);
      g.y = randIn(D + m + 4, H - m - gh - D - 12);
      shapes.push({ t: 'disk', x: g.x, y: g.y, r: D + 4 });
      var bodyR = g.x - 0.3 * D;
      var bodyW = Math.min(1.7 * D, bodyR - m);
      var bodyT = Math.max(m, g.y - 1.18 * D);
      var bodyB = Math.min(H - m - gh + 2, g.y + 1.18 * D);
      shapes.push({ t: 'rect', x: bodyR - bodyW, y: bodyT, w: bodyW, h: bodyB - bodyT, r: 0.12 * D, rot: 0 });
      gy = Math.min(H - m - gh, Math.max(bodyB - 2, g.y + D + 6));
      var gx0 = Math.max(m, bodyR - bodyW - 0.25 * D);
      shapes.push({ t: 'rect', x: gx0, y: gy, w: Math.min(W - m, g.x + 1.45 * D) - gx0, h: gh, r: 4, rot: 0 });
    } else if (vocab === 'arch') {
      /* a pierced monolith standing on two stub legs on a ground line */
      var legLen = rand(0.08, 0.12) * H;
      var hw = D + rand(22, 30), hh = D + rand(14, 22);
      g.x = randIn(hw + m + 2, W - m - hw - 2);
      g.y = randIn(hh + m + 2, H - m - gh - legLen - hh - 4);
      shapes.push({ t: 'rect', x: g.x - hw, y: g.y - hh, w: 2 * hw, h: 2 * hh, r: 0.4 * D, rot: rand(-0.04, 0.04) });
      var lw = 0.32 * D, lx = D * rand(0.5, 0.68);
      var ly = g.y + hh - 8, lh = legLen + 14;
      shapes.push({ t: 'rect', x: g.x - lx - lw / 2, y: ly, w: lw, h: lh, r: 3, rot: 0 });
      shapes.push({ t: 'rect', x: g.x + lx - lw / 2, y: ly, w: lw, h: lh, r: 3, rot: 0 });
      shapes.push({ t: 'rect', x: m, y: g.y + hh + legLen, w: W - 2 * m, h: gh, r: 4, rot: 0 });
    } else if (vocab === 'ring') {
      /* two interlocking thick arcs (overlapping half-rings of unequal
         girth) close around the gap; a pebble keeps them company */
      g.x = randIn(D + m + 16, W - m - D - 16);
      g.y = randIn(D + m + 10, H - m - D - 16);
      var phi = rand(0, 6.283);
      shapes.push({ t: 'arc', x: g.x, y: g.y, ri: Math.max(6, Math.min(0.8 * Rmin, Rmin - 3)), ro: D + 4, a0: phi - 0.22, a1: phi + Math.PI + 0.26 });
      shapes.push({ t: 'arc', x: g.x, y: g.y, ri: Math.max(5, Math.min(0.62 * Rmin, Rmin - 4)), ro: D + 14, a0: phi + Math.PI - 0.22, a1: phi + 2 * Math.PI + 0.26 });
      var pd = rand(0, 6.283), pr = 0.2 * D;
      var px = g.x + Math.cos(pd) * 1.55 * D, py = g.y + Math.sin(pd) * 1.55 * D;
      if (px > m + pr && px < W - m - pr && py > m + pr && py < H - m - pr) {
        shapes.push({ t: 'disk', x: px, y: py, r: pr });
      }
    } else {
      /* two slabs leaning into each other over a ground bar; the gap
         is the sliver of light trapped between them */
      g.x = randIn(1.1 * D + m, W - m - 1.1 * D);
      g.y = randIn(1.32 * D + m, H - m - gh - 1.25 * D);
      ux = Math.cos(rot); uy = Math.sin(rot); /* ⊥ of the sliver's long axis */
      for (i = -1; i <= 1; i += 2) {
        lean = rot + i * rand(0.05, 0.12);
        cxx = g.x + ux * 0.45 * D * i;
        cyy = g.y + uy * 0.45 * D * i;
        shapes.push({ t: 'rect', x: cxx - 0.575 * D, y: cyy - 1.3 * D, w: 1.15 * D, h: 2.6 * D, r: 0.06 * D, rot: lean });
      }
      gy = Math.min(H - m - gh, g.y + 1.18 * D);
      var gw = (W - 2 * m) * rand(0.8, 0.95);
      shapes.push({ t: 'rect', x: randIn(m, W - m - gw), y: gy, w: gw, h: gh, r: 4, rot: 0 });
    }

    var moved = movePoly(poly, scale, g.x, g.y);
    return { g: g, D: D, poly: moved, truth: resampleClosed(moved, TRUTH_SAMPLES), shapes: shapes };
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows;
          the punched gap is literally paper) ---- */
  function rrPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fillShape(s) {
    ctx.beginPath();
    if (s.t === 'disk') {
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    } else if (s.t === 'arc') {
      ctx.arc(s.x, s.y, s.ro, s.a0, s.a1);
      ctx.arc(s.x, s.y, s.ri, s.a1, s.a0, true);
      ctx.closePath();
    } else if (s.rot) {
      ctx.save();
      ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
      ctx.rotate(s.rot);
      rrPath(-s.w / 2, -s.h / 2, s.w, s.h, s.r);
      ctx.fill();
      ctx.restore();
      return;
    } else {
      rrPath(s.x, s.y, s.w, s.h, s.r);
    }
    ctx.fill();
  }

  function pathPoly(pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function strokePolyline(pts, style, width) {
    if (pts.length < 2) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* Fat overlay on the stretches of the true edge the trace missed.
     Runs index into item.truth (the dense closed sampling), and a run
     may start at a negative index because the loop wraps — walk it
     modulo the sample count rather than clamping, or a miss straddling
     the seam would be drawn as a chord straight across the gap. */
  function drawMissRuns(c, runs) {
    var t = item.truth, n = t.length, r, i, k, p;
    if (!n) return;
    for (r = 0; r < runs.length; r++) {
      ctx.strokeStyle = c.card;
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (i = runs[r][0]; i <= runs[r][1]; i++) {
        k = ((i % n) + n) % n;
        p = t[k];
        if (i === runs[r][0]) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      for (i = runs[r][0]; i <= runs[r][1]; i++) {
        k = ((i % n) + n) % n;
        p = t[k];
        if (i === runs[r][0]) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  function pulseAlpha(t) {
    if (REDUCED_MOTION) return 0.35; /* steady wash, same duration */
    var s = Math.sin(Math.PI * t / (PULSE_MS / 2));
    return 0.45 * s * s; /* two soft breaths over PULSE_MS */
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!item) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* solid silhouettes… */
    ctx.fillStyle = c.ink;
    for (var i = 0; i < item.shapes.length; i++) fillShape(item.shapes[i]);
    /* …with the negative space punched out to bare paper */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    pathPoly(item.poly);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    /* breathing at item start / steady wash on reveal */
    var washA = 0;
    if (pulsing) {
      var pt = performance.now() - pulsing.start;
      washA = (pt < 0 || pt >= PULSE_MS) ? 0 : pulseAlpha(pt); /* pt<0 = the pre-breath beat */
    }
    /* Training wheels, first item of the first round only: the space
       stays faintly tinted for the whole trace. The hint says so, and
       item 2 takes it away. */
    if (trainingWheels()) washA = Math.max(washA, 0.13);
    if (revealing) washA = 0.3;
    if (washA > 0) {
      ctx.save();
      ctx.globalAlpha = washA;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      pathPoly(item.poly);
      ctx.fill();
      ctx.restore();
    }

    /* the player's strokes: paper halo so ink stays visible on ink */
    var all = strokes.slice();
    if (drawingNow && cur.length > 1) all.push(cur);
    for (i = 0; i < all.length; i++) {
      strokePolyline(all[i], c.card, 5.5);
      strokePolyline(all[i], c.ink, 2.4);
    }

    if (revealing) {
      /* the true boundary over the wash, their strokes kept visible */
      ctx.save();
      ctx.strokeStyle = c.card;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      pathPoly(item.poly);
      ctx.stroke();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pathPoly(item.poly);
      ctx.stroke();
      /* …and the stretches the trace never reached, drawn FAT on top of
         it. This is the whole delta made visible: thin edge = you were
         there, thick edge = you were not. The hint names it in words. */
      if (revealing.missRuns && revealing.missRuns.length) {
        drawMissRuns(c, revealing.missRuns);
      }
      ctx.restore();
      /* item score flashed at the gap */
      var label = String(revealing.score);
      var tx = Math.max(26, Math.min(W - 26, item.g.x));
      var ty = Math.max(24, Math.min(H - 12, item.g.y));
      /* ≥19px bold = WCAG "large text", so the accent-on-card label
         clears AA in the light theme too (sky/card is 3.18:1) */
      ctx.font = '900 19px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      var bw = ctx.measureText(label).width + 18;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = c.card;
      ctx.fillRect(tx - bw / 2, ty - 17, bw, 26);
      ctx.restore();
      ctx.fillStyle = c.accent;
      ctx.fillText(label, tx, ty + 2);
    }
  }

  /* ---- the breath: the gap pulses twice, then goes silent ---- */
  function startPulse() {
    /* Identity-guarded loop: "show again" and "new round" both restart
       the breath, and the superseded loop must die instead of
       double-driving draw() against the new pulse's clock.
       The breath starts a beat AFTER the sheet exists: newRound() fires
       straight out of boot, and inside the embed dialog (or on a phone
       still settling its address bar) the whole teaching moment used to
       play before anything was on screen. */
    var mine = { start: performance.now() + PULSE_DELAY_MS };
    pulsing = mine;
    hint.textContent = itemLabel() + ' — watch: the trapped space breathes twice…';
    function tick(now) {
      if (pulsing !== mine) return; /* cancelled or replaced */
      if (now - mine.start >= PULSE_MS) {
        pulsing = null;
        if (playing && !revealing) {
          /* name the replay here: a player who missed the two breaths
             otherwise has no visible way back to "which pocket was it?" */
          hint.textContent = itemLabel() + ' — trace its outline right on the drawing, then press done ✓. ' +
            (trainingWheels()
              ? 'first one is on easy: this space stays tinted while you trace.'
              : 'lift and carry on as often as you need; "show again" replays the breath, free.');
        }
        draw();
        return;
      }
      draw();
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  /* ---- input: free strokes anywhere, pointerId-guarded ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /* Keep a fast nib's real fidelity instead of the dispatch rate. */
  function pushSamples(ev, arr) {
    var list = null;
    try { list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null; } catch (e) { list = null; }
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) arr.push(pointerPos(list[i]));
      return;
    }
    arr.push(pointerPos(ev));
  }

  /* Palm rejection: pointerId guarding only rejected the SECOND contact,
     so on a tablet the palm claimed the trace and the pen drew nothing.
     A pen takes the stroke over (discarding the palm's drift) and a
     touch is ignored for a beat after any pen event. */
  var penAt = -Infinity, PEN_GUARD_MS = 900;
  function claimAllowed(ev) {
    if (ev.pointerType === 'pen') { penAt = performance.now(); return true; }
    if (ev.pointerType === 'touch' && performance.now() - penAt < PEN_GUARD_MS) return false;
    return true;
  }

  function totalPoints() {
    var n = 0, i;
    for (i = 0; i < strokes.length; i++) n += strokes[i].length;
    return n;
  }

  function updateControls() {
    var live = playing && !revealing;
    btnDone.disabled = !(live && totalPoints() >= MIN_DONE_POINTS);
    btnUndo.disabled = !(live && strokes.length > 0);
    btnAgain.disabled = !live;
    btnClear.disabled = !live;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* THE BEAT IS A FLOOR, NOT A DEADLINE (WCAG 2.2.1). A press during the
       reveal used to be thrown away; it now HOLDS the lesson — the first
       press cancels the pending advance, the next asks for the next space.
       Never scored, never counted; a palm (touch in the pen's shadow) can
       neither hold nor advance; the round-end reveal has playing=false and
       never enters this branch. On the LAST item's reveal the second press
       reaches finishRound, which is presentation-only — the round was
       banked in onDone — and sets playing=false, so it cannot re-run. */
    if (playing && revealing && ev.isPrimary !== false) {
      if (!claimAllowed(ev)) return;
      ev.preventDefault();
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; revealHeld = true; return; }
      nextItem();
      return;
    }
    if (!playing || revealing || !item) return;
    if (!claimAllowed(ev)) return;
    if (drawingNow) {
      if (ev.pointerType !== 'pen' || activeType === 'pen') return;
      cur = []; /* the palm's drift is not the player's line */
    }
    ev.preventDefault();
    drawingNow = true;
    activePtr = ev.pointerId;
    activeType = ev.pointerType || '';
    cur = [pointerPos(ev)];
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!drawingNow || ev.pointerId !== activePtr) return;
    ev.preventDefault();
    pushSamples(ev, cur);
    draw();
  });

  function endStroke(ev) {
    if (!drawingNow || ev.pointerId !== activePtr) return;
    ev.preventDefault();
    drawingNow = false;
    activePtr = null;
    activeType = '';
    /* a tap is an accident — dropped, no penalty (isRealStroke) */
    if (isRealStroke(cur)) strokes.push(cur);
    cur = [];
    if (playing && !revealing && strokes.length === 1) {
      hint.textContent = itemLabel() + ' — lifting is free: pick the line up where you left it and carry on.';
    }
    updateControls();
    draw();
  }
  canvas.addEventListener('pointerup', endStroke);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', endStroke);

  function cancelStroke(ev) {
    /* interrupted stroke (system gesture etc.) — dropped, no penalty */
    if (!drawingNow) return;
    if (ev && ev.pointerId !== undefined && ev.pointerId !== activePtr) return;
    drawingNow = false;
    activePtr = null;
    activeType = '';
    cur = [];
    updateControls();
    draw();
  }
  canvas.addEventListener('pointercancel', cancelStroke);
  window.addEventListener('pointercancel', cancelStroke);
  /* iOS can drop the capture with NO pointerup and NO pointercancel. Without
     this the trace never ends: drawingNow stays true, every later press is
     refused by the pen-takeover guard, and the item can never be traced or
     finished. lostpointercapture always fires on the capturing element, and
     after a normal pointerup it is a no-op (drawingNow is already false). */
  canvas.addEventListener('lostpointercapture', cancelStroke);

  /* ---- item flow ---- */
  function onDone() {
    if (!playing || revealing || !item) return;
    /* commit a stroke still under the finger so nothing drawn is lost */
    if (drawingNow) {
      drawingNow = false;
      activePtr = null;
      if (isRealStroke(cur)) strokes.push(cur);
      cur = [];
    }
    if (totalPoints() < MIN_DONE_POINTS) { updateControls(); draw(); return; }
    pulsing = null;
    var det = gapDetail(strokes, item.truth, floorPx(), slopPx(), bridgePx(bboxDiag(item.truth)));
    itemScores.push(det.score);
    itemKinds.push(gapKind(det));
    revealing = { score: Math.round(det.score), missRuns: det.missRuns };
    /* The verdict is what earns its place every time. The legend only
       teaches once — repeating it on every item pushed the hint to four
       lines on a phone and reflowed the sheet under the reveal. */
    hint.textContent = itemLabel() + ' — ' + revealing.score + ' · ' + gapVerdict(det) +
      (itemIdx === 0 ? ' the tinted shape is the true space; the coloured outline is its real edge.' : '');
    if (itemScores.length >= ITEMS_PER_ROUND) {
      /* the round is complete NOW — report before the reveal plays out,
         so "new round" (or the embed player closing) mid-reveal can
         never swallow a finished round's result. finishRound() is
         presentation only; this is the single report site. */
      roundResult = ArtDaily.report(roundScore(itemScores));
      hudScore.textContent = String(roundResult.score);
      hudBest.textContent = roundResult.best === null ? '–' : String(roundResult.best);
    }
    updateControls();
    draw();
    clearTimeout(revealTimer);
    revealTimer = null;
    revealTimer = setTimeout(nextItem, REVEAL_MS);
  }

  /* Undo and "show it again" used to be the same destructive button:
     the only way to re-see the space was to throw your trace away. */
  function onUndo() {
    if (!playing || revealing || !item || !strokes.length) return;
    strokes.pop();
    hint.textContent = itemLabel() + ' — last stroke removed.';
    updateControls();
    draw();
  }

  function onAgain() {
    if (!playing || revealing || !item) return;
    startPulse(); /* free, and your trace stays exactly where it is */
  }

  function onClear() {
    if (!playing || revealing || !item) return;
    strokes = [];
    cur = [];
    drawingNow = false;
    activePtr = null;
    activeType = '';
    hint.textContent = itemLabel() + ' — cleared. “show again” replays the breath, free.';
    updateControls();
    draw();
  }

  function nextItem() {
    clearTimeout(revealTimer);
    revealTimer = null;
    revealHeld = false;
    if (itemIdx + 1 >= ITEMS_PER_ROUND) { finishRound(); return; }
    revealing = null;
    itemIdx += 1;
    strokes = [];
    cur = [];
    drawingNow = false;
    item = makeItem(itemIdx);
    updateControls();
    draw();
    startPulse();
  }

  function newRound() {
    clearTimeout(revealTimer);
    revealTimer = null;
    revealHeld = false;
    /* A round whose third item is scored but still sitting on its 1.7s
       reveal was already banked at that score (onDone reports on the
       spot) — but finishRound() never ran, so the round-end coaching and
       the "new best!" toast were simply lost to an impatient press. Close
       it out on screen first, exactly as the sibling drills do; report()
       has already happened, so this cannot double-count. */
    if (playing && roundResult) finishRound();
    round += 1;
    itemIdx = 0;
    itemScores = [];
    itemKinds = [];
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. round is already 1 on the
       first round of a sitting, so round 1 is today's shared round and every
       "new round" after it is practice. Re-seeded HERE, per round, so a
       replay can never deal the round just played — and BEFORE makeItem(0)
       below, which is the first thing that draws from it. */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    strokes = [];
    cur = [];
    drawingNow = false;
    activePtr = null;
    revealing = null;
    pulsing = null;
    roundResult = null;
    playing = true;
    item = makeItem(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    updateControls();
    draw();
    startPulse();
  }

  function finishRound() {
    /* keep the last reveal on the sheet — right vs theirs stays visible.
       The score was already reported (and HUD updated) in onDone the
       moment item 3 was scored; this is presentation only. */
    playing = false;
    var res = roundResult;
    /* the round's lesson, not just its exit: three separate verdicts add
       up to one habit worth naming */
    hint.textContent = 'round done — ' + roundCoach(itemKinds) + ' press "new round" to go again.';
    updateControls();
    draw();
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    if (res) showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
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
  btnDone.addEventListener('click', onDone);
  btnUndo.addEventListener('click', onUndo);
  btnAgain.addEventListener('click', onAgain);
  btnClear.addEventListener('click', onClear);
  document.getElementById('btnRound').addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);

  /* Hardware swapped mid-session: tolerance and bridging are read at
     scoring time, so only the sheet needs repainting. */
  ArtDaily.onInput(function () { updateControls(); draw(); });

  /* The page going away takes both of this drill's timed moments with it,
     in opposite directions.

     setTimeout keeps firing while hidden, so a notification or an app
     switch during the 1.7s reveal used to advance to the next item behind
     the player's back — and that reveal is the only place the true edge is
     drawn over their trace, with the stretches they missed thickened on it.
     Park the beat; onDone() reports a finished round synchronously the
     moment item 3 is scored, so a parked beat only ever holds up an ITEM.

     requestAnimationFrame does the opposite: it STOPS while hidden, so a
     breath interrupted halfway resumed after the deadline had passed, went
     straight to silent, and left a player who never saw it with no idea
     which pocket of paper is the gap. Replay it — exactly what the free
     "show again" button does, and the identity guard in startPulse() kills
     the superseded loop. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (playing && revealing && revealTimer === null && !revealHeld) {
      revealTimer = setTimeout(nextItem, REVEAL_MS);
      return;
    }
    if (playing && !revealing && item && pulsing) startPulse();
  });

  /* On resize the sheet scales uniformly (H tracks W), so the whole
     composition — silhouettes, gap, truth samples and the player's
     strokes — can just be multiplied through. Rebuilding the item
     instead would throw away a trace in progress on every phone
     rotation, and scoring is scale-relative (chamfer / bounding
     diagonal) so a scaled trace scores exactly the same. */
  function scalePts(pts, f) {
    for (var i = 0; i < pts.length; i++) { pts[i].x *= f; pts[i].y *= f; }
  }

  function scaleShape(s, f) {
    s.x *= f; s.y *= f;
    if (s.r !== undefined) s.r *= f;
    if (s.w !== undefined) s.w *= f;
    if (s.h !== undefined) s.h *= f;
    if (s.ri !== undefined) s.ri *= f;
    if (s.ro !== undefined) s.ro *= f;
    /* a0/a1/rot are angles — invariant under a uniform scale */
  }

  window.addEventListener('resize', function () {
    var oldW = W;
    fitCanvas();
    if (Math.abs(W - oldW) < 4) { draw(); return; } /* mobile URL-bar jitter */
    var f = oldW > 0 ? W / oldW : 1;
    if (f !== 1 && item) {
      scalePts(item.poly, f);
      scalePts(item.truth, f);
      for (var i = 0; i < item.shapes.length; i++) scaleShape(item.shapes[i], f);
      item.g.x *= f; item.g.y *= f;
      item.D *= f;
      for (i = 0; i < strokes.length; i++) scalePts(strokes[i], f);
      scalePts(cur, f);
    }
    draw();
  });

  /* ---- boot ---- */
  /* Ratio decided once: a phone gets a taller sheet, and a later resize
     stays a pure rescale of everything already drawn. */
  try { ASPECT = canvas.getBoundingClientRect().width < 520 ? 0.78 : 0.62; } catch (e) { ASPECT = 0.62; }
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
