/* ============================================================
   game.js — Down the Row. A fence of evenly spaced posts runs
   away from the camera; two of them are drawn. Draw the next
   one: press at its foot and pull up to its top.

   The lesson is the one that gives away every faked perspective
   drawing — things that repeat evenly in the WORLD do not repeat
   evenly in the PICTURE. The gaps close up and the posts shrink,
   both faster than they look, so the honest answer is nowhere
   near "same gap again, same height again".

   The truth is not eyeballed. Each scene is a real pinhole
   camera: eye height 1, ground at Y = -1, posts standing on the
   ground at X = x0 + i·a, Z = 1 + i·g, every vertex divided by
   its own depth. The fit that drops the projection onto the
   sheet is a uniform scale plus an offset — which is just a
   different focal length and principal point, so the picture
   stays a picture a real lens could have taken, and the third
   post's foot and top are exact by construction rather than
   approximately right.

   Skeleton follows the template: init → round → input → REVEAL
   → score → ArtDaily.report, one theme-aware canvas, no
   libraries. Geometry lives in canvas FRACTIONS so a phone
   rotated mid-round keeps its round; the reveal's mark is the
   pixel offset that was scored, so the gap on screen is always
   the gap the printed number describes.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'down-the-row';
  var ITEMS_PER_ROUND = 4;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     PURE START — geometry and scoring. No canvas, no DOM, no
     module state: numbers in, numbers out, so the whole block
     lifts straight into node and can be hammered with degenerate
     input. Two rules everything here holds:
       · finite 0–100 (or a usable string) for ANY input — empty
         arrays, zero sizes, NaN, a zero-length reference. Never
         NaN, never a throw: a NaN loses every comparison it
         touches, so one leak scores the whole round 0 in silence.
       · monotonic in the error: more wrong can never score higher.
     ============================================================ */

  var ASPECT = 0.62;        /* canvas height ÷ canvas width */
  var PAD_X = 0.085;        /* side margin, fraction of the width  */
  var PAD_B = 0.05;         /* floor margin, fraction of the height */

  function fin(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---- the camera ----
     Three posts of equal world height standing on the ground, evenly
     spaced along a straight line, seen by a level pinhole. Everything
     is divided by its own depth — that division IS the drill.
     Returns canvas FRACTIONS (fx of the width, fby/fty of the height)
     or null if the parameters cannot make a picture. Total: junk
     parameters are pulled back into a range that still projects. */
  function buildScene(p) {
    var g = fin(p && p.g, 0.6);            /* depth step between posts   */
    var a = fin(p && p.a, 1.2);            /* sideways step between them */
    var x0 = fin(p && p.x0, -1.2);         /* where the row starts       */
    var ph = fin(p && p.ph, 0.6);          /* post height ÷ eye height   */
    var hy = fin(p && p.hy, 0.24);         /* eye level, fraction of H   */
    var zoom = fin(p && p.zoom, 1);
    var jit = fin(p && p.jit, 0);
    var sgn = (p && p.mirror) ? -1 : 1;
    g = clamp(g, 0.05, 6);
    ph = clamp(ph, 0.08, 0.92);            /* below eye level, always    */
    hy = clamp(hy, 0.06, 0.45);
    zoom = (zoom > 0.25 && zoom <= 1) ? zoom : 1;
    if (!(Math.abs(a) <= 40)) a = 1.2;
    if (!(Math.abs(x0) <= 40)) x0 = -1.2;

    var H = ASPECT, u = [], vb = [], vt = [], i, Z;
    for (i = 0; i < 3; i++) {
      Z = 1 + i * g;                        /* depth of post i           */
      u.push(sgn * (x0 + i * a) / Z);       /* X ÷ Z                     */
      vb.push(1 / Z);                       /* the foot, below the horizon */
      vt.push((1 - ph) / Z);                /* the top                   */
    }
    /* The frame reserves room for where the row is GOING — a fourth post's
       worth past the answer. Two reasons, and the second is not cosmetic:
       a row jammed against the edge reads as a row that has stopped, and
       the reveal has to be able to draw the far end of the tolerance, which
       lives about one gap past the true post. Fitted so tightly that it
       fell off the sheet, the scale would be a mark the player never sees. */
    var uNext = u[2] + 1.3 * (u[2] - u[1]);
    var umin = Math.min(u[0], u[1], u[2], uNext), umax = Math.max(u[0], u[1], u[2], uNext);
    var vmax = Math.max(vb[0], vb[1], vb[2]);
    var spanU = Math.max(1e-6, umax - umin);
    var availY = Math.max(1e-6, H * (1 - PAD_B - hy));
    /* A uniform scale + offset = a different focal length and principal
       point. The picture stays a real photograph, and it fills the sheet. */
    var s = zoom * Math.min((1 - 2 * PAD_X) / spanU, availY / Math.max(1e-6, vmax));
    if (!(s > 0) || !isFinite(s)) return null;
    var ox = 0.5 + jit - s * (umin + umax) / 2;
    var loX = PAD_X - s * umin, hiX = 1 - PAD_X - s * umax;
    if (loX <= hiX) ox = clamp(ox, loX, hiX);
    var oy = hy * H;

    var posts = [];
    for (i = 0; i < 3; i++) {
      posts.push({
        fx: ox + s * u[i],
        fby: (oy + s * vb[i]) / H,
        fty: (oy + s * vt[i]) / H,
      });
    }
    if (!isFinite(posts[2].fx) || !isFinite(posts[2].fby) || !isFinite(posts[2].fty)) return null;
    return {
      posts: posts,
      hy: hy,
      vpfx: ox + s * (sgn * a / g),         /* where the row aims on the eye level */
      dir: posts[2].fx >= posts[0].fx ? 'right' : 'left',
    };
  }

  /* Why a scene may not be used. '' means it is playable: the answer is
     far enough from the last drawn post to be aimed at, small enough to
     have something to teach, and wholly on the sheet. */
  function sceneFaults(sc) {
    if (!sc || !sc.posts || sc.posts.length !== 3) return 'no scene';
    var p = sc.posts, i;
    for (i = 0; i < 3; i++) {
      if (!p[i] || !isFinite(p[i].fx) || !isFinite(p[i].fby) || !isFinite(p[i].fty)) return 'not finite';
      if (!(p[i].fby > p[i].fty)) return 'inside out';
    }
    var H = ASPECT;
    var g01 = Math.hypot(p[1].fx - p[0].fx, (p[1].fby - p[0].fby) * H);
    var g12 = Math.hypot(p[2].fx - p[1].fx, (p[2].fby - p[1].fby) * H);
    var h0 = p[0].fby - p[0].fty, h2 = p[2].fby - p[2].fty;
    if (!(g01 > 0.02)) return 'row too tight';
    if (!(g12 >= 0.06 && g12 <= 0.32)) return 'answer gap';
    /* The ceiling is what makes the drill teach rather than tolerate. A row
       that barely recedes makes "same gap again" nearly right, and the
       mistake the drill exists to correct would collect a passing mark:
       at a ratio of 0.52 that answer lands 0.92 gaps out, which the
       zero-point (1.2 gaps on a trackpad) marks in the twenties. The
       floor keeps the answer from being a sliver too small to aim at. */
    var r = g12 / g01;
    if (!(r >= 0.16 && r <= 0.52)) return 'nothing to learn';
    if (!(h2 >= 0.09 && h2 <= 0.42)) return 'answer height';
    if (!(h0 <= 0.62)) return 'near post too tall';
    if (!(p[2].fx >= 0.07 && p[2].fx <= 0.95)) return 'answer off sheet';
    if (!(p[0].fx >= 0.02 && p[0].fx <= 0.98)) return 'row off sheet';
    if (!(p[2].fby >= sc.hy + 0.06)) return 'answer on the horizon';
    if (!(p[0].fby <= 0.99)) return 'row through the floor';
    /* The near post must stand near the bottom of the sheet. The fit takes
       the smaller of the two constraints, so a row that is very wide in
       the picture gets scaled down until it fills the width — and leaves a
       third of the sheet as empty ground under a row of little sticks.
       Nothing is wrong with such a scene except that it is small, and
       small is the difference between reading a fence and squinting at one. */
    if (!(p[0].fby >= 0.84)) return 'half an empty sheet';
    return '';
  }

  /* The ramp lives INSIDE the round: item one is a gentle row whose third
     post is big and clearly separated — a cold beginner's first attempt
     should be at something obviously there and obviously reachable — and
     each item after it runs away harder. Item one also always recedes to
     the right, the direction a reader's eye already travels. */
  var BANDS = [
    { g: [0.42, 0.58], a: [0.50, 0.95], x0: [-1.35, -0.70], ph: [0.50, 0.72], hy: [0.20, 0.28], mirror: 0 },
    { g: [0.55, 0.80], a: [0.50, 1.00], x0: [-1.30, -0.70], ph: [0.45, 0.70], hy: [0.18, 0.30], mirror: 1 },
    { g: [0.78, 1.10], a: [0.50, 1.05], x0: [-1.25, -0.68], ph: [0.42, 0.66], hy: [0.17, 0.30], mirror: 1 },
    { g: [1.00, 1.40], a: [0.50, 1.10], x0: [-1.20, -0.62], ph: [0.38, 0.62], hy: [0.16, 0.30], mirror: 1 },
  ];

  /* One known-good scene per band. Sampling can miss — the fallback means
     a round can never stall on an unplayable item, and the tests check
     every one of these passes sceneFaults(). */
  var FALLBACK = [
    { x0: -1.20, a: 0.60, g: 0.50, ph: 0.62, hy: 0.24, zoom: 1, jit: 0, mirror: false },
    { x0: -1.10, a: 0.70, g: 0.68, ph: 0.58, hy: 0.23, zoom: 1, jit: 0, mirror: false },
    { x0: -1.00, a: 0.70, g: 0.95, ph: 0.52, hy: 0.22, zoom: 1, jit: 0, mirror: true },
    { x0: -0.90, a: 0.70, g: 1.25, ph: 0.46, hy: 0.21, zoom: 1, jit: 0, mirror: false },
  ];

  /* Deterministic given its random source, so a test can drive it. */
  function pickScene(rnd, idx) {
    var r = (typeof rnd === 'function') ? rnd : Math.random;
    var i = clamp(Math.floor(fin(idx, 0)), 0, BANDS.length - 1);
    var b = BANDS[i];
    function span(range) {
      var v = r();
      if (!isFinite(v)) v = 0.5;
      return range[0] + clamp(v, 0, 1) * (range[1] - range[0]);
    }
    for (var t = 0; t < 40; t++) {
      var sc = buildScene({
        g: span(b.g), a: span(b.a), x0: span(b.x0), ph: span(b.ph), hy: span(b.hy),
        zoom: span([0.88, 1]),
        jit: (clamp(fin(r(), 0.5), 0, 1) - 0.5) * 0.06,
        mirror: b.mirror ? r() < 0.5 : false,
      });
      if (sc && !sceneFaults(sc)) return sc;
    }
    return buildScene(FALLBACK[i]);
  }

  /* Fractions → pixels. Kept pure so the input handler and the painter
     read the identical geometry, and so a resize is just a new W. */
  function scenePx(sc, w, h) {
    var W = fin(w, 0), H = fin(h, 0);
    if (!sc || !sc.posts || sc.posts.length < 3 || !(W > 0) || !(H > 0)) return null;
    var out = [];
    for (var i = 0; i < 3; i++) {
      out.push({
        x: sc.posts[i].fx * W,
        by: sc.posts[i].fby * H,
        ty: sc.posts[i].fty * H,
      });
    }
    return { posts: out, hy: fin(sc.hy, 0.24) * H, vpx: fin(sc.vpfx, 0.5) * W, dir: sc.dir };
  }

  /* ---- the zero-point: where the score runs out ----
     Three fifths of the gap the answer sits at, because that gap IS the
     size of the judgement being made — a row that has closed to 40px
     apart cannot be marked with the same slack as one still 200px apart,
     and a fixed pixel tolerance would quietly hand the easy items a
     stricter standard than the hard ones. Eased from here, so on a
     trackpad the score runs out about one whole gap out: a post drawn
     with no diminution at all (the mistake the drill exists to correct)
     lands past that and scores nothing, one drawn half-corrected still
     collects a third of the marks, and 90 needs the gap read to within a
     tenth. Held between 3% and 13% of the sheet — the floor so a phone is
     never asked for work no finger can do, the ceiling so the scale stays
     something that can be drawn on the sheet it is measured on. Eased by
     the CALLER, never here: this is the drill's own base constant, and
     ease() is the only thing allowed to know what is in the hand. */
  function zeroBase(gapPx, w) {
    var W = fin(w, 480);
    if (!(W > 0)) W = 480;
    var lo = Math.max(12, W * 0.030);
    var hi = Math.max(lo, W * 0.130);
    var g = fin(gapPx, 0);
    return clamp(g > 0 ? g * 0.6 : lo, lo, hi);
  }

  /* 100 dead on, 0 at `zero` px out or beyond. */
  function postAccuracy(err, zero) {
    var e = Math.abs(fin(err, Infinity));
    var z = fin(zero, 0);
    if (!isFinite(e) || !(z > 0)) return 0;
    return clamp((1 - e / z) * 100, 0, 100);
  }

  /* Foot and top, each judged against the same zero-point and averaged.
     Misplacing the foot moves the top with it, so placement is counted
     twice and height once — which is the right weighting: the spacing is
     the lesson, the height is its consequence. */
  function postScore(footErr, topErr, zero) {
    return (postAccuracy(footErr, zero) + postAccuracy(topErr, zero)) / 2;
  }

  function roundScore(list) {
    if (!list || !list.length) return 0;
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var v = Number(list[i]);
      sum += isFinite(v) ? clamp(v, 0, 100) : 0;
    }
    return sum / list.length;
  }

  /* The unit vector the row runs along, from the last drawn post to the
     answer. A degenerate row falls back to "along the sheet" rather than
     handing NaN to everything downstream. */
  function rowUnit(x1, y1, x2, y2) {
    var dx = fin(x2, 0) - fin(x1, 0), dy = fin(y2, 0) - fin(y1, 0);
    var d = Math.hypot(dx, dy);
    if (!(d > 0) || !isFinite(d)) return { ux: 1, uy: 0 };
    return { ux: dx / d, uy: dy / d };
  }

  /* The two ends of the tolerance, marked on the line the score is
     measured along: `zero` px either side of the true point, in the
     direction the row runs. A CIRCLE of this radius would be wider than
     the sheet it is drawn on — the corridor is the same scale, drawn
     where it can actually be read. Pure, so the test can confirm the far
     end still lands on the canvas the player is looking at. */
  function gateEnds(x1, y1, x2, y2, zero) {
    var u = rowUnit(x1, y1, x2, y2);
    var z = fin(zero, 0);
    if (!(z > 0)) z = 0;
    var x = fin(x2, 0), y = fin(y2, 0);
    return {
      back: { x: x - u.ux * z, y: y - u.uy * z },
      fwd: { x: x + u.ux * z, y: y + u.uy * z },
      ux: u.ux, uy: u.uy,
    };
  }

  /* ---- the reveal, in words (pure too, and held to the same bar) ----
     A bare number teaches nothing on the round that matters most: nobody
     can tell 58 from 72 by feel, and neither says which way to move. The
     adjective is taken from the SCORE, not from a second tolerance of its
     own, so the words and the number can never contradict each other —
     "dead on" beside a 40 reads as the drill being broken. */
  var GRADES = [
    { min: 92, adv: '', alone: 'Dead on' },
    { min: 75, adv: 'A hair', alone: 'A hair off' },
    { min: 50, adv: 'A little', alone: 'A little off' },
    { min: 20, adv: 'Much', alone: 'Well off' },
    { min: -1, adv: 'Way', alone: 'Way off' },
  ];

  function gradeOf(score) {
    var s = fin(score, 0);
    for (var i = 0; i < GRADES.length; i++) if (s >= GRADES[i].min) return GRADES[i];
    return GRADES[GRADES.length - 1];
  }

  /* Which faults are worth naming, biggest first, at most two — a
     sentence that lists three is a paragraph nobody reads mid-round.
     Under an eighth of the tolerance is not a fault, it is noise; above
     it the direction is always named, because "a hair off" tells a
     beginner nothing they can act on and "a hair too wide" does. */
  function faultParts(along, perp, dh, zero) {
    var z = fin(zero, 0);
    if (!(z > 0)) z = 1;
    var al = fin(along, 0), pe = fin(perp, 0), h = fin(dh, 0);
    var list = [
      { m: Math.abs(al), w: al > 0 ? 'too wide' : 'too tight' },
      { m: Math.abs(h), w: h > 0 ? 'too tall' : 'too short' },
      { m: Math.abs(pe), w: 'off the row line' },
    ];
    list.sort(function (p, q) { return q.m - p.m; });
    var out = [];
    for (var i = 0; i < list.length && out.length < 2; i++) {
      if (list[i].m >= z * 0.125) out.push(list[i].w);
    }
    return out;
  }

  function postPhrase(score, along, perp, dh, zero) {
    var g = gradeOf(score);
    if (!g.adv) return g.alone;
    var f = faultParts(along, perp, dh, zero);
    if (!f.length) return g.alone;
    return g.adv + ' ' + f.join(' and ');
  }

  /* The words and the number travel TOGETHER, in that order. A non-finite
     score drops the number rather than printing "NaN out of 100" into a
     line that gets read out loud. */
  function postWords(phrase, score) {
    var head = (typeof phrase === 'string' && phrase.trim()) ? phrase : 'Off the mark';
    var n = Number(score);
    if (!isFinite(n)) return head;
    return head + ' — ' + Math.round(clamp(n, 0, 100)) + ' out of 100 for that post';
  }

  /* ---- the round's lesson, which no single post can show ----
     Four posts all spaced too wide are not four misses, they are one
     habit, and it is the only correction that outlives the round. Fires
     only on a lean that is BOTH consistent (most items the same way) and
     big enough to aim off (an eighth of the tolerance), so it can never
     invent a pattern out of noise, and it names the STRONGER of the two
     habits rather than reciting both. '' means "nothing honest to say". */
  function roundBias(marks, zero) {
    if (!marks || !marks.length) return '';
    var z = fin(zero, 0);
    if (!(z > 0)) z = 1;
    var n = 0, sa = 0, sh = 0, wide = 0, tight = 0, tall = 0, low = 0;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m) continue;
      var a = Number(m.along), h = Number(m.dh);
      if (!isFinite(a) || !isFinite(h)) continue;
      n++; sa += a; sh += h;
      if (a > 0) wide++; else if (a < 0) tight++;
      if (h > 0) tall++; else if (h < 0) low++;
    }
    if (n < 3) return '';
    var ma = sa / n, mh = sh / n;
    var most = Math.max(2, Math.ceil(n * 0.6));
    /* The count must agree with the mean, or two wild misses one way
       outvote three small ones the other and the sentence points backwards. */
    var gapOk = Math.abs(ma) >= z * 0.125 && (ma > 0 ? wide : tight) >= most;
    var hOk = Math.abs(mh) >= z * 0.125 && (mh > 0 ? tall : low) >= most;
    if (!gapOk && !hOk) return '';
    if (gapOk && (!hOk || Math.abs(ma) >= Math.abs(mh))) {
      return ma > 0
        ? 'Your gaps ran wide all round — the row closes up faster than it looks; crowd the next one in.'
        : 'Your gaps ran tight all round — the row closes up, but not that fast; give the next one more room.';
    }
    return mh > 0
      ? 'Your posts ran tall all round — each one is further away, so each one is shorter.'
      : 'Your posts ran short all round — they shrink going back, but not that fast.';
  }

  /* THE BEAT MUST OUTLAST THE READING, or the reveal is decoration.
     Budget it against the text that is NEW on that screen at ~200 words a
     minute — a beginner reading unfamiliar copy while also looking at a
     picture. On a repeat reveal only the clause changes ("Much too wide
     and too tall — 31", ~1.6s); the rest is furniture the eye knows. On
     the first reveal of the sitting nothing is furniture yet: two guide
     lines, four end ticks, a mark and the sentence that names the ticks.
     Pure, so the pacing can be reasoned about without a canvas.
     The LAST reveal of a round has no beat at all — it stays on the sheet
     until "new round" is pressed, which is why the once-a-sitting note
     about the diagonal is spent there and nowhere else. */
  var REVEAL_MS = 1800;
  var FIRST_REVEAL_MS = 4000;

  function revealBeat(roundNo, done) {
    return (fin(roundNo, 0) === 1 && fin(done, 0) === 1) ? FIRST_REVEAL_MS : REVEAL_MS;
  }

  /* ---- the sheet, in words (pure, total) ----
     Only the canvas knows what was painted, and a canvas is a blank to
     anyone who cannot see it. Junk comes back a usable phrase, never NaN:
     this feeds an accessible name, which is READ OUT LOUD. */
  function rowWords(dir) {
    return dir === 'left' ? 'running back to the left' : 'running back to the right';
  }

  /* ============================================================
     PURE END — canvas and DOM from here down.
     ============================================================ */

  /* ---- theme-aware inks (read once per THEME, not once per repaint) ----
     `accent` is the decorative wash; `mark` is the same accent mixed
     toward --ink, and it is what anything CARRYING MEANING on the canvas
     must be drawn in — the watercolour accents are decorative-strength on
     paper, and a truth a player cannot see is not a truth. Defined as
     --canvas-accent below the marker in css/style.css. Every one of these
     moves only when data-theme moves, and getComputedStyle cannot answer
     until style has been resolved — so reading them per repaint flushed a
     style recalculation into the middle of a stroke. An empty read (cold
     boot, stylesheet not parsed) is never cached. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--mint').trim();
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
    if (w === W && dpr === lastDpr) return false;   /* a phone's URL bar resizes constantly */
    W = w;
    H = Math.max(1, Math.round(W * ASPECT));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ----
     The scene is stored as FRACTIONS of the canvas. Rotate a phone
     mid-round and the canvas goes 900px → 390px wide; anything remembered
     at x=826 is then off the sheet, can never be drawn on, and the round
     can never finish or report. The aspect is fixed, so a resize is a
     uniform scale and the projection stays the projection. */
  var round = 0, itemIdx = 0, scores = [], marks = [], item = null, playing = false;
  var reveal = null, revealTimer = null;
  var lastScore = null;      /* the round-end number, for the sheet's name only */

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
  }

  /* A stroke shorter than this is a stray press, not a post: nothing is
     ever punished for a UI reason. Through startRadius so a finger and a
     hand that cannot see itself get the room they need — but never more
     than a third of the post being asked for, or a genuinely short far
     post on a small sheet would be refused as an accident. */
  function minStroke(truePostH) {
    var h = fin(truePostH, 0);
    var floor = Math.max(6, h > 0 ? h * 0.35 : 6);
    return Math.max(6, Math.min(ArtDaily.startRadius(12), floor));
  }

  /* Says the verb in the words for the thing actually drawn, so the first
     screen teaches without the how-to being opened — and on the very
     first screen it also says the rule the whole drill turns on (the
     posts are evenly spaced in the world) plus how a miss is marked.
     One clause, opening screen only: from item two the reveals have been
     teaching it in numbers, and repeating it is noise in the one live
     region a screen-reader player has. */
  function itemHint(idx, teach) {
    var s = 'Fence ' + (fin(idx, 0) + 1) + ' of ' + ITEMS_PER_ROUND +
            ' — press at the foot of the next post and pull up to its top.';
    return teach
      ? s + ' The posts are evenly spaced along the fence; the closer yours lands, the more it scores.'
      : s;
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    scores = [];
    marks = [];
    playing = true;
    lastScore = null;
    cancelStroke();
    clearReveal();          /* a queued advance from the abandoned round must not fire */
    item = pickScene(Math.random, 0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();            /* the last round's score must not hang over this one */
    hint.textContent = itemHint(0, round === 1);
    draw();
  }

  function nextItem() {
    revealTimer = null;
    if (!playing) return;   /* the round was abandoned while the reveal was up */
    reveal = null;
    item = pickScene(Math.random, itemIdx);
    hint.textContent = itemHint(itemIdx, false);
    draw();
  }

  /* ---- the sheet, in words ----
     The canvas is role="img", so its accessible name IS the picture to
     anyone who cannot see it, and a name fixed at boot describes a blank
     rectangle for the whole session. Refreshed from draw() so the name
     and the paint can never drift apart, and guarded so a drill
     repainting per pointer sample costs one setAttribute, not sixty.
     NOT a live region: a name is spoken on navigation, so it never
     competes with the hint line. Held to the same bar as the scoring —
     it runs inside draw(), which runs inside the pointer handler. */
  var sheetName = '';

  function describeSheet() {
    var sc = reveal ? reveal.scene : item;
    var txt;
    if (!sc) {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    } else if (reveal) {
      var words = String(reveal.words || 'off the mark').toLowerCase();
      var pct = isFinite(reveal.score) ? ', ' + Math.round(reveal.score) + ' out of 100.' : '.';
      txt = 'Drill sheet: fence ' + itemIdx + ' of ' + ITEMS_PER_ROUND + ' — two posts ' +
            rowWords(sc.dir) + ' under the eye-level line, the true third post drawn ' +
            'beside your own — ' + words + pct;
      /* isFinite(null) is true — null coerces to 0 — so the null check has
         to come first or a fresh round says "Round done: null out of 100". */
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else {
      txt = 'Drill sheet: fence ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND + ' — two fence posts ' +
            rowWords(sc.dir) + ' under the eye-level line. Draw the third.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    describeSheet();
    var sc = reveal ? reveal.scene : item;
    var P = scenePx(sc, W, H);
    if (!P) return;
    drawHorizon(c, P);
    drawGiven(c, P);
    if (reveal) { drawReveal(c, P, reveal); return; }
    if (!playing) return;
    drawStroke(c);
  }

  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  /* The eye level, named on the sheet: it is the reference the whole row
     is built on, and an unlabelled line is a term the drill never taught. */
  function drawHorizon(c, P) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.moveTo(0, P.hy);
    ctx.lineTo(W, P.hy);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.muted;
    ctx.font = '11px ' + MONO;
    ctx.textBaseline = 'bottom';
    ctx.fillText('eye level', 6, Math.max(12, P.hy - 4));
    ctx.textBaseline = 'alphabetic';
  }

  function drawPost(c, x, by, ty, colour, width) {
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x, ty);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /* The two posts you are given, standing on a short ground tick each —
     two feet on a line is the whole clue for where the third foot goes. */
  function drawGiven(c, P) {
    for (var i = 0; i < 2; i++) {
      var p = P.posts[i];
      var tick = Math.max(7, (p.by - p.ty) * 0.16);
      drawPost(c, p.x, p.by, p.ty, c.ink, 2.5);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.muted;
      ctx.beginPath();
      ctx.moveTo(p.x - tick, p.by);
      ctx.lineTo(p.x + tick, p.by);
      ctx.stroke();
    }
  }

  /* The post being drawn, live under the hand. Ink, because it is the
     player's own line; the truth arrives in the accent afterwards. */
  function drawStroke(c) {
    if (!dragStart || !dragNow) return;
    var a = { x: dragStart.fx * W, y: dragStart.fy * H };
    var b = { x: dragNow.fx * W, y: dragNow.fy * H };
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.ink;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
    /* The foot, marked from the first frame of the press: a stroke that
       shows nothing until it has length reads as a press that was missed. */
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* Extend the line through two points to both edges of the sheet. */
  function edgeLine(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var d = Math.hypot(dx, dy);
    if (!(d > 0) || !isFinite(d)) return null;
    var k = (W + H) * 2 / d;
    return { ax: x1 - dx * k, ay: y1 - dy * k, bx: x1 + dx * k, by: y1 + dy * k };
  }

  function dashLine(c, colour, a, dash, width) {
    if (!a) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(a.ax, a.ay);
    ctx.lineTo(a.bx, a.by);
    ctx.stroke();
    ctx.restore();
  }

  /* A short tick across the guide line at each end of the tolerance: land
     out there and the post is worth nothing. Small and quiet, because it
     is the ruler, not the answer — but never invisible, since the printed
     number cannot be read without it. */
  function drawGate(c, g) {
    var len = 8;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.moveTo(g.back.x + g.uy * len, g.back.y - g.ux * len);
    ctx.lineTo(g.back.x - g.uy * len, g.back.y + g.ux * len);
    ctx.moveTo(g.fwd.x + g.uy * len, g.fwd.y - g.ux * len);
    ctx.lineTo(g.fwd.x - g.uy * len, g.fwd.y + g.ux * len);
    ctx.stroke();
    ctx.restore();
  }

  /* The truth over the attempt, with the gap between them drawn as the
     thing it is — after EVERY post, not just at round end. What you did,
     what was right, the distance named, and the scale it was measured on. */
  function drawReveal(c, P, rv) {
    var truth = P.posts[2], p0 = P.posts[0], p1 = P.posts[1];
    /* Where the row was always going: both lines run through the two
       posts you were given and meet on the eye level. The third post
       stands between them — that is the whole answer, drawn. */
    dashLine(c, c.muted, edgeLine(p0.x, p0.by, p1.x, p1.by), [5, 5], 1.2);
    dashLine(c, c.muted, edgeLine(p0.x, p0.ty, p1.x, p1.ty), [5, 5], 1.2);
    /* Once a sitting, on the one reveal that has no beat to outrun: the
       diagonal from the first post's top through the second's middle
       lands on the third post's foot — exact, because in the world it is
       the straight line from a post top through the next post's waist. */
    if (rv.showDiag) {
      dashLine(c, c.mark, edgeLine(p0.x, p0.ty, p1.x, (p1.by + p1.ty) / 2), [2, 4], 1.2);
    }

    /* The scale the number was measured on. Without it the only thing on
       the sheet is the answer, and a 62 has nothing to be read against.
       Taken from the reveal, never from ease() again: the hardware can
       change while a reveal is up, and the number is history — so is the
       scale it was measured against. "Faint" is a look, not a licence to
       be unreadable, so this sits at 0.85 alpha, not 0.4. */
    var zr = fin(rv.zero, 0);
    if (zr > 4) {
      drawGate(c, gateEnds(p1.x, p1.by, truth.x, truth.by, zr));
      drawGate(c, gateEnds(p1.x, p1.ty, truth.x, truth.ty, zr));
    }

    /* The true post. */
    drawPost(c, truth.x, truth.by, truth.ty, c.mark, 3);
    ctx.fillStyle = c.mark;
    ctx.beginPath();
    ctx.arc(truth.x, truth.by, 3.5, 0, Math.PI * 2);
    ctx.fill();

    /* The post that was drawn, placed by the OFFSETS that were scored, so
       the gap on screen is always the gap the number describes whatever
       the canvas has done since. Kept on the sheet after a hard shrink: a
       mark drawn off the edge is no reveal at all. */
    var fx = clamp(truth.x + fin(rv.dfx, 0), 4, W - 4);
    var fy = clamp(truth.by + fin(rv.dfy, 0), 4, H - 4);
    var tx = clamp(truth.x + fin(rv.dtx, 0), 4, W - 4);
    var ty = clamp(truth.ty + fin(rv.dty, 0), 4, H - 4);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
    ctx.stroke();

    /* The gap itself, foot to foot and top to top. */
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(truth.x, truth.by);
    ctx.moveTo(tx, ty);
    ctx.lineTo(truth.x, truth.ty);
    ctx.stroke();
    ctx.restore();
  }

  /* ---- input → score ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /* Kept as fractions: a phone rotated mid-stroke must not move the foot
     the player already committed to. */
  function toFrac(p) {
    return { fx: (W > 0 ? p.x / W : 0.5), fy: (H > 0 ? p.y / H : 0.5) };
  }

  var activeId = null, dragStart = null, dragNow = null;

  function cancelStroke() {
    activeId = null;
    dragStart = null;
    dragNow = null;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* A second finger must not start a second post, and neither may a
       press that lands while a reveal still holds the screen — the next
       fence is not drawn yet, so there is nothing it could honestly be
       judged against. Ignored, never counted against them. */
    if (!playing || !item || reveal || ev.isPrimary === false) return;
    if (activeId !== null) return;
    /* Only a press that MEANS "here". A right-click is a pointerdown like
       any other — primary pointer, real coordinates — so unguarded it
       burns an item and scores wherever the cursor sat while the context
       menu opens over the reveal explaining it. `button` is 0 for a
       finger and for a pen's tip, so this costs touch and pen nothing. */
    if (ev.button > 0) return;
    ev.preventDefault();
    activeId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    var p = pointerPos(ev);
    dragStart = toFrac(p);
    dragNow = toFrac(p);
    draw();               /* the press that just landed is the one frame that must not wait */
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (activeId === null || ev.pointerId !== activeId) return;
    ev.preventDefault();
    /* Full-rate samples: the digitizer runs far ahead of the display and
       hands the frame's whole run of positions over on one event, so the
       newest of them is where the hand actually is now. */
    var ss = ArtDaily.samples(ev);
    dragNow = toFrac(pointerPos(ss.length ? ss[ss.length - 1] : ev));
    schedule();           /* …and paint at most once a frame */
  });

  function releaseCapture(ev) {
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  }

  function endStroke(ev) {
    if (activeId === null || ev.pointerId !== activeId) return;
    if (ev.preventDefault) ev.preventDefault();
    releaseCapture(ev);
    var start = dragStart, end = toFrac(pointerPos(ev));
    cancelStroke();
    commit(start, end);
  }

  function dropStroke(ev) {
    if (activeId === null || ev.pointerId !== activeId) return;
    releaseCapture(ev);
    cancelStroke();       /* a lost stroke costs nothing: no item, no score */
    draw();
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', dropStroke);
  /* The same two on the window, in the bubble phase, as a dead-state guard.
     Pointer capture normally hands the canvas its own release wherever the
     hand lets go — but capture can be refused, and then a press that drags
     off the sheet and releases outside it never reaches the canvas at all.
     The stroke would stay "live" for the rest of the session: no new press
     accepted, the item never drawable, the round never finishable, never
     reported. When capture DID work, the canvas handler has already cleared
     activeId by the time the event bubbles here, so this sees nothing to do
     — one commit either way. */
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', dropStroke);

  function commit(startFrac, endFrac) {
    if (!playing || !item || reveal || !startFrac || !endFrac) { draw(); return; }
    var P = scenePx(item, W, H);
    if (!P) { draw(); return; }
    var truth = P.posts[2], prev = P.posts[1];
    var a = { x: startFrac.fx * W, y: startFrac.fy * H };
    var b = { x: endFrac.fx * W, y: endFrac.fy * H };
    /* A stray press or a stroke too short to be a post resets free. */
    if (Math.hypot(b.x - a.x, b.y - a.y) < minStroke(truth.by - truth.ty)) { draw(); return; }
    /* Drawn upward or downward, it is the same post: the lower end is the
       foot. Nothing is punished for a UI reason. */
    var foot = a.y >= b.y ? a : b;
    var top = a.y >= b.y ? b : a;

    var gap = Math.hypot(truth.x - prev.x, truth.by - prev.by);
    /* Zero-point through the SDK, so an honest miss reads as an honest
       miss on a pen, a trackpad and a finger alike. */
    var zero = ArtDaily.ease(zeroBase(gap, W));
    var dfx = foot.x - truth.x, dfy = foot.y - truth.by;
    var dtx = top.x - truth.x, dty = top.y - truth.ty;
    var u = rowUnit(prev.x, prev.by, truth.x, truth.by);
    var along = dfx * u.ux + dfy * u.uy;      /* + = further along the row than the truth */
    var perp = -dfx * u.uy + dfy * u.ux;      /* off the line the feet run along */
    var dh = (foot.y - top.y) - (truth.by - truth.ty);
    var score = postScore(Math.hypot(dfx, dfy), Math.hypot(dtx, dty), zero);

    scores.push(score);
    marks.push({ along: along, dh: dh });
    itemIdx += 1;
    reveal = {
      scene: item,
      dfx: dfx, dfy: dfy, dtx: dtx, dty: dty,
      /* The zero-point is kept WITH the mark, for the same reason the mark
         is kept as an offset: a pen plugged in while the reveal is up
         would otherwise redraw the rings at half their size under a number
         measured on the old ones. */
      zero: zero,
      score: score,
      words: postPhrase(score, along, perp, dh, zero),
      showDiag: round === 1 && itemIdx >= ITEMS_PER_ROUND,
    };
    /* The guide lines and their end ticks appear for the first time UNDER
       this sentence, and an unexplained new mark is a term the drill never
       taught — it just happens to be drawn instead of typed. Named once,
       on the one screen where it is new. */
    hint.textContent = postWords(reveal.words, score) + '.' +
      (round === 1 && itemIdx === 1
        ? ' The short ticks on the guide lines are where the score runs out.' : '');
    draw();
    /* The last post does NOT wait on the beat: finishing is synchronous,
       so report() can never be raced by "new round" landing during the
       reveal. The reveal simply stays on the sheet behind the score. */
    if (itemIdx >= ITEMS_PER_ROUND) { finishRound(); return; }
    revealTimer = setTimeout(nextItem, revealBeat(round, itemIdx));
  }

  /* A number on its own is not a reveal, and "new best!" on the very
     first round celebrates nothing — it is true of every player's first
     round ever played, fired on the one round where they most need to be
     told what the number MEANS. The last post keeps its words here too:
     item four is an attempt like any other. The round's own correction
     goes last, and the once-a-sitting note about the diagonal after it,
     on the one screen that stays up until the player leaves it. */
  function roundWords(res, last, bias, diag) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = (bias ? ' ' + bias : '') + (diag ? ' ' + diag : '');
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  var DIAG_NOTE = 'The thin diagonal is the trick: from the first post’s top, ' +
                  'through the second post’s middle, down to the third post’s foot.';

  function finishRound() {
    playing = false;                  /* set first: report() fires exactly once */
    clearTimeout(revealTimer);        /* nothing may advance past a finished round */
    revealTimer = null;
    draw();                           /* the last post stays up as the reveal */
    var res = ArtDaily.report(roundScore(scores));
    /* The picture has not changed — only what is known about it has, and
       the score is not known until report() answers. Re-name, do not repaint. */
    lastScore = res.score;
    describeSheet();
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = roundWords(
      res,
      reveal && postWords(reveal.words, reveal.score),
      roundBias(marks, reveal ? reveal.zero : 0),
      reveal && reveal.showDiag ? DIAG_NOTE : '');
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* The toast is a STICKER, not a second voice: it says nothing the hint
     line has not already said in a fuller sentence. Two live regions
     written in the same tick queue up and say the same thing twice, so
     this one is aria-hidden in index.html — keep it that way. */
  function showToast(msg, celebrate) {
    clearTimeout(toastTimer);
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

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session. Treat it as "resize the
     geometry", never as "re-judge what is already on screen": the reveal
     carries its own zero-point for exactly that reason. */
  ArtDaily.onInput(draw);

  /* Both resize sources fire in bursts for a single drag, and a fit that
     really changes size REALLOCATES the canvas backing store and clears
     it. Measure and repaint at most once a frame, and only when the size
     actually moved. The same scheduler carries the stroke's repaints:
     the browser delivers pointermove faster than it paints, so a repaint
     per sample is several full-sheet washes per frame with all but one
     thrown away — and each is main-thread time the next sample waits
     behind. Sampling and painting are separate questions. */
  function raf(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
  var paintPending = false;
  function schedule() {
    if (paintPending) return;
    paintPending = true;
    raf(function () { paintPending = false; draw(); });
  }
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () { fitPending = false; if (fitCanvas()) draw(); });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches what window.resize cannot: the canvas
     measuring 0 at boot (a background tab, or a late layout) and getting
     its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
