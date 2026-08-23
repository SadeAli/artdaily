/* ============================================================
   game.js — Focal Placement. Six generated 3:2 frames per round;
   tap (or drag) to place the subject, lock it in, and the reveal
   overlays the four thirds anchors ranked, the breathing room you
   left, and a one-line critique. Scoring is curated composition
   heuristics — pure functions at the top, canvas below.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'focal-place';
  /* Four, not six. This is a one-verb drill: by frame 4 the rule has
     landed and the remaining two are repetition, which turns a clean
     90-second component of a daily session into a chore. */
  var ITEMS_PER_ROUND = 4;

  /* ============================================================
     Pure scoring — geometry in (frame-pixel coords), 0–100 out.
     No canvas, no DOM: each piece is unit-testable on its own.
     ============================================================ */

  /* written so NaN falls to `lo` rather than propagating — every caller
     wants a point inside the frame, never a poisoned one */
  function clampv(v, lo, hi) { return v > lo ? (v < hi ? v : hi) : lo; }

  function thirdsPoints(fw, fh) {
    return [
      { x: fw / 3, y: fh / 3 }, { x: 2 * fw / 3, y: fh / 3 },
      { x: fw / 3, y: 2 * fh / 3 }, { x: 2 * fw / 3, y: 2 * fh / 3 },
    ];
  }

  /* 0–50: distance to the nearest thirds intersection, normalized by
     the frame diagonal. Full inside FULL_FRAC, nothing beyond 22%.
     The plateau tightens on the last frame of a round: a 6% radius
     around four crossings covers a large share of the legal area, so
     once the idea clicks the score pins near 100 and there is nothing
     left to sharpen. The drill says so on screen when it happens. */
  var THIRDS_FULL = 0.06;
  var THIRDS_FULL_TIGHT = 0.035;
  var THIRDS_ZERO = 0.22;

  function thirdsFullFor(idx, lastIdx) {
    return (typeof idx === 'number' && typeof lastIdx === 'number' && idx >= lastIdx)
      ? THIRDS_FULL_TIGHT : THIRDS_FULL;
  }

  function scoreThirds(x, y, fw, fh, full) {
    var pts = thirdsPoints(fw, fh);
    var diag = Math.hypot(fw, fh);
    var f = (typeof full === 'number' && isFinite(full) && full > 0) ? full : THIRDS_FULL;
    var d = Infinity, i;
    for (i = 0; i < pts.length; i++) {
      d = Math.min(d, Math.hypot(x - pts[i].x, y - pts[i].y));
    }
    var n = diag > 0 ? d / diag : Infinity;
    if (!isFinite(n)) return 0; /* degenerate frame or NaN coords */
    if (n <= f) return 50;
    if (n >= THIRDS_ZERO) return 0;
    return 50 * (THIRDS_ZERO - n) / (THIRDS_ZERO - f);
  }

  /* 0–30: fraction of the frame width ahead of the facing direction.
     Full at >= 0.5 of the frame, zero at <= 0.18. facing: +1 right, -1 left. */
  function scoreBreathing(x, fw, facing) {
    var ahead = fw > 0 ? (facing > 0 ? (fw - x) / fw : x / fw) : 0;
    if (!isFinite(ahead)) ahead = 0; /* NaN x never scores */
    if (ahead >= 0.5) return 30;
    if (ahead <= 0.18) return 0;
    return 30 * (ahead - 0.18) / (0.5 - 0.18);
  }

  /* 0–20: distance from the secondary element (sec = {x,y,r} or null).
     Full at >= 18% of frame width, zero when the silhouettes touch.
     No secondary element in the frame -> automatic 20. */
  function scoreSeparation(x, y, subjR, sec, fw) {
    if (!sec) return 20;
    var d = Math.hypot(x - sec.x, y - sec.y);
    var lo = subjR + sec.r;
    var hi = Math.max(lo + 1, 0.18 * fw);
    if (!isFinite(d) || !isFinite(lo) || !isFinite(hi)) return 20; /* unmeasurable secondary reads as absent */
    if (d >= hi) return 20;
    if (d <= lo) return 0;
    return 20 * (d - lo) / (hi - lo);
  }

  function itemScore(x, y, fw, fh, facing, subjR, sec, full) {
    return scoreThirds(x, y, fw, fh, full) +
           scoreBreathing(x, fw, facing) +
           scoreSeparation(x, y, subjR, sec, fw);
  }

  function roundScore(items) {
    var sum = 0, i;
    for (i = 0; i < items.length; i++) sum += items[i];
    return items.length ? sum / items.length : 0;
  }

  /* The best placement the frame actually allows, found with the very
     scoring the player is judged by: a coarse grid, then a hill-climb
     that halves its step. Two jobs — proving a 100 exists before a
     frame is served, and drawing a revealed answer that is never worse
     than the player's own. Bounds are the same insets the pointer is
     clamped to, so the answer is always a placement they could reach. */
  function bestPlacement(fw, fh, facing, subjR, sec, box, full) {
    var MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var bx = 0, by = 0, bs = -1, i, j, x, y, t, step, guard = 0, moved, cx, cy;
    for (i = 0; i <= 40; i++) {
      x = box.x0 + (box.x1 - box.x0) * i / 40;
      for (j = 0; j <= 28; j++) {
        y = box.y0 + (box.y1 - box.y0) * j / 28;
        t = itemScore(x, y, fw, fh, facing, subjR, sec, full);
        if (t > bs) { bs = t; bx = x; by = y; }
      }
    }
    step = Math.max(fw, fh) / 40;
    while (step > 0.05 && guard < 800) {
      moved = false;
      for (i = 0; i < MOVES.length; i++) {
        guard += 1;
        cx = clampv(bx + MOVES[i][0] * step, box.x0, box.x1);
        cy = clampv(by + MOVES[i][1] * step, box.y0, box.y1);
        t = itemScore(cx, cy, fw, fh, facing, subjR, sec, full);
        if (t > bs + 1e-9) { bs = t; bx = cx; by = cy; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return { x: bx, y: by, score: bs };
  }

  /* ============================================================
     Chrome + canvas (impure world starts here)
     ============================================================ */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var placePrompt = document.getElementById('placePrompt');
  var critique = document.getElementById('critique');
  var btnLock = document.getElementById('btnLock');
  var btnRound = document.getElementById('btnRound');
  var promptBird = document.getElementById('promptBird');
  var pbCtx = promptBird.getContext('2d');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */

  function hexRGB(h) {
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function mixHex(a, b, wa) {
    var ca = hexRGB(a), cb = hexRGB(b), out = '#', i, v;
    if (!ca || !cb) return a;
    for (i = 0; i < 3; i++) {
      v = Math.round(ca[i] * wa + cb[i] * (1 - wa));
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var ink = cs.getPropertyValue('--ink').trim();
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--mint').trim();
    /* The reveal IS the lesson, so it has to be readable: raw mint on
       the paper card is ~2.9:1, under the 3:1 graphics floor. The
       stylesheet's own sticker recipe — accent inked 55/45 toward
       graphite on paper (5.7:1), pure accent on the dark sheet where it
       already clears — applies to the canvas annotations too. */
    if (ArtDaily.theme() !== 'dark') accent = mixHex(accent, ink, 0.55);
    return {
      ink: ink,
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; 3:2 frame + margins ---- */
  var W = 0, H = 0, PAD = 14, fw = 0, fh = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(60, Math.round(rect.width));
    fw = W - PAD * 2;
    fh = Math.round(fw * 2 / 3);
    H = fh + PAD * 2;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round state ----
     Item geometry lives in frame FRACTIONS (u,v, radii as fractions of
     frame width) so a resize mid-round keeps every placement honest. */
  var round = 0, itemIdx = 0, item = null, subject = null;
  var mark = [];                       /* the drawn thumbnail, frame fractions */
  var itemScores = [], phase = 'idle'; /* idle | placing | reveal */
  var roundOver = true, lastLock = null;

  /* ---- where a round's content comes from ----------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS. Round 1 of a
     sitting is dealt from ArtDaily.roundRandom(1) — seeded from today and
     this slug — so every player gets the same four frames today and a score
     finally has a denominator. Round 2 and on are practice: same generator,
     same distribution, unshared seed.

     THE ITEM IS ALREADY STORED IN FRAME FRACTIONS, which is what makes the
     seed worth having here: facing, horizon, the secondary's u/v/rFrac and
     the answer in item.best are all fractions of the frame, so the shared
     round survives a resize and a phone and a desktop get the same frame
     laid out for their own sheet. What is identical between two players is
     the sequence of normalised draws, not the pixels.

     ONE HONEST CAVEAT, and it is the canvas again. makeItem() re-rolls the
     item until bestPlacement() proves a 100 is reachable, so the number of
     draws a frame consumes depends on that search — and the search runs in
     PIXELS, with a hill-climb whose step floor (0.05px) is absolute while
     everything else about it is proportional. In practice the accept test
     is “did anything land on the exact-100 plateau”, and both the grid and
     the climb that find it are scale-free, so the try count is the same on
     every sheet; a frame whose plateau were narrower than a twentieth of a
     pixel could in principle be accepted on a desktop and re-rolled on a
     phone, and from there the two rounds would differ. Written down rather
     than papered over.

     rand() is UNCHANGED AS A FUNCTION — lo + u * (hi - lo), with only the
     SOURCE of u swapped — so every value downstream keeps exactly the shape
     it had and a seeded round is not an easier or a harder round.

     GUARDED, AND THE GUARD IS LOAD-BEARING. index.html cache-busts its own
     scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache INDEPENDENTLY: a returning visitor holding a warm
     old SDK plus a cold copy of this file would call a roundRandom that does
     not exist, throw inside newRound() before the first frame was built, and
     sit on a blank canvas. Falling back to Math.random costs today's player
     nothing but a non-comparable round — which is what they had yesterday —
     and it self-heals when the SDK's max-age expires. Only the BARE CALL
     FORM is used (rng(), never rng.range): Math.random has no helpers on it,
     and a fallback that is not a true drop-in is not a fallback. */
  var roundRng = null;
  function u01() { return roundRng ? roundRng() : Math.random(); }

  function rand(lo, hi) { return lo + u01() * (hi - lo); }

  /* The cosmetic twin, still on Math.random — see the blob loop below. */
  function crand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function buildItem(idx) {
    /* CONTENT: facing IS the breathing-room rule, 30 of the 100 points. */
    var facing = u01() < 0.5 ? 1 : -1;
    /* ramp: frames 1–2 plain, 3–4 add a secondary element,
       5–6 keep it and push the horizon to the extremes. */
    /* The horizon used to be shoved to 0.10-0.20 or 0.80-0.90 on the
       last frames — which LOOKS like a difficulty spike but is pure
       decoration: not one of the three rules reads item.horizon. A drill
       that visually signals "this matters" and then does not score it
       teaches the wrong lesson, so the extremes are gone. */
    /* CONTENT, despite the note above it: the horizon LINE is only painted,
       but the secondary's v is measured off it a few lines down, and that
       coordinate is half of scoreSeparation. A draw is content when the
       score can feel it, however indirectly. */
    var horizon = rand(0.32, 0.68);
    var sec = null;
    if (idx >= 2) {
      var r = rand(0.05, 0.075);
      /* COSMETIC, and left on Math.random on purpose: the blobs are the
         lumps that make a rock read as a rock. Separation is scored against
         the secondary's CENTRE and rFrac — scoreSeparation never sees this
         array, and neither does the dashed keep-out ring the reveal draws
         from the same two numbers. This is the hand-drawn jitter on the
         silhouette, so two players get the same obstacle in the same place
         at the same size, bumpy in their own way. Seeding it would spend
         four to ten draws of the round's sequence on texture. */
      var blobs = [], n = 3 + Math.floor(crand(0, 3)), i;
      for (i = 0; i < n; i++) {
        blobs.push({ a: crand(0, Math.PI * 2), d: crand(0.15, 0.62), s: crand(0.45, 0.85) });
      }
      sec = {
        u: rand(0.14, 0.86),
        v: Math.min(0.94, horizon + rand(0.04, 0.16)),
        rFrac: r,
        /* CONTENT, thinly: the kind picks which silhouette is painted AND is
           the noun the critique says out loud (“too cozy with the rock”), so
           two players comparing a frame should be told the same sentence. */
        kind: u01() < 0.5 ? 'rock' : 'bush',
        blobs: blobs,
      };
    }
    return { facing: facing, horizon: horizon, sec: sec };
  }

  /* A rock can spawn where it zeroes separation at every anchor that
     also has full breathing room, capping the frame near 80 with no way
     out. Re-roll until the search proves a full 100 is placeable, and
     keep the winning spot — the reveal shows it as the answer. */
  function makeItem(idx) {
    var tries, cand, res, keep = null, keepRes = null;
    for (tries = 0; tries < 14; tries++) {
      cand = buildItem(idx);
      res = bestPlacement(fw, fh, cand.facing, subjRadius(), secPxOf(cand), placeBox(),
        thirdsFullFor(idx, ITEMS_PER_ROUND - 1));
      if (!keep || res.score > keepRes.score) { keep = cand; keepRes = res; }
      if (keepRes.score >= 99.9) break;
    }
    /* stored as frame fractions: the scoring landscape is scale-free,
       so this stays the answer across a resize */
    keep.best = { u: keepRes.x / fw, v: keepRes.y / fh, score: keepRes.score };
    return keep;
  }

  function secPxOf(it) {
    if (!it || !it.sec) return null;
    return { x: it.sec.u * fw, y: it.sec.v * fh, r: it.sec.rFrac * fw };
  }
  function secPx() { return secPxOf(item); }
  function subjScale() { return fw * 0.055; }
  function subjRadius() { return subjScale() * 1.5; }

  /* Where a subject CENTRE may sit so the whole bird stays inside the
     frame it is judged in — the beak reaches 1.63 scales ahead of centre
     and the tail 1.5 behind, so the old 0.7 inset let it overhang. */
  function placeBox() {
    var sc = subjScale();
    return { x0: sc * 1.65, x1: fw - sc * 1.65, y0: sc * 1.1, y1: fh - sc * 0.7 };
  }

  /* The prompt used to name a subject the player had never seen — the
     bird only existed after the first tap. Here it is, facing the way
     the sentence promises, before anything is placed. */
  function paintPromptBird() {
    var c = inks(), dpr = window.devicePixelRatio || 1;
    var w = 36, h = 24;
    promptBird.width = Math.round(w * dpr);
    promptBird.height = Math.round(h * dpr);
    promptBird.style.width = w + 'px';
    promptBird.style.height = h + 'px';
    pbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pbCtx.clearRect(0, 0, w, h);
    if (item) drawBird(pbCtx, w / 2, h * 0.58, 6.4, item.facing, c.ink, c, false);
  }

  function setPrompt() {
    placePrompt.textContent = '';
    placePrompt.appendChild(document.createTextNode('place this subject '));
    placePrompt.appendChild(promptBird);
    placePrompt.appendChild(document.createTextNode(' — it faces '));
    var s = document.createElement('span');
    s.className = 'facing-arrow';
    /* Which way the subject faces IS the breathing-room rule — 30 of the
       100 points. It was carried by a bare “→” next to an aria-hidden
       drawing of the bird, and a lone arrow glyph is announced
       inconsistently across screen readers and not at all in some. Draw
       the arrow, say the word. */
    s.setAttribute('aria-hidden', 'true');
    s.textContent = item.facing > 0 ? '→' : '←';
    placePrompt.appendChild(s);
    var w = document.createElement('span');
    w.className = 'sr-only';
    w.textContent = item.facing > 0 ? 'right' : 'left';
    placePrompt.appendChild(w);
    paintPromptBird();
  }

  /* Disabling the control that was just pressed drops keyboard focus onto
     <body>, so the next Tab restarts at the back link and walks the whole
     topbar before it reaches anything playable. Hand focus on instead. */
  function handFocus(from, to) {
    if (!from || !to || document.activeElement !== from) return;
    try { to.focus({ preventScroll: true }); } catch (e) { try { to.focus(); } catch (e2) {} }
  }

  var LOCK_LABEL = {
    lock: ['lock it in', '✓'],
    next: ['next frame', '→'],
    over: ['round over', ''],
  };

  function setLockLabel(mode) {
    var l = LOCK_LABEL[mode] || LOCK_LABEL.lock;
    btnLock.textContent = '';
    btnLock.appendChild(document.createTextNode(l[1] ? l[0] + ' ' : l[0]));
    if (!l[1]) return;
    var s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = l[1];
    btnLock.appendChild(s);
  }

  function nextItem() {
    if (itemIdx >= ITEMS_PER_ROUND) return;
    item = makeItem(itemIdx);
    subject = null;
    mark = [];
    lastLock = null;
    phase = 'placing';
    setPrompt();
    setLockLabel('lock');
    /* "next frame →" is pressed and then immediately disabled (nothing is
       placed yet), so keyboard focus went to <body> on every frame change.
       The frame itself is the next thing to use — arrows nudge, Enter
       locks — so focus goes there. */
    handFocus(btnLock, canvas);
    btnLock.disabled = true;
    critique.textContent = '';
    hint.textContent = 'frame ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — scribble a quick thumbnail where the subject goes (a tap works too).' +
      (itemIdx === 0
        ? ' the faint circle is one good spot to aim at — the reveal explains why. arrow keys nudge once you have placed it.'
        : '') +
      (itemIdx === ITEMS_PER_ROUND - 1
        ? ' tighter frame: full marks need you within 3.5% of a crossing now, not 6%.'
        : '');
    draw();
  }

  function newRound() {
    clearDiscard();
    round += 1;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE, re-seeded per round and
       set before nextItem() deals the first frame of it. round is already 1
       on the first round of a sitting, so round 1 is today's shared round
       and every “new round” after it is practice. Guarded: see the block by
       u01(). */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    itemIdx = 0;
    itemScores = [];
    roundOver = false;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    nextItem();
  }

  /* ---- "new round" mid-round throws away every locked frame, so it
     asks once before it does; the arming lapses on its own. ---- */
  /* THE ARMING WAS INVISIBLE TO ANYONE NOT WATCHING THE BUTTON. Its only
     signal was the button's own label, and a name that changes under a
     focused button is not re-announced by any screen reader — so the press
     read as "nothing happened", and a player who then waited out the
     window pressed again, re-armed, heard nothing again, and could never
     reach a new round at all. The hint is this drill's live region, so the
     arming is said there; the line it replaced goes back when the arming
     lapses, unless something newer (a lock, a new frame) claimed it. */
  var discardArmed = false, discardTimer = null, discardSaid = '', hintBeforeDiscard = '';

  function clearDiscard() {
    clearTimeout(discardTimer);
    discardTimer = null;
    if (!discardArmed) return;
    discardArmed = false;
    setRoundLabel(false);
    if (discardSaid && hint.textContent === discardSaid) hint.textContent = hintBeforeDiscard;
    discardSaid = '';
  }

  function setRoundLabel(armed) {
    btnRound.textContent = (armed ? 'discard round?' : 'new round') + ' ';
    var s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '↻';
    btnRound.appendChild(s);
  }

  function onRoundClick() {
    if (discardArmed || roundOver || itemScores.length === 0) { newRound(); return; }
    discardArmed = true;
    setRoundLabel(true);
    hintBeforeDiscard = hint.textContent;
    discardSaid = 'that scraps this round — press “new round” again to start over, or carry on.';
    hint.textContent = discardSaid;
    clearTimeout(discardTimer);
    /* 3.5s is not long enough to hear a polite announcement AND press */
    discardTimer = setTimeout(clearDiscard, 4500);
  }

  /* ---- lock + reveal ---- */
  function lockItem() {
    if (phase !== 'placing' || !subject) return;
    var sx = subject.u * fw, sy = subject.v * fh;
    var sec = secPx(), subjR = subjRadius();
    var full = thirdsFullFor(itemIdx, ITEMS_PER_ROUND - 1);
    var t = scoreThirds(sx, sy, fw, fh, full);
    var b = scoreBreathing(sx, fw, item.facing);
    var s = scoreSeparation(sx, sy, subjR, sec, fw);
    var total = t + b + s;
    itemScores.push(total);

    /* rank the four thirds anchors by what THEY would have scored */
    var pts = thirdsPoints(fw, fh), ranked = [], i;
    for (i = 0; i < pts.length; i++) {
      ranked.push({
        u: pts[i].x / fw, v: pts[i].y / fh,
        score: itemScore(pts[i].x, pts[i].y, fw, fh, item.facing, subjR, sec, full),
      });
    }
    ranked.sort(function (a, c) { return c.score - a.score; });

    lastLock = { total: total, ranked: ranked, line: critiqueLine(t, b, s, total) };
    /* the split, not just the total: a 61 used to hide WHICH two
       guidelines leaked the points */
    lastLock.text = 'frame ' + (itemIdx + 1) + ': ' + Math.round(total) + '/100 · thirds ' +
      Math.round(t) + '/50 · room ' + Math.round(b) + '/30 · separation ' + Math.round(s) +
      '/20 — ' + lastLock.line;
    critique.textContent = lastLock.text;

    phase = 'reveal';
    itemIdx += 1;
    if (itemIdx >= ITEMS_PER_ROUND) {
      finishRound();
    } else {
      setLockLabel('next');
      btnLock.disabled = false;
      /* THE HINT IS THE ONLY SPOKEN CHANNEL. This critique line was its own
         polite region sitting beside the hint's, and two polite regions
         written in the same tick queue rather than merge — so the player
         heard the whole score split and then, behind it, "read the delta
         against the ghost". The critique stays on screen as a pencil note;
         the words travel in the hint, once. */
      hint.textContent = lastLock.text +
        ' read the delta against the ghost, then tap the frame for the next one.';
    }
    draw();
  }

  /* Measured against the true best placement, not the best of the four
     anchors — the anchors are annotations, the ghost is the answer. */
  function critiqueLine(t, b, s, total) {
    var best = item.best.score;
    if (total >= best - 1) return 'as good as this frame gets — nicely judged.';
    var dt = (50 - t) / 50, db = (30 - b) / 30, ds = (20 - s) / 20;
    var worst = Math.max(dt, db, ds);
    if (worst < 0.18) return 'lovely — the frame breathes.';
    if (worst === db) return 'it’s staring at the edge — leave room in front of the gaze.';
    if (worst === ds) return 'too cozy with the ' + item.sec.kind + ' — give the subject its own stage.';
    return 'adrift between the anchors — the sweet spots are circled.';
  }

  function finishRound() {
    roundOver = true;
    handFocus(btnLock, btnRound);
    btnLock.disabled = true;
    setLockLabel('over');
    var res = ArtDaily.report(roundScore(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The last frame's split never reached the hint (finishRound runs
       instead of the "next frame" branch), and the round score only ever
       reached a screen reader through the toast — which is a silent sticker
       now. Both belong in the one spoken line. */
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    hint.textContent = (lastLock ? lastLock.text + ' ' : '') +
      (res.isFirst
        ? 'round done — ' + res.score + '/100. that is your bar now — press “new round” and beat it.'
        : (res.isNewBest ? 'new best! round ' : 'round done — ') + res.score +
          '/100. press “new round” to go again.');
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  /* WHAT THE CANVAS SAYS IT IS. "Focal Placement drill area" is true and
     useless: this canvas is a real keyboard control (arrows nudge, Enter
     locks) and its name mentioned neither the subject, nor which way it
     faces, nor where the placement currently sits — so a player who
     cannot see the bird had no way to know any of it. Written only when
     the string changes, so a drag does not rewrite it once a frame. */
  var lastLabel = '';
  function syncCanvasLabel() {
    var s;
    if (!item) {
      s = 'Focal Placement drill area';
    } else if (roundOver) {
      s = 'Focal Placement — round over. Press “new round” to go again.';
    } else if (phase === 'reveal') {
      s = 'Focal Placement — that frame scored ' + Math.round(lastLock ? lastLock.total : 0) +
        ' of 100; the critique is written under the frame. ' +
        'Press Enter for the next frame.';
    } else {
      s = 'Focal Placement, frame ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
        ' — a bird facing ' + (item.facing > 0 ? 'right' : 'left') + '. ' +
        (subject
          ? 'Placed ' + Math.round(subject.u * 100) + '% across and ' +
            Math.round(subject.v * 100) + '% down the frame.'
          : 'Nothing placed yet.') +
        ' Arrow keys nudge the placement, hold shift for bigger steps, ' +
        'Enter locks it in.';
    }
    if (s === lastLabel) return;
    lastLabel = s;
    canvas.setAttribute('aria-label', s);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    syncCanvasLabel();
    if (!item) return;
    ctx.save();
    ctx.translate(PAD, PAD);

    var hy = item.horizon * fh;

    /* washes: watercolor sky above the horizon, graphite ground below */
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = c.accent;
    ctx.fillRect(0, 0, fw, hy);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = c.muted;
    ctx.fillRect(0, hy, fw, fh - hy);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, hy);
    ctx.lineTo(fw, hy);
    ctx.stroke();

    if (item.sec) drawSecondary(c);
    if (phase === 'reveal') drawReveal(c);
    else if (round === 1 && itemIdx === 0 && item && item.best) drawStarterHint(c);
    drawMark(c);
    if (subject) drawBird(ctx, subject.u * fw, subject.v * fh, subjScale(), item.facing, c.ink, c, false);

    /* the frame itself */
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, fw, fh);
    ctx.restore();
  }

  function drawSecondary(c) {
    var s = secPx(), i;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    if (item.sec.kind === 'rock') {
      ctx.ellipse(s.x, s.y, s.r, s.r * 0.72, 0, Math.PI, 0);
      ctx.closePath();
    } else {
      ctx.ellipse(s.x, s.y, s.r * 0.8, s.r * 0.65, 0, 0, Math.PI * 2);
    }
    for (i = 0; i < item.sec.blobs.length; i++) {
      var b = item.sec.blobs[i];
      var bx = s.x + Math.cos(b.a) * s.r * b.d;
      var by = s.y - Math.abs(Math.sin(b.a)) * s.r * b.d * 0.8;
      ctx.moveTo(bx + s.r * b.s, by);
      ctx.arc(bx, by, s.r * b.s, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  /* The thumbnail the player actually drew, kept on screen through the
     reveal so the gesture can be compared with the answer. 0.55 ink
     clears the 3:1 graphics floor on both sheets. */
  function drawMark(c) {
    if (mark.length < 2) return;
    var i;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(1.5, subjScale() * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mark[0].u * fw, mark[0].v * fh);
    for (i = 1; i < mark.length; i++) ctx.lineTo(mark[i].u * fw, mark[i].v * fh);
    ctx.stroke();
    ctx.restore();
  }

  /* THE FIRST MARK OF A FIRST ROUND IS OTHERWISE A BLIND GUESS BY
     DESIGN: everything that teaches the rule — ranked anchors, shaded
     lead room, the ghosted best placement — arrives only after it has
     been scored. One faint ring on frame 1 says "somewhere like here",
     which is enough to make the first mark informed instead of random,
     and it disappears for every frame after it. */
  function drawStarterHint(c) {
    var x = item.best.u * fw, y = item.best.v * fh;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(18, subjScale() * 1.6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = 0.8;
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('somewhere like here', x, y + Math.max(18, subjScale() * 1.6) + 6);
    ctx.restore();
  }

  function drawReveal(c) {
    if (!lastLock) return;
    var i;

    /* breathing room actually left in front of the facing, shaded */
    if (subject) {
      var sx = subject.u * fw;
      ctx.save();
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = c.accent;
      if (item.facing > 0) ctx.fillRect(sx, 0, fw - sx, fh);
      else ctx.fillRect(0, 0, sx, fh);
      ctx.restore();
    }

    /* Thirds grid. It is the whole lesson of the 50-point rule, not
       decoration, so it has to clear the 3:1 graphics floor: muted at
       0.55 read 2.0:1 over the ground wash on paper and 2.4:1 at night.
       0.9 reads 3.6:1 and 3.9:1 over the same washes. */
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(fw / 3, 0); ctx.lineTo(fw / 3, fh);
    ctx.moveTo(2 * fw / 3, 0); ctx.lineTo(2 * fw / 3, fh);
    ctx.moveTo(0, fh / 3); ctx.lineTo(fw, fh / 3);
    ctx.moveTo(0, 2 * fh / 3); ctx.lineTo(fw, 2 * fh / 3);
    ctx.stroke();
    ctx.restore();

    /* The answer: the best placement the frame allows, not the best of
       the four anchors — copying this can never cost the player points.
       0.75 alpha keeps the ghost over the 3:1 floor on both sheets. */
    var best = item.best;
    drawBird(ctx, best.u * fw, best.v * fh, subjScale(), item.facing, c.accent, c, true);

    /* SEPARATION, DRAWN. It was the only one of the three rules that was
       scored but never shown: the room ahead is shaded and the thirds are
       gridded, while "too cozy with the rock" was a phrase and nothing
       more. This is the ring you have to stay outside of. */
    if (item.sec && subject) {
      var secP = secPx();
      if (secP) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = c.muted;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(secP.x, secP.y, Math.max(secP.r + subjRadius() + 1, 0.18 * fw), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    /* the four anchors, ranked 1–4 — annotations, not the answer */
    for (i = lastLock.ranked.length - 1; i >= 0; i--) {
      var p = lastLock.ranked[i];
      var x = p.u * fw, y = p.v * fh;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? c.accent : c.card;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = i === 0 ? c.accent : c.muted;
      ctx.stroke();
      /* the accent disc is inked dark on paper and bright at night, so
         the card colour is the numeral that clears AA on both */
      ctx.fillStyle = i === 0 ? c.card : c.ink;
      ctx.font = '700 12px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
    }

    /* the room the shade is showing, as the number it is worth */
    if (subject) {
      var ahead = item.facing > 0 ? (fw - subject.u * fw) / fw : subject.u;
      var lbl = Math.round(ahead * 100) + '% ahead · full credit at 50%';
      ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = item.facing > 0 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = c.ink;
      ctx.fillText(lbl, item.facing > 0 ? fw - 5 : 5, fh - 5);
    }
  }

  /* One silhouette, facing baked into the shape: beak, tilt and tail
     all point the way the prompt promised. Takes its context so the
     little prompt glyph can reuse it. */
  function drawBird(ctx, cx, cy, s, facing, color, c, ghost) {
    var hx = cx + facing * s * 0.78, hy = cy - s * 0.62;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, s, s * 0.62, -0.12 * facing, 0, Math.PI * 2);
    ctx.moveTo(hx + s * 0.42, hy);
    ctx.arc(hx, hy, s * 0.42, 0, Math.PI * 2);
    /* beak */
    ctx.moveTo(hx + facing * s * 0.36, hy - s * 0.12);
    ctx.lineTo(hx + facing * s * 0.85, hy + s * 0.02);
    ctx.lineTo(hx + facing * s * 0.36, hy + s * 0.14);
    ctx.closePath();
    /* tail */
    ctx.moveTo(cx - facing * s * 0.7, cy - s * 0.15);
    ctx.lineTo(cx - facing * s * 1.5, cy - s * 0.5);
    ctx.lineTo(cx - facing * s * 0.8, cy + s * 0.2);
    ctx.closePath();
    ctx.fill();
    if (ghost) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      /* eye keeps the head reading as a head at silhouette size */
      ctx.fillStyle = c.card;
      ctx.beginPath();
      ctx.arc(hx + facing * s * 0.12, hy - s * 0.08, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---- input: a drawn thumbnail places the subject ----
     A composer's real gesture is a quick scribble where the subject
     goes, not a pointed finger — so the mark IS the placement and its
     centroid is what gets scored. A plain tap is a one-point mark, so
     tapping still works exactly as before, and tapping again re-marks. */
  var activePtr = null;

  /* frame-fraction point under the pointer, unclamped */
  function evPoint(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      u: (ev.clientX - rect.left - PAD) / fw,
      v: (ev.clientY - rect.top - PAD) / fh,
    };
  }

  /* the mark's centre of mass, pulled inside the frame so the whole
     bird lands in the composition it is judged in */
  function settleMark() {
    var su = 0, sv = 0, i, box = placeBox();
    if (!mark.length) return;
    for (i = 0; i < mark.length; i++) { su += mark[i].u; sv += mark[i].v; }
    subject = {
      u: clampv(su / mark.length, box.x0 / fw, box.x1 / fw),
      v: clampv(sv / mark.length, box.y0 / fh, box.y1 / fh),
    };
  }

  function startMark(ev) {
    mark = [evPoint(ev)];
    settleMark();
    if (btnLock.disabled) btnLock.disabled = false;
    /* The hint is a live region now, and this line is rewritten on every
       re-mark with identical text — write it only when it changes, so a
       screen reader is not read the same sentence at each scribble. */
    var t = 'frame ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — the centre of your mark is the placement; mark again to re-place, then lock it in.';
    if (hint.textContent !== t) hint.textContent = t;
    draw();
  }

  function extendMark(ev) {
    var p = evPoint(ev), last = mark[mark.length - 1];
    /* thin the trail: centroid accuracy needs shape, not sample rate */
    if (last && Math.abs(p.u - last.u) * fw < 1.5 && Math.abs(p.v - last.v) * fh < 1.5) return;
    mark.push(p);
    settleMark();
    draw();
  }

  /* "lock it in" changes job in place (lock → next frame →), and the
     frame itself and the Enter key fire the same action, so the second
     click of an accidental double-click — or one auto-repeat of a held
     Enter — runs the NEW job and takes the reveal with it: the ghost,
     the ranked thirds anchors and the critique split all vanish before
     they can be read. One guard on the action covers all three paths. */
  var ACTION_GUARD_MS = 250;
  var actionAt = 0;
  function primaryAction() {
    var now = Date.now();
    if (now - actionAt < ACTION_GUARD_MS) return;
    actionAt = now;
    if (phase === 'reveal' && !roundOver) nextItem();
    else lockItem();
  }

  var lastPenAt = 0;
  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    if (roundOver || !item) return;
    /* palm rejection: a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - lastPenAt < 500) return;
    /* preventDefault kills the browser's click-to-focus, so the canvas
       has to claim focus itself or the whole keyboard path goes dead */
    try { canvas.focus({ preventScroll: true }); } catch (e) {}
    if (phase === 'reveal') { primaryAction(); return; }
    activePtr = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    startMark(ev);
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (activePtr !== ev.pointerId || phase !== 'placing') return;
    ev.preventDefault();
    extendMark(ev);
  });
  function endPointer(ev) {
    if (ev.pointerId === activePtr) activePtr = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  /* keyboard: arrows nudge, enter/space locks or advances */
  canvas.addEventListener('keydown', function (ev) {
    if (roundOver || !item) return;
    var step = ev.shiftKey ? 0.04 : 0.01;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      /* a HELD Enter auto-repeats straight through lock → next → lock,
         scoring frames nobody placed; only the first press is a press */
      if (ev.repeat) return;
      primaryAction();
      return;
    }
    if (phase !== 'placing') return;
    var du = 0, dv = 0, i, box = placeBox();
    if (ev.key === 'ArrowLeft') du = -step;
    else if (ev.key === 'ArrowRight') du = step;
    else if (ev.key === 'ArrowUp') dv = -step * 1.5;
    else if (ev.key === 'ArrowDown') dv = step * 1.5;
    else return;
    ev.preventDefault();
    if (!subject) { subject = { u: 0.5, v: 0.5 }; mark = []; }
    var u = clampv(subject.u + du, box.x0 / fw, box.x1 / fw);
    var v = clampv(subject.v + dv, box.y0 / fh, box.y1 / fh);
    /* the mark travels with the subject, so the drawing never lies
       about where the score was taken */
    for (i = 0; i < mark.length; i++) {
      mark[i] = { u: mark[i].u + (u - subject.u), v: mark[i].v + (v - subject.v) };
    }
    subject = { u: u, v: v };
    if (btnLock.disabled) btnLock.disabled = false;
    draw();
  });

  btnLock.addEventListener('click', function () {
    clearDiscard();
    primaryAction();
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
  btnRound.addEventListener('click', onRoundClick);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { paintPromptBird(); draw(); });
  window.addEventListener('resize', function () { fitCanvas(); draw(); });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
