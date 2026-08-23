/* ============================================================
   game.js — Superimposed Lines: the Drawabox warm-up, and the
   most useful line drill a beginner can do. A faint guide with a
   start dot; draw that same line four times, always from the dot,
   each repeat in darker ink so the fan of your own repeats is
   visible. Four sets per round, ramping from a short straight to
   a longer gentle curve.

   You are scored against YOURSELF, never against a machine-perfect
   line: how tightly your four repeats agree (fraying), how smoothly
   each one is pulled (commitment), how closely your starts cluster
   on the dot. Four confident copies of a wrong line beat four timid
   different ones — that is the lesson, so that is the scoring.

   Every tolerance comes from the input profile (ArtDaily.ease /
   ArtDaily.startRadius): a trackpad is not held to a pen tablet's
   wobble, a screenless tablet gets the big start zone it needs, and
   the HUD says which mode it eased for. Near-miss presses snap onto
   the dot instead of being refused (a press further out than a few
   start-radii is told, not silently teleported), and a repeat may be
   drawn in as many contacts as the hardware needs — a trackpad cannot
   pull 400px in one go, so a press back near where you lifted carries
   the same repeat on and a press back on the dot starts it over.

   The pure scoring functions sit at the top: geometry in, numbers
   out, no canvas and no DOM, so they are unit-testable.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'superimposed';
  var SETS_PER_ROUND = 4;
  var REPEATS_PER_SET = 4;
  var MIN_SAMPLES = 6;     /* fewer points in a repeat = accidental tap */
  var MIN_SEGMENT = 4;     /* a contact shorter than this is a stray tap */
  var REVEAL_MS = 2400;    /* reveal holds this long; a tap skips ahead */
  var PATH_N = 64;         /* arc resample used for the fan comparison */
  var TURN_N = 30;         /* arc resample used for the smoothness read */
  var GUIDE_N = 96;        /* arc samples of the guide line */

  /* Zero-point tolerances, all as BASE values — the caller runs each
     through ArtDaily.ease() so the same honest attempt reads the same
     from a pen, a mouse and a finger. */
  var FRAY_ZERO = 0.06;    /* fan spread / line length that scores 0 */
  var FRAY_FREE = 0.005;   /* the first 0.5% of spread is free */
  var FRAY_GAMMA = 0.7;    /* <1: stingy at the top, unchanged at the bottom */
  var TURN_ZERO = 0.095;   /* radians of direction-change energy = 0 */
  var TURN_FREE = 0.012;   /* no hand pulls a line at exactly zero */
  var TURN_GAMMA = 1.25;   /* >1: a wobbly hand keeps partial credit longer */
  var START_BASE = 30;     /* base radius of the start dot's zone */
  var SNAP_MULT = 3;       /* a press this many start-radii out still snaps */
  var RESUME_BASE = 50;    /* press this close to where you lifted = same repeat */
  var RESUME_MS = 4000;    /* …and this soon after it */
  var MIN_COVER = 0.45;    /* a repeat must trace this much of the guide */
  var COVER_GUARD = 0.30;  /* below this, "the same line" isn't a line yet */
  var PEN_LOCK_MS = 700;   /* a finger is inert this long after the pen speaks */

  /* Progressively darker ink, faintest first. The floor is 0.55 rather
     than a whisper because the fan IS the lesson: 3.40:1 on paper,
     5.02:1 in the night studio. */
  var REPEAT_ALPHA = [0.55, 0.68, 0.82, 1.0];

  /* Set ramp: short straight → longer and gently curved. */
  var SET_SPECS = [
    { frac: 0.42, bow: 0.00, ang: -6 },
    { frac: 0.56, bow: 0.00, ang: 26 },
    { frac: 0.70, bow: 0.07, ang: -20 },
    { frac: 0.82, bow: 0.14, ang: 10 }
  ];

  /* ============================================================
     Pure scoring — points in, numbers out. No canvas, no DOM, no
     randomness. Points are {x,y} (input samples also carry t).
     ============================================================ */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function avg(list) {
    if (!list || !list.length) return 0;
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i];
    return sum / list.length;
  }

  function polyLength(pts) {
    if (!pts || pts.length < 2) return 0;
    var sum = 0, i;
    for (i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return sum;
  }

  /* Resample a polyline to n points evenly spaced by arc length, so two
     strokes drawn at different speeds still compare point-for-point. */
  function resampleByArc(pts, n) {
    var out = [], i, arc = [0], total, target, seg = 1, t, a, b, span;
    if (!pts || !pts.length || n < 2) return out;
    if (pts.length === 1) {
      for (i = 0; i < n; i++) out.push({ x: pts[0].x, y: pts[0].y });
      return out;
    }
    for (i = 1; i < pts.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    total = arc[arc.length - 1];
    if (!(total > 0)) {
      for (i = 0; i < n; i++) out.push({ x: pts[0].x, y: pts[0].y });
      return out;
    }
    for (i = 0; i < n; i++) {
      target = total * i / (n - 1);
      while (seg < pts.length - 1 && arc[seg] < target) seg++;
      a = pts[seg - 1]; b = pts[seg];
      span = arc[seg] - arc[seg - 1];
      t = span > 0 ? (target - arc[seg - 1]) / span : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  /* [0.25, 0.5, 0.25] pass, endpoints held. Digitiser noise is not
     wobble; smoothing once keeps the drill from scoring the hardware. */
  function smoothPath(pts, passes) {
    var cur = pts, k, i, next;
    for (k = 0; k < passes; k++) {
      if (cur.length < 3) return cur;
      next = [{ x: cur[0].x, y: cur[0].y }];
      for (i = 1; i < cur.length - 1; i++) {
        next.push({
          x: 0.25 * cur[i - 1].x + 0.5 * cur[i].x + 0.25 * cur[i + 1].x,
          y: 0.25 * cur[i - 1].y + 0.5 * cur[i].y + 0.25 * cur[i + 1].y
        });
      }
      next.push({ x: cur[cur.length - 1].x, y: cur[cur.length - 1].y });
      cur = next;
    }
    return cur;
  }

  /* The player's own reference line: the average of their repeats. */
  function meanPath(list) {
    if (!list || !list.length) return [];
    var n = list[0].length, out = [], i, k, sx, sy;
    for (i = 0; i < n; i++) {
      sx = 0; sy = 0;
      for (k = 0; k < list.length; k++) { sx += list[k][i].x; sy += list[k][i].y; }
      out.push({ x: sx / list.length, y: sy / list.length });
    }
    return out;
  }

  /* Unit tangents by central difference — the frame the fan is measured
     against, so along-the-line speed differences never count as fraying. */
  function tangents(path) {
    var out = [], i, a, b, dx, dy, len;
    for (i = 0; i < path.length; i++) {
      a = path[Math.max(0, i - 1)];
      b = path[Math.min(path.length - 1, i + 1)];
      dx = b.x - a.x; dy = b.y - a.y;
      len = Math.hypot(dx, dy);
      out.push(len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 });
    }
    return out;
  }

  /* RMS perpendicular spread of the repeats at each station along the mean
     path — the fraying envelope, in pixels. Perpendicular to the MEAN
     path's own tangent, so drawing one repeat faster than another (points
     landing further along the line) never reads as fraying. */
  function frayProfile(list, mean) {
    var out = [], tg = tangents(mean), i, k, sum, d;
    for (i = 0; i < mean.length; i++) {
      sum = 0;
      for (k = 0; k < list.length; k++) {
        d = tg[i].x * (list[k][i].y - mean[i].y) - tg[i].y * (list[k][i].x - mean[i].x);
        sum += d * d;
      }
      out.push(list.length ? Math.sqrt(sum / list.length) : 0);
    }
    return out;
  }

  /* One number for the whole fan: RMS of the envelope, in pixels. */
  function fanSpread(profile) {
    if (!profile.length) return 0;
    var sum = 0, i;
    for (i = 0; i < profile.length; i++) sum += profile[i] * profile[i];
    return Math.sqrt(sum / profile.length);
  }

  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* Direction-change energy: RMS turning angle with the MEAN turn removed,
     so an intended curve costs nothing and only the wobble — the
     corrections, the stop-and-restart — shows up. Radians. */
  function turnEnergy(pts) {
    var r = smoothPath(resampleByArc(pts, TURN_N), 2);
    var dirs = [], turns = [], i, dx, dy, m, v, d;
    for (i = 1; i < r.length; i++) {
      dx = r[i].x - r[i - 1].x; dy = r[i].y - r[i - 1].y;
      if (dx === 0 && dy === 0) continue;
      dirs.push(Math.atan2(dy, dx));
    }
    if (dirs.length < 3) return 0;
    for (i = 1; i < dirs.length; i++) turns.push(wrapPi(dirs[i] - dirs[i - 1]));
    m = avg(turns);
    v = 0;
    for (i = 0; i < turns.length; i++) { d = turns[i] - m; v += d * d; }
    return Math.sqrt(v / turns.length);
  }

  function commitment(pts, zero) {
    var e = turnEnergy(pts);
    var frac = clamp01(Math.max(0, e - TURN_FREE) / Math.max(1e-6, zero - TURN_FREE));
    return clamp01(1 - Math.pow(frac, TURN_GAMMA));
  }

  /* Start discipline: 60% "on the dot", 40% "in the same place every
     time". The zone is already eased per input mode by the caller, so a
     screenless tablet is judged against the big target it can hit. */
  function startCluster(presses, dot, zone) {
    if (!presses || !presses.length) return 0;
    var z = Math.max(8, zone), i, cx = 0, cy = 0, onDot = 0, tight = 0, a, b;
    for (i = 0; i < presses.length; i++) { cx += presses[i].x; cy += presses[i].y; }
    cx /= presses.length; cy /= presses.length;
    for (i = 0; i < presses.length; i++) {
      onDot += Math.hypot(presses[i].x - dot.x, presses[i].y - dot.y);
      tight += Math.hypot(presses[i].x - cx, presses[i].y - cy);
    }
    onDot /= presses.length;
    tight /= presses.length;
    a = clamp01(1 - Math.max(0, onDot - 0.25 * z) / (1.2 * z));
    b = clamp01(1 - Math.max(0, tight - 0.15 * z) / (0.9 * z));
    return 0.6 * a + 0.4 * b;
  }

  /* One set: the repeats, where each one was started, the dot, the guide's
     length (the only thing the guide contributes — you are scored against
     your own mean path, not against the guide) and the eased tolerances
     { frayZero, turnZero, startZone }. */
  function scoreSet(strokes, presses, dot, lineLen, tol) {
    var blank = { score: 0, fray: 0, frayFrac: 1, commit: 0, start: 0, cover: 0, mean: [], profile: [], spread: 0 };
    if (!strokes || !strokes.length) return blank;
    var res = [], i, r;
    for (i = 0; i < strokes.length; i++) {
      r = smoothPath(resampleByArc(strokes[i], PATH_N), 1);
      /* Every repeat is checked, not just the first. meanPath and
         frayProfile index list[k][i] against list[0].length, so ONE
         repeat that resampled to nothing (an empty point list) threw a
         TypeError straight out of the scorer — and a scorer that throws
         files no round at all, which is a worse failure than any score
         it could have returned. Play cannot reach it today (a repeat is
         only accepted at MIN_SAMPLES points or more), but that is the
         input path's guarantee, not this function's. */
      if (r.length === PATH_N) res.push(r);
    }
    if (!res.length) return blank;
    var mean = meanPath(res);
    var profile = frayProfile(res, mean);
    var spread = fanSpread(profile);
    var len = Math.max(1, lineLen);
    /* The gamma bends the curve the way the studio bar asks: a fan twice as
       tight as the zero point is not worth half the points, it is worth
       most of them, while a clean 55 has to be genuinely clean. */
    var frayFrac = clamp01(Math.pow(
      clamp01((spread / len - FRAY_FREE) / Math.max(1e-6, tol.frayZero - FRAY_FREE)), FRAY_GAMMA));
    var fray = 1 - frayFrac;
    var commit = 0;
    for (i = 0; i < strokes.length; i++) commit += commitment(strokes[i], tol.turnZero);
    commit /= strokes.length;
    var start = startCluster(presses, dot, tol.startZone);
    /* Guard, not a difficulty knob: four identical 20px stubs are a perfect
       fan by arithmetic and no line at all. Play cannot reach this — a
       repeat is only accepted once it covers MIN_COVER of the guide, well
       clear of COVER_GUARD — but the scoring must not be exploitable on its
       own terms, and a path with no length has no consistency to praise. */
    var cover = clamp01(polyLength(mean) / Math.max(1, COVER_GUARD * len));
    var score = (55 * fray + 30 * commit) * cover + 15 * start;
    if (!isFinite(score)) score = 0;
    return {
      score: Math.max(0, Math.min(100, score)),
      fray: fray, frayFrac: frayFrac, commit: commit, start: start, cover: cover,
      mean: mean, profile: profile, spread: spread
    };
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var s = avg(scores);
    return isFinite(s) ? Math.max(0, Math.min(100, s)) : 0;
  }

  /* The verdict names the fan, not the score. */
  function verdictWord(frayFrac) {
    if (frayFrac <= 0.28) return 'tight fan — confident';
    if (frayFrac <= 0.60) return 'close fan — the repeats mostly agree';
    return 'the repeats drift apart — slow down less, commit more';
  }

  /* The fan is the headline, but only 55 of the 100 points: 30 are
     commitment (no wobble, no mid-stroke correction) and 15 are starting
     on the dot. A tight fan of shaky lines used to read "tight fan —
     confident" next to a 76 with nothing on the sheet saying where the
     other 24 went. Name the weakest habit whenever it is the one costing
     the points — when fraying IS the weakest, verdictWord already said
     so and a second clause would only repeat it. */
  function setVerdict(frayFrac, commit, start) {
    var fan = verdictWord(frayFrac);
    var fray = 1 - clamp01(frayFrac);
    var c = clamp01(commit), s = clamp01(start);
    if (Math.min(fray, c, s) >= 0.8) return fan;
    if (c <= fray && c <= s) return fan + ', but the lines wobble — pull faster, never correct';
    if (s <= fray) return fan + ', but start on the dot every time';
    return fan;
  }

  /* Round-end coaching: name the weakest of the three habits. */
  function coachLine(fray, commit, start) {
    if (fray >= 0.8 && commit >= 0.8 && start >= 0.8) {
      return 'tight fans all round — try the long curve at speed.';
    }
    if (fray <= commit && fray <= start) {
      return 'your repeats drift apart — pick the end point, then commit to it.';
    }
    if (commit <= start) {
      return 'your lines wobble — pull faster, and never correct mid-stroke.';
    }
    return 'start on the dot every time — the dot is half the exercise.';
  }

  /* Normalized arc position (0–1) of the guide sample nearest to p. */
  function nearestArcS(path, p) {
    if (!path || path.length < 2) return 0;
    var best = Infinity, idx = 0, i, d;
    for (i = 0; i < path.length; i++) {
      d = (path[i].x - p.x) * (path[i].x - p.x) + (path[i].y - p.y) * (path[i].y - p.y);
      if (d < best) { best = d; idx = i; }
    }
    return idx / (path.length - 1);
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
  var btnFinish = document.getElementById('btnFinish');
  var btnUndo = document.getElementById('btnUndo');

  ArtDaily.init({ slug: SLUG });

  /* ---- eased tolerances, re-read on every use so a mid-session
     hardware change (pencil picked up, tablet plugged in) applies ---- */
  function startZone() { return ArtDaily.startRadius(START_BASE); }
  function endZone() { return Math.max(ArtDaily.startRadius(26), guide ? guide.len * 0.12 : 0); }
  function tolerances() {
    return {
      frayZero: ArtDaily.ease(FRAY_ZERO),
      turnZero: ArtDaily.ease(TURN_ZERO),
      startZone: startZone()
    };
  }

  /* ---- theme-aware inks (re-read on every repaint) ----
     accent is the airy wash used for the fraying envelope; accentInk is
     the AA-contrast variant for everything meaning-bearing (start dot,
     mean path, score). See the note above --game-accent-ink in style.css. */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim();
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
      accentInk: cs.getPropertyValue('--game-accent-ink').trim() || accent
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    /* taller sheet on phones so steep lines get room */
    H = Math.round(W * (W < 520 ? 0.92 : 0.62));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round state ---- */
  var round = 0, setIdx = 0, playing = false;
  var setScores = [], setStats = [];
  var guide = null, repeats = [], presses = [];
  var pending = [], pendingPress = null, pendingMissed = false, segStart = 0;
  var drawing = false, activePointer = null, activeType = '';
  var lastPenAt = -Infinity;
  var revealing = null, revealTimer = null, revealAt = 0;
  /* A tap on the sheet skips the reveal — but the reveal opens the instant
     the FOURTH repeat is lifted, and by then the player is in a rhythm of
     press-the-dot, pull, lift, press-the-dot. That next press is the rhythm,
     not a request to skip, and it was throwing away the one screen that
     shows the fraying envelope — which is the entire lesson of the drill.
     Presses inside this window are swallowed; the reveal still auto-advances
     on its own timer, so nothing can stall. */
  var SKIP_GUARD_MS = 600;
  /* the round's reported result, banked the moment the fourth set is scored —
     finishRound() is presentation only (see revealSet) */
  var roundResult = null;

  /* ---- where the round's four guide lines come from -------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS, and only that.
     Round 1 of a sitting is dealt from ArtDaily.roundRandom(1) — seeded off
     today and this slug — so every player gets the same four guides today and
     a score finally has a denominator. Round 2 and on are practice: same
     generator, same distribution, unshared seed.

     rand() is unchanged as a function — lo + u * (hi - lo), with Math.random
     swapped for the round's uniform — and that identity is the whole
     distribution argument: u is uniform on [0,1) either way, so every value
     downstream keeps exactly the shape it had. A seeded set is not an easier
     or a harder set, only a shared one.

     NO PER-SET CACHE IS NEEDED HERE, unlike lines. makeGuide() is called
     exactly once per set (newRound for set 0, nextStep for the rest) — a
     resize RESCALES the guide it already has rather than re-making it, see
     rescaleGeometry — so this rolling generator is never walked forward twice
     for the same guide. If makeGuide ever starts being called again for a set
     already on screen, it needs lines' cached-draws treatment first.

     THE SAME DRAWS ARE NOT THE SAME PIXELS: len is W * spec.frac and the
     offsets are drawn into whatever room the canvas has left over, so what is
     shared is WHERE IN THAT ROOM the line sits, not how many pixels from the
     edge. A phone and a desktop get the same round laid out for their sheet.

     Starts as Math.random so a draw made before the first newRound (there is
     none today) can never see a null. */
  var roundRng = Math.random;

  function rand(lo, hi) { return lo + roundRng() * (hi - lo); }

  function setLabel() {
    return 'set ' + Math.min(setIdx + 1, SETS_PER_ROUND) + ' of ' + SETS_PER_ROUND +
      ' · line ' + Math.min(repeats.length + 1, REPEATS_PER_SET) + ' of ' + REPEATS_PER_SET;
  }

  /* ---- the guide line: a quadratic bow, sampled by arc length so its
     length is exact ground truth for the fraying normaliser ---- */
  function quadSample(a, c, b, n) {
    var pts = [], i, t, u;
    for (i = 0; i <= n; i++) {
      t = i / n; u = 1 - t;
      pts.push({
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
      });
    }
    return pts;
  }

  function makeGuide(idx) {
    var spec = SET_SPECS[idx] || SET_SPECS[0];
    var margin = 34;
    var roomW = Math.max(40, W - 2 * margin);
    var roomH = Math.max(40, H - 2 * margin);
    var len = Math.min(W * spec.frac, roomW);
    var ang = (spec.ang + rand(-10, 10)) * Math.PI / 180;
    if (roundRng() < 0.4) ang += Math.PI;   /* some sets pull the other way */
    var a = { x: 0, y: 0 };
    var b = { x: Math.cos(ang) * len, y: Math.sin(ang) * len };
    var side = roundRng() < 0.5 ? -1 : 1;
    var nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side;
    var c = { x: (a.x + b.x) / 2 + nx * spec.bow * len, y: (a.y + b.y) / 2 + ny * spec.bow * len };
    var pts = quadSample(a, c, b, 48);

    var i, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, k;
    function bbox() {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (i = 0; i < pts.length; i++) {
        if (pts[i].x < minX) minX = pts[i].x;
        if (pts[i].x > maxX) maxX = pts[i].x;
        if (pts[i].y < minY) minY = pts[i].y;
        if (pts[i].y > maxY) maxY = pts[i].y;
      }
    }
    bbox();
    /* shrink a line that would not fit this canvas at this angle */
    k = Math.min(1, roomW / Math.max(1, maxX - minX), roomH / Math.max(1, maxY - minY));
    if (k < 1) {
      for (i = 0; i < pts.length; i++) { pts[i].x *= k; pts[i].y *= k; }
      bbox();
    }
    var ox = margin + rand(0, Math.max(0, roomW - (maxX - minX))) - minX;
    var oy = margin + rand(0, Math.max(0, roomH - (maxY - minY))) - minY;
    for (i = 0; i < pts.length; i++) { pts[i].x += ox; pts[i].y += oy; }

    var sampled = resampleByArc(pts, GUIDE_N);
    guide = {
      pts: sampled,
      a: { x: sampled[0].x, y: sampled[0].y },
      b: { x: sampled[sampled.length - 1].x, y: sampled[sampled.length - 1].y },
      len: polyLength(sampled)
    };
  }

  function newRound() {
    clearTimeout(revealTimer);
    revealTimer = null;
    /* A round whose fourth set is scored but still sitting on its reveal was
       already banked at that score — close it out on screen (coaching line and
       toast included) before the reset, so an impatient press is never a
       silent loss. */
    if (playing && roundResult) finishRound();
    round += 1;
    setIdx = 0;
    setScores = [];
    setStats = [];
    roundResult = null;
    repeats = [];
    presses = [];
    pending = [];
    pendingPress = null;
    pendingMissed = false;
    segStart = 0;
    drawing = false;
    activePointer = null;
    activeType = '';
    revealing = null;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. round is already 1 on the
       first round of a sitting, so round 1 is today's shared round and every
       "new round" after it is practice.

       GUARDED, and the guard is load-bearing. index.html cache-busts its own
       scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
       the two files cache INDEPENDENTLY and roundRandom is new: a returning
       visitor holding a warm SDK from another drill plus a cold copy of this
       file would call a function that does not exist, throw inside newRound()
       before the first guide is made, and sit on "Loading…" with a blank sheet.
       Falling back to Math.random costs today's player nothing but a
       non-comparable round, which is exactly what they had yesterday, and it
       self-heals when the SDK's max-age expires. */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    playing = true;
    makeGuide(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hint.textContent = setLabel() + ' — press the dot, pull one line to the ring, then draw the same line 3 more times.';
    updateButtons();
    draw();
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function drawPolyline(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawLabel(p, text, c, dy) {
    ctx.fillStyle = c;
    ctx.font = '800 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, Math.max(16, Math.min(W - 16, p.x)), Math.max(12, Math.min(H - 4, p.y + dy)));
  }

  function drawGuide(c) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 7]);
    drawPolyline(guide.pts);
    ctx.restore();
    /* the end ring: the thing to keep your eyes on */
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(guide.b.x, guide.b.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawLabel(guide.b, 'end', c.muted, guide.b.y > 30 ? -13 : 22);
  }

  function drawStartDot(c) {
    var z = startZone();
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(guide.a.x, guide.a.y, z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.accentInk;
    ctx.beginPath();
    ctx.arc(guide.a.x, guide.a.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(guide.a, 'start', c.ink, guide.a.y > 30 ? -13 : 22);
  }

  function drawRepeats(c) {
    var i;
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2.4;
    for (i = 0; i < repeats.length; i++) {
      ctx.globalAlpha = REPEAT_ALPHA[Math.min(i, REPEAT_ALPHA.length - 1)];
      drawPolyline(repeats[i]);
    }
    if (pending.length > 1) {
      ctx.globalAlpha = REPEAT_ALPHA[Math.min(repeats.length, REPEAT_ALPHA.length - 1)];
      drawPolyline(pending);
    }
    ctx.restore();
  }

  /* The 15 points nobody could see. startCluster() scores where the four
     presses actually LANDED against the dot, and setVerdict says "but
     start on the dot every time" — while the reveal took the dot off the
     sheet the moment it opened (draw() only paints it when !revealing).
     So the player was told to hit a target that was no longer shown, and
     was never shown which press had missed it. These are the raw press
     points startCluster was handed, against the same zone ring the drill
     asked for: the delta made visible, not just priced. */
  function drawStartMarks(c) {
    var i, p;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(guide.a.x, guide.a.y, startZone(), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    for (i = 0; i < presses.length; i++) {
      p = presses[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = c.accentInk;
    ctx.beginPath();
    ctx.arc(guide.a.x, guide.a.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* The reveal: the fraying envelope shaded around the player's own mean
     path, the mean path inked over it. */
  function drawReveal(c) {
    var m = revealing.mean, p = revealing.profile, tg = tangents(m), i, w;
    if (m.length > 2) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      for (i = 0; i < m.length; i++) {
        w = Math.max(1.2, p[i]);
        if (i === 0) ctx.moveTo(m[i].x - tg[i].y * w, m[i].y + tg[i].x * w);
        else ctx.lineTo(m[i].x - tg[i].y * w, m[i].y + tg[i].x * w);
      }
      for (i = m.length - 1; i >= 0; i--) {
        w = Math.max(1.2, p[i]);
        ctx.lineTo(m[i].x + tg[i].y * w, m[i].y - tg[i].x * w);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = c.accentInk;
    ctx.lineWidth = 2.5;
    drawPolyline(m);
    ctx.restore();

    drawStartMarks(c);

    /* the set score, on a little card so it reads over the fan */
    var label = String(revealing.score);
    var mid = m[Math.floor(m.length / 2)] || guide.a;
    var tx = Math.max(28, Math.min(W - 28, mid.x));
    var ty = Math.max(26, Math.min(H - 14, mid.y - 16));
    ctx.font = '900 16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    var tw = ctx.measureText(label).width + 16;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = c.card;
    ctx.fillRect(tx - tw / 2, ty - 15, tw, 22);
    ctx.restore();
    ctx.fillStyle = c.accentInk;
    ctx.fillText(label, tx, ty + 1);
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!guide) return;
    drawGuide(c);
    drawRepeats(c);
    if (revealing) drawReveal(c);
    if (playing && !revealing) drawStartDot(c);
  }

  /* ---- input: a repeat may take as many contacts as it takes ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: ev.timeStamp || 0 };
  }

  /* True when this press lands close enough to the last lift, soon enough
     after it, to be the same repeat carried on. Anything else is a fresh
     attempt: the dot and its ring are on screen the whole time, so
     pressing the dot again is the natural "start this line over" gesture
     and must not append a jump-back zigzag to the repeat in flight. */
  function isResume(p) {
    if (!pending.length) return false;
    var lift = pending[pending.length - 1];
    var gap = (p.t || 0) - (lift.t || 0);
    if (gap < 0 || gap > RESUME_MS) return false;
    return Math.hypot(p.x - lift.x, p.y - lift.y) <= ArtDaily.startRadius(RESUME_BASE);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (!playing) return;
    if (revealing) {
      /* tap-to-continue, but not the press that was already coming as part
         of the drill's own rhythm (see SKIP_GUARD_MS) */
      ev.preventDefault();
      if (Date.now() - revealAt < SKIP_GUARD_MS) return;
      clearTimeout(revealTimer);
      revealTimer = null;
      nextStep();
      return;
    }
    if (!guide) return;
    /* Palm rejection. A `drawing` guard on its own only ever rejects the
       SECOND contact — on a tablet the heel of the hand lands FIRST, so
       the nib was the one being ignored. A touch inside the pen's shadow
       is the hand resting on the glass; a nib that lands while a touch
       owns the repeat takes it over and the palm's drift is dropped. */
    if (ev.pointerType === 'touch' && Date.now() - lastPenAt < PEN_LOCK_MS) return;
    if (drawing) {
      if (ev.pointerType !== 'pen' || activeType === 'pen') return;
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
      pending.length = Math.min(pending.length, segStart);
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      drawing = false;
      activePointer = null;
      activeType = '';
    }
    var p = pointerPos(ev);
    var resuming = isResume(p);
    /* The snap is a courtesy for a near miss, not a teleport: a press
       further out than this is refused outright, so it can neither inject
       a full-length straight jump into a repeat nor silently wreck the
       one already in flight. */
    if (!resuming && Math.hypot(p.x - guide.a.x, p.y - guide.a.y) > startZone() * SNAP_MULT) {
      hint.textContent = setLabel() + ' — that was wide of the dot; press on or near it' +
        (pending.length ? ', or back where you lifted to carry on.' : ' to start the line.');
      draw();
      return;
    }
    ev.preventDefault();
    var restarted = false;
    if (!resuming && pending.length) {
      /* pressing the dot again means "start this line over" */
      pending = [];
      pendingPress = null;
      pendingMissed = false;
      restarted = true;
    }
    drawing = true;
    activePointer = ev.pointerId;
    activeType = ev.pointerType || '';
    segStart = pending.length;
    if (!pending.length) {
      /* First contact of a repeat: the ink ALWAYS begins on the dot. A
         near miss is snapped and told — the miss is scored (15 pts, start
         discipline), not refused, so nobody loses a line to a mis-click. */
      pendingPress = { x: p.x, y: p.y };
      pending.push({ x: guide.a.x, y: guide.a.y, t: p.t });
      pendingMissed = Math.hypot(p.x - guide.a.x, p.y - guide.a.y) > startZone();
      if (pendingMissed) {
        hint.textContent = setLabel() + ' — started you from the dot; press inside the dashed ring next time.';
      } else if (restarted) {
        hint.textContent = setLabel() + ' — starting that line over from the dot.';
      }
    } else {
      pending.push(p);
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    updateButtons();
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    /* coalesced events: full-fidelity sampling of fast strokes */
    var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
    if (evs && evs.length) {
      for (var i = 0; i < evs.length; i++) pending.push(pointerPos(evs[i]));
    } else {
      pending.push(pointerPos(ev));
    }
    draw();
  });

  /* The straight jump the snap injects from the press onto the dot is a
     courtesy, not ink the player pulled — so it must not pay for the
     coverage test. Without this, a press near the end ring plus a wiggle
     is "45% of the guide" on arithmetic alone and banks a whole repeat
     that consists of nothing but the jump. */
  function drawnLength() {
    var snap = (guide && pendingPress)
      ? Math.hypot(pendingPress.x - guide.a.x, pendingPress.y - guide.a.y) : 0;
    return Math.max(0, polyLength(pending) - snap);
  }

  /* Enough ink to be a line at all, and enough of the guide covered that
     a stub cannot be passed off as a repeat. */
  function canFinish() {
    return !!guide && pending.length >= MIN_SAMPLES && drawnLength() >= MIN_COVER * guide.len;
  }

  /* Auto-finish when the hand arrives: at the end ring, or having tracked
     nearly the whole guide (an overshoot still counts). */
  function reachedEnd() {
    if (!canFinish()) return false;
    var last = pending[pending.length - 1];
    if (Math.hypot(last.x - guide.b.x, last.y - guide.b.y) <= endZone()) return true;
    return nearestArcS(guide.pts, last) >= 0.9;
  }

  function endContact(ev) {
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    drawing = false;
    activePointer = null;
    activeType = '';
    if (pending.length - segStart < MIN_SEGMENT) {
      /* a tap, not a stroke — drop just this contact, free, always */
      pending.length = segStart;
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      hint.textContent = setLabel() + ' — that was a tap; press the dot and pull toward the ring.';
      updateButtons();
      draw();
      return;
    }
    if (reachedEnd()) { finishRepeat(); return; }
    hint.textContent = setLabel() + (canFinish()
      ? ' — lift and carry on from where you stopped, or press “finish line”.'
      : ' — lift and carry on from where you stopped; “undo line” starts this one over.');
    updateButtons();
    draw();
  }
  canvas.addEventListener('pointerup', endContact);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', endContact);

  function cancelContact(ev) {
    /* interrupted contact (system gesture etc.) — keep the ink already
       drawn, end the contact, no penalty */
    if (!drawing || ev.pointerId !== activePointer) return;
    drawing = false;
    activePointer = null;
    activeType = '';
    if (pending.length - segStart < MIN_SEGMENT) {
      pending.length = segStart;
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
    }
    if (playing && !revealing) hint.textContent = setLabel() + ' — stroke interrupted; carry on or press “finish line”.';
    updateButtons();
    draw();
  }
  canvas.addEventListener('pointercancel', cancelContact);
  window.addEventListener('pointercancel', cancelContact);
  /* iOS can drop the capture with NO pointerup and NO pointercancel. Without
     this the contact never ends: `drawing` stays true, every later press is
     refused by the one-contact-at-a-time guard, and the repeat can neither be
     carried on nor started over. lostpointercapture always fires on the
     capturing element, and after a normal pointerup it is a no-op. */
  canvas.addEventListener('lostpointercapture', cancelContact);

  function finishRepeat() {
    repeats.push(pending);
    presses.push(pendingPress || { x: guide.a.x, y: guide.a.y });
    var missed = pendingMissed;
    pending = [];
    pendingPress = null;
    pendingMissed = false;
    segStart = 0;
    if (repeats.length >= REPEATS_PER_SET) { revealSet(); return; }
    hint.textContent = setLabel() + ' — same line again, from the dot.' +
      (missed ? ' That one started off the dot — press on it.' : ' Don’t correct it.');
    updateButtons();
    draw();
  }

  function revealSet() {
    var res = scoreSet(repeats, presses, guide.a, guide.len, tolerances());
    setScores.push(res.score);
    setStats.push({ fray: res.fray, commit: res.commit, start: res.start });
    revealing = {
      mean: res.mean,
      profile: res.profile,
      score: Math.round(res.score),
      verdict: setVerdict(res.frayFrac, res.commit, res.start)
    };
    revealAt = Date.now();
    if (setScores.length >= SETS_PER_ROUND && !roundResult) {
      /* The round is complete NOW — report before the reveal plays out, so
         "new round" (or the embed player closing the tab) during that 2.4s
         hold can never swallow four played sets. finishRound() is
         presentation only; this is the single report site. */
      roundResult = ArtDaily.report(roundScore(setScores));
      hudScore.textContent = String(roundResult.score);
      hudBest.textContent = roundResult.best === null ? '–' : String(roundResult.best);
    }
    hint.textContent = 'set ' + (setIdx + 1) + ' — ' + revealing.score + ' · ' + revealing.verdict +
      (setIdx === 0
        ? '. The band is your spread, the sky line your own average, the small rings are where you actually pressed. Tap for the next set.'
        : '. Tap for the next set.');
    updateButtons();
    draw();
    clearTimeout(revealTimer);
    revealTimer = null;
    revealTimer = setTimeout(nextStep, REVEAL_MS);
  }

  function nextStep() {
    clearTimeout(revealTimer);
    revealTimer = null;
    if (!revealing) return;
    setIdx += 1;
    /* the last set keeps its reveal painted — a round should end on the
       lesson, not on a blank sheet */
    if (setIdx >= SETS_PER_ROUND) { finishRound(); return; }
    revealing = null;
    repeats = [];
    presses = [];
    pending = [];
    pendingPress = null;
    pendingMissed = false;
    segStart = 0;
    makeGuide(setIdx);
    hint.textContent = setLabel() + ' — new line' + (setIdx >= 2 ? ' (curved now)' : '') + ': press the dot and pull to the ring.';
    updateButtons();
    draw();
  }

  /* Presentation only: revealSet() already reported the round the instant the
     fourth set was scored, so every completed round reaches ArtDaily.report
     exactly once — even if this never runs. */
  function finishRound() {
    if (!playing) return;
    playing = false;
    var res = roundResult;
    if (res) {
      hudScore.textContent = String(res.score);
      hudBest.textContent = res.best === null ? '–' : String(res.best);
    }
    var fray = 0, commit = 0, start = 0, i;
    for (i = 0; i < setStats.length; i++) {
      fray += setStats[i].fray; commit += setStats[i].commit; start += setStats[i].start;
    }
    if (setStats.length) { fray /= setStats.length; commit /= setStats.length; start /= setStats.length; }
    hint.textContent = 'round done — ' + coachLine(fray, commit, start) + ' Press “new round” to go again.';
    updateButtons();
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

  function updateButtons() {
    var live = playing && !revealing;
    btnFinish.disabled = !(live && canFinish());
    btnUndo.disabled = !(live && (pending.length > 0 || repeats.length > 0));
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

  btnFinish.addEventListener('click', function () {
    if (drawing || !playing || revealing || !canFinish()) return;
    finishRepeat();
  });

  btnUndo.addEventListener('click', function () {
    if (drawing || !playing || revealing) return;
    if (pending.length) {
      pending = [];
      pendingPress = null;
      pendingMissed = false;
      segStart = 0;
      hint.textContent = setLabel() + ' — cleared. Start again from the dot.';
    } else if (repeats.length) {
      repeats.pop();
      presses.pop();
      hint.textContent = setLabel() + ' — last line removed. Draw it again.';
    }
    updateButtons();
    draw();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  /* hardware swapped mid-session: the start zone and the tolerances move,
     so repaint the ring the player is being asked to hit */
  ArtDaily.onInput(function () { draw(); });

  /* setTimeout keeps firing while the page is hidden, so a notification or
     an app switch during the 2.4s reveal used to advance to the next set
     behind the player's back — and that reveal is the only place this drill
     ever shows the fraying envelope, the player's own mean line and the
     small rings marking where they actually pressed, which between them are
     the entire lesson. Park the beat while hidden and hand it back in full.

     Nothing can be lost by parking it: revealSet() reports a finished round
     synchronously the moment the fourth set is scored, so this beat only
     ever advances a SET or plays the closing screen. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (playing && revealing && revealTimer === null) {
      /* the beat starts over, and so does the guard that stops the
         returning press from being read as "skip this" */
      revealAt = Date.now();
      revealTimer = setTimeout(nextStep, REVEAL_MS);
    }
  });

  /* Everything drawn is in CSS pixels placed against the old canvas box, so
     a resize has to carry it across or the guide, the fan and the reveal
     strand themselves off-sheet. */
  function scalePoint(p, sx, sy) { p.x *= sx; p.y *= sy; }
  function scalePoints(pts, sx, sy) {
    for (var i = 0; i < pts.length; i++) scalePoint(pts[i], sx, sy);
  }
  function rescaleGeometry(sx, sy) {
    var i, k = (sx + sy) / 2;
    if (guide) {
      scalePoints(guide.pts, sx, sy);
      scalePoint(guide.a, sx, sy);
      scalePoint(guide.b, sx, sy);
      guide.len = polyLength(guide.pts);
    }
    for (i = 0; i < repeats.length; i++) scalePoints(repeats[i], sx, sy);
    for (i = 0; i < presses.length; i++) scalePoint(presses[i], sx, sy);
    scalePoints(pending, sx, sy);
    if (pendingPress) scalePoint(pendingPress, sx, sy);
    if (revealing) {
      scalePoints(revealing.mean, sx, sy);
      for (i = 0; i < revealing.profile.length; i++) revealing.profile[i] *= k;
    }
  }

  window.addEventListener('resize', function () {
    var oldW = W, oldH = H;
    fitCanvas();
    if (W === oldW && H === oldH) { draw(); return; }
    if (drawing) {
      /* the sheet rescaled under an in-flight contact (rotation) — drop
         just that contact, no penalty; the repeat so far survives */
      drawing = false;
      activePointer = null;
      activeType = '';
      pending.length = Math.min(pending.length, segStart);
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      if (playing && !revealing) hint.textContent = setLabel() + ' — screen changed; carry on from the dot.';
    }
    if (oldW > 0 && oldH > 0) rescaleGeometry(W / oldW, H / oldH);
    updateButtons();
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
