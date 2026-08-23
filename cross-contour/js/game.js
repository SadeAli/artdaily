/* ============================================================
   game.js — Wrap the Form. A solid is standing on the sheet with
   one line already drawn around it. Draw the next one: press the
   dot on one edge and pull a single curve across the form to the
   ring on the other edge, so the line looks like it is lying ON
   the surface instead of cutting across the picture.

   Four wraps per round, each at a different height on the same
   form, and each revealed truth stays on the sheet — by the last
   one the form is wrapped like a rope coil.

   The truth is not eyeballed. The form is a real surface of
   revolution in 3D: a real axis tilted in space, real circles
   around it, a real pinhole camera, and the visible half of each
   circle found from the real surface normal against the real view
   ray. Because the normal condition is a plain sinusoid in the
   angle around the circle, both silhouette points and the whole
   visible arc come out in closed form — no root hunting, and the
   reveal is exactly the curve the object makes, not a hand-drawn
   guess at one.

   Every tolerance runs through ArtDaily.ease / startRadius: a
   trackpad is not held to a pen tablet's wobble, the dot is drawn
   big enough for the hardware that cannot see its own hand, and a
   wrap may be drawn in as many lifts as a short trackpad needs.

   Pure functions (geometry AND scoring) sit at the top between the
   PURE markers: numbers in, numbers out, no canvas and no DOM, so
   they lift straight into node.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'cross-contour';
  var WRAPS_PER_ROUND = 4;

  /* ---- stroke handling ---- */
  var MIN_SAMPLES = 6;      /* fewer points than this is an accidental tap */
  var MIN_SEGMENT = 4;      /* a contact shorter than this is a stray tap */
  var START_BASE = 30;      /* base radius of the start dot's zone */
  var END_BASE = 26;        /* base radius of the finish ring */
  var SNAP_MULT = 3;        /* a press this many start-radii out still snaps */
  var RESUME_BASE = 50;     /* press this close to where you lifted = same wrap */
  var RESUME_MS = 4000;     /* …and this soon after it */
  var PEN_LOCK_MS = 700;    /* a finger is inert this long after the pen speaks */
  var MIN_COVER = 0.45;     /* a wrap must cross this much of the truth to count */
  var REVEAL_MS = 2300;     /* the reveal holds this long; a tap skips ahead */

  /* ---- scoring (all BASE values — the caller eases them) ----
     Two different things are being judged and they do NOT deserve the same
     tolerance. How steadily the hand held the line is hardware: a trackpad
     wobbles where a pen does not, so the gap term is eased hard. How deeply
     the line was bowed is intent — a flat line across the form is the very
     mistake the drill exists to correct, and no hardware makes it happen by
     accident. Easing that as generously as the wobble handed a trackpad
     user a passing score for drawing the wrong thing correctly. */
  var PATH_N = 64;          /* arc resample used for the comparison */
  var DEV_ZERO_FRAC = 0.11; /* mean gap / wrap width that scores 0 */
  var DEV_MIN_PX = 13;      /* pixel floor: a phone is not judged harder */
  var DEV_FREE = 0.12;      /* the first 12% of the zero point is free */
  var DEV_GAMMA = 0.8;      /* <1: stingy at the top, unchanged at the bottom */
  var BOW_ZERO_FRAC = 0.6;  /* bow error / the true bow that scores 0 */
  var BOW_MIN_PX = 9;       /* floor, so a near-flat wrap is not impossible */
  var BOW_FREE = 0.10;      /* the first 10% of the bow zero is free */
  var SHAPE_W = 0.6;        /* gap term's share of a wrap; the bow takes the rest */
  var COVER_FULL = 0.92;    /* spanning this much of the wrap counts as all of it */
  var COVER_FLOOR = 0.10;   /* what a wrap keeps for accuracy alone if barely drawn */
  var COVER_OK = 0.80;      /* below this the stroke stopped short, and is told so */
  var TERM_OK = 0.60;       /* a term at or above this is not a fault */

  /* ---- the model ---- */
  var ARC_N = 72;           /* samples along one wrap */
  var SIL_N = 108;          /* samples along one side of the outline */
  var MESH_U = 48;          /* shading mesh, along the axis */
  var MESH_T = 34;          /* shading mesh, around the form */
  var AMBIENT = 0.32;       /* fill light, so nothing goes to pure black */
  var SEED_U = 0.5;         /* where the wrap you are GIVEN sits */
  /* Height of each asked wrap, in ramp order: the first sits right beside
     the given one at the widest part of the form (a cold beginner's first
     stroke should be the easy one), then across it, then out toward the
     ends where the circle turns and narrows. */
  var STATION_PLAN = [0.38, 0.64, 0.25, 0.78];

  /* ============================================================
     PURE START — geometry and scoring. No canvas, no DOM, no
     globals. Everything below this marker is a function of its
     arguments alone, so node can hammer it with degenerate input.
     ============================================================ */

  function finiteOr(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : (isFinite(v) ? v : 0); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : (isFinite(v) ? v : lo); }

  /* ---- 3-vectors ---- */
  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function vadd(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
  function vsub(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function vmul(a, k) { return v3(a.x * k, a.y * k, a.z * k); }
  function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function vcross(a, b) {
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function vnorm(a) {
    var l = Math.sqrt(vdot(a, a));
    return (isFinite(l) && l > 1e-12) ? vmul(a, 1 / l) : v3(0, 1, 0);
  }

  /* ---- the form: a surface of revolution, tilted in space ----
     r(u) is the radius of the circle at height u along the axis, u from
     0 (bottom tip) to 1 (top tip). Both tips close (r = 0), so the drill
     never shows a rim ellipse — a rim would hand over the answer.
     Every field is clamped into a sane band, so a garbage spec still
     builds a form that can be drawn and scored rather than throwing. */
  function makeForm(spec) {
    var s = spec || {};
    var p = clamp(finiteOr(s.p, 0.7), 0.35, 1.6);
    var taper = clamp(finiteOr(s.taper, 0), -0.5, 0.5);
    var R = clamp(finiteOr(s.R, 0.55), 0.12, 0.95);
    var half = clamp(finiteOr(s.half, 1), 0.2, 3);
    var tilt = clamp(finiteOr(s.tiltDeg, 24), -70, 70) * Math.PI / 180;
    var roll = clamp(finiteOr(s.rollDeg, 0), -60, 60) * Math.PI / 180;
    var camD = clamp(finiteOr(s.camD, 4.4), 2.2, 40);
    var focal = clamp(finiteOr(s.focal, 1), 0.2, 6);

    /* axis: up, tipped toward (+) or away from (−) the camera, then rolled
       on the picture plane so the form is not a flagpole */
    var A = vnorm(v3(-Math.cos(tilt) * Math.sin(roll),
                     Math.cos(tilt) * Math.cos(roll),
                     Math.sin(tilt)));
    var help = Math.abs(A.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
    var e1 = vnorm(vcross(help, A));
    var e2 = vcross(A, e1);          /* e1 × e2 = A */

    function radius(u) {
      var t = clamp01(finiteOr(u, 0));
      var s0 = Math.sin(Math.PI * t);
      if (!(s0 > 0)) return 0;
      var r = R * Math.pow(s0, p) * (1 + taper * (t - 0.5));
      return (isFinite(r) && r > 0) ? r : 0;
    }
    /* dr/du by central difference — the profile has infinite slope at the
       tips, so the step is what keeps the normal there finite and usable. */
    function dRadius(u) {
      var t = clamp01(finiteOr(u, 0));
      var h = 0.002;
      var a = Math.max(0, t - h), b = Math.min(1, t + h);
      var span = b - a;
      if (!(span > 0)) return 0;
      var d = (radius(b) - radius(a)) / span;
      return isFinite(d) ? d : 0;
    }

    return {
      A: A, e1: e1, e2: e2, half: half, camD: camD, focal: focal,
      cam: v3(0, 0, camD), radius: radius, dRadius: dRadius
    };
  }

  /* Centre of the circle at height u. */
  function axisPoint(form, u) {
    return vmul(form.A, form.half * (2 * clamp01(finiteOr(u, 0)) - 1));
  }

  /* A point on the surface. */
  function formPoint(form, u, th) {
    var t = finiteOr(th, 0);
    var r = form.radius(u);
    var c = axisPoint(form, u);
    return v3(c.x + r * (Math.cos(t) * form.e1.x + Math.sin(t) * form.e2.x),
              c.y + r * (Math.cos(t) * form.e1.y + Math.sin(t) * form.e2.y),
              c.z + r * (Math.cos(t) * form.e1.z + Math.sin(t) * form.e2.z));
  }

  /* The real outward normal, from the two surface derivatives:
       dP/dth = r · T̂ ,  dP/du = 2·half · A + r' · R̂
       N = dP/dth × dP/du  ∝  2·half · R̂ − r' · A
     (a cylinder, r' = 0, comes back radial — as it must). */
  function formNormal(form, u, th) {
    var t = finiteOr(th, 0);
    var L = 2 * form.half;
    var rp = form.dRadius(u);
    var rx = Math.cos(t) * form.e1.x + Math.sin(t) * form.e2.x;
    var ry = Math.cos(t) * form.e1.y + Math.sin(t) * form.e2.y;
    var rz = Math.cos(t) * form.e1.z + Math.sin(t) * form.e2.z;
    return v3(L * rx - rp * form.A.x, L * ry - rp * form.A.y, L * rz - rp * form.A.z);
  }

  /* Pinhole projection into virtual units (the fit maps them to pixels
     later, so nothing stored here has to be redone when the sheet
     resizes). Anything at or behind the lens comes back null. */
  function projectPt(form, P) {
    var zc = form.camD - P.z;
    if (!(zc > 0.05)) return null;
    var x = form.focal * P.x / zc;
    var y = -form.focal * P.y / zc;
    return (isFinite(x) && isFinite(y)) ? { x: x, y: y } : null;
  }

  /* Which part of the circle at height u faces the camera.
     N·(P−C) = 2·half·r − r'·(A·d) + 2·half·(R̂·d)  with d = centre − C,
     and R̂·d is a plain sinusoid in th, so the front-facing set is one
     arc: |th − c0| ≤ hw, in closed form. Returns null when the whole
     circle is turned away (it happens on the far side of a tip). */
  function arcSpan(form, u) {
    var L = 2 * form.half;
    var r = form.radius(u);
    var rp = form.dRadius(u);
    var d = vsub(axisPoint(form, u), form.cam);
    var k0 = L * r - rp * vdot(form.A, d);
    var m1 = vdot(d, form.e1), m2 = vdot(d, form.e2);
    var M = L * Math.hypot(m1, m2);
    if (!isFinite(k0) || !isFinite(M) || !(M > 1e-9)) return null;
    var c = -k0 / M;
    var th0 = Math.atan2(m2, m1) + Math.PI;   /* the near side of the circle */
    if (c >= 1) return { c0: th0, hw: Math.PI, full: true };
    if (c <= -1) return null;
    var hw = Math.PI - Math.acos(clamp(c, -1, 1));
    if (!isFinite(hw) || hw <= 0) return null;
    return { c0: th0, hw: hw, full: false };
  }

  /* The visible half of one circle, projected: the wrap an artist would
     actually draw, edge of the form to edge of the form. */
  function arcPoints(form, u, n) {
    var span = arcSpan(form, u);
    var out = [];
    if (!span) return out;
    var k = Math.max(8, Math.round(finiteOr(n, ARC_N)));
    var i, q;
    for (i = 0; i <= k; i++) {
      q = projectPt(form, formPoint(form, u, span.c0 - span.hw + 2 * span.hw * i / k));
      if (q) out.push(q);
    }
    return out;
  }

  /* The outline of the whole form: the two silhouette points at every
     height, up one side and down the other. Same closed-form condition —
     these are the ends of the visible arc. */
  function silhouettePath(form, n) {
    var k = Math.max(12, Math.round(finiteOr(n, SIL_N)));
    var left = [], right = [], i, u, span, a, b, q;
    for (i = 0; i <= k; i++) {
      u = 0.0015 + (1 - 0.003) * i / k;
      span = arcSpan(form, u);
      if (!span || span.full) continue;
      a = projectPt(form, formPoint(form, u, span.c0 - span.hw));
      b = projectPt(form, formPoint(form, u, span.c0 + span.hw));
      if (a) left.push(a);
      if (b) right.push(b);
    }
    var out = left.slice();
    for (i = right.length - 1; i >= 0; i--) out.push(right[i]);
    return out;
  }

  /* Virtual units → pixels: one uniform scale plus an offset, so the form
     keeps its shape on any sheet and a rotated phone only re-fits. Total:
     a broken box still returns a usable transform. */
  function fitTransform(pts, W, H, margin) {
    var w = finiteOr(W, 0), h = finiteOr(H, 0), m = Math.max(0, finiteOr(margin, 0));
    var flat = { s: 1, ox: w / 2 || 0, oy: h / 2 || 0 };
    if (!pts || !pts.length || !(w > 0) || !(h > 0)) return flat;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX) || !isFinite(minY)) return flat;
    var bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
    var roomW = Math.max(8, w - 2 * m), roomH = Math.max(8, h - 2 * m);
    var s = Math.min(roomW / bw, roomH / bh);
    if (!isFinite(s) || s <= 0) return flat;
    return { s: s, ox: (w - s * (minX + maxX)) / 2, oy: (h - s * (minY + maxY)) / 2 };
  }

  /* ---- polyline helpers ---- */
  function cleanPts(pts) {
    var out = [], i, p;
    if (!pts || !pts.length) return out;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p && isFinite(p.x) && isFinite(p.y)) out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function polyLength(pts) {
    if (!pts || pts.length < 2) return 0;
    var sum = 0, i, d;
    for (i = 1; i < pts.length; i++) {
      d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (isFinite(d)) sum += d;
    }
    return sum;
  }

  /* Even spacing by arc length, so two curves drawn at different speeds
     still compare point for point. */
  function resampleByArc(pts, n) {
    var src = cleanPts(pts), out = [], i, arc = [0], total, target, seg = 1, t, a, b, span;
    if (!src.length || !(n >= 2)) return out;
    if (src.length === 1) {
      for (i = 0; i < n; i++) out.push({ x: src[0].x, y: src[0].y });
      return out;
    }
    for (i = 1; i < src.length; i++) {
      arc.push(arc[i - 1] + Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y));
    }
    total = arc[arc.length - 1];
    if (!(total > 0)) {
      for (i = 0; i < n; i++) out.push({ x: src[0].x, y: src[0].y });
      return out;
    }
    for (i = 0; i < n; i++) {
      target = total * i / (n - 1);
      while (seg < src.length - 1 && arc[seg] < target) seg++;
      a = src[seg - 1]; b = src[seg];
      span = arc[seg] - arc[seg - 1];
      t = span > 0 ? (target - arc[seg - 1]) / span : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  /* [0.25, 0.5, 0.25], endpoints held. Digitiser noise is not a wobble. */
  function smoothPath(pts, passes) {
    var cur = pts, k, i, next;
    for (k = 0; k < passes; k++) {
      if (!cur || cur.length < 3) return cur || [];
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

  function distToSeg(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var wx = p.x - a.x, wy = p.y - a.y;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = clamp01(t);
    return Math.hypot(wx - vx * t, wy - vy * t);
  }

  function distToPath(p, path) {
    if (!path || !path.length) return Infinity;
    if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
    var best = Infinity, i, d;
    for (i = 1; i < path.length; i++) {
      d = distToSeg(p, path[i - 1], path[i]);
      if (d < best) best = d;
    }
    return best;
  }

  /* Mean gap between two curves, measured BOTH ways. One way alone would
     let a 20px stub sitting perfectly on the truth read as a perfect
     wrap; measuring the truth back to the stroke makes anything left
     undrawn cost exactly what it is worth. Direction-blind, so drawing
     right-to-left is never punished. */
  function chamferMean(a, b) {
    var A = cleanPts(a), B = cleanPts(b);
    if (!A.length || !B.length) return Infinity;
    var i, s1 = 0, s2 = 0, d;
    for (i = 0; i < A.length; i++) {
      d = distToPath(A[i], B);
      if (!isFinite(d)) return Infinity;
      s1 += d;
    }
    for (i = 0; i < B.length; i++) {
      d = distToPath(B[i], A);
      if (!isFinite(d)) return Infinity;
      s2 += d;
    }
    return 0.5 * (s1 / A.length + s2 / B.length);
  }

  /* How deeply a curve bows off its OWN chord, signed along a FIXED
     direction (the truth chord's normal) so the player's curve and the
     truth's are read in the same frame. Two properties earn their keep:
     it is blind to which end the stroke started from, and it is blind to
     the stroke being parked to one side — a wrap with the right curve in
     the wrong place is a different fault from a flat one, and the reveal
     has to be able to tell the player which of the two they just did. */
  function wrapBow(path, a, b) {
    var pts = resampleByArc(path, 33);
    if (pts.length < 2 || !a || !b) return 0;
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (!(len > 1e-9)) return 0;
    var nx = -dy / len, ny = dx / len;
    var p0 = pts[0], p1 = pts[pts.length - 1];
    var chord = (p1.x - p0.x) * nx + (p1.y - p0.y) * ny;   /* its own end-to-end drift */
    var sum = 0, i, off;
    for (i = 0; i < pts.length; i++) {
      off = (pts[i].x - p0.x) * nx + (pts[i].y - p0.y) * ny;
      sum += off - chord * i / (pts.length - 1);
    }
    var m = sum / pts.length;
    return isFinite(m) ? m : 0;
  }

  /* How much of the wrap was actually drawn, 0–1: the stretch of the truth
     the stroke spans. Without it, half a wrap laid perfectly on the truth
     scores like a whole one — the untouched half is only "far away" on
     average, which is a discount, not the fail it should be. Anything past
     COVER_FULL counts as the whole thing, so a stroke that stops a hair
     short of the ring is not docked for finishing. */
  function arcCoverage(attempt, truth) {
    var a = resampleByArc(cleanPts(attempt), 32);
    var t = resampleByArc(cleanPts(truth), PATH_N);
    if (a.length < 2 || t.length < 2) return 0;
    var lo = 1, hi = 0, i, s;
    for (i = 0; i < a.length; i++) {
      s = nearestArcS(t, a[i]);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    var c = (hi - lo) / COVER_FULL;
    return clamp01(isFinite(c) ? c : 0);
  }

  /* The bow tolerance's BASE, in pixels, for a wrap whose true bow is
     `bowT`: a proportion of the real curve, floored so that a wrap which
     genuinely IS nearly straight (a slice seen almost edge-on) does not
     demand impossible precision to call straight. The caller eases it. */
  function bowZeroBase(bowT) {
    return Math.max(BOW_MIN_PX, BOW_ZERO_FRAC * Math.abs(finiteOr(bowT, 0)));
  }

  /* ONE judgement per wrap: the number, the fault and the sentence come out
     of the same call, off the same terms. Splitting them is how a drill ends
     up printing "dead on" beside a 40 — here it cannot, because the head of
     the sentence is cut from the score itself and the fault is cut from the
     very terms that built it.
       tol = { zero: eased px where the gap term dies,
               bow:  eased px where the bow term dies }
     Total: any argument at all comes back a finite 0–100 and a sentence. */
  function judgeWrap(attempt, truth, tol) {
    var z = finiteOr(tol && tol.zero, 0);
    var zb = finiteOr(tol && tol.bow, 0);
    var out = {
      score: 0, dev: Infinity, cover: 0, shape: 0, bowTerm: 0,
      bowA: 0, bowT: 0, fault: 'short'
    };
    /* Both curves go through the SAME mill — one smoothing pass (digitiser
       noise is not a wobble) and an even arc-length resample. Comparing a
       smoothed attempt against a raw truth left a perfect copy scoring 99.8
       and put 100 out of reach for reasons that had nothing to do with the
       player's hand. */
    var a = resampleByArc(smoothPath(cleanPts(attempt), 1), PATH_N);
    var t = resampleByArc(smoothPath(cleanPts(truth), 1), PATH_N);
    if (a.length < 2 || t.length < 2 || !(z > 0) || !(zb > 0)) {
      out.words = wrapWords(out);
      return out;
    }
    var A = t[0], B = t[t.length - 1];
    var dev = chamferMean(a, t);
    if (!isFinite(dev)) dev = z * 8;
    out.dev = dev;
    out.cover = arcCoverage(a, t);
    out.bowA = wrapBow(a, A, B);
    out.bowT = wrapBow(t, A, B);

    /* how steadily the hand held the line — eased for the hardware */
    var free = z * DEV_FREE;
    out.shape = clamp01(1 - Math.pow(clamp01((dev - free) / Math.max(1e-6, z - free)), DEV_GAMMA));
    /* how deeply it was bowed — intent, so barely eased */
    var bowFree = zb * BOW_FREE;
    out.bowTerm = clamp01(1 - Math.pow(
      clamp01((Math.abs(out.bowA - out.bowT) - bowFree) / Math.max(1e-6, zb - bowFree)), DEV_GAMMA));

    var s = 100 * (COVER_FLOOR + (1 - COVER_FLOOR) * out.cover) *
            (SHAPE_W * out.shape + (1 - SHAPE_W) * out.bowTerm);
    out.score = isFinite(s) ? clamp(s, 0, 100) : 0;

    /* The fault, in the order a beginner should fix things: finish the
       stroke, then bend it the right way and the right amount, then place
       it. Each threshold is one of the terms the score is made of, so a
       "good" can never sit under 45 and an 85 can never be called a fault
       (COVER_OK/TERM_OK are what make that arithmetic hold). */
    if (out.cover < COVER_OK) out.fault = 'short';
    else if (out.bowTerm < TERM_OK) {
      out.fault = (out.bowT !== 0 && out.bowA * out.bowT < 0) ? 'wrong'
                : (Math.abs(out.bowA) < Math.abs(out.bowT) ? 'flat' : 'deep');
    } else if (out.shape < TERM_OK) out.fault = 'drift';
    else out.fault = 'good';
    out.words = wrapWords(out);
    return out;
  }

  /* The reveal in words. Held to the same bar as the number: the head is
     read off the score, the tail off the fault, so they move together. */
  function wrapWords(j) {
    var s = j ? finiteOr(j.score, 0) : 0;
    var fault = (j && typeof j.fault === 'string') ? j.fault : 'short';
    var head = s >= 85 ? 'Right on the slice'
             : s >= 62 ? 'Close wrap'
             : s >= 35 ? 'Off the wrap' : 'Way off the wrap';
    switch (fault) {
      case 'good': return head + ' — the line sits on the surface.';
      /* "which way" is a rule a beginner cannot check (the belly points at
         the end LEANING AWAY, which reads as the opposite of what the
         phrase "toward you" suggests) — so point at the line on the sheet
         instead. Every wrap on one form bends the same way as the given
         one, and that is something they can look at and copy. */
      case 'wrong': return head + ' — curved the wrong way; bend it the same way as the dashed line already drawn round the form.';
      case 'flat': return head + ' — too flat; a straight line across reads as a cut, not a wrap.';
      case 'deep': return head + ' — too deep; that curve bulges out past the surface.';
      case 'drift': return head + ' — the curve is fair, the line drifted off its slice.';
      default: return head + ' — it stopped short; a wrap runs edge to edge, all the way to the far side.';
    }
  }

  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0, i, v;
    for (i = 0; i < scores.length; i++) {
      v = Number(scores[i]);
      sum += isFinite(v) ? clamp(v, 0, 100) : 0;
    }
    var s = sum / scores.length;
    return isFinite(s) ? clamp(s, 0, 100) : 0;
  }

  /* Round-end coaching: name the habit that cost the most, using the same
     fault words the per-wrap reveal used. */
  function coachLine(faults) {
    if (!faults || !faults.length) return 'nothing was scored this round — press “new round” and pull one curve across.';
    var n = { good: 0, flat: 0, deep: 0, wrong: 0, drift: 0, short: 0 }, i, f;
    for (i = 0; i < faults.length; i++) {
      f = faults[i];
      if (n[f] === undefined) f = 'drift';
      n[f] += 1;
    }
    if (n.good >= faults.length) return 'every wrap sat on the surface — now try it on a mug in front of you.';
    if (n.wrong >= 1) return 'at least one wrap curved the wrong way — every wrap on one form bends the same way as the given line; copy its direction first, then its depth.';
    if (n.short > n.flat && n.short >= n.deep && n.short >= n.drift) return 'your wraps stop short — carry the line right off the far edge; that is where it proves the form.';
    if (n.flat >= n.deep && n.flat >= n.drift && n.flat > 0) return 'your wraps go flat — the curve IS the form; a straight line across kills it.';
    if (n.deep >= n.drift && n.deep > 0) return 'your wraps bulge too far — the curve should be a slice through the form, not a hoop around it.';
    return 'the curves are right, the placement wanders — start on the dot and aim at the ring before you move.';
  }

  /* Where along a curve a point sits, 0–1 — used to tell a finished wrap
     from one that stopped halfway. */
  function nearestArcS(path, p) {
    if (!path || path.length < 2 || !p) return 0;
    var best = Infinity, idx = 0, i, d;
    for (i = 0; i < path.length; i++) {
      d = (path[i].x - p.x) * (path[i].x - p.x) + (path[i].y - p.y) * (path[i].y - p.y);
      if (d < best) { best = d; idx = i; }
    }
    return idx / (path.length - 1);
  }

  /* ============================================================
     PURE END — canvas and DOM from here down.
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

  /* ---- eased tolerances, re-read on every use so a hardware change
     mid-session (a pencil picked up, a tablet plugged in) applies ---- */
  function startZone() { return ArtDaily.startRadius(START_BASE); }
  function endZone() { return ArtDaily.startRadius(END_BASE); }
  /* Both zero points are eased from THIS drill's own base constants —
     never from startRadius()'s output. The two knobs rank the hardware in
     opposite orders on purpose (a pen gets the biggest target and the
     strictest scoring), so feeding one into the other inverts the fairness
     they exist for. The bow's zero is eased too, but off a base that is a
     fraction of the real curve rather than of the sheet. */
  function tolerancesFor(spanPx, bowT) {
    var span = Math.max(0, finiteOr(spanPx, 0));
    return {
      zero: ArtDaily.ease(Math.max(DEV_MIN_PX, DEV_ZERO_FRAC * span)),
      bow: ArtDaily.ease(bowZeroBase(bowT))
    };
  }

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--lilac').trim();
    return {
      ink: cs.getPropertyValue('--ink').trim() || '#33291E',
      muted: cs.getPropertyValue('--muted').trim() || '#766850',
      card: cs.getPropertyValue('--card').trim() || '#FDFAF1',
      accent: accent,
      mark: cs.getPropertyValue('--canvas-accent').trim() || accent,
      lit: cs.getPropertyValue('--form-lit').trim() || '#F4EAD3',
      dark: cs.getPropertyValue('--form-dark').trim() || '#B3A181'
    };
  }

  /* #rgb / #rrggbb → {r,g,b}; anything else comes back null and the
     caller falls back rather than painting "NaN". */
  function parseHex(s) {
    if (typeof s !== 'string') return null;
    var h = s.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function mixHex(a, b, t) {
    var ca = parseHex(a), cb = parseHex(b), k = clamp01(t);
    if (!ca || !cb) return cb ? b : (ca ? a : '#999999');
    return 'rgb(' + Math.round(ca.r + (cb.r - ca.r) * k) + ',' +
                    Math.round(ca.g + (cb.g - ca.g) * k) + ',' +
                    Math.round(ca.b + (cb.b - ca.b) * k) + ')';
  }

  /* ---- crisp canvas at any devicePixelRatio ---- */
  var W = 0, H = 0, dpr = 1;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var d = window.devicePixelRatio || 1;
    var h = Math.round(w * (w < 520 ? 0.98 : 0.72));
    if (w === W && h === H && d === dpr) return false;
    W = w; H = Math.max(1, h); dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ----
     scene, stations, seed and every revealed truth live in VIRTUAL units
     (the projection's own space). Pixels are produced by `fit` at paint
     time, so a phone rotated mid-round — or mid-reveal — simply re-fits
     and nothing strands itself off-sheet. The player's stroke is stored
     in the same units for the same reason. */
  var round = 0, itemIdx = 0, playing = false;
  var scene = null, fit = { s: 1, ox: 0, oy: 0 }, sceneId = 0;
  var itemScores = [], faults = [], doneWraps = [];
  var pending = [], pendingPress = null, pendingMissed = false, segStart = 0;
  var drawing = false, activePointer = null, activeType = '', lastPenAt = -Infinity;
  var revealing = null, revealTimer = null, roundResult = null;
  /* The pointer currently HOLDING the reveal: press cancels the pending
     advance, release advances — a quick tap is the drill's existing skip,
     and a press kept down keeps the screen (WCAG 2.2.1, the beat as a
     floor). Cleared by the release/cancel handlers, nextStep and newRound. */
  var holdPointer = null;
  var formCache = null;

  /* ---- where the round's form comes from -------------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF DRAWS, and in this drill it is a
     ROUND-level sequence rather than an item-level one: one form is built
     per round and the four wraps are stations along it, so there is one
     generator here, not one per wrap. Round 1 of a sitting comes from
     ArtDaily.roundRandom(1) — seeded from today and this slug — so everyone
     gets the same form today; round 2 and on are practice, same
     distribution, unshared seed.

     Every value below is in VIRTUAL units (the projection's own space) and
     `fit` only turns them into pixels at paint time — stationAt's minSpan
     is a fraction of the form's own widest chord, not of the sheet — so
     this drill's round really is identical on every device, reroll loop
     included.

     WORTH KNOWING BEFORE YOU JUDGE THIS ONE BY ITS DIFF: round 1 was
     ALREADY the same form for everyone. makeSpec(n) returns a hand-pinned
     gentle egg for n <= 1 and newRound asks for makeSpec(round + tries), so
     the first round of a sitting drew nothing at all from makeSpec. What
     the seed changes on round 1 is the LIGHT (below), the reroll path if
     the pinned form ever fails to yield four drawable wraps, and every
     practice round after the first. */
  var roundRng = Math.random;

  /* GUARDED, and the guard is load-bearing: index.html cache-busts its own
     scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache independently. A returning visitor with a warm old
     SDK and a cold copy of this file would call a function that does not
     exist, and newRound would throw before the form was built — blank
     sheet, HUD at "–". Falling back to Math.random costs today's player
     nothing but a non-comparable round, which is what they had yesterday,
     and it self-heals when the SDK's max-age expires. */
  function seedRoundRng() {
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
  }

  /* Both unchanged as functions — the same expressions they always were,
     with Math.random() swapped for the round's uniform, which is uniform on
     [0,1) just the same. So a seeded form is not a gentler or a nastier
     form, and the % guard on pick stays exactly where it was. */
  function rand(lo, hi) { return lo + roundRng() * (hi - lo); }
  function pick(list) { return list[Math.floor(roundRng() * list.length) % list.length]; }

  /* Round one is a gentle, obviously-tilted egg: the very first screen has
     to read as a solid standing in space before anything else can be
     taught. After that the form, the lean and the camera all move. */
  function makeSpec(n) {
    if (n <= 1) {
      return { p: 0.72, taper: 0.16, R: 0.56, half: 1, tiltDeg: 27, rollDeg: -7, camD: 4.4, focal: 1 };
    }
    return {
      p: rand(0.55, 0.95),
      taper: rand(-0.42, 0.42),
      R: rand(0.48, 0.62),
      half: 1,
      tiltDeg: pick([1, -1]) * rand(15, 34),
      rollDeg: rand(-16, 16),
      camD: rand(3.4, 5.4),
      focal: 1
    };
  }

  /* A station is only asked if its wrap is wide enough to be drawable on
     any sheet; anything too close to a tip is nudged back toward the
     middle rather than shipped as an unplayable hairline. */
  function stationAt(form, u, minSpan) {
    var step = 0, tryU = clamp(u, 0.06, 0.94), arc, a, b, span;
    for (step = 0; step < 24; step++) {
      arc = arcPoints(form, tryU, ARC_N);
      if (arc.length >= 4) {
        a = arc[0]; b = arc[arc.length - 1];
        span = Math.hypot(b.x - a.x, b.y - a.y);
        if (span >= minSpan) {
          /* draw from the left-hand edge: the natural pull for most hands */
          if (b.x < a.x) { arc = arc.slice().reverse(); a = arc[0]; b = arc[arc.length - 1]; }
          return { u: tryU, arc: arc, a: a, b: b, span: span, len: polyLength(arc) };
        }
      }
      tryU += (tryU < 0.5 ? 0.03 : -0.03);
      tryU = clamp(tryU, 0.06, 0.94);
    }
    return null;
  }

  function buildScene(spec) {
    var form = makeForm(spec);
    var sil = silhouettePath(form, SIL_N);
    var widest = 0, i, j, dx, dy, d;
    /* the widest chord of the outline — the yardstick a station must clear */
    for (i = 0; i < sil.length; i += 4) {
      for (j = i + 4; j < sil.length; j += 4) {
        dx = sil[i].x - sil[j].x; dy = sil[i].y - sil[j].y;
        d = Math.hypot(dx, dy);
        if (d > widest) widest = d;
      }
    }
    var minSpan = widest * 0.22;
    var seed = stationAt(form, SEED_U, minSpan);
    var stations = [], st;
    for (i = 0; i < STATION_PLAN.length; i++) {
      st = stationAt(form, STATION_PLAN[i], minSpan);
      if (st) stations.push(st);
    }
    if (!seed || stations.length < WRAPS_PER_ROUND) return null;
    /* SEEDED, and this is the one shading draw in the chapter that is
       CONTENT rather than decoration. It is a real Lambert term over a
       curved surface (see renderForm), so the terminator it puts on the
       form is itself a curve that follows the form's turn — which is
       exactly the thing the player is being asked to read before drawing a
       wrap. Two players lit from different sides would be reading different
       cues off the same solid. (Contrast vp-hunt's sunLeft, deliberately
       left on Math.random: that is two flat alphas on flat faces, carrying
       no curvature at all.) These are the last three draws of a scene, so
       seeding them shifts nothing that follows. */
    var light = vnorm(v3(rand(-0.7, -0.2), rand(0.35, 0.8), rand(0.55, 0.95)));
    scene = { form: form, sil: sil, seed: seed, stations: stations, light: light, widest: widest };
    sceneId += 1;
    return scene;
  }

  function fitScene() {
    if (!scene) return;
    fit = fitTransform(scene.sil, W, H, 30);
  }

  function toPx(p) { return { x: fit.ox + p.x * fit.s, y: fit.oy + p.y * fit.s }; }
  function toModel(p) {
    var s = (isFinite(fit.s) && fit.s > 1e-9) ? fit.s : 1;
    return { x: (p.x - fit.ox) / s, y: (p.y - fit.oy) / s, t: p.t };
  }
  function pathPx(pts) {
    var out = [], i;
    for (i = 0; i < pts.length; i++) out.push(toPx(pts[i]));
    return out;
  }

  function station() { return scene ? scene.stations[Math.min(itemIdx, scene.stations.length - 1)] : null; }

  /* ---- painting ---- */
  function drawPolyline(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* A line that means something is drawn twice: once fat in the paper
     colour, once thin in its own. The form under it runs from a lit tone
     to a shadow tone, and no single ink is readable against both — the
     halo is what keeps every meaning-bearing mark legible on either. */
  function strokeHalo(pts, color, width, halo) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = halo;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = width + 3.4;
    drawPolyline(pts);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    drawPolyline(pts);
    ctx.restore();
  }

  /* The shaded solid, rendered once per sheet/theme into an offscreen
     canvas: a real Lambert term, real normals, and the mesh laid out
     strip by strip along the visible arc of each circle so it tiles the
     form exactly to its own silhouette. Back faces never get built. */
  function renderForm(c, key) {
    var off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(W * dpr));
    off.height = Math.max(1, Math.round(H * dpr));
    var g = off.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var form = scene.form, light = scene.light;
    var i, j, u0, u1, s0, s1, t0, t1, q, shade, col, um, tm, N, l;
    for (i = 0; i < MESH_U; i++) {
      u0 = 0.0015 + (1 - 0.003) * i / MESH_U;
      u1 = 0.0015 + (1 - 0.003) * (i + 1) / MESH_U;
      s0 = arcSpan(form, u0);
      s1 = arcSpan(form, u1);
      if (!s0 || !s1) continue;
      for (j = 0; j < MESH_T; j++) {
        t0 = j / MESH_T; t1 = (j + 1) / MESH_T;
        var p1 = projectPt(form, formPoint(form, u0, s0.c0 + (2 * t0 - 1) * s0.hw));
        var p2 = projectPt(form, formPoint(form, u0, s0.c0 + (2 * t1 - 1) * s0.hw));
        var p3 = projectPt(form, formPoint(form, u1, s1.c0 + (2 * t1 - 1) * s1.hw));
        var p4 = projectPt(form, formPoint(form, u1, s1.c0 + (2 * t0 - 1) * s1.hw));
        if (!p1 || !p2 || !p3 || !p4) continue;
        um = (u0 + u1) / 2;
        tm = arcSpan(form, um);
        if (!tm) continue;
        N = vnorm(formNormal(form, um, tm.c0 + (t0 + t1 - 1) * tm.hw));
        l = Math.max(0, vdot(N, light));
        shade = AMBIENT + (1 - AMBIENT) * l;
        col = mixHex(c.dark, c.lit, clamp01(shade));
        g.beginPath();
        q = toPx(p1); g.moveTo(q.x, q.y);
        q = toPx(p2); g.lineTo(q.x, q.y);
        q = toPx(p3); g.lineTo(q.x, q.y);
        q = toPx(p4); g.lineTo(q.x, q.y);
        g.closePath();
        g.fillStyle = col;
        g.strokeStyle = col;      /* closes the hairline seams between quads */
        g.lineWidth = 1;
        g.fill();
        g.stroke();
      }
    }
    /* a soft outline so the form sits on the paper rather than floating */
    var sil = pathPx(scene.sil);
    if (sil.length > 2) {
      g.save();
      g.globalAlpha = 0.5;
      g.strokeStyle = c.muted;
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(sil[0].x, sil[0].y);
      for (i = 1; i < sil.length; i++) g.lineTo(sil[i].x, sil[i].y);
      g.closePath();
      g.stroke();
      g.restore();
    }
    return { key: key, canvas: off };
  }

  function paintForm(c) {
    var key = W + 'x' + H + '@' + dpr + '|' + c.lit + '|' + c.dark + '|' + c.muted + '|' + sceneId;
    if (!formCache || formCache.key !== key) formCache = renderForm(c, key);
    if (formCache && formCache.canvas) ctx.drawImage(formCache.canvas, 0, 0, W, H);
  }

  function drawLabel(p, text, color, dy) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '800 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, Math.max(20, Math.min(W - 20, p.x)), Math.max(12, Math.min(H - 4, p.y + dy)));
    ctx.restore();
  }

  /* The wrap you are GIVEN: the one line already drawn around the form.
     It is what says which end is nearer, so it is drawn like ink, not
     like a hint. */
  function drawSeed(c) {
    var pts = pathPx(scene.seed.arc);
    ctx.save();
    ctx.setLineDash([7, 5]);
    strokeHalo(pts, c.muted, 2, c.card);
    ctx.restore();
    var mid = pts[Math.floor(pts.length / 2)];
    if (mid) drawLabel(mid, 'given', c.muted, -10);
  }

  function drawDone(c) {
    var i, pts;
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (i = 0; i < doneWraps.length; i++) {
      pts = pathPx(doneWraps[i]);
      strokeHalo(pts, c.mark, 1.8, c.card);
    }
    ctx.restore();
  }

  function drawTargets(c) {
    var st = station();
    if (!st) return;
    var a = toPx(st.a), b = toPx(st.b);
    var z = startZone();
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(a.x, a.y, z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    /* the finish ring */
    ctx.save();
    ctx.strokeStyle = c.card;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    /* the start dot */
    ctx.save();
    ctx.fillStyle = c.card;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.mark;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawLabel(a, 'start', c.ink, a.y > 34 ? -16 : 26);
    drawLabel(b, 'end', c.ink, b.y > 34 ? -16 : 26);
  }

  function drawStroke(c) {
    if (pending.length < 2) return;
    strokeHalo(pathPx(pending), c.ink, 2.6, c.card);
  }

  /* The truth over the attempt: the circle the object really makes at
     that height, drawn in the accent with its two edge points marked, and
     the wrap's score on a little card so it reads over the shading. */
  function drawReveal(c) {
    var truth = pathPx(revealing.truth);
    strokeHalo(truth, c.mark, 3, c.card);
    var ends = [truth[0], truth[truth.length - 1]], i;
    for (i = 0; i < ends.length; i++) {
      if (!ends[i]) continue;
      ctx.save();
      ctx.fillStyle = c.mark;
      ctx.strokeStyle = c.card;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ends[i].x, ends[i].y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    var label = String(revealing.score);
    var mid = truth[Math.floor(truth.length / 2)];
    if (!mid) return;
    var tx = Math.max(30, Math.min(W - 30, mid.x));
    var ty = Math.max(28, Math.min(H - 14, mid.y - 18));
    ctx.save();
    ctx.font = '900 16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    var tw = ctx.measureText(label).width + 16;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = c.card;
    ctx.fillRect(tx - tw / 2, ty - 15, tw, 22);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.mark;
    ctx.fillText(label, tx, ty + 1);
    ctx.restore();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!scene) return;
    paintForm(c);
    drawSeed(c);
    drawDone(c);
    if (playing && !revealing) drawTargets(c);
    drawStroke(c);
    if (revealing) drawReveal(c);
  }

  /* ---- copy ---- */
  function wrapLabel() {
    return 'wrap ' + Math.min(itemIdx + 1, WRAPS_PER_ROUND) + ' of ' + WRAPS_PER_ROUND;
  }

  function itemHint() {
    if (itemIdx === 0) {
      return wrapLabel() + ' — press the dot and pull ONE curve across the form to the ring, ' +
        'bending it the same way as the dashed line already drawn round it.';
    }
    if (itemIdx === 1) {
      return wrapLabel() + ' — same again at a new height: press the dot, curve across to the ring. ' +
        'Every wrap on this form bends the same way.';
    }
    return wrapLabel() + ' — same again at a new height: press the dot, curve across to the ring.';
  }

  /* ---- input ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: ev.timeStamp || 0 };
  }

  function resetStroke() {
    pending = [];
    pendingPress = null;
    pendingMissed = false;
    segStart = 0;
  }

  function endContactState() {
    drawing = false;
    activePointer = null;
    activeType = '';
  }

  /* True when this press carries on the wrap in flight: close to where the
     hand lifted, soon after. A trackpad cannot pull 300px in one contact,
     so this is not a nicety — without it the drill is unplayable on the
     most common hardware there is. */
  function isResume(p) {
    if (!pending.length) return false;
    var last = pending[pending.length - 1];
    var lift = toPx(last);
    var gap = (p.t || 0) - (finiteOr(last.t, 0));
    if (gap < 0 || gap > RESUME_MS) return false;
    return Math.hypot(p.x - lift.x, p.y - lift.y) <= ArtDaily.startRadius(RESUME_BASE);
  }

  /* The straight jump the snap injects from the press onto the dot is a
     courtesy, not ink the player pulled — so it must not pay for the
     coverage test. Stored in model units like everything else, so a
     resize between the press and the release cannot make it nonsense. */
  function drawnLength() {
    var st = station();
    var pts = pathPx(pending);
    var press = pendingPress ? toPx(pendingPress) : null;
    var dot = st ? toPx(st.a) : null;
    var snap = (press && dot) ? Math.hypot(press.x - dot.x, press.y - dot.y) : 0;
    return Math.max(0, polyLength(pts) - snap);
  }

  function canFinish() {
    var st = station();
    if (!st || pending.length < MIN_SAMPLES) return false;
    return drawnLength() >= MIN_COVER * polyLength(pathPx(st.arc));
  }

  function reachedEnd() {
    var st = station();
    if (!st || !canFinish()) return false;
    var last = toPx(pending[pending.length - 1]);
    if (Math.hypot(last.x - toPx(st.b).x, last.y - toPx(st.b).y) <= endZone()) return true;
    return nearestArcS(pathPx(st.arc), last) >= 0.92;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (!playing || !scene) return;
    if (revealing) {
      /* THE BEAT IS A FLOOR (WCAG 2.2.1): a mark made while the reveal
         holds the sheet has nothing honest to be judged against — the next
         wrap is not drawn yet — so the press cancels the pending advance
         and the RELEASE skips instead: a quick tap is the skip this drill
         always had, a press kept down holds the reveal. Never counted. */
      ev.preventDefault();
      clearTimeout(revealTimer);
      revealTimer = null;
      holdPointer = ev.pointerId;
      return;
    }
    /* palm rejection: a touch inside the pen's shadow is the hand resting */
    if (ev.pointerType === 'touch' && Date.now() - lastPenAt < PEN_LOCK_MS) return;
    if (drawing) {
      if (ev.pointerType !== 'pen' || activeType === 'pen') return;
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
      pending.length = Math.min(pending.length, segStart);
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      endContactState();
    }
    var st = station();
    if (!st) return;
    var p = pointerPos(ev);
    var dot = toPx(st.a);
    var resuming = isResume(p);
    if (!resuming && Math.hypot(p.x - dot.x, p.y - dot.y) > startZone() * SNAP_MULT) {
      hint.textContent = wrapLabel() + ' — that was wide of the dot; press on or near it' +
        (pending.length ? ', or back where you lifted to carry on.' : ' to start the curve.');
      draw();
      return;
    }
    ev.preventDefault();
    var restarted = false;
    if (!resuming && pending.length) {
      resetStroke();
      restarted = true;
    }
    drawing = true;
    activePointer = ev.pointerId;
    activeType = ev.pointerType || '';
    segStart = pending.length;
    if (!pending.length) {
      /* A near miss is snapped onto the dot and told, never refused: on a
         screenless tablet the hand is out of sight, and refusing reads as
         a broken site. The miss costs nothing. */
      pendingPress = toModel(p);
      pendingMissed = Math.hypot(p.x - dot.x, p.y - dot.y) > startZone();
      pending.push({ x: st.a.x, y: st.a.y, t: p.t });
      if (pendingMissed) {
        hint.textContent = wrapLabel() + ' — started you from the dot; press inside the dashed ring next time.';
      } else if (restarted) {
        hint.textContent = wrapLabel() + ' — starting that curve over from the dot.';
      }
    } else {
      pending.push(toModel(p));
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    updateButtons();
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
    if (evs && evs.length) {
      for (var i = 0; i < evs.length; i++) pending.push(toModel(pointerPos(evs[i])));
    } else {
      pending.push(toModel(pointerPos(ev)));
    }
    draw();
  });

  function endContact(ev) {
    /* The release of a reveal-holding press advances — a reveal press
       never sets `drawing`, so this sits before that guard. */
    if (holdPointer !== null && ev.pointerId === holdPointer) {
      holdPointer = null;
      if (playing && revealing) nextStep();
      return;
    }
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    endContactState();
    if (pending.length - segStart < MIN_SEGMENT) {
      /* a tap, not a stroke — drop just this contact, free, always */
      pending.length = segStart;
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      hint.textContent = wrapLabel() + ' — that was a tap; press the dot and pull across to the ring.';
      updateButtons();
      draw();
      return;
    }
    if (reachedEnd()) { scoreWrapNow(); return; }
    hint.textContent = wrapLabel() + (canFinish()
      ? ' — lift and carry on from where you stopped, or press “score wrap”.'
      : ' — lift and carry on from where you stopped; “clear” starts this one over.');
    updateButtons();
    draw();
  }
  canvas.addEventListener('pointerup', endContact);
  window.addEventListener('pointerup', endContact);

  function cancelContact(ev) {
    /* A CANCELLED holding press is not a deliberate lift — drop the hold
       and hand the beat back in full. */
    if (holdPointer !== null && ev.pointerId === holdPointer) {
      holdPointer = null;
      if (playing && revealing && revealTimer === null && !document.hidden) {
        revealTimer = setTimeout(nextStep, REVEAL_MS);
      }
      return;
    }
    if (!drawing || ev.pointerId !== activePointer) return;
    endContactState();
    if (pending.length - segStart < MIN_SEGMENT) {
      pending.length = segStart;
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
    }
    if (playing && !revealing) {
      hint.textContent = wrapLabel() + ' — stroke interrupted; carry on from where you stopped.';
    }
    updateButtons();
    draw();
  }
  canvas.addEventListener('pointercancel', cancelContact);
  window.addEventListener('pointercancel', cancelContact);
  /* iOS can drop the capture with no pointerup and no pointercancel; without
     this the contact never ends and the wrap can never be finished. */
  canvas.addEventListener('lostpointercapture', cancelContact);

  /* ---- scoring one wrap ---- */
  function scoreWrapNow() {
    var st = station();
    if (!st || !playing || revealing) return;
    var truthPx = pathPx(st.arc);
    var attemptPx = pathPx(pending);
    var aPx = toPx(st.a), bPx = toPx(st.b);
    var span = Math.hypot(bPx.x - aPx.x, bPx.y - aPx.y);
    var judged = judgeWrap(attemptPx, truthPx, tolerancesFor(span, wrapBow(truthPx, aPx, bPx)));
    itemScores.push(judged.score);
    faults.push(judged.fault);
    revealing = {
      truth: st.arc,
      score: Math.round(judged.score),
      words: judged.words
    };
    doneWraps.push(st.arc);
    if (itemScores.length >= WRAPS_PER_ROUND && !roundResult) {
      /* The round is complete NOW. Report before the reveal plays out, so
         "new round" pressed during the hold — or the player closing the
         embed — can never swallow four drawn wraps. finishRound() below is
         presentation only; this is the single report site. */
      roundResult = ArtDaily.report(roundScore(itemScores));
      hudScore.textContent = String(roundResult.score);
      hudBest.textContent = roundResult.best === null ? '–' : String(roundResult.best);
    }
    hint.textContent = wrapLabel() + ' — ' + revealing.score + ' · ' + revealing.words +
      (itemIdx === 0 ? ' The accent line is the circle the form really makes there. Tap for the next wrap.'
                     : ' Tap for the next wrap.');
    updateButtons();
    draw();
    clearTimeout(revealTimer);
    revealTimer = setTimeout(nextStep, REVEAL_MS);
  }

  function nextStep() {
    revealTimer = null;
    holdPointer = null;
    if (!revealing || !playing) return;
    itemIdx += 1;
    if (itemIdx >= WRAPS_PER_ROUND) { finishRound(); return; }
    revealing = null;
    resetStroke();
    hint.textContent = itemHint();
    updateButtons();
    draw();
  }

  /* Presentation only — scoreWrapNow() already reported the round the
     instant the fourth wrap was scored, so every finished round reaches
     ArtDaily.report exactly once even if this never runs. */
  function finishRound() {
    if (!playing) return;
    playing = false;
    clearTimeout(revealTimer);
    revealTimer = null;
    var res = roundResult;
    if (res) {
      hudScore.textContent = String(res.score);
      hudBest.textContent = res.best === null ? '–' : String(res.best);
      hint.textContent = 'round done — ' + res.score + ' out of 100. ' + coachLine(faults) +
        (res.isFirst ? ' That is your bar now — press “new round” and beat it.' : ' Press “new round” to go again.');
      showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
              : res.isNewBest ? 'new best! ' + res.score + ' / 100'
              : 'score ' + res.score + ' / 100',
        res.isNewBest && !res.isFirst);
    } else {
      hint.textContent = 'round done — ' + coachLine(faults) + ' Press “new round” to go again.';
    }
    updateButtons();
    draw();
  }

  function newRound() {
    clearTimeout(revealTimer);
    revealTimer = null;
    holdPointer = null;
    /* A round whose fourth wrap was scored but is still sitting on its
       reveal was already banked at that score — close it out on screen
       before the reset, so an impatient press is never a silent loss. */
    if (playing && roundResult) finishRound();
    round += 1;
    itemIdx = 0;
    itemScores = [];
    faults = [];
    doneWraps = [];
    roundResult = null;
    revealing = null;
    resetStroke();
    endContactState();
    playing = true;
    /* A random form whose wraps would come out too narrow to draw is
       rerolled, and the last resort is the round-one spec, which is the one
       the node harness pins — so a round can never open with no form on the
       sheet and no way to finish. */
    /* Re-seeded for THIS round, before a single value is drawn — and the
       form cache is cleared with it below, so a new round can never repaint
       the last one's solid. */
    seedRoundRng();
    var built = null, tries = 0;
    while (!built && tries < 8) { built = buildScene(makeSpec(round + tries)); tries += 1; }
    if (!built) built = buildScene(makeSpec(1));
    if (!built) scene = null;
    formCache = null;
    fitScene();
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();
    hint.textContent = scene ? itemHint() : 'could not build a form — press “new round”.';
    updateButtons();
    draw();
  }

  function updateButtons() {
    var live = playing && !revealing && !!scene;
    btnFinish.disabled = !(live && canFinish());
    btnUndo.disabled = !(live && pending.length > 0);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  function showToast(msg, celebrate) {
    clearTimeout(toastTimer);
    /* unhidden BEFORE the text lands, or a live region is never announced */
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

  btnFinish.addEventListener('click', function () {
    if (drawing || !playing || revealing || !canFinish()) return;
    scoreWrapNow();
  });

  btnUndo.addEventListener('click', function () {
    if (drawing || !playing || revealing || !pending.length) return;
    resetStroke();
    hint.textContent = wrapLabel() + ' — cleared. Start again from the dot.';
    updateButtons();
    draw();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { formCache = null; draw(); });
  /* the hardware changed: the dot, the finish ring and the tolerances move */
  ArtDaily.onInput(function () { updateButtons(); draw(); });

  function onResize() {
    if (!fitCanvas()) { return; }
    if (drawing) {
      /* the sheet re-fitted under a live contact (a rotation) — end just
         that contact, keep the ink, no penalty */
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
      endContactState();
      pending.length = Math.min(pending.length, segStart);
      if (!pending.length) { pendingPress = null; pendingMissed = false; }
      if (playing && !revealing) {
        hint.textContent = wrapLabel() + ' — the sheet changed size; carry on from the dot.';
      }
    }
    fitScene();
    formCache = null;
    updateButtons();
    draw();
  }
  window.addEventListener('resize', onResize);
  /* also catches the canvas measuring 0 at boot and getting its real width
     a frame later (opened in a background tab, or laid out late) */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
