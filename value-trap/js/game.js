/* ============================================================
   game.js — Value Trap. Six items per round: one grey target
   chip plus six loudly-hued colour chips; exactly one colour
   shares the grey's value (CIE L*). Tap it. After every pick,
   all chips flip to their greyscale equivalents with L* labels
   (the "squint view") and stay that way until the player taps
   next — no timer, so the teaching moment lasts as long as it
   needs and the board never changes under a finger.
   DOM-based drill — no canvas — but the same skeleton:
   init → round → input → score → ArtDaily.report.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'value-trap';
  var ITEMS_PER_ROUND = 6;
  /* Six chips, not four. With four, one in four is right by construction:
     a blind tapper banked 25/100 before any judgement at all, so a lucky
     beginner and an unlucky competent player printed the same number and
     the score stopped meaning anything. Six drops the blind floor to
     ~17 and leaves room for the miss curve below to be generous. */
  var CHIP_COUNT = 6;
  /* Ignore input this soon after the board changes under the player, in
     BOTH directions: a tap queued across a swap is noise rather than a
     judgement, and the second tap of a double-tap must not blow straight
     through the reveal that the first tap just earned. */
  var SWAP_GUARD_MS = 250;

  /* ============================================================
     Pure colour + scoring math. Inputs in, numbers out — no DOM.
     Chain: sRGB 0–255 → linear → relative luminance Y → CIE L*.
     ============================================================ */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function srgbToLinear(c8) {
    var c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function lstarFromY(y) {
    return y > 0.008856 ? 116 * Math.pow(y, 1 / 3) - 16 : 903.3 * y;
  }

  function lstarFromRgb(r, g, b) { return lstarFromY(relLuminance(r, g, b)); }

  function yFromLstar(L) {
    return L > 8 ? Math.pow((L + 16) / 116, 3) : L / 903.3;
  }

  function linearToSrgb(y) {
    return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
  }

  /* The one grey 0–255 channel value whose L* is (nearest to) L. */
  function greyForLstar(L) {
    return Math.round(255 * clamp(linearToSrgb(yFromLstar(L)), 0, 1));
  }

  /* h degrees, s/l 0–1 → [r,g,b] floats 0–255 (unrounded so the
     binary search below stays monotonic). */
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  /* Binary-search HSL lightness until the colour's L* hits L
     (L* is monotonic in HSL l for fixed h,s). Returns ints. */
  function rgbForLstar(h, s, L) {
    var lo = 0, hi = 1, mid, rgb, i;
    for (i = 0; i < 24; i++) {
      mid = (lo + hi) / 2;
      rgb = hslToRgb(h, s, mid);
      if (lstarFromRgb(rgb[0], rgb[1], rgb[2]) < L) lo = mid; else hi = mid;
    }
    rgb = hslToRgb(h, s, (lo + hi) / 2);
    return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
  }

  /* Distractor margin ramps 12 L* (item 1) down to 5 L* (item 6). */
  function itemMargin(idx) { return 12 - 1.4 * idx; }

  /* A miss earns partial credit for landing close in value, and that
     credit is measured against THIS ITEM'S OWN GAP.
     With one fixed 22 L* reach the promise was empty exactly where a
     beginner needs it: on item 1 the closest wrong chip sits 12.6 L*
     away, which paid 3.5 points — so "partial credit for landing close"
     read as zero on every easy item and only became real on item 6.
     Scaling the reach with the item's margin makes the nearest wrong
     chip worth a visible ~14 on every item, hard or easy, while the
     furthest wrong chip still fades to almost nothing and the correct
     chip is still worth seven times any miss. */
  var MISS_MAX = 38;
  var MISS_REACH_K = 3.8; /* reach = K × the closest a wrong chip can sit */
  var MISS_REACH_MIN = 12;

  function missReach(idx) {
    var closest = itemMargin(idx) + 0.6; /* the +0.6 pad makeItem adds */
    if (!isFinite(closest) || closest <= 0) closest = 1;
    return Math.max(MISS_REACH_MIN, MISS_REACH_K * closest);
  }

  function itemScore(isCorrect, chosenL, targetL, idx) {
    if (isCorrect) return 100;
    var d = Math.abs(chosenL - targetL);
    if (!isFinite(d)) return 0; /* NaN/Infinity in → honest floor out */
    var reach = missReach(typeof idx === 'number' && isFinite(idx) ? idx : 0);
    var t = clamp(1 - d / reach, 0, 1);
    return MISS_MAX * t * t * t;
  }

  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    var mean = sum / scores.length;
    return isFinite(mean) ? clamp(mean, 0, 100) : 0;
  }

  /* ---- item generation (pure given Math.random) ---- */
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function makeItem(idx) {
    var wantL = rand(30, 75);
    var grey = greyForLstar(wantL);
    var targetL = lstarFromRgb(grey, grey, grey); /* score against the pixel actually shown */
    var baseHue = rand(0, 360);
    var margin = itemMargin(idx);
    var correct = Math.floor(rand(0, CHIP_COUNT));
    var chips = [];
    var k, hue, sat, L, d, rgb;
    for (k = 0; k < CHIP_COUNT; k++) {
      /* 60° spacing with ±9° jitter keeps every hue pair ≥ 42° apart
         (≥ 40° even after 8-bit rounding) */
      hue = baseHue + (360 / CHIP_COUNT) * k + rand(-9, 9);
      sat = rand(0.55, 0.9);
      if (k === correct) {
        L = targetL;
      } else {
        /* +0.6 pad so 8-bit rounding can never eat the margin */
        d = margin + 0.6 + rand(0, 9);
        L = targetL + (Math.random() < 0.5 ? -d : d);
        if (L < 12 || L > 93) L = targetL * 2 - L; /* flip to the roomy side */
      }
      rgb = rgbForLstar(hue, sat, L);
      chips.push({ rgb: rgb, L: lstarFromRgb(rgb[0], rgb[1], rgb[2]) });
    }
    return { grey: grey, targetL: targetL, correct: correct, chips: chips };
  }

  /* ============================================================
     DOM wiring
     ============================================================ */

  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var targetEl = document.getElementById('vtTarget');
  var targetLab = document.getElementById('vtTargetLab');
  var chipEls = [].slice.call(document.querySelectorAll('.vt-chip'));
  var boardEl = document.querySelector('.vt-board');
  var btnNext = document.getElementById('btnNext');
  var btnRound = document.getElementById('btnRound');

  ArtDaily.init({ slug: SLUG });

  var round = 0, itemIdx = 0, scores = [], item = null;
  var playing = false, revealing = false, swapAt = 0, revealAt = 0;
  var reported = true; /* per-round: report exactly once, drop none */

  function rgbCss(rgb) { return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'; }
  function greyCss(g) { return 'rgb(' + g + ',' + g + ',' + g + ')'; }

  /* Label ink/plate live in CSS (.vt-lab): a fixed dark pill keeps the
     L* text ≥ 4.5:1 on every chip grey, both themes. */
  function setLab(el, text) {
    el.textContent = text;
    el.hidden = false;
  }

  /* ---- painting. Chip colours are the drill's content (exact
     ground truth), so they are inline; all chrome colours live in
     CSS vars and follow the theme on their own. ---- */
  function draw() {
    if (!item) return;
    targetEl.style.background = greyCss(item.grey);
    var i, chip, el, lab;
    for (i = 0; i < chipEls.length; i++) {
      chip = item.chips[i];
      el = chipEls[i];
      lab = el.querySelector('.vt-lab');
      el.classList.remove('vt-correct', 'vt-chosen');
      if (revealing) {
        /* squint view: every chip becomes its own value */
        el.style.background = greyCss(greyForLstar(chip.L));
        /* item 1 says the word before it starts using the symbol */
        setLab(lab, (itemIdx === 0 ? 'value ' : 'L* ') + chip.L.toFixed(1));
        if (i === item.correct) el.classList.add('vt-correct');
        if (i === item.chosen && i !== item.correct) el.classList.add('vt-chosen');
        /* THE CHIPS STAY LIVE THROUGH THE SQUINT VIEW (they only die once
           the round is over). Disabling them made the six biggest targets
           on the sheet do nothing, while the 12px gutters BETWEEN them
           advanced — the board's click handler is what moves on, and a
           disabled button swallows its click instead of bubbling. So on a
           phone the natural "tap again to carry on" landed on a chip and
           looked like a dead page, and the gesture that did work was
           hitting the gap. Same contract neutral-hunt keeps: during a
           reveal the whole board is one big continue button. */
        el.disabled = !playing;
        /* aria-label wins over the chip's own text, so the reveal has to
           be spoken here too — otherwise the ring and the L* numbers are
           sighted-only and the whole teaching moment is silent. */
        el.setAttribute('aria-label', 'colour chip ' + (i + 1) + ', L* ' + chip.L.toFixed(1) +
          (i === item.correct ? ' — the match' :
            (i === item.chosen ? ' — your pick, off by ' +
              Math.abs(chip.L - item.targetL).toFixed(1) + ' L*' : '')) +
          (playing ? ' — activate to continue' : ''));
      } else {
        el.style.background = rgbCss(chip.rgb);
        lab.hidden = true;
        lab.textContent = '';
        el.disabled = !playing;
        el.setAttribute('aria-label', 'colour chip ' + (i + 1));
      }
    }
    if (revealing) {
      setLab(targetLab, (itemIdx === 0 ? 'value ' : 'L* ') + item.targetL.toFixed(1));
      /* children of role="img" are presentational — mirror the reveal
         into the label so screen readers hear it too */
      targetEl.setAttribute('aria-label', 'target grey chip, L* ' + item.targetL.toFixed(1));
    } else {
      targetLab.hidden = true;
      targetLab.textContent = '';
      targetEl.setAttribute('aria-label', 'target grey chip');
    }
  }

  function itemHint() {
    hint.textContent = 'Item ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — tap the colour that is exactly as light as the grey.' +
      (itemIdx === 0
        ? ' Same lightness = it vanishes when you half-shut your eyes, and that is what makes a painting read.'
        : '');
  }

  function newRound() {
    /* "new round" during the final squint: all six picks are in but the
       round hasn't been reported yet — a completed round must never be
       dropped, so flush it first (finishRound reports exactly once). */
    if (!reported && scores.length === ITEMS_PER_ROUND) finishRound();
    round += 1;
    itemIdx = 0;
    scores = [];
    revealing = false;
    playing = true;
    reported = false;
    swapAt = Date.now();
    btnNext.hidden = true;
    item = makeItem(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    itemHint();
    draw();
  }

  /* Every one of these transitions either disables the control the player
     is standing on (the chips, at the reveal) or hides it (the "next"
     button, on the way out), and both drop focus to <body> — a keyboard
     player then has to Tab in from the top of the page again, every
     single item. Note where focus was BEFORE the repaint kills it, and
     hand it to whatever control is live afterwards. */
  function focusInBoard() {
    return !!(document.activeElement && boardEl.contains(document.activeElement));
  }

  function pick(k) {
    if (!playing || revealing || !item) return;
    if (Date.now() - swapAt < SWAP_GUARD_MS) return;
    /* the chips survive the reveal now, but a label rewritten under a
       focused element announces unreliably — so focus is still handed to
       the one control whose NAME says what to do next */
    var keepFocus = focusInBoard();
    var chosen = item.chips[k];
    var correct = k === item.correct;
    var s = itemScore(correct, chosen.L, item.targetL, itemIdx);
    scores.push(s);
    item.chosen = k;
    revealing = true;
    revealAt = Date.now();
    hint.textContent = correct
      ? 'Spot on — that colour is exactly as light as the grey. “next” when ready.'
      : 'Off by ' + Math.abs(chosen.L - item.targetL).toFixed(1) +
        ' steps of lightness (out of 100) — every chip is now shown as its own grey, which is what' +
        ' half-shutting your eyes does. Study it, then “next”.';
    btnNext.hidden = false;
    draw();
    if (keepFocus) btnNext.focus();
  }

  /* explicit tap-to-continue: the squint view stays up until the player
     moves on — no forced wait on a hit, no rushed read on a miss */
  function advance() {
    if (!playing || !revealing) return;
    /* the trailing half of a double-tap must not eat the reveal */
    if (Date.now() - revealAt < SWAP_GUARD_MS) return;
    itemIdx += 1;
    if (itemIdx < ITEMS_PER_ROUND) {
      var keepFocus = document.activeElement === btnNext; /* about to be hidden */
      revealing = false;
      swapAt = Date.now();
      btnNext.hidden = true;
      item = makeItem(itemIdx);
      itemHint();
      draw();
      if (keepFocus && chipEls[0]) chipEls[0].focus();
      return;
    }
    finishRound();
  }

  function finishRound() {
    if (reported) return;
    reported = true;
    playing = false;
    var keepFocus = focusInBoard(); /* "next" is about to go, chips go dead */
    btnNext.hidden = true;
    /* revealing stays true here — the last (hardest) item's squint view
       survives round end instead of wiping to dead colour chips */
    draw();
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'Round done — the squint view stays up. “new round” when ready.';
    /* hand keyboard focus to the one live control instead of <body> */
    if (keepFocus) btnRound.focus();
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
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

  /* ---- input: tap/click a chip, or press 1–6 ---- */
  /* A chip tap during the squint view continues, exactly like a tap on
     any other part of the board. It is handled HERE rather than letting
     the click bubble, because the board handler deliberately ignores
     chip clicks (that is how it tells a pick from a continue) — and
     handling it in both places would advance twice. */
  chipEls.forEach(function (el, k) {
    el.addEventListener('click', function () {
      if (revealing) { advance(); return; }
      pick(k);
    });
  });

  /* while the squint view is up, a tap anywhere on the board — the
     “next” button included, whose click bubbles here — moves on */
  boardEl.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('.vt-chip')) return; /* that click was the pick itself */
    if (playing && revealing) advance();
  });

  /* ev.key is only a chip key if it is exactly one of "1".."6" — note
     that ''.indexOf-style matching would treat an empty key (dead keys,
     some IMEs) as chip 1 and score a pick nobody made. */
  var CHIP_KEYS = '123456'.slice(0, CHIP_COUNT);
  function chipKey(key) {
    return (typeof key === 'string' && key.length === 1) ? CHIP_KEYS.indexOf(key) : -1;
  }

  /* Enter/Space belong to whatever the player is standing ON, if that
     thing does anything with them. Testing only for BUTTON meant a
     keyboard player who had tabbed to "← artdaily", or to any footer
     link, and pressed Enter during a squint view had the navigation
     eaten by preventDefault() and advanced the drill instead — the link
     simply did not work. Anything focusable-and-activatable is theirs. */
  function ownsEnter(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    if (t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return true;
    if (t === 'A' && el.hasAttribute('href')) return true;
    if (el.isContentEditable) return true;
    return el.getAttribute && el.getAttribute('role') === 'button';
  }

  window.addEventListener('keydown', function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return; /* leave browser shortcuts alone */
    var k = chipKey(ev.key);
    if (playing && revealing) {
      /* Enter/Space on a focused button already fires that button's own
         click, which bubbles to the board — stepping in would advance
         twice. Digits fire no click, so they are always ours to handle. */
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (ownsEnter(ev.target)) return;
        ev.preventDefault();
        advance();
      } else if (k !== -1) {
        ev.preventDefault();
        advance();
      }
      return;
    }
    if (k !== -1) pick(k);
  });

  /* ---- chrome wiring ---- */
  btnRound.addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
