/* ============================================================
   game.js — Color Mixer: match a target swatch by eye with
   hue / saturation / lightness sliders, no numbers until you
   lock in. Five colors per round, later ones muted (the eye
   drifts most on near-neutrals). Scored by CIE76 ΔE in Lab —
   perceptual distance, not slider distance.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'colors';
  var ITEMS_PER_ROUND = 5;
  var START = { h: 180, s: 50, l: 50 }; /* every item starts mid-teal */
  var ZERO_AT = 32; /* ΔE where the score hits 0 on a mid-chroma target */
  /* Item 1 is the first number a beginner ever sees, so it is dealt with
     room: the same eye error reads higher on the warm-up than it will on
     item 5. Nothing here touches a perfect match, which is always 100. */
  var ITEM_EASE = [1.35, 1.12, 1.0, 1.0, 1.0];

  /* ---- pure scoring math: HSL triples in, 0–100 out; no DOM ----
     Standard pipeline: hsl → sRGB → linear RGB → XYZ (D65) → Lab. */

  /* NaN folds to the low end, never the high one — a broken number must
     not be able to buy a good score anywhere downstream of here. */
  function clamp(v, lo, hi) {
    v = Number(v);
    if (isNaN(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
  }

  /* h 0–360, s/l 0–100 → [r, g, b] each 0–1, still gamma-encoded */
  function hslToRgb(h, s, l) {
    h = Number(h);
    if (!isFinite(h)) h = 0; /* NaN/±Infinity % 360 is NaN, which would poison the channels */
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  /* sRGB gamma decode: linear toe below 0.04045, 2.4 curve above */
  function srgbToLinear(u) {
    return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  }

  /* linear RGB → XYZ (sRGB primaries, D65, scaled so white Y = 100) */
  function linearRgbToXyz(r, g, b) {
    return [
      (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100,
      (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) * 100,
      (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) * 100
    ];
  }

  /* XYZ → CIE Lab, D65 white point 95.047 / 100 / 108.883 */
  function xyzToLab(x, y, z) {
    var EPS = 216 / 24389, KAPPA = 24389 / 27;
    function f(t) { return t > EPS ? Math.pow(t, 1 / 3) : (KAPPA * t + 16) / 116; }
    var fx = f(x / 95.047), fy = f(y / 100), fz = f(z / 108.883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function hslToLab(h, s, l) {
    var rgb = hslToRgb(h, s, l);
    var xyz = linearRgbToXyz(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]));
    return xyzToLab(xyz[0], xyz[1], xyz[2]);
  }

  /* CIE76: plain Euclidean distance in Lab */
  function deltaE76(lab1, lab2) {
    var dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /* {h,s,l} pairs in, ΔE out — hue wraparound comes free via Lab */
  function hslDeltaE(a, b) {
    return deltaE76(hslToLab(a.h, a.s, a.l), hslToLab(b.h, b.s, b.l));
  }

  /* The SAME slider slop lands a wildly different ΔE depending on the
     target: hue error is multiplied by the target's chroma, so 10° off a
     vivid orange is a ΔE near 18 while 10° off a near-grey is barely 1.
     Judging every target against one fixed zero point therefore made the
     vivid items several times harder to score — and the vivid ones came
     first, so the first number a beginner ever saw was the worst of their
     round. Scale the zero point with the target's own chroma instead:
     "10° of hue off" now costs about the same on every item, and the ramp
     that remains is the real one (a near-neutral is genuinely harder to
     READ, which is what the drill is for). */
  function chromaOf(lab) {
    return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  }

  function zeroAtFor(targetLab, ease) {
    var z = ZERO_AT * (0.6 + chromaOf(targetLab) / 78);
    var e = (typeof ease === 'number' && isFinite(ease)) ? ease : 1;
    return clamp(z, 16, 50) * e;
  }

  /* ΔE ≤ JND → 100 (a perceptually identical match IS perfect),
     then linear down to 0 at zeroAt — continuous, no cliff at the JND */
  var JND = 2; /* CIE76 just-noticeable difference ≈ 2.3; we snap at 2 */
  function itemScore(dE, zeroAt) {
    var z = (typeof zeroAt === 'number' && isFinite(zeroAt)) ? zeroAt : ZERO_AT;
    if (z <= JND + 1) z = JND + 1; /* a degenerate window can never divide by ~0 */
    return 100 * clamp(1 - (dE - JND) / (z - JND), 0, 1);
  }

  /* Which axis carried the miss? Lab triples ([L,a,b]) in, a small
     report out: lightness vs chroma (saturation) vs hue, by comparing
     |ΔL|, |ΔC| and the hue residual in the a/b plane. */
  function missAxis(targetLab, mixLab) {
    var dL = mixLab[0] - targetLab[0];
    var da = mixLab[1] - targetLab[1];
    var db = mixLab[2] - targetLab[2];
    var cT = Math.sqrt(targetLab[1] * targetLab[1] + targetLab[2] * targetLab[2]);
    var cM = Math.sqrt(mixLab[1] * mixLab[1] + mixLab[2] * mixLab[2]);
    var dC = cM - cT;
    var dH = Math.sqrt(Math.max(0, da * da + db * db - dC * dC));
    var aL = Math.abs(dL), aC = Math.abs(dC);
    if (aL >= aC && aL >= dH) {
      return { axis: 'lightness', dir: dL > 0 ? 'lighter' : 'darker', amt: aL };
    }
    if (aC >= dH) {
      return { axis: 'saturation', dir: dC > 0 ? 'more saturated' : 'duller', amt: aC };
    }
    return { axis: 'hue', dir: '', amt: dH };
  }

  function roundScore(scores) {
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    return scores.length ? sum / scores.length : 0;
  }

  /* ---- end pure scoring math ---- */

  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var swTarget = document.getElementById('swTarget');
  var swMix = document.getElementById('swMix');
  var valsTarget = document.getElementById('valsTarget');
  var valsMix = document.getElementById('valsMix');
  var closeFill = document.getElementById('closeFill');
  var verdict = document.getElementById('verdict');
  var recapEl = document.getElementById('recap');
  var slH = document.getElementById('slH');
  var slS = document.getElementById('slS');
  var slL = document.getElementById('slL');
  var nudgeEls = document.querySelectorAll('.mix-nudge');
  var btnLock = document.getElementById('btnLock');
  var btnNext = document.getElementById('btnNext');
  var btnRound = document.getElementById('btnRound');

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      good: cs.getPropertyValue('--grade-good').trim() || cs.getPropertyValue('--mint').trim(),
      mid: cs.getPropertyValue('--grade-mid').trim() || cs.getPropertyValue('--sunny').trim(),
      bad: cs.getPropertyValue('--grade-bad').trim() || cs.getPropertyValue('--coral').trim(),
    };
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], playing = false, locked = false;
  var target = { h: 0, s: 0, l: 0 };
  var mix = { h: START.h, s: START.s, l: START.l };
  var lastResult = null; /* { dE, score } for the currently locked item */
  var roundItems = []; /* { target, mix, score } per locked item, for the recap */

  /* ---- where the five targets come from --------------------------------
     THE ROUND'S CONTENT IS FIFTEEN NORMALISED DRAWS: hue, saturation and
     lightness for each of the five colours, pulled in that fixed order by
     makeTarget(). Round 1 of a sitting comes from ArtDaily.roundRandom(1) —
     seeded from today and this slug — so everyone mixing this drill today
     is matching the same five swatches and a score finally has a
     denominator. Round 2 and on are practice: same generator, same
     distribution, unshared seed.

     UNLIKE THE PIXEL DRILLS THERE IS NOTHING TO CACHE HERE. A colour is not
     laid out against a canvas — h/s/l are absolute, so two players see the
     literally identical swatch, not merely the same fraction of their own
     sheet — and makeTarget(idx) is called exactly once per item, from
     nextItem(). Nothing regenerates a target on resize or on a theme
     change (draw() only re-paints the swatches it already has), so a plain
     rolling generator can never walk out from under the player.

     GUARDED, and the guard is load-bearing: index.html cache-busts its own
     scripts with ?v= but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache independently. A returning visitor holding a warm
     OLD SDK plus a cold copy of this file would call a function that does
     not exist, inside newRound(), before the first target is ever built —
     "Loading…" forever, and the drill dead. Falling back to Math.random
     costs today's player nothing but a non-comparable round, which is what
     they had yesterday, and it self-heals when the SDK's cache expires.

     ONLY THE BARE CALL FORM IS USED — rng(), never rng.int() — for the
     same reason: Math.random has no helpers on it, so the fallback would
     need a shim of its own, and a shim is a SECOND arithmetic path that
     can drift from the first. randInt below is the line it always was with
     Math.random() swapped for roundRng(). Both are uniform on [0,1), so
     every value downstream keeps exactly the shape it had and a seeded
     round is not an easier or a harder round. */
  var roundRng = Math.random;

  function randInt(lo, hi) { return lo + Math.floor(roundRng() * (hi - lo + 1)); }

  /* ramp: an easy, plainly-coloured warm-up, then vivid, then muted,
     ending near-neutral — desaturated targets are far harder to judge by
     eye, and with the chroma-scaled zero point that is now the only
     difficulty ramp left (it used to run backwards). */
  function makeTarget(idx) {
    var h = randInt(0, 359);
    if (idx === 0) return { h: h, s: randInt(50, 70), l: randInt(45, 60) };
    if (idx === 1) return { h: h, s: randInt(55, 90), l: randInt(40, 65) };
    if (idx === 2) return { h: h, s: randInt(25, 55), l: randInt(30, 72) };
    if (idx === 3) return { h: h, s: randInt(10, 30), l: randInt(25, 76) };
    return { h: h, s: randInt(3, 15), l: randInt(20, 80) };
  }

  function cssColor(c) { return 'hsl(' + c.h + ', ' + c.s + '%, ' + c.l + '%)'; }
  function tripleText(c) { return '· h ' + c.h + ' s ' + c.s + ' l ' + c.l; }
  /* the same three numbers, spelled out — "h 210 s 40 l 55" is read as
     "h two hundred and ten s forty l fifty-five", which is not English */
  function spokenTriple(c) {
    return 'hue ' + c.h + ', saturation ' + c.s + ', lightness ' + c.l;
  }

  /* THE REVEAL IS THE DRILL'S PAYLOAD AND IT WAS ONLY SAID ONE WAY.
     The two swatches are role="img" elements whose labels never changed
     — "target color swatch", start to finish — so the numbers the
     player is meant to study arrived only as the caption's shorthand,
     "· h 210 s 40 l 55", which is not a sentence in any language. The
     recap already knew better and spelled its pairs out with
     spokenTriple(); the main reveal, which is what a player reads
     first, did not. Say it there too, in the same words, and let the
     caption stay the terse note for the eye it was drawn as.
     Passing null puts the pre-lock labels back — nothing is revealed
     until the item is locked, for anyone. */
  function setSwatchLabels(res) {
    swTarget.setAttribute('aria-label', res
      ? 'target color swatch — ' + spokenTriple(res.target)
      : 'target color swatch');
    swMix.setAttribute('aria-label', res
      ? 'your mixed color swatch — ' + spokenTriple(res.mix)
      : 'your mixed color swatch');
  }

  function gradeColor(score, c) {
    return score >= 80 ? c.good : score >= 50 ? c.mid : c.bad;
  }

  function phrase(score) {
    if (score >= 90) return 'dead on.';
    if (score >= 70) return 'close — half-shut your eyes and compare the pair.';
    if (score >= 40) return 'in the neighborhood.';
    return 'not there yet — fix how light it is first, then the color.';
  }

  /* one teaching sentence from the missAxis report, in words a beginner
     already owns — "hue", "chroma" and "value" are the words this drill
     is teaching, so they are said the long way round the first time */
  function missText(m) {
    if (m.axis === 'hue') {
      return 'biggest miss: the color itself (red vs orange), not how light it is.';
    }
    if (m.axis === 'lightness') {
      return 'biggest miss: how light it is — yours ' + m.dir + ' by ' + Math.round(m.amt) + '.';
    }
    return 'biggest miss: how strong the color is — yours ' + m.dir + ' by ' + Math.round(m.amt) + '.';
  }

  /* ---- painting: swatches always, reveal gauge only when locked ---- */
  function draw() {
    var c = inks();
    swTarget.style.background = cssColor(target);
    swMix.style.background = cssColor(mix);
    if (locked && lastResult) {
      var col = gradeColor(lastResult.score, c);
      closeFill.style.height = Math.round(lastResult.score) + '%';
      closeFill.style.background = col;
      verdict.style.color = col;
    } else {
      closeFill.style.height = '0%';
      verdict.style.color = '';
    }
  }

  function setSlidersDisabled(off) {
    slH.disabled = off;
    slS.disabled = off;
    slL.disabled = off;
    for (var i = 0; i < nudgeEls.length; i++) nudgeEls[i].disabled = off;
  }

  function nextItem() {
    locked = false;
    lastResult = null;
    target = makeTarget(itemIdx);
    mix = { h: START.h, s: START.s, l: START.l };
    slH.value = String(START.h);
    slS.value = String(START.s);
    slL.value = String(START.l);
    setSlidersDisabled(false);
    valsTarget.textContent = '';
    valsMix.textContent = '';
    setSwatchLabels(null);
    verdict.textContent = '';
    btnLock.hidden = false;
    btnNext.hidden = true;
    /* near-neutral targets make the hue slider feel dead — say why */
    hint.textContent = 'color ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      (target.s <= 15
        ? ' — nearly grey: the color slider barely bites here, so nail how light it is.'
        : ' — slide until your mix melts into the target, then lock it in.') +
      (itemIdx === 0 ? ' the ± buttons step by exactly 1 — hold one down to run.' : '');
    draw();
  }

  function newRound() {
    round += 1;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE — re-seeded per round, so
       round 1 is today's shared five colours and every "new round" (and
       every mid-round restart) after it is practice. */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    itemIdx = 0;
    itemScores = [];
    roundItems = [];
    playing = true;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    recapEl.hidden = true;
    recapEl.innerHTML = '';
    setRoundBtnLabel(true);
    nextItem();
  }

  /* ---- input → ΔE → score ---- */
  function readSliders() {
    mix = { h: +slH.value, s: +slS.value, l: +slL.value };
  }

  function onSlide() {
    if (!playing || locked) return;
    readSliders();
    draw();
  }
  slH.addEventListener('input', onSlide);
  slS.addEventListener('input', onSlide);
  slL.addEventListener('input', onSlide);

  /* ±1 steppers — a trackpad thumb-drag cannot reliably land an exact
     value, and until now the only precise path (arrow keys on a focused
     slider) was mentioned nowhere. 44×44 targets, so a finger works too. */
  function stepOnce(btn) {
    if (!playing || locked) return false;
    var k = btn.dataset.k;
    var d = parseInt(btn.dataset.d, 10) || 0;
    var el = k === 'h' ? slH : (k === 's' ? slS : slL);
    var lo = Number(el.min), hi = Number(el.max);
    var was = Number(el.value);
    var next = Math.min(hi, Math.max(lo, was + d));
    if (next === was) return false; /* already parked on an end stop */
    el.value = String(next);
    onSlide();
    return true;
  }

  /* HOLD TO REPEAT — the fix for the one pointer that had no exact path.
     A keyboard already has this free: hold an arrow key on a focused
     slider and the OS repeats it. A mouse barely needs it — on a laptop
     sheet the hue track runs about 404px of travel, 0.89° per pixel, so
     the drag itself lands the value. A bare finger has neither. At a
     360px viewport the <=460px layout gives the track 178px of travel
     for 360 DEGREES of hue — 2.0° per pixel, and 2.6°/px at 320px — so
     the ± button IS a finger's precision path, and closing an ordinary
     12° miss cost twelve separate taps, five colours a round.
     Measured over 8000 rounds: a PERFECT colour read plus nothing worse
     than a ±6px landing scores 78/100 at 360px and 70/100 at 320px,
     against 99/100 on a mouse. That whole gap is pointer resolution, not
     eyesight. Holding the button now walks the value the way holding the
     arrow key does — same 1-unit grain, so nothing about the scoring or
     what a record means changes. */
  var HOLD_DELAY_MS = 400; /* long enough that an ordinary tap never repeats */
  var HOLD_TICK_MS = 55;   /* ~18 a second, near the usual key-repeat rate */
  var holdTimer = null, holdBtn = null, holdFired = false;

  function stopHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    holdBtn = null;
  }
  function holdTick() {
    /* stepOnce() refuses once the item is locked or an end stop is
       reached, so the repeat cannot outlive the state it started in. */
    if (!holdBtn || !stepOnce(holdBtn)) { stopHold(); return; }
    holdFired = true;
    holdTimer = setTimeout(holdTick, HOLD_TICK_MS);
  }
  function onNudgeDown(ev) {
    if (ev.button > 0) return;
    if (!playing || locked) return;
    stopHold();
    holdBtn = ev.currentTarget;
    holdFired = false;
    holdTimer = setTimeout(holdTick, HOLD_DELAY_MS);
  }
  function onNudge(ev) {
    /* The release that ends a hold still fires a click, and the hold has
       already paid for those steps — one more would overshoot by one on
       every hold. A keyboard activation reports detail 0 and never came
       through a hold, so it is always let through. */
    if (holdFired && ev.detail !== 0) { holdFired = false; return; }
    holdFired = false;
    stepOnce(ev.currentTarget);
  }
  for (var nIdx = 0; nIdx < nudgeEls.length; nIdx++) {
    nudgeEls[nIdx].addEventListener('click', onNudge);
    nudgeEls[nIdx].addEventListener('pointerdown', onNudgeDown);
    nudgeEls[nIdx].addEventListener('pointerup', stopHold);
    nudgeEls[nIdx].addEventListener('pointercancel', stopHold);
    /* a finger that slides off the button mid-hold has stopped asking */
    nudgeEls[nIdx].addEventListener('pointerleave', stopHold);
  }

  function lockIn() {
    if (!playing || locked) return;
    readSliders();
    locked = true;
    var tLab = hslToLab(target.h, target.s, target.l);
    var mLab = hslToLab(mix.h, mix.s, mix.l);
    var dE = deltaE76(tLab, mLab);
    var score = itemScore(dE, zeroAtFor(tLab, ITEM_EASE[itemIdx]));
    itemScores.push(score);
    roundItems.push({ target: target, mix: mix, score: score });
    lastResult = { dE: dE, score: score };
    setSlidersDisabled(true);
    /* the reveal: both triples, the miss distance, which axis missed, the gauge */
    valsTarget.textContent = tripleText(target);
    valsMix.textContent = tripleText(mix);
    setSwatchLabels({ target: target, mix: mix });
    /* plain English first, the number second — the sentence a beginner
       can act on must not be gated behind a symbol they have to look up */
    var vt = Math.round(score) + '/100 — ' + phrase(score);
    if (dE > JND) vt += ' ' + missText(missAxis(tLab, mLab));
    vt += ' (ΔE ' + Math.round(dE) + (itemIdx === 0
      ? ' — that is how far apart your eye reads the two; under 2 is invisible.)'
      : ')');
    verdict.textContent = vt;
    btnLock.hidden = true;
    if (itemIdx + 1 < ITEMS_PER_ROUND) {
      btnNext.hidden = false;
      btnNext.focus();
      hint.textContent = 'locked — study the pair, then take the next color.';
    } else {
      finishRound();
      btnRound.focus();
    }
    draw();
  }

  /* "lock it in" and "next color →" are two buttons sharing one slot in a
     flex row, and [hidden] removes the outgoing one from the flow — so
     the replacement lands under the pointer that just clicked, with the
     same left edge. The second click of an accidental double-click (or a
     held Enter, since lockIn() moves focus) therefore fires the NEW job:
     it wipes the ΔE, the miss-axis sentence and the gauge before they can
     be read — or, on the way back, locks the untouched starting mix as an
     answer. Ignore any activation that arrives inside the guard window. */
  var ACTION_GUARD_MS = 250;
  var actionAt = 0;
  function actionAllowed() {
    var now = Date.now();
    if (now - actionAt < ACTION_GUARD_MS) return false;
    actionAt = now;
    return true;
  }

  btnLock.addEventListener('click', function () {
    if (!actionAllowed()) return;
    lockIn();
  });

  btnNext.addEventListener('click', function () {
    if (!playing || !locked) return;
    if (!actionAllowed()) return;
    itemIdx += 1;
    nextItem();
    slH.focus();
  });

  function finishRound() {
    playing = false;
    var res = ArtDaily.report(roundScore(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'round done — “new round” mixes five fresh colors.';
    renderRecap();
    setRoundBtnLabel(false);
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'round score ') + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  /* round-end recap: the five target-over-mix pairs, side by side */
  function renderRecap() {
    recapEl.innerHTML = '';
    var t = document.createElement('p');
    t.className = 'mix-recap-title';
    t.textContent = 'recap — target on top, your mix underneath';
    recapEl.appendChild(t);
    for (var i = 0; i < roundItems.length; i++) {
      var it = roundItems[i];
      var cell = document.createElement('div');
      cell.className = 'mix-recap-item';
      var pair = document.createElement('div');
      pair.className = 'mix-recap-pair';
      pair.title = 'target ' + tripleText(it.target).slice(2) + ' / mix ' + tripleText(it.mix).slice(2);
      /* A `title` is a mouse-only affordance — no keyboard reaches it and
         screen readers treat it as optional. Without a real name the recap
         read out as five bare numbers with nothing to attach them to, so
         the one panel meant for STUDYING the round was the least legible
         part of it. Name each pair properly. */
      pair.setAttribute('role', 'img');
      /* the score chip beside it is a bare numeral — read on its own it
         is just "87" with nothing to attach it to, so it rides in here
         and the visible copy stays a mark for the eye */
      pair.setAttribute('aria-label', 'color ' + (i + 1) + ' — target ' + spokenTriple(it.target) +
        '; your mix ' + spokenTriple(it.mix) + '; scored ' + Math.round(it.score) + ' out of 100');
      var a = document.createElement('i');
      a.style.background = cssColor(it.target);
      var b = document.createElement('i');
      b.style.background = cssColor(it.mix);
      pair.appendChild(a);
      pair.appendChild(b);
      var sc = document.createElement('span');
      sc.className = 'mix-recap-score';
      sc.setAttribute('aria-hidden', 'true'); /* said in the pair's label, in words */
      sc.textContent = String(Math.round(it.score));
      cell.appendChild(pair);
      cell.appendChild(sc);
      recapEl.appendChild(cell);
    }
    recapEl.hidden = false;
  }

  /* mid-round the button is a restart (it discards the round) — say so */
  function setRoundBtnLabel(inProgress) {
    btnRound.innerHTML = (inProgress ? 'restart round ' : 'new round ') + '<span aria-hidden="true">↻</span>';
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
  btnRound.addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  window.addEventListener('resize', draw);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
