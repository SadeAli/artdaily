/* ============================================================
   game.js — Neutral Hunt. Nine near-grey chips at similar L*,
   eight carrying a subtle Lab temperature cast, one true
   neutral (C < 0.5) — tap the neutral. Chips are generated in
   CIELAB and converted to sRGB, so the drill holds exact
   ground truth for scoring. DOM drill, no canvas: chip fills
   are absolute sRGB and must NOT follow the theme, and every
   ink around them is a CSS variable, so the cascade handles a
   theme flip on its own — the onTheme hook below is a cheap
   safety net, not load-bearing.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'neutral-hunt';
  var ITEMS_PER_ROUND = 5;
  var CHIP_COUNT = 9;      /* 3x3 — eight casts + one neutral */
  var MIN_HUE_GAP = 25;    /* degrees between any two cast hues */

  /* THE REVEAL NEVER EXPIRES. It used to auto-advance after 1.2s on a
     hit, and the fresh grid was live again 250ms later — so a player who
     clicked once more to acknowledge what they had just been shown
     registered a real, SCORED pick on a grid they had never looked at.
     That is a lost point caused purely by timing, and it contradicted
     the sibling drill's own promise that the board never changes under
     a finger. Now nothing advances until the player says so: "next
     grid", a tap anywhere on the grid, or Enter/Space on a chip.
     The two guards remain, so a double-tap can neither skip the reveal
     it just earned nor land as a pick on the next grid. */
  var REVEAL_GUARD_MS = 350;
  var PICK_GUARD_MS = 250;

  /* ---- pure scoring + colour math (no DOM, unit-testable) ---- */

  /* NaN-safe on purpose: a non-finite input clamps to 0 rather than
     leaking a NaN into a score or a colour channel. */
  function clamp01(v) { return v > 0 ? (v < 1 ? v : 1) : 0; }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Correct pick = 100. A wrong pick is judged by how neutral it still
     was *relative to the casts on this grid*: the grid's strongest cast
     scores 0, the subtlest one scores most, then a haircut to 55% keeps
     every miss below every hit.
     Grading per grid is the whole point — casts shrink from C 10–16 on
     grid 1 to C 3.5–6 on grid 5, so a fixed yardstick would pay MORE
     for missing the hard grids than the easy ones. */
  function scoreChoice(isNeutral, chosenChroma, gridMaxChroma) {
    if (isNeutral) return 100;
    if (!(gridMaxChroma > 0)) return 0;
    return 100 * clamp01(1 - chosenChroma / gridMaxChroma) * 0.55;
  }

  /* strongest cast on the grid — the yardstick scoreChoice grades against */
  function maxChromaOf(list) {
    var m = 0;
    for (var i = 0; i < list.length; i++) if (list[i].chroma > m) m = list[i].chroma;
    return m;
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var sum = 0;
    for (var i = 0; i < scores.length; i++) sum += scores[i];
    return sum / scores.length;
  }

  /* Casts shrink across the round: C 10–16 on grid 1 down to C 5–7 on
     grid 5. The old floor of 3.5 sat at or below what an uncalibrated
     laptop panel can show — the round ended on a grid a beginner could
     not win for reasons that had nothing to do with their eye. */
  function chromaRange(itemIdx) {
    var t = itemIdx / (ITEMS_PER_ROUND - 1);
    return { lo: lerp(10, 5, t), hi: lerp(16, 7, t) };
  }

  /* Hue → cast label. Warm covers red→orange→yellow, cool covers
     green→teal→blue; violet and magenta are NAMED instead of
     called warm/cool — their temperature depends on context, the
     same stance temperature-sort's how-to takes. Lab hue degrees. */
  function castLabel(hueDeg, chroma) {
    if (chroma < 0.5) return 'neutral';
    var h = ((hueDeg % 360) + 360) % 360;
    var amt = ' +' + Math.round(chroma);
    if (h >= 285 && h < 325) return 'violet' + amt;
    if (h >= 325 && h < 350) return 'magenta' + amt;
    return ((h < 135 || h >= 350) ? 'warm' : 'cool') + amt;
  }

  /* CIELAB (D65) → sRGB [0–255], gamut-clamped. Near-greys at
     L* 50–65 with C ≤ 16 sit comfortably inside the gamut. */
  function lab2rgb(L, a, b) {
    var fy = (L + 16) / 116;
    var fx = fy + a / 500;
    var fz = fy - b / 200;
    var e = 216 / 24389, k = 24389 / 27;
    function finv(t) { var t3 = t * t * t; return t3 > e ? t3 : (116 * t - 16) / k; }
    var X = finv(fx) * 0.95047;
    var Y = (L > k * e) ? fy * fy * fy : L / k;
    var Z = finv(fz) * 1.08883;
    function gam(c) {
      c = clamp01(c);
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }
    /* A neutral (a = b = 0) is the D65 white point scaled by Y, so its
       linear RGB is exactly (Y, Y, Y). Use that identity directly: the
       4-decimal matrix below rounds one channel off by 1/255 at some
       lightnesses, which would leak a faint cast into the one chip the
       whole drill promises is castless. */
    if (a === 0 && b === 0) {
      var g = Math.round(gam(Y) * 255);
      return [g, g, g];
    }
    var rl = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    var gl = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    var bl = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    return [Math.round(gam(rl) * 255), Math.round(gam(gl) * 255), Math.round(gam(bl) * 255)];
  }

  /* ---- generation -----------------------------------------------------
     WHERE THE FIVE GRIDS COME FROM. An item is a sequence of normalised
     draws: the shared base L*, the eight cast hues, each cast's chroma,
     the per-chip L* jitter, and the shuffle that decides which of the
     nine cells holds the neutral. Round 1 of a sitting is dealt from
     ArtDaily.roundRandom(1) — seeded from today and this slug — so
     everyone hunting today gets the same five grids, with the neutral in
     the same cell, and a score finally has a denominator. Round 2 and on
     are practice: same generator, same distribution, unshared seed.

     NO CANVAS HERE. The chips are DOM buttons filled with absolute sRGB
     converted out of exact Lab, so two players do not merely get the same
     fractions of their own sheet — they get the identical nine greys.

     NOTHING TO CACHE: makeItem(itemIdx) is called exactly once per grid,
     from startItem(), and there is no resize handler at all (see the note
     at the foot of this file). A plain rolling generator cannot walk out
     from under the player.

     EVERY DRAW IS CONTENT, AND THE ±1 L* JITTER IS THE ONE WORTH ARGUING
     ABOUT. Its comment calls it a look — "keeps the sheet from looking
     machine-flat" — which sounds cosmetic, but it is not painted on top
     of a chip, it IS part of that chip's colour, and its job is to stop
     the neutral being findable by lightness instead of by cast. That is
     the drill's own defence against a shortcut, so it is dealt from the
     round's generator with everything else. Nothing here is decoration
     and nothing is drawn per frame.

     GUARDED, and the guard is load-bearing. index.html cache-busts its own
     scripts with ?v= but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache independently: a returning visitor holding a warm
     OLD SDK plus a cold copy of this file would call a function that does
     not exist, inside newRound(), before the first grid is ever built —
     "Loading…" forever. Falling back to Math.random costs today's player
     nothing but a non-comparable round, which is what they had yesterday.

     ONLY THE BARE CALL FORM IS USED — rng(), never rng.range()/.shuffle()
     — because Math.random carries no helpers, so the fallback path would
     need a shim, and a shim is a second copy of the arithmetic that can
     drift from the first. Every line below is the line it always was with
     Math.random() swapped for rng(), the shuffle included: it still walks
     DOWN, one draw per step, so the draw count and order are untouched.
     Uniform on [0,1) either way, so a seeded grid is not an easier or a
     harder grid. */
  var rng = Math.random;

  function rand(lo, hi) { return lo + rng() * (hi - lo); }

  /* n hues on the circle with every pair — including the wrap —
     at least minGap degrees apart: hand out the mandatory gaps,
     then split the leftover arc randomly. */
  function pickHues(n, minGap) {
    var slack = 360 - n * minGap;
    var weights = [], sum = 0, i;
    for (i = 0; i < n; i++) { weights.push(rng()); sum += weights[i]; }
    if (!sum) sum = 1;
    var hues = [], acc = rng() * 360;
    for (i = 0; i < n; i++) {
      hues.push(acc % 360);
      acc += minGap + slack * (weights[i] / sum);
    }
    return hues;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeItem(itemIdx) {
    /* one shared value so the neutral can't be found by lightness;
       ±1 L* jitter keeps the sheet from looking machine-flat */
    var baseL = rand(51, 64);
    var range = chromaRange(itemIdx);
    var hues = pickHues(CHIP_COUNT - 1, MIN_HUE_GAP);
    var chips = [], i;
    for (i = 0; i < CHIP_COUNT - 1; i++) {
      var C = rand(range.lo, range.hi);
      var hRad = hues[i] * Math.PI / 180;
      chips.push({
        L: baseL + rand(-1, 1),
        a: C * Math.cos(hRad),
        b: C * Math.sin(hRad),
        chroma: C,
        hue: hues[i],
        neutral: false,
      });
    }
    chips.push({ L: baseL + rand(-1, 1), a: 0, b: 0, chroma: 0, hue: 0, neutral: true });
    return shuffle(chips);
  }

  /* ---- chrome ---- */

  var grid = document.getElementById('chipGrid');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnRound = document.getElementById('btnRound');

  ArtDaily.init({ slug: SLUG });

  /* ---- round state ---- */
  var btnNext = document.getElementById('btnNext');

  var round = 0, itemIdx = 0, scores = [], chips = [];
  var playing = false, revealed = false, pickedIdx = -1;
  var revealAt = 0, itemStartAt = 0;

  /* The nine buttons are built ONCE and repainted in place, so a
     keyboard player's focus survives every reveal and advance
     (same persistent-button pattern as temperature-sort). */
  var chipEls = [];
  function buildChips() {
    grid.innerHTML = '';
    chipEls = [];
    for (var i = 0; i < CHIP_COUNT; i++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.idx = String(i);
      grid.appendChild(btn);
      chipEls.push(btn);
    }
  }

  /* render() repaints the persistent buttons from state, so it is
     safe to call at any moment — including from the theme hook
     mid-reveal. During a reveal the chips stay ENABLED: any tap
     advances, and focus is never dropped to <body>. */
  function render() {
    if (!chips.length) return;
    for (var i = 0; i < chipEls.length; i++) {
      var chip = chips[i];
      var btn = chipEls[i];
      var rgb = lab2rgb(chip.L, chip.a, chip.b);
      btn.style.background = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      btn.classList.toggle('is-neutral', revealed && chip.neutral);
      btn.classList.toggle('is-picked', revealed && i === pickedIdx);
      btn.disabled = revealed && !playing; /* dead only once the round is over */
      btn.innerHTML = '';
      if (revealed) {
        var label = castLabel(chip.hue, chip.chroma);
        var pill = document.createElement('span');
        pill.className = 'chip-label';
        pill.textContent = label;
        btn.appendChild(pill);
        btn.setAttribute('aria-label', 'chip ' + (i + 1) + ': ' + label +
          (i === pickedIdx ? ' — your pick' : '') +
          (playing ? ' — activate to continue' : ''));
      } else {
        btn.setAttribute('aria-label', 'grey chip ' + (i + 1) + ' of ' + chips.length);
      }
    }
  }

  /* The markup ships this button as `next grid <span aria-hidden>→</span>`
     — the glyph is decoration — and relabelling it with textContent put
     the arrow back into the accessible name ("next grid right arrow").
     Rebuild the label the way the markup does it. */
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

  function startItem() {
    chips = makeItem(itemIdx);
    revealed = false;
    pickedIdx = -1;
    itemStartAt = Date.now();
    btnNext.hidden = true;
    render();
    /* grid 1 teaches the term; later grids stay terse */
    hint.textContent = itemIdx === 0
      ? 'grid 1 of ' + ITEMS_PER_ROUND + ' — eight of these greys lean slightly warm or cool.' +
        ' one leans nowhere at all. tap that one.'
      : 'grid ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND + ' — tap the grey that leans nowhere.';
  }

  function newRound() {
    /* If all five picks are in but the player had not moved on from the
       final reveal yet, the round is complete — report it before
       resetting, so "new round" mid-reveal never swallows a finished
       round. finishRound() flips playing to false, so this cannot
       double-report. */
    if (playing && scores.length >= ITEMS_PER_ROUND) finishRound();
    round += 1;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. Re-seeded per round, so
       round 1 is today's shared five grids and every round after it is
       practice. It sits above startItem(), which deals grid 1 — the first
       grid of a round must come out of the NEW generator, never the last
       round's. See the block above rand() for the guard. */
    rng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    itemIdx = 0;
    scores = [];
    playing = true;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startItem();
  }

  /* ---- input → reveal → score ---- */

  function pick(idx) {
    var chip = chips[idx];
    if (!chip) return;
    pickedIdx = idx;
    revealed = true;
    revealAt = Date.now();
    var sc = Math.round(scoreChoice(chip.neutral, chip.chroma, maxChromaOf(chips)));
    scores.push(sc);
    render();
    /* "+12" is the strength of the cast; say so once, on grid 1, so the
       player learns the scale and not just the word */
    var scaleNote = itemIdx === 0
      ? ' (the number is how strong that lean is — a true neutral is 0)'
      : '';
    hint.textContent = chip.neutral
      ? 'yes — that one leans nowhere. 100/100.' + scaleNote +
        ' take as long as you like, then “next grid”.'
      : 'that grey leans ' + castLabel(chip.hue, chip.chroma) + ' — ' + sc +
        '/100.' + scaleNote + ' the ringed chip is the neutral. “next grid” when you have looked.';
    btnNext.hidden = false;
    if (itemIdx + 1 >= ITEMS_PER_ROUND) setBtnLabel(btnNext, 'finish round');
    else setBtnLabel(btnNext, 'next grid', '→');
  }

  function nextItem() {
    itemIdx += 1;
    if (itemIdx >= ITEMS_PER_ROUND) { finishRound(); return; }
    startItem();
  }

  /* THE FOCUS HAND-OFF. The nine chips persist across a reveal, so a
     keyboard player standing on a CHIP keeps their place for free — but
     "next grid" does not: startItem() hides it the instant it is used,
     and hiding the focused element drops focus to <body>. So the one
     control whose whole job is "carry on" threw the player back to the
     top of the page, on every single grid, five times a round. Same at
     round end, where the old guard only looked inside the grid and so
     missed a player standing on that button.
     Note where focus stood BEFORE the repaint, and only step in if the
     repaint actually dropped it — a player on chip 7 must stay on chip 7
     rather than be yanked to chip 1. */
  function focusWasLive() {
    var a = document.activeElement;
    return !!a && (a === btnNext || grid.contains(a));
  }
  function focusLost() {
    var a = document.activeElement;
    return !a || a === document.body || a === document.documentElement;
  }

  /* explicit tap-to-continue, the same contract value-trap keeps: the
     board only ever changes because the player asked it to */
  function advance() {
    if (!playing || !revealed) return;
    if (Date.now() - revealAt < REVEAL_GUARD_MS) return;
    var hadFocus = focusWasLive();
    nextItem();
    /* nextItem() either dealt a fresh grid — chips live, "next grid"
       gone — or finished the round, in which case finishRound() has
       already placed focus itself. */
    if (hadFocus && playing && focusLost() && chipEls[0]) chipEls[0].focus();
  }
  btnNext.addEventListener('click', advance);

  /* click covers touch, mouse and Enter/Space on the buttons.
     During a reveal the whole grid is one big "continue" button. */
  grid.addEventListener('click', function (ev) {
    if (!playing) return;
    if (revealed) {
      advance();
      return;
    }
    if (Date.now() - itemStartAt < PICK_GUARD_MS) return;
    var el = ev.target;
    while (el && el !== grid && !(el.dataset && el.dataset.idx)) el = el.parentNode;
    if (!el || el === grid) return;
    pick(parseInt(el.dataset.idx, 10));
  });

  function finishRound() {
    playing = false;
    /* Capture focus BEFORE anything here kills it — BOTH ways it can
       die: hiding "next grid" (the player may be standing on it) and
       disabling the chips, each of which drops focus to <body>
       synchronously. */
    var hadFocus = focusWasLive();
    btnNext.hidden = true;
    render(); /* chips go quiet but the last reveal stays readable */
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'round done (' + scores.join(' · ') + ') — press “new round” to hunt again.';
    /* hand keyboard focus to the one live control instead */
    if (hadFocus && focusLost()) btnRound.focus();
    /* A first-ever round has no previous best, so isNewBest is trivially
       true and "new best!" celebrates nothing — on the one round where the
       number most needs saying what it IS. The SDK marks that round with
       isFirst; where it is undefined the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
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

  /* Chip fills are ground truth and ignore the theme; the rings and
     pills around them are CSS variables, so the cascade already
     restyles them with no JS at all. render() is registered anyway so
     the drill keeps the family's repaint contract and stays correct if
     anything theme-dependent is ever painted from JS — it is safe to
     call at any moment, including mid-reveal.
     (No canvas → no fitCanvas/DPR pass and no resize handler; the
     grid is fluid CSS.) */
  ArtDaily.onTheme(render);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  buildChips();
  newRound();
})();
