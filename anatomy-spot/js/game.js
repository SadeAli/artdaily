/* ============================================================
   game.js — Anatomy Spot: two mannequins built on the classic
   7.5-head canon stand side by side; one hides a single
   proportion error. Tap the flawed figure, then tap the part
   that is off. Deliberately a no-drawing drill — it trains the
   proofreading eye. All scoring is pure geometry (point-to-
   capsule distance) in the functions at the top, unit-testable
   without a canvas.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'anatomy-spot';
  var ITEMS_PER_ROUND = 5;
  var TAP_SLOP = 12;       /* free px around a part's capsule */
  var FALLOFF_HEADS = 1.2; /* location score fades to 0 this far out */

  /* ============================================================
     Pure scoring — geometry in, 0–100 out. No canvas, no DOM.
     ============================================================ */
  /* NaN-safe: any non-comparable input falls to 0. */
  function clamp01(v) { return v > 0 ? (v < 1 ? v : 1) : 0; }

  /* Distance from point p to segment a→b. */
  function distToSegment(p, a, b) {
    var abx = b.x - a.x, aby = b.y - a.y;
    var l2 = abx * abx + aby * aby;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2);
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
  }

  /* A part is a capsule chain — min distance over its segments. */
  function distToCapsule(p, segments) {
    var best = Infinity, i, d;
    for (i = 0; i < segments.length; i++) {
      d = distToSegment(p, segments[i][0], segments[i][1]);
      if (d < best) best = d;
    }
    return best;
  }

  /* Naming the flawed figure is half the marks — but a wrong first tap
     used to end the item at a hard zero, with the locate half never
     attempted. With two figures that is a coin flip: two unlucky guesses
     in a five-item round capped the round at 60 through no skill
     deficit, and half of all first-timers met "other figure!" as their
     very first feedback. A miss is recoverable now: say "not that one",
     let them take the other figure for reduced credit, and still run the
     locate half for its full 50. */
  /* The split is 35 / 65, not 50 / 50. With two figures the first tap is
     a coin flip, and weighting a coin flip at half the item is what made
     a lucky beginner and an unlucky competent player print the same
     number. FINDING the part is the skill, so it carries most of the
     marks — and naming the figure second time still pays something. */
  var PICK_PTS = 35;
  var SECOND_CHANCE_PTS = 10;
  var LOC_PTS = 65;

  function figurePickScore(pickedIdx, flawedIdx, usedSecondChance) {
    if (pickedIdx !== flawedIdx) return 0;
    return usedSecondChance ? SECOND_CHANCE_PTS : PICK_PTS;
  }

  /* Full marks anywhere on the part (its radius + the tap slop), then a
     linear fade to 0 at 1.2 head-units past that. Any non-finite input
     scores the floor rather than leaking a NaN into the round.
     `slopPx` is a HIT ZONE, so the caller passes it through
     ArtDaily.startRadius: a fingertip covers the target it is aiming at
     and a screenless tablet cannot see its own hand, while a trackpad
     (start factor 1.0) is unchanged. Defaults to the bare TAP_SLOP so the
     function stays callable with three arguments. */
  function locationScore(dist, partRadius, headPx, slopPx) {
    if (!isFinite(dist) || !isFinite(partRadius) || !isFinite(headPx) || headPx <= 0) return 0;
    var slop = (typeof slopPx === 'number' && isFinite(slopPx) && slopPx >= 0) ? slopPx : TAP_SLOP;
    var free = partRadius + slop;
    if (dist <= free) return LOC_PTS;
    return LOC_PTS * clamp01(1 - (dist - free) / (FALLOFF_HEADS * headPx));
  }

  /* isFinite() coerces, so it says yes to the empty string — and then `+`
     on a string CONCATENATES instead of adding: ("" ) + (null) is the text
     "null", which Math.min turns straight into NaN. Convert first, then
     check, so the two halves of an item can only ever be added as numbers. */
  function num(v) {
    var n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : 0;
  }

  function itemScore(figScore, locScore) {
    return Math.max(0, Math.min(100, num(figScore) + num(locScore)));
  }

  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0, i;
    /* Clamped as well as coerced: a finite number outside 0–100 prints on
       the HUD as loudly as a NaN would. The identity on every value
       itemScore has ever produced. */
    for (i = 0; i < scores.length; i++) sum += Math.max(0, Math.min(100, num(scores[i])));
    return sum / scores.length;
  }

  /* The error shrinks as the round goes: ±30% → ±25% → ±20%.
     It used to bottom out at ±13%, which on a forearm at h=52px is 6-7px
     of length difference across two arms — an expert discrimination
     presented as item 5 of a beginner drill. 20% is still a real test
     and it is one a beginner can actually see. */
  function errFactorForItem(idx) {
    if (idx < 2) return 0.30;
    if (idx < 4) return 0.25;
    return 0.20;
  }

  /* ============================================================
     The mannequin — classic head-unit canon, lengths in heads.
     Head 1, chin→shoulder 0.4, shoulder line at 1.4, navel at 3,
     hips at 3.75 (midpoint), knees ~5.5, soles ~7.5; shoulders
     span ~2 heads; elbows land at the waist, wrists at the crotch.
     ============================================================ */
  var CANON = {
    headR: 0.5, neckLen: 0.4, shoulderHalf: 1.0, torsoLen: 2.35,
    hipHalf: 0.5, hipJointX: 0.33, upperArm: 1.5, forearm: 0.95,
    thigh: 1.75, shin: 1.75
  };

  /* Build one figure's joints in px. pose = arm/leg angles (deg),
     flaw = null or {part, side, factor} scaling exactly one part. */
  function buildFigure(cx, topY, h, pose, flaw) {
    function f(name, side) {
      if (!flaw || flaw.part !== name) return 1;
      if (flaw.side && flaw.side !== side) return 1;
      return flaw.factor;
    }
    var headR = CANON.headR * h * f('head');
    var chinY = topY + 2 * headR;
    var shoulderY = chinY + CANON.neckLen * h;
    var sw = CANON.shoulderHalf * h * f('shoulders');
    var hipY = shoulderY + CANON.torsoLen * h * f('torso');

    function arm(sideSign, sideName) {
      var ua = CANON.upperArm * h * f('upperArm', sideName);
      var fa = CANON.forearm * h * f('forearm', sideName);
      var out = (sideName === 'L' ? pose.armOutL : pose.armOutR) * Math.PI / 180;
      var bend = out + (sideName === 'L' ? pose.bendL : pose.bendR) * Math.PI / 180;
      var sh = { x: cx + sideSign * sw, y: shoulderY };
      var el = { x: sh.x + sideSign * Math.sin(out) * ua, y: sh.y + Math.cos(out) * ua };
      var wr = { x: el.x + sideSign * Math.sin(bend) * fa, y: el.y + Math.cos(bend) * fa };
      return { shoulder: sh, elbow: el, wrist: wr };
    }
    function leg(sideSign, sideName) {
      var th = CANON.thigh * h * f('leg', sideName);
      var sn = CANON.shin * h * f('leg', sideName);
      var a = pose.legOut * Math.PI / 180;
      var hip = { x: cx + sideSign * CANON.hipJointX * h, y: hipY };
      var knee = { x: hip.x + sideSign * Math.sin(a) * th, y: hip.y + Math.cos(a) * th };
      var ankle = { x: knee.x + sideSign * Math.sin(a * 0.6) * sn, y: knee.y + Math.cos(a * 0.6) * sn };
      return { hip: hip, knee: knee, ankle: ankle };
    }

    return {
      cx: cx, topY: topY, h: h,
      headC: { x: cx, y: topY + headR }, headR: headR,
      chinY: chinY, shoulderY: shoulderY, sw: sw,
      hipY: hipY, hw: CANON.hipHalf * h,
      armL: arm(-1, 'L'), armR: arm(1, 'R'),
      legL: leg(-1, 'L'), legR: leg(1, 'R')
    };
  }

  /* The flawed part as a tappable capsule on the built figure. */
  function partCapsule(fig, part, side) {
    var h = fig.h;
    if (part === 'head') return { segments: [[fig.headC, fig.headC]], r: fig.headR };
    if (part === 'shoulders') {
      return { segments: [[{ x: fig.cx - fig.sw, y: fig.shoulderY }, { x: fig.cx + fig.sw, y: fig.shoulderY }]], r: 0.18 * h };
    }
    if (part === 'torso') {
      return { segments: [[{ x: fig.cx, y: fig.shoulderY }, { x: fig.cx, y: fig.hipY }]], r: 0.6 * h };
    }
    var arm = side === 'L' ? fig.armL : fig.armR;
    if (part === 'upperArm') return { segments: [[arm.shoulder, arm.elbow]], r: 0.16 * h };
    if (part === 'forearm') return { segments: [[arm.elbow, arm.wrist]], r: 0.14 * h };
    var lg = side === 'L' ? fig.legL : fig.legR;
    return { segments: [[lg.hip, lg.knee], [lg.knee, lg.ankle]], r: 0.18 * h };
  }

  /* Verdict line: name the flaw, teach the landmark. */
  function verdictText(part, side, factor) {
    var pct = Math.round(Math.abs(factor - 1) * 100);
    var more = factor > 1;
    var s = side === 'L' ? 'left ' : (side === 'R' ? 'right ' : '');
    if (part === 'head') return 'head ~' + pct + '% ' + (more ? 'big' : 'small') + ' — the figure stands 7.5 heads tall';
    if (part === 'shoulders') return 'shoulders ~' + pct + '% ' + (more ? 'wide' : 'narrow') + ' — they span two head-lengths';
    if (part === 'torso') return 'torso ~' + pct + '% ' + (more ? 'long' : 'short') + ' — navel at 3 heads, hips near halfway';
    if (part === 'upperArm') return s + 'upper arm ~' + pct + '% ' + (more ? 'long' : 'short') + ' — elbows should sit at the waist';
    if (part === 'forearm') return s + 'forearm ~' + pct + '% ' + (more ? 'long' : 'short') + ' — wrists should reach the crotch line';
    return s + 'leg ~' + pct + '% ' + (more ? 'long' : 'short') + ' — knees at 5.5 heads, soles at 7.5';
  }

  /* ============================================================
     Canvas / DOM from here down.
     ============================================================ */
  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');

  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function hexToRgb(s) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((s || '').trim());
    if (!m) return null;
    var v = m[1];
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }

  /* t of a over (1-t) of b — the canvas twin of the stylesheet's
     color-mix(in srgb, accent 55%, ink) so accent TEXT clears AA
     on paper; falls back to the raw accent if a token isn't hex. */
  function mixColors(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    if (!ca || !cb) return a;
    var out = [], i;
    for (i = 0; i < 3; i++) out.push(Math.round(ca[i] * t + cb[i] * (1 - t)));
    return 'rgb(' + out.join(',') + ')';
  }

  /* getComputedStyle() on the root forces a style resolve, and it ran at
     the top of every repaint along with a hex parse and a mix for
     accentText. The tokens only move when the sheet flips theme, so cache
     them against data-theme; the cache invalidates itself the moment that
     attribute changes, so onTheme still repaints in the new colours. */
  var inkCache = null, inkKey = null;
  function inks() {
    var key = document.documentElement.dataset.theme || '';
    if (inkCache && inkKey === key) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var ink = cs.getPropertyValue('--ink').trim();
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--bubblegum').trim();
    inkKey = key;
    inkCache = {
      ink: ink,
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
      /* pure accent passes AA on the dark sheet; on paper it needs ink */
      accentText: key === 'dark' ? accent : mixColors(accent, ink, 0.55),
    };
    return inkCache;
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width.
     Taller than most drills — the figures stand upright.
     Returns true only when the sheet really changed size: assigning
     canvas.width reallocates and clears the backing store, and `resize`
     fires on every address-bar nudge on a phone — where it also rebuilt
     both mannequins from scratch for a frame identical to the one already
     on screen. ---- */
  var W = 0, H = 0, fitDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var dpr = window.devicePixelRatio || 1;
    if (w === W && dpr === fitDpr) return false;
    W = w;
    H = Math.round(W * 0.72);
    fitDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], items = [];
  var figs = null, ghostFig = null;
  var phase = 'idle';      /* pick → locate → reveal */
  var playing = false;
  var pickedIdx = -1;
  var reveal = null;       /* {pts, wrongPick, pickTap, locTap} taps normalized */
  var guardUntil = 0;      /* ignore taps briefly after a phase flip */
  var secondChance = false; /* a wrong first figure pick costs marks, not the item */

  var PARTS = ['head', 'upperArm', 'forearm', 'torso', 'leg', 'shoulders'];

  /* THE OPENER HAS TO BE THE EASY ONE. Item 1 drew its flawed part
     uniformly from all six, and at the opening ±30% those six are not
     remotely equal: a torso is 2.35 heads long, so ±30% shifts the hips
     by ~0.7 of a head — unmissable — while a FOREARM is 0.95 heads, so
     ±30% is ~0.29 of a head, judged across the ~0.4×W gap between the two
     figures. That is the finest discrimination the drill contains, and it
     was being dealt as the very first thing a beginner ever sees, one
     time in three (forearm or upper arm). Both arms are also the only
     flaws that ask a second question — which side. Item 1 now draws from
     the four big central parts, whose canon landmark (7.5 heads, two-head
     shoulders, hips at halfway, knees at 5.5) is legible on the ruler
     that is already on screen. Items 2–5 keep the full pool, so the
     round's range and its ramp are unchanged. */
  var OPENER_PARTS = ['head', 'torso', 'leg', 'shoulders'];

  /* ---- where the five items come from ----------------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS. Round 1 of a
     sitting is dealt from ArtDaily.roundRandom(1) — seeded from today and
     this slug — so every player hunts the same five flaws today: the same
     part, the same side, the same direction of error, the same pose and
     the same figure carrying it. Round 2 and on are practice: same
     generator, same distribution, unshared seed.

     NO PER-ITEM CACHE IS NEEDED HERE, and this drill needs one least of
     all: all five items are dealt up front, in one burst inside newRound,
     and nothing after that draws at all. layoutItem() rebuilds the PIXEL
     geometry from the item it was already handed — that is what runs on a
     resize — so a rotation re-lays the same five mannequins out and can
     never re-deal them.

     THE SAME DRAWS REALLY ARE THE SAME DRILL HERE. An item is a part name,
     a side, a sign, five pose angles in degrees and a figure index: not one
     of them is a function of the canvas. layoutItem multiplies by a head
     unit taken from min(H*0.104, W*0.097) and stands the figures at 0.30W
     and 0.70W, and locationScore grades in head-units, so a phone and a
     desktop get the same question at the same difficulty.

     GUARDED, and the guard is load-bearing: index.html cache-busts its own
     scripts but every drill loads ../sdk/artdaily-sdk.js BARE, so the two
     cache independently and a returning visitor can hold a warm old SDK
     against a cold copy of this file. An unguarded call would throw inside
     newRound() before a single item existed — blank sheet, "Loading…"
     forever. Only the BARE call form is used: every draw in this drill goes
     through uniform() below, and Math.random is a drop-in for that. */
  var roundRng = null;

  /* One raw uniform in [0,1) — the round's, or the plain one when an old
     SDK is cached. Every random draw in this file goes through here. */
  function uniform() { return roundRng ? roundRng() : Math.random(); }

  /* Unchanged as a function — lo + u * (hi - lo) is exactly what it always
     was, with Math.random() swapped for the round's uniform. u is uniform
     on [0,1) either way, so every value downstream keeps precisely the
     shape it had and a seeded round is not an easier or a harder round. */
  function rand(lo, hi) { return lo + uniform() * (hi - lo); }

  function randPose() {
    return {
      armOutL: rand(5, 18), armOutR: rand(5, 18),
      bendL: rand(-2, 12), bendR: rand(-2, 12),
      legOut: rand(3, 9)
    };
  }

  function makeItem(idx, prevPart) {
    /* idx 0 has no prevPart (it is null), so the no-repeat loop always
       terminates on the first draw whichever pool is in hand. */
    var pool = (idx === 0) ? OPENER_PARTS : PARTS;
    var part = prevPart;
    while (part === prevPart) part = pool[Math.floor(uniform() * pool.length)];
    var side = (part === 'upperArm' || part === 'forearm' || part === 'leg')
      ? (uniform() < 0.5 ? 'L' : 'R') : null;
    var factor = 1 + (uniform() < 0.5 ? -1 : 1) * errFactorForItem(idx);
    /* ONE pose, shared. Posing the two figures independently meant the
       player was not spotting one difference between matched figures —
       they were comparing two differently-posed figures where only one
       also had a proportion flaw. That confound grows exactly as the
       flaw shrinks, which made the late items close to random. Shared
       pose = the ONLY difference between them is the thing being asked
       about, which is what "two figures, one flaw" promises. */
    var pose = randPose();
    return {
      flawedIdx: uniform() < 0.5 ? 0 : 1,
      part: part, side: side, factor: factor,
      poses: [pose, pose]
    };
  }

  /* Rebuild the current item's px geometry (also on resize). */
  function layoutItem() {
    var item = items[itemIdx];
    if (!item) return;
    var h = Math.min(H * 0.104, W * 0.097);
    var topY = Math.round(H * 0.045);
    figs = [];
    for (var i = 0; i < 2; i++) {
      var flaw = (i === item.flawedIdx)
        ? { part: item.part, side: item.side, factor: item.factor } : null;
      figs.push(buildFigure(W * (i === 0 ? 0.30 : 0.70), topY, h, item.poses[i], flaw));
    }
    ghostFig = buildFigure(figs[item.flawedIdx].cx, topY, h, item.poses[item.flawedIdx], null);
  }

  function itemLabel() { return 'item ' + (itemIdx + 1) + ' of ' + ITEMS_PER_ROUND; }

  function setupItem() {
    phase = 'pick';
    pickedIdx = -1;
    secondChance = false;
    reveal = null;
    guardUntil = Date.now() + 250;
    layoutItem();
    /* "the wrong length" is not true of two of the six flaws — a head is
       the wrong SIZE and shoulders the wrong WIDTH — and a beginner told
       to hunt for a length problem will not look at either. */
    hint.textContent = itemLabel() +
      ' — the two figures stand in the same pose; on one of them a single body part is the wrong size.' +
      ' tap that figure. (the ruler beside them counts head-heights: a standing figure is 7.5 heads tall.)';
    draw();
  }

  function newRound() {
    round += 1;
    itemIdx = 0;
    itemScores = [];
    items = [];
    /* THE ONE LINE THAT MAKES A SCORE COMPARABLE. round is already 1 on the
       first round of a sitting, so round 1 is today's shared round and every
       "new round" after it is practice. Re-seeded HERE, per round and BEFORE
       the deal below, so a replay can never hand back the round just played. */
    roundRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round)
      : Math.random;
    var prev = null;
    for (var i = 0; i < ITEMS_PER_ROUND; i++) {
      items.push(makeItem(i, prev));
      prev = items[i].part;
    }
    playing = true;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    setupItem();
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function seg(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function circle(p, r, fill, edge, lw) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }

  /* One figure in simple volumes: capsules (thick edge stroke, then
     a card-colored core) + a trapezoid torso + circle head. */
  function drawFigure(fig, c, dim) {
    var h = fig.h;
    var edge = dim ? c.muted : c.ink;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.22;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function cap(a, b, r) {
      ctx.strokeStyle = edge; ctx.lineWidth = r * 2 + 3; seg(a, b);
      ctx.strokeStyle = c.card; ctx.lineWidth = Math.max(1, r * 2 - 1); seg(a, b);
    }
    function foot(lg, sideSign) {
      ctx.beginPath();
      ctx.ellipse(lg.ankle.x + sideSign * 0.22 * h, lg.ankle.y + 0.08 * h, 0.34 * h, 0.14 * h, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.card; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
    }

    /* legs + feet */
    cap(fig.legL.hip, fig.legL.knee, 0.19 * h); cap(fig.legL.knee, fig.legL.ankle, 0.155 * h);
    cap(fig.legR.hip, fig.legR.knee, 0.19 * h); cap(fig.legR.knee, fig.legR.ankle, 0.155 * h);
    foot(fig.legL, -1); foot(fig.legR, 1);
    /* neck (torso covers the join) */
    cap({ x: fig.cx, y: fig.chinY - 0.1 * h }, { x: fig.cx, y: fig.shoulderY + 0.1 * h }, 0.14 * h);
    /* torso trapezoid: shoulder bar down to the hip bar */
    ctx.beginPath();
    ctx.moveTo(fig.cx - fig.sw, fig.shoulderY);
    ctx.lineTo(fig.cx + fig.sw, fig.shoulderY);
    ctx.lineTo(fig.cx + fig.hw, fig.hipY);
    ctx.lineTo(fig.cx - fig.hw, fig.hipY);
    ctx.closePath();
    ctx.fillStyle = c.card; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
    /* arms + hands */
    cap(fig.armL.shoulder, fig.armL.elbow, 0.16 * h); cap(fig.armL.elbow, fig.armL.wrist, 0.13 * h);
    cap(fig.armR.shoulder, fig.armR.elbow, 0.16 * h); cap(fig.armR.elbow, fig.armR.wrist, 0.13 * h);
    circle({ x: fig.armL.wrist.x, y: fig.armL.wrist.y + 0.15 * h }, 0.15 * h, c.card, edge, 2);
    circle({ x: fig.armR.wrist.x, y: fig.armR.wrist.y + 0.15 * h }, 0.15 * h, c.card, edge, 2);
    /* head */
    circle(fig.headC, fig.headR, c.card, edge, 2);
    /* joint dots */
    ctx.fillStyle = edge;
    var joints = [fig.armL.elbow, fig.armR.elbow, fig.legL.knee, fig.legR.knee];
    for (var i = 0; i < joints.length; i++) circle(joints[i], 1.7, edge, null, 0);

    ctx.restore();
  }

  /* The canon ghost-overlaid as a dashed skeleton. */
  function drawGhost(fig, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha = 0.85;
    circle(fig.headC, fig.headR, null, color, 1.6);
    seg({ x: fig.cx, y: fig.chinY }, { x: fig.cx, y: fig.hipY });
    seg({ x: fig.cx - fig.sw, y: fig.shoulderY }, { x: fig.cx + fig.sw, y: fig.shoulderY });
    seg(fig.legL.hip, fig.legR.hip);
    var chains = [
      [fig.armL.shoulder, fig.armL.elbow, fig.armL.wrist],
      [fig.armR.shoulder, fig.armR.elbow, fig.armR.wrist],
      [fig.legL.hip, fig.legL.knee, fig.legL.ankle],
      [fig.legR.hip, fig.legR.knee, fig.legR.ankle]
    ];
    var i, j;
    for (i = 0; i < chains.length; i++) {
      for (j = 0; j + 1 < chains[i].length; j++) seg(chains[i][j], chains[i][j + 1]);
    }
    ctx.setLineDash([]);
    for (i = 0; i < chains.length; i++) {
      for (j = 1; j < chains[i].length; j++) circle(chains[i][j], 2.2, color, null, 0);
    }
    ctx.restore();
  }

  /* Highlighter swipe over the erroneous part. */
  function highlightPart(fig, part, side, color) {
    var cp = partCapsule(fig, part, side);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    if (part === 'head') {
      circle(fig.headC, fig.headR + 5, color, null, 0);
    } else {
      ctx.lineWidth = cp.r * 2 + 10;
      for (var i = 0; i < cp.segments.length; i++) seg(cp.segments[i][0], cp.segments[i][1]);
    }
    ctx.restore();
  }

  /* Head-unit ruler between the figures (canon: 0 → 7.5). */
  function drawRuler(c, x, topY, h) {
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.fillStyle = c.muted;
    ctx.lineWidth = 1;
    seg({ x: x, y: topY }, { x: x, y: topY + 7.5 * h });
    ctx.font = '600 9px ' + MONO;
    ctx.textAlign = 'left';
    for (var k = 0; k <= 7; k++) {
      var y = topY + k * h;
      seg({ x: x - 4, y: y }, { x: x + 4, y: y });
      if (k > 0) ctx.fillText(String(k), x + 7, y + 3);
    }
    var yEnd = topY + 7.5 * h;
    seg({ x: x - 6, y: yEnd }, { x: x + 6, y: yEnd });
    ctx.fillText('7.5', x + 7, yEnd + 3);
    ctx.restore();
  }

  function drawCross(p, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    seg({ x: p.x - 5, y: p.y - 5 }, { x: p.x + 5, y: p.y + 5 });
    seg({ x: p.x - 5, y: p.y + 5 }, { x: p.x + 5, y: p.y - 5 });
    ctx.restore();
  }

  /* “+20%” tag next to the flawed part, on the figure's outer side. */
  function drawPartLabel(fig, item, c) {
    var cp = partCapsule(fig, item.part, item.side);
    var s0 = cp.segments[0];
    var mid = item.part === 'leg'
      ? s0[1]
      : { x: (s0[0].x + s0[1].x) / 2, y: (s0[0].y + s0[1].y) / 2 };
    var out = fig.cx <= W / 2 ? -1 : 1;
    var tx = mid.x + out * (cp.r + 1.1 * fig.h);
    tx = Math.max(6, Math.min(W - 6, tx));
    var pct = Math.round(Math.abs(item.factor - 1) * 100);
    ctx.save();
    ctx.font = '800 12px ' + MONO;
    ctx.textAlign = out < 0 ? 'right' : 'left';
    ctx.fillStyle = c.accentText;
    ctx.fillText((item.factor > 1 ? '+' : '-') + pct + '%', tx, mid.y + 4);
    ctx.restore();
  }

  function denorm(p) { return { x: p.u * W, y: p.v * H }; }

  /* Dashed outline of a figure's tap zone — drawn from the same
     figureBounds() the hit test uses, so the affordance is honest. */
  function drawTapZone(fig, c) {
    var b = figureBounds(fig);
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 10);
    else ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!figs) return;
    var item = items[itemIdx];
    if (!item) return;

    if (phase === 'pick') {
      drawTapZone(figs[0], c);
      drawTapZone(figs[1], c);
      drawFigure(figs[0], c, false);
      drawFigure(figs[1], c, false);
      drawRuler(c, W * 0.5, figs[0].topY, figs[0].h);
      return;
    }
    if (phase === 'locate') {
      drawTapZone(figs[pickedIdx], c);
      drawFigure(figs[1 - pickedIdx], c, true);
      drawFigure(figs[pickedIdx], c, false);
      /* The drill's own studio tip says "check landmarks, not vibes" and
         then withheld the only measuring tool until after the guess. */
      drawRuler(c, W * 0.5, figs[pickedIdx].topY, figs[pickedIdx].h);
      return;
    }
    /* reveal: the pristine figure fades, the flawed one gets the
       canon ghost, the accent highlight and the head-unit ruler. */
    var flawed = figs[item.flawedIdx];
    drawFigure(figs[1 - item.flawedIdx], c, true);
    drawFigure(flawed, c, false);
    highlightPart(flawed, item.part, item.side, c.accent);
    drawGhost(ghostFig, c.muted);
    drawRuler(c, W * 0.5, flawed.topY, flawed.h);
    drawPartLabel(flawed, item, c);
    if (reveal) {
      if (reveal.pickTap) drawCross(denorm(reveal.pickTap), c.ink);
      if (reveal.locTap) drawCross(denorm(reveal.locTap), c.ink);
    }
  }

  /* ---- input: two taps per item — figure, then location ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /* One figure's tap zone. Wide enough for ±30%-flawed shoulders,
     tall enough for ±30%-flawed legs (feet end ≈ ankle + 0.22h). */
  function figureBounds(fig) {
    var h = fig.h;
    return {
      x0: fig.cx - 2.4 * h,
      x1: fig.cx + 2.4 * h,
      y0: fig.topY - 0.4 * h,
      y1: Math.max(fig.legL.ankle.y, fig.legR.ankle.y) + 0.45 * h
    };
  }

  function hitFigure(p) {
    for (var i = 0; i < 2; i++) {
      var b = figureBounds(figs[i]);
      if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return i;
    }
    return -1;
  }

  /* wrongPick now means "they needed the second look", not "the item is
     forfeit" — nothing forfeits an item any more. */
  function startReveal(pts, wrongPick, pickTap, locTap) {
    phase = 'reveal';
    guardUntil = Date.now() + 500;
    reveal = { wrongPick: wrongPick, pickTap: pickTap, locTap: locTap };
    var item = items[itemIdx];
    /* NAME THE DASHED SKELETON. The most useful thing on the reveal is the
       canon ghost drawn over the flawed figure — literally "here is what
       that part should have been", with the gap between the two lines
       being the whole error — and neither the drill nor "how to play" ever
       said what it was. On item 1 those dashes, the highlight and the
       "+30%" tag all land on a sheet that has never carried a mark, so a
       beginner reads a verdict plus decoration. Named once; after that it
       speaks for itself. */
    var msg = (wrongPick ? 'you had it second time. ' : '')
      + verdictText(item.part, item.side, item.factor)
      + ' · +' + Math.round(pts)
      + (itemIdx === 0
        ? '. the dashed skeleton over the figure is that same pose drawn to the canon, so the gap between them is the error'
        : '');
    if (itemIdx === ITEMS_PER_ROUND - 1) {
      /* the 5th score is in — report NOW, so a "new round" press
         during this reveal can never drop a completed round */
      finishRound(msg);
    } else {
      hint.textContent = msg + ' — tap for next.';
    }
    draw();
  }

  var lastPenAt = 0;
  canvas.addEventListener('pointerdown', function (ev) {
    if (!playing || !figs) return;
    if (ev.isPrimary === false) return;
    /* palm rejection: a pen always beats a palm that landed first */
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    else if (ev.pointerType === 'touch' && Date.now() - lastPenAt < 500) return;
    ev.preventDefault();
    if (Date.now() < guardUntil) return;
    var p = pointerPos(ev);
    var item = items[itemIdx];

    if (phase === 'pick') {
      var idx = hitFigure(p);
      if (idx < 0) {
        hint.textContent = itemLabel() + ' — tap one of the two figures.';
        return;
      }
      if (idx !== item.flawedIdx && !secondChance) {
        /* A wrong first tap is a look-again, not a forfeit. */
        secondChance = true;
        guardUntil = Date.now() + 350;
        hint.textContent = itemLabel() + ' — not that one; that figure is correct.' +
          ' look again and tap the other, then find the part. (naming it second time is worth ' +
          SECOND_CHANCE_PTS + ' instead of ' + PICK_PTS +
          ' — finding the part is still worth its full ' + LOC_PTS + '.)';
        draw();
        return;
      }
      pickedIdx = item.flawedIdx; /* after a second chance, only the flawed one is live */
      if (idx !== item.flawedIdx) {
        hint.textContent = itemLabel() + ' — the other one. tap the figure on the ' +
          (item.flawedIdx === 0 ? 'left' : 'right') + '.';
        return;
      }
      phase = 'locate';
      guardUntil = Date.now() + 350;
      hint.textContent = itemLabel() + ' — locked. now tap the body part that is the wrong size.';
      draw();
      return;
    }

    if (phase === 'locate') {
      /* stray taps off the locked figure reprompt, never score */
      if (hitFigure(p) !== pickedIdx) {
        hint.textContent = itemLabel() + ' — tap a spot on the locked figure.';
        return;
      }
      var flawed = figs[item.flawedIdx];
      var cp = partCapsule(flawed, item.part, item.side);
      var d = distToCapsule(p, cp.segments);
      var sc = itemScore(
        figurePickScore(pickedIdx, item.flawedIdx, secondChance),
        locationScore(d, cp.r, flawed.h, ArtDaily.startRadius(TAP_SLOP))
      );
      itemScores.push(sc);
      /* Running mean, so the HUD is alive from item 1. The "score" field
         read "–" for all five items and only filled in at the very end,
         which is a dead panel for the whole round — the three sibling
         drills that keep a running mean all fixed this. */
      hudScore.textContent = String(Math.round(roundScore(itemScores)));
      startReveal(sc, secondChance, null, { u: p.x / W, v: p.y / H });
      return;
    }

    /* reveal → next item (the last reveal already finished the round
       and set playing = false, so this never overruns the array) */
    if (itemIdx + 1 < ITEMS_PER_ROUND) {
      itemIdx += 1;
      setupItem();
    }
  });

  function finishRound(verdictMsg) {
    playing = false;
    /* the last reveal stays on the canvas so the lesson lingers */
    var res = ArtDaily.report(roundScore(itemScores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = verdictMsg + ' — round done, press "new round" to go again.';
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
  /* An unfinished round is never reported, so a stray press here threw
     away every item already spotted without a word — and this drill is
     played entirely by tapping, so a mis-tap on the button below the
     canvas is the likeliest slip there is. First press arms, second
     confirms. After the fifth item finishRound has already reported and
     cleared `playing`, so a finished round deals the next one straight
     away. */
  var btnRound = document.getElementById('btnRound');
  var btnRoundHTML = btnRound.innerHTML;
  var roundArmed = false, roundArmTimer = null;

  function disarmRoundBtn() {
    roundArmed = false;
    clearTimeout(roundArmTimer);
    btnRound.innerHTML = btnRoundHTML;
  }

  btnRound.addEventListener('click', function () {
    if (playing && itemScores.length > 0 && itemScores.length < ITEMS_PER_ROUND && !roundArmed) {
      roundArmed = true;
      btnRound.textContent = 'discard round?';
      clearTimeout(roundArmTimer);
      roundArmTimer = setTimeout(disarmRoundBtn, 2600);
      return;
    }
    disarmRoundBtn();
    newRound();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  window.addEventListener('resize', function () {
    if (!fitCanvas()) return;   /* nothing moved — the sheet already reads right */
    layoutItem(); /* same item, rebuilt at the new scale */
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
