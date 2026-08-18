/* ============================================================
   game.js — Steady Tunnel: steer one stroke down a winding
   corridor that narrows as you go. Three tunnels per round, each
   tighter and curvier. The corridor is a Catmull-Rom path with
   walls offset perpendicular at a linearly shrinking half-width
   — procedural, so the middle of the tunnel is exact ground
   truth. Scoring is pure projection geometry (inside fraction,
   centering, coverage); the pure functions sit at the top so
   they are unit-testable without a canvas. While you draw, ink
   that crosses a wall flashes coral immediately — the wall
   itself is the teacher, not the score.

   Fairness across hardware, which this drill used to get badly
   wrong: the half-widths were absolute pixels, so a phone got
   the same 16px slot as a desktop, and the run had to be one
   unbroken drag longer than a trackpad can physically deliver.
   Now the corridor is a fraction of the canvas with a pixel
   floor, widened per input mode through ArtDaily.ease, the
   traverse is capped to a trackpad's throw, the entry ring
   SNAPS rather than refusing a near miss, and a lift is not an
   ending — press near where you stopped and the same run
   continues. An unfinished run is never scored.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'steady-tunnel';
  var TUNNELS_PER_ROUND = 3;
  var PATH_SAMPLES = 300;  /* precomputed path samples for projection */
  var MIN_SAMPLES = 12;    /* fewer stroke points = accidental tap */
  var REVEAL_MS = 1300;
  var GEN_ATTEMPTS = 30;

  /* Difficulty ramps within the round: entry/exit half-widths shrink
     and the path gets more control points and a bigger wiggle.
     w0/w1 are FRACTIONS OF CANVAS HEIGHT, not pixels — the old fixed
     pixels made the same corridor a comfortable lane on a desktop and
     a 4mm slot on a phone. Tunnel one is deliberately wide and lazy:
     it is the round's first win, and a beginner needs one. */
  var TUNNEL_SPECS = [
    { pts: 4, amp: 0.11, w0: 0.085, w1: 0.055 },
    { pts: 6, amp: 0.22, w0: 0.055, w1: 0.028 },
    { pts: 7, amp: 0.30, w0: 0.047, w1: 0.019 }
  ];

  /* No corridor is ever thinner than this many pixels before easing —
     the floor under the relative width, so a small canvas cannot end up
     stricter than a large one. */
  var MIN_HW_PX = 12;

  /* The traverse is capped so one run fits a trackpad's physical throw
     even at the slow speed precision needs. */
  var MAX_SPAN_PX = 460;

  /* A run may be several presses. Press this close to where you lifted and
     it is the same run carrying on.
     No deadline: there used to be four seconds of wall clock, after which
     pressing near your ink — the exact thing the hint had just asked for —
     was refused, and the refusal repeated the same instruction. Looking at
     your own line for five seconds is what this drill is FOR. Distance
     alone separates "carry on" from "start over": the coral ring is still
     there, and pressing it still restarts the tunnel. */
  var RESUME_BASE_PX = 45;

  /* Press within SNAP_MULT x the entry ring and the run starts anyway,
     pulled onto the entry — a screenless tablet cannot see its own hand,
     and a refusal there reads as "this site is broken". The pull fades
     out over SNAP_DECAY_PX of travel so the ink ends up under the
     pointer rather than permanently offset from it. */
  var SNAP_MULT = 3;
  var SNAP_DECAY_PX = 90;

  /* Reaching this share of the tunnel counts as arriving. Short of it,
     the run is unfinished: resumable, never scored. */
  var FULL_COV = 0.9;

  /* Weights. Staying between the walls is the drill; centring is the
     refinement. At the old 0.55/0.45 a player who never touched a wall
     was told 77 and could not see why. */
  var W_INSIDE = 0.75;
  var W_CENTER = 0.25;

  /* A pen outranks a finger: on a tablet the touch that lands first is
     the palm, and the nib arrives a moment later. */
  var PEN_LOCK_MS = 700;

  /* ============================================================
     Pure geometry + scoring — data in, numbers out. No canvas,
     no DOM, no randomness: everything here is unit-testable.
     ============================================================ */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* The corridor half-width in pixels: a share of the canvas, floored in
     absolute pixels, then eased for the hardware in hand (pen 1x, finger
     1.5x, mouse/trackpad 2x). This one function is where the drill stops
     asking a phone for precision it never asked a desktop for. */
  function halfWidth(frac, height, easeMul) {
    var m = isFinite(easeMul) && easeMul > 0 ? easeMul : 1;
    var h = isFinite(height) && height > 0 ? height : 0;
    var f = isFinite(frac) && frac > 0 ? frac : 0;
    return Math.max(f * h, MIN_HW_PX) * m;
  }

  /* Catmull-Rom interpolation across p0..p3 at t in [0,1]. */
  function catmullPoint(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3)
    };
  }

  /* Dense polyline through the control points (endpoints doubled). */
  function catmullSample(ctrl, perSeg) {
    var ext = [ctrl[0]].concat(ctrl, [ctrl[ctrl.length - 1]]);
    var pts = [], i, k;
    for (i = 0; i + 3 < ext.length; i++) {
      for (k = 0; k < perSeg; k++) {
        pts.push(catmullPoint(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], k / perSeg));
      }
    }
    pts.push({ x: ctrl[ctrl.length - 1].x, y: ctrl[ctrl.length - 1].y });
    return pts;
  }

  function orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function segsIntersect(p1, p2, p3, p4) {
    var d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
    var d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /* True if the polyline crosses itself, or doubles back so close to
     an earlier stretch (by arc distance) that the corridor would
     overlap. Checked on a coarse copy for speed. */
  function pathIsTangled(pts, minGap) {
    var step = Math.max(1, Math.floor(pts.length / 90));
    var coarse = [], arc = [0], i, j, d;
    for (i = 0; i < pts.length; i += step) coarse.push(pts[i]);
    for (i = 1; i < coarse.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(coarse[i].x - coarse[i - 1].x, coarse[i].y - coarse[i - 1].y));
    }
    for (i = 0; i + 1 < coarse.length; i++) {
      for (j = i + 2; j + 1 < coarse.length; j++) {
        if (segsIntersect(coarse[i], coarse[i + 1], coarse[j], coarse[j + 1])) return true;
        if (arc[j] - arc[i] > minGap * 2.5) {
          d = Math.hypot(coarse[j].x - coarse[i].x, coarse[j].y - coarse[i].y);
          if (d < minGap) return true;
        }
      }
    }
    return false;
  }

  /* Resample a polyline to n points evenly spaced by arc length; each
     sample carries its normalized arc position s in [0,1]. */
  function resampleByArc(pts, n) {
    var arc = [0], i, total, out = [], target, seg = 1, t, a, b, span;
    if (!pts || !pts.length) return out;
    if (pts.length === 1) {
      for (i = 0; i < n; i++) out.push({ x: pts[0].x, y: pts[0].y, s: i / (n - 1) });
      return out;
    }
    for (i = 1; i < pts.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    total = arc[arc.length - 1] || 1;
    for (i = 0; i < n; i++) {
      target = total * i / (n - 1);
      while (seg < pts.length - 1 && arc[seg] < target) seg++;
      a = pts[seg - 1]; b = pts[seg];
      span = arc[seg] - arc[seg - 1];
      t = span > 0 ? (target - arc[seg - 1]) / span : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: i / (n - 1) });
    }
    return out;
  }

  /* Path samples with the corridor half-width narrowing linearly
     from w0 at the entry to w1 at the exit. */
  function buildSamples(dense, n, w0, w1) {
    var samples = resampleByArc(dense, n), i;
    for (i = 0; i < samples.length; i++) {
      samples[i].hw = w0 + (w1 - w0) * samples[i].s;
    }
    return samples;
  }

  /* Wall polylines offset perpendicular to the path by ±hw. */
  function buildWalls(samples) {
    var left = [], right = [], i, a, b, dx, dy, len, nx, ny, p;
    for (i = 0; i < samples.length; i++) {
      a = samples[Math.max(0, i - 1)];
      b = samples[Math.min(samples.length - 1, i + 1)];
      dx = b.x - a.x; dy = b.y - a.y;
      len = Math.hypot(dx, dy) || 1;
      nx = -dy / len; ny = dx / len;
      p = samples[i];
      left.push({ x: p.x + nx * p.hw, y: p.y + ny * p.hw });
      right.push({ x: p.x - nx * p.hw, y: p.y - ny * p.hw });
    }
    return { left: left, right: right };
  }

  /* A wall folds when a bend is tighter than the corridor is wide —
     its points run backwards against the centerline. */
  function wallsFolded(wall, center) {
    var i, j;
    for (i = 0; i + 1 < wall.length; i += 3) {
      j = Math.min(i + 3, wall.length - 1);
      if ((wall[j].x - wall[i].x) * (center[j].x - center[i].x) +
          (wall[j].y - wall[i].y) * (center[j].y - center[i].y) < 0) return true;
    }
    return false;
  }

  function nearestIdx(p, samples) {
    var best = 0, bd = Infinity, i, d;
    for (i = 0; i < samples.length; i++) {
      d = Math.hypot(p.x - samples[i].x, p.y - samples[i].y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* Is p outside the corridor, and against which path sample?
     A stroke advances along the tunnel, so seeding from the previous
     match and searching a window around it usually answers in 49 checks
     instead of 300. That window can be wrong on a doubling-back path,
     so the cheap answer is only ever TRUSTED WHEN IT SAYS "INSIDE",
     which is the lenient direction; the moment it would flash coral at
     the player it is confirmed against the full scan. A false accusation
     is never cheap. The score does not use this at all — projectStroke
     runs the exact search over the finished stroke.
     Speed matters here for fairness, not polish: the player steers by
     watching the ink, and ink that lags is a corridor you cannot hold. */
  function outsideAt(p, samples, seed, span) {
    var lo, hi, best = 0, bd = Infinity, i, d, sm;
    if (seed >= 0 && span > 0 && seed < samples.length) {
      lo = Math.max(0, seed - span);
      hi = Math.min(samples.length - 1, seed + span);
      for (i = lo; i <= hi; i++) {
        d = Math.hypot(p.x - samples[i].x, p.y - samples[i].y);
        if (d < bd) { bd = d; best = i; }
      }
      if (bd <= samples[best].hw) return { idx: best, out: false };
    }
    best = nearestIdx(p, samples);
    sm = samples[best];
    return { idx: best, out: Math.hypot(p.x - sm.x, p.y - sm.y) > sm.hw };
  }

  /* Project every stroke sample onto its nearest path sample:
     perpendicular distance, local half-width, arc position. */
  function projectStroke(strokePts, samples) {
    var proj = [], i, idx, sm;
    for (i = 0; i < strokePts.length; i++) {
      idx = nearestIdx(strokePts[i], samples);
      sm = samples[idx];
      proj.push({
        dist: Math.hypot(strokePts[i].x - sm.x, strokePts[i].y - sm.y),
        hw: sm.hw,
        s: sm.s,
        /* screen-y offset from the centreline, carried for the WORDS only —
           nothing in the score reads it. dist is unsigned, so without this
           the drill can see that a run hugged an edge but never which one,
           and "you rode the low side the whole way" is the one sentence
           that tells a player what to change. The corridor always flows
           left to right, so up/down on the sheet is unambiguous. */
        dy: strokePts[i].y - sm.y
      });
    }
    return proj;
  }

  /* Fraction of stroke samples that stayed between the walls. */
  function insideFrac(proj) {
    if (!proj.length) return 0;
    var n = 0, i;
    for (i = 0; i < proj.length; i++) if (proj[i].dist <= proj[i].hw) n++;
    return n / proj.length;
  }

  /* 1 on the centerline, 0 at (or past) a wall, averaged. A sample
     with a degenerate half-width or a non-finite distance counts as
     0 rather than poisoning the mean with NaN. */
  function centering(proj) {
    if (!proj.length) return 0;
    var sum = 0, i, d, hw;
    for (i = 0; i < proj.length; i++) {
      d = proj[i].dist; hw = proj[i].hw;
      if (isFinite(d) && hw > 0) sum += clamp01(1 - d / hw);
      else if (d === 0) sum += 1;
    }
    return sum / proj.length;
  }

  /* Furthest arc position reached (monotonicity not required). */
  function coverage(proj) {
    var max = 0, i;
    for (i = 0; i < proj.length; i++) if (proj[i].s > max) max = proj[i].s;
    return max;
  }

  /* 0–100 for one tunnel: quality of the line × distance travelled.
     Reaching FULL_COV of the tunnel already counts as arriving — and
     since a run short of that is never scored at all, the coverage term
     is a gate the player is told about, not a silent multiplier that
     halves an honest line for a reason nobody ever named. */
  function tunnelScore(strokePts, samples) {
    if (!strokePts || !strokePts.length || !samples || !samples.length) {
      return { inside: 0, centering: 0, coverage: 0, score: 0 };
    }
    var proj = projectStroke(strokePts, samples);
    var f = insideFrac(proj);
    var c = centering(proj);
    var cov = coverage(proj);
    var score = 100 * (W_INSIDE * f + W_CENTER * c) * clamp01(cov / FULL_COV);
    if (!isFinite(score)) score = 0;
    return {
      inside: f, centering: c, coverage: cov,
      score: Math.max(0, Math.min(100, score)),
      proj: proj
    };
  }

  /* Mean arc position (0 = entry, 1 = flag) of the samples that left the
     corridor, or null if the run never left it. The coral stretches show
     WHERE on the sheet; this is what lets the words say where along the
     TUNNEL — which is the part that generalises to the next one. */
  function outsideMeanS(proj) {
    var sum = 0, n = 0, i;
    if (!proj) return null;
    for (i = 0; i < proj.length; i++) {
      if (proj[i].dist > proj[i].hw) { sum += proj[i].s; n += 1; }
    }
    return n ? sum / n : null;
  }

  /* Mean signed offset from the centreline as a share of the corridor's
     half-width: +1 = riding the low edge, −1 = the high edge, 0 = centred.
     Samples with a degenerate half-width are skipped rather than folded in
     as zeroes, which would quietly report every run as centred. */
  function sideBias(proj) {
    var sum = 0, n = 0, i;
    if (!proj) return 0;
    for (i = 0; i < proj.length; i++) {
      if (proj[i].hw > 0 && isFinite(proj[i].dy)) { sum += proj[i].dy / proj[i].hw; n += 1; }
    }
    return n ? sum / n : 0;
  }

  /* The delta in words. Two percentages are two numbers; a beginner who
     scores 71 twice in a row needs to be told that the first was wall
     contact and the second was riding one edge of a clean lane. */
  function tunnelWords(res) {
    if (!res || !isFinite(res.inside)) return '';
    var outPct = Math.round((1 - res.inside) * 100);
    /* Gate the clean-run wording on the run ACTUALLY never leaving the
       corridor, not on a rounded percentage: one sample out of 250 outside
       rounds to 0%, and the reveal paints that stretch coral. "Clean run —
       you held the middle" printed under a line with coral in it teaches
       the player to distrust both the words and their own eyes. */
    if (res.inside >= 1) {
      if (res.centering >= 0.7) return 'clean run — you held the middle';
      /* 0.25 of a half-width, and this branch is only reached when the
         centring term is already under 0.7 — i.e. the run averages more
         than 0.3 out from the middle. A SIGNED mean of 0.25 against an
         unsigned mean above 0.3 can only come from a line that spent the
         great majority of its length on one side, which is exactly the
         claim the sentence makes. A zigzag cancels itself out and gets
         the general wording instead. */
      var side = sideBias(res.proj);
      if (side > 0.25) return 'never touched a wall, but you rode the low side of it the whole way';
      if (side < -0.25) return 'never touched a wall, but you rode the high side of it the whole way';
      /* Reaching here means the run averaged well off centre (centring under
         0.7) WITHOUT favouring either side — which can only be a line that
         crossed back and forth, so say that: it is the one thing the two
         branches above do not cover, and it is a different fault with a
         different fix from riding one edge.
         It used to end "— the dashes are the middle", which tunnel one's own
         legend says verbatim two clauses later: measured, the hint read
         "…drifted off the middle — the dashes are the middle. near the middle
         58%. the dashes are the middle of the tunnel — hold to study…". The
         legend is deliberately shown once, on tunnel one; repeating it inside
         the delta spends the line the player actually needs on chrome they
         have already read. */
      return 'never touched a wall, but you wandered from side to side instead of holding the middle';
    }
    var s = outsideMeanS(res.proj);
    var where = s === null ? '' :
      (s < 0.34 ? ' — mostly in the first stretch' :
        (s > 0.66 ? ' — mostly near the flag, where it is narrowest' : ' — mostly in the middle bends'));
    if (outPct <= 0) return 'you just brushed a wall' + where;
    if (outPct <= 10) return 'you clipped a wall for ' + outPct + '% of the run' + where;
    return 'you were outside the walls for ' + outPct + '% of the run' + where;
  }

  /* How far along the tunnel a run has reached, as a share. Used live,
     so the copy can say "you lifted 55% of the way" instead of quietly
     scoring a half run. */
  function coverageOf(strokePts, samples) {
    if (!strokePts || !strokePts.length || !samples || !samples.length) return 0;
    return coverage(projectStroke(strokePts, samples));
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    return sum / scores.length;
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

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--coral').trim(),
      /* accent TEXT: borrow the HUD's resolved color — pure accent on
         the paper card is ~3:1, fine for lines but not for type, so
         the stylesheet mixes it toward ink in light mode. */
      accentText: getComputedStyle(hudScore).color,
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
  var round = 0, tunnelIdx = 0, scores = [], tunnel = null, playing = false;
  var activePid = null, activeType = '', strokePts = [], revealing = null, revealTimer = null;
  var holdingReveal = false;  /* a press is studying the reveal; release moves on */
  var lastPenAt = -Infinity;
  var lift = null;        /* {x,y,at} — where the last press let go */
  var snap = null;        /* {dx,dy,travel} — the fading pull onto the entry */
  var seedIdx = 0;        /* last matched path sample, for the local search */
  var rafId = null;
  /* the last scored tunnel in words — the third one reports and is
     overwritten by "round done" in the same tick, so without this the
     tunnel that closes every round is the one nobody is told about */
  var lastWords = '';

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function now() { return Date.now(); }

  function tunnelLabel() { return 'tunnel ' + (tunnelIdx + 1) + ' of ' + TUNNELS_PER_ROUND; }

  /* Control points flow left → right; y alternates around the middle
     so the corridor genuinely winds instead of drifting. innerW is
     passed in rather than derived from the canvas: the traverse is
     capped and centred so it fits a trackpad, however wide the screen. */
  function makeControls(n, amp, marginX, innerW, padY) {
    var cy = H / 2;
    var step = innerW / (n - 1);
    /* The step clamp keeps consecutive bends far enough apart that the
       walls do not fold; at 0.55 it also flattened the path so much that
       an eased (wider) corridor could be cleared with a dead straight
       line. 0.8 leaves the bends real — the generator below rejects
       anything that actually tangles, so the safety net is unchanged. */
    var a = Math.min(amp, step * 0.8, (H - 2 * padY) * 0.425);
    var pts = [], i, x, y, sign;
    for (i = 0; i < n; i++) {
      x = marginX + step * i;
      if (i > 0 && i < n - 1) x += rand(-step * 0.18, step * 0.18);
      if (i === 0 || i === n - 1) {
        y = cy + rand(-a * 0.5, a * 0.5);
      } else {
        sign = (i % 2 === 0 ? 1 : -1) * (Math.random() < 0.2 ? -1 : 1);
        y = cy + sign * rand(a * 0.35, a);
      }
      pts.push({ x: x, y: Math.max(padY, Math.min(H - padY, y)) });
    }
    return pts;
  }

  /* Generate one tunnel; reject tangled paths and folded walls and
     try again (calming the wiggle if the dice stay unlucky).
     Widths come from halfWidth(), so they follow the canvas and the
     hardware; the traverse is capped at MAX_SPAN_PX and centred. */
  function makeTunnel(idx) {
    var spec = TUNNEL_SPECS[idx];
    var easeMul = ArtDaily.ease(1);
    var w0 = halfWidth(spec.w0, H, easeMul);
    var w1 = halfWidth(spec.w1, H, easeMul);
    /* Easing widens the corridor, so the path has to wind further too —
       otherwise a mouse's roomier lane turns "steer round the bends"
       into "draw a straight line", and the drill stops teaching. The
       tolerance is eased; the demand is not dropped. */
    var amp = spec.amp * H * (0.6 + 0.4 * easeMul);
    var padY = Math.min(w0 + 16, H * 0.32);
    var innerW = Math.max(80, Math.min(W - 2 * (w0 + 14), MAX_SPAN_PX));
    var marginX = (W - innerW) / 2;
    var attempt, ctrl, dense, samples, walls, ok;
    for (attempt = 0; attempt < GEN_ATTEMPTS; attempt++) {
      if (attempt > 0 && attempt % 10 === 0) amp *= 0.6;
      ctrl = makeControls(spec.pts, amp, marginX, innerW, padY);
      dense = catmullSample(ctrl, 48);
      ok = !pathIsTangled(dense, w0 * 2.4);
      samples = buildSamples(dense, PATH_SAMPLES, w0, w1);
      walls = buildWalls(samples);
      if (ok && (wallsFolded(walls.left, samples) || wallsFolded(walls.right, samples))) ok = false;
      if (ok) break;
    }
    /* after GEN_ATTEMPTS the wiggle is tiny — accept the last candidate.
       The ring is sized for the hand that has to find it, not for the
       corridor: a pen tablet gets the widest one because acquiring a
       target it cannot see is the hardest thing it does. */
    tunnel = {
      samples: samples,
      walls: walls,
      startR: ArtDaily.startRadius(Math.max(24, Math.min(w0 * 1.1, 34)))
    };
  }

  function resetRun() {
    strokePts = [];
    lift = null;
    snap = null;
    seedIdx = 0;
  }

  function newRound() {
    clearTimeout(revealTimer);
    round += 1;
    tunnelIdx = 0;
    scores = [];
    resetRun();
    activePid = null;
    activeType = '';
    revealing = null;
    holdingReveal = false;
    lastWords = '';
    playing = true;
    makeTunnel(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hint.textContent = tunnelLabel() + ' — press in the coral ring and steer to the flag. You may lift and carry on.';
    draw();
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function drawPolyline(pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* Soft wash everywhere except the corridor: tint the sheet, then
     lift the corridor back out so the dot-grid shows through inside. */
  function drawWash(c) {
    var i;
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = c.muted;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(tunnel.walls.left[0].x, tunnel.walls.left[0].y);
    for (i = 1; i < tunnel.walls.left.length; i++) {
      ctx.lineTo(tunnel.walls.left[i].x, tunnel.walls.left[i].y);
    }
    for (i = tunnel.walls.right.length - 1; i >= 0; i--) {
      ctx.lineTo(tunnel.walls.right[i].x, tunnel.walls.right[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawEntry(c) {
    var s0 = tunnel.samples[0];
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(s0.x, s0.y, tunnel.startR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s0.x, s0.y, tunnel.startR, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawFlag(c) {
    var e = tunnel.samples[tunnel.samples.length - 1];
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x, e.y - 20);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - 20);
    ctx.lineTo(e.x + 14, e.y - 15.5);
    ctx.lineTo(e.x, e.y - 11);
    ctx.closePath();
    ctx.fill();
  }

  /* The stroke, run by run: ink inside the corridor, accent (coral)
     wherever it crossed a wall — the live feedback and the reveal
     share this one painter. A point flagged `brk` began a fresh press,
     so no ink is drawn across the gap: the player sees where they
     lifted instead of a straight line they never made. */
  function drawStrokeColored(pts, c) {
    if (pts.length < 2) return;
    var i = 0, j, out, k;
    while (i < pts.length - 1) {
      if (pts[i + 1].brk) { i += 1; continue; }
      out = pts[i].out || pts[i + 1].out;
      j = i + 1;
      while (j < pts.length - 1 && !pts[j + 1].brk &&
             (pts[j].out || pts[j + 1].out) === out) j++;
      ctx.strokeStyle = out ? c.accent : c.ink;
      ctx.lineWidth = out ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      for (k = i + 1; k <= j; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();
      i = j;
    }
  }

  /* Both numbers that made the score, named. The old label printed
     "inside 92% · 38" — two wildly different figures with nothing to
     connect them, because the term that actually cut the score was
     never shown at all. */
  function drawRevealLabel(c) {
    var label = 'inside ' + Math.round(revealing.inside * 100) + '%' +
      ' · centred ' + Math.round(revealing.centering * 100) + '%' +
      ' · ' + revealing.score;
    var tx = W / 2, ty = 26;
    var fs = Math.max(12, Math.min(18, Math.round(W / 24)));
    ctx.font = '900 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    var w = ctx.measureText(label).width + 18;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = c.card;
    ctx.fillRect(tx - w / 2, ty - 17, w, 26);
    ctx.restore();
    ctx.fillStyle = c.accentText;
    ctx.fillText(label, tx, ty + 1);
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!tunnel) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    drawWash(c);

    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    drawPolyline(tunnel.walls.left);
    drawPolyline(tunnel.walls.right);

    drawEntry(c);
    drawFlag(c);

    if (revealing) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      drawPolyline(tunnel.samples);
      ctx.restore();
      drawStrokeColored(revealing.pts, c);
      drawRevealLabel(c);
      return;
    }

    if (strokePts.length) drawStrokeColored(strokePts, c);
  }

  /* ---- input: one run to the flag, in as many presses as it takes ---- */
  /* Split in two so a run of coalesced samples can share ONE canvas
     measurement: getBoundingClientRect() forces a layout flush, and a fast
     pen hands over dozens of samples per frame — all of them describing a
     canvas that cannot have moved between them. Measured here: 16 layout
     reads per pointermove instead of 1, in the handler the player steers by.
     (This is the hazard ArtDaily.samples() is documented against.) */
  function posIn(ev, rect) {
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
  function pointerPos(ev) {
    return posIn(ev, canvas.getBoundingClientRect());
  }

  /* rAF-throttled repaint. The player steers by watching the ink, so a
     repaint per pointer sample (which at 120Hz means several per frame,
     each one a full-canvas wash) costs exactly the feedback the drill
     runs on. One paint per frame, never more. */
  function scheduleDraw() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(function () { rafId = null; draw(); });
  }

  /* The fading pull onto the entry ring: a press that missed still
     starts the run, on the target, and the offset bleeds away over the
     first SNAP_DECAY_PX so the ink settles under the pointer. */
  function applySnap(p) {
    if (!snap) return p;
    var k = 1 - clamp01(snap.travel / SNAP_DECAY_PX);
    if (k <= 0) { snap = null; return p; }
    return { x: p.x + snap.dx * k, y: p.y + snap.dy * k };
  }

  /* Tag each sample with whether it is outside the corridor right
     now — the coral flash needs no waiting for the score. */
  function classify(p) {
    var r = outsideAt(p, tunnel.samples, seedIdx, 24);
    seedIdx = r.idx;
    return { x: p.x, y: p.y, out: r.out };
  }

  /* The press that owns the run in progress is provably no longer down.

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
     already gone. Measured: one lost touch release left activePid set against
     an id nothing could match again, every later press was swallowed, and the
     tunnel was dead until "new round" — which throws the whole round away. */
  function ownerGone(ev) {
    return ev.isPrimary === true && ev.pointerType === activeType;
  }

  /* Undo the press in progress, keeping the earlier presses of the same
     run. A palm that stole the stroke should cost its own drift, not the
     ink the player already laid down before it landed. */
  function dropCurrentPress() {
    var i = strokePts.length - 1, last;
    while (i > 0 && !strokePts[i].brk) i--;
    strokePts.length = (strokePts[i] && strokePts[i].brk) ? i : 0;
    snap = null;
    if (strokePts.length) {
      last = strokePts[strokePts.length - 1];
      lift = { x: last.x, y: last.y, at: now() };
    } else {
      lift = null;
      seedIdx = 0;
    }
  }

  /* Add one raw pointer position to the run, snap-corrected. */
  function pushSample(raw, isBreak) {
    var last = strokePts.length ? strokePts[strokePts.length - 1] : null;
    if (snap && last) snap.travel += Math.hypot(raw.x - snap.lastRaw.x, raw.y - snap.lastRaw.y);
    if (snap) snap.lastRaw = { x: raw.x, y: raw.y };
    var pt = classify(applySnap(raw));
    if (isBreak) pt.brk = true;
    strokePts.push(pt);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (!tunnel) return;
    if (!playing) {
      /* round is over, last reveal on screen — point at the button */
      hint.textContent = 'round done — press "new round" for three fresh tunnels.';
      return;
    }
    if (revealing) {
      /* Press-and-hold studies the reveal for as long as you like; the
         release moves on. The reveal IS the lesson here — the coral
         stretches say where the line left the corridor and the dashes say
         where the middle was — and 1.3 seconds of it, with no way to
         pause, is a score with the reasons flashed past. Same gesture as
         angle-snap, which already teaches its protractor arc this way. */
      ev.preventDefault();
      clearTimeout(revealTimer);
      holdingReveal = true;
      return;
    }
    ev.preventDefault();

    /* Palm rejection, both directions: a touch inside the pen's shadow is
       the hand resting on the glass, and a nib landing while a touch owns
       the run takes it over rather than being inert for the whole tunnel
       while palm drift is recorded as the player's line. */
    if (ev.pointerType === 'pen') lastPenAt = now();
    else if (ev.pointerType === 'touch' && now() - lastPenAt < PEN_LOCK_MS) return;
    if (activePid !== null) {
      /* Two ways this press may proceed instead of being ignored. The pen
         outranking a palm is the second; the FIRST is this very pointer
         arriving down twice with no release in between, which the
         pointer-events spec says cannot happen — so its release was lost
         (press, drag out of the embed frame, let go over the page). The old
         press is over. Without this the `return` swallowed the new press while
         pointermove — which only checks the id, still matching — kept
         appending its samples to the ABANDONED press: the two were welded into
         one run and scored as one. Measured: a perfect centreline run scored
         84 and was told it was "outside the walls for 16% of the run", about a
         wall it never touched on the run it actually drew. dropCurrentPress()
         keeps the earlier presses of the run, so nothing honest is lost. */
      if (ev.pointerId !== activePid &&
          (ev.pointerType !== 'pen' || activeType === 'pen') &&
          /* …and the THIRD: a finger's release was lost, so the id is new but
             the press it belonged to is provably over — see ownerGone() */
          !ownerGone(ev)) return;
      try { canvas.releasePointerCapture(activePid); } catch (e) {}
      activePid = null;
      activeType = '';
      dropCurrentPress();
    }

    var p = pointerPos(ev);
    var s0 = tunnel.samples[0];
    var dRing = Math.hypot(p.x - s0.x, p.y - s0.y);
    var rL = ArtDaily.startRadius(RESUME_BASE_PX);
    var dLift = lift ? Math.hypot(p.x - lift.x, p.y - lift.y) : Infinity;

    if (dLift <= rL) {
      /* carrying the same run on — the common trackpad case */
    } else if (dRing <= tunnel.startR * SNAP_MULT) {
      /* a fresh start. Inside the ring it is exact; a near miss is
         pulled onto the entry instead of being refused. */
      resetRun();
      if (dRing > 1) snap = { dx: s0.x - p.x, dy: s0.y - p.y, travel: 0, lastRaw: { x: p.x, y: p.y } };
    } else if (dLift <= rL * SNAP_MULT) {
      /* a loose re-press near the ink — still the same run */
    } else {
      hint.textContent = strokePts.length
        ? 'to carry on, press near where your ink stopped — or press the coral ring to start this tunnel again.'
        : 'press in the coral ring (near enough counts) and steer to the flag.';
      return;
    }

    activePid = ev.pointerId;
    activeType = ev.pointerType || 'mouse';
    if (!strokePts.length) seedIdx = 0;
    pushSample(p, strokePts.length > 0);
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (activePid !== ev.pointerId) return;
    ev.preventDefault();
    /* coalesced events: a fast pen pull is sampled at full fidelity, so
       the inside fraction is computed from the line actually drawn. The
       canvas is measured ONCE for the whole run — see posIn(). */
    var rect = canvas.getBoundingClientRect();
    var evs = ArtDaily.samples(ev);
    for (var i = 0; i < evs.length; i++) pushSample(posIn(evs[i], rect), false);
    scheduleDraw();
  });

  function endStroke(ev) {
    if (activePid === null || ev.pointerId !== activePid) return;
    if (ev.cancelable) ev.preventDefault();
    activePid = null;
    activeType = '';
    if (strokePts.length < MIN_SAMPLES) {
      /* accidental tap — reset the attempt, no penalty */
      resetRun();
      hint.textContent = tunnelLabel() + ' — just a tap; press in the ring and steer to the flag.';
      draw();
      return;
    }
    var last = strokePts[strokePts.length - 1];
    lift = { x: last.x, y: last.y, at: now() };
    snap = null; /* the pull was for finding the ring; it is spent */

    /* An unfinished run is NEVER scored. A trackpad runs out of throw
       long before this tunnel runs out of length; that is a fact about
       the hardware, and billing it as a bad line is the single most
       unfair thing this drill used to do. Say what happened, and let
       them carry on from where they stopped. */
    var cov = coverageOf(strokePts, tunnel.samples);
    if (cov < FULL_COV) {
      hint.textContent = 'you lifted ' + Math.round(cov * 100) +
        '% of the way — press near where your ink stopped and keep going. no penalty.';
      draw();
      return;
    }

    var res = tunnelScore(strokePts, tunnel.samples);
    /* Repaint the coral from the EXACT projection the score was computed
       from. The live flags come from outsideAt(), which searches a window
       around the last match for speed — deliberately lenient, and on a
       doubling-back stretch it can call a sample inside that the score's
       full scan counts as outside. The reveal is where the player checks
       the number against the picture, so the picture has to BE the number:
       every coral stretch is a sample in the "inside N%" shortfall, and
       every one of those is coral. */
    var pi;
    for (pi = 0; pi < strokePts.length && pi < res.proj.length; pi++) {
      strokePts[pi].out = res.proj[pi].dist > res.proj[pi].hw;
    }
    scores.push(res.score);
    revealing = {
      pts: strokePts,
      inside: res.inside,
      centering: res.centering,
      score: Math.round(res.score)
    };
    resetRun();
    lastWords = 'last tunnel ' + revealing.score + ' — ' + tunnelWords(res) + '.';
    /* the words already carry the inside fraction ("outside the walls for
       8% of the run"), so printing it again as a percentage is two numbers
       for one fact and a hint line long enough to shove the canvas down */
    hint.textContent = tunnelLabel() + ' — score ' + revealing.score + ': ' + tunnelWords(res) +
      '. near the middle ' + Math.round(res.centering * 100) + '%' +
      (scores.length >= TUNNELS_PER_ROUND ? '.'
        : (tunnelIdx === 0
          ? '. the dashes are the middle of the tunnel — hold to study it, release for the next one.'
          : '. hold to study, release for next.'));
    clearTimeout(revealTimer);
    if (scores.length >= TUNNELS_PER_ROUND) {
      /* report NOW, not after the reveal timer — a "new round" click
         during this reveal must never swallow a completed round. The
         last reveal stays on the sheet until the next round starts. */
      finishRound();
    } else {
      revealTimer = setTimeout(nextStep, REVEAL_MS);
    }
    draw();
  }
  /* A release while the reveal is held moves on; otherwise it is a lift. */
  function onPointerUp(ev) {
    if (revealing && holdingReveal) {
      holdingReveal = false;
      clearTimeout(revealTimer);
      nextStep();
      return;
    }
    endStroke(ev);
  }
  canvas.addEventListener('pointerup', onPointerUp);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', onPointerUp);
  /* iOS drops capture without a pointerup — treat it as the lift it is.
     Without this activePid stays set for good, and since every later finger
     gets a NEW pointerId, no press or release matches the guards again:
     the tunnel is dead until "new round". endStroke no-ops on a duplicate
     call, so the extra binding is free. */
  canvas.addEventListener('lostpointercapture', endStroke);

  /* An interrupted press (system gesture, palm takeover) ends the press,
     not the run: whatever was drawn stays on the sheet and stays
     resumable, exactly as a deliberate lift does. */
  /* End a press-and-hold that is never going to get its release, and start
     the countdown over. The hold cancels the auto-advance, so anything that
     swallows the pointerup — the tab losing focus, an OS notification, a
     context menu, the embed dialog closing — would otherwise freeze the
     reveal for good, with no way on but "new round", which throws away
     every finished tunnel of the round. */
  function releaseHold() {
    if (!revealing || !holdingReveal) return;
    holdingReveal = false;
    clearTimeout(revealTimer);
    if (playing) revealTimer = setTimeout(nextStep, REVEAL_MS);
  }
  window.addEventListener('blur', releaseHold);
  window.addEventListener('contextmenu', releaseHold);

  function cancelStroke(ev) {
    if (revealing && holdingReveal) { releaseHold(); return; }
    if (activePid === null || ev.pointerId !== activePid) return;
    activePid = null;
    activeType = '';
    snap = null;
    if (strokePts.length >= MIN_SAMPLES) {
      var last = strokePts[strokePts.length - 1];
      lift = { x: last.x, y: last.y, at: now() };
      if (playing && !revealing) {
        hint.textContent = tunnelLabel() +
          ' — stroke interrupted; press near where your ink stopped and keep going. no penalty.';
      }
    } else {
      resetRun();
      if (playing && !revealing) hint.textContent = tunnelLabel() + ' — stroke interrupted; go again from the ring.';
    }
    draw();
  }
  canvas.addEventListener('pointercancel', cancelStroke);
  window.addEventListener('pointercancel', cancelStroke);

  /* Only ever scheduled between tunnels — the last tunnel reports and
     keeps its reveal instead. */
  function nextStep() {
    if (!revealing || !playing) return;
    revealing = null;
    holdingReveal = false;
    resetRun();
    tunnelIdx += 1;
    makeTunnel(tunnelIdx);
    hint.textContent = tunnelLabel() + ' — narrower now. press in the ring and steer to the flag.';
    draw();
  }

  function finishRound() {
    playing = false;
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'round done — ' + (lastWords ? lastWords + ' ' : '') +
      'press "new round" to go again.';
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

  /* The hardware changed mid-session (a laptop user plugged in a tablet,
     an iPad user picked up the pencil). The corridor width is baked into
     the tunnel at generation, so rebuild it — but never under a run in
     progress: the attempt you are drawing keeps the geometry you started
     it with. */
  ArtDaily.onInput(function () {
    /* This arrives from the SDK's capture-phase pointerdown listener, so it
       runs BEFORE the canvas sees that same press: rebuilding here swaps the
       corridor under the hand that is starting a run on it. Defer one turn —
       by then the press has either started a run (and the guard below
       declines, exactly as it does mid-stroke) or was refused, and a rebuild
       is free. The current tunnel keeps the geometry it was begun with; the
       new width arrives with the next one. */
    setTimeout(function () {
      if (!playing || revealing || activePid !== null || strokePts.length) { draw(); return; }
      resetRun();
      makeTunnel(tunnelIdx);
      hint.textContent = tunnelLabel() + ' — resized for ' + ArtDaily.inputLabel() +
        '. press in the ring and steer to the flag.';
      draw();
    }, 0);
  });

  /* Carry the geometry across to the new canvas box. Canvas height is
     derived from width here, so the two axes scale by the same factor —
     which is what lets the corridor keep its shape: a uniform scale leaves
     the wall normals unchanged, so scaling the samples, their half-widths
     and the walls by the same s keeps them exactly matched. */
  function scaleGeometry(s) {
    var i, sm, w;
    if (!tunnel) return;
    for (i = 0; i < tunnel.samples.length; i++) {
      sm = tunnel.samples[i];
      sm.x *= s; sm.y *= s; sm.hw *= s;
    }
    for (i = 0; i < tunnel.walls.left.length; i++) {
      w = tunnel.walls.left[i]; w.x *= s; w.y *= s;
      w = tunnel.walls.right[i]; w.x *= s; w.y *= s;
    }
    tunnel.startR *= s;
    if (revealing) for (i = 0; i < revealing.pts.length; i++) { revealing.pts[i].x *= s; revealing.pts[i].y *= s; }
    for (i = 0; i < strokePts.length; i++) { strokePts[i].x *= s; strokePts[i].y *= s; }
    if (lift) { lift.x *= s; lift.y *= s; }
  }

  window.addEventListener('resize', function () {
    var oldW = W;
    fitCanvas();
    /* Canvas height is derived from width, so a height-only viewport
       change (an iOS toolbar collapsing) leaves the sheet identical.
       Without this guard the drill replaced the tunnel under the player,
       mid-round, in silence, every time the URL bar moved. */
    if (W === oldW) { draw(); return; }
    /* the canvas really did change size — the tunnel lives in canvas
       coordinates, so rebuild it; an in-flight run resets free of charge */
    if (playing && !revealing) {
      activePid = null;
      activeType = '';
      resetRun();
      makeTunnel(tunnelIdx);
      hint.textContent = tunnelLabel() + ' — window resized, fresh tunnel. press in the ring, no penalty.';
    } else if (oldW > 0) {
      /* A reveal is on the sheet — either between tunnels or the round's
         closing one, which is the whole lesson — so rebuilding would throw
         away the line being studied. Carry it across instead: rotating a
         phone here used to leave the corridor, the run and the flag drawn
         at the old scale, running clean off the side of the new canvas. */
      scaleGeometry(W / oldW);
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
