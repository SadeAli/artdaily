/* ============================================================
   game.js — Mix to Target. Four colours per round: nudge each
   base pigment's ratio slider until the live mix matches the
   target swatch, lock it in, learn the true ratios from the
   reveal. All colour math lives in pure functions up top; the
   target is generated THROUGH the same mixing model the player
   drives, so every target is exactly reachable.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'mix-to-target';
  var ITEMS_PER_ROUND = 4;
  var LETTERS = ['a', 'b', 'c'];

  /* ============================================================
     pure colour math — inputs in, numbers out, no DOM
     ============================================================ */

  function srgbToLin(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /* Anything that is not a positive finite number counts as "none of
     this pigment", so a malformed call degrades to an honest blend
     instead of poisoning every channel with NaN. */
  function normalizeWeights(ws) {
    var i, v, sum = 0, clean = [], out = [];
    for (i = 0; i < ws.length; i++) {
      v = Number(ws[i]);
      v = (isFinite(v) && v > 0) ? v : 0;
      clean.push(v);
      sum += v;
    }
    for (i = 0; i < ws.length; i++) out.push(sum > 0 ? clean[i] / sum : 1 / ws.length);
    return out;
  }

  /* Pigment-style subtractive approximation: weighted geometric mean
     per channel in linear RGB (the ln floor keeps near-black channels
     from nuking the whole mix). bases: [[r,g,b] 0-255]; returns same.
     Missing/garbage channels and weights read as 0 so the result is
     always a paintable byte triple. */
  function mixPigments(bases, weights) {
    var w = normalizeWeights(weights), out = [], ch, i, acc, c, wi;
    for (ch = 0; ch < 3; ch++) {
      acc = 0;
      for (i = 0; i < bases.length; i++) {
        c = Number(bases[i] && bases[i][ch]);
        if (!isFinite(c)) c = 0;
        wi = isFinite(w[i]) ? w[i] : 0;
        acc += wi * Math.log(Math.max(srgbToLin(c / 255), 0.001));
      }
      out.push(Math.round(255 * Math.min(1, Math.max(0, linToSrgb(Math.exp(acc))))));
    }
    return out;
  }

  function rgbToLab(rgb) {
    var r = srgbToLin(rgb[0] / 255), g = srgbToLin(rgb[1] / 255), b = srgbToLin(rgb[2] / 255);
    var x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    var z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE76(la, lb) {
    var dl = la[0] - lb[0], da = la[1] - lb[1], db = la[2] - lb[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  /* 100 at a perfect match, 0 at ΔE 26+ (roughly "clearly different").
     Non-finite ΔE (degenerate input) scores 0 — never NaN. */
  function itemScore(dE) {
    if (!isFinite(dE)) return 0;
    return 100 * Math.max(0, Math.min(1, 1 - dE / 26));
  }

  function roundScore(scores) {
    var i, sum = 0;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    return scores.length ? sum / scores.length : 0;
  }

  /* Luminance-preserving greyscale of an sRGB colour — powers the
     post-lock "squint" comparison. */
  function toGrey(rgb) {
    function ch(i) { var c = Number(rgb && rgb[i]); return isFinite(c) ? c / 255 : 0; }
    var y = 0.2126 * srgbToLin(ch(0)) + 0.7152 * srgbToLin(ch(1)) + 0.0722 * srgbToLin(ch(2));
    var g = Math.round(255 * Math.min(1, Math.max(0, linToSrgb(y))));
    return [g, g, g];
  }

  /* A plain name for a base pigment. "pigment a" is an abstraction a
     beginner has to hold in their head; "the dark blue one" is the thing
     they are already looking at. The letters stay in the aria labels. */
  function baseName(rgb) {
    var lab = rgbToLab(rgb);
    var h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
    if (!isFinite(h)) h = 0;
    if (h < 0) h += 360;
    var stops = [
      [18, 'red'], [45, 'orange'], [95, 'yellow'], [160, 'green'],
      [205, 'teal'], [265, 'blue'], [310, 'violet'], [345, 'magenta'], [360, 'red'],
    ];
    var name = 'red', i;
    for (i = 0; i < stops.length; i++) { if (h < stops[i][0]) { name = stops[i][1]; break; } }
    var tone = lab[0] >= 60 ? 'light ' : (lab[0] <= 40 ? 'dark ' : '');
    return tone + name;
  }

  /* Plain-language read of a missed mix from the Lab deltas: the two
     strongest directions, e.g. "too light, a touch too warm". Deltas
     under 2.5 are below reliable eyeballing and stay silent. */
  function missDiagnosis(labMix, labTarget) {
    var axes = [
      { d: labMix[0] - labTarget[0], pos: 'too light', neg: 'too dark' },
      { d: labMix[2] - labTarget[2], pos: 'too warm', neg: 'too cool' },
      { d: labMix[1] - labTarget[1], pos: 'too red', neg: 'too green' },
    ];
    axes.sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); });
    var parts = [], i, a, mag;
    for (i = 0; i < axes.length && parts.length < 2; i++) {
      a = axes[i];
      mag = Math.abs(a.d);
      if (!isFinite(mag) || mag < 2.5) continue;
      parts.push((mag < 6 ? 'a touch ' : '') + (a.d > 0 ? a.pos : a.neg));
    }
    return parts.join(', ');
  }

  /* ============================================================
     generation — random bases + hidden weights, target computed
     through mixPigments so it is always exactly reachable
     ============================================================ */

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  /* n weights that sum to 1, each >= 0.15 — no base is ever a red
     herring. Quantized to integer percents (largest-remainder) so the
     truth sits exactly on the 0-100 sliders: a perfect ΔE 0 — and a
     100 round — is always reachable. */
  function makeWeights(n) {
    var i, raw = [], sum = 0;
    for (i = 0; i < n; i++) { raw.push(-Math.log(Math.max(Math.random(), 1e-9))); sum += raw[i]; }
    var R = 100 - 15 * n, t = [], rem = [], used = 0;
    for (i = 0; i < n; i++) {
      var exact = R * raw[i] / sum, fl = Math.floor(exact);
      t.push(fl);
      rem.push(exact - fl);
      used += fl;
    }
    var left = R - used;
    while (left > 0) {
      var idx = 0;
      for (i = 1; i < n; i++) { if (rem[i] > rem[idx]) idx = i; }
      t[idx] += 1;
      rem[idx] = -1;
      left -= 1;
    }
    var out = [];
    for (i = 0; i < n; i++) out.push((15 + t[i]) / 100);
    return out;
  }

  /* Where the sliders open. Parking them all at 50 made "touch nothing,
     press lock" a strategy — the even blend sits near the middle of the
     reachable gamut, so doing nothing banked ~40/100 — and it sometimes
     opened on two halves that already matched, which teaches the player
     nothing about what the sliders are for. So each item opens on a
     random blend that is provably off: rejection-sampled until it is at
     least START_MIN_DE from the target (score <= 54), which both kills
     the free points and guarantees a visible gap to close. */
  var START_MIN_DE = 12;

  function makeStart(bases, target) {
    var labT = rgbToLab(target), best = null, bestDE = -1, k, i, j, s, dE;

    function consider(cand) {
      var d = deltaE76(rgbToLab(mixPigments(bases, cand)), labT);
      if (d > bestDE) { bestDE = d; best = cand; }
      return d;
    }

    /* random darts first — a varied opening beats a formulaic one */
    for (k = 0; k < 24; k++) {
      s = [];
      for (i = 0; i < bases.length; i++) s.push(20 + Math.floor(Math.random() * 81));
      if (consider(s) >= START_MIN_DE) return s;
    }

    /* Nothing random got far enough, which means this item's pigments
       sit close together and its reachable gamut is small. Fall back to
       the corners — one pigment dominant, the rest at the floor — which
       ARE the far edges of that gamut, so the opening is the most-off
       blend the item allows rather than the luckiest of 24 darts. */
    for (i = 0; i < bases.length; i++) {
      s = [];
      for (j = 0; j < bases.length; j++) s.push(j === i ? 100 : 20);
      if (consider(s) >= START_MIN_DE) return s;
    }
    return best;
  }

  function makeItem(idx) {
    var h = Math.random() * 360;
    function sat() { return 0.45 + Math.random() * 0.25; }
    function lit() { return 0.38 + Math.random() * 0.24; }
    var bases;
    if (idx === 0) {
      /* two contrasting bases — the warm-up */
      bases = [
        hslToRgb(h, sat(), lit()),
        hslToRgb(h + 150 + Math.random() * 60, sat(), lit()),
      ];
    } else if (idx === 1) {
      /* two bases, closer hues, split by value */
      bases = [
        hslToRgb(h, sat(), 0.32 + Math.random() * 0.1),
        hslToRgb(h + 90 + Math.random() * 60, sat(), 0.55 + Math.random() * 0.12),
      ];
    } else if (idx === 2) {
      /* three bases, hues spread around the wheel */
      bases = [
        hslToRgb(h, sat(), lit()),
        hslToRgb(h + 105 + Math.random() * 30, sat(), lit()),
        hslToRgb(h + 225 + Math.random() * 30, sat(), lit()),
      ];
    } else {
      /* three bases with a near-duplicate hue pair (a/b differ mostly
         by value) — forces reading the subtle one */
      bases = [
        hslToRgb(h, sat(), 0.34 + Math.random() * 0.06),
        hslToRgb(h + 12 + Math.random() * 14, sat(), 0.58 + Math.random() * 0.08),
        hslToRgb(h + 160 + Math.random() * 50, sat(), lit()),
      ];
    }
    var tw = makeWeights(bases.length);
    var target = mixPigments(bases, tw);
    return { bases: bases, trueW: tw, target: target, start: makeStart(bases, target) };
  }

  /* ============================================================
     DOM wiring
     ============================================================ */

  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var targetSwatch = document.getElementById('targetSwatch');
  var mixSwatch = document.getElementById('mixSwatch');
  var basesBox = document.getElementById('mixBases');
  var verdict = document.getElementById('mixVerdict');
  var btnLock = document.getElementById('btnLock');
  var btnSquint = document.getElementById('btnSquint');

  ArtDaily.init({ slug: SLUG });

  var round = 0, itemIdx = 0, itemScores = [], item = null, phase = 'idle';
  var sliders = [], reveals = [], valSpans = [], steppers = [];
  var squint = false;

  function cssRgb(rgb) { return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'; }

  function sliderValues() {
    return sliders.map(function (s) { return Number(s.value); });
  }

  function sliderSum() {
    var vals = sliderValues(), sum = 0, i;
    for (i = 0; i < vals.length; i++) sum += vals[i];
    return sum;
  }

  function renderMix() {
    if (!item) return;
    if (sliderSum() === 0) {
      /* empty palette — show "no pigment" stripes, not a fake blend */
      mixSwatch.style.background = '';
      mixSwatch.classList.add('mix-swatch-empty');
      return;
    }
    mixSwatch.classList.remove('mix-swatch-empty');
    var rgb = mixPigments(item.bases, sliderValues());
    mixSwatch.style.background = cssRgb(squint ? toGrey(rgb) : rgb);
  }

  /* Swatch colours are data, identical in both themes; everything else
     restyles via CSS custom properties. Re-applied on theme flips so
     the repaint hook stays honest. */
  function render() {
    if (!item) return;
    targetSwatch.style.background = cssRgb(squint ? toGrey(item.target) : item.target);
    renderMix();
  }

  /* Sliders are relative ratios — show every row's normalized share so
     the play numbers speak the same language as the reveal's "you %". */
  /* The raw slider number is meaningless on its own — only the BALANCE
     between the sliders mixes a colour, which is why every row prints its
     normalized share. A screen reader was read the raw number and nothing
     else ("62"), i.e. the one figure the drill spends a paragraph telling
     everyone else to ignore. aria-valuetext hands over the share too. */
  function updateShares() {
    var empty = sliderSum() === 0;
    var shares = normalizeWeights(sliderValues());
    var i, pct;
    for (i = 0; i < valSpans.length; i++) {
      pct = Math.round(shares[i] * 100);
      valSpans[i].textContent = empty ? '–' : pct + '%';
      if (sliders[i]) {
        sliders[i].setAttribute('aria-valuetext', empty
          ? sliders[i].value + ' — palette empty, no pigment in the mix'
          : sliders[i].value + ' — ' + pct + '% of the mix');
      }
    }
  }

  /* HOLD TO REPEAT on the ± steppers. A keyboard gets this free (hold an
     arrow key on a focused slider and the OS repeats it); a finger has no
     arrow keys, so these two buttons ARE its precision path — and each
     press moved the ratio by exactly 1 out of 100. Closing a 6-point
     misread cost six separate taps, on up to three sliders, four colours
     a round. Measured: a perfect colour read plus a ±6px landing slip
     scores 82/100 on a finger against 94 on a mouse, so the taps are what
     buys that back. Same 1-unit grain either way, so no score, record or
     tolerance changes — only how many times a thumb has to land. */
  var HOLD_DELAY_MS = 400; /* long enough that an ordinary tap never repeats */
  var HOLD_TICK_MS = 55;   /* ~18 a second, near the usual key-repeat rate */
  var holdTimer = null, holdStep = null, holdFired = false;

  function stopHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    holdStep = null;
  }
  function holdTick() {
    /* the step function refuses outside the mixing phase and at an end
       stop, so a repeat can never outlive the state it started in */
    if (!holdStep || !holdStep()) { stopHold(); return; }
    holdFired = true;
    holdTimer = setTimeout(holdTick, HOLD_TICK_MS);
  }
  function startHold(ev, step) {
    if (ev.button > 0) return;
    stopHold();
    holdStep = step;
    holdFired = false;
    holdTimer = setTimeout(holdTick, HOLD_DELAY_MS);
  }

  /* Every arrow in this family's markup is wrapped in an aria-hidden
     span, because it is decoration — but the primary button relabels
     itself from JS with textContent, which dropped the glyph straight
     into the accessible name: "next colour right arrow". Rebuild the
     label the way the markup does it. */
  function setBtnLabel(btn, text, glyph) {
    btn.innerHTML = '';
    btn.appendChild(document.createTextNode(glyph ? text + ' ' : text));
    if (glyph) {
      var g = document.createElement('span');
      g.setAttribute('aria-hidden', 'true');
      g.textContent = glyph;
      btn.appendChild(g);
    }
  }

  function buildRow(rgb, i) {
    var row = document.createElement('div');
    row.className = 'mix-row';

    var lab = document.createElement('label');
    lab.className = 'mix-key';
    lab.htmlFor = 'mixS' + i;
    var chip = document.createElement('span');
    chip.className = 'mix-chip';
    chip.style.background = cssRgb(rgb);
    var letter = document.createElement('span');
    letter.className = 'mix-letter';
    letter.textContent = baseName(rgb);
    lab.appendChild(chip);
    lab.appendChild(letter);

    var s = document.createElement('input');
    s.type = 'range';
    s.min = '0';
    s.max = '100';
    s.value = String(item.start[i]);
    s.id = 'mixS' + i;
    s.className = 'mix-slider';
    s.setAttribute('aria-label', 'pigment ' + LETTERS[i] + ', the ' + baseName(rgb) + ' one, ratio');

    var val = document.createElement('span');
    val.className = 'mix-val';

    s.addEventListener('input', function () {
      updateShares();
      renderMix();
    });

    /* ±1 steppers. A trackpad thumb-drag cannot reliably land an exact
       value and the arrow keys were advertised nowhere; these are 44×44
       so a finger on glass gets the same precision a mouse has, and they
       hold-to-repeat so it does not cost one tap per unit. */
    function stepper(delta, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mix-nudge';
      b.textContent = delta < 0 ? '−' : '+';
      b.setAttribute('aria-label', label + ' ' + baseName(rgb) + ' pigment by 1');
      function once() {
        if (phase !== 'mix') return false;
        var was = Number(s.value);
        var next = Math.max(0, Math.min(100, was + delta));
        if (next === was) return false; /* already parked on an end stop */
        s.value = String(next);
        updateShares();
        renderMix();
        return true;
      }
      b.addEventListener('click', function (ev) {
        /* the release that ends a hold still fires a click, and the hold
           already paid for those steps; a keyboard activation reports
           detail 0 and never came through a hold, so it always passes */
        if (holdFired && ev.detail !== 0) { holdFired = false; return; }
        holdFired = false;
        once();
      });
      b.addEventListener('pointerdown', function (ev) { startHold(ev, once); });
      b.addEventListener('pointerup', stopHold);
      b.addEventListener('pointercancel', stopHold);
      /* a finger that slides off the button mid-hold has stopped asking */
      b.addEventListener('pointerleave', stopHold);
      return b;
    }
    var down = stepper(-1, 'less');
    var up = stepper(1, 'more');

    var rv = document.createElement('div');
    rv.className = 'mix-reveal';
    rv.hidden = true;

    row.appendChild(lab);
    row.appendChild(down);
    row.appendChild(s);
    row.appendChild(up);
    row.appendChild(val);
    row.appendChild(rv);
    steppers.push(down);
    steppers.push(up);
    basesBox.appendChild(row);
    sliders.push(s);
    reveals.push(rv);
    valSpans.push(val);
  }

  function fillReveal(rv, youPct, truePct) {
    rv.innerHTML = '';
    var you = document.createElement('span');
    you.className = 'rv-num';
    you.textContent = 'you ' + youPct + '%';
    var bars = document.createElement('div');
    bars.className = 'rv-bars';
    var b1 = document.createElement('i');
    b1.className = 'rv-bar rv-you';
    b1.style.width = youPct + '%';
    var b2 = document.createElement('i');
    b2.className = 'rv-bar rv-true';
    b2.style.width = truePct + '%';
    bars.appendChild(b1);
    bars.appendChild(b2);
    var tr = document.createElement('span');
    tr.className = 'rv-num rv-truenum';
    tr.textContent = 'true ' + truePct + '%';
    rv.appendChild(you);
    rv.appendChild(bars);
    rv.appendChild(tr);
    rv.hidden = false;
  }

  function buildItem() {
    /* the rows are torn down and rebuilt here, so any repeat still
       running would be holding a stepper closed over a detached slider */
    stopHold();
    item = makeItem(itemIdx);
    basesBox.innerHTML = '';
    sliders = [];
    reveals = [];
    valSpans = [];
    steppers = [];
    phase = 'mix'; /* set before the rows exist: the steppers read it */
    item.bases.forEach(buildRow);
    verdict.hidden = true;
    btnLock.disabled = false;
    setBtnLabel(btnLock, 'lock it in');
    squint = false;
    /* The greyscale toggle is the drill's own studio tip ("get the value
       right first") and it used to be locked away until AFTER the score
       was banked. It belongs in the player's hand while they are mixing. */
    btnSquint.hidden = false;
    btnSquint.setAttribute('aria-pressed', 'false');
    btnSquint.textContent = 'squint ◐';
    hint.textContent = 'colour ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND + ' — mix ' +
      item.bases.length + ' pigments until the halves match.' +
      (itemIdx === 0
        ? ' only the BALANCE counts, not the totals: 80/40 mixes the same colour as 40/20. “squint ◐” drops the colour away so you can compare lightness alone.'
        : '');
    updateShares();
    render();
  }

  function lock() {
    if (phase !== 'mix' || !item) return;
    if (sliderSum() === 0) {
      hint.textContent = 'the palette is empty — raise at least one slider, then lock it in.';
      return;
    }
    var vals = sliderValues();
    var mixed = mixPigments(item.bases, vals);
    var labMix = rgbToLab(mixed);
    var labTarget = rgbToLab(item.target);
    var dE = deltaE76(labMix, labTarget);
    var s = itemScore(dE);
    itemScores.push(s);
    var youW = normalizeWeights(vals);
    var i;
    for (i = 0; i < reveals.length; i++) {
      fillReveal(reveals[i], Math.round(youW[i] * 100), Math.round(item.trueW[i] * 100));
      sliders[i].disabled = true;
    }
    for (i = 0; i < steppers.length; i++) steppers[i].disabled = true;
    /* Plain English first, the number second — the sentence a beginner can
       act on must not sit behind a symbol they have to go and look up. */
    var diag = dE < 3 ? 'spot on' : missDiagnosis(labMix, labTarget);
    /* Unhide BEFORE writing: the verdict is a live region, and a live
       region written to while it is still `hidden` announces nothing —
       un-hiding it afterwards is not a content change. The whole reveal
       (the diagnosis AND the score) was silent to a screen reader. */
    verdict.hidden = false;
    verdict.textContent = (diag ? diag + ' — ' : '') + Math.round(s) + ' pts' +
      ' (ΔE ' + dE.toFixed(1) +
      (itemIdx === 0 ? ' — how far apart the eye reads the two halves; under 3 is invisible)' : ')');
    hudScore.textContent = String(Math.round(roundScore(itemScores)));
    phase = 'revealed';
    if (itemIdx + 1 >= ITEMS_PER_ROUND) {
      finishRound();
    } else {
      setBtnLabel(btnLock, 'next colour', '→');
      hint.textContent = 'the true ratios are drawn under each slider — “squint ◐” compares lightness alone; next colour when ready.';
    }
  }

  function next() {
    if (phase !== 'revealed') return;
    itemIdx += 1;
    buildItem();
  }

  function finishRound() {
    phase = 'done';
    /* the primary button never moves or dies: it becomes the way into
       the next round instead of a disabled "locked ✓" dead end */
    setBtnLabel(btnLock, 'new round', '↻');
    var res = ArtDaily.report(roundScore(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'round done — same button starts the next one.';
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    itemScores = [];
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    buildItem();
  }

  var toastTimer = null;
  function showToast(msg, celebrate) {
    /* Unhide BEFORE filling. A live region that is mutated while it is
       still `hidden` is mutated inside a subtree the accessibility tree
       does not carry, and un-hiding it afterwards is not itself a content
       change — so the round score announced to nobody. Show it first,
       then write into it, and the announcement actually happens. */
    toast.hidden = false;
    toast.innerHTML = '';
    var s = document.createElement('span');
    s.className = celebrate ? 'toast-accent' : '';
    s.textContent = msg;
    toast.appendChild(s);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  /* ---- chrome wiring ---- */

  /* The primary button changes job in place (lock it in → next colour →
     new round), so the second click of an accidental double-click lands
     on a DIFFERENT action than the one aimed at — most damagingly, it
     skips straight past the reveal the first click just earned. Ignore a
     repeat that arrives inside the guard window. */
  var ACTION_GUARD_MS = 250;
  var actionAt = 0;

  btnLock.addEventListener('click', function () {
    var now = Date.now();
    if (now - actionAt < ACTION_GUARD_MS) return;
    actionAt = now;
    if (phase === 'mix') lock();
    else if (phase === 'revealed') next();
    else if (phase === 'done') newRound();
  });

  btnSquint.addEventListener('click', function () {
    squint = !squint;
    btnSquint.setAttribute('aria-pressed', String(squint));
    btnSquint.textContent = squint ? 'unsquint ○' : 'squint ◐';
    render();
  });

  /* mid-round "new round" throws away locked colours — require a second
     press so a misclick cannot torch progress silently */
  var btnRound = document.getElementById('btnRound');
  var roundBtnHtml = btnRound.innerHTML;
  var confirmTimer = null;
  /* The confirm used to live ONLY in the button's own relabel. A button
     that silently rewrites its own text under a player's finger is a
     coin-flip for a screen reader (a name change on the focused element
     is announced by some, by none of them reliably), so the one player
     who cannot see "start over?" is the one who presses again and loses
     the round. Say it in the hint, which is a live region. */
  var CONFIRM_HINT = 'that throws away the colours you have already locked in — press “new round” again to start over, or leave it and carry on.';
  var hintBeforeConfirm = null;
  function disarmConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    btnRound.innerHTML = roundBtnHtml;
    /* put the old hint back only if nothing else has written since */
    if (hintBeforeConfirm !== null && hint.textContent === CONFIRM_HINT) {
      hint.textContent = hintBeforeConfirm;
    }
    hintBeforeConfirm = null;
  }
  btnRound.addEventListener('click', function () {
    var midRound = phase !== 'done' && itemScores.length > 0;
    if (midRound && confirmTimer === null) {
      btnRound.textContent = 'start over?';
      hintBeforeConfirm = hint.textContent;
      hint.textContent = CONFIRM_HINT;
      confirmTimer = setTimeout(disarmConfirm, 2600);
      return;
    }
    disarmConfirm();
    newRound();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(render);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
