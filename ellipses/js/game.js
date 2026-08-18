/* ============================================================
   game.js — Ellipse Orbit. Five dashed boxes (the "plane" the
   drill teaches) per round, each with a target ellipse touching
   all four sides; trace it in one loop. Boxes ramp from
   near-circles to slim ones. The loop may be drawn in several
   presses — a trackpad's throw is a third of a desktop orbit, so
   lifting is hardware, not error; a press near the last lift
   carries the same loop on, and an unfinished loop is never
   scored. Tolerances are eased per input mode via ArtDaily.ease
   and floored in absolute pixels so a phone is not held to a
   finer standard than a desktop. After each attempt the truth is
   revealed the honest way: a real 3D circle (the box's major
   radius) tilts into view — rotation matrix + orthographic
   projection — until, at tilt = acos(minor / major), it IS the
   target ellipse. The reveal holds until you tap. Skeleton per
   the template: init → round → input → score → ArtDaily.report.
   One theme-aware canvas; no libraries.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'ellipses';
  var ITEMS_PER_ROUND = 5;
  var MIN_POINTS = 12;        /* fewer sampled points = accidental tap, no penalty */
  var RESAMPLE_STEP = 4;      /* px between resampled stroke points for scoring */
  var MAX_RESAMPLE = 4000;    /* hard ceiling; a real loop needs a few hundred */
  var REVEAL_ANIM_MS = 650;   /* the circle-tilt animation; the reveal then holds */

  /* One loop is one ATTEMPT, not necessarily one press. A full orbit of a
     desktop box is ~900px of travel; a trackpad's throw is about a third
     of that, so lifting to reposition is what the hardware requires, not
     a mistake. A press this close to where you lifted continues the same
     loop. Radius is eased per hardware — a screenless tablet cannot see
     its own hand, so it gets the widest window.
     There is deliberately NO deadline. There used to be four seconds of
     wall clock, and reading the drill's own "press near where you stopped
     and carry on" takes longer than that: the next press then wiped every
     arc already drawn, with no message, and the box became unfinishable
     for anyone who paused. Distance alone says "carry on" or "start over"
     — a press away from the ink still starts a fresh loop. */
  var RESUME_BASE_PX = 50;

  /* Coverage of the 24 angular buckets. Below SCORE_COV the loop simply
     is not finished: it is never scored, only resumed or restarted. The
     old 0.3 floor scored everything above it with coverage as a straight
     multiplier, which billed "I ran out of trackpad" as "you drew badly". */
  var SCORE_COV = 0.75;
  var FULL_COV = 0.9;

  /* Fit tolerance. The error at which the fit score reaches zero is
     FIT_ZERO_FRAC of the box's mean radius, but never less than
     FIT_ZERO_FLOOR px — without that floor a phone's small canvas
     demanded finer accuracy than a desktop for the very same drill.
     The first FIT_FREE of the tolerance is free, so a clean loop can
     actually reach 100 instead of needing literal zero error. */
  var FIT_ZERO_FRAC = 0.18;
  var FIT_ZERO_FLOOR = 14;
  var FIT_FREE = 0.09;

  /* A pen always outranks a finger: on a tablet the finger that arrives
     first is the palm, and the nib lands a moment later. */
  var PEN_LOCK_MS = 700;

  /* ============================================================
     Pure scoring — geometry in, 0–100 out. No canvas, no DOM.
     Points are {x,y}; an ellipse is {cx,cy,rx,ry}, axis-aligned.
     An attempt is RUNS: an array of point arrays, one per press, so a
     loop drawn in two passes is judged as the one loop it is.
     ============================================================ */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Even arc-length resampling of a polyline (~step px apart) so a
     fast sparse sweep and a slow dense trace are judged on the same
     geometry. Keeps the first and last points.
     The two guards are not decoration: a non-finite segment makes the
     step ratio 0, so the walk never advances and the loop never ends,
     and a wild coordinate would otherwise emit millions of samples. A
     stroke that hits either is nonsense anyway — bail and let the
     caller's zero stand, but never hang the tab doing it. */
  function resample(points, step) {
    if (!points || points.length < 2) return points ? points.slice() : [];
    var out = [{ x: points[0].x, y: points[0].y }];
    var carry = 0, i, ax, ay, bx, by, seg, t;
    for (i = 1; i < points.length; i++) {
      ax = points[i - 1].x; ay = points[i - 1].y;
      bx = points[i].x; by = points[i].y;
      seg = Math.hypot(bx - ax, by - ay);
      if (!(seg > 0) || !isFinite(seg)) continue;
      while (carry + seg >= step && out.length < MAX_RESAMPLE) {
        t = (step - carry) / seg;
        ax = ax + (bx - ax) * t;
        ay = ay + (by - ay) * t;
        out.push({ x: ax, y: ay });
        seg = Math.hypot(bx - ax, by - ay);
        carry = 0;
      }
      carry += seg;
    }
    out.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
    return out;
  }

  /* Every run resampled and concatenated. Resampling per run (never
     across the lift) means the gap between two presses contributes no
     phantom samples — the score sees only ink the player actually made. */
  function resampleRuns(runs, step) {
    var out = [], i, k, r;
    if (!runs) return out;
    for (i = 0; i < runs.length; i++) {
      if (!runs[i] || runs[i].length < 2) continue;
      r = resample(runs[i], step);
      for (k = 0; k < r.length; k++) out.push(r[k]);
    }
    return out;
  }

  function flatten(runs) {
    var out = [], i, k;
    if (!runs) return out;
    for (i = 0; i < runs.length; i++) {
      for (k = 0; k < runs[i].length; k++) out.push(runs[i][k]);
    }
    return out;
  }

  /* Dense polyline of the true ellipse, for point-to-curve distance. */
  function ellipseOutline(ell, n) {
    var pts = [], i, a;
    for (i = 0; i < n; i++) {
      a = (i / n) * 2 * Math.PI;
      pts.push({ x: ell.cx + ell.rx * Math.cos(a), y: ell.cy + ell.ry * Math.sin(a) });
    }
    return pts;
  }

  /* Min distance from p to a closed polyline (point-to-segment). */
  function distToClosedPolyline(p, poly) {
    var best = Infinity, i, j, ax, ay, abx, aby, len2, t, dx, dy, d;
    for (i = 0; i < poly.length; i++) {
      j = (i + 1) % poly.length;
      ax = poly[i].x; ay = poly[i].y;
      abx = poly[j].x - ax; aby = poly[j].y - ay;
      len2 = abx * abx + aby * aby;
      t = len2 === 0 ? 0 : clamp(((p.x - ax) * abx + (p.y - ay) * aby) / len2, 0, 1);
      dx = p.x - (ax + abx * t);
      dy = p.y - (ay + aby * t);
      d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /* Mean true point-to-curve distance, in PIXELS. Keeping it absolute is
     the point: the tolerance it is compared against carries both the
     size term and a pixel floor, so a phone is not silently held to a
     finer standard than a desktop for the same drill. */
  function meanCurveErrorPx(points, ell) {
    var outline = ellipseOutline(ell, 96);
    var sum = 0, i;
    for (i = 0; i < points.length; i++) sum += distToClosedPolyline(points[i], outline);
    return sum / points.length;
  }

  /* Pixels of mean error at which the fit score reaches zero: a share of
     the box's mean radius, never under FIT_ZERO_FLOOR px, then eased for
     the hardware in hand (pen 1x, finger 1.5x, mouse/trackpad 2x — a
     mouse pivots at the wrist and cannot creep along a curve). */
  function fitZeroPx(ell, easeMul) {
    var size = (ell.rx + ell.ry) / 2;
    var m = typeof easeMul === 'number' && easeMul > 0 ? easeMul : 1;
    return Math.max(FIT_ZERO_FRAC * size, FIT_ZERO_FLOOR) * m;
  }

  /* 100 while the loop sits within the free band, 0 at the tolerance. */
  function fitScore(meanErrPx, zeroPx) {
    if (!(zeroPx > 0) || !isFinite(meanErrPx)) return 0;
    var free = zeroPx * FIT_FREE;
    return 100 * clamp(1 - Math.max(0, meanErrPx - free) / (zeroPx - free), 0, 1);
  }

  /* Fraction of 24 equal angular buckets holding at least one point.
     Feed it resampled points — raw fast-sweep samples are sparse. */
  function angularCoverage(points, ell) {
    var BUCKETS = 24;
    var hit = [], count = 0, i, a, b;
    for (i = 0; i < BUCKETS; i++) hit.push(false);
    for (i = 0; i < points.length; i++) {
      a = Math.atan2((points[i].y - ell.cy) / ell.ry, (points[i].x - ell.cx) / ell.rx);
      b = Math.floor((a + Math.PI) / (2 * Math.PI) * BUCKETS);
      if (b >= BUCKETS) b = BUCKETS - 1;
      if (b < 0) b = 0;
      if (!hit[b]) { hit[b] = true; count += 1; }
    }
    return count / BUCKETS;
  }

  /* Ink actually laid down, gaps between presses excluded. Lets the copy
     tell "you ran out of room" apart from "you looped somewhere else":
     both leave coverage low, and only the first is the hardware's fault. */
  function inkLength(runs) {
    var total = 0, i, k, d;
    if (!runs) return 0;
    for (i = 0; i < runs.length; i++) {
      for (k = 1; k < runs[i].length; k++) {
        d = Math.hypot(runs[i][k].x - runs[i][k - 1].x, runs[i][k].y - runs[i][k - 1].y);
        if (isFinite(d)) total += d;
      }
    }
    return total;
  }

  /* Ramanujan's approximation — plenty for a closure threshold. */
  function ellipsePerimeter(rx, ry) {
    var h = Math.pow((rx - ry) / (rx + ry), 2);
    return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  }

  /* An endpoint gap past 12% of the perimeter costs up to 10 points,
     scaling linearly to the full penalty at a 24% gap. */
  function closurePenalty(first, last, perimeter) {
    var gap = Math.hypot(last.x - first.x, last.y - first.y);
    return 10 * clamp((gap / perimeter - 0.12) / 0.12, 0, 1);
  }

  /* Full breakdown so the UI can say WHY a score dropped. Takes runs and
     the hardware's easing multiplier; both stay parameters so the whole
     scorer runs headless. */
  function attemptBreakdown(runs, ell, easeMul) {
    var rs = resampleRuns(runs, RESAMPLE_STEP);
    var flat = flatten(runs);
    /* Guard degenerate input so the pure math never NaNs or throws:
       no real stroke, or a collapsed box, is simply a zero. */
    if (rs.length < 2 || !ell || !(ell.rx > 0) || !(ell.ry > 0)) {
      return { score: 0, fit: 0, cov: 0, closure: 0 };
    }
    var fit = fitScore(meanCurveErrorPx(rs, ell), fitZeroPx(ell, easeMul));
    var cov = angularCoverage(rs, ell);
    var s = fit;
    if (cov < FULL_COV) s *= cov;
    var cp = closurePenalty(flat[0], flat[flat.length - 1],
      ellipsePerimeter(ell.rx, ell.ry));
    s -= cp;
    s = clamp(s, 0, 100);
    return { score: isFinite(s) ? s : 0, fit: fit, cov: cov, closure: cp };
  }

  /* The stroke sample furthest from the true curve — the reveal
     marks it so the delta is diagnosable, not just visible.
     Returns a COPY of the sample: the caller stores it beside the
     stroke and a resize rescales both, so an alias would take the
     scale twice and drift off the point it is meant to mark. */
  function worstDeviation(points, ell) {
    if (!points || points.length === 0) return null;
    var outline = ellipseOutline(ell, 96);
    var best = -1, idx = 0, i, d;
    for (i = 0; i < points.length; i++) {
      d = distToClosedPolyline(points[i], outline);
      if (d > best) { best = d; idx = i; }
    }
    return { p: { x: points[idx].x, y: points[idx].y }, d: best };
  }

  /* Mean SIGNED radial error, as a share of the box: > 0 means the loop
     ran outside the dashed box, < 0 means it stayed inside it. Normalised
     by the box's own radii, so a slim plane and a round one report the
     same "6% wide" for the same visible miss. Exact for a circle and
     monotone for any ellipse — it is a word-chooser, not a score. */
  function radialBias(points, ell) {
    if (!points || !points.length || !ell || !(ell.rx > 0) || !(ell.ry > 0)) return 0;
    var sum = 0, n = 0, i, dx, dy, rho;
    for (i = 0; i < points.length; i++) {
      dx = (points[i].x - ell.cx) / ell.rx;
      dy = (points[i].y - ell.cy) / ell.ry;
      rho = Math.hypot(dx, dy);
      if (isFinite(rho)) { sum += rho - 1; n += 1; }
    }
    return n ? sum / n : 0;
  }

  /* The delta in plain words. The tilting circle already shows what right
     looks like; this says what YOURS did differently, worst thing first —
     an unclosed loop and a loop that ballooned are different mistakes with
     different fixes, and "62" says neither. */
  function loopWords(br, bias) {
    /* Gate on there being ink to describe, NOT on the score: a loop 25%
       wide of the box scores a flat 0, and 0 is precisely the attempt
       whose player most needs to be told what it did. */
    if (!br) return '';
    if (!(br.cov > 0)) return 'nothing readable to grade';
    if (br.cov < FULL_COV) return 'you left a gap in the loop';
    if (br.closure > 0.5) return 'the two ends of your loop missed each other';
    if (bias > 0.06) return 'your loop ran about ' + Math.round(bias * 100) + '% wide of the box';
    if (bias < -0.06) return 'your loop stayed about ' + Math.round(-bias * 100) + '% inside the box';
    if (br.fit >= 85) return 'you held the box line the whole way round';
    return 'your loop wandered off the box line and back';
  }

  /* Every ellipse is a circle seen at an angle: tilt = acos(minor/major). */
  function circleTilt(rx, ry) {
    var major = Math.max(rx, ry), minor = Math.min(rx, ry);
    return major === 0 ? 0 : Math.acos(clamp(minor / major, 0, 1));
  }

  /* A real 3D circle of radius = the plane's major radius, rotated by
     theta about the ellipse's major axis (rotation matrix applied to
     real 3D points), then orthographically projected by dropping the
     depth coordinate. At theta = circleTilt(rx, ry) the projection IS
     the target ellipse — the reveal animates theta from 0 so the
     foreshortening itself becomes the lesson. Returns n+1 points
     (closed loop). */
  function tiltedCirclePoints(ell, theta, n) {
    var major = Math.max(ell.rx, ell.ry);
    var tall = ell.ry > ell.rx; /* tall plane: the major axis is vertical */
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    var pts = [], i, phi, x3, y3, z3, px, py;
    for (i = 0; i <= n; i++) {
      phi = (i / n) * 2 * Math.PI;
      /* the circle in its own 3D plane (z = 0) */
      x3 = major * Math.cos(phi);
      y3 = major * Math.sin(phi);
      z3 = 0;
      if (tall) {
        /* rotate about the vertical (y) axis: [x', y', z'] =
           [x·cosT + z·sinT, y, −x·sinT + z·cosT] */
        px = x3 * cosT + z3 * sinT;
        py = y3;
      } else {
        /* rotate about the horizontal (x) axis: [x', y', z'] =
           [x, y·cosT − z·sinT, y·sinT + z·cosT] */
        px = x3;
        py = y3 * cosT - z3 * sinT;
      }
      pts.push({ x: ell.cx + px, y: ell.cy + py });
    }
    return pts;
  }

  /* ============================================================
     Canvas / DOM — everything below here touches the page.
     ============================================================ */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ----
     accentInk is the AA-contrast variant of the accent, used for every
     meaning-bearing mark (tangent ticks, the true ellipse, the score).
     See the note above --game-accent-ink in css/style.css. */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim();
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: accent,
      accentInk: cs.getPropertyValue('--game-accent-ink').trim() || accent,
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.round(W * 0.62);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], ell = null, playing = false;
  var runs = [], drawing = false, revealing = false;
  var lift = null;       /* {x,y,at} — where the last press let go, for resuming */
  var flash = null;      /* {score,label,tilt,worst} painted during the reveal */
  var revealAnim = null; /* {start,dur,tilt,theta} for the circle-tilt reveal */
  var rafId = null;
  var beginnerRamp = true; /* refreshed per round from the personal best */
  var lastWords = '';    /* the last scored box, in words, for the round-done line */

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* The box's aspect (its "degree") ramps within the round: near-circles
     first, slim ones by box five. Always fully on canvas.
     Two floors keep it honest across hardware: the minor axis never
     drops below a fingertip-sized minorFloor, and a player with no
     personal best yet gets a gentler ramp — the slimmest boxes are a
     real intermediate skill, not a way to end someone's first round. */
  function makeItem(idx) {
    var t = idx / (ITEMS_PER_ROUND - 1);
    var thinLo = beginnerRamp ? 0.40 : 0.15;
    var thinHi = beginnerRamp ? 0.62 : 0.40;
    var aspect = rand(lerp(0.70, thinLo, t), lerp(1.0, thinHi, t));
    var margin = 14;
    var minorFloor = Math.max(16, H * 0.05);
    var maxR = Math.min(H * 0.44, H / 2 - margin);
    /* box one is the first win of the round: comfortably big and round */
    var major = idx === 0 ? rand(maxR * 0.78, maxR) : rand(maxR * 0.68, maxR);
    var minor = Math.max(major * aspect, Math.min(minorFloor, major));
    var rx = major, ry = minor;
    if (Math.random() < 0.5) { rx = minor; ry = major; } /* upright box */
    /* Placed with room for the REVEAL, not just for the box. The reveal
       starts as the un-tilted circle — radius `major` along BOTH axes —
       and only narrows into the target ellipse as theta grows. Leaving
       only rx of clearance meant the opening frames of the drill's own
       lesson were painted off the side of the sheet and clipped away, by
       up to 90px on an 800px canvas. It failed worst exactly where the
       lesson matters most: the slimmest boxes, whose major radius is
       several times their minor one. */
    var pad = margin + major;
    return {
      cx: (W - pad > pad) ? rand(pad, W - pad) : W / 2,
      cy: (H - pad > pad) ? rand(pad, H - pad) : H / 2,
      rx: rx,
      ry: ry,
    };
  }

  /* Copy shared by the first press of every box. Box one names the word
     the drill exists to teach instead of assuming it. */
  function promptFor(idx) {
    var base = 'Box ' + (idx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — one loop that fills the dashed box, touching all four sides.';
    if (idx === 0) base += ' (Artists call that box the plane.)';
    return base;
  }

  function newRound() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    revealing = false;
    revealAnim = null;
    drawing = false;
    activePointer = null;
    activeType = '';
    flash = null;
    runs = [];
    lift = null;
    lastWords = '';
    round += 1;
    itemIdx = 0;
    itemScores = [];
    playing = true;
    beginnerRamp = ArtDaily.best() === null;
    ell = makeItem(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hint.textContent = promptFor(0);
    draw();
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function strokePath(pts, style, width) {
    var i;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function draw() {
    var c = inks();
    var cross = 7;
    var r;
    ctx.clearRect(0, 0, W, H);
    if (!ell) return;

    /* The plane: bounding rect + centre cross. Dashed and thin so it reads
       as construction, but at full alpha — it is the target the whole drill
       is about, and at 0.55 it blended to 2.2:1 on paper, under the 3:1 AA
       floor for meaningful graphics. */
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(ell.cx - ell.rx, ell.cy - ell.ry, ell.rx * 2, ell.ry * 2);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ell.cx - cross, ell.cy);
    ctx.lineTo(ell.cx + cross, ell.cy);
    ctx.moveTo(ell.cx, ell.cy - cross);
    ctx.lineTo(ell.cx, ell.cy + cross);
    ctx.stroke();
    ctx.restore();

    /* tangent ticks: the ellipse kisses the box at these midpoints */
    ctx.save();
    ctx.strokeStyle = c.accentInk;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ell.cx - 5, ell.cy - ell.ry); ctx.lineTo(ell.cx + 5, ell.cy - ell.ry);
    ctx.moveTo(ell.cx - 5, ell.cy + ell.ry); ctx.lineTo(ell.cx + 5, ell.cy + ell.ry);
    ctx.moveTo(ell.cx - ell.rx, ell.cy - 5); ctx.lineTo(ell.cx - ell.rx, ell.cy + 5);
    ctx.moveTo(ell.cx + ell.rx, ell.cy - 5); ctx.lineTo(ell.cx + ell.rx, ell.cy + 5);
    ctx.stroke();
    ctx.restore();

    /* each press is its own subpath — a lift leaves a gap in the ink, not
       a straight line the player never drew */
    for (r = 0; r < runs.length; r++) {
      if (runs[r].length > 1) strokePath(runs[r], c.ink, 2.5);
    }

    /* reveal: a real 3D circle tilts into the target ellipse over the
       attempt, then holds + score flash */
    if (revealing) {
      var theta = revealAnim ? revealAnim.theta : circleTilt(ell.rx, ell.ry);
      strokePath(tiltedCirclePoints(ell, theta, 72), c.accentInk, 2.5);
      if (flash) {
        if (flash.worst && flash.worst.d >= 3) {
          /* ring where the stroke strayed furthest from the curve */
          ctx.save();
          ctx.strokeStyle = c.muted;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(flash.worst.p.x, flash.worst.p.y, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        var sy = clamp(ell.cy - 20, 26, H - 44);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = c.accentInk;
        ctx.font = '900 28px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText(String(flash.score), ell.cx, sy);
        ctx.fillStyle = c.muted;
        ctx.font = '700 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText(flash.label, ell.cx, sy + 34);
      }
    }
  }

  /* ---- input: one loop per box, in as many presses as the hardware needs ---- */
  /* Split in two so a run of coalesced samples can share ONE canvas
     measurement: getBoundingClientRect() forces a layout flush, and a fast
     sweep hands over dozens of samples per frame — all of them describing a
     canvas that cannot have moved between them — in the same handler that
     repaints. Measured here: 16 layout reads per pointermove instead of 1.
     (This is the hazard ArtDaily.samples() is documented against.) */
  function posIn(ev, rect) {
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
  function pointerPos(ev) {
    return posIn(ev, canvas.getBoundingClientRect());
  }

  var activePointer = null; /* one press = one pointer; second fingers are ignored */
  var activeType = '';
  var lastPenAt = -Infinity;

  function now() { return Date.now(); }

  /* The press that owns the loop in progress is provably no longer down.

     A pointer is `primary` only while it is the FIRST ACTIVE pointer of its
     type, so a new primary of the SAME type proves the stored one has ended —
     while a genuine second finger arriving during a live press is never
     primary, and is still ignored by the guard in pointerdown.

     This is the only recovery a FINGER has. The same-id branch there exists
     for a release lost outside the document (press, drag out of the embed
     frame, let go over the page), and it works for a mouse or a pen because
     those keep one pointerId for the whole session. Every touch gets a FRESH
     id, so that branch can never fire for one — and no pointerup,
     pointercancel or lostpointercapture will ever arrive for a finger that is
     already gone. Measured: one lost touch release left `drawing` true against
     an id nothing could match again, every later press was swallowed, and the
     box was dead until "new round" — which throws the whole round away. */
  function ownerGone(ev) {
    return ev.isPrimary === true && ev.pointerType === activeType;
  }

  /* True when this press lands close enough to the last lift to be the
     same loop carried on. */
  function isResume(p) {
    if (!lift || !runs.length) return false;
    return Math.hypot(p.x - lift.x, p.y - lift.y) <= ArtDaily.startRadius(RESUME_BASE_PX);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (!playing) return;
    ev.preventDefault();
    if (revealing) { advanceItem(); return; } /* tap-to-continue */

    /* Palm rejection. A pen outranks a finger both ways: a touch inside
       the pen's shadow is the hand resting on the glass, and a nib that
       lands while a touch owns the stroke takes it over, throwing away
       the palm drift that was being recorded as the drawing. */
    if (ev.pointerType === 'pen') lastPenAt = now();
    else if (ev.pointerType === 'touch' && now() - lastPenAt < PEN_LOCK_MS) return;
    if (drawing) {
      /* Two ways this press may proceed instead of being ignored. The pen
         outranking a palm is the second; the FIRST is this very pointer
         arriving down twice with no release in between, which the
         pointer-events spec says cannot happen — so its release was lost
         (press, drag out of the embed frame, let go over the page). The old
         press is over. Without this the `return` swallowed the new press while
         pointermove — which only checks `drawing` and the id, both still
         matching — kept appending its samples to the ABANDONED press, welding
         two separate arcs into one run and grading the loop on ink the player
         had walked away from. runs.pop() drops only that press; every earlier
         press of the same loop stays. */
      if (ev.pointerId !== activePointer &&
          (ev.pointerType !== 'pen' || activeType === 'pen') &&
          /* …and the THIRD: a finger's release was lost, so the id is new but
             the press it belonged to is provably over — see ownerGone() */
          !ownerGone(ev)) return;
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
      runs.pop();
    }

    var p = pointerPos(ev);
    if (!isResume(p)) { runs = []; lift = null; }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    activePointer = ev.pointerId;
    activeType = ev.pointerType || 'mouse';
    drawing = true;
    runs.push([p]);
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    /* coalesced events: full-fidelity sampling of fast sweeps. The canvas is
       measured ONCE for the whole run — see posIn(). */
    var rect = canvas.getBoundingClientRect();
    var evs = ArtDaily.samples(ev);
    var run = runs[runs.length - 1];
    var pushed = false, i, p, last;
    for (i = 0; i < evs.length; i++) {
      p = posIn(evs[i], rect);
      last = run[run.length - 1];
      /* skip sub-2px jitter so a long-press never reads as a stroke */
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) {
        run.push(p);
        pushed = true;
      }
    }
    if (pushed) draw();
  });

  function endStroke(ev) {
    if (!drawing || ev.pointerId !== activePointer) return;
    if (ev.cancelable) ev.preventDefault();
    drawing = false;
    activePointer = null;
    activeType = '';
    var run = runs[runs.length - 1];
    /* Only a real release carries a position worth keeping: a
       lostpointercapture is the lift, but its coordinates are whatever the
       system had when it took the capture away, and appending those would
       hook a phantom segment onto the loop. */
    if (ev.type === 'pointerup') {
      var p = pointerPos(ev);
      var last = run[run.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) run.push(p);
    }
    lift = { x: run[run.length - 1].x, y: run[run.length - 1].y, at: now() };

    if (flatten(runs).length < MIN_POINTS) {
      runs = [];
      lift = null;
      hint.textContent = 'Too short — one full loop around box ' + (itemIdx + 1) +
        ' of ' + ITEMS_PER_ROUND + '. No penalty.';
      draw();
      return;
    }
    /* An unfinished loop is never scored. Running out of room is a fact
       about trackpads, not about the drawing — and either way the copy
       names what actually happened instead of grading a half loop. */
    var cov = angularCoverage(resampleRuns(runs, RESAMPLE_STEP), ell);
    if (cov < SCORE_COV) {
      var pct = Math.round(cov * 100);
      if (inkLength(runs) > 0.75 * ellipsePerimeter(ell.rx, ell.ry)) {
        hint.textContent = 'Plenty of ink, but only ' + pct +
          '% of the way around the box — the loop has to travel all the way round it. Press near where you stopped to carry on. No penalty.';
      } else {
        hint.textContent = 'You lifted at ' + pct +
          '% of the loop — press near where you stopped and carry on. No penalty.';
      }
      draw();
      return;
    }
    finishItem();
  }
  canvas.addEventListener('pointerup', endStroke);
  /* fallback if pointer capture failed and the release lands off-canvas —
     without it a completed loop lifted outside the box is swallowed and
     `drawing` stays true, wedging the box. The guard above makes the
     duplicate call from the canvas→window bubble a no-op. */
  window.addEventListener('pointerup', endStroke);
  /* iOS drops capture without a pointerup — treat it as the lift it is.
     Without this `drawing` and activePointer stay set for good, and since
     every later finger gets a NEW pointerId, no press or release ever
     matches the guards again: the box is dead until "new round". */
  canvas.addEventListener('lostpointercapture', endStroke);

  /* An interrupted press (system gesture, palm takeover) drops only the
     press, not the loop: whatever was already drawn stays resumable. */
  function cancelStroke(ev) {
    if (!drawing || ev.pointerId !== activePointer) return;
    activePointer = null;
    activeType = '';
    drawing = false;
    var run = runs[runs.length - 1];
    if (run && run.length > 1) {
      lift = { x: run[run.length - 1].x, y: run[run.length - 1].y, at: now() };
    } else {
      runs.pop();
    }
    draw();
  }
  canvas.addEventListener('pointercancel', cancelStroke);
  window.addEventListener('pointercancel', cancelStroke);

  /* ---- scoring flow ---- */
  function flashLabel(br) {
    if (br.cov < FULL_COV) return 'gap left in the loop';
    if (br.closure > 0.5) return 'loop left open';
    if (br.score >= 90) return 'dead on';
    if (br.score >= 75) return 'clean sweep';
    if (br.score >= 55) return 'decent arc';
    if (br.score >= 40) return 'a bit wobbly';
    return 'keep sweeping';
  }

  /* The tilt is the lesson, not decoration — under prefers-reduced-motion
     we skip straight to the finished tilt (draw() derives theta from the
     ellipse when revealAnim is null) rather than dropping the reveal. */
  function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function startRevealAnim(tilt) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (prefersReducedMotion()) { revealAnim = null; return; }
    revealAnim = { start: null, dur: REVEAL_ANIM_MS, tilt: tilt, theta: 0 };
    rafId = requestAnimationFrame(stepRevealAnim);
  }

  function stepRevealAnim(ts) {
    rafId = null;
    if (!revealing || !revealAnim) return;
    if (revealAnim.start === null) revealAnim.start = ts;
    var t = Math.min(1, (ts - revealAnim.start) / revealAnim.dur);
    var e = 1 - Math.pow(1 - t, 3); /* ease-out */
    revealAnim.theta = revealAnim.tilt * e;
    if (t >= 1) {
      /* done: draw() now derives theta from the ellipse itself, so a
         held reveal stays exact even if the canvas rescales */
      revealAnim = null;
    }
    draw();
    if (t < 1) rafId = requestAnimationFrame(stepRevealAnim);
  }

  function finishItem() {
    var br = attemptBreakdown(runs, ell, ArtDaily.ease(1));
    /* the SAME points attemptBreakdown grades: evenly spaced by arc length.
       radialBias over the raw samples instead weights by how long the hand
       lingered, so a loop that crawled through one wide patch and swept the
       rest could be told "ran 9% wide of the box" about a stretch the score
       barely counted — the sentence and the number reading different loops. */
    var rs = resampleRuns(runs, RESAMPLE_STEP);
    itemScores.push(br.score);
    var tilt = circleTilt(ell.rx, ell.ry);
    var deg = Math.round(tilt * 180 / Math.PI);
    flash = {
      score: Math.round(br.score),
      label: flashLabel(br),
      worst: worstDeviation(flatten(runs), ell),
    };
    revealing = true;
    startRevealAnim(tilt);
    /* the score and the reason for it, in words. The hint line used to
       carry the geometry lesson and nothing about the attempt at all —
       the number lived on the canvas, and why it was that number lived
       nowhere. */
    lastWords = 'box ' + (itemIdx + 1) + ': ' + Math.round(br.score) + ' — ' +
      loopWords(br, radialBias(rs, ell)) + '.';
    if (itemIdx === ITEMS_PER_ROUND - 1) {
      finishRound(deg);
    } else {
      /* only name the ring when one is actually painted — draw() skips it
         under 3px, and a legend for a mark that is not on the sheet sends
         the player hunting for it */
      hint.textContent = lastWords +
        (itemIdx === 0 && flash.worst && flash.worst.d >= 3 ? ' The ring marks your widest miss.' : '') +
        ' This box is a circle tilted ' + deg + '° — artists call that its degree. Tap to continue.';
    }
    draw();
  }

  function advanceItem() {
    if (!revealing) return;
    revealing = false;
    revealAnim = null;
    flash = null;
    runs = [];
    lift = null;
    itemIdx += 1;
    ell = makeItem(itemIdx);
    hint.textContent = promptFor(itemIdx);
    draw();
  }

  function finishRound(deg) {
    /* the final reveal stays on canvas to study — no blanking */
    var sum = 0, i;
    playing = false;
    for (i = 0; i < itemScores.length; i++) sum += itemScores[i];
    var res = ArtDaily.report(sum / itemScores.length);
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'Round done — ' + (lastWords ? lastWords + ' ' : '') +
      'The last box stays up (a circle tilted ' + deg +
      '°, its degree). Press “new round” to go again.';
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
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

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  window.addEventListener('resize', function () {
    var oldW = W, oldH = H;
    fitCanvas();
    /* height-only viewport changes (mobile URL bar) leave the canvas
       box untouched — repaint and move on, never replan the plane */
    if (W === oldW && H === oldH) { draw(); return; }
    if (oldW > 0 && oldH > 0) {
      /* geometry is in CSS pixels — scale everything to the new box
         (mirrors symmetry's handler) so nothing is wiped or swapped */
      var sx = W / oldW, sy = H / oldH, i, k;
      if (ell) {
        ell.cx *= sx; ell.cy *= sy;
        ell.rx *= sx; ell.ry *= sy;
      }
      for (i = 0; i < runs.length; i++) {
        for (k = 0; k < runs[i].length; k++) {
          runs[i][k].x *= sx;
          runs[i][k].y *= sy;
        }
      }
      if (lift) { lift.x *= sx; lift.y *= sy; }
      if (flash && flash.worst) {
        flash.worst.p.x *= sx;
        flash.worst.p.y *= sy;
      }
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
