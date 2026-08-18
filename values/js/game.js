/* ============================================================
   game.js — Value Squint. Six items per round: three gray
   LADDERS (tap two chips to swap until they run light → dark),
   then three value MATCHES (drive a gray until it holds the
   same value as a colored swatch — with a slider, or by
   hatching strokes onto a small white pad). Scoring is pure
   math at the top — geometry in, 0–100 out — DOM below. Every
   reveal stays on screen until the player hits next, so the
   teaching moment is self-paced.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'values';
  var CHIPS = 6;                  /* grays per ladder */
  var ITEMS = 6;                  /* 3 ladders + 3 matches */

  /* Difficulty ramps within the round: ladder gray range narrows
     (subtler steps), match saturation drops (near-grays tempt you
     to overshoot the correction). */
  var LADDER_RANGES = [[10, 90], [22, 78], [35, 65]];
  var MATCH_SATS = [[70, 85], [55, 70], [40, 55]];

  /* ===== pure scoring — geometry in, 0–100 out ===== */

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* Kendall-style pair count: how many of the 15 chip pairs already
     sit in light-to-dark (descending lightness) order. */
  function ladderPairs(order) {
    var good = 0, total = 0, i, j;
    for (i = 0; i < order.length; i++) {
      for (j = i + 1; j < order.length; j++) {
        total += 1;
        if (order[i] > order[j]) good += 1;
      }
    }
    return { good: good, total: total };
  }

  /* Kendall tau — (concordant − discordant) / pairs — with negative
     tau clamped to 0 and stretched over 0–100. The raw ordered-pair
     FRACTION would pay ~50 for a shuffled deal, i.e. ~50 points for
     tapping "done sorting" without sorting; tau puts chance at 0,
     a perfect ladder at 100 and a reversed one at 0. */
  function ladderScore(order) {
    var p = ladderPairs(order);
    if (p.total === 0) return 0;
    return Math.max(0, 2 * (p.good / p.total) - 1) * 100;
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(y) {
    return y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
  }

  /* h in degrees, s and l as 0–1 fractions → {r,g,b} 0–1. */
  function hslToRgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return { r: r + m, g: g + m, b: b + m };
  }

  function relLuminance(rgb) {
    return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
  }

  /* CIE L* from relative luminance (Yn = 1). */
  function lstarFromY(y) {
    var f = y > 216 / 24389 ? Math.pow(y, 1 / 3) : (24389 / 27 * y + 16) / 116;
    return 116 * f - 16;
  }

  /* gray slider level 0–100 → its L*. */
  function grayLstar(level) {
    return lstarFromY(srgbToLinear(level / 100));
  }

  /* color as HSL (deg, %, %) → its L*. */
  function colorLstar(h, s, l) {
    return lstarFromY(relLuminance(hslToRgb(h, s / 100, l / 100)));
  }

  /* inverse of grayLstar — the gray level whose L* equals L,
     used to paint the ideal band in the reveal. */
  function lstarToGrayLevel(L) {
    var f = (L + 16) / 116;
    var y = L > 8 ? f * f * f : L * 27 / 24389;
    return clamp(linearToSrgb(y) * 100, 0, 100);
  }

  /* Mean tone of a hatched RGBA pixel array → L*. Squinting blurs
     in LINEAR light, so the coverage tone is the mean of linearized
     pixels, not of sRGB bytes. Strokes are grayscale (r = g = b),
     so the red channel carries the tone. */
  function hatchLstar(data) {
    var sum = 0, n = 0, i;
    for (i = 0; i < data.length; i += 4) {
      sum += srgbToLinear(data[i] / 255);
      n += 1;
    }
    return lstarFromY(n ? sum / n : 1);
  }

  /* 100 * (1 - dL/tol), clamped — with the first 1 L-star of
     error forgiven: the slider moves in whole levels (~1 L-star
     apiece), so without the tolerance a perfect eye could never
     land the 100.
     tol is 22 for the slider, where landing a value is a pure eye
     judgement with no hand in it. Hatching is a DRAWN mark: the tone
     comes out of how much ink your hand laid down, so the tolerance is
     eased per hardware there (a trackpad cannot meter coverage the way
     a pen can). A perfect match is 100 either way.

     WHAT THE HATCH EASE IS ALLOWED TO EASE. It used to be
     ArtDaily.ease(MATCH_TOL) — the whole window doubled, so a trackpad
     scored against 44 L*, which is 44% of the entire scale. That is not
     a hand allowance, it is a different drill: at 44 an UNTOUCHED white
     pad scored above zero on 54% of deals and up to 87/100 for laying no
     ink at all (measured; pen 16% / max 75, finger 32% / max 83). Only
     the HAND's share is eased now, and the pen stays the reference at
     exactly 22 so nobody's existing best moves under them:
       pen 22 · finger 22+5=27 · trackpad 22+10=32.
     An honest hatch still means ~94/100 on all three. */
  var MATCH_TOL = 22;
  /* the extra L* a drawn mark is allowed over a slider judgement, before
     easing; ease() multiplies it (pen ×1, finger ×1.5, trackpad ×2) and
     only the surplus over the pen is handed out. */
  var HATCH_HAND = 10;
  /* Paper white is L* 100 and the lightest colour this drill can deal is
     L* 93.5, so a pad still sitting at paper white is never an answer —
     it is an unplayed item. Without this the tolerance alone cannot save
     it: even at 22 a blank pad is worth 75 against the lightest target. */
  var BLANK_PAD_L = 99.5;
  function matchScore(dL, tol) {
    var t = (typeof tol === 'number' && isFinite(tol) && tol > 0) ? tol : MATCH_TOL;
    if (!isFinite(dL)) return 0;
    var d = Math.max(0, Math.abs(dL) - 1);
    return 100 * clamp(1 - d / t, 0, 1);
  }

  function meanScore(scores) {
    var sum = 0, i;
    for (i = 0; i < scores.length; i++) sum += scores[i];
    return scores.length ? sum / scores.length : 0;
  }

  function evenGrays(lo, hi) {
    var out = [], i;
    for (i = 0; i < CHIPS; i++) out.push(lo + (hi - lo) * i / (CHIPS - 1));
    return out;
  }

  /* ===== DOM + state ===== */

  var stage = document.getElementById('valueStage');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  /* No JS ink lookup on purpose: every theme-dependent colour here is a
     CSS token on a class (so a theme flip restyles it with no repaint),
     and the only two things painted from JS are deliberately theme-proof
     — the chips/bands carry their own gray with labelInk() picking pure
     black or white over it, and the hatch pad is white paper with black
     strokes because it is the measuring instrument, not page chrome. */

  var round = 0, itemIdx = 0, itemScores = [], item = null, phase = 'idle';
  var matchMode = 'slider'; /* 'slider' | 'hatch' — persists across items */

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function shuffle(arr) {
    var a = arr.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function isSortedDesc(a) {
    var i;
    for (i = 1; i < a.length; i++) if (a[i - 1] < a[i]) return false;
    return true;
  }

  function makeItem(idx) {
    if (idx < 3) {
      var range = LADDER_RANGES[idx];
      var grays = evenGrays(range[0], range[1]);
      var order = shuffle(grays);
      while (isSortedDesc(order)) order = shuffle(grays); /* never deal it pre-solved */
      return { type: 'ladder', values: order, selected: -1, flash: '' };
    }
    var sat = MATCH_SATS[idx - 3];
    var h = rand(0, 360), s = rand(sat[0], sat[1]), l = rand(30, 70);
    var targetL = colorLstar(h, s, l);
    /* start the slider a real distance from the answer, so the eye
       (not the deal) does the matching. */
    var start = Math.round(rand(5, 95));
    while (Math.abs(start - lstarToGrayLevel(targetL)) < 15) start = Math.round(rand(5, 95));
    return { type: 'match', h: h, s: s, l: l, targetL: targetL, slider: start, flash: '', undo: [] };
  }

  /* gray level 0–100 → CSS color */
  function grayCss(level) {
    return 'hsl(0, 0%, ' + level.toFixed(2) + '%)';
  }

  /* readable label ink on top of an arbitrary gray/band — pure black/
     white with the crossover at level 46 keeps every gray ≥ 4.5:1
     (the palette inks dip to ~3.2:1 over mid grays), theme-independent
     because the backdrop is the chip's own gray, not a token. */
  function labelInk(level) {
    return level > 46 ? '#000' : '#fff';
  }

  function chipLabel(i, level) {
    return 'gray chip ' + (i + 1) + ' of ' + CHIPS + ' — lightness ' + Math.round(level);
  }

  /* ===== rendering (idempotent — rebuilds from state) ===== */

  /* EVERY REBUILD DESTROYED THE BUTTON THAT CAUSED IT. The stage is
     regenerated from state on each phase change, so the control the player
     had just pressed — "done sorting", "next →", a mode toggle — was
     removed from the document while it held keyboard focus, dropping focus
     onto <body>. The next Tab then restarted at the back link and walked
     the whole topbar again, six times a round. So every control carries a
     stable key, and focus returns to the same key after the rebuild; if
     that control is gone (a chip the reveal disabled, say) it falls back
     to the one action button, which is the next move anyway. Focus is only
     ever restored when it was already inside the stage, so a rebuild
     triggered by a theme flip never steals it. */
  function fkey(el, key) { el.dataset.fkey = key; return el; }

  /* Keys are ours and tame, but this string is spliced into a selector:
     anything unexpected would make querySelector throw a SyntaxError,
     and it is called from draw(), so one stray key would take the whole
     drill down rather than merely misplace the focus ring. */
  function focusable(key) {
    if (!key || !/^[a-z0-9-]+$/i.test(key)) return null;
    return stage.querySelector('[data-fkey="' + key + '"]:not(:disabled)');
  }

  function restoreFocus(had, want) {
    if (!had) return;
    var el = focusable(want) || focusable('action');
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
  }

  /* disabling the control that currently has focus loses it the same way */
  function handFocus(from, to) {
    if (!from || !to || document.activeElement !== from) return;
    try { to.focus({ preventScroll: true }); } catch (e) { try { to.focus(); } catch (e2) {} }
  }

  function draw() {
    if (!item) { stage.innerHTML = ''; return; }
    var active = document.activeElement;
    var had = !!(active && active !== document.body && stage.contains(active));
    var want = (had && active.dataset) ? active.dataset.fkey : null;
    if (item.type === 'ladder') drawLadder();
    else drawMatch();
    restoreFocus(had, want);
  }

  /* No role="status" here: this node is created fresh on every rebuild,
     and a live region inserted already carrying its text is the case
     screen readers are least likely to announce. The hint line is a real
     persistent live region and carries the same sentence. */
  function flashEl() {
    var f = document.createElement('p');
    f.className = 'item-flash';
    f.textContent = item.flash;
    return f;
  }

  /* the one stage button: play → score, reveal → self-paced next */
  function actionButton(playLabel, playHandler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-primary';
    fkey(b, 'action');
    if (phase === 'play') {
      b.textContent = playLabel;
      b.addEventListener('click', playHandler);
    } else if (phase === 'reveal') {
      b.textContent = itemIdx + 1 >= ITEMS ? 'finish round ✓' : 'next →';
      b.addEventListener('click', nextItem);
    } else {
      b.textContent = 'round done';
      b.disabled = true;
    }
    return b;
  }

  function drawLadder() {
    var revealed = phase !== 'play';
    stage.innerHTML = '';

    var row = document.createElement('div');
    row.className = 'chip-row';
    var sorted = item.values.slice().sort(function (a, b) { return b - a; });
    var i, btn;
    for (i = 0; i < item.values.length; i++) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'value-chip';
      btn.style.background = grayCss(item.values[i]);
      btn.dataset.idx = String(i);
      fkey(btn, 'chip-' + i);
      btn.setAttribute('aria-label', chipLabel(i, item.values[i]));
      btn.setAttribute('aria-pressed', String(item.selected === i));
      if (item.selected === i) btn.classList.add('chip-selected');
      if (revealed) {
        btn.disabled = true;
        btn.textContent = String(Math.round(item.values[i]));
        btn.style.color = labelInk(item.values[i]);
        if (item.values[i] !== sorted[i]) btn.classList.add('chip-wrong');
      } else {
        btn.addEventListener('click', chipTap);
      }
      row.appendChild(btn);
    }
    stage.appendChild(row);

    /* the ideal ladder, revealed right under the attempt (on narrow
       screens CSS mirrors the 3×2 chip grid so columns line up) */
    var idealRow = document.createElement('div');
    idealRow.className = 'ideal-row';
    idealRow.hidden = !revealed;
    var tag = document.createElement('span');
    tag.className = 'ideal-tag';
    tag.textContent = 'ideal';
    idealRow.appendChild(tag);
    var bar = document.createElement('div');
    bar.className = 'ideal-bar';
    for (i = 0; i < sorted.length; i++) {
      var seg = document.createElement('i');
      seg.style.background = grayCss(sorted[i]);
      bar.appendChild(seg);
    }
    idealRow.appendChild(bar);
    stage.appendChild(idealRow);

    var actions = document.createElement('div');
    actions.className = 'stage-actions';
    actions.appendChild(actionButton('done sorting', scoreLadder));
    stage.appendChild(actions);

    stage.appendChild(flashEl());
  }

  function chipTap(ev) {
    if (phase !== 'play' || !item || item.type !== 'ladder') return;
    var btn = ev.currentTarget;
    var idx = parseInt(btn.dataset.idx, 10);
    var chips = btn.parentNode.children;
    if (item.selected === -1) {
      item.selected = idx;
      btn.classList.add('chip-selected');
      btn.setAttribute('aria-pressed', 'true');
      return;
    }
    if (item.selected === idx) {
      item.selected = -1;
      btn.classList.remove('chip-selected');
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    /* second tap on a different chip: swap the two grays in place
       (no rebuild, so keyboard focus stays where it is) */
    var a = item.selected, b = idx;
    var t = item.values[a]; item.values[a] = item.values[b]; item.values[b] = t;
    item.selected = -1;
    chips[a].classList.remove('chip-selected');
    chips[a].setAttribute('aria-pressed', 'false');
    chips[a].style.background = grayCss(item.values[a]);
    chips[b].style.background = grayCss(item.values[b]);
    chips[a].setAttribute('aria-label', chipLabel(a, item.values[a]));
    chips[b].setAttribute('aria-label', chipLabel(b, item.values[b]));
    /* THE SWAP — THE ONLY MOVE THIS ITEM HAS — WAS SILENT. Picking a chip
       is announced for free (aria-pressed flips on the button you just
       activated), but the swap itself changes two chips that are not the
       one being read: the second chip's own name is rewritten under the
       focus, which no screen reader reliably re-announces, and the first
       chip is somewhere else entirely. So the player heard "pressed",
       then "not pressed", and never once heard that anything moved. The
       hint is the drill's live region; say what happened, in the same
       lightness numbers the chip labels use. */
    hint.textContent = 'swapped chip ' + (a + 1) + ' (now lightness ' +
      Math.round(item.values[a]) + ') and chip ' + (b + 1) + ' (now lightness ' +
      Math.round(item.values[b]) + ') — keep going, then hit done.';
  }

  function scoreLadder() {
    if (phase !== 'play') return;
    var score = ladderScore(item.values);
    var pairs = ladderPairs(item.values);
    item.selected = -1;
    /* the flash speaks the same metric the score uses: ordered pairs */
    item.flash = Math.round(score) + ' pts — ' + (pairs.good === pairs.total
      ? 'perfect ladder'
      : pairs.good + '/' + pairs.total + ' pairs in light → dark order');
    finishItem(score);
  }

  /* ---- hatch pad (match items): strokes darken a white canvas;
     its mean linear tone feeds the same L* pipeline as the slider ---- */

  /* Hatching used to lay SOLID black through a 3px nib. On a ~310×132
     pad that is 44 full-width passes to cover the paper, and reaching a
     mid target meant 26-39 of them — roughly 11,000px of travel. On a
     trackpad (5cm of throw, lift and re-place every time) that is 40-70
     separate swipes for ONE item, with "clear" as the only correction.
     An endurance test, not a value drill.
     A fat, translucent nib fixes both ends of that: the pad fills in
     about 9 passes, so every target in range is 5-10 strokes away, and
     because a pass is not opaque the tone lands smoothly instead of
     jumping. Undo and the eraser cover the overshoot. */
  var HATCH_ALPHA = 0.62;
  var HATCH_W = 14;        /* css px, scaled by dpr */
  var ERASE_W = 22;
  var THIN_PX = 1.5;       /* drop samples closer than this */
  var UNDO_DEPTH = 8;

  var hatchTool = 'hatch'; /* 'hatch' | 'erase' — persists across items */

  /* A RELEASE THE PAD NEVER SEES STOPS IT TAKING INK AT ALL.
     pointerdown returns early while activeId is set (one pointer owns the
     stroke, so a palm cannot steal it), so a single lost pointerup leaves
     the pad permanently inert for that item — the player scribbles and
     nothing happens, with "no ink on the pad yet" as the only feedback.
     setPointerCapture is called behind a feature test AND a try/catch
     because it can be missing or throw, and without it a stroke that ends
     off the pad is simply gone. The window guard below covers that, and it
     is registered ONCE at module scope rather than inside the factory: a
     fresh canvas is built per match item, so per-canvas window listeners
     would pile up for the whole session. It dispatches to whichever pad is
     live; the stop() guard makes it a no-op for every other pointer. */
  var hatchStop = null;
  function windowRelease(ev) { if (hatchStop) hatchStop(ev); }
  window.addEventListener('pointerup', windowRelease);
  window.addEventListener('pointercancel', windowRelease);

  function ensureHatchCanvas() {
    if (item.canvas) return item.canvas;
    var cv = document.createElement('canvas');
    cv.className = 'hatch-canvas';
    /* A bare <canvas> has no implicit ARIA role, and an aria-label on a
       role-less element is routinely dropped — so this pad's one line of
       explanation reached nobody. role="img" is what every other canvas in
       the arcade declares, and it is honest here: the pad takes pointer
       and pen strokes only, which is exactly why the label has to name the
       path that does work without one. */
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'hatch pad — a paper pad you darken with pointer or pen strokes. ' +
      'It has no keyboard path: switch to slider mode to answer this item with the keyboard.');
    var activeId = null, pts = [], base = null, penAt = 0;
    function pos(ev) {
      var r = cv.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * cv.width / r.width,
        y: (ev.clientY - r.top) * cv.height / r.height,
      };
    }
    /* Paint the WHOLE current stroke in one go from the pre-stroke
       bitmap. Stroking each little segment separately would stack the
       alpha at every joint, so a 120Hz pen would darken the pad far
       faster than a 60Hz mouse for the identical gesture — the tone
       would be measuring the device, not the hand. */
    function repaintStroke() {
      if (!base) return;
      var g = cv.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      g.putImageData(base, 0, 0);
      if (pts.length === 0) return;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (hatchTool === 'erase') {
        g.strokeStyle = '#fff';
        g.lineWidth = ERASE_W * dpr;
      } else {
        g.strokeStyle = 'rgba(0, 0, 0, ' + HATCH_ALPHA + ')';
        g.lineWidth = HATCH_W * dpr;
      }
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) g.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
    function grabBase() {
      if (!isSized(cv)) return null;
      try { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); } catch (e) { return null; }
    }
    /* One pointer owns the stroke, and a pen always beats a palm: on a
       tablet the palm lands milliseconds before the nib, and first-
       pointer-wins would give it the whole stroke. */
    cv.addEventListener('pointerdown', function (ev) {
      if (phase !== 'play' || matchMode !== 'hatch') return;
      if (ev.pointerType === 'pen') penAt = Date.now();
      else if (ev.pointerType === 'touch' && Date.now() - penAt < 500) return;
      if (activeId !== null) return;              /* already drawing */
      sizeHatchCanvas(cv);
      base = grabBase();
      if (base) {
        item.undo.push(base);
        while (item.undo.length > UNDO_DEPTH) item.undo.shift();
      }
      activeId = ev.pointerId;
      if (cv.setPointerCapture) { try { cv.setPointerCapture(ev.pointerId); } catch (e) {} }
      pts = [pos(ev)];
      repaintStroke();
      syncUndoBtn();
      ev.preventDefault();
    });
    cv.addEventListener('pointermove', function (ev) {
      if (activeId === null || ev.pointerId !== activeId) return;
      var p = pos(ev), last = pts[pts.length - 1];
      if (last && Math.abs(p.x - last.x) < THIN_PX && Math.abs(p.y - last.y) < THIN_PX) return;
      pts.push(p);
      repaintStroke();
    });
    function stop(ev) {
      if (activeId === null || (ev && ev.pointerId !== activeId)) return;
      activeId = null;
      pts = [];
      base = null;
    }
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('lostpointercapture', stop);
    hatchStop = stop;  /* the live pad, for the window guard above */
    item.canvas = cv;
    return cv;
  }

  /* Size the bitmap to its laid-out box and prime it white, once per
     item. The "already done" flag has to be an explicit marker: a fresh
     canvas element is 300×150, NOT 0×0, so testing cv.width would skip
     the white prime forever and leave a transparent pad — which reads
     back as pure black through getImageData and scores every hatch ~0. */
  function isSized(cv) { return cv.dataset.sized === '1'; }

  function sizeHatchCanvas(cv) {
    if (isSized(cv)) return;            /* keep the drawing across redraws */
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;               /* not laid out yet — retry next draw */
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    var g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    cv.dataset.sized = '1';
  }

  /* "clear" used to be the ONLY correction, so one overshoot threw the
     whole item away. Both of these are undoable now. */
  function pushUndo() {
    if (!item || !item.canvas || !isSized(item.canvas) || !item.undo) return;
    try {
      item.undo.push(item.canvas.getContext('2d').getImageData(0, 0, item.canvas.width, item.canvas.height));
      while (item.undo.length > UNDO_DEPTH) item.undo.shift();
    } catch (e) {}
  }

  function clearHatch() {
    if (phase !== 'play' || !item || !item.canvas || !isSized(item.canvas)) return;
    pushUndo();
    var g = item.canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, item.canvas.width, item.canvas.height);
    syncUndoBtn();
  }

  function undoHatch() {
    if (phase !== 'play' || !item || !item.canvas || !item.undo || !item.undo.length) return;
    var img = item.undo.pop();
    try { item.canvas.getContext('2d').putImageData(img, 0, 0); } catch (e) {}
    syncUndoBtn();
  }

  var undoBtnEl = null;
  function syncUndoBtn() {
    if (!undoBtnEl) return;
    var off = !(item && item.undo && item.undo.length);
    /* undoing back to an empty stack disables this button under the
       player's own focus — hand it on before it goes dead */
    if (off) handFocus(undoBtnEl, focusable('action'));
    undoBtnEl.disabled = off;
  }

  function drawMatch() {
    var revealed = phase !== 'play';
    stage.innerHTML = '';

    /* input mode toggle — the slider stays the keyboard path; hatch
       trains the drawing hand through the exact same L* pipeline */
    var modeRow = document.createElement('div');
    modeRow.className = 'mode-row';
    var modes = ['slider', 'hatch'], mi;
    for (mi = 0; mi < modes.length; mi++) {
      (function (m) {
        var mb = document.createElement('button');
        mb.type = 'button';
        mb.className = 'mode-btn' + (matchMode === m ? ' mode-on' : '');
        fkey(mb, 'mode-' + m);
        /* say what the mode costs you before you pick it */
        mb.textContent = m === 'hatch' ? 'hatch ✎ (draw it)' : 'slider (drag it)';
        mb.setAttribute('aria-pressed', String(matchMode === m));
        mb.disabled = revealed;
        mb.addEventListener('click', function () {
          if (phase !== 'play' || matchMode === m) return;
          matchMode = m;
          /* the blank-pad notice belongs to the pad, not to the slider */
          item.flash = '';
          hint.textContent = itemHint();
          draw();
        });
        modeRow.appendChild(mb);
      })(modes[mi]);
    }
    stage.appendChild(modeRow);

    var wrap = document.createElement('div');
    wrap.className = 'match-wrap';

    var color = document.createElement('div');
    color.className = 'swatch';
    color.style.background = 'hsl(' + item.h.toFixed(1) + ', ' + item.s.toFixed(1) + '%, ' + item.l.toFixed(1) + '%)';
    var colorTag = document.createElement('span');
    colorTag.className = 'swatch-tag';
    colorTag.textContent = revealed ? 'color · value ' + item.targetL.toFixed(1) : 'color';
    color.appendChild(colorTag);
    wrap.appendChild(color);

    var gray = document.createElement('div');
    gray.className = 'swatch';
    var grayTag = document.createElement('span');
    grayTag.className = 'swatch-tag';
    var yourL = typeof item.yourL === 'number' ? item.yourL : grayLstar(item.slider);
    var hatching = matchMode === 'hatch';
    if (hatching) {
      gray.style.background = '#fff';
      gray.appendChild(ensureHatchCanvas());
      grayTag.textContent = revealed ? 'your hatch · value ' + yourL.toFixed(1) : 'your hatch';
    } else {
      gray.style.background = grayCss(item.slider);
      grayTag.textContent = revealed ? 'your gray · value ' + yourL.toFixed(1) : 'your gray';
    }
    gray.appendChild(grayTag);
    if (revealed) {
      var band = document.createElement('div');
      band.className = 'reveal-band';
      var lvl = lstarToGrayLevel(item.targetL);
      band.style.background = grayCss(lvl);
      band.style.color = labelInk(lvl);
      band.textContent = 'ideal';
      gray.appendChild(band);
    }
    wrap.appendChild(gray);
    stage.appendChild(wrap);
    if (hatching && item.canvas) sizeHatchCanvas(item.canvas); /* now that it's laid out */

    if (!hatching) {
      var sliderRow = document.createElement('div');
      sliderRow.className = 'slider-row';
      var darkEnd = document.createElement('span');
      darkEnd.className = 'slider-end';
      darkEnd.textContent = 'dark';
      sliderRow.appendChild(darkEnd);
      var input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.value = String(item.slider);
      input.disabled = revealed;
      fkey(input, 'slider');
      input.setAttribute('aria-label', 'gray value, 0 dark to 100 light');
      input.addEventListener('input', function () {
        item.slider = clamp(parseInt(input.value, 10) || 0, 0, 100);
        gray.style.background = grayCss(item.slider);
      });
      sliderRow.appendChild(input);
      var lightEnd = document.createElement('span');
      lightEnd.className = 'slider-end';
      lightEnd.textContent = 'light';
      sliderRow.appendChild(lightEnd);
      stage.appendChild(sliderRow);
    }

    var actions = document.createElement('div');
    actions.className = 'stage-actions';
    undoBtnEl = null;
    if (hatching && !revealed) {
      var tool = document.createElement('button');
      tool.type = 'button';
      tool.className = 'btn' + (hatchTool === 'erase' ? ' mode-on' : '');
      fkey(tool, 'tool');
      tool.textContent = hatchTool === 'erase' ? 'erasing ⌫' : 'eraser ⌫';
      tool.setAttribute('aria-pressed', String(hatchTool === 'erase'));
      tool.addEventListener('click', function () {
        hatchTool = hatchTool === 'erase' ? 'hatch' : 'erase';
        draw();
      });
      actions.appendChild(tool);

      var un = document.createElement('button');
      un.type = 'button';
      un.className = 'btn';
      fkey(un, 'undo');
      un.textContent = 'undo ↶';
      un.addEventListener('click', undoHatch);
      actions.appendChild(un);
      undoBtnEl = un;

      var clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'btn';
      fkey(clr, 'clear');
      clr.textContent = 'clear';
      clr.addEventListener('click', clearHatch);
      actions.appendChild(clr);
      syncUndoBtn();
    }
    actions.appendChild(actionButton('lock it in', scoreMatch));
    stage.appendChild(actions);

    stage.appendChild(flashEl());
  }

  /* Plain words for a lightness miss. "off by 8.3 L*" is a unit nobody
     owns on their first visit; the number is 0–100 and that is all a
     beginner needs to be told. */
  function missWords(dL) {
    var d = Math.abs(dL);
    if (d < 1) return 'bang on';
    return 'off by ' + d.toFixed(1) + ' steps out of 100 — ' +
      (dL > 0 ? 'yours a touch too light' : 'yours a touch too dark');
  }

  function scoreMatch() {
    if (phase !== 'play') return;
    var L, hatched = false;
    if (matchMode === 'hatch' && item.canvas && isSized(item.canvas)) {
      var g = item.canvas.getContext('2d');
      L = hatchLstar(g.getImageData(0, 0, item.canvas.width, item.canvas.height).data);
      hatched = true;
    } else {
      L = grayLstar(item.slider);
    }
    /* An untouched pad is not a value judgement, it is the paper. Measured
       rather than flagged, so erasing or undoing back to white is caught
       too. The item stays live — nothing is scored, nothing is spent. */
    if (hatched && L >= BLANK_PAD_L) {
      item.flash = 'no ink on the pad yet — the paper’s own white is not a value. ' +
        'scribble until it matches (or switch to the slider).';
      /* the refusal has to be spoken too, or a screen reader hears nothing
         at all from a press that deliberately did not score */
      hint.textContent = item.flash;
      draw();
      return;
    }
    item.yourL = L;
    var dL = L - item.targetL;
    /* the slider is pure eye; the hatch pad is a drawn mark, so its HAND
       allowance — and only that — is eased for the hardware in use. The
       pen keeps the slider's own 22. */
    var score = matchScore(dL, hatched
      ? MATCH_TOL + (ArtDaily.ease(HATCH_HAND) - HATCH_HAND)
      : MATCH_TOL);
    item.flash = Math.round(score) + ' pts — ' + missWords(dL);
    finishItem(score);
  }

  /* ===== round flow ===== */

  function itemHint() {
    var n = 'item ' + (itemIdx + 1) + ' of ' + ITEMS + ' — ';
    if (item.type === 'ladder') {
      var grid = window.matchMedia && window.matchMedia('(max-width: 460px)').matches;
      return n + 'sort light → dark: tap two chips to swap them, then hit done.' +
        (grid ? ' the grid reads left → right, top → bottom.' : '');
    }
    var teach = itemIdx === 3
      ? ' value = how light or dark something is, ignoring its color. Half-shut your eyes and the color drops away.'
      : '';
    return matchMode === 'hatch'
      ? n + 'scribble on the white pad until it is as light as the color — five to ten passes cover the whole range. eraser and undo are there; ' +
        'the slider scores exactly the same if you would rather not draw.' + teach
      : n + 'slide the gray until it is exactly as light as the color.' + teach;
  }

  function startItem() {
    item = makeItem(itemIdx);
    phase = 'play';
    hint.textContent = itemHint();
    draw();
  }

  /* no auto-advance: the reveal waits for the player's own "next →" */
  function finishItem(score) {
    itemScores.push(score);
    phase = 'reveal';
    /* The hint is the live region, and it used to sit there still saying
       "sort light → dark: tap two chips to swap them" after the item had
       been scored and the chips disabled — stale on screen, and a screen
       reader heard the prompt and never one result. */
    hint.textContent = item.flash + ' — press “' +
      (itemIdx + 1 >= ITEMS ? 'finish round ✓' : 'next →') + '” to carry on.';
    draw();
  }

  function nextItem() {
    if (phase !== 'reveal') return;
    itemIdx += 1;
    if (itemIdx >= ITEMS) { finishRound(); return; }
    startItem();
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    itemScores = [];
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startItem();
  }

  function finishRound() {
    phase = 'done'; /* the last reveal stays on screen to study */
    draw();
    var res = ArtDaily.report(meanScore(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The hint is the drill's only spoken channel: the toast is a sticker
       (aria-hidden, like the template's), not a second voice, so the round
       number has to be said here or a screen-reader player never hears it. */
    hint.textContent = (res.isNewBest ? 'new best! ' : 'round done — ') + res.score +
      '/100 · ladders ' + Math.round(meanScore(itemScores.slice(0, 3))) +
      ' · matches ' + Math.round(meanScore(itemScores.slice(3))) +
      '. press “new round” to squint again.';
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

  /* ---- chrome wiring ----
     A mid-round misclick must never silently eat scored items, but a
     native confirm() is a jarring OS box inside the hub's iframe player.
     Inline two-press confirm instead, like the sibling drills. */
  /* THE ARMING WAS INVISIBLE TO ANYONE NOT WATCHING THE BUTTON. The only
     signal was the button's own label, and a name that changes under a
     focused button is not re-announced by any screen reader — so the press
     read as "nothing happened", and a player who then waited out the
     window pressed again, re-armed, heard nothing again, and could never
     reach a new round at all. The hint is the drill's live region, so the
     arming is said there and the line it replaced goes back when the
     arming lapses — unless something newer already claimed it. */
  var CONFIRM_MS = 4500; /* 2.6s is not long enough to hear it and press */
  var btnRoundEl = document.getElementById('btnRound');
  var roundBtnHtml = btnRoundEl.innerHTML;
  var confirmTimer = null, confirmSaid = '', hintBeforeConfirm = '';
  function disarmConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    btnRoundEl.innerHTML = roundBtnHtml;
    if (confirmSaid && hint.textContent === confirmSaid) hint.textContent = hintBeforeConfirm;
    confirmSaid = '';
  }
  btnRoundEl.addEventListener('click', function () {
    var midRound = phase !== 'done' && itemScores.length > 0;
    if (midRound && confirmTimer === null) {
      btnRoundEl.textContent = 'start over? press again';
      hintBeforeConfirm = hint.textContent;
      confirmSaid = 'that scraps this round — press “new round” again to start over, or carry on.';
      hint.textContent = confirmSaid;
      confirmTimer = setTimeout(disarmConfirm, CONFIRM_MS);
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

  /* DOM drill: layout reflows itself, but repaint on theme so the
     accent-inked reveal bits re-read their CSS custom properties.
     (The hatch pad's bitmap lives on the item's canvas element, so
     it survives redraws.) */
  ArtDaily.onTheme(draw);

  /* The ladder hint names the chip reading order, which flips between a
     row and a 3×2 grid at the CSS breakpoint — so a resize has to refresh
     it. Text only: never rebuild the stage under a live drag or stroke. */
  window.addEventListener('resize', function () {
    if (phase === 'play' && item) hint.textContent = itemHint();
  });

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
