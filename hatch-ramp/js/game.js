/* ============================================================
   game.js — Hatch a Ramp: build a value ramp out of pencil
   strokes instead of dragging a slider. Three panels per round.
   Each panel is a sheet of paper with the target ramp printed on
   the swatch strip beside it; the player hatches inside the
   paper — many short parallel strokes, packed tighter where it
   should be darker — and the ink accumulates live, so overlaps
   really do darken.

   Scoring reads the rendered panel back: mean ink density in 24
   bands along the ramp axis, smoothed, normalised, compared with
   the target curve, plus a small parallelism term. Density is
   read from the ALPHA channel of the ink layer, so it is
   theme-proof and colour-proof — only the marks count.

   Everything above the "Canvas / DOM" divider is pure: arrays in,
   numbers out, no canvas, no DOM, no clock, no randomness.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'hatch-ramp';

  var BANDS = 24;            /* density bands the score is computed over */
  var SHOW_BANDS = 12;       /* swatches in the strip + bands in the reveal */
  var SMOOTH_PASSES = 2;     /* squinting: both curves get the same blur */
  var MIN_STROKES = 15;      /* below this, "done" just asks for more ink */

  var HATCH_ALPHA = 0.32;    /* one pass of the pencil */
  var HATCH_PX = 5;          /* pencil width in CSS px */
  var REF_PEAK = 0.86;       /* darkness the reference strip prints its 1.0 at */
  var MIN_PEAK = 0.10;       /* normalisation floor — 15 specks cannot fake a ramp */

  var ERROR_FREE = 0.035;    /* mean density error forgiven (100 must be reachable) */
  var ZERO_ERROR = 0.22;     /* eased: mean density error that scores 0 */
  var ZERO_SPREAD = 0.60;    /* eased: stroke-angle spread (rad) that scores 0 */
  var FREE_SPREAD = 0.05;    /* ~3° of angle wobble forgiven */
  var DIR_WEIGHT = 0.15;     /* parallelism is 15% of a panel */

  var SNAP_PAD = 22;         /* base for startRadius: a near-miss press snaps in */
  var MIN_STROKE_PX = 8;     /* shorter than this is a tap, not a stroke */
  var REVEAL_LOCK_MS = 400;  /* a stray stroke right after "done" must not skip the reveal */
  var PEN_LOCK_MS = 700;     /* a finger is inert this long after the pen last spoke */

  /* ============================================================
     Pure scoring — no canvas, no DOM.
     ============================================================ */

  /* THE CLAMPS HAVE TO CLAMP NaN TOO. Written as `v < lo ? lo : v > hi ?
     hi : v`, both comparisons are false for NaN and for null, so the
     value the guard exists to bound walked straight out the other side:
     rampScore(NaN curves) answered NaN, and panelScore(null, null)
     answered null — from the two functions the whole panel score is
     assembled out of, both of them advertised as returning 0–100. Every
     clamped value in this file now leaves as a real number in range,
     which is what every caller already assumes and what report() needs
     (a NaN there is filed as a 0 the player did not earn).
     `+v` first, then compare against the LOW end: NaN and null both fail
     `> lo` and fall to lo. For any real number the answer is unchanged,
     including exactly at either end. */
  function clamp01(v) { v = +v; return v > 0 ? (v < 1 ? v : 1) : 0; }
  function clampTo(v, lo, hi) { v = +v; return v > lo ? (v < hi ? v : hi) : lo; }

  /* ---- the target ramps, as control points on (position, density) ----
     density 1 = the darkest the panel is meant to get, 0 = bare paper. */
  var SHAPES = {
    /* light end → dark end, nothing clever */
    linear: [[0, 0], [1, 1]],
    /* two stops and a light band: up to a mid tone, HOLD it, down into the
       core dark, then the light coming back in at the very end */
    plateau: [[0, 0.02], [0.32, 0.55], [0.62, 0.55], [0.80, 1], [0.88, 0.18], [1, 0.14]],
  };

  function shapeAt(stops, u) {
    var i, t, lo, hi;
    if (u <= stops[0][0]) return stops[0][1];
    for (i = 1; i < stops.length; i++) {
      if (u <= stops[i][0]) {
        lo = stops[i - 1];
        hi = stops[i];
        t = hi[0] === lo[0] ? 0 : (u - lo[0]) / (hi[0] - lo[0]);
        return lo[1] + t * (hi[1] - lo[1]);
      }
    }
    return stops[stops.length - 1][1];
  }

  /* Band centres, so the curve is what a band average would measure. */
  function targetCurve(kind, n) {
    var stops = SHAPES[kind] || SHAPES.linear, out = [], i;
    for (i = 0; i < n; i++) out.push(shapeAt(stops, (i + 0.5) / n));
    return out;
  }

  /* Mean alpha per band, straight off the rendered panel. `data` is an
     RGBA byte array (canvas ImageData); only the alpha channel is read,
     which is why the paper and pencil colours can be whatever the theme
     wants without moving the score. */
  function bandDensities(data, w, h, bands, axis) {
    var sums = [], counts = [], out = [], i, x, y, b, v;
    for (i = 0; i < bands; i++) { sums.push(0); counts.push(0); }
    if (!data || w < 1 || h < 1) { for (i = 0; i < bands; i++) out.push(0); return out; }
    var stepX = Math.max(1, Math.floor(w / 480));
    var stepY = Math.max(1, Math.floor(h / 320));
    for (y = 0; y < h; y += stepY) {
      for (x = 0; x < w; x += stepX) {
        b = axis === 'y' ? Math.floor(y * bands / h) : Math.floor(x * bands / w);
        if (b < 0) b = 0; else if (b >= bands) b = bands - 1;
        v = data[(y * w + x) * 4 + 3];
        sums[b] += v > 0 ? v : 0;      /* a short buffer must not poison the mean */
        counts[b] += 1;
      }
    }
    for (i = 0; i < bands; i++) out.push(counts[i] ? sums[i] / counts[i] / 255 : 0);
    return out;
  }

  /* [1 2 1] blur with clamped edges — the drill scores a ramp, not the
     gap between two neighbouring pencil lines. Both curves get it. */
  function smooth(curve, passes) {
    var c = curve.slice(), out, p, i, n = c.length;
    if (n < 3) return c;
    for (p = 0; p < passes; p++) {
      out = c.slice();
      for (i = 0; i < n; i++) {
        out[i] = (c[i > 0 ? i - 1 : 0] + 2 * c[i] + c[i < n - 1 ? i + 1 : n - 1]) / 4;
      }
      c = out;
    }
    return c;
  }

  function peakOf(curve) {
    var m = 0, i;
    for (i = 0; i < curve.length; i++) if (curve[i] > m) m = curve[i];
    return m;
  }

  function troughOf(curve) {
    var m = Infinity, i;
    for (i = 0; i < curve.length; i++) if (curve[i] < m) m = curve[i];
    return curve.length ? m : 0;
  }

  /* Divide by the darkest band, so a light hand and a heavy hand score the
     same shape — the lesson is SPACING, not pressure. The floor is the only
     absolute: a panel with almost no ink on it cannot normalise its way to
     a perfect ramp. */
  function normalizeCurve(curve, floorPeak) {
    var div = Math.max(peakOf(curve), floorPeak), out = [], i;
    if (!(div > 0)) div = 1;
    for (i = 0; i < curve.length; i++) out.push(clamp01(curve[i] / div));
    return out;
  }

  function meanAbsError(a, b) {
    var n = Math.min(a.length, b.length), s = 0, i;
    if (!n) return 1;
    for (i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / n;
  }

  /* 100 when the two curves sit on top of each other, 0 at `zero` mean
     density error. `zero` arrives already eased for the input device. */
  function rampScore(mine, target, zero) {
    var e = Math.max(0, meanAbsError(mine, target) - ERROR_FREE);
    var z = zero > 1e-6 ? zero : 1e-6;
    return 100 * clamp01(1 - e / z);
  }

  /* Principal axis of one stroke (PCA), so a back-and-forth zigzag reports
     the axis it zigzags along instead of a meaningless net displacement.
     `elong` is 0 for a blob and 1 for a straight line; `spread` is its RMS
     length. Points are in panel pixels — normalised coords would skew every
     angle by the panel's aspect ratio. */
  function strokeAxis(pts) {
    var n = pts.length, i, mx = 0, my = 0, dx, dy, sxx = 0, sxy = 0, syy = 0;
    if (n < 2) return null;
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) {
      dx = pts[i].x - mx; dy = pts[i].y - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    sxx /= n; sxy /= n; syy /= n;
    var tr = sxx + syy;
    if (!(tr > 1e-9)) return null;
    var root = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
    var l1 = (tr + root) / 2, l2 = (tr - root) / 2;
    return {
      angle: 0.5 * Math.atan2(2 * sxy, sxx - syy),
      elong: clamp01((l1 - l2) / tr),
      spread: Math.sqrt(Math.max(0, l1)),
    };
  }

  /* How parallel the hatching is, as circular concentration of the doubled
     angles (hatching has no head or tail, so 10° and 190° are the same
     stroke). Returns null when there is nothing measurable — the caller
     then scores the ramp alone rather than inventing a penalty. */
  function directionScore(strokesPx, zeroSpread) {
    var C = 0, S = 0, wsum = 0, i, a, w;
    for (i = 0; i < strokesPx.length; i++) {
      a = strokeAxis(strokesPx[i]);
      if (!a) continue;
      w = a.elong * a.spread;
      if (!(w > 0)) continue;
      C += w * Math.cos(2 * a.angle);
      S += w * Math.sin(2 * a.angle);
      wsum += w;
    }
    if (!(wsum > 0)) return null;
    var R = Math.min(1, Math.hypot(C, S) / wsum);
    if (R <= 1e-6) return 0;
    /* axial circular standard deviation, halved back out of the doubling */
    var sigma = Math.sqrt(Math.max(0, -2 * Math.log(R))) / 2;
    var z = zeroSpread > 1e-6 ? zeroSpread : 1e-6;
    return 100 * clamp01(1 - Math.max(0, sigma - FREE_SPREAD) / z);
  }

  function panelScore(ramp, dir) {
    var s = dir === null ? ramp : ramp * (1 - DIR_WEIGHT) + dir * DIR_WEIGHT;
    return clampTo(isFinite(s) ? s : 0, 0, 100);
  }

  function roundScore(list) {
    var s = 0, i;
    if (!list.length) return 0;
    for (i = 0; i < list.length; i++) s += list[i];
    return clampTo(s / list.length, 0, 100);
  }

  function meanOfRange(c, lo, hi) {
    var n = c.length, a = Math.max(0, Math.floor(lo * n)), b = Math.min(n, Math.ceil(hi * n));
    var s = 0, k = 0, i;
    for (i = a; i < b; i++) { s += c[i]; k += 1; }
    return k ? s / k : 0;
  }

  /* The delta, named in words. The first branch is the classic beginner
     error this drill exists to show. */
  function curveVerdict(mine, target, kind) {
    var e = meanAbsError(mine, target);
    var earlyM = meanOfRange(mine, 0, 0.35), earlyT = meanOfRange(target, 0, 0.35);
    var lateM = meanOfRange(mine, 0.78, 1), lateT = meanOfRange(target, 0.78, 1);
    var rangeM = peakOf(mine) - troughOf(mine), rangeT = peakOf(target) - troughOf(target);
    var midM, midT;
    if (kind === 'plateau') {
      if (lateM - lateT > 0.18) {
        return 'you hatched straight through the light band — that last band is the light coming back in.';
      }
      midM = meanOfRange(mine, 0.34, 0.62);
      midT = meanOfRange(target, 0.34, 0.62);
      if (Math.abs(midM - midT) > 0.16) {
        return midM > midT
          ? 'the middle plateau went dark — hold ONE even tone right across it.'
          : 'the middle plateau stayed too pale — hold ONE even tone right across it.';
      }
    }
    if (earlyM - earlyT > 0.13) return 'too dark too fast — the light end should stay nearly bare paper.';
    if (lateT - lateM > 0.18) return 'the dark end never arrived — pack the strokes tighter there.';
    if (rangeM < rangeT * 0.55) return 'too flat — a ramp needs a real light end AND a real dark end.';
    if (e < 0.06) return 'that is a clean ramp — the spacing did the work.';
    return 'close — the middle drifts off the ramp; even the spacing out.';
  }

  /* The whole panel, pure: rendered alpha + the strokes that made it, in.
     Curves and a 0–100 out. `zeroError` / `zeroSpread` arrive eased. */
  function scorePanel(data, w, h, spec, strokesPx, zeroError, zeroSpread) {
    var raw = bandDensities(data, w, h, BANDS, spec.axis);
    var mine = normalizeCurve(smooth(raw, SMOOTH_PASSES), MIN_PEAK);
    var target = smooth(targetCurve(spec.kind, BANDS), SMOOTH_PASSES);
    target = normalizeCurve(target, 1e-6);
    var ramp = rampScore(mine, target, zeroError);
    var dir = directionScore(strokesPx, zeroSpread);
    return {
      curve: mine,
      target: target,
      ramp: ramp,
      dir: dir,
      score: panelScore(ramp, dir),
      verdict: curveVerdict(mine, target, spec.kind),
    };
  }

  /* ============================================================
     Canvas / DOM from here down.
     ============================================================ */

  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  var PANELS = [
    { kind: 'linear', axis: 'x', wide: true, title: 'light left → dark right' },
    { kind: 'linear', axis: 'y', wide: false, title: 'light top → dark bottom' },
    { kind: 'plateau', axis: 'x', wide: false, title: 'mid plateau, then a light band' },
  ];

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnDone = document.getElementById('btnDone');
  var btnUndo = document.getElementById('btnUndo');
  var btnClear = document.getElementById('btnClear');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ----
     accentInk is the AA-contrast variant used for everything meaning-bearing;
     paper/graphite are the panel's own materials (see css/style.css). */
  /* The ONLY thing that moves any of these is the data-theme attribute
     (see css/style.css), so reading them once per theme gives the same
     answer as reading them once per repaint — minus a forced style
     recalculation, and seven property lookups, on every sample of every
     hatch stroke. An empty read (stylesheet not parsed yet) is never
     cached, so a cold boot still corrects itself on the next frame. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sunny').trim();
    var c = {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      line: cs.getPropertyValue('--line').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accentInk: cs.getPropertyValue('--game-accent-ink').trim() || accent,
      paper: cs.getPropertyValue('--panel-paper').trim() || '#FCF8EF',
      graphite: cs.getPropertyValue('--panel-graphite').trim() || '#2A2118',
    };
    if (c.ink && c.card) { inkCache = c; inkTheme = t; }
    return c;
  }

  function rgbOf(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (h.length !== 6 || isNaN(n)) return [42, 33, 24];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, a) {
    var c = rgbOf(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* Ink laid down at coverage d over the paper is exactly this mix — canvas
     composites in sRGB — so the reference swatches and the reveal bands are
     literally "what your panel would look like at that density". */
  function tone(paper, graphite, d) {
    var p = rgbOf(paper), g = rgbOf(graphite), t = clamp01(d), i, out = [];
    for (i = 0; i < 3; i++) out.push(Math.round(p[i] + (g[i] - p[i]) * t));
    return 'rgb(' + out[0] + ',' + out[1] + ',' + out[2] + ')';
  }

  /* ---- geometry ---- */
  var W = 0, H = 0, geo = null;

  function layoutFor(spec) {
    var M = W < 420 ? 10 : 16;
    var labelH = 18, capH = 20, gap = 8;
    var graphH = W < 420 ? 54 : 62;
    var stripT = 22;
    var contentTop = labelH + 2;
    var contentH = Math.max(80, H - contentTop - gap - graphH - capH);
    var contentW = Math.max(80, W - 2 * M);
    var strip, panel, pw, ph, top, block, sx;

    if (spec.axis === 'y') {
      ph = Math.max(120, Math.min(contentH, 300));
      pw = Math.max(96, Math.min(Math.round(contentW * 0.5), 190));
      block = stripT + gap + pw;
      sx = Math.round((W - block) / 2);
      top = contentTop + Math.max(0, Math.round((contentH - ph) / 2));
      strip = { x: sx, y: top, w: stripT, h: ph };
      panel = { x: sx + stripT + gap, y: top, w: pw, h: ph };
    } else {
      pw = spec.wide ? Math.min(contentW, 470) : Math.min(Math.round(contentW * 0.78), 300);
      pw = Math.max(120, pw);
      ph = Math.max(80, Math.min(contentH - stripT - gap, spec.wide ? 170 : 180));
      block = stripT + gap + ph;
      top = contentTop + Math.max(0, Math.round((contentH - block) / 2));
      sx = Math.round((W - pw) / 2);
      strip = { x: sx, y: top, w: pw, h: stripT };
      panel = { x: sx, y: top + stripT + gap, w: pw, h: ph };
    }
    return {
      axis: spec.axis,
      strip: strip,
      panel: panel,
      graph: { x: M, y: H - capH - graphH, w: contentW, h: graphH },
      labelY: 13,
      capY: H - 6,
    };
  }

  /* Assigning canvas.width BLANKS the sheet, so it is only assigned when
     something really moved: a phone fires `resize` on every pixel of
     address-bar slide, at an unchanged width, and each one used to
     reallocate the backing store and re-lay the panel out for nothing. */
  var fitDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = clampTo(Math.round(w * 0.66), 340, 440);
    var dpr = window.devicePixelRatio || 1;
    if (w === W && h === H && dpr === fitDpr) return false;
    W = w; H = h; fitDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo = layoutFor(PANELS[panelIdx]);
    sizeInk();
    return true;
  }

  /* ---- the ink layer: one offscreen canvas the size of the panel ----
     Strokes are kept in normalised panel coordinates, so a resize (or a
     rotation) just re-renders them into the new box instead of stranding
     the drawing. Its alpha channel IS the score's input. */
  var inkCv = document.createElement('canvas');
  var inkCtx = inkCv.getContext('2d', { willReadFrequently: true });

  function sizeInk() {
    if (!geo) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(8, Math.round(geo.panel.w * dpr));
    var h = Math.max(8, Math.round(geo.panel.h * dpr));
    if (inkCv.width === w && inkCv.height === h) return;
    inkCv.width = w;
    inkCv.height = h;
    renderInk();
  }

  function pathStroke(g, pts, sx, sy, lw, color) {
    var i;
    if (!pts.length) return;
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0].u * sx, pts[0].v * sy);
    if (pts.length === 1) g.lineTo(pts[0].u * sx + 0.01, pts[0].v * sy + 0.01);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i].u * sx, pts[i].v * sy);
    g.stroke();
  }

  function renderInk() {
    var i, c = inks();
    var scale = geo ? inkCv.width / Math.max(1, geo.panel.w) : 1;
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, inkCv.width, inkCv.height);
    for (i = 0; i < strokes.length; i++) {
      /* one path per stroke, alpha applied once: a stroke never darkens
         itself at its own joins, but two strokes crossing really do stack */
      pathStroke(inkCtx, strokes[i], inkCv.width, inkCv.height,
        Math.max(1, HATCH_PX * scale), rgba(c.graphite, HATCH_ALPHA));
    }
  }

  /* ---- round state ---- */
  var round = 0, panelIdx = 0, panelScores = [], reported = false, lastRound = 0;
  var phase = 'play';           /* 'play' | 'reveal' | 'done' */
  var strokes = [], live = null, activePointer = null, activeType = '';
  var reveal = null, revealAt = 0, lastPenAt = -Infinity;

  /* First-ever visit: two panels, not three. Three panels × fifteen-plus
     strokes is several minutes of hatching before a single reported
     number, and the third panel is the plateau — the one shape that
     needs the first two to make sense. A beginner meets two plain
     light-to-dark ramps, gets a score, and the plateau is waiting on the
     next round. (Same shape as the sibling drills' first round.) */
  var FIRST_VISIT = ArtDaily.best() === null;
  var panelsThisRound = PANELS.length;

  function spec() { return PANELS[panelIdx]; }

  function setPrimary(text, glyph, disabled) {
    btnDone.textContent = glyph ? text + ' ' : text;
    if (glyph) {
      var s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.textContent = glyph;
      btnDone.appendChild(s);
    }
    btnDone.disabled = !!disabled;
  }

  function playHint() {
    var n = strokes.length;
    var head = 'panel ' + (panelIdx + 1) + ' of ' + panelsThisRound + ' — ';
    if (n === 0) {
      return head + 'hatch inside the paper: short parallel strokes, packed tighter ' +
        'where the strip beside it is darker.';
    }
    if (n < MIN_STROKES) {
      return head + (MIN_STROKES - n) + ' more stroke' +
        (MIN_STROKES - n === 1 ? '' : 's') + ' before "done" can score it.';
    }
    return head + n + ' strokes. keep going, or press "done".';
  }

  function newRound() {
    round += 1;
    panelIdx = 0;
    panelScores = [];
    reported = false;
    panelsThisRound = (FIRST_VISIT && round === 1) ? 2 : PANELS.length;
    disarmRoundBtn();
    startPanel();
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
  }

  function startPanel() {
    phase = 'play';
    strokes = [];
    live = null;
    activePointer = null;
    activeType = '';
    reveal = null;
    geo = layoutFor(spec());
    sizeInk();
    renderInk();
    setPrimary('done', '✓', false);
    hint.textContent = playHint();
    draw();
  }

  /* ---- painting ---- */
  function drawText(text, x, y, color, weight, size, align) {
    ctx.fillStyle = color;
    ctx.font = weight + ' ' + size + 'px ' + MONO;
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }

  /* The reference swatches are the same twelve numbers for the whole
     panel; rebuilding them on every repaint (so, every sample of every
     hatch stroke) bought nothing. */
  var stripCache = Object.create(null);
  function stripFor(kind) {
    if (!stripCache[kind]) stripCache[kind] = targetCurve(kind, SHOW_BANDS);
    return stripCache[kind];
  }

  function drawStrip(c) {
    var S = geo.strip, t = stripFor(spec().kind), i, d;
    var top = peakOf(t) || 1;
    ctx.save();
    for (i = 0; i < SHOW_BANDS; i++) {
      d = (t[i] / top) * REF_PEAK;
      ctx.fillStyle = tone(c.paper, c.graphite, d);
      if (geo.axis === 'y') {
        ctx.fillRect(S.x, S.y + S.h * i / SHOW_BANDS, S.w, S.h / SHOW_BANDS + 1);
      } else {
        ctx.fillRect(S.x + S.w * i / SHOW_BANDS, S.y, S.w / SHOW_BANDS + 1, S.h);
      }
    }
    ctx.restore();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);
    if (geo.axis === 'y') drawText('target', S.x, geo.labelY, c.muted, '700', 10, 'left');
    else drawText('target ramp', S.x, geo.labelY, c.muted, '700', 10, 'left');
  }

  /* the first screen has to teach the verb: a few ghost strokes in the dark
     end, at the angle that works, with the word on them */
  function drawGhostHint(c) {
    var P = geo.panel, i, x, y;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = rgba(c.graphite, 0.55);
    ctx.lineWidth = HATCH_PX;
    ctx.lineCap = 'round';
    for (i = 0; i < 6; i++) {
      ctx.beginPath();
      if (geo.axis === 'y') {
        y = P.y + P.h * (0.78 + i * 0.035);
        ctx.moveTo(P.x + P.w * 0.12, y);
        ctx.lineTo(P.x + P.w * 0.88, y);
      } else {
        x = P.x + P.w * (0.78 + i * 0.035);
        ctx.moveTo(x, P.y + P.h * 0.12);
        ctx.lineTo(x, P.y + P.h * 0.88);
      }
      ctx.stroke();
    }
    ctx.restore();
    drawText('hatch here', P.x + P.w / 2, P.y + P.h / 2 + 4, rgba(c.graphite, 0.72), '800', 13, 'center');
    drawText(geo.axis === 'y' ? 'light ↑' : '← light', P.x + 8, P.y + 16, rgba(c.graphite, 0.72), '700', 10, 'left');
    drawText(geo.axis === 'y' ? 'dark ↓' : 'dark →', P.x + P.w - 8, P.y + P.h - 8, rgba(c.graphite, 0.72), '700', 10, 'right');
  }

  function drawBands(c) {
    var P = geo.panel, n = SHOW_BANDS, i, lo, hi, d, k;
    ctx.save();
    ctx.globalAlpha = 0.88;
    for (i = 0; i < n; i++) {
      /* average the scored 24-band curve down into the 12 shown bands */
      lo = Math.floor(i * BANDS / n);
      hi = Math.floor((i + 1) * BANDS / n);
      d = 0; k = 0;
      for (k = lo; k < hi; k++) d += reveal.curve[k];
      d = (hi > lo ? d / (hi - lo) : 0) * REF_PEAK;
      ctx.fillStyle = tone(c.paper, c.graphite, d);
      if (geo.axis === 'y') ctx.fillRect(P.x, P.y + P.h * i / n, P.w, P.h / n + 1);
      else ctx.fillRect(P.x + P.w * i / n, P.y, P.w / n + 1, P.h);
    }
    ctx.restore();
  }

  function drawPanel(c) {
    var P = geo.panel;
    ctx.fillStyle = c.paper;
    ctx.fillRect(P.x, P.y, P.w, P.h);

    if (phase === 'play' && !strokes.length && !live) drawGhostHint(c);

    if (inkCv.width > 1) ctx.drawImage(inkCv, P.x, P.y, P.w, P.h);

    if (live && live.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(P.x, P.y, P.w, P.h);
      ctx.clip();
      ctx.translate(P.x, P.y);
      pathStroke(ctx, live, P.w, P.h, HATCH_PX, rgba(c.graphite, HATCH_ALPHA));
      ctx.restore();
    }

    if (reveal) drawBands(c);

    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(P.x + 0.75, P.y + 0.75, P.w - 1.5, P.h - 1.5);
  }

  function curvePath(curve, G, pad) {
    var i, x, y, n = curve.length;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      x = G.x + pad + (G.w - 2 * pad) * (i + 0.5) / n;
      y = G.y + G.h - pad - (G.h - 2 * pad) * clamp01(curve[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  /* The target ramp is a pure function of the panel's kind — it cannot
     change while the panel is on screen — yet it was being rebuilt,
     blurred twice and renormalised on every repaint, which during hatching
     means on every sample of every stroke. Built once per kind instead. */
  var targetCache = Object.create(null);
  function targetFor(kind) {
    if (!targetCache[kind]) {
      targetCache[kind] = normalizeCurve(smooth(targetCurve(kind, BANDS), SMOOTH_PASSES), 1e-6);
    }
    return targetCache[kind];
  }

  function drawGraph(c) {
    var G = geo.graph, pad = 8;
    var target = targetFor(spec().kind);

    ctx.fillStyle = c.card;
    ctx.fillRect(G.x, G.y, G.w, G.h);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(G.x + 0.5, G.y + 0.5, G.w - 1, G.h - 1);

    if (reveal) {
      /* the miss, shaded: target curve down, player's curve back */
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = c.accentInk;
      curvePath(target, G, pad);
      var i, x, y, n = reveal.curve.length;
      for (i = n - 1; i >= 0; i--) {
        x = G.x + pad + (G.w - 2 * pad) * (i + 0.5) / n;
        y = G.y + G.h - pad - (G.h - 2 * pad) * clamp01(reveal.curve[i]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.save();
    if (!reveal) ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.accentInk;
    ctx.lineWidth = 2;
    curvePath(target, G, pad);
    ctx.stroke();
    ctx.restore();

    if (reveal) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2;
      curvePath(reveal.curve, G, pad);
      ctx.stroke();
    }

    drawText('light end', G.x + pad, G.y + G.h - 3, c.muted, '700', 9, 'left');
    drawText('dark end', G.x + G.w - pad, G.y + G.h - 3, c.muted, '700', 9, 'right');
    drawText('target', G.x + G.w - pad, G.y + 11, c.accentInk, '800', 10, 'right');
    if (reveal) drawText('yours', G.x + G.w - pad - 48, G.y + 11, c.ink, '800', 10, 'right');
    else drawText('your ramp lands here', G.x + pad, G.y + 11, c.muted, '700', 10, 'left');
  }

  /* ---- repaint scheduling ----
     Hatching is the fastest, densest input in the whole set: a 120Hz pen
     delivers several positions per dispatched event and several events per
     displayed frame. Repainting synchronously inside each one redrew the
     reference strip, the whole ink layer, the live stroke and the graph —
     three or four complete sheets for one frame anybody saw. draw() now
     only ASKS for a frame; paint() runs once, right before the browser
     composites, which is also the freshest the stroke will ever be. */
  var rafId = 0;
  function draw() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; paint(); });
  }
  /* for paths that must not show a blank frame — a resize has already
     cleared the sheet, so it repaints on the spot */
  function paintNow() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    paint();
  }

  function paint() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!geo) return;
    ctx.textBaseline = 'alphabetic';

    drawText(spec().title, W - (W < 420 ? 10 : 16), geo.labelY, c.muted, '700', 10, 'right');
    drawStrip(c);
    drawPanel(c);
    drawGraph(c);

    var cap;
    if (phase === 'play') {
      cap = strokes.length + ' / ' + MIN_STROKES + ' strokes';
      drawText(cap, W / 2, geo.capY, c.muted, '700', 11, 'center');
    } else if (phase === 'done') {
      cap = 'round ' + round + ' · ' + lastRound + ' / 100';
      drawText(cap, W / 2, geo.capY, c.accentInk, '800', 12, 'center');
    } else if (reveal) {
      cap = 'panel ' + (panelIdx + 1) + ' · ' + Math.round(reveal.score) + ' / 100';
      if (reveal.dir !== null && reveal.dir < 45) cap += ' · strokes wandered in angle';
      drawText(cap, W / 2, geo.capY, c.accentInk, '800', 12, 'center');
    }
  }

  /* ---- input: every contact is one hatch stroke ---- */
  /* One rect per EVENT, not one per sample: a 120Hz pen hands over a dozen
     coalesced positions in a single dispatch, and measuring the canvas box
     a dozen times to convert them is a dozen forced layouts for an answer
     that cannot have changed in between. */
  function pointerPos(ev, rect) {
    var r = rect || canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function toPanel(p) {
    var P = geo.panel;
    return { u: (p.x - P.x) / P.w, v: (p.y - P.y) / P.h };
  }

  /* Sub-pixel repeats are not shape. A hatch stroke starts with the nib
     set down and the hand deciding, and a 120–1000Hz digitizer records
     that hesitation as hundreds of copies of one point. They are not free:
     the live stroke is re-stroked in full on every frame, so a stroke that
     is standing still still gets more expensive every frame; and
     strokeAxis — which weights each stroke's vote in the parallelism term
     by elong × spread — is an unweighted covariance over the raw list, so
     the pile drags that weight (60.7 → 53.0 on a normal 200px stroke that
     paused at one end). A FAST stroke loses nothing to this: its samples
     are more than a pixel apart by definition. Panel coordinates are
     normalised, so the test is done in panel pixels. */
  function addSample(pts, q) {
    var P = geo.panel, last = pts.length ? pts[pts.length - 1] : null;
    if (last && Math.abs(q.u - last.u) * P.w < 1 && Math.abs(q.v - last.v) * P.h < 1) return;
    pts.push(q);
  }

  function distToPanel(p) {
    var P = geo.panel;
    var dx = Math.max(P.x - p.x, 0, p.x - (P.x + P.w));
    var dy = Math.max(P.y - p.y, 0, p.y - (P.y + P.h));
    return Math.hypot(dx, dy);
  }

  function strokeLengthPx(pts) {
    var P = geo.panel, len = 0, i, dx, dy;
    for (i = 1; i < pts.length; i++) {
      dx = (pts[i].u - pts[i - 1].u) * P.w;
      dy = (pts[i].v - pts[i - 1].v) * P.h;
      len += Math.hypot(dx, dy);
    }
    return len;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (phase === 'reveal') {
      ev.preventDefault();
      if (Date.now() - revealAt > REVEAL_LOCK_MS) nextPanel();
      return;
    }
    if (phase !== 'play') return;
    /* Palm rejection. A `live` guard on its own only ever rejects the
       SECOND contact — hatching is exactly the posture where the heel of
       the hand lands FIRST, so the nib was the one being ignored and
       every hatch stroke was silently dropped. A touch inside the pen's
       shadow is the hand resting on the glass; a nib that lands while a
       touch owns the stroke takes it over and the palm drift is dropped
       (it was never committed to the ink layer, so nothing is scored). */
    if (ev.pointerType === 'touch' && Date.now() - lastPenAt < PEN_LOCK_MS) return;
    if (live) {
      if (ev.pointerType !== 'pen' || activeType === 'pen') return;
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
      live = null;
      activePointer = null;
      activeType = '';
    }
    ev.preventDefault();
    var p = pointerPos(ev);
    /* snap, never refuse: a press just outside the paper starts the stroke
       at the nearest point inside it (the pad grows for pen and finger) */
    if (distToPanel(p) > ArtDaily.startRadius(SNAP_PAD)) {
      hint.textContent = 'hatch inside the paper panel — everything outside it is just the reference.';
      return;
    }
    var P = geo.panel;
    live = [toPanel({
      x: clampTo(p.x, P.x + 0.5, P.x + P.w - 0.5),
      y: clampTo(p.y, P.y + 0.5, P.y + P.h - 0.5),
    })];
    activePointer = ev.pointerId;
    activeType = ev.pointerType || '';
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (!live || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    /* every position the digitizer recorded, not only the one the browser
       chose to dispatch (ArtDaily.samples is that pattern once, guarded —
       this drill used to hand-roll it) */
    var evs = ArtDaily.samples(ev);
    var rect = canvas.getBoundingClientRect(), i;
    for (i = 0; i < evs.length; i++) addSample(live, toPanel(pointerPos(evs[i], rect)));
    draw();
  });

  function endStroke(ev) {
    if (!live || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    /* THE TAIL OF A FAST STROKE. pointerup carries a position of its own,
       and it is the only record of where the nib really stopped — the last
       pointermove can be most of a frame behind it. A hatch stroke is
       short by design, so the lost tail is a large fraction of it, and
       strokeLengthPx against MIN_STROKE_PX is what decides whether the
       stroke counts as ink at all. */
    if (typeof ev.clientX === 'number') live.push(toPanel(pointerPos(ev)));
    var pts = live;
    live = null;
    activePointer = null;
    activeType = '';
    if (pts.length < 2 || strokeLengthPx(pts) < MIN_STROKE_PX) {
      /* a tap, not a stroke — costs nothing, leaves nothing */
      hint.textContent = strokes.length
        ? playHint()
        : 'that was a tap — press and pull a short stroke inside the paper.';
      draw();
      return;
    }
    strokes.push(pts);
    var c = inks();
    var scale = inkCv.width / Math.max(1, geo.panel.w);
    pathStroke(inkCtx, pts, inkCv.width, inkCv.height,
      Math.max(1, HATCH_PX * scale), rgba(c.graphite, HATCH_ALPHA));
    hint.textContent = playHint();
    draw();
  }
  function cancelStroke(ev) {
    if (!live || ev.pointerId !== activePointer) return;
    live = null;
    activePointer = null;
    activeType = '';
    draw();
  }

  canvas.addEventListener('pointerup', endStroke);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', endStroke);

  canvas.addEventListener('pointercancel', cancelStroke);
  /* A cancel can land anywhere — off the canvas after a failed capture, or
     nowhere at all when iOS drops the capture without ever sending
     pointerup. Either way `live` stayed set, and pointerdown refuses every
     later press while a stroke is in flight: the panel went dead for the
     rest of the round with no way back but "new round". The five sibling
     drills all catch this at the window; this one caught only the canvas. */
  window.addEventListener('pointercancel', cancelStroke);
  canvas.addEventListener('lostpointercapture', cancelStroke);

  /* ---- score / reveal / round ---- */
  function finishPanel() {
    var P = geo.panel, i, j, pts, out, img;
    if (inkCv.width < 1 || inkCv.height < 1) return;
    img = inkCtx.getImageData(0, 0, inkCv.width, inkCv.height);
    var strokesPx = [];
    for (i = 0; i < strokes.length; i++) {
      pts = strokes[i];
      out = [];
      for (j = 0; j < pts.length; j++) out.push({ x: pts[j].u * P.w, y: pts[j].v * P.h });
      strokesPx.push(out);
    }
    reveal = scorePanel(img.data, inkCv.width, inkCv.height, spec(), strokesPx,
      ArtDaily.ease(ZERO_ERROR), ArtDaily.ease(ZERO_SPREAD));
    panelScores.push(reveal.score);
    phase = 'reveal';
    revealAt = Date.now();
    setPrimary(panelIdx < panelsThisRound - 1 ? 'next panel' : 'see the round', '→', false);
    hint.textContent = 'panel ' + (panelIdx + 1) + ' scored ' + Math.round(reveal.score) +
      ' — ' + reveal.verdict + ' The bands are your ramp; the graph is it against the target.';
    draw();
  }

  function nextPanel() {
    if (phase !== 'reveal') return;
    if (panelIdx < panelsThisRound - 1) {
      panelIdx += 1;
      startPanel();
      return;
    }
    finishRound();
  }

  function finishRound() {
    phase = 'done';
    if (reported) return;      /* exactly one report per finished round */
    reported = true;
    var res = ArtDaily.report(roundScore(panelScores));
    lastRound = res.score;
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    setPrimary('done', '✓', true);
    hint.textContent = 'round done — ' + res.score + ' / 100 across ' +
      (panelsThisRound === 2 ? 'both' : 'all ' + panelsThisRound) +
      ' panels. press "new round" to hatch again' +
      (panelsThisRound < PANELS.length ? ' — the next round adds a third panel.' : '.');
    /* A first-ever round has no previous best, so isNewBest is
       trivially true and "new best!" celebrates nothing — on the one
       round where the number most needs saying what it IS. The SDK
       marks that round with isFirst; an older vendored SDK simply
       leaves it undefined and the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest && !res.isFirst);
    draw();
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
  btnDone.addEventListener('click', function () {
    if (phase === 'reveal') { nextPanel(); return; }
    if (phase !== 'play') return;
    if (strokes.length < MIN_STROKES) {
      hint.textContent = 'a ramp needs ink: ' + (MIN_STROKES - strokes.length) +
        ' more stroke' + (MIN_STROKES - strokes.length === 1 ? '' : 's') + ' and "done" will score it.';
      return;
    }
    finishPanel();
  });

  btnUndo.addEventListener('click', function () {
    if (phase !== 'play' || !strokes.length) {
      if (phase === 'reveal') hint.textContent = 'this panel is scored — press "next panel" to keep going.';
      else if (phase === 'done') hint.textContent = 'round is finished — press "new round" to hatch again.';
      return;
    }
    strokes.pop();
    renderInk();
    hint.textContent = playHint();
    draw();
  });

  btnClear.addEventListener('click', function () {
    if (phase !== 'play' || !strokes.length) return;
    strokes = [];
    live = null;
    activePointer = null;
    activeType = '';
    renderInk();
    hint.textContent = playHint();
    draw();
  });

  /* "new round" arms first when it would throw away live work — a second
     press within the window confirms, otherwise it snaps back. Forty
     hand-drawn strokes (and any panel already scored) used to vanish on a
     single mis-tap of a button sitting right next to "clear"; every
     sibling drill guards this one and this drill did not. */
  var btnRound = document.getElementById('btnRound');
  var ARM_MSG = 'that scraps this round’s hatching — press again to start over, or carry on.';
  var roundArmTimer = null, roundArmed = false, armPrevHint = '';
  function disarmRoundBtn() {
    roundArmed = false;
    clearTimeout(roundArmTimer);
    /* Take the prompt off the hint line with the button it belonged to —
       but ONLY if it is still the sentence on screen. The timer used to
       restore its saved hint unconditionally, so a "done" pressed inside
       the 2.6s window scored the panel, wrote the verdict, and then had
       that verdict wiped a second later by a play-screen instruction for a
       step already finished. Anything that has since written to the hint —
       a reveal, a tap outside the paper, another stroke — owns the line. */
    if (hint.textContent === ARM_MSG) {
      hint.textContent = (phase === 'play') ? playHint() : armPrevHint;
    }
    btnRound.textContent = 'new round ';
    var s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');   /* the glyph is decoration */
    s.textContent = '↻';
    btnRound.appendChild(s);
  }
  btnRound.addEventListener('click', function () {
    /* at risk: ink on the current panel, or any panel already scored in a
       round that has not been reported yet */
    var atRisk = phase !== 'done' && (strokes.length > 0 || panelIdx > 0 || phase === 'reveal');
    if (atRisk && !roundArmed) {
      roundArmed = true;
      btnRound.textContent = 'discard round?';
      armPrevHint = hint.textContent;
      hint.textContent = ARM_MSG;
      roundArmTimer = setTimeout(disarmRoundBtn, 2600);
      return;
    }
    newRound();   /* newRound disarms */
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; renderInk(); paintNow(); });

  /* the hardware changed mid-session (a tablet got plugged in, a pencil got
     picked up): the tolerances move with it, so say so and repaint */
  ArtDaily.onInput(function () {
    if (phase === 'play') hint.textContent = playHint();
    draw();
  });

  /* One rebuild per frame, not one per resize event: a dragged desktop
     window fires these faster than the ink layer can be re-rendered. */
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      if (!fitCanvas()) return;   /* nothing moved, and nothing was cleared */
      /* Strokes live in normalised panel coordinates, so the drawing simply
         comes along into the new box — nothing is voided, nothing is lost,
         and re-rendering the ink is fitCanvas's job, not this one's:
         sizeInk() re-renders whenever it reallocates the ink layer, and
         when it does NOT reallocate, the bitmap already there was drawn
         from the same normalised points into the same number of device
         pixels, so it is the identical image. Calling renderInk() again
         here re-rastered every hatch stroke a second time, on every frame
         of a window drag, for a picture that was already correct. */
      paintNow();   /* fitCanvas already blanked the sheet — no empty frame */
    });
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
