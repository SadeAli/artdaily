/* ============================================================
   game.js — Rotate & Place. A small panel shows an elongated box
   (2:1:1.4, one face carries a painted dot) frozen at a hidden
   yaw/pitch. Drag the big box — horizontal = yaw around world Y,
   vertical = pitch around screen X — until the poses match, then
   lock it in. Score is the angle of the relative rotation between
   the two orientations; the reveal ghosts the target over your box
   so the delta is visible. Five boxes per round, ramping from
   near-canonical views to rear-quarter extreme tilts.

   The box is a real solid seen through a real pinhole camera: the
   eye sits at (0,0,CAM_D) and every vertex divides by its depth,
   so parallel edges converge exactly as they do in a drawing.
   Faces are culled by the true eye-side test (CAM_D·n_z > half
   extent) and shaded by a real light vector against real normals.
   Scoring stays pure rotation math — no canvas, no DOM.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'rotate-place';
  var ITEMS_PER_ROUND = 5;
  var PITCH_LIMIT = 85;          /* keep the turntable away from gimbal flip */
  var DRAG_DEG_PER_PX = 0.5;
  var GHOST_SCAFFOLD_ITEMS = 2;  /* round 1 only — see draw() */
  var SCORE_ZERO_DEG = 40;       /* rotation error that scores zero */
  var LOCK_MS = 350;             /* a double-tap must never skip a reveal */

  /* Half extents → W:H:D = 2:1:1.4, and the eye distance in those same
     units: a long lens — far enough that the dot face still reads at
     steep poses, near enough to converge visibly. Measured, not guessed:
     the projection scale runs 9/(9−z) so it spreads 1.34× across the
     solid, and at a three-quarter view the near vertical edge comes out
     about 30% longer than its far twin — the convergence a drawn box
     shows. */
  var HX = 1.0, HY = 0.5, HZ = 0.7;
  var CAM_D = 9;
  var DOT_R = 0.24;              /* painted dot radius, on the +Z face */
  var DOT_MARGIN = 0.06;         /* how decisively the dot must show/hide */

  /* ============================================================
     pure scoring math — no canvas, no DOM. Poses are (yawDeg,
     pitchDeg); matrices are row-major arrays of 9.
     ============================================================ */

  function deg2rad(d) { return d * Math.PI / 180; }

  function rotY(deg) {
    var a = deg2rad(deg), c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }

  function rotX(deg) {
    var a = deg2rad(deg), c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }

  function matMul(a, b) {
    var m = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        m[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
      }
    }
    return m;
  }

  function transpose(a) {
    return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  }

  /* Turntable pose: yaw about world Y first, then pitch about the
     screen X axis — matches how the drag handlers feel. */
  function composeRot(yawDeg, pitchDeg) {
    return matMul(rotX(pitchDeg), rotY(yawDeg));
  }

  /* Angle of the relative rotation Ra' * Rb, in degrees. The trace
     can drift a hair past ±1 in floating point, so clamp before acos. */
  function angleErrDeg(ra, rb) {
    var m = matMul(transpose(ra), rb);
    var t = (m[0] + m[4] + m[8] - 1) / 2;
    return Math.acos(Math.max(-1, Math.min(1, t))) * 180 / Math.PI;
  }

  /* 0° off = 100 … SCORE_ZERO_DEG × ease off (or worse) = 0, linear
     between. The pose IS the drag here — yaw and pitch are accumulated
     pointer deltas — so the miss carries a real motor component and the
     window is eased for the hardware in hand. An exact match is 100 on
     every device, and lock still snaps to whole degrees so it is
     reachable by drag.
     A non-finite error can only come from a broken pointer event, but
     Math.min/Math.max propagate NaN, and a NaN would reach the HUD and
     the toast as the literal text "NaN" — so it is read as a total
     miss instead. The result is always a number in 0–100. */
  function itemScore(angErr, ease) {
    var k = (typeof ease === 'number' && isFinite(ease) && ease > 0) ? ease : 1;
    var zero = SCORE_ZERO_DEG * k;
    /* THE GUARD BELOW COULD MANUFACTURE THE NaN IT EXISTS TO PREVENT.
       k is checked finite and positive, but the PRODUCT need not be: a huge
       finite ease overflows SCORE_ZERO_DEG * k to Infinity, and then
       "a miss we cannot measure is a total miss" sets e = zero and the
       return is Infinity / Infinity = NaN — from the one line written to
       stop a NaN reaching the HUD. A zero-point that is not a real width is
       not a zero-point; fall back to the unscaled one. */
    if (!isFinite(zero) || !(zero > 0)) zero = SCORE_ZERO_DEG;
    var e = Number(angErr);
    if (!isFinite(e)) e = zero;
    return 100 * Math.max(0, Math.min(1, 1 - e / zero));
  }

  /* Mean of the boxes locked so far. itemScore can only hand this finite
     0–100 values, but this number goes straight to ArtDaily.report and from
     there into the permanent personal best — and this mean had no
     sanitizing layer at all, so a single bad item would print the literal
     text "NaN" on the HUD and store it as a best that no round could ever
     beat. Clamped as well as checked, for the same reason vp-hunt,
     horizon-read and anatomy-spot clamp theirs: "3e+307 / 100" reads no
     better than "NaN". The identity on every value this drill has ever
     produced. */
  function roundScore(items) {
    if (!items.length) return 0;
    var s = 0, v;
    for (var i = 0; i < items.length; i++) {
      v = items[i];
      s += (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(100, v)) : 0;
    }
    return s / items.length;
  }

  /* Math.min/Math.max propagate NaN, so a single non-finite pointer delta
     used to poison the pose for good: every vertex projects to NaN, the
     box disappears off the sheet, and there is no gesture that brings it
     back — itemScore floors the miss at 0 but the player is left staring
     at an empty card with no way out but "new round". A pose that is not
     a number is not a pose; fall back to flat. */
  function clampPitch(p) {
    var v = Number(p);
    if (!isFinite(v)) return 0;
    return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v));
  }

  /* Keyboard nudges snap to the nearest whole degree then step —
     targets are whole degrees, so an exact 100 is reachable. */
  function nudge(value, stepDeg) {
    var v = Number(value);
    return (isFinite(v) ? Math.round(v) : 0) + (isFinite(stepDeg) ? stepDeg : 0);
  }

  /* Every lock snaps to whole degrees too, so a touch player who cannot
     land sub-degree drags can still score an honest 100. Worst case it
     moves a score by ~1 point, and always toward the grid the targets
     live on. */
  function snapPose(p) {
    return { yaw: Math.round(p.yaw), pitch: clampPitch(Math.round(p.pitch)) };
  }

  /* Shortest signed way from a to b, in (−180, 180]. */
  function wrapDeg(d) {
    var w = ((d + 180) % 360 + 360) % 360 - 180;
    return w === -180 ? 180 : w;
  }

  /* True pinhole face test: the eye at (0,0,CAM_D) sees a face when it
     lies on the outward side of that face's plane. For an axis face
     whose centre is `half` along its own normal, that reduces exactly
     to CAM_D·n_z > half — no orthographic hand-wave. */
  function faceVisible(nz, half) {
    return CAM_D * nz > half;
  }

  /* World-z of the dot face's normal at a pose: cos(pitch)·cos(yaw). */
  function dotNormalZ(yawDeg, pitchDeg) {
    return Math.cos(deg2rad(pitchDeg)) * Math.cos(deg2rad(yawDeg));
  }

  function dotVisible(yawDeg, pitchDeg) {
    return faceVisible(dotNormalZ(yawDeg, pitchDeg), HZ);
  }

  /* Rotating a cuboid 180° about its own Y maps its vertex set onto
     itself, so (yaw, pitch) and (yaw+180, pitch) project to the SAME
     outline — under perspective every bit as much as under ortho. The
     painted dot is the only tell, and it only tells when one twin shows
     it clearly: |n_z| must clear the visibility threshold HZ/CAM_D by a
     margin, or both twins hide it and an honest match is a coin flip.
     Walk |yaw| away from edge-on (which only ever increases |cos|) until
     it does. Pure, bounded, whole degrees. */
  function avoidDotSliver(yawDeg, pitchDeg) {
    var sign = yawDeg < 0 ? -1 : 1;
    var a = Math.abs(yawDeg);
    var step = (a >= 90) ? 1 : -1;
    var need = HZ / CAM_D + DOT_MARGIN;
    var best = a, bestV = Math.abs(dotNormalZ(a, pitchDeg));
    for (var i = 0; i < 90 && bestV < need; i++) {
      a += step;
      var v = Math.abs(dotNormalZ(a, pitchDeg));
      if (v > bestV) { bestV = v; best = a; }
    }
    return sign * best;
  }

  /* ============================================================
     drill state + rendering
     ============================================================ */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnLock = document.getElementById('btnLock');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks ----
     getComputedStyle() on the root forces a style resolve, and this ran at
     the top of every repaint — i.e. once per pointer sample while the box
     is under the hand — along with two hex parses per solid box (card and
     ink, for the face mix) and a readable() mix per stamp. The tokens only
     move when the sheet flips theme, so they are cached against
     data-theme: the cache invalidates itself the moment that attribute
     changes, so onTheme still repaints in the new colours. */
  var inkCache = null, inkKey = null;
  function inks() {
    var key = document.documentElement.dataset.theme || '';
    if (inkCache && inkKey === key) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var c = {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      line: cs.getPropertyValue('--line').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--lilac').trim(),
    };
    c.cardRgb = hexRgb(c.card) || [253, 250, 241];
    c.inkRgb = hexRgb(c.ink) || [51, 41, 30];
    c.darkSheet = (0.299 * c.cardRgb[0] + 0.587 * c.cardRgb[1] + 0.114 * c.cardRgb[2]) < 128;
    var m = hexRgb(c.muted);
    c.soft = m ? mixColor(m, c.inkRgb, 0.45) : c.ink;
    inkKey = key;
    inkCache = c;
    return c;
  }

  /* Face shading needs in-between tones the tokens don't provide,
     so mix card→ink numerically (tokens are #RRGGBB in both themes). */
  function hexRgb(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixColor(fromRgb, toRgb, t) {
    var r = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * t);
    var g = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * t);
    var b = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* Muted alone sits just under 4.5:1 on paper — ink it toward graphite
     so anything meaning-bearing clears AA on both sheets. Mixed once per
     theme in inks(). */
  function readable(c) { return c.soft || c.ink; }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ----
     Returns true only when the sheet really changed. Assigning
     canvas.width reallocates and clears the backing store, and on a phone
     `resize` fires on every address-bar nudge. */
  var W = 0, H = 0, fitDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var dpr = window.devicePixelRatio || 1;
    if (w === W && dpr === fitDpr) return false;
    W = w;
    H = Math.round(W * 0.62);
    fitDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- one repaint per frame ----
     A pointermove can land two or three times inside one displayed frame,
     and each one used to redraw two solid boxes (six culled faces, a
     33-point projected dot each) plus the panel. Only the last is ever
     shown. Folding them into one rAF paints on the same vsync and stops
     the turntable feeling like it is being turned through treacle. */
  var drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () { drawQueued = false; draw(); });
  }

  var VERTS = [
    [-HX, -HY, -HZ], [HX, -HY, -HZ], [HX, HY, -HZ], [-HX, HY, -HZ],
    [-HX, -HY, HZ], [HX, -HY, HZ], [HX, HY, HZ], [-HX, HY, HZ],
  ];
  /* `half` is how far that face's centre sits along its own normal —
     the only extra number the true eye-side test needs. */
  var FACES = [
    { n: [0, 0, 1], half: HZ, v: [4, 5, 6, 7] },
    { n: [0, 0, -1], half: HZ, v: [1, 0, 3, 2] },
    { n: [1, 0, 0], half: HX, v: [5, 1, 2, 6] },
    { n: [-1, 0, 0], half: HX, v: [0, 4, 7, 3] },
    { n: [0, 1, 0], half: HY, v: [7, 6, 2, 3] },
    { n: [0, -1, 0], half: HY, v: [0, 1, 5, 4] },
  ];
  var EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  /* From upper front-left, normalised at load rather than by hand — the
     hand-picked triple was 1.0013 long, and the face mix below trusts
     lambert to stay inside [0, 1]. */
  var LIGHT = (function (v) {
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / m, v[1] / m, v[2] / m];
  })([0.35, 0.55, 0.76]);

  function apply(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }

  /* Pinhole: eye at (0,0,CAM_D) looking down −Z, image plane through the
     box centre, screen x right and screen y down (world y up). Depth
     never reaches the eye (|v| ≤ 1.32 ≪ CAM_D), so no near clipping. */
  function project(p, cx, cy, s) {
    var k = CAM_D / (CAM_D - p[2]);
    return { x: cx + p[0] * s * k, y: cy - p[1] * s * k };
  }

  function layout() {
    /* The target panel used to render the thing you are matching at a
       28-39px half-extent against a player box 4-5× that size. Reading
       across that gap is a perceptual tax on top of the actual task, so
       the panel — and the box inside it — are bigger. */
    var pw = Math.max(150, Math.min(200, W * 0.30));
    var panel = { x: W - pw - 10, y: 10, w: pw, h: pw * 0.8 };
    var free = Math.max(60, panel.x - 10);   /* sheet left of the panel */
    return {
      panel: panel,
      targetScale: pw * 0.26,
      /* the player box lives entirely left of the target panel, at every
         width — on a phone the two used to overlap */
      cx: free * 0.5,
      cy: H * 0.55,
      playerScale: Math.min(H * 0.30, free * 0.36),
    };
  }

  /* Solid box: eye-side cull, shade by lambert against the real normal.
     On the dark sheet ink is lighter than card, so lit faces mix
     toward ink; on paper it's shadow faces — value order stays true
     to the light in both themes. */
  function drawSolidBox(m, cx, cy, s, c, lineW) {
    var cardRgb = c.cardRgb, inkRgb = c.inkRgb, darkSheet = c.darkSheet;
    var i, j, f, n, lam, pts, p;
    ctx.lineJoin = 'round';
    for (i = 0; i < FACES.length; i++) {
      f = FACES[i];
      n = apply(m, f.n);
      if (!faceVisible(n[2], f.half)) continue;
      lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      pts = [];
      for (j = 0; j < 4; j++) pts.push(project(apply(m, VERTS[f.v[j]]), cx, cy, s));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (j = 1; j < 4; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.closePath();
      ctx.fillStyle = mixColor(cardRgb, inkRgb, 0.05 + 0.22 * (darkSheet ? lam : 1 - lam));
      ctx.fill();
      ctx.lineWidth = lineW;
      ctx.strokeStyle = c.ink;
      ctx.stroke();
    }
    /* painted dot on the +Z face — a circle in the face plane, projected
       point by point, so it foreshortens (and skews off-axis) honestly.
       The dot is the whole tell for which face you are looking at, so it
       cannot lean on the accent alone: lilac on a shaded face bottoms out
       near 2:1 on paper. The ink rim carries the shape (8:1 or better in
       both themes) and the accent just colours it. */
    n = apply(m, [0, 0, 1]);
    if (faceVisible(n[2], HZ)) {
      ctx.beginPath();
      for (i = 0; i <= 32; i++) {
        var a = i / 32 * Math.PI * 2;
        p = project(apply(m, [DOT_R * Math.cos(a), DOT_R * Math.sin(a), HZ]), cx, cy, s);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = c.accent;
      ctx.fill();
      ctx.lineWidth = Math.max(1.25, lineW * 0.85);
      ctx.strokeStyle = c.ink;
      ctx.stroke();
    }
  }

  /* Reveal ghost: dashed accent wireframe of the target pose over the
     player's box. The dot rim is drawn even when its face points away
     (faded) — item 5 hides it on purpose, the reveal should not.

     The ghost is the lesson, so it may not fade into whatever it lands
     on: accent on the paper card is 3.5:1, but accent on a shaded face
     of the player's own box falls to ~2:1. Every ghost path is therefore
     stroked twice — a fat card-coloured halo first, the accent on top —
     so the line always reads against card, in both themes. Stroking
     leaves the path intact, so the halo lines up exactly, dashes and
     all. */
  function ghostStroke(c) {
    ctx.strokeStyle = c.card;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /* alphaScale lets the aim-phase scaffold draw the same ghost faintly
     without the dot's own alpha stomping the outer setting. */
  function drawGhostBox(m, cx, cy, s, c, alphaScale) {
    var i, a, b, p;
    var k = (typeof alphaScale === 'number' && isFinite(alphaScale)) ? alphaScale : 1;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    for (i = 0; i < EDGES.length; i++) {
      a = project(apply(m, VERTS[EDGES[i][0]]), cx, cy, s);
      b = project(apply(m, VERTS[EDGES[i][1]]), cx, cy, s);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ghostStroke(c);
    ctx.setLineDash([]);
    var n = apply(m, [0, 0, 1]);
    ctx.globalAlpha = k * (faceVisible(n[2], HZ) ? 1 : 0.35);
    ctx.beginPath();
    for (i = 0; i <= 32; i++) {
      a = i / 32 * Math.PI * 2;
      p = project(apply(m, [DOT_R * Math.cos(a), DOT_R * Math.sin(a), HZ]), cx, cy, s);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ghostStroke(c);
    ctx.restore();
  }

  function drawPanel(c, L) {
    var p = L.panel;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(p.x, p.y, p.w, p.h, 8);
    else ctx.rect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = c.card;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.line;
    ctx.stroke();
    ctx.fillStyle = readable(c);
    ctx.font = '700 15px Caveat, cursive';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('target', p.x + 8, p.y + 4);
    ctx.restore();
    if (target) {
      drawSolidBox(composeRot(target.yaw, target.pitch),
        p.x + p.w / 2, p.y + p.h / 2 + 6, L.targetScale, c, 1.5);
    }
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, scores = [], playing = false;
  var phase = 'idle';            /* 'aim' | 'reveal' | 'done' */
  var pose = { yaw: 0, pitch: 0 };
  var target = null;
  var lastErr = 0, lastScore = 0, lastYawOff = 0, lastPitchOff = 0;
  var lastFlip = 0;              /* time of the last phase change */

  /* Difficulty ramp: item 1 hugs the canonical 3/4 view; item 5 is a
     rear-quarter view under a steep tilt. Whole degrees so keyboard
     nudges can land exactly. The steepest tilt stops at 72° because
     past that the dot face grazes the eye at every yaw, and a target
     whose dot cannot decisively show or hide is a coin flip between
     180° twins — unfair, whatever the player's eye is worth. */
  var RAMP = [
    { yaw: [15, 35], pitch: [8, 20], negPitch: false },
    { yaw: [30, 60], pitch: [12, 30], negPitch: true },
    { yaw: [55, 95], pitch: [18, 42], negPitch: true },
    { yaw: [90, 140], pitch: [30, 60], negPitch: true },
    { yaw: [120, 170], pitch: [50, 72], negPitch: true },
  ];

  /* ---- where a box's numbers come from ---------------------------------
     THE ITEM'S CONTENT IS A SEQUENCE OF DRAWS, and this drill is the one
     in the chapter where that sequence is the WHOLE item: yaw and pitch are
     whole degrees, the target and the opening pose are both angles, and the
     canvas never enters the generation at all. So today's five boxes are
     bit-for-bit the same five boxes on a phone and on a desktop, and a
     score off them is finally a number with a denominator. Round 1 of a
     sitting is today's shared round; round 2 and on are practice — same
     generator, same distribution, unshared seed.

     ONE STREAM PER BOX, asked for at the moment the box is built, which is
     the shape the SDK documents for an item index: the five boxes are dealt
     one at a time, and box 4 must be box 4 whatever boxes 1–3 spent. (Both
     branches that skip a draw — the non-negative pitch on item 1, and
     avoidDotSliver's nudge — depend on the item index and on values already
     drawn, never on the sheet, so nothing here can diverge between two
     players anyway.) */
  var itemRng = Math.random;

  /* GUARDED, and the guard is load-bearing: index.html cache-busts its own
     scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache independently. A returning visitor with a warm old
     SDK and a cold copy of this file would call a function that does not
     exist, and startItem would throw before the first box was posed —
     blank sheet, HUD at "–". Falling back to Math.random costs today's
     player nothing but a non-comparable round, which is what they had
     yesterday, and it self-heals when the SDK's max-age expires. */
  function seedItemRng() {
    itemRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round, itemIdx)
      : Math.random;
  }

  /* Both unchanged as functions — the same expressions they always were,
     with Math.random() swapped for the item's uniform, which is uniform on
     [0,1) just the same. Same rounding, same inclusive ends, same coin: a
     seeded box is not an easier or a harder box. */
  function randInt(lo, hi) { return lo + Math.floor(itemRng() * (hi - lo + 1)); }
  function randSign() { return itemRng() < 0.5 ? -1 : 1; }

  function targetForItem(idx) {
    var r = RAMP[Math.min(idx, RAMP.length - 1)];
    var pitch = (r.negPitch ? randSign() : 1) * randInt(r.pitch[0], r.pitch[1]);
    return {
      yaw: avoidDotSliver(randSign() * randInt(r.yaw[0], r.yaw[1]), pitch),
      pitch: pitch,
    };
  }

  function startItem() {
    /* Re-seeded for THIS box, before a single value is drawn. */
    seedItemRng();
    /* Never open dead flat: a front-on rectangle carries almost no 3D
       information, so the first thing a beginner saw was not a box. */
    pose = { yaw: randSign() * randInt(8, 14), pitch: randInt(4, 8) };
    target = targetForItem(itemIdx);
    dragId = null;  /* a stuck pointer must never outlive one box */
    axisLock = null;
    phase = 'aim';
    btnLock.textContent = 'lock it in';
    /* Box 1 used to arrive carrying every control the drill owns — drag,
       arrows, shift-fine, shift-axis-lock, alt-axis-lock and the dot — in
       one 50-word wall, before the player had moved a thing. Nobody wants
       the axis lock until they have felt one axis wreck the other, which
       is box 2. Teach the verb and the dot first; hand over the precision
       tools at the moment the hand starts asking for them. */
    /* NAME SOMETHING THAT IS ACTUALLY ON THE SHEET. Every box said "match
       the dashed target", but the dashed ghost is drawn during aim only
       for the first two boxes of a first round — from box 3 on, and on
       every box of every later round, the sole target is the SOLID box in
       the panel marked "target" and nothing dashed exists until the
       reveal. A beginner on box 3 was being told to match a thing that is
       not there. Say which mark is meant, either way. */
    var targetWord = (round === 1 && itemIdx < GHOST_SCAFFOLD_ITEMS)
      ? 'until it matches the dashed ghost drawn over it — that is the pose in the target panel'
      : 'until it matches the box in the “target” panel';
    hint.textContent = 'box ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — drag sideways to spin it, up and down to tip it, ' + targetWord + '. then lock it in.' +
      (itemIdx === 1
        ? ' fixing one axis and wrecking the other? hold shift while dragging to spin only, alt to tip only — and shift+arrows step 5°.'
        : '') +
      (itemIdx === 0
        ? ' arrow keys nudge 1° if you would rather not drag. the dot marks the box\u2019s front face.'
        : '') +
      (dotVisible(target.yaw, target.pitch) ? ''
        : ' no dot in the target — you are looking at its back, so spin past 90°.');
    draw();
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    scores = [];
    playing = true;
    lastFlip = 0;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    btnLock.hidden = false;
    startItem();
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!target) return;
    var L = layout();
    drawPanel(c, L);
    /* THE TARGET GHOST IS DRAWN DURING AIM TOO. Playing from memory of a
       28-39px thumbnail turned an alignment task into a memory task, and
       memory is not what this drill teaches. Faint under the player's own
       box while aiming, full weight on the reveal — and only for the
       first two boxes of a first round, because turning the box in your
       head IS the skill; the scaffold is there to show a beginner what
       "matching" even means, then it steps out of the way. */
    if (phase === 'aim' && round === 1 && itemIdx < GHOST_SCAFFOLD_ITEMS) {
      drawGhostBox(composeRot(target.yaw, target.pitch), L.cx, L.cy, L.playerScale, c, 0.28);
    }
    drawSolidBox(composeRot(pose.yaw, pose.pitch), L.cx, L.cy, L.playerScale, c, 2);
    if (phase === 'reveal' || phase === 'done') {
      drawGhostBox(composeRot(target.yaw, target.pitch), L.cx, L.cy, L.playerScale, c);
      drawStamp(c);
    }
  }

  /* The score, on the sheet where the eyes already are. It carries its
     own card chip for two reasons: it lands on the box at phone widths,
     where bare ink over a shaded face is not something to gamble on, and
     the toast owns the canvas's top-left corner for 2.2s after every
     lock — sharing that corner meant the sticker covered the very number
     it was announcing. Bottom-left is free in both layouts (the lock
     button parks bottom-right, and steps off the canvas entirely on
     narrow sheets). */
  function drawStamp(c) {
    var l1 = 'Δ ' + lastErr.toFixed(1) + '° · ' + Math.round(lastScore) + ' / 100';
    /* THE STAMP WAS THE ONLY PLACE THE DRILL SAID "YAW" AND "PITCH".
       Both words are defined exactly once, inside "how to play" — the panel
       a beginner opens after being confused, not before — while every hint
       the drill writes says "spin" and "tip" instead. The stamp is also the
       thing read FIRST: it sits on the sheet the eyes are already on, above
       the sentence. So it said one vocabulary and the sentence beside it
       said another, on the first reveal a player ever sees. It now uses the
       drill's own two verbs, and carries the same direction word as the
       hint rather than a bare sign — "+5°" does not tell anyone that plus
       means right. */
    var l2 = 'spin ' + offWord(lastYawOff, 'left', 'right') +
      ' · tip ' + offWord(lastPitchOff, 'up', 'down');
    ctx.save();
    ctx.font = '700 14px "Cascadia Code", Menlo, Consolas, monospace';
    var w1 = ctx.measureText(l1).width;
    ctx.font = '700 12px "Cascadia Code", Menlo, Consolas, monospace';
    var w2 = ctx.measureText(l2).width;
    var w = Math.max(w1, w2) + 20, h = 46;
    var x = 10, y = H - h - 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
    ctx.fillStyle = c.card;
    ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = c.ink;
    ctx.font = '700 14px "Cascadia Code", Menlo, Consolas, monospace';
    ctx.fillText(l1, x + 10, y + 6);
    ctx.fillStyle = readable(c);
    ctx.font = '700 12px "Cascadia Code", Menlo, Consolas, monospace';
    ctx.fillText(l2, x + 10, y + 26);
    ctx.restore();
  }

  /* "5° right" — magnitude plus the way to move, in whole degrees. Shared
     by the hint sentence and the on-sheet stamp so the two can never
     disagree. A non-finite offset can only come from a broken pointer
     event, and it must not become the text "NaN° right". */
  function offWord(v, neg, pos) {
    var r = Math.round(v);
    if (!isFinite(r) || r === 0) return '0°';
    return Math.abs(r) + '° ' + (r > 0 ? pos : neg);
  }

  /* "off by 7.2° — spin 5° right, tip 4° up." Direction words, because
     a bare magnitude tells a player nothing about which habit to fix. */
  function coachText() {
    var parts = [];
    if (Math.round(lastYawOff) !== 0) parts.push('spin ' + offWord(lastYawOff, 'left', 'right'));
    if (Math.round(lastPitchOff) !== 0) parts.push('tip ' + offWord(lastPitchOff, 'up', 'down'));
    return parts.length ? parts.join(', ') : 'dead on';
  }

  /* ---- lock / advance ---- */
  function lockOrNext() {
    /* debounce: on a phone "lock it in" and "next box" share a spot, and
       a routine double-tap used to skip the reveal entirely */
    var now = Date.now();
    if (now - lastFlip < LOCK_MS) return;
    lastFlip = now;

    if (phase === 'aim') {
      disarmAbandon();  /* a box just landed — any pending "sure?" is stale */
      pose = snapPose(pose);
      lastErr = angleErrDeg(composeRot(pose.yaw, pose.pitch), composeRot(target.yaw, target.pitch));
      lastScore = itemScore(lastErr, ArtDaily.ease(1));
      lastYawOff = wrapDeg(target.yaw - pose.yaw);
      lastPitchOff = target.pitch - pose.pitch;
      scores.push(lastScore);
      phase = 'reveal';
      var isLast = itemIdx === ITEMS_PER_ROUND - 1;
      btnLock.textContent = isLast ? 'finish round' : 'next box';
      hint.textContent = 'off by ' + lastErr.toFixed(1) + '° — ' + coachText() + '. ' +
        Math.round(lastScore) + '/100; the dashed ghost is the target pose.';
      /* running mean, so the HUD is alive from box 1 instead of sitting
         on "–" until the round ends */
      hudScore.textContent = String(Math.round(roundScore(scores)));
      /* The round is complete the moment the fifth box locks — report
         right here, exactly once, so clicking "new round" during the
         last reveal can never drop a finished round's score. */
      if (isLast) reportRound();
      draw();
    } else if (phase === 'reveal') {
      itemIdx += 1;
      if (itemIdx < ITEMS_PER_ROUND) startItem();
      else finishRound();
    }
  }

  function reportRound() {
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  function finishRound() {
    playing = false;
    phase = 'done';
    btnLock.hidden = true;
    hint.textContent = 'round done — press “new round” to go again.';
    draw(); /* keep the last reveal on the sheet — it is the lesson */
  }

  /* Abandoning a half-finished round throws away every box locked so
     far (an unfinished round is never reported), so ask once. Once the
     fifth box is locked the round is already in the books — no question
     then, the button just starts the next one. */
  var abandonArmed = false, abandonTimer = null;
  /* The question goes stale the moment the player does something else. It
     used to stay armed for its whole four seconds regardless, so "new round"
     → change your mind → lock another box → "new round" again threw away a
     live round on a SINGLE press, the confirmation having been spent on a
     question asked seconds and a box ago. Locking a box disarms it. */
  function disarmAbandon() {
    clearTimeout(abandonTimer);
    abandonTimer = null;
    abandonArmed = false;
  }
  function requestNewRound() {
    if (playing && scores.length && scores.length < ITEMS_PER_ROUND && !abandonArmed) {
      abandonArmed = true;
      showToast('press again to drop this round', false);
      clearTimeout(abandonTimer);
      abandonTimer = setTimeout(function () { abandonArmed = false; }, 4000);
      return;
    }
    disarmAbandon();
    newRound();
  }

  /* ---- input: one-finger turntable drag, pointerId-guarded ---- */
  var dragId = null, lastX = 0, lastY = 0, lastT = 0, lastPenAt = 0, axisLock = null;

  /* SPEED GAIN. A late target asks for up to 170° of yaw, which at a
     flat 0.5°/px is 340px of travel — two or three lift-and-swipe
     cycles on a trackpad. Slow moves keep the fine 0.5°/px so precision
     work is untouched; fast travel scales up so the long haul is one
     swipe. (Same idea as horizon-read's fine-gain, in the other
     direction.)
     SPEED, NOT STEP SIZE. This used to read "fast" off the pixels in a
     single pointermove, which is not a speed at all — it is a speed times
     the reporting interval of whatever hardware is plugged in. The same
     physical swipe, 300px in 250ms, arrives as 18 steps of ~17px from a
     60Hz mouse (well past the fast threshold, full 2.6× gain) and as 72
     steps of ~4px from a 240Hz one (under the threshold, no gain at all):
     a gaming mouse turned the box less than half as far as a cheap one
     for the identical gesture, and no amount of practice would tell the
     player why. Divide by the time the step actually took and the
     thresholds mean px/ms — the same on every device.
     dt is floored (two samples can share a timestamp) and capped (a
     pause between samples is genuinely slow, but not infinitely so). */
  var FAST_SPEED = 0.55;   /* px per ms — 9px at a 60Hz report rate */
  var RAMP_SPEED = 1.32;   /* …and the old 22px ramp, likewise       */
  var FAST_GAIN = 2.6;
  var DT_MIN = 4, DT_MAX = 64, DT_FALLBACK = 16.7;
  function dragGain(step, dtMs) {
    var a = Math.abs(step);
    if (!isFinite(a)) return DRAG_DEG_PER_PX;
    var dt = (typeof dtMs === 'number' && isFinite(dtMs) && dtMs > 0) ? dtMs : DT_FALLBACK;
    dt = Math.max(DT_MIN, Math.min(DT_MAX, dt));
    var v = a / dt;
    if (v <= FAST_SPEED) return DRAG_DEG_PER_PX;
    var t = Math.min(1, (v - FAST_SPEED) / RAMP_SPEED);
    return DRAG_DEG_PER_PX * (1 + (FAST_GAIN - 1) * t);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (!playing || phase !== 'aim') return;
    /* palm rejection: a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - lastPenAt < 500) return;
    if (dragId !== null) return;
    ev.preventDefault();
    dragId = ev.pointerId;
    lastX = ev.clientX;
    lastY = ev.clientY;
    lastT = (typeof ev.timeStamp === 'number' && isFinite(ev.timeStamp)) ? ev.timeStamp : 0;
    axisLock = null;
    try { canvas.setPointerCapture(dragId); } catch (e) {}
    canvas.focus({ preventScroll: true });
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (dragId !== ev.pointerId || phase !== 'aim') return;
    ev.preventDefault();
    var dx = ev.clientX - lastX;
    var dy = ev.clientY - lastY;
    /* yaw is the one accumulator with no clamp of its own, so a single
       non-finite delta would stick to it forever (clampPitch now catches
       the other half). Drop the sample rather than poison the pose. */
    if (!isFinite(dx) || !isFinite(dy)) return;
    var now = (typeof ev.timeStamp === 'number' && isFinite(ev.timeStamp)) ? ev.timeStamp : lastT + DT_FALLBACK;
    var dt = now - lastT;
    lastX = ev.clientX;
    lastY = ev.clientY;
    lastT = now;
    /* AXIS LOCK. Spin and tip share one free gesture and no trackpad
       swipe is axis-clean, so every correction to one axis disturbed the
       other and the player oscillated. Hold shift for spin only, alt for
       tip only. */
    axisLock = ev.shiftKey ? 'yaw' : (ev.altKey ? 'pitch' : null);
    if (axisLock !== 'pitch') pose.yaw += dx * dragGain(dx, dt);
    if (axisLock !== 'yaw') pose.pitch = clampPitch(pose.pitch + dy * dragGain(dy, dt));
    requestDraw();
  });

  function endDrag(ev) {
    if (dragId !== ev.pointerId) return;
    dragId = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  /* A pointerup the canvas never sees used to freeze the box for the
     whole session, because pointerdown returns early while one is in
     flight — a release off-window, or iOS dropping the capture with
     lostpointercapture instead of ever sending pointerup. */
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  /* Arrows rotate in whole-degree snaps (exact locks are possible);
     enter / space lock and advance. */
  canvas.addEventListener('keydown', function (ev) {
    if (!playing) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      lockOrNext();
      return;
    }
    if (phase !== 'aim') return;
    var step = ev.shiftKey ? 5 : 1;
    if (ev.key === 'ArrowLeft') pose.yaw = nudge(pose.yaw, -step);
    else if (ev.key === 'ArrowRight') pose.yaw = nudge(pose.yaw, step);
    else if (ev.key === 'ArrowUp') pose.pitch = clampPitch(nudge(pose.pitch, -step));
    else if (ev.key === 'ArrowDown') pose.pitch = clampPitch(nudge(pose.pitch, step));
    else return;
    ev.preventDefault();
    /* a held arrow auto-repeats faster than the screen refreshes */
    requestDraw();
  });

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
  document.getElementById('btnRound').addEventListener('click', requestNewRound);
  btnLock.addEventListener('click', lockOrNext);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  /* fitCanvas is a no-op when the sheet did not really change, so an iOS
     address bar sliding away mid-drag no longer reallocates the backing
     store under the hand. */
  window.addEventListener('resize', function () { fitCanvas(); draw(); });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
