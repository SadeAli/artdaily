/* ============================================================
   game.js — Colour Constancy.
   One coloured light tints a whole mini-scene: the ground, a
   white card, a grey block, an off-hue object, and the patch.
   The scene is composed honestly — reflectance × illuminant per
   channel in LINEAR RGB — so the ground truth matches the
   game's name: the player must discount the light and rebuild
   the patch's true surface colour with HSL sliders on a neutral
   grey field. The reveal switches the light to neutral and the
   cast falls away — the collapse is the lesson. Four items per
   round; scored by ΔE (CIE76). DOM-based: no canvas, the fields
   ARE the artwork, so their generated colours stay identical in
   both themes.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'colour-constancy';
  var ITEMS_PER_ROUND = 4;
  /* The honest grey. Fixed in both themes on purpose — it is the
     measuring instrument, not part of the page chrome. */
  var NEUTRAL = { r: 127, g: 127, b: 127 };
  var NEUTRAL_GAINS = { r: 1, g: 1, b: 1 };
  /* Only used if the lit appearance cannot be computed for some reason —
     every item now opens on what the patch LOOKS like under the light,
     so the player's job is visibly "move away from what you see", which
     is the lesson. Opening on a fixed teal made it "find a colour from
     scratch", four times a round. */
  var START_HSL = { h: 180, s: 40, l: 55 };

  /* ============================================================
     pure colour math + scoring — data in, numbers out, no DOM
     ============================================================ */

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* HSL (h 0–359, s/l 0–100) → sRGB 0–255. Own conversion so the
     bytes we paint and the bytes we score are identical. */
  function hslToRgb(hsl) {
    var s = hsl.s / 100, l = hsl.l / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((hsl.h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  /* sRGB byte 0–255 → linear light 0–1, and back. */
  function srgb2lin(u) {
    u /= 255;
    return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  }
  function lin2srgb(y) {
    var u = y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
    return Math.round(clamp01(u) * 255);
  }

  /* A coloured illuminant as linear-RGB gains ≤ 1: a tinted light
     only removes energy relative to neutral, so nothing ever clips.
     amp 0 is neutral light; higher amp = stronger cast. */
  function lightGains(h, amp) {
    var tint = hslToRgb({ h: h, s: 90, l: 60 });
    var r = srgb2lin(tint.r), g = srgb2lin(tint.g), b = srgb2lin(tint.b);
    var m = Math.max(r, g, b) || 1;   /* a black tint would divide by zero */
    return {
      r: (1 - amp) + amp * r / m,
      g: (1 - amp) + amp * g / m,
      b: (1 - amp) + amp * b / m,
    };
  }

  /* A surface reflectance (HSL) seen under the light: reflectance ×
     illuminant per channel in LINEAR RGB — real light math, not a
     screen-space tint. Neutral gains round-trip to the reflectance. */
  function litRgb(hsl, gains) {
    var rgb = hslToRgb(hsl);
    return {
      r: lin2srgb(srgb2lin(rgb.r) * gains.r),
      g: lin2srgb(srgb2lin(rgb.g) * gains.g),
      b: lin2srgb(srgb2lin(rgb.b) * gains.b),
    };
  }

  /* sRGB 0–255 → HSL (h 0–359, s/l 0–100), integer: the exact triple the
     sliders speak, so an opening pose can be handed straight to them. */
  function rgbToHsl(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var l = (mx + mn) / 2, h = 0, s = 0, denom = 1 - Math.abs(2 * l - 1);
    if (d > 0 && denom > 0) {
      s = d / denom;
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (!isFinite(h)) h = 0;
    h = Math.round(((h % 360) + 360) % 360) % 360;
    return { h: h, s: Math.round(clamp01(s) * 100), l: Math.round(clamp01(l) * 100) };
  }

  /* sRGB 0–255 → CIE Lab (D65 white point). */
  function rgbToLab(rgb) {
    var r = srgb2lin(rgb.r), g = srgb2lin(rgb.g), b = srgb2lin(rgb.b);
    var x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    var y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    var z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function deltaE76(rgbA, rgbB) {
    var A = rgbToLab(rgbA), B = rgbToLab(rgbB);
    return Math.sqrt(
      (A.L - B.L) * (A.L - B.L) +
      (A.a - B.a) * (A.a - B.a) +
      (A.b - B.b) * (A.b - B.b)
    );
  }

  /* SCORE THE LESSON, NOT THE SLIDER HAND.
     The old score was raw ΔE from the true colour, zeroing at 30 — and
     that measured the wrong thing. ±8° of hue slop alone is worth about
     ΔE 11, comparable to the entire cast, so a player who merely
     HALF-IGNORED the light out-scored a player who understood it
     perfectly and was 8° off. In a drill named after understanding.
     So split the miss. The cast is a direction in Lab (seen − true).
     The part of your error lying ALONG it is exactly "how much of the
     light you failed to take off" — the thing this drill exists to
     teach. The part lying across it is ordinary slider slop, which the
     ± buttons exist to fix and which is not the lesson. Price the first
     at full rate and the second at RESIDUAL_W of it. A perfect match is
     still exactly 100.
     And the along term is priced as a FRACTION OF THE CAST, not as a raw
     ΔE. Priced raw, "just copy what you see" — the one error this drill
     exists to correct — cost exactly the cast's own size, so on the
     gentler deals it paid 100 × (1 − cast/30): 68/100 on item 1 and a
     round mean of 50 for understanding nothing at all. Against the cast
     itself, leaving the light in costs the same wherever the deal lands:
     leave 20% of it in, lose 20 points; leave all of it in, score 0.
     That is also the sentence the reveal leads with, so the number and
     the lesson finally say the same thing. ALONG_ZERO_MIN caps how far
     a very weak cast can amplify the term, so an answer that is a hair
     from the truth can never be scored as though it were miles away. */
  var ZERO_ERR = 30;
  var RESIDUAL_W = 0.3;
  var ALONG_ZERO_MIN = 12;

  function labSub(p, q) { return { L: p.L - q.L, a: p.a - q.a, b: p.b - q.b }; }
  function labDot(p, q) { return p.L * q.L + p.a * q.a + p.b * q.b; }
  function labLen(v) { return Math.sqrt(labDot(v, v)); }

  /* player / true / seen (the patch as this light actually shows it),
     all sRGB → the effective error the score is built on. */
  function constancyError(rgbPlayer, rgbTrue, rgbSeen) {
    var T = rgbToLab(rgbTrue), P = rgbToLab(rgbPlayer), S = rgbToLab(rgbSeen);
    var e = labSub(P, T), v = labSub(S, T), vl = labLen(v);
    if (!(vl > 1e-6)) return labLen(e); /* no cast to discount: plain distance */
    var along = labDot(e, v) / vl;
    var res = Math.sqrt(Math.max(0, labDot(e, e) - along * along));
    /* the cast is its own zero point: all of the light left in = zero */
    var zeroAlong = Math.min(ZERO_ERR, Math.max(vl, ALONG_ZERO_MIN));
    var a = along * (ZERO_ERR / zeroAlong);
    var err = Math.sqrt(a * a + RESIDUAL_W * RESIDUAL_W * res * res);
    return isFinite(err) ? err : ZERO_ERR;
  }

  /* How much of the light the player left in, as a percentage of the
     cast. 0 = fully discounted, 100 = copied what you saw, negative =
     over-corrected. This is the sentence the reveal leads with. */
  function castLeftPct(rgbPlayer, rgbTrue, rgbSeen) {
    var T = rgbToLab(rgbTrue), P = rgbToLab(rgbPlayer), S = rgbToLab(rgbSeen);
    var e = labSub(P, T), v = labSub(S, T), vv = labDot(v, v);
    if (!(vv > 1e-9)) return 0;
    var pct = 100 * labDot(e, v) / vv;
    return isFinite(pct) ? pct : 0;
  }

  function scoreItem(err) {
    if (!isFinite(err)) return 0; /* a broken number scores the floor, never NaN */
    return 100 * clamp01(1 - err / ZERO_ERR);
  }

  function scoreRound(itemScores) {
    var sum = 0;
    for (var i = 0; i < itemScores.length; i++) sum += itemScores[i];
    return itemScores.length ? sum / itemScores.length : 0;
  }

  /* shortest signed hue difference a−b, in [−180, 180) — an exact
     antipode reports −180, since either sign is equally true. */
  function signedHueDiff(a, b) {
    return ((a - b + 540) % 360) - 180;
  }

  /* coarse painter's name for a hue — reveal copy only. */
  function hueName(h) {
    h = ((h % 360) + 360) % 360;
    var stops = [
      [15, 'red'], [45, 'orange'], [70, 'yellow'], [100, 'yellow-green'],
      [160, 'green'], [200, 'teal'], [255, 'blue'], [290, 'violet'],
      [335, 'magenta'], [360, 'red'],
    ];
    for (var i = 0; i < stops.length; i++) if (h < stops[i][0]) return stops[i][1];
    return 'red';
  }

  /* signed delta → '+7', '−3', '±0' (formatting for the reveal). */
  function fmtDelta(d, unit) {
    var r = Math.round(d);
    if (r === 0) return '±0' + unit;
    return (r > 0 ? '+' : '−') + Math.abs(r) + unit;
  }

  /* How far the light must actually move the patch, in ΔE, for the deal
     to be worth playing. A tinted light only REMOVES energy, so some
     pairings barely bite — a yellow light on a patch holding almost no
     blue has nothing to take away, and the patch sits there unchanged.
     A patch that never moves has no light to discount and nothing to
     teach, so we re-deal those (bounded; the strongest cast tried wins).
     The floor is about the LESSON being visible, not about the score:
     what a copy pays is settled by constancyError, which prices the
     light left in against the size of the cast rather than in raw ΔE. */
  var CAST_FLOOR = 6;
  var CAST_TRIES = 12;

  /* One item: true surface colour C (a reflectance) + one coloured
     light over the whole scene. t 0→1 ramps difficulty: the light
     gets stronger (amp) while C loses chroma — a bigger cast to
     discount against a weaker anchor. Integer HSL means an exact
     slider match (and so a 100) is always possible. The light hue
     stays ≥ 55° from C's hue so the cast never masquerades as the
     patch itself. Anchors — a white card, a grey block, one off-hue
     object — share the light: read the light off them, subtract it. */
  function genItem(t, rnd) {
    function ri(lo, hi) { return Math.round(lo + rnd() * (hi - lo)); }
    function candidate() {
      var cH = ri(0, 359);
      var off = ri(lerp(55, 120, t), lerp(120, 175, t));
      var sign = rnd() < 0.5 ? -1 : 1;
      return {
        c: { h: cH, s: ri(lerp(56, 30, t), lerp(68, 42, t)), l: ri(42, 64) },
        light: {
          h: ((cH + sign * off) % 360 + 360) % 360,
          amp: lerp(0.22, 0.46, t) * (0.9 + 0.2 * rnd()),
        },
        bg: { h: ri(0, 359), s: ri(6, 16), l: ri(64, 76) },
        anchors: [
          { h: 0, s: 0, l: ri(93, 97) },                                 /* white card   */
          { h: 0, s: 0, l: ri(48, 60) },                                 /* grey block   */
          { h: (cH + ri(140, 220)) % 360, s: ri(45, 60), l: ri(45, 60) },/* off-hue prop */
        ],
      };
    }
    /* how far this light drags the patch away from its true colour */
    function cast(it) {
      return deltaE76(litRgb(it.c, lightGains(it.light.h, it.light.amp)), hslToRgb(it.c));
    }
    var best = candidate(), bestCast = cast(best);
    for (var i = 0; i < CAST_TRIES && bestCast < CAST_FLOOR; i++) {
      var next = candidate(), nextCast = cast(next);
      if (nextCast > bestCast) { best = next; bestCast = nextCast; }
    }
    return best;
  }

  /* WHERE THE SLIDERS OPEN. A fixed teal meant every item began by
     hunting a colour from nowhere, four times a round, and taught
     nothing. Opening on what the patch LOOKS like makes the job read as
     "move away from what you see" — which IS the lesson — but the lit
     appearance on its own would be a free 79/100 for pressing lock
     immediately. So the opening is pushed further along the light's own
     direction (the same cast, laid on again, at the seen lightness)
     until it sits at least START_MIN_DE from the truth: recognisable as
     "what you see, if anything more so", and provably worse than an
     honest copy would be. */
  var START_MIN_DE = 30;
  var START_PUSH_TRIES = 8;
  var START_FALLBACK_DEG = 42;

  function startHslFor(it) {
    if (!it) return { h: START_HSL.h, s: START_HSL.s, l: START_HSL.l };
    var gains = lightGains(it.light.h, it.light.amp);
    var seen = rgbToHsl(litRgb(it.c, gains));
    var cur = { h: seen.h, s: seen.s, l: seen.l }, next, guard = 0;
    function off() { return deltaE76(hslToRgb(cur), hslToRgb(it.c)); }
    while (guard < START_PUSH_TRIES && off() < START_MIN_DE) {
      next = rgbToHsl(litRgb(cur, gains));
      /* hold the seen lightness: repeated gains would walk it to black */
      cur = { h: next.h, s: next.s, l: seen.l };
      guard += 1;
    }
    if (off() < START_MIN_DE) {
      /* this light barely bit the patch — step the hue away from the
         answer so the opening can never be a free score */
      var dir = signedHueDiff(cur.h, it.c.h) >= 0 ? 1 : -1;
      cur.h = ((cur.h + dir * START_FALLBACK_DEG) % 360 + 360) % 360;
    }
    return cur;
  }

  /* ============================================================
     DOM wiring
     ============================================================ */

  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  var wrap = document.getElementById('ccWrap');
  var ctxField = document.getElementById('ccCtx');
  var neuField = document.getElementById('ccNeu');
  var ctxTrue = document.getElementById('ccCtxTrue');
  var ctxYours = document.getElementById('ccCtxYours');
  var neuYours = document.getElementById('ccNeuYours');
  var neuTrue = document.getElementById('ccNeuTrue');
  var ctxCap = document.getElementById('ccCtxCap');
  var ctxTag = document.getElementById('ccCtxTag');
  var readout = document.getElementById('ccReadout');
  var btnLock = document.getElementById('btnLock');
  var btnRound = document.getElementById('btnRound');
  var slH = document.getElementById('slH');
  var slS = document.getElementById('slS');
  var slL = document.getElementById('slL');
  var vaH = document.getElementById('vaH');
  var vaS = document.getElementById('vaS');
  var vaL = document.getElementById('vaL');
  var sliders = [slH, slS, slL];
  var nudges = document.querySelectorAll('.cc-nudge');
  var anchorEls = [
    document.getElementById('anch0'),
    document.getElementById('anch1'),
    document.getElementById('anch2'),
  ];

  ArtDaily.init({ slug: SLUG });

  function css(rgb) { return 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')'; }

  /* WHAT A REPAINT COSTS ON THE DEVICE THAT NEEDS IT MOST.
     paint() runs on every `input` event AND on every step of a held ±
     stepper — NUDGE_FAST_MS is 26ms, so about 38 times a second, on the
     phone the walk was added for. Almost none of what it rewrote could
     have moved: seven of the nine chips are painted from the ITEM (the
     scene, the patch, the three anchors, the true colour), and the hue
     track's thirteen stops are painted at the CURRENT sat/light — so a
     hue walk rebuilt a ~430-character gradient string and re-assigned
     twelve inline backgrounds, 38 times a second, to arrive at pixels
     that were already there. Every one of those writes marks the element
     style-dirty, and three of them are gradient tracks the compositor
     then re-rasterises across the full width of the row.
     The guard below is deliberately the DUMB kind: every value is still
     computed and compared on every call, and only the assignment is
     skipped, so a stale frame is not expressible. The one memo with a key
     is the hue gradient, whose inputs are exactly and only sat + light.
     Measured over one honest item's worth of held steppers — 90 hue steps
     then 20 sat then 20 light: 1560 inline style writes → 528, 260 text
     writes → 2, 3250 hslToRgb calls → 2093, with the final painted state
     identical on every node through the reveal flip, a theme repaint and
     the next item. Nothing about WHAT is painted moves. */
  /* The last value WE wrote, parked on the node itself rather than in a
     map keyed by id — every element here has one today, but a cache that
     silently merges two id-less nodes under the same `undefined` key is
     the kind of thing that only shows up as one chip painting another
     chip's colour. Nothing else in this drill writes these inline
     styles, so what we last wrote is what is on screen. */
  function setBg(el, val) {
    if (!el || el.ccBg === val) return;
    el.ccBg = val;
    el.style.background = val;
  }
  function setText(el, val) {
    if (!el || el.ccTxt === val) return;
    el.ccTxt = val;
    el.textContent = val;
  }
  var hueTrackKey = null, hueTrackCss = '';

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, items = [], itemScores = [], phase = 'idle';
  var player = { h: START_HSL.h, s: START_HSL.s, l: START_HSL.l };
  var lastDE = 0, lastScore = 0, lastD = null, lastLeft = 0;
  var roundDeltas = [], roundBias = null;

  /* ---- painting (all generated colours applied inline here; theme-
     dependent inks live in css/style.css as tokens, so theme flips
     recolour the chrome without JS) ---- */
  function paint() {
    var it = items[itemIdx];
    var mine = hslToRgb(player);
    var reveal = phase === 'reveal' || phase === 'done';

    setBg(neuField, css(NEUTRAL));
    setBg(neuYours, css(mine));
    if (it) {
      /* the reveal switches the light OFF — every surface repaints
         as pure reflectance and the cast falls away */
      var gains = reveal ? NEUTRAL_GAINS : lightGains(it.light.h, it.light.amp);
      setBg(ctxField, css(litRgb(it.bg, gains)));
      setBg(ctxTrue, css(litRgb(it.c, gains)));
      setBg(ctxYours, css(mine)); /* only shown on reveal, under neutral light */
      for (var ai = 0; ai < anchorEls.length; ai++) {
        setBg(anchorEls[ai], css(litRgb(it.anchors[ai], gains)));
      }
      setBg(neuTrue, css(hslToRgb(it.c)));
      setText(ctxCap, reveal
        ? 'the ' + hueName(it.light.h) + ' light switched off — true colours'
        : 'the scene — one coloured light over everything');
      /* "true" during play would be a lie: on that side the patch is
         showing its LIT appearance. It is only the true colour once the
         light goes off. */
      setText(ctxTag, reveal ? 'true colour' : 'the patch');
    }

    /* slider tracks follow the player's colour so the search is
       honest — including the hue track, at the CURRENT sat/light.
       That track is the only build worth memoising: thirteen stops, and
       its inputs are exactly sat and light, so a hue walk (which moves
       neither) reuses the identical string it just made. */
    var hueKey = player.s + ',' + player.l;
    if (hueKey !== hueTrackKey) {
      hueTrackKey = hueKey;
      var hueStops = [];
      for (var h = 0; h <= 360; h += 30) {
        hueStops.push(css(hslToRgb({ h: h, s: player.s, l: player.l })));
      }
      hueTrackCss = 'linear-gradient(to right,' + hueStops.join(',') + ')';
    }
    setBg(slH, hueTrackCss);
    setBg(slS, 'linear-gradient(to right,' +
      css(hslToRgb({ h: player.h, s: 0, l: player.l })) + ',' +
      css(hslToRgb({ h: player.h, s: 100, l: player.l })) + ')');
    setBg(slL, 'linear-gradient(to right,' +
      css(hslToRgb({ h: player.h, s: player.s, l: 0 })) + ',' +
      css(hslToRgb({ h: player.h, s: player.s, l: 50 })) + ',' +
      css(hslToRgb({ h: player.h, s: player.s, l: 100 })) + ')');

    wrap.classList.toggle('is-reveal', reveal);

    if (reveal) {
      readout.hidden = false;
      readout.innerHTML = '';
      var strong = document.createElement('span');
      strong.className = 'cc-de'; /* accent via CSS token — AA on both themes */
      /* Lead with the lesson in words: how much of the coloured light
         the player left in their answer. The raw distance follows. */
      var left = Math.round(lastLeft);
      strong.textContent = left <= 4 && left >= -4
        ? 'you took the light off cleanly'
        : (left > 4
          ? 'you left ' + Math.min(150, left) + '% of the light in'
          : 'you over-corrected by ' + Math.min(150, -left) + '%');
      readout.appendChild(strong);
      readout.appendChild(document.createTextNode(
        ' — ' + Math.round(lastScore) + '/100 · hue ' + fmtDelta(lastD.h, '°') +
        ' · sat ' + fmtDelta(lastD.s, '') + ' · light ' + fmtDelta(lastD.l, '') +
        ' · ΔE ' + lastDE.toFixed(1)
      ));
      if (phase === 'done' && roundBias) {
        readout.appendChild(document.createElement('br'));
        readout.appendChild(document.createTextNode(
          'round bias: hue ' + fmtDelta(roundBias.h, '°') +
          ' · sat ' + fmtDelta(roundBias.s, '') +
          ' · light ' + fmtDelta(roundBias.l, '') +
          ' — how your eye leans against coloured light'
        ));
      }
    } else {
      readout.hidden = true;
    }
  }

  /* A RANGE WITH NO aria-valuetext IS READ AS A PERCENTAGE OF ITS TRACK.
     That is right for sat and light by luck and wrong for hue by a mile:
     hue 180 of 359 is announced as "50%", which is neither the number on
     screen (180°) nor a percentage of anything the player set — and hue is
     the axis this whole drill turns on. aria-valuetext replaces the
     computed reading with the real one, in the unit the visible readout
     and the ± buttons already use. Written on every sync, so the spoken
     value can never drift from the painted chip. */
  function syncSliders() {
    slH.value = String(player.h);
    slS.value = String(player.s);
    slL.value = String(player.l);
    vaH.textContent = player.h + '°';
    vaS.textContent = player.s + '%';
    vaL.textContent = player.l + '%';
    slH.setAttribute('aria-valuetext', player.h + (player.h === 1 ? ' degree' : ' degrees'));
    slS.setAttribute('aria-valuetext', player.s + ' percent');
    slL.setAttribute('aria-valuetext', player.l + ' percent');
  }

  function setAdjustEnabled(on) {
    /* a held stepper must not keep walking into a reveal it can no longer
       change — a disabled button stops sending events, not timers */
    if (!on) stopNudge();
    for (var i = 0; i < sliders.length; i++) sliders[i].disabled = !on;
    for (var j = 0; j < nudges.length; j++) nudges[j].disabled = !on;
  }

  /* ---- item / round flow ---- */
  function startItem() {
    phase = 'adjust';
    player = startHslFor(items[itemIdx]);
    syncSliders();
    setAdjustEnabled(true);
    btnLock.disabled = false;
    btnLock.textContent = 'lock it in';
    /* THE ± BUTTONS ARE THE PHONE'S ONLY EXACT CONTROL, AND THE DRILL
       ONLY EVER MENTIONED THEM IN THE HOW-TO PANEL. Measured: the hue
       track carries all 360 values, so on a phone it runs at ~1.6°/px
       against ~0.8°/px on a laptop, and a thumb landing four pixels off
       has landed six or seven degrees off — enough to cost a reader who
       understood the light perfectly around twenty points a round. The
       stepper walks and lands exactly on every device, so the one line
       that teaches the drill has to name it. Item 1 only: by item 2 the
       controls are known and the sentence is just noise in the live
       region. */
    hint.textContent = 'colour ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND +
      (itemIdx === 0
        ? ' — the card labelled “white card” is really white, so whatever colour it LOOKS is the light. Take that away from the patch and build what is left on the right. The sliders start near what you see; your job is to move away from it. The ± buttons (and the arrow keys) move a slider by exactly one — hold one down and it walks, which is how you land a hue on a small screen.'
        : ' — read the light off the white card, take it off the patch, lock in what is left.');
    paint();
  }

  function lockItem() {
    phase = 'reveal';
    var it = items[itemIdx];
    var seen = litRgb(it.c, lightGains(it.light.h, it.light.amp));
    lastDE = deltaE76(hslToRgb(player), hslToRgb(it.c));
    lastLeft = castLeftPct(hslToRgb(player), hslToRgb(it.c), seen);
    lastScore = scoreItem(constancyError(hslToRgb(player), hslToRgb(it.c), seen));
    lastD = {
      h: signedHueDiff(player.h, it.c.h),
      s: player.s - it.c.s,
      l: player.l - it.c.l,
    };
    itemScores.push(lastScore);
    roundDeltas.push(lastD);
    /* running round average keeps the round legible mid-flight */
    hudScore.textContent = String(Math.round(scoreRound(itemScores)));
    setAdjustEnabled(false);
    btnLock.textContent = (itemIdx + 1 < ITEMS_PER_ROUND) ? 'next colour →' : 'finish round ✓';
    /* The hint is the drill's live region, so the item's own result has to
       reach it: the readout under the chips is unhidden and rewritten in
       the same task, which is exactly the update a screen reader is least
       likely to announce, and the toast only speaks at the end of a round.
       Leading with the number also means the score is not something you
       have to find in small print. */
    hint.textContent = Math.round(lastScore) + '/100 — the ' + hueName(it.light.h) +
      ' light is off, so the same two colours sit on both fields now.';
    paint();
  }

  /* Disabling the control that was just pressed drops keyboard focus onto
     <body>: the next Tab restarts from the top of the document, past the
     back link and the theme toggle, before it reaches anything playable.
     So hand focus to whatever the player's next move actually is. */
  function handFocus(from, to) {
    if (!from || !to || document.activeElement !== from) return;
    try { to.focus({ preventScroll: true }); } catch (e) { try { to.focus(); } catch (e2) {} }
  }

  function finishRound() {
    phase = 'done';
    handFocus(btnLock, btnRound);
    btnLock.disabled = true;
    var n = roundDeltas.length, sh = 0, ss = 0, sl = 0;
    for (var i = 0; i < n; i++) { sh += roundDeltas[i].h; ss += roundDeltas[i].s; sl += roundDeltas[i].l; }
    roundBias = n ? { h: sh / n, s: ss / n, l: sl / n } : null;
    var res = ArtDaily.report(scoreRound(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* THE HINT IS THE ONLY SPOKEN CHANNEL. The score used to reach a
       screen reader through the toast, which was its own polite region —
       so the player heard this sentence and then, queued behind it, the
       number again. The toast is a sticker now (aria-hidden, like the
       template's), which means the number has to be said HERE or not at
       all. Lead with it, the way the sibling reveal line already does. */
    hint.textContent = (res.isNewBest ? 'New best! ' : 'Round done — ') + res.score +
      '/100. The bias line under the chips is your eye’s average lean.' +
      ' Press “new round” to go again.';
    btnRound.classList.add('btn-primary');
    showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
    paint();
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    itemScores = [];
    roundDeltas = [];
    roundBias = null;
    items = [];
    for (var i = 0; i < ITEMS_PER_ROUND; i++) {
      items.push(genItem(i / (ITEMS_PER_ROUND - 1), Math.random));
    }
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    /* mid-round, "lock it in" is the only primary action */
    btnRound.classList.remove('btn-primary');
    startItem();
  }

  /* ---- input ---- */
  function onSlide() {
    if (phase !== 'adjust') return;
    player = {
      h: parseInt(slH.value, 10) || 0,
      s: parseInt(slS.value, 10) || 0,
      l: parseInt(slL.value, 10) || 0,
    };
    syncSliders();
    paint();
  }
  for (var si = 0; si < sliders.length; si++) sliders[si].addEventListener('input', onSlide);

  /* ±1 nudge steppers — exact landings without thumb-luck on touch.

     THE HUE AXIS IS NOT THE SAME SIZE ON EVERY MACHINE. All three
     sliders are the same width, but hue carries 360 values across it and
     sat/light carry 100. On a laptop that track is ~436px (0.82°/px); on
     a 360px phone it is ~230px, so one pixel of thumb travel is ~1.6° and
     a finger that lands 4px off has landed 6° off. Both are recoverable
     — the ±1 button is exact on every device — but at one tap per degree
     the phone player was paying six taps per axis per item for hardware
     alone. Measured: a player who read the light PERFECTLY and missed
     only by where their finger landed scored a mean 74.6 on a phone
     against 96.2 on a trackpad.
     So the stepper walks while it is held: a tap is still exactly ±1,
     and a hold rolls the value at NUDGE_RATE_MS, quickening after
     NUDGE_QUICKEN_AT steps so a long haul on the hue axis is a hold and
     not a drum solo. Nothing about the scoring moves — this buys back
     the taps, it does not widen a tolerance. */
  var NUDGE_DELAY_MS = 340;     /* held this long before it starts walking */
  var NUDGE_RATE_MS = 60;       /* one step per this while held           */
  var NUDGE_FAST_MS = 26;       /* …and this once it is clearly a haul    */
  var NUDGE_QUICKEN_AT = 8;
  var nudgeTimer = null, nudgeReps = 0;

  function stepNudge(btn) {
    if (phase !== 'adjust' || !btn || !btn.dataset) return false;
    var k = btn.dataset.k;
    var d = parseInt(btn.dataset.d, 10) || 0;
    if (k === 'h') player.h = ((player.h + d) % 360 + 360) % 360;
    else if (k === 's' || k === 'l') {
      /* A press that cannot move the value must report that it did
         nothing, or it arms a walk that repaints both fields and all
         three gradient tracks every NUDGE_FAST_MS for as long as a thumb
         rests on a stepper that is already at 0 or 100 — the phone is
         where the long holds happen and where that work costs most.
         Hue wraps, so only sat and light have a rail to sit on. */
      var was = player[k];
      player[k] = Math.max(0, Math.min(100, player[k] + d));
      if (player[k] === was) return false;
    } else return false;
    syncSliders();
    paint();
    return true;
  }

  function stopNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    nudgeReps = 0;
  }

  function walkNudge(btn) {
    if (!stepNudge(btn)) { stopNudge(); return; }
    nudgeReps += 1;
    nudgeTimer = setTimeout(function () { walkNudge(btn); },
      nudgeReps < NUDGE_QUICKEN_AT ? NUDGE_RATE_MS : NUDGE_FAST_MS);
  }

  function onNudgeDown(ev) {
    var btn = ev.currentTarget;
    stopNudge();
    if (!stepNudge(btn)) return;
    /* capture so a thumb that drifts a few px off the 44px button keeps
       walking instead of stopping dead mid-haul */
    try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
    nudgeTimer = setTimeout(function () { walkNudge(btn); }, NUDGE_DELAY_MS);
  }

  /* Enter/Space on a focused button fires click with detail 0; a pointer
     click carries detail ≥ 1 and was already served by onNudgeDown. Same
     test the sibling drills use to keep the two paths from doubling up. */
  function onNudgeClick(ev) {
    if (ev.detail !== 0) return;
    stepNudge(ev.currentTarget);
  }

  for (var ni = 0; ni < nudges.length; ni++) {
    nudges[ni].addEventListener('pointerdown', onNudgeDown);
    nudges[ni].addEventListener('pointerup', stopNudge);
    nudges[ni].addEventListener('pointercancel', stopNudge);
    nudges[ni].addEventListener('lostpointercapture', stopNudge);
    nudges[ni].addEventListener('click', onNudgeClick);
  }
  /* A stepper that keeps walking after the finger is gone would run the
     hue round the wheel unattended. setPointerCapture normally guarantees
     the release lands back on the button, but it can throw (and does, on
     a pointer that is already gone), so the release is caught at the
     window too — the same belt-and-braces the SDK uses for its own
     gesture counter. */
  window.addEventListener('pointerup', stopNudge, true);
  window.addEventListener('pointercancel', stopNudge, true);
  window.addEventListener('blur', stopNudge);

  /* The one primary button changes job in place (lock it in → next
     colour →), so the second click of an accidental double-click fires
     the NEW action: it starts the next colour and takes the reveal —
     the light switched off, the two fields side by side, the whole
     lesson — with it. Ignore a repeat inside the guard window. */
  var ACTION_GUARD_MS = 250;
  var actionAt = 0;
  btnLock.addEventListener('click', function () {
    var now = Date.now();
    if (now - actionAt < ACTION_GUARD_MS) return;
    actionAt = now;
    if (phase === 'adjust') { lockItem(); return; }
    if (phase !== 'reveal') return;
    if (itemIdx + 1 < ITEMS_PER_ROUND) { itemIdx += 1; startItem(); }
    else { finishRound(); }
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

  /* ---- chrome wiring ----
     A mid-round misclick must never silently eat locked work, but a
     native confirm() is a jarring OS box inside the hub's iframe player.
     Same inline two-press confirm the sibling drill uses instead. */
  /* ARMING WAS INVISIBLE TO ANYONE NOT WATCHING THE BUTTON. The only
     signal that the first press had armed anything was the button's own
     label — and an accessible name that changes under a focused button is
     not re-announced by any screen reader. So the press read as "nothing
     happened", and a player who then waited out the window pressed again,
     re-armed, heard nothing again, and could never reach a new round at
     all. The hint is this drill's live region, so the arming is said
     there; the line it replaced goes back when the arming lapses, unless
     something newer (a lock, a finished round) has already claimed it.
     The window matches the sibling drill that already did this — 2.6s is
     not long enough for a polite announcement to finish and still leave
     time to press. */
  var CONFIRM_MS = 4500;
  var roundBtnHtml = btnRound.innerHTML;
  var confirmTimer = null, confirmSaid = '', hintBeforeConfirm = '';
  function disarmConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    btnRound.innerHTML = roundBtnHtml;
    if (confirmSaid && hint.textContent === confirmSaid) hint.textContent = hintBeforeConfirm;
    confirmSaid = '';
  }
  btnRound.addEventListener('click', function () {
    var midRound = phase !== 'done' && itemScores.length > 0;
    if (midRound && confirmTimer === null) {
      btnRound.textContent = 'start over? press again';
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

  ArtDaily.onTheme(paint);
  window.addEventListener('resize', paint);

  /* ---- boot ---- */
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
