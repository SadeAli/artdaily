/* ============================================================
   game.js — Sun & Sky.

   A ball under a sky. Beginners paint a shadow as the same colour,
   darker — and the picture goes dead, because a form outdoors is lit
   by TWO lights: the sun, which is warm, and the whole sky, which is
   cool. The shadow side is not "darker", it is the SKY's colour
   filtered through the ball's own. This drill asks for exactly that
   one judgement: drag the rail until the ball's shade is the colour
   that sky would make it, then paint it. Four balls, then a score.

   Real light, not a flat guess. The ball is a real sphere of flat
   facets with real normals, lit by a real directional key
   (max(0, n·L)) and a real hemispheric sky fill (0.5 + 0.5·n·up),
   composited in LINEAR RGB and encoded to sRGB once at the end — so
   the ground truth is correct by construction and the reveal is the
   picture, not an approximation of one.

   The scene — sky band, sun, ground and the ball's cast shadow — is
   always painted with the TRUE light. That is deliberate: the cast
   shadow on the ground is lit by the sky ALONE, so it is the anchor a
   player learns to read the answer off, and it is not a giveaway
   because the ground's own colour is not the ball's. Only the ball
   wears the player's setting, and it repaints live under the drag.

   Skeleton kept from the template: init → round → input → REVEAL →
   score → ArtDaily.report, one report per finished round on every
   path.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'sun-and-sky';
  var ITEMS_PER_ROUND = 4;
  var TAU = Math.PI * 2;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnSet = document.getElementById('btnSet');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     PURE COLOUR + LIGHT — data in, numbers out, no canvas, no DOM.
     Lifted straight into node by the harness in the scratchpad; every
     one of them is total, because all of them run inside draw(),
     which runs inside the pointer handler: a throw here would not
     garble a colour, it would stop the canvas painting and leave the
     round dead under the player's finger.

     Everything composites in LINEAR light and is encoded to sRGB
     exactly once, at the moment a colour becomes a CSS string. Mixing
     the two spaces is what makes hand-rolled shading look like a
     screen-space tint instead of light.
     ============================================================ */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Rec.709 relative luminance of a LINEAR triple — the "how much
     light" of a colour, with its hue divided out. The fill light's
     whole rail is normalised to a constant one, so dragging changes
     the sky's COLOUR and never its strength: a temperature axis that
     also brightened would be scoreable by value, which is a different
     drill (there are five of those in the arcade already). */
  function lum(c) {
    if (!c) return 0;
    var r = Number(c.r), g = Number(c.g), b = Number(c.b);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return 0;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function rgb(r, g, b) { return { r: r, g: g, b: b }; }
  function mixRgb(a, b, t) {
    return rgb(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  }
  function scaleRgb(c, k) { return rgb(c.r * k, c.g * k, c.b * k); }
  function mulRgb(a, b) { return rgb(a.r * b.r, a.g * b.g, a.b * b.b); }

  /* The one axis this drill is about, as a colour. t runs -1 (a deep
     blue sky) → 0 (a colourless white) → +1 (a low sun's amber). Both
     ends are real daylight measurements rounded to something a screen
     can show, not arbitrary blue and orange. */
  var COOL = rgb(0.42, 0.62, 1.00);
  var WARM = rgb(1.00, 0.62, 0.30);
  var WHITE = rgb(1, 1, 1);
  var T_MIN = -1, T_MAX = 1, T_SPAN = 2;

  function clampT(t) {
    var v = Number(t);
    if (!isFinite(v)) return 0;
    return v < T_MIN ? T_MIN : v > T_MAX ? T_MAX : v;
  }

  function tintRgb(t) {
    var v = clampT(t);
    return v < 0 ? mixRgb(WHITE, COOL, -v) : mixRgb(WHITE, WARM, v);
  }

  /* Re-weight a colour to an exact luminance. A zero-luminance input
     (black, or junk) comes back as the neutral of that luminance
     rather than as a division by zero. */
  function atLum(c, Y) {
    var y = Number(Y);
    if (!isFinite(y) || y < 0) y = 0;
    var l = lum(c);
    if (!(l > 0)) return rgb(y, y, y);
    return scaleRgb(c, y / l);
  }

  /* How much light each source carries. The key is bright enough to
     make a real light side; the fill is a third of it, which is about
     what an open sky actually gives a form on a clear day. */
  var KEY_Y = 0.92, FILL_Y = 0.30;
  function keyLight(kt) { return atLum(tintRgb(kt), KEY_Y); }
  function fillLight(t) { return atLum(tintRgb(t), FILL_Y); }

  function unit(v) {
    if (!v) return rgb(0, 0, 1);
    var x = Number(v.x), y = Number(v.y), z = Number(v.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return { x: 0, y: 0, z: 1 };
    var m = Math.sqrt(x * x + y * y + z * z);
    if (!(m > 1e-9)) return { x: 0, y: 0, z: 1 };
    return { x: x / m, y: y / m, z: z / m };
  }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  /* THE LIGHT MODEL, and the ground truth of the whole drill.
     radiance = albedo ⊙ ( key·max(0, n·L)  +  fill·(0.5 + 0.5·n·up) )
     The first term is Lambert against the real light vector. The
     second is a hemisphere fill: a surface facing straight up sees the
     whole sky (1.0), one facing straight down sees none of it (0.0),
     and the shadow side of a ball sits in between — which is exactly
     why a shadow is the sky's colour and not black. Total: junk in,
     black out, never a throw and never NaN into a fillStyle. */
  function surfaceRgb(albedo, n, L, key, fill) {
    if (!albedo || !n || !L || !key || !fill) return rgb(0, 0, 0);
    var nn = unit(n), ll = unit(L);
    var k = dot(nn, ll);
    if (!isFinite(k) || k < 0) k = 0;
    var sky = 0.5 + 0.5 * nn.y;
    if (!isFinite(sky)) sky = 0.5;
    var out = mulRgb(albedo, rgb(key.r * k + fill.r * sky,
                                 key.g * k + fill.g * sky,
                                 key.b * k + fill.b * sky));
    if (!isFinite(out.r) || !isFinite(out.g) || !isFinite(out.b)) return rgb(0, 0, 0);
    return out;
  }

  /* WHERE THE RAIL TAKES ITS COLOUR FROM.
     The rail claims to show "the colours this shade could be", so its
     sample has to be a point the key light does NOT reach — for every
     light direction the drill can generate, not just the average one.
     Built by hand it was not: `-L·0.92 + up·0.34 + view·0.46` reads as
     "behind the terminator" and is, for a low side light, but for a
     light close to the eye (Lz 0.82, Ly 0.37) it came out at n·L =
     +0.19 — a LIT point, so the rail would have been showing the sun's
     colour on a scale that is about the sky.
     So: turn fully away from the light in the view plane, then tilt a
     little up into the sky and a little toward the eye — dark, but not
     the near-black of the rim, and visible (n.z > 0). n·L stays under
     −0.2 across the whole generator, which the node harness sweeps. */
  function shadeNormal(L) {
    var l = unit(L);
    var hx = l.x, hy = l.y;
    var h = Math.sqrt(hx * hx + hy * hy);
    if (!(h > 1e-6)) { hx = 1; hy = 0; h = 1; }   /* a light straight at the eye */
    return unit({ x: -0.95 * hx / h, y: -0.95 * hy / h + 0.35, z: 0.22 });
  }

  /* linear light → an sRGB byte, the one place the transfer curve is
     applied. clamp01 first: a clipped highlight is white, never a
     wrapped-around number. */
  function lin2byte(y) {
    var v = Number(y);
    if (!isFinite(v)) return 0;
    v = clamp01(v);
    var u = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(clamp01(u) * 255);
  }

  function cssOf(c) {
    if (!c) return 'rgb(0,0,0)';
    return 'rgb(' + lin2byte(c.r) + ',' + lin2byte(c.g) + ',' + lin2byte(c.b) + ')';
  }
  function cssOfA(c, a) {
    var al = Number(a);
    if (!isFinite(al)) al = 1;
    if (!c) return 'rgba(0,0,0,' + clamp01(al) + ')';
    return 'rgba(' + lin2byte(c.r) + ',' + lin2byte(c.g) + ',' + lin2byte(c.b) + ',' + clamp01(al) + ')';
  }

  /* A mark drawn ON a generated colour cannot take its contrast from
     the theme — the backdrop is the artwork, and the artwork moves.
     So pick the ink from the backdrop's own luminance. The threshold
     is where the two candidates are equally readable:
       white on Y  →  (0.95+0.05)/(Y+0.05)
       black on Y  →  (Y+0.05)/(0.006+0.05)
     which cross at Y ≈ 0.187, and the WORST case anywhere on the
     scale is 4.23:1 — comfortably over the 3:1 a mark that carries
     information owes, and over 4.5:1 for most of the range. */
  var INK_DARK = '#14100C', INK_LIGHT = '#FBF7EE';
  function inkOn(c) {
    return lum(c) > 0.187 ? INK_DARK : INK_LIGHT;
  }

  /* ============================================================
     SCORING — pure functions, at the top of the file so they can be
     lifted into node and hammered with degenerate input. The two
     rules they hold whatever the drill:
       · finite 0–100 for ANY input. Never NaN, never a throw.
       · monotonic in the error: more wrong can never score higher.
     ============================================================ */

  /* 100 for the exact colour, 0 at `zero` of temperature out or
     beyond. `zero` comes from zeroPoint(), which runs the tolerance
     through ArtDaily.ease() — never a raw constant. */
  function shadeAccuracy(dt, zero) {
    if (!isFinite(dt) || !isFinite(zero) || zero <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - Math.abs(dt) / zero) * 100));
  }

  /* Mean of the round's balls. A round that somehow ends with nothing
     recorded scores 0 rather than 0/0 = NaN. */
  function roundScore(accuracies) {
    if (!accuracies || !accuracies.length) return 0;
    var sum = 0;
    for (var i = 0; i < accuracies.length; i++) {
      var a = Number(accuracies[i]);
      sum += isFinite(a) ? Math.max(0, Math.min(100, a)) : 0;
    }
    return sum / accuracies.length;
  }

  /* ONE ladder of sizes for the whole drill — the per-item words and
     the round's correction are cut at the SAME fractions of the SAME
     tolerance, so a player learns what "a little" is worth once.

     Cut where the SCORE changes character, not at tidy fractions of
     the tolerance: the adjective is printed in the same sentence as
     the number, and "A hair too warm — 71 out of 100" reads as the
     drill lying to you. Score is 100 − 100·d/z, so these edges are, as
     scores: 92+ dead on · 75+ a hair · 50+ a little · 20+ a good way ·
     under 20 a long way.

     The two widest rungs are "a good way" / "a long way" rather than
     the template's bare "well" / "way" because this drill spends the
     ladder in two grammatical slots and both have to read as English:
       "A good way too warm — 31 out of 100 for that shade."
       "…go a long way cooler next round."
     Same ladder, same cuts, same five rungs; only the words are
     chosen to survive both sentences. Total: junk in, the WIDEST
     usable word out, never the flattering one — "dead on" printed
     beside a 12 reads as the drill being broken, which it would be. */
  function sizeWord(d, z) {
    var m = Number(d), t = Number(z);
    /* A magnitude is never negative, so a negative one means the
       caller handed over a signed delta by mistake — answer with a
       wide word, not a flattering one. */
    if (!isFinite(m) || m < 0 || !isFinite(t) || t <= 0) return 'a good way';
    if (m <= t * 0.08) return 'dead on';
    if (m <= t * 0.25) return 'a hair';
    if (m <= t * 0.5) return 'a little';
    if (m < t * 0.8) return 'a good way';
    return 'a long way';
  }

  /* Which way the miss went, in the drill's own two words. dt is the
     player's setting minus the truth, so a positive dt is too warm. */
  function tempSide(dt) {
    var v = Number(dt);
    if (!isFinite(v) || v === 0) return '';
    return v > 0 ? 'too warm' : 'too cool';
  }

  /* The per-item reveal, in words. Graded against the SAME zero-point
     the score uses, so the sentence and the number can never disagree.
     Total — NaN, a zero tolerance and an exact hit all come back a
     usable sentence. */
  function missPhrase(dt, zero) {
    var d = Math.abs(Number(dt));
    if (!isFinite(d)) return 'Off the mark';
    var z = (isFinite(zero) && zero > 0) ? zero : 1;
    var much = sizeWord(d, z);
    if (much === 'dead on') return 'Dead on';
    var side = tempSide(dt);
    var lead = much.charAt(0).toUpperCase() + much.slice(1);
    return side ? lead + ' ' + side : lead + ' out';
  }

  /* The words and the number always travel TOGETHER, in that order: a
     number alone cannot be placed on any scale, and words alone cannot
     be compared to the HUD. Total — a non-finite accuracy drops the
     number rather than reading "NaN out of 100" out loud. */
  function itemWords(words, acc) {
    /* Only a real, non-empty STRING counts as words: [] and {} are
       truthy, so `String(x || fallback)` prints "" and
       "[object Object]" into a line that gets read aloud. */
    var head = (typeof words === 'string' && words.trim()) ? words : 'Off the mark';
    var n = Number(acc);
    if (!isFinite(n)) return head;
    return head + ' — ' + Math.round(Math.max(0, Math.min(100, n))) + ' out of 100 for that shade';
  }

  /* ---- the round's lesson, which no single ball can show ----
     Four shades that all came out too warm are not four misses, they
     are one habit — the commonest one in the whole subject, because
     "shadow = the colour, darker" pulls every shade toward the warm,
     neutral middle. Naming it is the only correction that outlives the
     round. Fires only on a lean that is BOTH consistent (most items on
     the same side) and worth acting on (a tenth of the tolerance), so
     it can never invent a pattern out of noise. Pure and total: junk
     offsets, a short round and a zero tolerance all come back a string
     — '' meaning "there is nothing honest to say", which the caller
     must treat as silence rather than print. */
  function roundBias(diffs, zero) {
    if (!diffs || !diffs.length) return '';
    var z = (isFinite(zero) && zero > 0) ? zero : 1;
    var n = 0, sum = 0, warm = 0, cool = 0;
    for (var i = 0; i < diffs.length; i++) {
      var d = Number(diffs[i]);
      if (!isFinite(d)) continue;
      n++; sum += d;
      if (d > 0) warm++; else if (d < 0) cool++;
    }
    if (n < 3) return '';            /* too few to call anything a habit */
    var m = sum / n;
    if (!(Math.abs(m) >= z * 0.1)) return '';
    var most = Math.max(2, Math.ceil(n * 0.6));
    /* The count must be on the SAME side as the mean, or two wild
       misses one way outvote three small ones the other and the
       sentence points backwards. */
    var side = m > 0 ? 'warm' : 'cool';
    if ((m > 0 ? warm : cool) < most) return '';
    var fix = m > 0 ? 'cooler' : 'warmer';
    /* HOW FAR, in the same five words the round's reveals just spent
       teaching. A direction with no size is not something a hand can
       execute, so the player invents one — and an invented correction
       is how a lean becomes an overcorrection. The gate above is a
       tenth of the tolerance and the ladder's top rung is a twelfth,
       so this can never come back "go dead on cooler". */
    return 'Most of your shades came out too ' + side + ' — go ' +
           sizeWord(Math.abs(m), z) + ' ' + fix + ' next round.';
  }

  /* ---- a temperature in words (pure, total) ----
     The canvas is the whole drill, and a canvas is a blank to anyone
     who cannot see it. This feeds the sheet's accessible name, and it
     is what makes the drill playable from the keyboard: the name says
     what sky is up there and what the rail is currently set to, so a
     player who never sees a pixel can still aim. Junk comes back
     "neutral", never NaN. */
  function tempName(t) {
    var v = Number(t);
    if (!isFinite(v)) return 'neutral';
    var a = Math.abs(v);
    if (a < 0.08) return 'neutral';
    var dir = v < 0 ? 'cool' : 'warm';
    if (a < 0.3) return 'slightly ' + dir;
    if (a < 0.62) return dir;
    return 'strongly ' + dir;
  }

  /* ============================================================
     THE SPHERE — real geometry, built once.
     A lat/long grid of flat facets on the unit sphere; each facet's
     normal is its own outward direction, so the shading is honest
     per facet rather than a gradient painted to look like light.
     Sorted back-to-front by n.z: for a sphere the facet centre is the
     normal times a constant, so that IS a correct painter's order for
     this fixed camera, and the ball can never paint a back facet over
     a front one. Flat facets also stay crisp at any devicePixelRatio,
     which a per-pixel render scaled up would not.
     ============================================================ */
  var NLAT = 13, NLON = 24;
  var FACETS = (function buildSphere() {
    var out = [];
    function p(th, ph) {
      var st = Math.sin(th);
      return { x: st * Math.cos(ph), y: Math.cos(th), z: st * Math.sin(ph) };
    }
    for (var i = 0; i < NLAT; i++) {
      var t0 = i * Math.PI / NLAT, t1 = (i + 1) * Math.PI / NLAT;
      for (var j = 0; j < NLON; j++) {
        var f0 = j * TAU / NLON, f1 = (j + 1) * TAU / NLON;
        var v = [p(t0, f0), p(t0, f1), p(t1, f1), p(t1, f0)];
        var n = unit({
          x: (v[0].x + v[1].x + v[2].x + v[3].x) / 4,
          y: (v[0].y + v[1].y + v[2].y + v[3].y) / 4,
          z: (v[0].z + v[1].z + v[2].z + v[3].z) / 4,
        });
        out.push({ n: n, v: v });
      }
    }
    out.sort(function (a, b) { return a.n.z - b.n.z; });
    return out;
  })();

  /* ============================================================
     THE ROUND'S SCENES
     Every item is a real lighting set-up: a sky temperature (the
     answer), a sun temperature, the ball's own colour and the
     ground's. Nothing here is in pixels, so a phone rotated mid-item
     re-fits the picture and leaves the answer exactly where it was.
     ============================================================ */
  var SKIES = [
    { id: 'noon',    t: -0.80, kt: 0.20, haze: 0.0 },
    { id: 'alpine',  t: -0.95, kt: 0.35, haze: 0.0 },
    { id: 'overcast', t: -0.28, kt: -0.05, haze: 1.0 },
    { id: 'northlight', t: -0.52, kt: 0.10, haze: 0.7 },
    { id: 'hazewarm', t: 0.18, kt: 0.55, haze: 0.8 },
    { id: 'golden',  t: 0.48, kt: 0.95, haze: 0.2 },
    { id: 'afterglow', t: 0.78, kt: 0.85, haze: 0.5 },
  ];
  /* The ball's own colour. Item one is the near-neutral one on
     purpose: with a grey ball the shade is the sky's colour almost
     undisguised, which is the clearest possible first look at the
     lesson. The saturated ones come later — that is the ramp, and it
     lives INSIDE the round. */
  var BALLS = [
    { id: 'grey',  c: rgb(0.62, 0.60, 0.57), name: 'a pale grey ball' },
    { id: 'ochre', c: rgb(0.66, 0.44, 0.16), name: 'an ochre ball' },
    { id: 'terra', c: rgb(0.55, 0.22, 0.15), name: 'a terracotta ball' },
    { id: 'sage',  c: rgb(0.42, 0.50, 0.34), name: 'a sage-green ball' },
    { id: 'cream', c: rgb(0.74, 0.68, 0.52), name: 'a cream ball' },
    { id: 'slate', c: rgb(0.30, 0.34, 0.42), name: 'a slate-blue ball' },
  ];
  var GROUNDS = [
    rgb(0.46, 0.42, 0.31),
    rgb(0.40, 0.41, 0.38),
    rgb(0.52, 0.47, 0.39),
  ];

  function pick(list) { return list[Math.floor(Math.random() * list.length) % list.length]; }

  /* A light direction with the sun up, off to one side, and mostly
     behind the viewer's shoulder — the arrangement that leaves a
     readable shadow side on a ball without hiding the light side. */
  function lightDir() {
    var side = Math.random() < 0.5 ? -1 : 1;
    return unit({
      x: side * (0.40 + Math.random() * 0.35),
      y: 0.34 + Math.random() * 0.34,
      z: 0.45 + Math.random() * 0.30,
    });
  }

  function makeItem(sky, ball, idx) {
    var L = lightDir();
    return {
      sky: sky,
      tTrue: sky.t,
      key: keyLight(sky.kt),
      kt: sky.kt,
      L: L,
      albedo: ball.c,
      ballName: ball.name,
      ground: idx === 0 ? GROUNDS[0] : pick(GROUNDS),
      /* the one real point on the ball the rail's swatches are taken
         from — always in shadow, whatever the light does */
      nShade: shadeNormal(L),
    };
  }

  /* The first item of a round is the easy one: the deepest blue sky in
     the pool on the least coloured ball. A cold beginner's first look
     at the lesson should be the one where it is impossible to miss
     that the shade is BLUE; the subtle skies and the saturated balls
     come after. */
  function buildRound() {
    var rest = SKIES.slice(1);
    for (var i = rest.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    var balls = BALLS.slice(1);
    for (var k = balls.length - 1; k > 0; k--) {
      var m = Math.floor(Math.random() * (k + 1));
      var t2 = balls[k]; balls[k] = balls[m]; balls[m] = t2;
    }
    var items = [makeItem(SKIES[0], BALLS[0], 0)];
    for (var n = 1; n < ITEMS_PER_ROUND; n++) {
      items.push(makeItem(rest[(n - 1) % rest.length], balls[(n - 1) % balls.length], n));
    }
    return items;
  }

  /* ---- theme-aware inks (read once per THEME, not once per repaint)
     Everything inside the panel is generated colour — it IS the
     artwork, and it must look the same in both themes or the drill
     would be teaching a different answer at night. These four are for
     the marks AROUND it: the rail, its labels, the truth marker. Read
     per theme because the only thing that moves them is data-theme,
     and getPropertyValue cannot answer until style has been resolved —
     a read per repaint flushes a style recalculation in the middle of
     a drag, which is exactly where a player feels the hand stop being
     listened to. An empty read (cold boot, stylesheet not parsed) is
     never cached, so the next repaint corrects it. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim();
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
    if (w === W && dpr === lastDpr) return false;   /* a phone's URL bar fires resize constantly */
    W = w;
    H = Math.max(1, Math.round(W * 0.62));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ----
     Nothing here is in pixels. The answer is a temperature, the
     attempt is a temperature and the tolerance is a temperature, so a
     phone rotated mid-item — or mid-REVEAL, which stays on screen
     until "new round" — re-fits the picture without moving anything
     the score was measured with. The rail is a straight map from t to
     x, so the attempt and the truth re-project at the same rate and
     the gap on screen always tells the same story as the number
     printed under it. */
  var round = 0, itemIdx = 0, scores = [], diffs = [];
  var item = null, roundItems = [], shadeT = 0, touched = false;
  var playing = false, phase = 'aim';   /* 'aim' | 'reveal' | 'done' */

  var reveal = null, revealTimer = null;
  /* How many reveals this SITTING has shown. NEVER reset by
     newRound(): the screen that needs the long beat and the one-off
     naming of the tolerance band is the player's FIRST reveal, which
     is not round one's first item the moment they press the big
     primary button before setting anything — the likeliest thing a
     beginner does with a control they do not understand yet. */
  var revealsSeen = 0;
  /* The beat must outlast the reading. The clause that changes is
     "A little too warm — 61 out of 100 for that shade" (~1.9s at the
     ~200wpm a beginner reads unfamiliar copy at while also looking at
     a picture), and this reveal asks for a LOOK as well: two balls
     side by side to compare. On the first reveal of the sitting
     nothing is furniture yet — two balls, a band, two markers and the
     line that names the band — so the whole sentence is budgeted. */
  var REVEAL_MS = 2200;
  var FIRST_REVEAL_MS = 4600;

  /* Pure, so the pacing can be reasoned about without a canvas.
     `seen` is how many reveals this SITTING has already shown. */
  function revealBeat(seen) { return seen ? REVEAL_MS : FIRST_REVEAL_MS; }

  function clearReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    reveal = null;
  }

  /* ---- the two SDK knobs, which measure different things ----
     startRadius sizes what the hand has to ACQUIRE — the rail's
     handle. A screenless tablet aims with the hand out of sight, so it
     gets the biggest grab zone even though it is the most precise
     instrument. 22 is 44px across on a mouse, 70 on a finger and 74 on
     a pen tablet, so the touch minimum is cleared without a coarse-
     pointer floor of its own. They are never fed into each other. */
  var BASE_R = 22;
  function grabRadius() { return ArtDaily.startRadius(BASE_R); }

  /* ...and ease sizes where the SCORE runs out. What this drill grades
     is a JUDGEMENT of colour, not a hand's precision: the whole rail
     is two units of temperature over several hundred pixels, so a
     hand that can hit a 44px target can hit any colour on it to a
     hundredth. So the tolerance is a judgement first (JUDGE_ZERO) with
     only the HAND's share of it eased — the shape values/js/game.js
     uses. A trackpad adds 0.08 of slack, a finger 0.04, a pen none.
     The pixel floor underneath is for a sheet so narrow that the rail
     itself gets short; on any ordinary canvas the judgement term wins,
     which is the point — the same shade must score the same on a phone
     and a desktop. Capped, because a tolerance wider than the rail
     would score the far end of it for free. */
  var JUDGE_ZERO = 0.62, HAND_T = 0.08, FLOOR_PX = 9, MAX_ZERO = 1.1;
  function zeroPoint() {
    var eased = ArtDaily.ease(HAND_T);
    var z = JUDGE_ZERO + (isFinite(eased) ? eased - HAND_T : 0);
    if (!isFinite(z) || z <= 0) z = JUDGE_ZERO;
    var g = geo();
    if (g && isFinite(g.railW) && g.railW > 1) {
      var floor = ArtDaily.ease(FLOOR_PX) / g.railW * T_SPAN;
      if (isFinite(floor) && floor > z) z = floor;
    }
    return Math.min(z, MAX_ZERO);
  }

  /* ---- layout, recomputed from the canvas every paint ----
     The study panel keeps the generated scene inside a frame so the
     paper (and its dot grid) still reads as a sketchbook page, and so
     every mark that carries information — rail, labels, markers — sits
     on paper where the theme's inks are guaranteed to clear 3:1. */
  function geo() {
    if (!(W > 60 && H > 60)) return null;
    var pad = Math.max(10, Math.round(W * 0.035));
    /* The bottom band belongs to the rail, and the panel takes what is
       left — reserved rather than divided, so a short sheet loses
       picture instead of losing the control the drill is played with.
       The rail also has to clear the "paint it" sticker, which parks in
       the sheet's bottom-right corner on anything wider than 640px
       (below that the stylesheet drops it under the canvas). */
    var reserve = Math.max(64, Math.round(H * 0.30));
    var p = { x0: pad, y0: pad, x1: W - pad, y1: H - reserve };
    var pw = p.x1 - p.x0, ph = p.y1 - p.y0;
    if (!(pw > 40 && ph > 40)) return null;
    var horizon = p.y0 + ph * 0.54;
    var r = Math.max(12, Math.min(pw * 0.17, ph * 0.33));
    var railY = Math.round(p.y1 + Math.min(reserve * 0.42, reserve - 34));
    var x0 = Math.round(W * 0.10), x1 = Math.round(W * 0.90);
    return {
      p: p, pw: pw, ph: ph, horizon: horizon,
      r: r, cx: (p.x0 + p.x1) / 2, cy: horizon + r * 0.30,
      railY: railY, railX0: x0, railX1: x1, railW: Math.max(1, x1 - x0),
      railH: Math.max(11, Math.min(20, Math.round(H * 0.040))),
    };
  }

  function tToX(g, t) { return g.railX0 + (clampT(t) - T_MIN) / T_SPAN * g.railW; }
  function xToT(g, x) {
    var v = T_MIN + (Number(x) - g.railX0) / g.railW * T_SPAN;
    return clampT(v);
  }

  /* ---- the prompt line ----
     Says the verb in the words for the things actually drawn — a rail,
     a ball, a shadow side — so the first screen teaches without the
     how-to being opened. On the very first screen of the sitting it
     also says how the drill MARKS you: nothing on a bare rail says
     whether a near miss is worth 90 or nothing at all, and that is the
     one rule a beginner needs BEFORE their first attempt. From item
     two on the reveals have been teaching it in numbers. */
  function itemHint(idx, teachGoal) {
    var s = 'Ball ' + (idx + 1) + ' of ' + ITEMS_PER_ROUND +
      ' — drag the rail until the ball’s shadow side is the colour that sky would make it, then press “paint it”.';
    return teachGoal ? s + ' The closer the colour, the more it scores.' : s;
  }

  /* Once the rail has been moved, the prompt carries what it is set to
     — in the SAME words the sheet's name and the reveal use. It is the
     only way a player who cannot see the ball knows where they are,
     and it costs a sighted player nothing: one short clause, in the
     drill's one live region, written when a gesture ENDS rather than
     while it runs. */
  function setPrompt() {
    var s = itemHint(itemIdx, revealsSeen === 0);
    hint.textContent = touched ? s + ' Shade now: ' + tempName(shadeT) + '.' : s;
  }

  /* ---- the sheet, in words ----
     The canvas is role="img", so its accessible name IS the picture to
     anyone who cannot see it — and a name fixed at boot describes a
     blank rectangle for the whole session. Refreshed from draw() so
     the name and the paint always leave from the same place. NOT a
     live region: a name is spoken when the player navigates onto the
     element, so it never competes with the hint line. Held to the same
     bar as the scoring functions — it runs inside draw(), which runs
     inside the pointer handler, and whatever it builds gets read out
     loud. (isFinite(null) is true, so the null check comes first.) */
  var sheetName = '';
  var lastScore = null;
  function skyWords(it) {
    if (!it || !it.sky) return 'a sky';
    var haze = Number(it.sky.haze);
    var sun = (isFinite(haze) && haze > 0.5) ? 'a hazy ' : 'a ';
    return 'a ' + tempName(it.tTrue) + ' sky with ' + sun + tempName(it.kt) + ' sun';
  }
  function describeSheet() {
    var txt;
    if (reveal) {
      var rIt = reveal.item;
      var pct = isFinite(reveal.acc) ? ' ' + Math.round(reveal.acc) + ' out of 100.' : '';
      txt = 'Drill sheet: ball ' + itemIdx + ' of ' + ITEMS_PER_ROUND + ' under ' + skyWords(rIt) +
        ', painted twice — yours on the left at ' + tempName(reveal.tMine) +
        ', the true one on the right at ' + tempName(reveal.tTrue) + '. ' +
        String(reveal.words || 'off the mark').toLowerCase() + '.' + pct;
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else if (playing && item) {
      txt = 'Drill sheet: ball ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND + ' — ' + item.ballName +
        ' under ' + skyWords(item) + ', its cast shadow on the ground beside it. ' +
        'The rail below is set to ' + tempName(shadeT) + '.';
    } else {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ============================================================
     PAINTING — canvas background stays clear outside the panel so the
     CSS dot-grid shows through and the drill still reads as paper.
     ============================================================ */
  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    describeSheet();          /* the name and the picture leave from the same place */
    var g = geo();
    if (!g) return;
    var live = reveal ? reveal.item : item;
    if (!live) return;
    drawPanel(g, c, live);
    drawRail(g, c, live);
  }

  function fillRect(x, y, w, h, style) {
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
  }

  function drawPanel(g, c, it) {
    var fillTrue = fillLight(it.tTrue);
    var p = g.p;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x0, p.y0, g.pw, g.ph);
    ctx.clip();

    /* Sky: the evidence. Same chromaticity as the fill light that
       makes the shade — it is the same light — deeper overhead and
       brighter at the horizon, which is what a sky does. */
    var sky = ctx.createLinearGradient(0, p.y0, 0, g.horizon);
    sky.addColorStop(0, cssOf(atLum(tintRgb(it.tTrue), 0.52)));
    sky.addColorStop(1, cssOf(atLum(tintRgb(it.tTrue), 0.80)));
    fillRect(p.x0, p.y0, g.pw, g.horizon - p.y0, sky);

    /* Sun: the other light, in its own colour. Hazy skies get a wide
       soft one instead of a disc — an overcast sky IS its sun. */
    drawSun(g, it);

    /* Ground: one big plane facing straight up, so it sees the whole
       sky and none of it is hidden — the flat surface a player can
       read the fill's colour off directly. */
    var groundUp = surfaceRgb(it.ground, { x: 0, y: 1, z: 0 }, it.L, it.key, fillTrue);
    fillRect(p.x0, g.horizon, g.pw, p.y1 - g.horizon, cssOf(groundUp));
    ctx.strokeStyle = cssOfA(scaleRgb(groundUp, 0.7), 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x0, Math.round(g.horizon) + 0.5);
    ctx.lineTo(p.x1, Math.round(g.horizon) + 0.5);
    ctx.stroke();

    if (reveal) {
      /* Truth over the attempt, side by side and the same size, which
         is the only honest way to compare two colours. */
      var rr = g.r * 0.72;
      var off = Math.min(g.pw * 0.26, g.pw / 2 - rr - 8);
      var lift = (g.r - rr) * 0.7;
      drawBall(g, it, g.cx - off, g.cy - lift, rr, fillLight(reveal.tMine), fillTrue, groundUp);
      drawBall(g, it, g.cx + off, g.cy - lift, rr, fillTrue, fillTrue, groundUp);
      label(g.cx - off, g.cy - lift + rr + 18, 'yours', groundUp);
      label(g.cx + off, g.cy - lift + rr + 18, 'the sky’s', groundUp);
    } else {
      drawBall(g, it, g.cx, g.cy, g.r, fillLight(shadeT), fillTrue, groundUp);
    }
    ctx.restore();

    /* The frame. Decorative, so it stays in --muted. */
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x0 + 0.5, p.y0 + 0.5, g.pw - 1, g.ph - 1);
  }

  function drawSun(g, it) {
    var p = g.p;
    var sunCol = atLum(tintRgb(it.kt), 0.97);
    var sx = g.cx + it.L.x * g.r * 2.7;
    var sy = g.cy - it.L.y * g.r * 2.7;
    /* Sized against the sky it has to sit in, so a short panel gets a
       small sun rather than one that overruns the horizon. */
    var rs = Math.max(4, Math.min(g.r * (0.17 + 0.10 * (Number(it.sky.haze) || 0)),
                                  (g.horizon - p.y0) * 0.22));
    var m = rs * 2.2;
    sx = Math.max(p.x0 + m, Math.min(p.x1 - m, sx));
    sy = Math.min(Math.max(p.y0 + m, sy), Math.max(p.y0 + m, g.horizon - m * 0.6));
    var haze = Number(it.sky.haze);
    if (!isFinite(haze)) haze = 0;
    var halo = ctx.createRadialGradient(sx, sy, rs * 0.4, sx, sy, rs * (2.6 + haze * 1.6));
    halo.addColorStop(0, cssOfA(sunCol, 0.75));
    halo.addColorStop(1, cssOfA(sunCol, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, rs * (2.6 + haze * 1.6), 0, TAU);
    ctx.fill();
    if (haze < 0.6) {
      ctx.fillStyle = cssOf(sunCol);
      ctx.beginPath();
      ctx.arc(sx, sy, rs, 0, TAU);
      ctx.fill();
    }
  }

  /* One ball, its cast shadow, and nothing hand-waved: every facet is
     shaded from its own normal by the same function the score is
     derived from. `fill` is the sky light the BALL is wearing (the
     player's during play, the truth in the right-hand reveal); `fillT`
     is the true one, which the ground and the cast shadow always wear
     — the scene is painted for the player, only the ball is theirs. */
  function drawBall(g, it, cx, cy, r, fill, fillT, groundUp) {
    /* Cast shadow first: the ground with the key light blocked, so it
       is lit by the SKY ALONE. That patch is the whole lesson sitting
       on the floor next to the ball. */
    var shadowCol = surfaceRgb(it.ground, { x: 0, y: 1, z: 0 },
                               { x: 0, y: 1, z: 0 }, rgb(0, 0, 0), fillT);
    var ly = Math.max(0.28, it.L.y);
    var sx = cx - it.L.x / ly * r * 0.75;
    var sy = cy + r * 0.92;
    var rx = r * (1.05 + 0.55 * (1 - ly));
    var ry = Math.max(3, r * 0.26);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, ry / rx);
    var grad = ctx.createRadialGradient(0, 0, rx * 0.25, 0, 0, rx);
    grad.addColorStop(0, cssOfA(shadowCol, 0.95));
    grad.addColorStop(0.75, cssOfA(shadowCol, 0.75));
    grad.addColorStop(1, cssOfA(groundUp || shadowCol, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();                     /* a crisp silhouette over faceted shading */
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2;            /* seals the hairline seams between fills */
    for (var i = 0; i < FACETS.length; i++) {
      var f = FACETS[i];
      var col = cssOf(surfaceRgb(it.albedo, f.n, it.L, it.key, fill));
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (var v = 0; v < 4; v++) {
        var q = f.v[v];
        var x = cx + q.x * r, y = cy - q.y * r;
        if (v) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function label(x, y, text, backdrop) {
    ctx.save();
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inkOn(backdrop);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* ---- the rail: every colour this shade could be ----
     Painted from the real shading function at a real point on the
     ball, so the swatch under the handle is the colour the shade
     actually becomes. The gradient is built from samples of that
     function rather than from two endpoint colours — an sRGB blend
     between the ends would drift off the light model in the middle,
     and the middle is where the judgement is. */
  function drawRail(g, c, it) {
    var y = g.railY, h = g.railH;
    var top = y - h / 2;
    var grad = ctx.createLinearGradient(g.railX0, 0, g.railX1, 0);
    var STOPS = 20;
    for (var i = 0; i <= STOPS; i++) {
      var t = T_MIN + (i / STOPS) * T_SPAN;
      grad.addColorStop(i / STOPS, cssOf(surfaceRgb(it.albedo, it.nShade, it.L, it.key, fillLight(t))));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(g.railX0, top, g.railW, h);
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.railX0 + 0.5, top + 0.5, g.railW - 1, h - 1);

    ctx.save();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('cooler', g.railX0, top - 7);
    ctx.textAlign = 'right';
    ctx.fillText('warmer', g.railX1, top - 7);
    ctx.restore();

    if (reveal) {
      drawRevealMarks(g, c, it);
      return;
    }
    drawHandle(g, c, it, shadeT, true);
  }

  function swatchAt(it, t) {
    return surfaceRgb(it.albedo, it.nShade, it.L, it.key, fillLight(t));
  }

  function drawHandle(g, c, it, t, live) {
    var x = tToX(g, t);
    var y = g.railY;
    var col = swatchAt(it, t);
    var rr = Math.max(9, g.railH * 0.62);
    ctx.save();
    ctx.fillStyle = cssOf(col);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fill();
    /* The ring is a mark that carries information sitting on a colour
       that moves, so its ink comes from the swatch's own luminance —
       never from the theme, which knows nothing about what is under
       it. Worst case on this rail is 4.2:1. */
    ctx.strokeStyle = inkOn(col);
    ctx.lineWidth = live ? 2.5 : 2;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* The reveal on the rail: the tolerance corridor (the scale the
     printed number is measured on — without it a 62 has nothing on
     screen to be read against), the truth, the attempt, and the gap
     between them drawn as the thing it is. */
  function drawRevealMarks(g, c, it) {
    var xMine = tToX(g, reveal.tMine), xTrue = tToX(g, reveal.tTrue);
    var y = g.railY, h = g.railH;
    var z = (isFinite(reveal.zero) && reveal.zero > 0) ? reveal.zero : zeroPoint();
    var band = y - h / 2 - 12;
    var b0 = tToX(g, reveal.tTrue - z), b1 = tToX(g, reveal.tTrue + z);
    ctx.save();
    /* "Faint" is a look, not a licence to be unreadable: alpha is
       contrast, and this corridor is the scale the score is measured
       on. 0.85 on --muted measures 3.8:1 on the paper card. */
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(b0, band);
    ctx.lineTo(b1, band);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b0, band - 5); ctx.lineTo(b0, band + 5);
    ctx.moveTo(b1, band - 5); ctx.lineTo(b1, band + 5);
    ctx.stroke();
    ctx.restore();

    /* the gap, as a line between what you set and what was true */
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xMine, y);
    ctx.lineTo(xTrue, y);
    ctx.stroke();
    ctx.restore();

    drawHandle(g, c, it, reveal.tMine, false);

    /* the truth: a solid pointer standing on the paper under the rail,
       where the theme's ink is guaranteed to read */
    ctx.save();
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.moveTo(xTrue, y + h / 2 + 2);
    ctx.lineTo(xTrue - 7, y + h / 2 + 14);
    ctx.lineTo(xTrue + 7, y + h / 2 + 14);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('true', xTrue, y + h / 2 + 17);
    ctx.restore();
  }

  /* ============================================================
     INPUT — one rail, dragged; or the same axis in steps from the
     keyboard. Nothing here is ever punished for a UI reason.
     ============================================================ */
  function setShade(v, note) {
    shadeT = clampT(v);
    if (note) touched = true;
  }

  var dragId = null, grabOff = 0, lastPenAt = 0;
  var rafId = null;
  function requestDraw() {
    if (rafId !== null) return;
    rafId = raf(function () { rafId = null; draw(); });
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* A second finger must not fight the first, and a press that lands
       while a reveal holds the screen has nothing to adjust — the next
       ball is not drawn yet. Ignored, never counted against them. */
    if (!playing || phase !== 'aim' || !item || dragId !== null || ev.isPrimary === false) return;
    /* Only a press that MEANS "here". A right-click is a pointerdown
       like any other — primary pointer, real coordinates — so an
       unguarded handler would move the rail wherever the cursor sat
       while the context menu opened over it. `button` is 0 for a
       finger and for a pen's tip, so this costs touch and pen nothing. */
    if (ev.button > 0) return;
    /* palm rejection: a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - lastPenAt < 700) return;
    ev.preventDefault();
    var g = geo();
    if (!g) return;
    dragId = ev.pointerId;
    try { canvas.setPointerCapture(dragId); } catch (e) {}
    try { canvas.focus({ preventScroll: true }); } catch (e2) { canvas.focus(); }
    var rect = canvas.getBoundingClientRect();
    var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    var hx = tToX(g, shadeT);
    /* Grabbing the handle keeps its offset so it cannot jump under the
       finger; pressing anywhere else moves it there outright — a
       control that refuses a near miss reads as broken to someone who
       cannot see their own hand. */
    var near = Math.hypot(px - hx, py - g.railY) <= grabRadius();
    grabOff = near ? shadeT - xToT(g, px) : 0;
    setShade(xToT(g, px) + grabOff, true);
    draw();     /* the press that just landed is the one paint that must not wait a frame */
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (dragId !== ev.pointerId || phase !== 'aim') return;
    ev.preventDefault();
    var g = geo();
    if (!g) return;
    /* Where the hand is NOW is the last entry of the coalesced run —
       and that is all a drag handle needs, so the rect is measured
       once per event rather than once per sample. */
    var list = ArtDaily.samples(ev);
    var last = (list && list.length) ? list[list.length - 1] : ev;
    var rect = canvas.getBoundingClientRect();
    setShade(xToT(g, last.clientX - rect.left) + grabOff, true);
    requestDraw();
  });

  function endDrag(ev) {
    if (dragId === null || (ev && ev.pointerId !== undefined && ev.pointerId !== dragId)) return;
    try { canvas.releasePointerCapture(dragId); } catch (e) {}
    dragId = null;
    /* One announcement per gesture, in the drill's one live region:
       what the rail is now set to, in the same words everything else
       uses. Written at the END of the drag, never during it. */
    if (playing && phase === 'aim') setPrompt();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  /* A release the canvas never sees — off-window, or a dropped capture
     — would otherwise freeze the handle for the rest of the session,
     because pointerdown returns early while one is in flight. */
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /* The same one axis from the keyboard, plus commit. The canvas
     carries tabindex="0" in index.html for exactly this — a focusable
     canvas with no key handling is a focus ring on a picture. */
  canvas.addEventListener('keydown', function (ev) {
    if (!playing) return;
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      lockItem();
      return;
    }
    if (phase !== 'aim') return;
    var step = ev.shiftKey ? 0.10 : 0.03;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') setShade(shadeT + step, true);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') setShade(shadeT - step, true);
    else return;
    ev.preventDefault();
    setPrompt();
    requestDraw();     /* a held arrow repeats faster than the screen refreshes */
  });

  /* ============================================================
     ROUND FLOW — report() fires exactly once per finished round, on
     every path that can finish one.
     ============================================================ */
  function lockItem() {
    if (!playing || phase !== 'aim' || !item) return;
    var zero = zeroPoint();
    var dt = shadeT - item.tTrue;
    var acc = shadeAccuracy(dt, zero);
    scores.push(acc);
    diffs.push(dt);
    itemIdx += 1;
    var seen = revealsSeen;          /* reveals shown BEFORE this one, this sitting */
    revealsSeen += 1;
    reveal = {
      item: item,
      tMine: shadeT,
      tTrue: item.tTrue,
      /* The tolerance is kept WITH the reveal: the reveal outlives the
         moment it was scored, the corridor drawn on the rail is the
         scale the printed number was measured on, and ease() answers
         for the hardware in use NOW — a pen plugged in while the
         player reads would redraw the corridor narrower under a number
         it never graded. History does not get re-judged. */
      zero: zero,
      words: missPhrase(dt, zero),
      acc: Math.round(acc),
      /* kept with the reveal so a hidden tab can hand the SAME beat
         back in full rather than recomputing one */
      beat: revealBeat(seen),
    };
    phase = 'reveal';
    btnSet.hidden = true;
    /* The corridor appears for the first time under this sentence, and
       an unexplained new mark is jargon that happens to be drawn
       instead of typed. Named once, on the only screen where it is new. */
    hint.textContent = itemWords(reveal.words, acc) + '.' +
      (seen ? '' : ' The dotted band over the rail is where the score runs out.');
    draw();
    /* The last ball does NOT wait on the beat: finishing is
       synchronous, so report() can never be raced by "new round"
       landing during the reveal. The reveal simply stays on screen. */
    if (itemIdx >= ITEMS_PER_ROUND) { finishRound(); return; }
    revealTimer = setTimeout(nextItem, reveal.beat);
  }

  function nextItem() {
    revealTimer = null;
    if (!playing) return;      /* the round was abandoned while the reveal was up */
    reveal = null;
    phase = 'aim';
    item = roundItems[itemIdx] || roundItems[roundItems.length - 1];
    shadeT = 0;                /* every ball starts at colourless — the mistake */
    touched = false;
    btnSet.hidden = false;
    setPrompt();
    draw();
  }

  /* A hidden tab is not a reading player. Background timers keep
     running, throttled but never cancelled, so a reveal that is
     alt-tabbed away from is spent on a tab nobody is looking at. Park
     the advance while the page is hidden and hand the beat back in
     full on return. This timer can never file a round: it only
     advances an ITEM, and the last item finishes synchronously. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (playing && reveal && revealTimer === null) {
      revealTimer = setTimeout(nextItem, reveal.beat || REVEAL_MS);
    }
  });

  /* A number on its own is not a reveal, and "new best!" on the very
     first round celebrates nothing — it is true of every player's
     first round ever played. So the first round says what the score is
     FOR. The last ball keeps its own words here too: item four is an
     attempt like any other. The round's correction goes last. */
  function roundWords(res, last, bias) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = bias ? ' ' + bias : '';
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  function finishRound() {
    playing = false;                  /* set first: report() fires exactly once */
    phase = 'done';
    clearTimeout(revealTimer);        /* nothing may advance past a finished round */
    revealTimer = null;
    btnSet.hidden = true;
    draw();                           /* the last pair stays up as the reveal */
    var res = ArtDaily.report(roundScore(scores));
    lastScore = res.score;
    describeSheet();                  /* the picture did not change; what is known about it did */
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The habit is graded against the tolerance the ROUND was scored
       under, taken from the reveal still on screen — not from ease()
       again, which would re-judge four finished items against a
       tolerance none of them were scored with. */
    hint.textContent = roundWords(res, reveal && itemWords(reveal.words, reveal.acc),
                                  roundBias(diffs, (reveal && reveal.zero) || zeroPoint()));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    scores = [];
    diffs = [];
    playing = true;
    phase = 'aim';
    lastScore = null;
    clearReveal();        /* a queued advance from the abandoned round must not fire */
    roundItems = buildRound();
    item = roundItems[0];
    shadeT = 0;
    touched = false;
    btnSet.hidden = false;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();          /* the last round's score must not hang over this one */
    setPrompt();
    draw();
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* The toast is a STICKER, not a second voice: it says nothing the
     hint line has not already said in a fuller sentence. It is
     aria-hidden in index.html — keep it that way, and if this drill
     ever needs to say something the hint does not, put it in the hint. */
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
  btnSet.addEventListener('click', function () { lockItem(); });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware can change mid-session; the grab zone is sized from
     it, and so is the hand's share of the tolerance. Geometry only —
     the reveal on screen keeps the tolerance it was scored with. */
  ArtDaily.onInput(draw);

  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  /* Both resize sources fire in bursts for a single drag, and a fit
     that really changes size REALLOCATES the canvas backing store —
     the most expensive thing in this file — plus a full clear on top.
     So measure and repaint at most once a frame, and only when the
     size actually moved. */
  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () { fitPending = false; if (fitCanvas()) draw(); });
  }
  window.addEventListener('resize', onResize);
  /* ResizeObserver also catches what window.resize cannot: the canvas
     measuring 0 at boot (opened in a background tab, or laid out late)
     and getting its real width a frame later. */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
