/* ============================================================
   game.js — Cylinder Ends.

   A cylinder is drawn for you in wireframe except one thing: its far
   end is still a flat line. Drag the dot out along the barrel until
   that end is as round as it really is, then lock it in. Four
   cylinders, then a score.

   The lesson is the one thing every beginner gets wrong about a
   cylinder: the far end is ALWAYS rounder than the near end — never
   flatter, never the same — because the further a circle sits from the
   eye, the more face-on the eye sees it. Boxes have seven drills in this
   arcade; the other half of the beginner's form vocabulary had none.

   REAL 3D, not a flat guess. The scene is a real cylinder — two circles
   of radius r on a real axis — seen by a real pinhole eye at the origin
   looking down +z, image plane at z = 1. The projection of a circle
   through a pinhole is a conic, and the cone of rays through the circle
   is v'Qv = 0 with Q = d²I − d(nc' + cn') + (|c|² − r²)nn'. Read that
   same matrix at v = (x, y, 1) and you have the image ellipse exactly:
   centre, both semi-axes and the tilt, correct by construction rather
   than approximately right. The barrel's two edges are the true
   silhouette of the surface (the ring angle where the surface normal is
   perpendicular to the eye ray), not a guessed tangent. So the answer
   the reveal draws is the answer, and the scoring has an exact ground
   truth to be pure about.

   Everything the round remembers lives in IMAGE space — the normalised
   coordinates of that camera — and the scored quantity is a RATIO
   (height over width of the far end). Neither depends on the canvas, so
   a phone rotated mid-item, or mid-reveal, cannot move the answer, the
   mark or the scale it was measured against.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'cylinder-ends';
  var ITEMS_PER_ROUND = 4;
  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnLock = document.getElementById('btnLock');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     SCORING — pure functions, no canvas, no DOM, no state, so they
     lift straight into node and can be hammered with degenerate input.
     Every one is finite 0–100 for ANY argument and monotonic in the
     error: more wrong can never score higher.
     ============================================================ */

  /* The tolerance is a RATIO, not a pixel count: the whole judgement is
     "how tall is this end compared to how wide", which is the same
     question on a 320px phone and a 780px desktop. Eased through the SDK
     so an honest attempt reads as an honest attempt on the hardware the
     player actually owns — 0.18 on a pen, 0.36 on a trackpad, 0.27 on a
     finger. Calibrated against what the drill is teaching: copying the
     near end's roundness onto the far one — the classic mistake, a miss
     of 0.20 at the very least and more often 0.30 — has to score badly on
     every profile, and it does: 0 on a pen, 44 at the most generous end of
     a trackpad, 26 on a finger, and 0/11/0 on a typical cylinder. */
  var DEG_TOL = 0.18;

  /* …with a PIXEL floor under it, because a ratio tolerance alone hands a
     phone a stricter drill than a desktop for the identical judgement.
     The far end's half-width is about 115px on a 780px sheet and about
     55px on a 360px one, so the same 0.27 of ratio is 31px of drag on the
     desktop and 15px on the phone — the hand's own noise then costs a
     finger twice what it costs a trackpad. This is a slack in PIXELS of
     drag, eased from its own base (never from DEG_TOL — the two measure
     different things and feeding one into the other compounds the
     profile factors). It only bites below roughly a 400px sheet; above
     that the ratio tolerance is already the wider of the two. */
  var FLOOR_PX = 11;
  /* and a hard ceiling, so a pathologically small sheet cannot widen the
     zero-point until wild answers start scoring */
  var MAX_ZERO = 0.45;

  /* How far the handle can be dragged, as a multiple of the far end's
     half-width. Past 1.0 the end is taller than it is wide, which is
     never right for a cylinder receding from the eye — but it must stay
     REACHABLE, because the outer edge of the tolerance band has to be
     drawable and a player must be able to be obviously wrong in both
     directions. Also the reason the layout is fitted at this ratio and
     not at the live one: the drawing must not rescale under the hand
     while it is being dragged. */
  var MAX_RATIO = 1.45;

  /* 100 when the far end is exactly as round as it is, fading to 0 at
     `zero` of ratio out or beyond. `zero` comes from ArtDaily.ease(),
     never from a raw constant. */
  function ellipseScore(playerRatio, trueRatio, zero) {
    var p = Number(playerRatio), t = Number(trueRatio), z = Number(zero);
    if (!isFinite(p) || !isFinite(t)) return 0;
    if (!isFinite(z) || z <= 0) return 0;
    var v = (1 - Math.abs(p - t) / z) * 100;
    return v < 0 ? 0 : v > 100 ? 100 : v;
  }

  /* Mean of the round's ends. A round that somehow ends with nothing
     recorded scores 0 rather than 0/0 = NaN. */
  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0;
    for (var i = 0; i < scores.length; i++) {
      var s = Number(scores[i]);
      sum += isFinite(s) ? Math.max(0, Math.min(100, s)) : 0;
    }
    return sum / scores.length;
  }

  /* ---- the reveal, in words (pure too, and held to the same bar) ----
     A bare number teaches nothing on the round that matters most: nobody
     can tell 58 from 72 by feel, and neither says which way to move.
     "A little too flat" is a correction the player can make on the very
     next cylinder. Graded against the SAME zero-point the score uses,
     with the bands cut where the SCORE changes character rather than at
     tidy fractions of the tolerance — the adjective is printed in the
     same sentence as the number, so a ladder skewed to the good end
     would quietly lie. As scores these edges are:
       92+ spot on · 75+ a hair · 50+ a little · 20+ much · under 20 way. */
  function missPhrase(diff, zero) {
    var d = Number(diff);
    if (!isFinite(d)) return 'Off the mark';
    var z = (isFinite(zero) && zero > 0) ? zero : 1;
    var e = Math.abs(d);
    if (e <= z * 0.08) return 'Spot on';
    var dir = d < 0 ? 'too flat' : 'too round';
    if (e >= z * 0.8) return 'Way ' + dir;
    return (e <= z * 0.25 ? 'A hair ' : e <= z * 0.5 ? 'A little ' : 'Much ') + dir;
  }

  /* The one correction that is worth more than any number here, said only
     when the player actually made that mistake: an end drawn no rounder
     than the near one is not a near miss, it is the rule being broken.
     The mirror case — an end opened all the way to a circle — gets named
     too, because a circle means "pointing straight at the eye" and that
     is a different cylinder from the one on the sheet. Pure and total:
     junk in, '' out, which the caller treats as silence. */
  function nearNote(playerRatio, nearRatio, trueRatio) {
    var p = Number(playerRatio), n = Number(nearRatio), t = Number(trueRatio);
    if (!isFinite(p) || !isFinite(n) || !isFinite(t)) return '';
    if (t > n && p <= n + 0.02) return 'That end came out no rounder than the near one — a far end always opens up.';
    if (p >= 0.97 && t <= 0.9) return 'That reads as a full circle, which is an end aimed straight at you.';
    return '';
  }

  /* ---- the round's lesson, which no single cylinder can show ----
     Four ends that all came out too flat are not four misses, they are
     one habit, and naming it is the only correction that outlives the
     round. Fires only on a lean that is BOTH consistent (most ends the
     same way) and big enough to be worth aiming off (a tenth of the
     tolerance), so it can never invent a pattern out of noise, and the
     count must agree with the mean or two wild misses one way would
     outvote three small ones the other. */
  function roundBias(diffs, zero) {
    if (!diffs || !diffs.length) return '';
    var z = (isFinite(zero) && zero > 0) ? zero : 1;
    var n = 0, sum = 0, flat = 0, fat = 0;
    for (var i = 0; i < diffs.length; i++) {
      var d = Number(diffs[i]);
      if (!isFinite(d)) continue;
      n++; sum += d;
      if (d < 0) flat++; else if (d > 0) fat++;
    }
    if (n < 3) return '';            /* too few to call anything a habit */
    var mean = sum / n;
    if (Math.abs(mean) < z * 0.1) return '';
    var most = Math.max(2, Math.ceil(n * 0.6));
    if (mean < 0) return flat >= most ? 'Most far ends leaned flat — open them wider next round.' : '';
    return fat >= most ? 'Most far ends leaned round — hold them flatter next round.' : '';
  }

  /* ============================================================
     THE SCENE — real circles, a real pinhole eye, exact ellipses.
     Pure: numbers in, numbers out, and null for anything degenerate
     rather than a throw or a NaN leaking into the round.
     ============================================================ */

  /* The image ellipse of the 3D circle (centre c, unit normal n, radius
     r) seen from the eye at the origin, image plane z = 1. Returns
     centre, semi-major `a` along the unit vector (ax, ay), semi-minor
     `b` along (bx, by) — or null if the circle does not project to a
     bounded ellipse (plane through the eye, eye inside the circle's
     cone, anything non-finite). Derivation in the file header. */
  function circleEllipse(c, n, r) {
    if (!c || !n) return null;
    var c0 = Number(c[0]), c1 = Number(c[1]), c2 = Number(c[2]);
    var n0 = Number(n[0]), n1 = Number(n[1]), n2 = Number(n[2]);
    var rr = Number(r);
    if (!isFinite(c0) || !isFinite(c1) || !isFinite(c2)) return null;
    if (!isFinite(n0) || !isFinite(n1) || !isFinite(n2)) return null;
    if (!isFinite(rr) || rr <= 0) return null;

    var d = c0 * n0 + c1 * n1 + c2 * n2;
    var k = c0 * c0 + c1 * c1 + c2 * c2 - rr * rr;
    var A = d * d - 2 * d * n0 * c0 + k * n0 * n0;
    var B = -d * (n0 * c1 + c0 * n1) + k * n0 * n1;
    var C = d * d - 2 * d * n1 * c1 + k * n1 * n1;
    var D = -d * (n0 * c2 + c0 * n2) + k * n0 * n2;
    var E = -d * (n1 * c2 + c1 * n2) + k * n1 * n2;
    var F = d * d - 2 * d * n2 * c2 + k * n2 * n2;

    var det = A * C - B * B;
    if (!isFinite(det) || det <= 1e-12) return null;      /* not an ellipse */
    var x0 = (B * E - C * D) / det, y0 = (B * D - A * E) / det;
    if (!isFinite(x0) || !isFinite(y0)) return null;
    var Fp = F + D * x0 + E * y0;
    var disc = Math.sqrt((A - C) * (A - C) + 4 * B * B);
    var l1 = (A + C + disc) / 2, l2 = (A + C - disc) / 2;
    var s1 = -Fp / l1, s2 = -Fp / l2;                     /* squared semi-axes */
    if (!(s1 > 0) || !(s2 > 0)) return null;
    s1 = Math.sqrt(s1); s2 = Math.sqrt(s2);               /* s2 >= s1: s2 is major */
    /* eigenvector of the SMALLER eigenvalue is the major axis */
    var vx, vy;
    if (Math.abs(B) > 1e-14) { vx = B; vy = l2 - A; }
    else if (A <= C) { vx = 1; vy = 0; }
    else { vx = 0; vy = 1; }
    var vl = Math.hypot(vx, vy);
    if (!(vl > 0) || !isFinite(s1) || !isFinite(s2)) return null;
    vx /= vl; vy /= vl;
    return { cx: x0, cy: y0, a: s2, b: s1, ax: vx, ay: vy, bx: -vy, by: vx };
  }

  /* The whole drawable cylinder in image space: both end ellipses, the
     two barrel edges, the two roundness ratios, and the bounding box the
     canvas fit uses. Null for any parameter set that does not make a
     legible cylinder in front of the eye. */
  function buildCylinder(it) {
    if (!it) return null;
    var slant = Number(it.slant), roll = Number(it.roll);
    var L = Number(it.L), r = Number(it.r);
    var mx = Number(it.ox), my = Number(it.oy), mz = Number(it.dist);
    if (!isFinite(slant) || !isFinite(roll) || !isFinite(L) || !isFinite(r)) return null;
    if (!isFinite(mx) || !isFinite(my) || !isFinite(mz)) return null;
    if (!(L > 0) || !(r > 0) || !(mz > 0)) return null;

    var nx = Math.sin(slant) * Math.cos(roll);
    var ny = Math.sin(slant) * Math.sin(roll);
    var nz = Math.cos(slant);
    var nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-9)) return null;
    nx /= nl; ny /= nl; nz /= nl;
    /* point the axis from the near end toward the far one */
    if (mx * nx + my * ny + mz * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    var n = [nx, ny, nz];
    var cNear = [mx - L * nx, my - L * ny, mz - L * nz];
    var cFar = [mx + L * nx, my + L * ny, mz + L * nz];
    /* the whole solid has to sit well in front of the eye */
    if (!(cNear[2] - r > 1) || !(cFar[2] - r > 1)) return null;

    var eNear = circleEllipse(cNear, n, r);
    var eFar = circleEllipse(cFar, n, r);
    if (!eNear || !eFar) return null;
    if (!(eNear.a > 0) || !(eFar.a > 0)) return null;

    /* the barrel's edges: the two ring angles where the surface normal is
       perpendicular to the eye ray. cos(t)(u·c) + sin(t)(w·c) + r = 0,
       and it is independent of where along the axis you stand — which is
       exactly why the silhouette of a cylinder is two straight lines. */
    var pl = Math.hypot(ny, nx);
    var u = pl > 1e-6 ? [ny / pl, -nx / pl, 0] : [1, 0, 0];
    var w = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
    var pu = u[0] * cNear[0] + u[1] * cNear[1] + u[2] * cNear[2];
    var pw = w[0] * cNear[0] + w[1] * cNear[1] + w[2] * cNear[2];
    var R = Math.hypot(pu, pw);
    if (!(R > r * 1.05)) return null;                 /* eye too close to the surface */
    var phi = Math.atan2(pw, pu);
    var half = Math.acos(Math.max(-1, Math.min(1, -r / R)));
    if (!isFinite(phi) || !isFinite(half)) return null;

    function ringPoint(c, t) {
      var ct = Math.cos(t), st = Math.sin(t);
      var z = c[2] + r * (ct * u[2] + st * w[2]);
      if (!(z > 0.2)) return null;
      return [(c[0] + r * (ct * u[0] + st * w[0])) / z,
              (c[1] + r * (ct * u[1] + st * w[1])) / z];
    }
    var body = [];
    for (var s = 0; s < 2; s++) {
      var t = phi + (s ? -half : half);
      var p1 = ringPoint(cNear, t), p2 = ringPoint(cFar, t);
      if (!p1 || !p2) return null;
      body.push([p1[0], p1[1], p2[0], p2[1]]);
    }

    /* the far end's minor axis, pointed AWAY from the near end: this is
       the direction the handle travels, so "drag outward" always opens
       the end whichever way the cylinder happens to lie on the sheet. */
    var mxv = eFar.bx, myv = eFar.by;
    if (mxv * (eFar.cx - eNear.cx) + myv * (eFar.cy - eNear.cy) < 0) { mxv = -mxv; myv = -myv; }

    var far = { cx: eFar.cx, cy: eFar.cy, a: eFar.a, ax: eFar.ax, ay: eFar.ay, mx: mxv, my: myv };
    var near = { cx: eNear.cx, cy: eNear.cy, a: eNear.a, b: eNear.b,
                 ax: eNear.ax, ay: eNear.ay, bx: eNear.bx, by: eNear.by };

    /* Bounding box at the WIDEST the far end can ever be dragged, so the
       fit is settled before the hand touches it and the drawing cannot
       breathe in and out under the drag. */
    var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    function grow(x, y) {
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
    function growEllipse(e, aa, bb, bx, by) {
      var hx = Math.hypot(aa * e.ax, bb * bx), hy = Math.hypot(aa * e.ay, bb * by);
      grow(e.cx - hx, e.cy - hy);
      grow(e.cx + hx, e.cy + hy);
    }
    growEllipse(near, near.a, near.b, near.bx, near.by);
    growEllipse(far, far.a, far.a * MAX_RATIO, far.mx, far.my);
    for (var i = 0; i < body.length; i++) { grow(body[i][0], body[i][1]); grow(body[i][2], body[i][3]); }
    if (!isFinite(box.x0) || !isFinite(box.y0) || !isFinite(box.x1) || !isFinite(box.y1)) return null;
    if (!(box.x1 - box.x0 > 1e-9) || !(box.y1 - box.y0 > 1e-9)) return null;

    return {
      near: near, far: far, body: body, box: box,
      nearRatio: eNear.b / eNear.a,
      trueRatio: eFar.b / eFar.a,
      sep: Math.hypot(eFar.cx - eNear.cx, eFar.cy - eNear.cy),
    };
  }

  /* What makes a cylinder worth drilling on, checked on every candidate
     rather than assumed from the parameter ranges: both ends legible
     (neither a bare line nor already a circle), a roundness jump big
     enough that judging it is the exercise, real diminution down the
     barrel, and the two ends far enough apart on the sheet to read as a
     cylinder instead of two rings. */
  function usable(g) {
    if (!g) return false;
    if (!(g.nearRatio >= 0.16 && g.nearRatio <= 0.62)) return false;
    if (!(g.trueRatio >= 0.55 && g.trueRatio <= 0.9)) return false;
    /* The jump from near to far is the whole exercise, so a cylinder that
       barely has one is not an easy item, it is a pointless one: at a jump
       of 0.15 the right answer and the classic mistake (copying the near
       end's roundness) are close enough that a trackpad scores 58 for the
       mistake. At 0.20 the two are properly apart on every profile. */
    if (!(g.trueRatio - g.nearRatio >= 0.2)) return false;
    var shrink = g.far.a / g.near.a;
    if (!(shrink >= 0.55 && shrink <= 0.93)) return false;
    if (!(g.sep >= g.near.a * 1.5)) return false;
    /* The sheet is half again as wide as it is tall, so a barrel standing
       on end is fitted by its HEIGHT and lands at a quarter of the width
       — a small drawing to judge and a small distance to drag. Asked of
       the image-space box rather than of the canvas, so the answer cannot
       change when a phone is rotated mid-item. */
    if (!((g.box.x1 - g.box.x0) >= (g.box.y1 - g.box.y0))) return false;
    return true;
  }

  /* The ramp lives INSIDE the round. Cylinder one is the friendly one: a
     can lying roughly level, seen from a comfortable distance, at the
     slant where both ends read clearly — a beginner's first item should
     never be the drill's hardest view. From there the eye drops closer
     and the barrel lengthens, which is where the roundness jump gets
     big enough to be genuinely hard to call. */
  /* `tilt` is how far off level the barrel may lean on the sheet, in
     radians. It stays under a right angle on purpose: a barrel running
     with the sheet is the drawing that fills it, and the drag then runs
     along the sheet's long side, which is the one direction a trackpad
     has room for. */
  var PLAN = [
    { slant: [48, 57], dist: [8.2, 9.4], len: [1.70, 2.05], rad: [0.95, 1.12], tilt: 0.34 },
    { slant: [43, 60], dist: [7.4, 8.9], len: [1.80, 2.35], rad: [0.85, 1.06], tilt: 0.72 },
    { slant: [40, 63], dist: [7.0, 8.4], len: [2.00, 2.60], rad: [0.80, 1.00], tilt: 0.84 },
    { slant: [38, 67], dist: [6.6, 8.1], len: [2.10, 2.80], rad: [0.75, 0.98], tilt: 0.84 },
  ];

  /* Verified good, and the answer to "what if 80 random draws all miss":
     a real cylinder, never a dead round. */
  var FALLBACK = { slant: 54 * D2R, roll: 0.18, dist: 8.4, ox: 0.25, oy: -0.18, r: 1.0, L: 1.95 };

  function rr(range) { return range[0] + Math.random() * (range[1] - range[0]); }

  function makeGeometry(idx) {
    var plan = PLAN[Math.max(0, Math.min(PLAN.length - 1, idx | 0))] || PLAN[0];
    for (var tries = 0; tries < 80; tries++) {
      /* which way the far end lies is a coin flip — a drill whose answer
         is always dragged to the right teaches the hand, not the eye */
      var roll = (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() * 2 - 1) * plan.tilt;
      var g = buildCylinder({
        slant: rr(plan.slant) * D2R,
        roll: roll,
        dist: rr(plan.dist),
        ox: (Math.random() * 2 - 1) * 0.9,
        oy: (Math.random() * 2 - 1) * 0.7,
        r: rr(plan.rad),
        L: rr(plan.len),
      });
      if (usable(g)) return g;
    }
    return buildCylinder(FALLBACK);
  }

  /* ---- theme-aware inks (read once per THEME, not once per repaint) ----
     Every one of these is a custom property on :root and the only thing
     that moves them is data-theme, so a read per theme is the same answer
     as a read per repaint minus a forced style recalculation — and this
     drill repaints on every pointer sample of a drag, which is exactly
     where a player feels the hand stop being listened to. An empty read
     (stylesheet not parsed yet on a cold boot) is never cached.
     `mark` is --canvas-accent: the accent mixed toward the ink, because
     the watercolour wash is decorative-strength on paper and the far end
     the player is drawing carries meaning. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim();
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
    /* Taller than the template's 0.62. The barrel runs with the sheet, so
       the fit is settled by the HEIGHT, and the height is what decides how
       many pixels of drag one step of roundness is worth — on a phone the
       difference between 0.62 and 0.66 is 15px of extra travel. */
    H = Math.max(1, Math.round(W * 0.66));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ----
     `geo` is image space and `ratio` is a ratio, so nothing here is
     measured in pixels: rotating a phone mid-item re-fits the drawing and
     leaves the answer, the attempt and the tolerance exactly where they
     were. The same is true of `reveal`, which outlives the item — the
     number printed under it and the scale it was measured against are
     both history, and history does not get re-judged. */
  var round = 0, itemIdx = 0, scores = [], diffs = [];
  var geo = null, ratio = 0, playing = false, phase = 'aim';
  var reveal = null, revealTimer = null;
  /* Long enough to read the truth over your own end, short enough that
     four of them do not turn a coffee-break drill into a slideshow. */
  var REVEAL_MS = 850;

  /* The drill's own reference size for the drag handle. startRadius sizes
     what the hand has to ACQUIRE (a screenless tablet aims with the hand
     out of sight, so it gets the biggest zone); ease sizes where the
     SCORE runs out, and ranks the hardware the other way round. They are
     never fed into each other — 22 here is 44px across on a mouse, 70 on
     a finger, 74 on a pen tablet, so the touch minimum is already
     cleared without a coarse-pointer floor of its own. */
  var BASE_R = 22;
  function grabRadius() { return ArtDaily.startRadius(BASE_R); }

  /* The zero-point for THIS sheet: the wider of the ratio tolerance and
     the pixel floor, capped. `p` is the current placement, so the floor
     can be expressed against the far end's real half-width; called
     without one it falls back to the ratio tolerance alone. */
  function zeroPoint(p) {
    var z = ArtDaily.ease(DEG_TOL);
    if (!isFinite(z) || z <= 0) z = DEG_TOL;
    var A = (p && geo) ? geo.far.a * p.s : 0;
    if (isFinite(A) && A >= 1) {
      var floor = ArtDaily.ease(FLOOR_PX) / A;
      if (isFinite(floor) && floor > z) z = floor;
    }
    return Math.min(z, MAX_ZERO);
  }

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
  }

  /* ---- image space → canvas, recomputed from the canvas each paint ---- */
  /* A fixed 30px margin is a twelfth of a desktop sheet and a sixth of a
     phone's, so the phone paid twice over: a smaller drawing to judge AND
     a shorter rail to drag. */
  function pad() { return Math.max(12, Math.min(28, W * 0.045)); }
  function placement() {
    if (!geo) return null;
    var b = geo.box;
    var P = pad();
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var aw = Math.max(24, W - P * 2), ah = Math.max(24, H - P * 2);
    var s = Math.min(bw > 1e-9 ? aw / bw : 1, bh > 1e-9 ? ah / bh : 1);
    if (!isFinite(s) || s <= 0) s = 1;
    return { s: s, ox: W / 2 - (b.x0 + b.x1) / 2 * s, oy: H / 2 - (b.y0 + b.y1) / 2 * s };
  }

  function handleAt(p, rt) {
    var A = geo.far.a * p.s;
    return {
      x: geo.far.cx * p.s + p.ox + geo.far.mx * A * rt,
      y: geo.far.cy * p.s + p.oy + geo.far.my * A * rt,
    };
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function ellipsePath(cx, cy, rx, ry, ax, ay) {
    ctx.beginPath();
    if (ctx.ellipse) {
      ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), Math.atan2(ay, ax), 0, TAU);
      return;
    }
    var bx = -ay, by = ax;
    for (var i = 0; i <= 64; i++) {
      var t = i / 64 * TAU, ct = Math.cos(t) * rx, st = Math.sin(t) * ry;
      var x = cx + ct * ax + st * bx, y = cy + ct * ay + st * by;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  /* The far end at a given roundness — a straight line when it is flat,
     which is both the honest picture and what a degenerate ellipse would
     have drawn anyway. */
  function strokeFarEnd(p, rt, colour, width, dash) {
    var cx = geo.far.cx * p.s + p.ox, cy = geo.far.cy * p.s + p.oy;
    var A = geo.far.a * p.s, B = A * Math.max(0, rt);
    ctx.save();
    ctx.setLineDash(dash || []);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    if (B < 0.6) {
      ctx.beginPath();
      ctx.moveTo(cx - geo.far.ax * A, cy - geo.far.ay * A);
      ctx.lineTo(cx + geo.far.ax * A, cy + geo.far.ay * A);
    } else {
      ellipsePath(cx, cy, A, B, geo.far.ax, geo.far.ay);
    }
    ctx.stroke();
    ctx.restore();
  }

  function label(c, text, x, y) {
    ctx.save();
    ctx.font = '700 10.5px ui-monospace, "Cascadia Code", Menlo, Consolas, monospace';
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.max(28, Math.min(W - 28, x)), Math.max(9, Math.min(H - 9, y)));
    ctx.restore();
  }

  /* Everything that is GIVEN: the near end, the two barrel edges, and the
     dotted axis the far end's roundness is measured along. Muted, because
     it is the question, not the answer. */
  function drawGiven(c, p) {
    var nx = geo.near.cx * p.s + p.ox, ny = geo.near.cy * p.s + p.oy;
    var fx = geo.far.cx * p.s + p.ox, fy = geo.far.cy * p.s + p.oy;
    var A = geo.far.a * p.s;

    ctx.save();                                   /* the barrel's own axis */
    ctx.globalAlpha = 0.34;
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.restore();

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = c.muted;
    for (var i = 0; i < geo.body.length; i++) {
      var b = geo.body[i];
      ctx.beginPath();
      ctx.moveTo(b[0] * p.s + p.ox, b[1] * p.s + p.oy);
      ctx.lineTo(b[2] * p.s + p.ox, b[3] * p.s + p.oy);
      ctx.stroke();
    }
    ellipsePath(nx, ny, geo.near.a * p.s, geo.near.b * p.s, geo.near.ax, geo.near.ay);
    ctx.stroke();

    label(c, 'near end', nx + geo.near.ax * (geo.near.a * p.s + 16), ny + geo.near.ay * (geo.near.a * p.s + 16));
    label(c, 'far end', fx - geo.far.ax * (A + 16), fy - geo.far.ay * (A + 16));
  }

  /* The rail the dot runs on, drawn as its own line rather than as more
     of the barrel's axis: the first screen has to say "this dot, that
     way" without the how-to being opened. Aiming only — during a reveal
     it would just be a third dotted thing to read. */
  function drawRail(c, p) {
    var fx = geo.far.cx * p.s + p.ox, fy = geo.far.cy * p.s + p.oy;
    var A = geo.far.a * p.s * MAX_RATIO;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + geo.far.mx * A, fy + geo.far.my * A);
    ctx.stroke();
    ctx.restore();
  }

  function drawHandle(c, p, rt) {
    var h = handleAt(p, rt);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 10, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = c.mark;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* The truth over the attempt, with the gap between them drawn as the
     thing it is — and the SCALE it was measured on, which is the part a
     bare number cannot be read without: the two faint dotted ends are
     where the score reaches zero, so a 62 has something on the sheet to
     be a 62 against. Both taken from the stored reveal, never from
     ease() again: plugging a pen in while the reveal is up must not
     redraw the band at half its width under a number measured on the
     old one. */
  function drawReveal(c, p, rv) {
    var zr = (isFinite(rv.zero) && rv.zero > 0) ? rv.zero : DEG_TOL;
    var lo = rv.trueRatio - zr, hi = rv.trueRatio + zr;
    ctx.save();
    ctx.globalAlpha = 0.55;
    if (lo > 0.02) strokeFarEnd(p, lo, c.muted, 1, [2, 5]);
    if (hi < MAX_RATIO) strokeFarEnd(p, hi, c.muted, 1, [2, 5]);
    ctx.restore();
    strokeFarEnd(p, rv.trueRatio, c.ink, 2.4, []);        /* what it is */
    /* …and the attempt over it, not under: a player who got it exactly
       right would otherwise see their own end vanish behind the answer and
       have no idea whether they had drawn anything at all. */
    strokeFarEnd(p, rv.ratio, c.mark, 1.8, [5, 4]);       /* what you drew */

    var mine = handleAt(p, rv.ratio), truth = handleAt(p, rv.trueRatio);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(truth.x, truth.y);
    ctx.lineTo(mine.x, mine.y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(truth.x, truth.y, 3, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.mark;
    ctx.beginPath();
    ctx.arc(mine.x, mine.y, 6, 0, TAU);
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!geo || W < 60 || H < 40) return;
    var c = inks();
    var p = placement();
    if (!p) return;
    drawGiven(c, p);
    /* The reveal owns the far end while it is up: the live handle as well
       would just be a second thing to read. */
    if (reveal) { drawReveal(c, p, reveal); return; }
    drawRail(c, p);
    strokeFarEnd(p, ratio, c.mark, 2.4, []);
    drawHandle(c, p, ratio);
  }

  var rafId = null;
  function requestDraw() {
    if (rafId !== null) return;
    rafId = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      rafId = null;
      draw();
    });
  }

  /* ---- the round ---- */
  function itemHint(idx) {
    var head = 'Cylinder ' + (idx + 1) + ' of ' + ITEMS_PER_ROUND + ' — ';
    if (idx === 0) return head + 'drag the dot outward to open the far end. It is always rounder than the near end.';
    return head + 'open the far end to the roundness it should be, then lock it in.';
  }

  function startItem() {
    geo = makeGeometry(itemIdx);
    ratio = 0;
    phase = 'aim';
    btnLock.hidden = false;
    hint.textContent = itemHint(itemIdx);
    draw();
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    scores = [];
    diffs = [];
    playing = true;
    clearReveal();          /* a queued advance from the abandoned round must not fire */
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();            /* the last round's score must not hang over this one */
    startItem();
  }

  function nextItem() {
    revealTimer = null;
    if (!playing) return;   /* the round was abandoned while the reveal was up */
    reveal = null;
    startItem();
  }

  function lockItem() {
    if (!playing || phase !== 'aim' || !geo) return;
    var zero = zeroPoint(placement());
    var diff = ratio - geo.trueRatio;
    var sc = ellipseScore(ratio, geo.trueRatio, zero);
    scores.push(sc);
    diffs.push(diff);
    reveal = {
      ratio: ratio,
      trueRatio: geo.trueRatio,
      zero: zero,
      words: missPhrase(diff, zero),
      /* carried on the reveal, not just printed once: the last cylinder
         of the round is an attempt like any other, and the round-end
         line must not wipe out the one sentence that named what it got
         wrong. */
      note: nearNote(ratio, geo.nearRatio, geo.trueRatio),
    };
    phase = 'reveal';
    itemIdx += 1;
    hint.textContent = reveal.words + ' — ' + Math.round(sc) + ' out of 100 for that end.' +
      (reveal.note ? ' ' + reveal.note : '');
    /* running mean, so the HUD is alive from cylinder one rather than
       sitting on "–" until the round ends */
    hudScore.textContent = String(Math.round(roundScore(scores)));
    draw();
    /* The last end does NOT wait on the beat: finishing is synchronous, so
       report() can never be raced by "new round" landing during the
       reveal. The reveal simply stays on the sheet behind the score. */
    if (itemIdx >= ITEMS_PER_ROUND) { finishRound(); return; }
    revealTimer = setTimeout(nextItem, REVEAL_MS);
  }

  /* A number on its own is not a reveal, and "new best!" on the very first
     round celebrates nothing — it is true of every player's first round
     ever played, on the one round where they most need to be told what
     the number is FOR. The last cylinder keeps its words here too: it is
     an attempt like any other and is owed the same correction as the
     first three. The round's own habit goes last. */
  function roundWords(res, last, bias) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = bias ? ' ' + bias : '';
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  function finishRound() {
    playing = false;                  /* set first: report() fires exactly once */
    phase = 'done';
    clearTimeout(revealTimer);        /* nothing may advance past a finished round */
    revealTimer = null;
    btnLock.hidden = true;
    draw();                           /* the last end stays up as the reveal */
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* the round's tolerance is history too — the hardware may change
       while the player is reading the sentence it grades */
    /* the last cylinder's own correction, then the round's habit: the
       per-item words fix the next end, the habit fixes the next round */
    var tail = [reveal && reveal.note, roundBias(diffs, reveal ? reveal.zero : zeroPoint())];
    hint.textContent = roundWords(res, reveal && reveal.words,
      tail.filter(function (s) { return !!s; }).join(' '));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  /* ---- input: one dot, dragged along one line ---- */
  function setRatio(v) {
    var r = Number(v);
    if (!isFinite(r)) return;
    ratio = r < 0 ? 0 : r > MAX_RATIO ? MAX_RATIO : r;
  }

  /* The pointer's position along the far end's minor axis, as a fraction
     of that end's half-width — the ratio the score is a function of.
     Anywhere on the canvas answers, so a press that misses the dot moves
     it rather than being refused: on a screenless tablet the hand is out
     of sight, and a control that ignores a near miss reads as broken. */
  function ratioAt(rect, ev, p) {
    var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    var A = geo.far.a * p.s;
    if (!(A > 0.5)) return 0;
    return ((px - (geo.far.cx * p.s + p.ox)) * geo.far.mx +
            (py - (geo.far.cy * p.s + p.oy)) * geo.far.my) / A;
  }

  var dragId = null, grabOff = 0, lastPenAt = 0;

  canvas.addEventListener('pointerdown', function (ev) {
    /* Second finger of a two-finger tap must not fight the first, and a
       press that lands while a reveal holds the screen has nothing to
       adjust — ignored, never counted against them. */
    if (!playing || phase !== 'aim' || !geo || dragId !== null || ev.isPrimary === false) return;
    /* palm rejection: a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - lastPenAt < 500) return;
    ev.preventDefault();
    var p = placement();
    if (!p) return;
    dragId = ev.pointerId;
    try { canvas.setPointerCapture(dragId); } catch (e) {}
    canvas.focus({ preventScroll: true });
    var rect = canvas.getBoundingClientRect();
    var at = ratioAt(rect, ev, p);
    var h = handleAt(p, ratio);
    /* Grabbing the dot keeps its offset so it does not jump under the
       finger; pressing anywhere else moves it there outright. */
    grabOff = Math.hypot(ev.clientX - rect.left - h.x, ev.clientY - rect.top - h.y) <= grabRadius()
      ? ratio - at : 0;
    setRatio(at + grabOff);
    draw();       /* the press that just landed is the one paint that must not wait a frame */
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (dragId !== ev.pointerId || phase !== 'aim' || !geo) return;
    ev.preventDefault();
    var p = placement();
    if (!p) return;
    /* Full-rate samples, one repaint a frame: the browser dispatches one
       pointermove per frame but the digitizer filled it with the whole
       run of positions, and the last of those is where the hand actually
       is. Painting per sample would be several full-canvas washes inside
       one frame with all but the last thrown away. */
    var list = ArtDaily.samples(ev);
    var last = (list && list.length) ? list[list.length - 1] : ev;
    var rect = canvas.getBoundingClientRect();
    setRatio(ratioAt(rect, last, p) + grabOff);
    requestDraw();
  });

  function endDrag(ev) {
    if (dragId === null || (ev && ev.pointerId !== undefined && ev.pointerId !== dragId)) return;
    try { canvas.releasePointerCapture(dragId); } catch (e) {}
    dragId = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  /* A release the canvas never sees — off-window, or iOS dropping the
     capture — would otherwise freeze the handle for the whole session,
     because pointerdown returns early while one is in flight. */
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /* Keyboard: the same one axis, in steps, plus lock. */
  canvas.addEventListener('keydown', function (ev) {
    if (!playing) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); lockItem(); return; }
    if (phase !== 'aim') return;
    var step = (ev.shiftKey ? 0.08 : 0.02);
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') setRatio(ratio + step);
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') setRatio(ratio - step);
    else return;
    ev.preventDefault();
    requestDraw();     /* a held arrow repeats faster than the screen refreshes */
  });

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  function showToast(msg, celebrate) {
    clearTimeout(toastTimer);
    /* Unhidden BEFORE the text lands: a live region that is still hidden
       when its content changes is not announced, so a screen-reader
       player finished the round and heard the score nowhere. */
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
  btnLock.addEventListener('click', lockItem);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  /* The ink cache is keyed on the theme so it self-heals; dropping it
     here as well means nothing can be caught holding yesterday's colour. */
  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session; the grab zone is sized from it.
     Note what this does NOT do: re-judge anything already on screen. */
  ArtDaily.onInput(draw);

  /* Both resize sources fire in bursts for a single drag, and a fit that
     really changes size reallocates the canvas backing store — the most
     expensive thing in this file, plus a full clear on top. So measure and
     repaint at most once a frame, and only when the size actually moved
     (a phone's URL bar fires resize constantly at an unchanged width). */
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      fitPending = false;
      if (fitCanvas()) draw();
    });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches what window.resize cannot: the canvas
     measuring 0 at boot (opened in a background tab, or laid out late)
     and getting its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
