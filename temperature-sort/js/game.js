/* ============================================================
   game.js — Temperature Sort. Five swatches at matched lightness
   and chroma, hues sampled inside the unambiguous warm→cool arc
   (orange-red through yellow/green to blue — never magenta or
   purple, whose temperature depends on context). Drag chips into
   place — or tap two to swap, the keyboard/assistive path — until
   the row runs warm→cool, then "done sorting". Score is Kendall's
   tau rescaled to 0–100 (concordant minus discordant pairs, floored
   at 0), so a shuffled row scores near nothing rather than the 50
   that raw concordance would hand out; a round is the mean of 4 sets.
   DOM-based drill — the board replaces the template canvas.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'temperature-sort';
  var SETS_PER_ROUND = 4;
  var CHIPS_PER_SET = 5;
  var REVEAL_GUARD_MS = 350; /* a double-click on "done sorting" must not skip the reveal */

  /* Pointer travel before a press counts as a drag. 6px was under the
     drift of an ordinary trackpad tap (tap-to-click especially), so
     roughly every other tap crossed it, moved nothing, and then had its
     click swallowed by the post-drag guard: the player tapped a chip,
     nothing happened, and they had to tap again. Ease it per hardware
     and floor it at 10 — a mouse pivots at the wrist and drifts most. */
  var DRAG_THRESHOLD_BASE = 6;
  function dragThresholdPx() {
    return Math.max(10, ArtDaily.ease(DRAG_THRESHOLD_BASE));
  }

  /* Palm rejection. On a pen tablet the palm routinely lands a few
     milliseconds before the nib; first-pointer-wins hands the whole
     gesture to the palm. A pen always wins, and a touch is ignored for
     a beat after any pen contact.
     700ms, not 500 — that is the number the shared SDK settled on for
     exactly this guard, and its own comment says "the drills' own palm
     guard uses this". It did not. */
  var PEN_LOCKOUT_MS = 700;
  /* A press this old lost its release: a swallowed pointercancel, a
     system gesture, a tab hidden mid-drag. Without this the drill's ONE
     drag slot stays occupied by a pointer that will never lift, and
     dragging is dead for the rest of the round. Same self-heal, same
     window, as the SDK's own pointer sniffer. */
  var GESTURE_IDLE_MS = 2000;
  var lastPenAt = 0;
  function pointerAllowed(ev) {
    if (ev.pointerType === 'pen') { lastPenAt = Date.now(); return true; }
    return !(ev.pointerType === 'touch' && Date.now() - lastPenAt < PEN_LOCKOUT_MS);
  }

  /* The warmth arc in "paint wheel" degrees: 20 (warmest orange-red)
     to 235 (coolest blue). Rendered through OKLCH (hue 40..262) so
     lightness and chroma stay perceptually even across hues. */
  var ARC_WARM = 20, ARC_COOL = 235;
  var OK_WARM = 40, OK_COOL = 262;

  /* ============ pure scoring — inputs in, 0–100 out ============ */

  /* Position along the warm→cool arc: 0 = warmest, 1 = coolest. */
  function warmthKey(hue) {
    return (hue - ARC_WARM) / (ARC_COOL - ARC_WARM);
  }

  /* Kendall's tau, rescaled to 0–100: over all chip pairs, concordant
     minus discordant, divided by the pairs that can be judged. Perfect
     = 100, reversed = 0, and — the reason for tau rather than raw
     concordance — a shuffled row sits near 0 instead of 50. Raw
     concordance would hand a player who never touched a chip an
     average of exactly 50/100, which is a lie the skill meter would
     then repeat. 5 chips = 10 pairs, so each inversion costs 20:
     one adjacent swap = 80, two = 60, half-reversed and worse = 0.
     Ties are dropped from the denominator rather than counted against
     the player — nothing is out of order between two equal hues. */
  var TAU_FLOOR = -0.2; /* where the 0 lands: worse than "half the pairs right" */

  function kendallScore(keysInOrder) {
    var n = keysInOrder.length, good = 0, bad = 0, usable = 0, i, j;
    for (i = 0; i < n; i++) {
      if (isFinite(keysInOrder[i])) usable += 1;
      for (j = i + 1; j < n; j++) {
        if (keysInOrder[i] < keysInOrder[j]) good += 1;
        else if (keysInOrder[i] > keysInOrder[j]) bad += 1;
      }
    }
    var total = good + bad;
    /* All tied is a real 100 — nothing is out of order between equal hues.
       A row of NaNs reaches the same place by a different road: every
       comparison against NaN is false, so good and bad both stay 0 and the
       tie branch handed out a full 100 for keys that could not be judged at
       all. That is the fake-perfect the protocol forbids for degenerate
       input, and it would have been written to the permanent best. Two
       genuinely comparable keys are the price of the tie. */
    if (total === 0) return usable >= 2 ? 100 : 0;
    var tau = (good - bad) / total;
    /* Clamping tau at 0 meant "half the pairs in the right order" — a
       genuine, partly-correct read of four murky near-neighbour swatches
       — printed the same 0 as never touching the board. Slide the zero
       point below the shuffle instead: a half-right row now reads ~17
       and a two-pairs-flipped row reads 67. The dealt row a player never
       touches averages 23 (measured over 60 000 deals, pre-sorted rows
       rejected as makeSet does) — the cost of paying for a partial read
       is that a shuffle is worth about a fifth of the scale, not the
       "low teens" this note used to claim. */
    return 100 * Math.max(0, Math.min(1, (tau - TAU_FLOOR) / (1 - TAU_FLOOR)));
  }

  /* Round score = mean of the set scores. */
  function roundScore(setScores) {
    var sum = 0, i;
    for (i = 0; i < setScores.length; i++) sum += setScores[i];
    return setScores.length === 0 ? 0 : sum / setScores.length;
  }

  /* 1-based warmth ranks (1 = warmest) for keys in display order. */
  function warmthRanks(keys) {
    var ranks = [], i, j, r;
    for (i = 0; i < keys.length; i++) {
      r = 1;
      for (j = 0; j < keys.length; j++) if (keys[j] < keys[i]) r += 1;
      ranks.push(r);
    }
    return ranks;
  }

  /* ============ pure colour math — OKLCH → sRGB ============ */

  function arcToOkHue(hue) {
    return OK_WARM + warmthKey(hue) * (OK_COOL - OK_WARM);
  }

  function oklchToRgbLin(L, C, Hdeg) {
    var h = Hdeg * Math.PI / 180;
    var a = C * Math.cos(h), b = C * Math.sin(h);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }

  function inGamut(rgb) {
    return rgb[0] >= -0.0005 && rgb[0] <= 1.0005 &&
           rgb[1] >= -0.0005 && rgb[1] <= 1.0005 &&
           rgb[2] >= -0.0005 && rgb[2] <= 1.0005;
  }

  /* Largest sRGB-representable chroma at (L, hue), capped. */
  function maxChroma(L, Hdeg, cap) {
    if (inGamut(oklchToRgbLin(L, cap, Hdeg))) return cap;
    var lo = 0, hi = cap, mid, i;
    for (i = 0; i < 24; i++) {
      mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbLin(L, mid, Hdeg))) lo = mid; else hi = mid;
    }
    return lo;
  }

  function gammaEnc(c) {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  function oklchCss(L, C, Hdeg) {
    var rgb = oklchToRgbLin(L, C, Hdeg);
    return 'rgb(' + Math.round(gammaEnc(rgb[0]) * 255) + ',' +
                    Math.round(gammaEnc(rgb[1]) * 255) + ',' +
                    Math.round(gammaEnc(rgb[2]) * 255) + ')';
  }

  /* ============ set generation ============ */

  /* Ramp within the round: hue gaps shrink ~45° → ~16° and chroma
     drops, so late sets are near-neighbour hues at murkier paint. */
  var GAP_BY_SET = [45, 34, 24, 16];
  var CHROMA_BY_SET = [0.12, 0.105, 0.09, 0.072];
  var STRIP_STOPS = 10; /* gradient stops on the reveal strip */

  /* ---- where the four sets come from ----------------------------------
     A SET IS A SEQUENCE OF NORMALISED DRAWS: four jittered hue gaps, the
     warm end of the run, a base lightness, a per-chip lightness jitter,
     and the shuffle that decides the order the row is dealt in. Round 1
     of a sitting is dealt from ArtDaily.roundRandom(1) — seeded from
     today and this slug — so everyone sorting today gets the same four
     rows in the same starting order, and a score finally has a
     denominator. Round 2 and on are practice: same generator, same
     distribution, unshared seed.

     NO CANVAS HERE. The chips are DOM elements filled with absolute
     oklch() strings, so two players get the identical five swatches
     rather than the same five fractions of their own sheet.

     NOTHING TO CACHE: makeSet(setIdx) is called exactly once per set,
     from startSet(), and nothing re-deals a set — there is no resize
     handler, and render() only re-paints the set it already holds. A
     plain rolling generator cannot walk out from under the player.

     EVERY DRAW IS CONTENT, INCLUDING THE ±0.02 LIGHTNESS JITTER: matched
     lightness is this drill's whole premise (temperature has to be the
     only cue), and that jitter is part of a chip's colour rather than
     anything painted over it. The SHUFFLE is content twice over — it is
     the row the player has to fix, and its rejection loop (never deal a
     pre-sorted row) consumes a variable number of draws, which is fine
     because it is deterministic given the seed.

     GUARDED, and the guard is load-bearing. index.html cache-busts its own
     scripts with ?v= but every drill loads ../sdk/artdaily-sdk.js BARE, so
     the two files cache independently: a returning visitor holding a warm
     OLD SDK plus a cold copy of this file would call a function that does
     not exist, inside newRound(), before the first set is ever built —
     "Loading…" forever. Falling back to Math.random costs today's player
     nothing but a non-comparable round, which is what they had yesterday.

     ONLY THE BARE CALL FORM IS USED — rng(), never rng.range()/.shuffle()
     — because Math.random carries no helpers, so the fallback path would
     need a shim, and a shim is a second copy of the arithmetic that can
     drift from the first. Both lines below are the lines they always
     were with Math.random() swapped for rng(); shuffled() still walks
     DOWN, one draw per step, so the draw count and order are untouched.
     Uniform on [0,1) either way, so a seeded set is not an easier or a
     harder set. */
  var rng = Math.random;

  function rand(lo, hi) { return lo + rng() * (hi - lo); }

  function shuffled(n) {
    var a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function makeSet(setIdx) {
    var gaps = [], span = 0, hues, chips = [], i, chroma, order, keys;
    for (i = 0; i < CHIPS_PER_SET - 1; i++) {
      gaps.push(GAP_BY_SET[setIdx] * rand(0.8, 1.2));
      span += gaps[i];
    }
    /* jittered gaps can (rarely) outgrow the arc — scale them back so
       every hue stays inside [ARC_WARM, ARC_COOL] */
    if (span > ARC_COOL - ARC_WARM) {
      for (i = 0; i < gaps.length; i++) gaps[i] *= (ARC_COOL - ARC_WARM) / span;
      span = ARC_COOL - ARC_WARM;
    }
    hues = [rand(ARC_WARM, ARC_COOL - span)];
    for (i = 0; i < gaps.length; i++) hues.push(hues[i] + gaps[i]);

    var Lbase = rand(0.66, 0.7);
    for (i = 0; i < CHIPS_PER_SET; i++) {
      chips.push({ hue: hues[i], key: warmthKey(hues[i]), L: Lbase + rand(-0.02, 0.02) });
    }
    /* One shared chroma per set (the most every hue can reach) so
       saturation can never be the sorting cue. Fitted to the whole
       warm→cool arc, not just the five hues in play: the reveal strip
       paints the entire arc at this same chroma, and cyan (~OK hue
       195) is the tight spot — fitting only the chips would leave the
       strip's gradient silently clipped there, so the strip would no
       longer be an honest iso-chroma ramp. */
    chroma = CHROMA_BY_SET[setIdx];
    for (i = 0; i < chips.length; i++) {
      chroma = Math.min(chroma, maxChroma(chips[i].L, arcToOkHue(chips[i].hue), chroma));
    }
    for (i = 0; i <= STRIP_STOPS; i++) {
      chroma = Math.min(chroma, maxChroma(Lbase, OK_WARM + (i / STRIP_STOPS) * (OK_COOL - OK_WARM), chroma));
    }
    for (i = 0; i < chips.length; i++) {
      chips[i].css = oklchCss(chips[i].L, chroma, arcToOkHue(chips[i].hue));
    }

    do {
      order = shuffled(CHIPS_PER_SET);
      keys = [];
      for (i = 0; i < order.length; i++) keys.push(chips[order[i]].key);
    } while (kendallScore(keys) === 100); /* never deal a pre-sorted row */

    return { chips: chips, order: order, chroma: chroma, Lbase: Lbase };
  }

  /* ============ DOM + state ============ */

  var chipsRow = document.getElementById('tsChips');
  var stripWrap = document.getElementById('tsStripWrap');
  var strip = document.getElementById('tsStrip');
  var btnDone = document.getElementById('btnDone');
  var btnRound = document.getElementById('btnRound');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  ArtDaily.init({ slug: SLUG });

  var round = 0, setIdx = 0, setScores = [], current = null;
  var selected = -1; /* selected position in the row, -1 = none */
  var phase = 'sort'; /* 'sort' | 'reveal' | 'done' */
  var chipEls = [];
  var revealAt = 0; /* when the current reveal opened (double-click guard) */

  function sortHint() {
    hint.textContent = 'set ' + (setIdx + 1) + ' of ' + SETS_PER_ROUND +
      ' — drag the chips into order, or tap one then tap another to swap them.' +
      ' warm (fire, sun) on the left, cool (water, shade) on the right.' +
      (setIdx === SETS_PER_ROUND - 1
        ? ' this last set is the bonus one — the hues sit almost on top of each other, so anything you get here is extra.'
        : '');
  }

  function revealHint(sc) {
    var msg = sc === 100 ? 'every pair in order.' :
              sc >= 80 ? 'one pair flipped.' :
              sc >= 50 ? 'close — check the neighbours.' :
              'the strip shows where each hue really sits.';
    hint.textContent = 'set ' + (setIdx + 1) + ': ' + sc + ' / 100 — ' + msg;
  }

  /* Every arrow in this family's markup is wrapped in an aria-hidden
     span, because it is decoration — but this button relabels itself
     from JS with textContent, which dropped the glyph straight into the
     accessible name: "next set right arrow". Rebuild the label the way
     the markup does it. */
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

  function buildChips() {
    var i;
    chipsRow.innerHTML = '';
    chipEls = [];
    for (i = 0; i < CHIPS_PER_SET; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-chip';
      (function (pos, el) {
        el.addEventListener('click', function (ev) { onChipTap(pos, ev); });
        el.addEventListener('pointerdown', function (ev) { onDragStart(pos, el, ev); });
        el.addEventListener('pointermove', onDragMove);
        el.addEventListener('pointerup', function (ev) { onDragEnd(ev, false); });
        el.addEventListener('pointercancel', function (ev) { onDragEnd(ev, true); });
      })(i, b);
      chipsRow.appendChild(b);
      chipEls.push(b);
    }
  }

  /* Repaint the row (and reveal annotations) from current state.
     Chip buttons persist across swaps so keyboard focus survives. */
  function render() {
    if (!current) return;
    var keys = [], i;
    for (i = 0; i < current.order.length; i++) keys.push(current.chips[current.order[i]].key);
    var ranks = warmthRanks(keys);
    for (i = 0; i < chipEls.length; i++) {
      var el = chipEls[i];
      el.style.background = current.chips[current.order[i]].css;
      el.classList.toggle('is-selected', phase === 'sort' && selected === i);
      el.setAttribute('aria-pressed', String(phase === 'sort' && selected === i));
      el.disabled = phase !== 'sort';
      el.innerHTML = '';
      if (phase === 'sort') {
        /* Sorting by tapping is a TWO-STEP control, and "swatch 3 of 5"
           said nothing about either step: not that activating this chip
           picks it up, and not — once one IS held — what activating this
           one will now do. The only place that was explained is the
           on-screen tip, which says "drag" and "tap": both wrong verbs
           for the half of the room working a keyboard, who cannot drag
           at all and for whom this two-step swap is the ONLY way to
           play. Say what activating THIS chip does, in the state it is
           actually in. (aria-pressed already carries the raw on/off;
           what it cannot say is what the second press is for.) */
        el.setAttribute('aria-label', 'swatch ' + (i + 1) + ' of ' + CHIPS_PER_SET +
          (selected === -1
            ? ' — activate to pick it up'
            : (selected === i
              ? ' — picked up; activate again to put it back'
              : ' — activate to swap with swatch ' + (selected + 1))));
      } else {
        el.setAttribute('aria-label', 'swatch ' + (i + 1) + ', warmth rank ' + ranks[i] +
          (ranks[i] === i + 1 ? ', correct' : ''));
        var pill = document.createElement('span');
        pill.className = 'ts-rank' + (ranks[i] === i + 1 ? ' is-ok' : '');
        pill.textContent = String(ranks[i]);
        el.appendChild(pill);
      }
    }
    renderStrip(keys, ranks);
  }

  /* The reveal strip: the whole warm→cool arc at this set's paint
     mix (the set chroma is fitted to the entire arc, so this really is
     an iso-chroma ramp), with each chip's true position ticked and
     rank-numbered. Marks reuse the rank pills' split — accent = that
     chip sat at its own rank, graphite = misplaced — so the eye can
     connect chip to mark without number-matching; the split lives in
     the NUMBER, which sits above the strip on --card where both themes
     clear AA, plus a heavier tick for a correct one. The wrap keeps its
     space via visibility (not hidden), so "done sorting" never jumps. */
  function renderStrip(keys, ranks) {
    /* Set 1 shows the arc UNMARKED before the first scored judgement, so
       "warm" and "cool" are anchored by something the player can see
       rather than by two words they may not own yet. */
    var preview = phase === 'sort';
    if (preview && setIdx !== 0) { stripWrap.classList.remove('is-shown'); return; }
    var stops = [], i, t;
    for (i = 0; i <= STRIP_STOPS; i++) {
      t = i / STRIP_STOPS;
      stops.push(oklchCss(current.Lbase, current.chroma,
        OK_WARM + t * (OK_COOL - OK_WARM)) + ' ' + (t * 100) + '%');
    }
    strip.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
    strip.innerHTML = '';
    if (!preview) {
      for (i = 0; i < keys.length; i++) {
        var mark = document.createElement('span');
        mark.className = 'ts-mark' + (ranks[i] === i + 1 ? ' is-ok' : '');
        mark.style.left = (keys[i] * 100) + '%';
        mark.textContent = String(ranks[i]);
        strip.appendChild(mark);
      }
    }
    strip.setAttribute('aria-label', preview
      ? 'the warm to cool arc these five swatches were taken from — warm at the left, cool at the right'
      : 'Warm to cool strip marking each swatch’s true position');
    stripWrap.classList.toggle('is-preview', preview);
    stripWrap.classList.add('is-shown');
  }

  /* ---- drag-to-reorder (pointer), tap-two-to-swap fallback ----
     Insertion semantics: the dragged chip slides out and the row
     closes around it, previewed live with transforms; the model
     only changes on release. Taps still swap, so keyboard and
     assistive users keep the original two-step interaction. */
  var dragPid = null, dragIdx = -1, dragTarget = -1, dragging = false, didDrag = false;
  var dragX0 = 0, slotW = 1;
  var dragEl = null, dragStartedAt = 0;

  function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function slotWidth() {
    if (chipEls.length > 1) {
      var a = chipEls[0].getBoundingClientRect();
      var b = chipEls[1].getBoundingClientRect();
      if (b.left - a.left > 1) return b.left - a.left;
    }
    return chipEls[0] ? chipEls[0].getBoundingClientRect().width + 8 : 60;
  }

  function clearDragPaint() {
    for (var i = 0; i < chipEls.length; i++) {
      chipEls[i].style.transform = '';
      chipEls[i].classList.remove('is-dragging');
    }
  }

  /* Drop an in-flight gesture without touching the model: the preview
     transforms come off, nothing is reordered. Used when a pen takes the
     board off a palm, and when a press that lost its release is evicted. */
  function abandonDrag() {
    if (dragEl && dragEl.releasePointerCapture && dragPid !== null) {
      try { dragEl.releasePointerCapture(dragPid); } catch (e) {}
    }
    dragPid = null;
    dragEl = null;
    dragging = false;
    didDrag = false;
    clearDragPaint();
  }

  function onDragStart(pos, el, ev) {
    if (phase !== 'sort' || ev.button > 0) return;
    /* THE HARDWARE QUESTION IS ANSWERED FIRST, before "someone already
       holds the gesture". On a pen display the palm lands a few
       milliseconds BEFORE the nib, so the old order — bail out early
       because dragPid was already taken — meant the nib's own
       pointerdown never even registered as pen contact: lastPenAt stayed
       stale, the palm kept the gesture, and the artist dragged with the
       heel of their hand. A pen now preempts whatever is holding the
       board. (A screenless tablet never lands a palm at all, so this
       costs it nothing.) */
    var isPen = ev.pointerType === 'pen';
    if (!pointerAllowed(ev)) return;
    if (dragPid !== null) {
      /* Anything that is not a pen waits its turn — unless the pointer
         holding the slot is long gone, in which case its release was
         swallowed and the slot has to be reclaimed or dragging is dead. */
      if (!isPen && Date.now() - dragStartedAt < GESTURE_IDLE_MS) return;
      abandonDrag();
    }
    didDrag = false; /* also recovers if a browser swallowed the post-drag click */
    dragPid = ev.pointerId;
    dragEl = el;
    dragStartedAt = Date.now();
    dragIdx = pos;
    dragTarget = pos;
    dragX0 = ev.clientX;
    dragging = false;
    slotW = slotWidth();
    if (el.setPointerCapture) { try { el.setPointerCapture(ev.pointerId); } catch (e) {} }
  }

  /* The dragged element is always chipEls[dragIdx] — never the element
     the listener happens to fire on. With pointer capture those are the
     same, but if capture is unavailable the events land on whichever
     chip is under the pointer, and painting *that* one would drag the
     wrong swatch while the model moved the right one. */
  function onDragMove(ev) {
    if (ev.pointerId !== dragPid) return;
    var el = chipEls[dragIdx];
    if (!el) return;
    var dx = ev.clientX - dragX0, i, shift;
    if (!dragging) {
      if (Math.abs(dx) < dragThresholdPx()) return;
      dragging = true;
      didDrag = true;
      if (selected !== -1) { selected = -1; render(); }
      el.classList.add('is-dragging');
    }
    el.style.transform = 'translate(' + dx + 'px, -4px)';
    dragTarget = clampInt(dragIdx + Math.round(dx / slotW), 0, CHIPS_PER_SET - 1);
    for (i = 0; i < chipEls.length; i++) {
      if (i === dragIdx) continue;
      shift = 0;
      if (dragIdx < dragTarget && i > dragIdx && i <= dragTarget) shift = -slotW;
      else if (dragIdx > dragTarget && i >= dragTarget && i < dragIdx) shift = slotW;
      chipEls[i].style.transform = shift ? 'translateX(' + shift + 'px)' : '';
    }
  }

  function onDragEnd(ev, cancelled) {
    if (ev.pointerId !== dragPid) return;
    dragPid = null;
    dragEl = null;
    if (!dragging) return; /* plain tap — the click handler swaps */
    dragging = false;
    clearDragPaint();
    if (!cancelled && dragTarget !== dragIdx) {
      var moved = current.order.splice(dragIdx, 1)[0];
      current.order.splice(dragTarget, 0, moved);
    } else {
      /* The pointer wandered past the threshold but landed back in the
         same slot: nothing moved, so this was a tap with a shaky hand,
         not a drag. Let the click through as a select instead of eating
         it — swallowing it is what made every other trackpad tap look
         like a dead page. */
      didDrag = false;
    }
    render();
  }

  function onChipTap(pos, ev) {
    /* A keyboard activation (Enter/Space) reports detail 0 and can never
       be the tail of a drag, so it must never be eaten by the drag
       guard — otherwise a browser that swallowed a post-drag click
       leaves didDrag set and silently drops the next keyboard swap. */
    if (didDrag && !(ev && ev.detail === 0)) { didDrag = false; return; }
    if (phase !== 'sort') return;
    if (selected === -1) {
      selected = pos;
    } else if (selected === pos) {
      selected = -1; /* same chip again = deselect */
    } else {
      var t = current.order[selected];
      current.order[selected] = current.order[pos];
      current.order[pos] = t;
      selected = -1;
    }
    render();
  }

  function startSet() {
    current = makeSet(setIdx);
    selected = -1;
    dragPid = null;
    dragEl = null;
    dragging = false;
    didDrag = false;
    phase = 'sort';
    setBtnLabel(btnDone, 'done sorting');
    btnDone.disabled = false;
    clearDragPaint(); /* no stale transform can survive into a new set */
    sortHint();
    render();
  }

  function newRound() {
    /* If set 4's reveal is on screen, the round is fully scored —
       report it before resetting, so "new round" mid-reveal never
       swallows a finished round. finishRound() flips phase to
       'done', so this cannot double-report (same guard pattern as
       neutral-hunt). */
    if (phase === 'reveal' && setScores.length >= SETS_PER_ROUND) finishRound();
    round += 1;
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. Re-seeded per round, so
       round 1 is today's shared four sets and every round after it is
       practice. It sits above startSet(), which deals set 1 — the first
       set of a round must come out of the NEW generator, never the last
       round's. See the block above rand() for the guard. */
    rng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    setIdx = 0;
    setScores = [];
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startSet();
  }

  function onDone() {
    var keys, i, sc;
    if (phase === 'sort') {
      keys = [];
      for (i = 0; i < current.order.length; i++) keys.push(current.chips[current.order[i]].key);
      sc = Math.round(kendallScore(keys));
      setScores.push(sc);
      phase = 'reveal';
      revealAt = Date.now();
      if (setIdx < SETS_PER_ROUND - 1) setBtnLabel(btnDone, 'next set', '→');
      else setBtnLabel(btnDone, 'finish round');
      revealHint(sc);
      render();
      return;
    }
    if (phase === 'reveal') {
      /* an accidental double-click on the same button must not
         skip the reveal — the drill's whole teaching payload */
      if (Date.now() - revealAt < REVEAL_GUARD_MS) return;
      if (setIdx < SETS_PER_ROUND - 1) {
        setIdx += 1;
        startSet();
      } else {
        finishRound();
      }
    }
  }

  function finishRound() {
    phase = 'done';
    /* "done sorting" is the button the player is standing on when they
       finish, and disabling a focused button drops focus to <body> — the
       keyboard player then has to Tab in from the top of the page to
       reach "new round". Hand focus to the one live control instead. */
    var keepFocus = document.activeElement === btnDone;
    btnDone.disabled = true;
    if (keepFocus) btnRound.focus();
    /* the strip stays up: set 4's reveal is still teaching material */
    var res = ArtDaily.report(roundScore(setScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'round done (' + setScores.join(' · ') + ') — press “new round” to go again.';
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
  btnDone.addEventListener('click', onDone);
  btnRound.addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  /* Swatch colours and the reveal strip are data — absolute, identical
     in both themes — and every annotation around them is a CSS
     variable, so the cascade handles a theme flip on its own. render()
     is registered anyway to keep the family's repaint contract; it is
     safe to call in any phase (it no-ops before the first set). */
  ArtDaily.onTheme(render);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  /* The five buttons are built ONCE and repainted in place, so keyboard
     focus survives every swap, reveal and set change (same persistent-
     button pattern as neutral-hunt). */
  buildChips();
  newRound();
})();
