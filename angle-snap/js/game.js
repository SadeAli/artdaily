/* ============================================================
   game.js — Angle Snap: the canvas asks for "45° counter-clockwise
   from the reference line", the player presses at the anchor A and
   commits one stroke at that angle by eye. Six strokes per round,
   prompts ramping from 90°/45° down to 15°. Scoring is pure vector
   geometry (least-squares stroke direction vs the target angle) —
   the pure functions sit at the top, unit-testable without a canvas.

   Hardware fairness (protocol v1 input profile):
     · the anchor NEVER refuses a press. Only direction is scored, and
       direction is translation-invariant, so a stroke that starts
       anywhere is slid onto A and graded unchanged. A screenless
       tablet's whole pain here was hitting a 4mm ring blind, six
       times a round;
     · the free zone is the hardware's pointing noise, so it is what
       ArtDaily.ease() scales — and it widens on short pulls, where a
       few px of jitter really is several degrees;
     · a stroke drawn at the right size the wrong way round is named
       as that ("right size, wrong way"), not scored as incompetence.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'angle-snap';
  var STROKES_PER_ROUND = 6;
  var START_BASE = 28;    /* px around A, before the SDK's per-device scaling */
  var MIN_PULL = 40;      /* px of pull below which there is no angle to read */
  var PERFECT_DEG = 2;    /* the eye's own free zone: error inside it is a 100 */
  var PERFECT_MAX_DEG = 8;/* cap, so a 20px pull cannot buy a free 20° */
  var SLOP_PX = 2.5;      /* pointing jitter at each end of the pull, pen-reference */
  var FALLOFF_DEG = 25;   /* error past the free zone that grinds down to 0 */
  var FLIP_DEG = 8;       /* this close to the MIRRORED target = a sign misread */
  var REVEAL_MS = 2000;
  var PEN_LOCKOUT_MS = 700;
  /* difficulty ramp: prompt magnitudes per item index (sign is random) */
  var ANGLE_POOLS = [[90, 45], [90, 45], [60, 30], [60, 30], [30, 15], [30, 15]];

  /* ============================================================
     Pure scoring — vectors in, 0–100 out. No canvas, no DOM.
     All vectors are screen coordinates (y grows downward); a
     positive signed angle means counter-clockwise as the artist
     sees it, which is why signedAngleDeg negates atan2.
     `ease` is the multiplier from ArtDaily.ease(1).
     ============================================================ */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function wrap180(deg) {
    var d = deg % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  /* Angle from ref to stroke in degrees, (-180, 180], + = visual CCW. */
  function signedAngleDeg(ref, stroke) {
    var dot = ref.x * stroke.x + ref.y * stroke.y;
    var cross = ref.x * stroke.y - ref.y * stroke.x;
    return -Math.atan2(cross, dot) * 180 / Math.PI;
  }

  /* Least-squares (principal-axis) direction of the samples, oriented
     from the first sample toward the last — the direction of the drag.
     Returns null when there is no usable spread. */
  function fitDirection(points) {
    var n = points.length;
    if (n < 2) return null;
    var i, mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += points[i].x; my += points[i].y; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0, dx, dy;
    for (i = 0; i < n; i++) {
      dx = points[i].x - mx; dy = points[i].y - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (!isFinite(sxx + sxy + syy)) return null;
    if (sxx === 0 && syy === 0) return null;
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var d = { x: Math.cos(theta), y: Math.sin(theta) };
    var ddx = points[n - 1].x - points[0].x, ddy = points[n - 1].y - points[0].y;
    if (d.x * ddx + d.y * ddy < 0) { d.x = -d.x; d.y = -d.y; }
    return d;
  }

  /* |signedAngle(ref, stroke) − target|, wrapped to [0, 180]. */
  function angleErrorDeg(refDir, strokeDir, targetDeg) {
    return Math.abs(wrap180(signedAngleDeg(refDir, strokeDir) - targetDeg));
  }

  /* SIGNED error, degrees: + = the stroke landed counter-clockwise of the
     true ray, − = clockwise of it. Same magnitude as angleErrorDeg. */
  function signedErrorDeg(refDir, strokeDir, targetDeg) {
    return wrap180(signedAngleDeg(refDir, strokeDir) - targetDeg);
  }

  /* The delta in words. "off by 12°" is a number with no instruction in
     it: turn further or turn back? The amber ray answers that on the
     canvas, so the sentence should answer it too — and the turn is named
     with the same two words the prompt uses, never a sign glyph.

     `score` is the very number this sentence is printed beside. Pass it and an
     attempt the drill has ALREADY called perfect keeps the perfect wording:
     strokeScore is a flat 100 anywhere inside the free zone AND still rounds
     to 100 for an eighth of a degree past it, so the two readings parted
     company in that sliver. Measured over 300,000 sampled pulls across all
     three input modes, 0.50% of attempts printed "4° counter-clockwise of the
     amber ray, score 100" — the drill arguing with itself inside one sentence,
     which teaches the player to stop trusting whichever half they like less.
     (lines/game.js carries the same guard for its own "dead straight".) */
  function offWords(signedErr, zoneDeg, score) {
    var a = Math.abs(signedErr);
    if (!isFinite(a)) return '';
    if (a <= zoneDeg || score >= 100) return 'dead on';
    return (a < 10 ? Math.round(a * 10) / 10 : Math.round(a)) + '° ' +
      (signedErr > 0 ? 'counter-clockwise' : 'clockwise') + ' of the amber ray';
  }

  /* Error against the MIRRORED target: small here and large above means
     the angle was judged correctly and the sign was misread. */
  function mirrorErrorDeg(refDir, strokeDir, targetDeg) {
    return Math.abs(wrap180(signedAngleDeg(refDir, strokeDir) + targetDeg));
  }

  /* The free zone.

     What this drill scores is a DIRECTION, fitted by least squares over
     every sample of the pull, so smoothness, wobble and speed fall out
     of the maths entirely — a shaky mouse line and a ruler-straight
     tablet line with the same principal axis score identically, which
     is why the falloff below is NOT eased: it measures the eye, and the
     eye is the same on every desk.

     What the hardware does touch is the pointing jitter at the two ends
     of the pull. ±2.5px of jitter is ±3.6° over a 40px pull and ±1.2°
     over a 120px one, and a mouse or trackpad jitters about twice as
     far as a pen nib. THAT is what the free zone must absorb, so that
     is what ArtDaily.ease() scales — the drill stops accepting a pull
     it then statistically punishes. */
  function perfectZoneDeg(pullPx, ease) {
    var slop = (ease > 0 ? ease : 1) * SLOP_PX;
    var noise = Math.atan2(slop, Math.max(1, pullPx || 0)) * 180 / Math.PI;
    var z = PERFECT_DEG + noise;
    return z > PERFECT_MAX_DEG ? PERFECT_MAX_DEG : z;
  }

  function strokeScore(angErrDeg, pullPx, ease) {
    if (!isFinite(angErrDeg)) return 0;
    var err = Math.max(0, angErrDeg - perfectZoneDeg(pullPx, ease));
    return 100 * clamp01(1 - err / FALLOFF_DEG);
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    var v = sum / scores.length;
    return isFinite(v) ? v : 0;
  }

  /* ============================================================
     Canvas / DOM from here down.
     ============================================================ */
  var MONO = 'ui-monospace, Menlo, Consolas, monospace';
  var HAND = 'Caveat, "Segoe Print", "Comic Sans MS", cursive';

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
      /* --canvas-accent: AA-safe amber for marks on paper (style.css,
         below the game marker); falls back to the plain accent. */
      accent: cs.getPropertyValue('--canvas-accent').trim() ||
        cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sunny').trim(),
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    /* taller sheet on phones: the prompt strip, the rays and the anchor
       band all have to fit, and at 0.62 the band collapsed to 12px */
    H = Math.round(W * (W < 520 ? 0.85 : 0.62));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startRadius() {
    return Math.max(ArtDaily.startRadius(START_BASE), Math.round(0.06 * Math.min(W, H)));
  }
  function easeFactor() { return ArtDaily.ease(1); }

  /* ---- round state ---- */
  var round = 0, strokeIdx = 0, scores = [], item = null, playing = false;
  var reported = false;   /* this round has already reached ArtDaily.report */
  var drawing = false, strokePts = [], activeId = null, activeType = null;
  var lastPenAt = -1e9;
  var revealing = null, revealTimer = null, holdingReveal = false;
  /* the last scored stroke in words: the sixth reveal is reported and
     overwritten by "round done" in the same tick, so without this the
     closing stroke of every round is the one that never gets read back */
  var lastWords = '';

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function strokeLabel() { return 'stroke ' + (strokeIdx + 1) + ' of ' + STROKES_PER_ROUND; }

  /* Plain words, not a sign glyph. "+45°" turned the whole score on
     reading one 3px-wide character in a handwriting face; a beginner who
     misread it drew a flawless stroke and scored 0. */
  function turnWord(t) { return t >= 0 ? 'counter-clockwise' : 'clockwise'; }
  function fmtTarget(t) { return Math.abs(t) + '° ' + turnWord(t); }

  function promptPx() { return Math.max(14, Math.min(22, Math.round(W * 0.032))); }
  function promptBlockH() { return promptPx() + Math.round(promptPx() * 0.85) + 16; }

  /* A stays clear of the edges so the reference AND true rays always fit
     whatever their orientation, and below the prompt strip — whose height
     is measured, not guessed at 48px, which on a phone left a 12px band
     for the anchor to live in. Angles survive a resize; only A moves. */
  function placeItem() {
    if (!item) return;
    var rayLen = Math.max(40, Math.min(120, Math.min(W, H) * 0.26));
    var m = rayLen + 22;
    var yLo = promptBlockH() + rayLen + 8, yHi = H - m;
    if (yHi <= yLo) { yLo = H * 0.42; yHi = H * 0.74; }
    item.rayLen = rayLen;
    item.a = {
      x: (W - m > m) ? rand(m, W - m) : W / 2,
      y: (yHi > yLo) ? rand(yLo, yHi) : H * 0.58,
    };
  }

  function makeItem(idx) {
    var pool = ANGLE_POOLS[Math.min(idx, ANGLE_POOLS.length - 1)];
    var mag = pool[Math.floor(Math.random() * pool.length)];
    var sign = Math.random() < 0.5 ? 1 : -1;
    /* first item of a round: the reference lies flat or straight up, so
       the beginner's first judgement is anchored to something they
       already have an intuition for. From item 2 it is free. */
    var refA = idx === 0
      ? (Math.random() < 0.5 ? 0 : -Math.PI / 2)
      : rand(0, Math.PI * 2);
    item = { target: sign * mag, refA: refA, a: null, rayLen: 0, flipHinted: false, flipForgiven: false };
    placeItem();
  }

  function setPlayHint() {
    hint.textContent = strokeLabel() + ' — press anywhere and pull one stroke ' +
      fmtTarget(item.target) + ' from the grey reference line.';
  }

  function newRound() {
    clearTimeout(revealTimer);
    round += 1;
    strokeIdx = 0;
    scores = [];
    reported = false;
    strokePts = [];
    drawing = false;
    activeId = null;
    activeType = null;
    revealing = null;
    holdingReveal = false;
    lastWords = '';
    playing = true;
    makeItem(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    setPlayHint();
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

  function drawArrowhead(x, y, ang, size) {
    ctx.beginPath();
    ctx.moveTo(x - size * Math.cos(ang - 0.45), y - size * Math.sin(ang - 0.45));
    ctx.lineTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang + 0.45), y - size * Math.sin(ang + 0.45));
    ctx.stroke();
  }

  /* A ray through `a`: short tail behind, arrowhead marking direction. */
  function drawRay(a, ang, len, tail) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(a.x - dx * tail, a.y - dy * tail);
    ctx.lineTo(a.x + dx * len, a.y + dy * len);
    ctx.stroke();
    drawArrowhead(a.x + dx * len, a.y + dy * len, ang, 9);
  }

  /* The turn arrow — on every item, so the sign convention is taught on
     the canvas rather than only in the collapsed how-to. Drawn in accent
     at full weight (it used to be a 1.8px muted hairline nobody read),
     and it points whichever way THIS item asks for.
     Visual counter-clockwise = decreasing canvas angle (y is down). */
  function drawTurnArrow(c, a, refA, target, rayLen, loud) {
    var ccw = target >= 0;
    var r = Math.min(40, Math.max(22, rayLen * 0.55));
    var endA = refA + (ccw ? -0.85 : 0.85);
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.fillStyle = c.accent;
    ctx.lineWidth = loud ? 3.2 : 2.4;
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, refA + (ccw ? -0.12 : 0.12), endA, ccw);
    ctx.stroke();
    var tx = a.x + r * Math.cos(endA), ty = a.y + r * Math.sin(endA);
    var head = ccw
      ? Math.atan2(-Math.cos(endA), Math.sin(endA))
      : Math.atan2(Math.cos(endA), -Math.sin(endA));
    drawArrowhead(tx, ty, head, 8);
    ctx.font = '800 11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('this way',
      Math.max(30, Math.min(W - 30, a.x + (r + 22) * Math.cos(endA - (ccw ? 0.42 : -0.42)))),
      Math.max(12, Math.min(H - 8, a.y + (r + 22) * Math.sin(endA - (ccw ? 0.42 : -0.42)))));
    ctx.restore();
  }

  function drawAnchor(c, it) {
    var a = it.a, refA = it.refA, rayLen = it.rayLen;
    var r = startRadius();
    /* dashed start ring — a suggestion, never a gate: the stroke is slid
       onto A wherever it began, so nothing here can refuse a press */
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = c.muted;   /* full --muted: 5.2:1 paper, 5.8:1 night */
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    /* muted reference ray through A, labelled so "the reference" is
       attached to a thing on the page rather than left as a word */
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 2.5;
    drawRay(a, refA, rayLen, Math.min(40, rayLen * 0.45));
    ctx.fillStyle = c.muted;
    ctx.font = '800 11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('reference',
      Math.max(34, Math.min(W - 34, a.x + (rayLen + 26) * Math.cos(refA))),
      Math.max(12, Math.min(H - 8, a.y + (rayLen + 26) * Math.sin(refA))));
    drawTurnArrow(c, a, refA, it.target, rayLen, it.flipHinted);
    /* anchor dot + label, placed perpendicular so it dodges both rays */
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6, 0, Math.PI * 2);
    ctx.fill();
    var la = refA + Math.PI / 2;
    var lo = Math.min(44, r + 14);
    ctx.fillStyle = c.ink;
    ctx.font = '800 12px ' + MONO;
    ctx.fillText('A',
      Math.max(10, Math.min(W - 10, a.x + lo * Math.cos(la))),
      Math.max(14, Math.min(H - 10, a.y + lo * Math.sin(la))));
    ctx.textBaseline = 'alphabetic';
  }

  /* The one piece of information the whole score turns on, so it is set
     in mono — legible — with the direction spelled out as a word. */
  function drawPrompt(c) {
    var px = promptPx();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.ink;
    ctx.font = '800 ' + px + 'px ' + MONO;
    ctx.fillText(fmtTarget(item.target), W / 2, px + 6);
    ctx.fillStyle = c.muted;
    ctx.font = '600 ' + Math.round(px * 0.85) + 'px ' + HAND;
    ctx.fillText('from the grey reference line', W / 2, px + Math.round(px * 0.85) + 10);
  }

  function drawReveal(c) {
    var rv = revealing;
    /* reference stays for context */
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 2;
    drawRay(rv.a, rv.refA, rv.rayLen, Math.min(40, rv.rayLen * 0.45));
    ctx.restore();
    /* the school protractor arc, swept from the reference to the truth */
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rv.a.x, rv.a.y, rv.rayLen * 0.5, rv.refA, rv.trueA, rv.target > 0);
    ctx.stroke();
    ctx.restore();
    /* their ink, already slid onto A so the two directions share an origin */
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2.5;
    drawPolyline(rv.points);
    /* the TRUE ray in accent */
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    drawRay(rv.a, rv.trueA, rv.rayLen, 0);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(rv.a.x, rv.a.y, 6, 0, Math.PI * 2);
    ctx.fill();
    /* "off by N°" flashed on a little paper chip */
    var label = 'off by ' + rv.offBy + '°';
    var tx = Math.max(46, Math.min(W - 46, rv.a.x));
    var ty = rv.a.y - startRadius() - 24;
    if (ty < 22) ty = rv.a.y + startRadius() + 32;
    /* both placements can still fall off a short sheet — an anchor near
       the bottom pushes the fallback below the canvas, and the one number
       the reveal exists to say goes with it */
    ty = Math.max(22, Math.min(H - 8, ty));
    ctx.font = '900 15px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var w = ctx.measureText(label).width + 16;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = c.card;
    ctx.fillRect(tx - w / 2, ty - 14, w, 20);
    ctx.restore();
    ctx.fillStyle = c.accent;
    ctx.fillText(label, tx, ty + 1);
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!item || (!playing && !revealing)) return;
    drawPrompt(c);
    if (revealing) { drawReveal(c); return; }
    drawAnchor(c, item);
    if (drawing) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2.5;
      drawPolyline(strokePts);
    }
  }

  /* ---- input: press anywhere, pull one stroke, lift ---- */
  /* Split in two so a run of coalesced samples can share ONE canvas
     measurement: getBoundingClientRect() forces a layout flush, and a fast
     pen hands over dozens of samples per frame — all of them describing a
     canvas that cannot have moved between them — in the same handler that
     repaints. Measured here: 16 layout reads per pointermove instead of 1.
     (This is the hazard ArtDaily.samples() is documented against.) */
  function posIn(ev, rect) {
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
  function pointerPos(ev) {
    return posIn(ev, canvas.getBoundingClientRect());
  }

  /* A pen outranks a finger: artists rest the palm before the nib lands,
     so first-pointer-wins hands the stroke to the palm. */
  function penWins(ev) {
    /* only a FINGER ever waits, and only while the pen is still talking;
       a mouse or an unknown pointer type is always allowed to draw */
    if (ev.pointerType !== 'touch') return true;
    return (ev.timeStamp || 0) - lastPenAt >= PEN_LOCKOUT_MS;
  }

  /* The press that owns the current stroke is provably no longer down.

     A pointer is `primary` only while it is the FIRST ACTIVE pointer of its
     type, so a new primary of the SAME type proves the stored one has ended —
     while a genuine second finger arriving during a live stroke is never
     primary, and is still ignored by the guard below.

     This is the only recovery a FINGER has. The same-id branch below exists
     for a release lost outside the document (press, drag out of the embed
     frame, let go over the page), and it works for a mouse or a pen because
     those keep one pointerId for the whole session. Every touch gets a FRESH
     id, so that branch can never fire for one — and no pointerup,
     pointercancel or lostpointercapture will ever arrive for a finger that is
     already gone. Measured: one lost touch release left `drawing` true against
     an id nothing could match again, every later press was swallowed, and the
     sheet was dead until "new round" — which throws the whole round away. */
  function ownerGone(ev) {
    return ev.isPrimary === true && ev.pointerType === activeType;
  }

  function abortStroke() {
    if (activeId !== null) {
      try { canvas.releasePointerCapture(activeId); } catch (e) {}
    }
    drawing = false;
    activeId = null;
    activeType = null;
    strokePts = [];
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = ev.timeStamp || 0;
    if (!playing || !item) return;
    if (revealing) {
      /* press-and-hold studies the reveal for as long as you like; the
         release moves on. The protractor arc IS the lesson — one second
         of it, with no way to pause, taught nobody anything. */
      ev.preventDefault();
      clearTimeout(revealTimer);
      holdingReveal = true;
      return;
    }
    if (drawing) {
      /* This very pointer is down twice with no release in between, which the
         pointer-events spec says cannot happen: its release was lost (press,
         drag out of the embed frame, let go over the page). The old press is
         over, so drop it. Without this the `else return` below swallowed the
         new press while pointermove — which only checks `drawing` and the id,
         both still matching — kept appending its samples to the ABANDONED
         stroke, and the least-squares fit graded one direction across two
         strokes the player drew minutes apart. */
      if (ev.pointerId === activeId) abortStroke();
      else if (ev.pointerType === 'pen' && activeType !== 'pen') abortStroke();
      /* a finger's release was lost: the id is new but the old one is gone */
      else if (ownerGone(ev)) abortStroke();
      else return;
    }
    if (!penWins(ev)) return;
    ev.preventDefault();
    drawing = true;
    activeId = ev.pointerId;
    activeType = ev.pointerType;
    strokePts = [pointerPos(ev)];
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = ev.timeStamp || 0;
    if (!drawing || ev.pointerId !== activeId) return;
    ev.preventDefault();
    /* coalesced events: a 120Hz pen flick keeps every sample, and the
       least-squares fit is only as good as the samples that survive. The
       canvas is measured ONCE for the whole run — see posIn(). */
    var rect = canvas.getBoundingClientRect();
    var evs = ArtDaily.samples(ev);
    for (var i = 0; i < evs.length; i++) strokePts.push(posIn(evs[i], rect));
    draw();
  });

  /* Slide the whole stroke so it starts at A. Only the DIRECTION is
     scored and direction does not care where a line sits, so this is
     score-neutral by construction — which is exactly why the anchor can
     stop refusing presses. It also puts the player's ink and the true
     ray on a shared origin in the reveal, where the comparison happens. */
  function snapToAnchor(pts, a) {
    var dx = a.x - pts[0].x, dy = a.y - pts[0].y, out = [], i, p, k = 1;
    for (i = 0; i < pts.length; i++) out.push({ x: pts[i].x + dx, y: pts[i].y + dy });
    /* …then shrink about A if the slid stroke runs off the sheet. A stroke
       that started somewhere roomy and got slid onto an anchor near an edge
       has its far end clipped away — and the far end is where the angle
       error actually shows. A 300px pull on a desktop sheet lost up to
       139px of the player's own line out of the one picture that exists to
       let them compare it against the true ray. Scaling about A is UNIFORM,
       so the direction the whole reveal is about moves by exactly nothing;
       only the length shown changes, and only when the alternative was
       showing less of it. */
    for (i = 0; i < out.length; i++) {
      p = out[i];
      if (p.x > W - 4) k = Math.min(k, (W - 4 - a.x) / (p.x - a.x));
      if (p.x < 4) k = Math.min(k, (4 - a.x) / (p.x - a.x));
      if (p.y > H - 4) k = Math.min(k, (H - 4 - a.y) / (p.y - a.y));
      if (p.y < 4) k = Math.min(k, (4 - a.y) / (p.y - a.y));
    }
    if (!isFinite(k) || !(k > 0) || k >= 1) return out;
    for (i = 0; i < out.length; i++) {
      out[i].x = a.x + (out[i].x - a.x) * k;
      out[i].y = a.y + (out[i].y - a.y) * k;
    }
    return out;
  }

  function commitStroke(ev) {
    if (!drawing || ev.pointerId !== activeId) return;
    if (ev.cancelable) ev.preventDefault();
    drawing = false;
    activeId = null;
    activeType = null;
    var pts = strokePts;
    strokePts = [];
    if (!item) { draw(); return; }
    /* a single-frame flick can arrive as pointerdown → pointerup with no
       move between them; the release position is a perfectly good second
       sample, and rejecting it told a good fast stroke it was "too short" */
    if (pts.length === 1 && ev.type === 'pointerup') pts = pts.concat([pointerPos(ev)]);
    var pull = pts.length < 2 ? 0 :
      Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    var dir = pull >= MIN_PULL ? fitDirection(pts) : null;
    if (!dir) {
      /* nothing to read an angle from — never scored, and named as what
         it is rather than as a failure of the player */
      hint.textContent = strokeLabel() + ' — that pull was too short to read an angle. no penalty, go again.';
      draw();
      return;
    }
    var ease = easeFactor();
    var refDir = { x: Math.cos(item.refA), y: Math.sin(item.refA) };
    var angErr = angleErrorDeg(refDir, dir, item.target);
    var mirErr = mirrorErrorDeg(refDir, dir, item.target);
    /* right size, wrong way: the eye was right and the turn direction was
       misread. Scoring that as a 0 tells a competent beginner their angle
       sense is catastrophic. Say it, teach it, and hand back the item —
       once per item, so the round can still end. */
    if (mirErr <= ease * FLIP_DEG && angErr > mirErr + 6 && !item.flipForgiven) {
      item.flipForgiven = true;
      item.flipHinted = true;
      hint.textContent = strokeLabel() + ' — right size, wrong way round. ' +
        turnWord(item.target) + ' is the direction the amber arrow at A turns. free retry.';
      draw();
      return;
    }
    var sc = strokeScore(angErr, pull, ease);
    scores.push(sc);
    revealing = {
      points: snapToAnchor(pts, item.a),
      a: item.a,
      refA: item.refA,
      trueA: item.refA - item.target * Math.PI / 180,
      rayLen: item.rayLen,
      target: item.target,
      offBy: angErr < 10 ? Math.round(angErr * 10) / 10 : Math.round(angErr),
      score: Math.round(sc),
    };
    /* which WAY it missed, not just how far: "off by 12°" leaves the one
       thing the player has to do next — turn further, or turn back —
       unsaid, and it is the whole lesson of the drill */
    var words = offWords(signedErrorDeg(refDir, dir, item.target),
      perfectZoneDeg(pull, ease), revealing.score);
    lastWords = 'last stroke ' + revealing.score + ' — ' + words + '.';
    hint.textContent = strokeLabel() + ' — ' + words + ', score ' + revealing.score +
      (strokeIdx === 0
        ? '. the amber ray is the true angle and the amber arc measures it, like a protractor at school. hold to study it, release for the next one.'
        : '. hold to study, release for next.');
    draw();
    clearTimeout(revealTimer);
    holdingReveal = false;
    if (scores.length >= STROKES_PER_ROUND) {
      /* report NOW, not after the reveal timer — this drill invites the
         player to linger on the reveal ("hold to study"), so a "new round"
         click landing inside the 2s hold is ordinary, and it must never
         swallow six finished strokes. The last reveal stays on the sheet. */
      finishRound();
    } else {
      revealTimer = setTimeout(nextStep, REVEAL_MS);
    }
  }

  function onPointerUp(ev) {
    if (revealing && holdingReveal) {
      holdingReveal = false;
      clearTimeout(revealTimer);
      nextStep();
      return;
    }
    commitStroke(ev);
  }
  canvas.addEventListener('pointerup', onPointerUp);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', onPointerUp);
  /* iOS drops capture without a pointerup — treat it as the lift it is */
  canvas.addEventListener('lostpointercapture', commitStroke);

  /* End a press-and-hold that is never going to get its release, and start
     the countdown over. The hold cancels the auto-advance timer, so anything
     that swallows the pointerup — the tab losing focus, an OS notification or
     a context menu taking the pointer, the embed dialog closing over the
     drill — used to freeze the reveal for good: the sheet sat on one stroke
     showing "release for the next one" long after the player had released,
     with nothing counting down and no way on but "new round", which throws
     away every finished stroke of the round. */
  function releaseHold() {
    if (!revealing || !holdingReveal) return;
    holdingReveal = false;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(nextStep, REVEAL_MS);
  }
  /* The two ways a press loses its release without a pointercancel: focus
     goes elsewhere (tab switch, notification, the embed dialog closing), or a
     menu opens over the page (right-click, long-press). Between these, the
     canvas/window pointerup pair and pointercancel, there is no longer a
     path that leaves the reveal held with nothing counting down. */
  window.addEventListener('blur', releaseHold);
  window.addEventListener('contextmenu', releaseHold);

  function cancelStroke(ev) {
    /* interrupted stroke (system gesture etc.) — reset, no penalty */
    if (revealing && holdingReveal) { releaseHold(); return; }
    if (!drawing || ev.pointerId !== activeId) return;
    abortStroke();
    if (playing && !revealing) hint.textContent = strokeLabel() + ' — your device interrupted the stroke; no penalty, go again.';
    draw();
  }
  canvas.addEventListener('pointercancel', cancelStroke);
  window.addEventListener('pointercancel', cancelStroke);

  function nextStep() {
    if (!revealing) return;
    revealing = null;
    holdingReveal = false;
    strokeIdx += 1;
    if (strokeIdx < STROKES_PER_ROUND) {
      makeItem(strokeIdx);
      setPlayHint();
      draw();
      return;
    }
    finishRound();
  }

  function finishRound() {
    playing = false;
    /* `item` stays so the closing reveal keeps its prompt and protractor
       arc on the sheet — the round is already reported, and the pointer
       handlers all gate on `playing`, so nothing can be drawn into it. */
    draw();
    if (reported) return;   /* exactly once per round, on every path */
    reported = true;
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
  ArtDaily.onInput(function () { draw(); });

  /* A resize while a reveal is on the sheet has to carry that reveal
     across. `placeItem` is skipped while one is up (it would teleport the
     anchor out from under the lesson) and the round's CLOSING reveal is
     kept on screen deliberately, with `playing` already false — so nothing
     re-placed it at all: rotating a phone there left the anchor, the
     protractor arc, the true ray and the player's own ink drawn against
     the old canvas box, most of it off the side of the new one (measured:
     ink out to x=679 on a 380px sheet).

     Everything scales UNIFORMLY about the sheet's centre and is never
     sheared: this drill scores a DIRECTION, and a non-uniform scale would
     silently redraw the ink at an angle the player did not draw. A
     uniform scale about the centre also cannot push anything out — a
     point within half the old box of the old centre lands within
     s·(oldW/2) ≤ W/2 of the new one. */
  function rescaleReveal(oldW, oldH) {
    var rv = revealing, s, ox, oy, i;
    if (!rv || !(oldW > 0) || !(oldH > 0)) return;
    s = Math.min(W / oldW, H / oldH);
    if (!isFinite(s) || s <= 0) return;
    ox = oldW / 2; oy = oldH / 2;
    for (i = 0; i < rv.points.length; i++) {
      rv.points[i].x = W / 2 + (rv.points[i].x - ox) * s;
      rv.points[i].y = H / 2 + (rv.points[i].y - oy) * s;
    }
    /* a fresh object, not a mutation: rv.a is the same node as item.a, and
       the next item re-places that one for itself */
    rv.a = { x: W / 2 + (rv.a.x - ox) * s, y: H / 2 + (rv.a.y - oy) * s };
    rv.rayLen *= s;
  }

  window.addEventListener('resize', function () {
    var oldW = W, oldH = H;
    fitCanvas();
    /* an iOS URL-bar collapse fires resize with no width change; without
       this guard it teleported the anchor between strokes */
    if (W === oldW && H === oldH) { draw(); return; }
    if (drawing) {
      /* the canvas rescaled mid-stroke — samples before and after no
         longer share a coordinate space, so scoring them would punish
         the environment, not the eye. Cancel the stroke, free. */
      abortStroke();
      if (playing && !revealing) hint.textContent = strokeLabel() + ' — the screen changed size; no penalty, go again.';
    }
    if (revealing) rescaleReveal(oldW, oldH);
    /* re-place A (same angles) so both rays always fit the new canvas */
    else if (playing && item) placeItem();
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
  /* the handwritten sub-line uses the vendored Caveat — repaint once loaded */
  try {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { draw(); });
    }
  } catch (e) {}
})();
