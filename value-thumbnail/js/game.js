/* ============================================================
   game.js — Value Thumbnail. One procedurally painted scene per
   round; the player rebuilds its value pattern on a 12×8 grid of
   three flat values — as tap/drag tiles or freehand brush strokes
   downsampled onto the same grid. Ground truth comes from the
   pixels: the scene renders to an offscreen canvas, each grid
   cell averages to a luminance, and natural-breaks clustering of
   those means decides which cells are light / mid / dark.
   No libraries, no network.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'value-thumbnail';
  var COLS = 12, ROWS = 8;
  var TRUTH_W = 360, TRUTH_H = 240; /* offscreen ground-truth render, 30px per cell */

  /* Three flat "paint" values — fixed pigment, deliberately not theme
     inks, so the thumbnail reads the same on paper and night-studio. */
  var PAINT = [
    { name: 'light', rgb: [233, 226, 210] },
    { name: 'mid',   rgb: [151, 144, 127] },
    { name: 'dark',  rgb: [58, 53, 43] }
  ];

  /* ===========================================================
     Pure scoring pipeline — no canvas, no DOM, unit-testable.
     Buckets: 0 = light, 1 = mid, 2 = dark.
     =========================================================== */

  /* A cell whose mean sits closer than this to a value cut is a
     toss-up: either neighbouring value earns full credit, and the
     reveal marks it as borderline instead of a misread. */
  var EPS_TOSSUP = 0.015;

  /* What painting every cell one flat value scores — the meter
     starts where zero observation ends. */
  var BASELINE_SCORE = 30;

  function luminance(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  /* Mean luminance of each grid cell of an RGBA pixel buffer (row-major). */
  function cellMeans(data, w, h, cols, rows) {
    var sums = [], counts = [], i;
    for (i = 0; i < cols * rows; i++) { sums.push(0); counts.push(0); }
    for (var y = 0; y < h; y++) {
      var cy = Math.min(rows - 1, Math.floor(y * rows / h));
      for (var x = 0; x < w; x++) {
        var cx = Math.min(cols - 1, Math.floor(x * cols / w));
        var p = (y * w + x) * 4;
        var k = cy * cols + cx;
        sums[k] += luminance(data[p], data[p + 1], data[p + 2]);
        counts[k] += 1;
      }
    }
    var means = [];
    for (i = 0; i < sums.length; i++) means.push(counts[i] ? sums[i] / counts[i] : 0);
    return means;
  }

  /* The scene defines its own value scale — but by its natural
     clusters, not equal-population terciles (which drop invisible
     cut lines through smooth gradients). Exact Fisher–Jenks for
     k = 3: brute-force the two break points minimising within-class
     squared error, O(n²) with prefix sums — trivial at n = 96.
     Thresholds sit midway across the actual gaps between clusters. */
  function jenksThresholds(means) {
    var s = means.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n < 3) return { lo: s[0] || 0, hi: s[n - 1] || 0 };
    var px = [0], pxx = [0], i;
    for (i = 0; i < n; i++) {
      px.push(px[i] + s[i]);
      pxx.push(pxx[i] + s[i] * s[i]);
    }
    /* within-class sum of squared deviations over [a, b) */
    function sse(a, b) {
      var len = b - a;
      if (len <= 0) return 0;
      var sum = px[b] - px[a];
      return (pxx[b] - pxx[a]) - sum * sum / len;
    }
    var best = Infinity, b1 = 1, b2 = 2;
    for (i = 1; i < n - 1; i++) {
      var s1 = sse(0, i);
      for (var j = i + 1; j < n; j++) {
        var t = s1 + sse(i, j) + sse(j, n);
        if (t < best) { best = t; b1 = i; b2 = j; }
      }
    }
    return { lo: (s[b1 - 1] + s[b1]) / 2, hi: (s[b2 - 1] + s[b2]) / 2 };
  }

  function quantize(mean, thr) {
    return mean < thr.lo ? 2 : (mean < thr.hi ? 1 : 0);
  }

  function bucketize(means, thr) {
    var out = [];
    for (var i = 0; i < means.length; i++) out.push(quantize(means[i], thr));
    return out;
  }

  /* Toss-up detection: for each cell, the alternate acceptable
     bucket (adjacent value) when the mean sits within eps of a
     cut, else -1. */
  function altBuckets(means, thr, eps) {
    var out = [];
    for (var i = 0; i < means.length; i++) {
      var m = means[i], b = quantize(m, thr), a = -1;
      if (b === 2 && thr.lo - m < eps) a = 1;
      else if (b === 0 && m - thr.hi < eps) a = 1;
      else if (b === 1) {
        var dLo = m - thr.lo, dHi = thr.hi - m;
        if (dLo < eps && dLo <= dHi) a = 2;
        else if (dHi < eps) a = 0;
      }
      out.push(a);
    }
    return out;
  }

  /* Exact hit (or borderline either-way) = 1, one value off = 0.15,
     opposite value = 0. */
  function cellCredit(player, truth, alt) {
    if (player === truth || player === alt) return 1;
    return Math.abs(player - truth) === 1 ? 0.15 : 0;
  }

  /* Best raw score achievable by painting every cell the same value. */
  function uniformBaseline(truth, alt) {
    var best = 0;
    for (var v = 0; v < 3; v++) {
      var sum = 0;
      for (var i = 0; i < truth.length; i++) sum += cellCredit(v, truth[i], alt ? alt[i] : -1);
      if (sum > best) best = sum;
    }
    return truth.length ? best / truth.length : 0;
  }

  /* Score rescaled against the zero-observation baseline: the best
     flat one-value grid lands exactly on BASELINE_SCORE, a perfect
     read on 100, worse-than-flat fades toward 0. */
  function scoreCells(player, truth, alt) {
    var sum = 0, exact = 0, near = 0, flipped = 0;
    for (var i = 0; i < truth.length; i++) {
      var c = cellCredit(player[i], truth[i], alt ? alt[i] : -1);
      sum += c;
      if (c === 1) exact += 1; else if (c > 0) near += 1; else flipped += 1;
    }
    var raw = truth.length ? sum / truth.length : 0;
    var base = uniformBaseline(truth, alt);
    var score;
    if (base >= 1) score = Math.round(100 * raw);
    else if (raw >= base) score = Math.round(BASELINE_SCORE + (100 - BASELINE_SCORE) * (raw - base) / (1 - base));
    else score = Math.round(BASELINE_SCORE * raw / base);
    return { score: score, exact: exact, near: near, flipped: flipped };
  }

  /* Pure grid navigation: which cell an arrow (or Home/End) moves to,
     or -1 for "no move". A GRID IS NOT A LIST — the old handler only
     tested 0 <= j < 96, so ArrowLeft on column 1 walked to column 12 of
     the row above and ArrowRight on column 12 jumped to column 1 of the
     row below. On a value thumbnail that is a silent teleport across the
     picture: the cell you were about to paint is not the cell you land
     on. Edges hold instead, and Home/End run to the ends of the row. */
  function gridNeighbour(i, key, cols, rows) {
    /* Whole numbers only, and typed ones. A cell index arrives from
       parseInt on an attribute, so a fractional or string index is not
       supposed to happen — but "3" + 1 is "31" in this language, and
       cellEls[2.5] is undefined, so an index that is merely nearly a
       number would either walk to the wrong cell or throw while setting
       its tabIndex. Refuse anything that is not an integer cell. */
    if (typeof i !== 'number' || !isFinite(i) || Math.floor(i) !== i) return -1;
    if (typeof cols !== 'number' || typeof rows !== 'number') return -1;
    if (!(cols > 0) || !(rows > 0) || Math.floor(cols) !== cols || Math.floor(rows) !== rows) return -1;
    var n = cols * rows;
    if (!(i >= 0 && i < n)) return -1;
    var r = Math.floor(i / cols), c = i % cols;
    if (key === 'ArrowLeft') return c > 0 ? i - 1 : -1;
    if (key === 'ArrowRight') return c < cols - 1 ? i + 1 : -1;
    if (key === 'ArrowUp') return r > 0 ? i - cols : -1;
    if (key === 'ArrowDown') return r < rows - 1 ? i + cols : -1;
    if (key === 'Home') return c > 0 ? r * cols : -1;
    if (key === 'End') return c < cols - 1 ? r * cols + cols - 1 : -1;
    return -1;
  }

  /* Freehand strokes → buckets: each downsampled cell mean snaps to
     the nearest of the three paint luminances (cuts at midpoints). */
  function classifyPaint(means, paintLums) {
    var t01 = (paintLums[0] + paintLums[1]) / 2;
    var t12 = (paintLums[1] + paintLums[2]) / 2;
    var out = [];
    for (var i = 0; i < means.length; i++) {
      out.push(means[i] >= t01 ? 0 : (means[i] >= t12 ? 1 : 2));
    }
    return out;
  }

  /* Posterize an RGBA buffer to the three paint values, in place. */
  function posterize(data, thr, paint) {
    for (var p = 0; p < data.length; p += 4) {
      var b = quantize(luminance(data[p], data[p + 1], data[p + 2]), thr);
      data[p] = paint[b].rgb[0];
      data[p + 1] = paint[b].rgb[1];
      data[p + 2] = paint[b].rgb[2];
    }
    return data;
  }

  /* ===========================================================
     Procedural scene — every random draw happens at spec time
     (Park–Miller PRNG) so re-rendering after a resize or theme
     flip is deterministic and matches the ground truth exactly.
     =========================================================== */

  function makeRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Ridge line: gaussian peaks over a base height + tiny wiggle. */
  function makeRidge(rng, baseY, amp, nPeaks) {
    var peaks = [], i;
    for (i = 0; i < nPeaks; i++) {
      peaks.push({ x: 0.15 + rng() * 0.7, w: 0.10 + rng() * 0.18, h: amp * (0.6 + rng() * 0.8) });
    }
    var pts = [], K = 25;
    for (i = 0; i <= K; i++) {
      var x = i / K, y = baseY;
      for (var p = 0; p < peaks.length; p++) {
        var dx = (x - peaks[p].x) / peaks[p].w;
        y -= peaks[p].h * Math.exp(-dx * dx);
      }
      y += (rng() - 0.5) * amp * 0.14;
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  /* Texture jitter: speckles clipped into the mass at render time. */
  function makeSpeckles(rng, n, jit) {
    var sp = [];
    for (var i = 0; i < n; i++) {
      sp.push({ x: rng(), y: rng(), r: 0.004 + rng() * 0.010, dl: (rng() * 2 - 1) * jit });
    }
    return sp;
  }

  /* Difficulty ramps across rounds: more masses, tighter value
     separations, louder texture — the squint has to work harder. */
  function sceneSpec(round, seed) {
    var rng = makeRng(seed);
    var d = Math.min(round - 1, 6);
    var sep = Math.max(0.09, 0.24 - 0.022 * d);
    var jit = 0.03 + 0.008 * d;
    var skyTop = 0.86 + rng() * 0.08;
    var skyBot = skyTop - (0.05 + rng() * 0.07);
    var spec = { skyTop: skyTop, skyBot: skyBot, sun: null, clouds: [], mountains: [], fg: null, obj: null };

    if (rng() < 0.55) {
      spec.sun = { x: 0.15 + rng() * 0.7, y: 0.08 + rng() * 0.18, r: 0.10 + rng() * 0.08 };
    }

    var nClouds = round >= 3 ? 1 + Math.floor(rng() * 2) : 0;
    for (var c = 0; c < nClouds; c++) {
      spec.clouds.push({
        x: 0.1 + rng() * 0.8, y: 0.08 + rng() * 0.22,
        rx: 0.10 + rng() * 0.12, ry: 0.030 + rng() * 0.030,
        lum: clamp(skyBot - sep * (0.35 + rng() * 0.3), 0.2, 1)
      });
    }

    var nM = Math.min(3, 1 + Math.floor((round - 1) / 2));
    var lum = skyBot;
    for (var m = 0; m < nM; m++) {
      lum = clamp(lum - sep * (0.85 + rng() * 0.3), 0.16, 1);
      spec.mountains.push({
        lum: lum,
        ridge: makeRidge(rng, 0.46 + m * 0.11 + rng() * 0.05, 0.10 + rng() * 0.10, 1 + Math.floor(rng() * 2)),
        speckles: makeSpeckles(rng, 30 + d * 8, jit)
      });
    }

    var fgLum = clamp(lum - sep * (0.7 + rng() * 0.4), 0.10, 1);
    spec.fg = {
      lum: fgLum,
      ridge: makeRidge(rng, 0.78 + rng() * 0.05, 0.02, 1),
      speckles: makeSpeckles(rng, 40 + d * 8, jit)
    };

    var kinds = ['tree', 'rock', 'house'];
    spec.obj = {
      kind: kinds[Math.floor(rng() * 3) % 3],
      x: 0.16 + rng() * 0.68,
      y: 0.86 + rng() * 0.05,
      s: 0.13 + rng() * 0.07,
      lum: clamp(fgLum - sep, 0.05, 0.14)
    };
    return spec;
  }

  /* Warm gray for a target luminance — the whole scene is a value study. */
  function shade(lum) {
    var v = clamp(lum, 0, 1) * 255;
    return 'rgb(' + Math.min(255, Math.round(v + 10)) + ',' + Math.round(v) + ',' + Math.max(0, Math.round(v - 14)) + ')';
  }

  function massPath(g, ridge, w, h) {
    g.beginPath();
    g.moveTo(ridge[0].x * w, ridge[0].y * h);
    for (var i = 1; i < ridge.length; i++) g.lineTo(ridge[i].x * w, ridge[i].y * h);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
  }

  function fillMass(g, mass, w, h) {
    massPath(g, mass.ridge, w, h);
    g.fillStyle = shade(mass.lum);
    g.fill();
    g.save();
    massPath(g, mass.ridge, w, h);
    g.clip();
    for (var i = 0; i < mass.speckles.length; i++) {
      var sp = mass.speckles[i];
      g.fillStyle = shade(mass.lum + sp.dl);
      g.beginPath();
      g.arc(sp.x * w, sp.y * h, Math.max(1, sp.r * w), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawObject(g, obj, w, h) {
    var s = obj.s * h, x = obj.x * w, y = obj.y * h;
    g.fillStyle = shade(obj.lum);
    if (obj.kind === 'tree') {
      g.fillRect(x - s * 0.05, y - s * 0.55, s * 0.1, s * 0.55);
      g.beginPath();
      g.arc(x, y - s * 0.75, s * 0.32, 0, Math.PI * 2);
      g.arc(x - s * 0.22, y - s * 0.58, s * 0.22, 0, Math.PI * 2);
      g.arc(x + s * 0.22, y - s * 0.60, s * 0.24, 0, Math.PI * 2);
      g.fill();
    } else if (obj.kind === 'house') {
      g.fillRect(x - s * 0.42, y - s * 0.5, s * 0.84, s * 0.5);
      g.beginPath();
      g.moveTo(x - s * 0.5, y - s * 0.5);
      g.lineTo(x, y - s * 0.9);
      g.lineTo(x + s * 0.5, y - s * 0.5);
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(x - s * 0.5, y);
      g.lineTo(x - s * 0.34, y - s * 0.42);
      g.lineTo(x - s * 0.05, y - s * 0.58);
      g.lineTo(x + s * 0.30, y - s * 0.38);
      g.lineTo(x + s * 0.5, y);
      g.closePath();
      g.fill();
    }
  }

  function renderScene(g, spec, w, h) {
    var grad = g.createLinearGradient(0, 0, 0, h * 0.8);
    grad.addColorStop(0, shade(spec.skyTop));
    grad.addColorStop(1, shade(spec.skyBot));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    if (spec.sun) {
      var r = spec.sun.r * w;
      var rad = g.createRadialGradient(spec.sun.x * w, spec.sun.y * h, 0, spec.sun.x * w, spec.sun.y * h, r);
      rad.addColorStop(0, 'rgba(255,251,238,0.95)');
      rad.addColorStop(0.35, 'rgba(255,249,230,0.55)');
      rad.addColorStop(1, 'rgba(255,249,230,0)');
      g.fillStyle = rad;
      g.fillRect(0, 0, w, h);
    }

    for (var c = 0; c < spec.clouds.length; c++) {
      var cl = spec.clouds[c];
      g.fillStyle = shade(cl.lum);
      g.beginPath();
      g.ellipse(cl.x * w, cl.y * h, cl.rx * w, cl.ry * h, 0, 0, Math.PI * 2);
      g.ellipse((cl.x - cl.rx * 0.7) * w, (cl.y + cl.ry * 0.4) * h, cl.rx * 0.55 * w, cl.ry * 0.7 * h, 0, 0, Math.PI * 2);
      g.ellipse((cl.x + cl.rx * 0.7) * w, (cl.y + cl.ry * 0.3) * h, cl.rx * 0.6 * w, cl.ry * 0.75 * h, 0, 0, Math.PI * 2);
      g.fill();
    }

    for (var m = 0; m < spec.mountains.length; m++) fillMass(g, spec.mountains[m], w, h);
    fillMass(g, spec.fg, w, h);
    drawObject(g, spec.obj, w, h);
  }

  /* ===========================================================
     DOM / canvas wiring
     =========================================================== */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnDone = document.getElementById('btnDone');
  var gridEl = document.getElementById('valueGrid');
  var paintCanvasEl = document.getElementById('paintCanvas');
  var paintGuideEl = document.getElementById('paintGuide');
  var paintCtx = paintCanvasEl.getContext('2d', { willReadFrequently: true });
  var legendTxt = document.getElementById('legendTxt');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim()
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; 3:2 like the grid ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.round(W * 2 / 3);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- offscreen ground truth ---- */
  var truthCanvas = document.createElement('canvas');
  truthCanvas.width = TRUTH_W;
  truthCanvas.height = TRUTH_H;
  var truthCtx = truthCanvas.getContext('2d', { willReadFrequently: true });
  var posterCanvas = document.createElement('canvas');
  posterCanvas.width = TRUTH_W;
  posterCanvas.height = TRUTH_H;

  var truthAlt = null; /* per-cell alternate acceptable bucket, -1 = none */

  function computeTruth(spec) {
    truthCtx.clearRect(0, 0, TRUTH_W, TRUTH_H);
    renderScene(truthCtx, spec, TRUTH_W, TRUTH_H);
    var img = truthCtx.getImageData(0, 0, TRUTH_W, TRUTH_H);
    var means = cellMeans(img.data, TRUTH_W, TRUTH_H, COLS, ROWS);
    var thr = jenksThresholds(means);
    var poster = truthCtx.createImageData(TRUTH_W, TRUTH_H);
    poster.data.set(img.data);
    posterize(poster.data, thr, PAINT);
    posterCanvas.getContext('2d').putImageData(poster, 0, 0);
    truthAlt = altBuckets(means, thr, EPS_TOSSUP);
    return bucketize(means, thr);
  }

  /* ---- round state ---- */
  var round = 0, playing = false, revealed = false, showPoster = false, showTruthGrid = false;
  var spec = null, truth = null;
  var cells = [], brush = 1;
  var gridPenAt = 0; /* palm rejection: last time a pen was seen */
  /* "has the player laid an answer down yet" — one flag for both
     surfaces, because the mode button now carries the work across. */
  var paintMode = false, touched = false;

  /* the players' three paint luminances, for freehand classification */
  var PAINT_LUMS = [];
  for (var pv = 0; pv < 3; pv++) {
    PAINT_LUMS.push(luminance(PAINT[pv].rgb[0], PAINT[pv].rgb[1], PAINT[pv].rgb[2]));
  }

  /* ---- the tap-grid (built once; 96 buttons, keyboard-friendly) ---- */
  var cellEls = [];
  (function buildGrid() {
    for (var i = 0; i < COLS * ROWS; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vt-cell vt-c0';
      b.setAttribute('data-i', String(i));
      /* ROVING TABINDEX: one tab stop for the whole grid, not ninety-six.
         Every cell is a <button>, so Tab used to walk all 96 of them one
         at a time before it could reach "done" — with arrow-key roving
         already implemented right below, that is 95 tab stops of pure
         toll. The grid takes a single stop; arrows move inside it, which
         is how a grid widget is meant to behave. */
      b.tabIndex = i === 0 ? 0 : -1;
      gridEl.appendChild(b);
      cellEls.push(b);
    }
  })();

  var rovingI = 0;
  function setRoving(i) {
    if (!(i >= 0 && i < cellEls.length) || i === rovingI) return;
    cellEls[rovingI].tabIndex = -1;
    cellEls[i].tabIndex = 0;
    rovingI = i;
  }
  /* a mouse click focuses a cell too — the tab stop follows the player */
  gridEl.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var i = parseInt(t.getAttribute('data-i'), 10);
    if (!isNaN(i)) setRoving(i);
  });

  /* ---- brush swatches: tap to pick the paint value ---- */
  var legendSw = gridEl.parentNode.querySelectorAll('.vt-sw');
  function updateLegend() {
    for (var v = 0; v < 3; v++) {
      legendSw[v].className = 'vt-sw vt-sw' + v + (v === brush && playing ? ' vt-sw-on' : '');
      legendSw[v].disabled = !playing;
      legendSw[v].setAttribute('aria-pressed', String(v === brush));
    }
  }
  (function wireSwatches() {
    function pick(v) {
      return function () {
        if (!playing) return;
        brush = v;
        updateLegend();
      };
    }
    for (var v = 0; v < 3; v++) legendSw[v].addEventListener('click', pick(v));
  })();

  /* THE LEGEND WENT ON OFFERING A FLIP THE PLAYER HAD ALREADY MADE.
     "tap the grid or the scene to flip to the true pattern" was written
     once at the reveal and never again, so after one tap the grid WAS the
     true pattern and the caption under it still said the answer was
     somewhere else. The grid is 96 identical squares; the caption is the
     only thing on screen that says which of the two you are looking at,
     which makes a stale caption worse than none. */
  function updateLegendTxt() {
    if (revealed) {
      legendTxt.textContent = showTruthGrid
        ? 'showing the TRUE pattern · tap the grid to flip back to your read'
        : 'showing YOUR read, marked · tap the grid or the scene for the true pattern';
    } else if (paintMode) legendTxt.textContent = 'swatches pick a brush · drag strokes · scored on the same 12×8';
    else legendTxt.textContent = 'swatches pick a brush · drag paints · tap cycles a cell';
  }

  /* WHAT THE SCENE CANVAS SAYS IT IS. Its label was written once, in the
     HTML, and never changed: "A small painted scene to study. After
     scoring, activate to flip between the scene and its true three
     values." Every word of that stayed true forever — and that is the
     problem. Enter on this canvas flips the picture between the painted
     scene and its posterised answer, and the label never said WHICH of
     the two was on screen, so the one control whose entire job is
     toggling a view reported its state to nobody. It also invited a
     keypress during play that does nothing at all. Written only when the
     string changes, like the sibling drills' canvas labels. */
  var lastSceneLabel = '';
  function syncSceneLabel() {
    var s;
    if (!revealed) {
      s = 'The scene, round ' + round + ' — a small painted landscape to study.' +
        ' Half-shut your eyes and read its light, mid and dark masses, then paint them' +
        ' on the grid. It becomes flippable once the round is scored.';
    } else if (showPoster) {
      s = 'The scene, posterised to its true three values — this is the answer pattern.' +
        ' Press Enter to flip back to the painted scene.';
    } else {
      s = 'The scene as painted, round ' + round + ' — scored.' +
        ' Press Enter to flip to its true three values.';
    }
    if (s === lastSceneLabel) return;
    lastSceneLabel = s;
    canvas.setAttribute('aria-label', s);
  }

  function cellLabel(i, v) {
    return 'row ' + (Math.floor(i / COLS) + 1) + ', column ' + ((i % COLS) + 1) + ' — ' + PAINT[v].name;
  }

  function paintCellEl(i) {
    var el = cellEls[i];
    el.innerHTML = '';
    el.className = 'vt-cell vt-c' + cells[i];
    el.setAttribute('aria-label', cellLabel(i, cells[i]));
  }

  /* your answer + marks: dashed = one off, solid = flipped,
     dotted = borderline cell where either neighbour counted */
  function revealGrid() {
    for (var i = 0; i < cells.length; i++) {
      var el = cellEls[i];
      el.innerHTML = '';
      el.className = 'vt-cell vt-c' + cells[i];
      var toss = truthAlt[i] >= 0;
      if (cellCredit(cells[i], truth[i], truthAlt[i]) === 1) {
        /* correct cells stay bare: no mark IS the affirmation, and 96
           little ticks would bury the value pattern the reveal is for.
           Screen readers get the same news from the label. */
        el.setAttribute('aria-label', cellLabel(i, cells[i]) +
          (toss && cells[i] !== truth[i] ? ' — correct (borderline cell)' : ' — correct'));
      } else {
        var m = document.createElement('i');
        m.className = 'vt-mark vt-m' + truth[i] +
          (Math.abs(truth[i] - cells[i]) === 2 ? ' vt-flip' : '') +
          (toss ? ' vt-toss' : '');
        el.appendChild(m);
        el.setAttribute('aria-label', cellLabel(i, cells[i]) + ' — should be ' + PAINT[truth[i]].name +
          (toss ? ' (borderline: ' + PAINT[truthAlt[i]].name + ' also counted)' : ''));
      }
    }
    gridEl.classList.remove('vt-grid-truth');
    setGridLabel('Your 12 by 8 value thumbnail, marked against the true pattern');
  }

  /* The group's name is the only thing that says WHOSE thumbnail the 96
     cells are, and the reveal flip swaps that out from under it: after one
     tap every cell reads "true value" inside a group still called "Your
     12 by 8 value thumbnail". Written only when it changes. */
  var lastGridLabel = '';
  function setGridLabel(s) {
    if (s === lastGridLabel) return;
    lastGridLabel = s;
    gridEl.setAttribute('aria-label', s);
  }

  /* the full truth pattern at grid scale, accent-ringed like the poster */
  function revealGridTruth() {
    for (var i = 0; i < truth.length; i++) {
      var el = cellEls[i];
      el.innerHTML = '';
      el.className = 'vt-cell vt-c' + truth[i];
      el.setAttribute('aria-label', cellLabel(i, truth[i]) + ' — true value');
    }
    gridEl.classList.add('vt-grid-truth');
    setGridLabel('The true 12 by 8 value pattern for this scene');
  }

  function toggleTruthGrid() {
    showTruthGrid = !showTruthGrid;
    if (showTruthGrid) revealGridTruth(); else revealGrid();
    updateLegendTxt();
  }

  /* A tap cycles the cell — and used to silently REASSIGN THE BRUSH as a
     side effect. Combined with the lift-and-re-place a trackpad has to
     make, that meant one stray re-place both flipped a cell and armed
     the wrong paint, so the next drag laid dozens of cells in a value
     the player never chose. The three swatches above are the brush
     picker; picking up a value is their job, not a tap's. */
  function cycle(i) {
    cells[i] = (cells[i] + 1) % 3;
    touched = true;
    paintCellEl(i);
    updateLegend();
  }

  /* Map a pointer to a cell from the cells' own boxes (the grid rect
     alone is skewed by its padding, border and gaps). */
  function cellFromPoint(x, y) {
    var rect = gridEl.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return -1;
    var r0 = cellEls[0].getBoundingClientRect();
    var stepX = cellEls[1].getBoundingClientRect().left - r0.left || 1;
    var stepY = cellEls[COLS].getBoundingClientRect().top - r0.top || 1;
    var col = clamp(Math.floor((x - r0.left) / stepX), 0, COLS - 1);
    var row = clamp(Math.floor((y - r0.top) / stepY), 0, ROWS - 1);
    return row * COLS + col;
  }

  /* Tap vs drag: a press only cycles if it never leaves its cell.
     The moment a drag crosses a cell edge it paints with the brush —
     including the start cell — so growing a painted region never
     flips the cell you started on. */
  /* One pointer owns the grid at a time: a second finger landing mid-drag
     used to steal pressI, so the first finger's tap silently painted the
     wrong cell. Every handler below is keyed to the owning pointerId. */
  var pressI = -1, didDrag = false, gridPointer = null;

  /* A TRACKPAD CANNOT CROSS 96 CELLS IN ONE THROW. You drag, run out of
     pad, lift, re-place, drag again. Every re-place that happened to
     land and lift inside a single cell used to read as a deliberate TAP
     and cycle that cell — the player watched their own thumbnail
     corrupt itself mid-stroke with no idea why. A press that starts
     soon after, and close to, the previous lift is the SAME gesture
     continuing: it keeps painting with the current brush.

     AND IT IS A TRACKPAD PROBLEM, SO IT IS A TRACKPAD RULE.
     Running out of surface is something only a relative pointer does. A
     finger and an absolute-mapped pen both address the grid directly and
     never need to re-place — but they were paying for the fix anyway: on
     a phone, 48px is not quite two cells, so the ordinary habit of
     painting a mass and then immediately tapping a neighbouring cell to
     correct it landed inside the window and painted with the brush
     instead of cycling. The tap did nothing visible and the player had
     no way to know why. Only 'mouse' pointers can resume a stroke. */
  var RESUME_MS = 450, RESUME_PX = 48;
  var lastLiftAt = 0, lastLiftX = 0, lastLiftY = 0;

  function isResume(ev) {
    return ev.pointerType === 'mouse' &&
      (Date.now() - lastLiftAt) < RESUME_MS &&
      Math.abs(ev.clientX - lastLiftX) <= RESUME_PX &&
      Math.abs(ev.clientY - lastLiftY) <= RESUME_PX;
  }

  function releaseGrid() {
    gridPointer = null;
    pressI = -1;
    didDrag = false;
  }
  gridEl.addEventListener('pointerdown', function (ev) {
    if (!playing) {
      if (revealed) toggleTruthGrid();
      return;
    }
    if (gridPointer !== null) return;
    /* a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') gridPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - gridPenAt < 500) return;
    ev.preventDefault();
    var i = cellFromPoint(ev.clientX, ev.clientY);
    if (i < 0) return;
    gridPointer = ev.pointerId;
    pressI = i;
    didDrag = false;
    if (isResume(ev)) {
      /* the stroke never really ended — carry on painting */
      didDrag = true;
      touched = true;
      if (cells[i] !== brush) { cells[i] = brush; paintCellEl(i); }
    }
    try { gridEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  gridEl.addEventListener('pointermove', function (ev) {
    if (ev.pointerId !== gridPointer || pressI < 0 || !playing) return;
    var i = cellFromPoint(ev.clientX, ev.clientY);
    if (i < 0) return;
    if (!didDrag) {
      if (i === pressI) return;
      didDrag = true;
      touched = true;
      if (cells[pressI] !== brush) {
        cells[pressI] = brush;
        paintCellEl(pressI);
      }
    }
    if (cells[i] !== brush) {
      cells[i] = brush;
      paintCellEl(i);
    }
  });
  function endPress(ev) {
    if (gridPointer === null || (ev && ev.pointerId !== gridPointer)) return;
    var wasStroke = didDrag;
    if (pressI >= 0 && !didDrag && playing) cycle(pressI);
    /* ONLY A LIFT THAT ENDED A STROKE ARMS THE RESUME WINDOW. Arming it
       on every lift armed it for plain taps too, so the next tap — an
       ordinary double-tap, or the neighbouring cell on a phone, both
       well inside 450 ms and 48 px — read as "the stroke continues" and
       painted with the current brush instead of cycling. With the
       default mid brush on the all-mid opening grid that meant every tap
       after the first did nothing at all. */
    if (wasStroke && ev && typeof ev.clientX === 'number') {
      lastLiftAt = Date.now();
      lastLiftX = ev.clientX;
      lastLiftY = ev.clientY;
    }
    releaseGrid();
  }
  gridEl.addEventListener('pointercancel', function (ev) {
    if (ev.pointerId === gridPointer) releaseGrid();
  });

  /* Keyboard: Enter/Space fires click with detail 0 (pointer taps are
     handled on pointerup); arrows rove between cells. */
  gridEl.addEventListener('click', function (ev) {
    if (ev.detail !== 0) return;
    if (revealed) { toggleTruthGrid(); return; }
    if (!playing) return;
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var i = parseInt(t.getAttribute('data-i'), 10);
    if (!isNaN(i)) cycle(i);
  });
  gridEl.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var i = parseInt(t.getAttribute('data-i'), 10);
    if (isNaN(i)) return;
    var j = gridNeighbour(i, ev.key, COLS, ROWS);
    if (j < 0) return;
    ev.preventDefault();
    setRoving(j);
    cellEls[j].focus();
  });

  /* ---- brush mode: freehand strokes on a 360×240 canvas ---- */
  var BRUSH_R = 15; /* one grid cell wide — mass-shaping, not detailing */

  function paintRGB(v) {
    return 'rgb(' + PAINT[v].rgb[0] + ',' + PAINT[v].rgb[1] + ',' + PAINT[v].rgb[2] + ')';
  }

  /* Opens on MID, matching the grid: the loudest wrong answer is not a
     good starting point, and starting flat-mid is far less painting. */
  function clearPaint() {
    paintCtx.fillStyle = paintRGB(1);
    paintCtx.fillRect(0, 0, TRUTH_W, TRUTH_H);
    touched = false;
  }

  /* THE GRID AND THE PAD ARE TWO VIEWS OF ONE ANSWER. They used to be
     two independent states, and "done" scored whichever one the mode
     flag happened to point at — so one press of "brush mode" after doing
     the work silently threw it away and reported the untouched surface
     (a flat mid grid, ~30/100) to the permanent record, with no warning
     and no undo. The mode button carries the answer across instead.
     Grid → pad is exact: one flat 30×30 block per cell in the same three
     paints. Pad → grid is the same downsample "done" scores with, so
     what the grid shows is what would have been marked. */
  function gridToPaint() {
    var cw = TRUTH_W / COLS, ch = TRUTH_H / ROWS;
    for (var i = 0; i < cells.length; i++) {
      paintCtx.fillStyle = paintRGB(cells[i]);
      paintCtx.fillRect(Math.round((i % COLS) * cw), Math.round(Math.floor(i / COLS) * ch),
        Math.ceil(cw), Math.ceil(ch));
    }
  }

  function paintToGrid() {
    var img = paintCtx.getImageData(0, 0, TRUTH_W, TRUTH_H);
    cells = classifyPaint(cellMeans(img.data, TRUTH_W, TRUTH_H, COLS, ROWS), PAINT_LUMS);
    for (var i = 0; i < cells.length; i++) paintCellEl(i);
  }

  function syncSurfaces() {
    var showPaint = paintMode && !revealed;
    paintCanvasEl.hidden = !showPaint;
    gridEl.hidden = showPaint;
    /* The 12×8 guide stays visible OVER the paint canvas (as an overlay,
       never as pixels — it would otherwise be downsampled into the
       score). Those cells are what the score is measured on, so hiding
       them made brush mode feel like a different game. */
    if (paintGuideEl) paintGuideEl.hidden = !showPaint;
  }

  /* same one-pointer rule as the grid: two fingers used to share lastPX/
     lastPY, so a second touch drew a stroke snapping between them */
  var paintPointer = null, lastPX = 0, lastPY = 0;
  function paintPoint(ev) {
    var r = paintCanvasEl.getBoundingClientRect();
    return {
      x: clamp((ev.clientX - r.left) * TRUTH_W / r.width, 0, TRUTH_W),
      y: clamp((ev.clientY - r.top) * TRUTH_H / r.height, 0, TRUTH_H)
    };
  }
  function strokeTo(x, y, first) {
    paintCtx.fillStyle = paintRGB(brush);
    paintCtx.strokeStyle = paintRGB(brush);
    paintCtx.lineWidth = BRUSH_R * 2;
    paintCtx.lineCap = 'round';
    paintCtx.lineJoin = 'round';
    if (first) {
      paintCtx.beginPath();
      paintCtx.arc(x, y, BRUSH_R, 0, Math.PI * 2);
      paintCtx.fill();
    } else {
      paintCtx.beginPath();
      paintCtx.moveTo(lastPX, lastPY);
      paintCtx.lineTo(x, y);
      paintCtx.stroke();
    }
    lastPX = x;
    lastPY = y;
    touched = true;
  }
  paintCanvasEl.addEventListener('pointerdown', function (ev) {
    if (!playing || !paintMode) return;
    /* a pen beats a palm that landed first */
    if (ev.pointerType === 'pen') gridPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - gridPenAt < 500) return;
    if (paintPointer !== null) return;
    ev.preventDefault();
    try { paintCanvasEl.setPointerCapture(ev.pointerId); } catch (e) {}
    paintPointer = ev.pointerId;
    var p = paintPoint(ev);
    strokeTo(p.x, p.y, true);
  });
  paintCanvasEl.addEventListener('pointermove', function (ev) {
    if (ev.pointerId !== paintPointer) return;
    var p = paintPoint(ev);
    strokeTo(p.x, p.y, false);
  });
  paintCanvasEl.addEventListener('pointercancel', function (ev) {
    if (ev.pointerId === paintPointer) paintPointer = null;
  });

  window.addEventListener('pointerup', function (ev) {
    if (ev.pointerId === paintPointer) paintPointer = null;
    endPress(ev);
  });

  /* ---- painting the scene panel ---- */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    syncSceneLabel();
    if (!spec) return;
    if (revealed && showPoster) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(posterCanvas, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      /* the answer view wears the accent, like a corrected sketch */
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    } else {
      renderScene(ctx, spec, W, H);
    }
    /* faint 12×8 guide so scene regions map onto grid cells */
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < COLS; i++) {
      var gx = Math.round(i * W / COLS) + 0.5;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
    }
    for (var r = 1; r < ROWS; r++) {
      var gy = Math.round(r * H / ROWS) + 0.5;
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* after scoring, tapping the scene flips original ↔ true three values */
  canvas.addEventListener('pointerdown', function (ev) {
    if (!revealed) return;
    ev.preventDefault();
    showPoster = !showPoster;
    draw();
  });
  canvas.addEventListener('keydown', function (ev) {
    if (!revealed) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      showPoster = !showPoster;
      draw();
    }
  });

  /* ---- round flow ---- */
  function newRound() {
    round += 1;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE — and in this drill it
       really is one line, because the scene was already deterministic. Every
       draw a scene needs comes out of the Park-Miller generator in
       sceneSpec(); the only thing that was ever unpredictable was the SEED
       handed to it, and that is what is dealt here instead. So the whole
       conversion is: swap the source of ONE uniform. Nothing downstream of
       it moves — same seed range, same generator, same scene, same ground
       truth. round 1 of a sitting is today's shared scene (seeded from today
       and this slug); round 2 and on are practice, freshly seeded per round,
       so a replay cannot deal the scene just played. sceneSpec also reads
       `round` for its difficulty ramp, so everyone's round 1 is the same
       difficulty as well as the same scene.

       Fully device-independent, unusually: the ground truth renders to a
       fixed 360x240 offscreen buffer (TRUTH_W/TRUTH_H) and the grid is
       always 12x8, so a phone and a desktop score the identical cells — the
       visible canvas size only decides how big the picture is drawn.

       GUARDED, and the guard is load-bearing. index.html cache-busts its own
       scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js BARE, so
       the two files cache INDEPENDENTLY: a returning visitor holding a warm
       SDK from any other drill plus a cold copy of this file would call a
       function that does not exist, throw before the scene is built, and sit
       on a blank sheet forever. Falling back to Math.random costs today's
       player nothing but a non-comparable round. */
    var roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    spec = sceneSpec(round, 1 + Math.floor(roundRng() * 2147483000));
    truth = computeTruth(spec);
    cells = [];
    /* Start on MID, not on light. All-light is both the loudest wrong
       answer and the most work: the player had to repaint every mid cell
       before they could even begin thinking about the pattern. Opening
       on mid means only the lights and darks need marking, which is what
       a value thumbnail actually is. */
    for (var i = 0; i < COLS * ROWS; i++) {
      cells.push(1);
      paintCellEl(i);
    }
    brush = 1;
    playing = true;
    revealed = false;
    showPoster = false;
    showTruthGrid = false;
    /* drop any live stroke so a stale pointer can't paint the new grid */
    releaseGrid();
    paintPointer = null;
    gridEl.classList.remove('vt-grid-truth');
    setGridLabel('Your 12 by 8 value thumbnail');
    /* one primary CTA while a round is live: done */
    btnRound.classList.remove('btn-primary');
    clearPaint();
    syncSurfaces();
    updateLegend();
    updateLegendTxt();
    btnDone.disabled = false;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hint.textContent = paintMode
      ? 'Half-shut your eyes at the scene, then brush its light-and-dark pattern in big flat masses — the swatches pick which value you paint with.'
      : 'Half-shut your eyes at the scene (the grid starts all mid) — pick a swatch and drag to paint that value; a plain tap cycles one cell light → mid → dark.';
    draw();
  }

  function finishRound() {
    if (!playing) return;
    if (paintMode) {
      var img = paintCtx.getImageData(0, 0, TRUTH_W, TRUTH_H);
      cells = classifyPaint(cellMeans(img.data, TRUTH_W, TRUTH_H, COLS, ROWS), PAINT_LUMS);
    }
    playing = false;
    revealed = true;
    showPoster = true;
    showTruthGrid = false;
    /* disabling the button that was just pressed drops keyboard focus on
       <body>, so the next Tab restarts at the back link — hand it to the
       only way forward instead */
    if (document.activeElement === btnDone) {
      try { btnRound.focus({ preventScroll: true }); } catch (e) { try { btnRound.focus(); } catch (e2) {} }
    }
    btnDone.disabled = true;
    /* done is spent — hand the primary role to the only way forward */
    btnRound.classList.add('btn-primary');
    updateLegend();
    syncSurfaces();
    var res = scoreCells(cells, truth, truthAlt);
    revealGrid();
    draw();
    var rep = ArtDaily.report(res.score);
    hudScore.textContent = String(rep.score);
    hudBest.textContent = rep.best === null ? '–' : String(rep.best);
    /* The hint is this drill's only spoken channel — the toast is a
       sticker (aria-hidden, like the template's), not a second voice — so
       the round score has to lead this line or a screen-reader player only
       ever hears the cell tally and never the number it earned. */
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    hint.textContent = (rep.isFirst ? 'first score, your mark to beat — '
        : rep.isNewBest ? 'new best! ' : 'round done — ') + rep.score + '/100 · ' +
      res.exact + ' exact · ' + res.near + ' one step off · ' + res.flipped +
      ' flipped (light where dark belongs, the worst kind of miss) — marks ink the true value;' +
      ' tap the scene or the grid to compare, then press “new round”.';
    updateLegendTxt();
    showToast(rep.isFirst
      ? 'first score ' + rep.score + ' / 100 — your mark to beat'
      : (rep.isNewBest ? 'new best! ' : 'score ') + rep.score + ' / 100',
      rep.isNewBest && !rep.isFirst);
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
  btnDone.addEventListener('click', finishRound);

  /* "new round" arms first when it would discard work — a second
     press within the window confirms; otherwise it snaps back. */
  var btnRound = document.getElementById('btnRound');
  /* THE ARMING WAS INVISIBLE TO ANYONE NOT WATCHING THE BUTTON. Its only
     signal was the button's own label, and a name that changes under a
     focused button is not re-announced by any screen reader — so the press
     read as "nothing happened", and a player who then waited out the
     window pressed again, re-armed, heard nothing again, and could never
     reach a new round at all. The hint is this drill's live region, so the
     arming is said there; the line it replaced goes back when the arming
     lapses, unless something newer already claimed it. 2.6s is not long
     enough to hear a polite announcement AND still press. */
  var ROUND_ARM_MS = 4500;
  var roundArmTimer = null, roundArmed = false, armSaid = '', hintBeforeArm = '';
  function disarmRoundBtn() {
    roundArmed = false;
    clearTimeout(roundArmTimer);
    btnRound.innerHTML = 'new round <span aria-hidden="true">↻</span>';
    if (armSaid && hint.textContent === armSaid) hint.textContent = hintBeforeArm;
    armSaid = '';
  }
  btnRound.addEventListener('click', function () {
    /* Armed only when there IS work to discard. The old test asked
       whether any cell was not light, but a fresh round opens all-MID,
       so it fired on an untouched grid and made every "new round" a
       two-press affair. */
    var hasWork = playing && touched;
    if (hasWork && !roundArmed) {
      roundArmed = true;
      btnRound.textContent = 'discard round?';
      hintBeforeArm = hint.textContent;
      armSaid = 'that scraps this thumbnail — press “new round” again to start over, or carry on.';
      hint.textContent = armSaid;
      roundArmTimer = setTimeout(disarmRoundBtn, ROUND_ARM_MS);
      return;
    }
    disarmRoundBtn();
    newRound();
  });

  var btnMode = document.getElementById('btnMode');
  btnMode.addEventListener('click', function () {
    /* carry the work over before the surfaces swap (mid-round only —
       after the reveal the grid is showing the marked answer) */
    if (playing) {
      if (paintMode) paintToGrid(); else gridToPaint();
    }
    paintMode = !paintMode;
    btnMode.setAttribute('aria-pressed', String(paintMode));
    syncSurfaces();
    updateLegendTxt();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  window.addEventListener('resize', function () { fitCanvas(); draw(); });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
