/* ============================================================
   game.js — Cube From Plane. The sheet shows a horizon and ONE
   vertical face of a REAL cube seen through a REAL two-point
   camera: makeCube projects an actual unit cube with a pinhole
   model, and the 90° constraint ties the vanishing-point pair to
   the focal length — so the square face secretly fixes BOTH VPs
   and the truth is derivable from the sheet (the measuring-point
   construction), never an arbitrary box. The player drags three
   corner handles (far-bottom, far-top, top-back) until all nine
   visible edges converge, presses done, and the true cube is
   revealed in the accent with its construction lines to the VPs.
   Three boxes per round; the right VP pulls in each box.
   All scoring/geometry math is pure and lives up top.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'cube-from-plane';
  var ITEMS_PER_ROUND = 3;
  var HANDLE_R = 11;    /* drawn radius */
  var HIT_BASE = 26;    /* grab radius before ArtDaily.startRadius opens it */
  var ASPECT = 0.62;    /* canvas height / width — fitCanvas enforces it */
  /* Placement within 1.5% of the face diagonal counts as perfect on a pen,
     the reference hand. Every other hand gets that zone opened by
     ArtDaily.ease() — a mouse pivots at the wrist and cannot creep the way
     a nib can — and it is floored in PIXELS, because a relative tolerance
     silently halves on a phone: 1.5% of a 140px phone face diagonal is
     2.1px, below the input device's own noise, while the same rule on a
     690px sheet is a comfortable 3.1px. Mean error of 30% still scores 0
     on every device: the ramp is judgement, only the perfect zone is
     hardware. */
  var ERR_TOL = 0.015;
  var ERR_ZERO = 0.30;
  var SLOP_PX = 4;         /* hand slop floor, eased per mode */
  var SLOP_COARSE_PX = 9;  /* …and never below a fingertip on a coarse screen */

  /* The perfect zone for this hand on this sheet, as a fraction of the
     face diagonal. Pure: ease and coarse are injected. */
  function perfectZone(faceDiagPx, ease, coarse) {
    var px = Math.max(ease(SLOP_PX), coarse ? SLOP_COARSE_PX : 0);
    var rel = ease(ERR_TOL);
    if (!(faceDiagPx > 0)) return rel;
    return Math.max(rel, px / faceDiagPx);
  }

  /* ================= pure math (unit-testable) =================
     Points are {x, y} in normalized sheet space (x, y in 0..1; VPs
     may fall outside). The camera works in uniform units of sheet
     WIDTH; y is divided by ASPECT on the way out, so the geometry
     is exact at the canvas's fixed aspect and rescales cleanly.
     Scoring runs on pixel distances. */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* '#rgb'/'#rrggbb' → [r,g,b], or null */
  function hexRgb(s) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /* t of a over (1−t) of b; falls back to b when a colour won't parse,
     because b is always the AA-safe ink. */
  function mixHex(a, b, t) {
    var pa = hexRgb(a), pb = hexRgb(b);
    if (!pa || !pb) return b;
    var r = Math.round(pa[0] * t + pb[0] * (1 - t));
    var g = Math.round(pa[1] * t + pb[1] * (1 - t));
    var bl = Math.round(pa[2] * t + pb[2] * (1 - t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* Project a TRUE cube through a real pinhole camera. cam:
       hy   horizon (normalized y; the eye line, v0 = hy·ASPECT)
       vlx/vrx  the two VP x positions (normalized; may be off-sheet)
       u0   principal-point x (where the optical axis meets the sheet)
       fx/fyb   front vertical edge: x and bottom y (normalized)
       h    projected height of the front edge (normalized)
     The two horizontal cube-edge directions are perpendicular, which
     fixes the focal length from the VP pair: f² = (u0−vlx)(vrx−u0).
     The cube's front edge sits at depth z=1 (projection is scale-
     invariant), edge length s chosen so the front edge projects to h.
     Verticals stay vertical because the view direction is horizontal.
     Returns the corner set {hy,vpl,vpr,Fb,Ft,Lb,Lt,Rb,Rt,Bt}, or null
     when the requested face cannot host an on-camera cube. */
  function makeCube(cam) {
    var v0 = cam.hy * ASPECT;
    var f2 = (cam.u0 - cam.vlx) * (cam.vrx - cam.u0);
    if (!(f2 > 0)) return null;
    var f = Math.sqrt(f2);
    var t = (cam.u0 - cam.vlx) / f;      /* tan of the cube's yaw */
    var n = Math.sqrt(1 + t * t);
    var sa = t / n, ca = 1 / n;          /* right dir (ca,0,sa), left dir (−sa,0,ca) */
    var s = cam.h * ASPECT / f;          /* cube edge length, world units */
    var xF = (cam.fx - cam.u0) / f;
    var yb = (cam.fyb * ASPECT - v0) / f;
    var yt = yb - s;
    if (!(yt > 0)) return null;          /* cube would poke above eye level */
    var zL = 1 + s * ca, zR = 1 + s * sa, zB = 1 + s * (ca + sa);
    function pr(x, y, z) { return { x: cam.u0 + f * x / z, y: (v0 + f * y / z) / ASPECT }; }
    return {
      hy: cam.hy,
      vpl: { x: cam.vlx, y: cam.hy },
      vpr: { x: cam.vrx, y: cam.hy },
      Fb: pr(xF, yb, 1), Ft: pr(xF, yt, 1),
      Lb: pr(xF - s * sa, yb, zL), Lt: pr(xF - s * sa, yt, zL),
      Rb: pr(xF + s * ca, yb, zR), Rt: pr(xF + s * ca, yt, zR),
      Bt: pr(xF + s * (ca - sa), yt, zB),
    };
  }

  /* Random camera for item i (0..2). The right VP pulls in hard on the
     last item, so foreshortening ramps within the round. rnd injected. */
  function sampleCam(i, rnd) {
    var hy = rnd(0.22, 0.30);
    var fyb = rnd(0.84, 0.92);
    var h = Math.min(rnd(0.38, 0.50), fyb - hy - 0.15);
    var vlx, vrx, fx;
    if (i === 0) { vlx = rnd(-1.3, -0.8); vrx = rnd(1.8, 2.3); fx = rnd(0.44, 0.56); }
    else if (i === 1) { vlx = rnd(-0.9, -0.5); vrx = rnd(1.35, 1.75); fx = rnd(0.42, 0.56); }
    else { vlx = rnd(-1.8, -1.2); vrx = rnd(0.88, 1.05); fx = rnd(0.34, 0.46); }
    var u0 = rnd(Math.max(0.30, vlx + 0.35), Math.min(0.62, vrx - 0.28));
    return { hy: hy, vlx: vlx, vrx: vrx, u0: u0, fx: fx, fyb: fyb, h: h };
  }

  /* every visible corner on-sheet with margin, back edge clear of the
     horizon, left face wide enough to read as a square. minW is a floor
     on that width in NORMALIZED units — the caller raises it on a narrow
     sheet so the given face never shrinks below a readable pixel size. */
  function cubeFits(b, minW) {
    var pts = [b.Fb, b.Ft, b.Lb, b.Lt, b.Rb, b.Rt, b.Bt], i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.x < 0.05 || p.x > 0.95 || p.y < 0.04 || p.y > 0.97) return false;
    }
    if (b.Bt.y < b.hy + 0.04) return false;
    if (b.Lb.x > b.Fb.x - (minW > 0 ? minW : 0.09)) return false;
    return true;
  }

  /* hand-verified safe cameras, one per item, for the rare case every
     random sample rejects — keeps genCube total without loosening fits */
  var FALLBACK_CAMS = [
    { hy: 0.26, vlx: -1.0, vrx: 2.0, u0: 0.50, fx: 0.50, fyb: 0.88, h: 0.44 },
    { hy: 0.26, vlx: -0.7, vrx: 1.55, u0: 0.52, fx: 0.48, fyb: 0.88, h: 0.44 },
    { hy: 0.26, vlx: -1.5, vrx: 0.95, u0: 0.45, fx: 0.40, fyb: 0.88, h: 0.44 },
  ];

  function genCube(i, rnd, minW) {
    var tries, box;
    for (tries = 0; tries < 40; tries++) {
      box = makeCube(sampleCam(i, rnd));
      if (box && cubeFits(box, minW)) return box;
    }
    return makeCube(FALLBACK_CAMS[i]);
  }

  /* Spec: err_i = dist(placed, true) / faceDiagonal (with a small
     perfect-zone tol, wider on touch); item = 100 · clamp(1 −
     mean(err)/0.30, 0, 1). */
  function itemScore(dists, faceDiag, tol) {
    if (!dists.length || !(faceDiag > 0)) return 0; /* degenerate → worst, never NaN */
    /* The distances were already guarded and the diagonal was already
       guarded — the TOLERANCE was not, and it is the one argument that is
       computed rather than measured. A non-finite tol makes `e - t` NaN,
       NaN survives Math.max, and clamp() passes NaN straight through
       (NaN < lo and NaN > hi are both false), so the whole item scored
       NaN — which report() then files as a 0 the player did not earn. It
       cannot happen through perfectZone() today, because ArtDaily.ease()
       promises a finite positive number; this is the promise being kept
       on this side of the boundary too, the same way the distances are.
       A tolerance that cannot be read is no tolerance: fall back to the
       pen standard rather than to a number that poisons the arithmetic. */
    var t = (tol == null) ? ERR_TOL : Number(tol);
    if (!(isFinite(t) && t >= 0)) t = ERR_TOL;
    var sum = 0;
    for (var i = 0; i < dists.length; i++) {
      var e = dists[i] / faceDiag;
      if (!isFinite(e)) e = ERR_ZERO; /* unreadable distance counts as a full miss */
      sum += Math.max(0, e - t);
    }
    return 100 * clamp(1 - (sum / dists.length) / ERR_ZERO, 0, 1);
  }

  function roundScore(itemScores) {
    if (!itemScores.length) return 0;
    var sum = 0;
    for (var i = 0; i < itemScores.length; i++) {
      sum += isFinite(itemScores[i]) ? itemScores[i] : 0;
    }
    return Math.round(clamp(sum / itemScores.length, 0, 100));
  }

  /* How far a ghost start sits from the truth, as a fraction of the face
     diagonal. GHOST_MIN is a floor the construction below *guarantees*,
     and it is what makes "press done without touching anything" score
     badly: three dots each GHOST_MIN off give 100·(1 − (0.25 − tol)/0.30)
     — about 22 by mouse, 28 by finger. Zero effort can never beat 30. */
  var GHOST_MIN = 0.25, GHOST_MAX = 0.33, GHOST_PUSH = 0.28;

  /* Ghost starts: plausible-but-wrong, GHOST_MIN–GHOST_MAX of the face
     diagonal off the truth, kept on-sheet and un-crowded. Pixel space,
     rnd injected. Guaranteed never to hand out free points: if sampling
     can't clear the truth (heavy clamping in a corner) the ghost is
     pushed toward the sheet centre, which is the direction that always
     has room, and if even that lands short it falls back to the farthest
     sheet corner — which always clears the floor, since the face diagonal
     is shorter than the sheet's. */
  function ghostSpots(truthPx, diagPx, w, hgt, rnd, tol) {
    var out = [], i, g, tries, a, m, j, minSep, best, bestQ, cx, cy, cl, k, cor, cand, push;
    /* The whole perfect zone is added on top of the floor, so opening that
       zone for a hand can never turn "press done without touching
       anything" into free points: zero effort still lands 0–17. */
    var lo = GHOST_MIN + (tol > 0 ? tol : 0), hi = GHOST_MAX + (tol > 0 ? tol : 0);
    var floor = lo * diagPx;
    for (i = 0; i < truthPx.length; i++) {
      best = null; bestQ = -Infinity;
      for (tries = 0; tries < 24; tries++) {
        a = rnd(0, Math.PI * 2);
        m = rnd(lo, hi) * diagPx;
        g = {
          x: clamp(truthPx[i].x + Math.cos(a) * m, 16, w - 16),
          y: clamp(truthPx[i].y + Math.sin(a) * m, 16, hgt - 16),
        };
        /* negative when a spacing rule is violated */
        minSep = dist(g, truthPx[i]) - floor;
        for (j = 0; j < out.length; j++) minSep = Math.min(minSep, dist(g, out[j]) - 44);
        if (minSep >= 0) { best = g; break; }      /* satisfies every rule */
        if (minSep > bestQ) { bestQ = minSep; best = g; } /* else keep least-bad */
      }
      if (dist(best, truthPx[i]) < floor) {
        cx = w / 2 - truthPx[i].x; cy = hgt / 2 - truthPx[i].y;
        cl = Math.hypot(cx, cy);
        if (!(cl > 1e-6)) { cx = 1; cy = 0; cl = 1; } /* dead centre: any way out will do */
        /* the push has to clear the floor the perfect zone just raised */
        push = Math.max(GHOST_PUSH, lo + 0.03) * diagPx;
        best = {
          x: clamp(truthPx[i].x + (cx / cl) * push, 16, w - 16),
          y: clamp(truthPx[i].y + (cy / cl) * push, 16, hgt - 16),
        };
      }
      if (dist(best, truthPx[i]) < floor) {
        cor = [{ x: 16, y: 16 }, { x: w - 16, y: 16 }, { x: 16, y: hgt - 16 }, { x: w - 16, y: hgt - 16 }];
        for (k = 0; k < cor.length; k++) {
          cand = cor[k];
          if (dist(cand, truthPx[i]) > dist(best, truthPx[i])) best = cand;
        }
      }
      out.push(best);
    }
    return out;
  }

  /* WHICH WAY, not just how far. The reveal's one sentence said "furthest
     off: dot 2 (far top), 37px" — a magnitude in a unit nobody has a feel
     for, and nothing a hand can act on. The direction is what a beginner
     needs and it costs one subtraction: the dot was above and left of
     where it belonged, so next time it goes down and right. Pure: a screen
     delta in, plain words out. The 3px dead zone keeps "left of" off a
     placement that is, for reading purposes, dead on. */
  function offsetWords(dx, dy) {
    var out = [];
    /* An unreadable delta says NOTHING rather than "right on top of it" —
       a degenerate round must not be able to congratulate the player. */
    if (!isFinite(dx) || !isFinite(dy)) return '';
    if (Math.abs(dy) >= 3) out.push(dy < 0 ? 'above' : 'below');
    if (Math.abs(dx) >= 3) out.push(dx < 0 ? 'left of' : 'right of');
    if (!out.length) return 'right on top of the true corner';
    return out.join(' and ') + ' the true corner';
  }

  /* ================= canvas / DOM ================= */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnDone = document.getElementById('btnDone');
  var btnRound = document.getElementById('btnRound');

  ArtDaily.init({ slug: SLUG });

  /* surface the keyboard scheme only where a keyboard is plausible */
  var KEYS_HINT = !!(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
  var COARSE = (function () {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  })();
  /* the dots are numbered on the sheet, so feedback can point at one */
  var HANDLE_NAMES = ['dot 1 (far bottom)', 'dot 2 (far top)', 'dot 3 (top back)'];

  /* First-ever visit: two boxes, not three. Three boxes × three dots is
     2–3 minutes before a single reported number, which is a long time to
     ask of someone deciding whether this is for them. */
  var FIRST_VISIT = ArtDaily.best() === null;
  var itemsThisRound = ITEMS_PER_ROUND;

  function ease(v) { return ArtDaily.ease(v); }

  /* Grab reach. A screenless pen tablet acquires this target blind — the
     hand is out of sight — so ArtDaily.startRadius gives it the widest
     zone; a coarse pointer never drops below the 44px the sheet's own CSS
     enforces for buttons. */
  function hitR() { return Math.max(ArtDaily.startRadius(HIT_BASE), COARSE ? 24 : 20); }

  /* the perfect zone for the hand in play, on this sheet */
  function tolFor(faceDiagPx) { return perfectZone(faceDiagPx, ease, COARSE); }

  /* ---- theme-aware inks ----
     Every ink is a custom property on :root and the ONLY thing that moves
     them is the data-theme attribute (see css/style.css), so reading them
     once per theme gives the same answer as reading them once per repaint
     — minus a forced style recalculation, and an accent colour mix, on
     every pointermove of every drag. An empty read (stylesheet not parsed
     yet) is never cached, so a cold boot corrects itself next frame. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var ink = cs.getPropertyValue('--ink').trim();
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--mint').trim();
    var c = {
      ink: ink,
      muted: cs.getPropertyValue('--muted').trim(),
      accent: accent,
      /* accent inked toward graphite — AA on both papers where raw accent isn't */
      accentInk: mixHex(accent, ink, 0.55),
    };
    if (c.ink && c.muted) { inkCache = c; inkTheme = t; }
    return c;
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ----
     Assigning canvas.width BLANKS the sheet, so it is only assigned when
     something really moved: a phone fires `resize` on every pixel of
     address-bar slide, at an unchanged width, and each one used to
     reallocate the backing store and redraw the whole cube. */
  var W = 0, H = 0, fitDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.round(w * ASPECT);
    var dpr = window.devicePixelRatio || 1;
    if (w === W && h === H && dpr === fitDpr) return false;
    W = w; H = h; fitDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function px(pt) { return { x: pt.x * W, y: pt.y * H }; }

  /* ---- round state ---- */
  var round = 0, idx = 0, items = [], scores = [], roundOver = true;
  var activeHandle = 0;
  var touchedAny = false; /* has this round any work worth protecting? */

  /* ---- where an item's numbers come from -------------------------------
     THE ROUND'S CONTENT IS A SEQUENCE OF NORMALISED DRAWS. Round 1 of a
     sitting is dealt from ArtDaily.roundRandom — seeded from today and
     this slug — so every player gets the same boxes today and a score
     finally has a denominator. Round 2 and on are practice: same
     generator, same distribution, unshared seed.

     ONE STREAM PER ITEM, because BOTH generators below are REJECTION
     SAMPLERS whose draw count is a function of the canvas. genCube retries
     up to 40 times against cubeFits(minW), and the caller raises minW on a
     narrow sheet (46px of given face, whatever W is); ghostSpots retries up
     to 24 times against pixel clamps (16px off the edge, 44px apart). A
     phone and a desktop can therefore burn a different NUMBER of draws on
     item 0 — and on one rolling generator that slides item 1 and item 2
     along by that difference, so the two players are not playing the same
     round any more. Asked per index, a divergence inside item N stays
     inside item N. Every stream is the same generator with the same
     uniform output, so nothing about the shape of these values moves.

     No per-item draw cache is needed here (unlike the lines pilot): the
     three items are dealt once in newRound and a resize only rescales,
     since the box is stored normalized. */
  var itemRng = Math.random;

  /* Unchanged as a function — lo + u * (hi - lo) is exactly what it always
     was, with Math.random() swapped for the round's uniform, which is
     uniform on [0,1) just the same. Still injected into the pure
     generators above, so they stay canvas-free and testable. */
  function rnd(lo, hi) { return lo + itemRng() * (hi - lo); }

  function newItem(i) {
    /* Re-seeded for THIS item, before a single value is drawn.
       GUARDED, and the guard is load-bearing: index.html cache-busts its
       own scripts with ?v=, but every drill loads ../sdk/artdaily-sdk.js
       BARE, so the two cache independently. A returning visitor with a warm
       old SDK and a cold copy of this file would call a function that does
       not exist, and newRound would throw before the first box was built —
       blank sheet, "–" in the HUD. Falling back to Math.random costs today's
       player nothing but a non-comparable round, which is what they had
       yesterday, and it self-heals when the SDK's max-age expires. */
    itemRng = (window.ArtDaily && ArtDaily.roundRandom)
      ? ArtDaily.roundRandom(round, i)
      : Math.random;
    /* on a narrow sheet the given face must stay wide enough to read: 46px
       of it, whatever the canvas is */
    var box = genCube(i, rnd, Math.max(0.09, 46 / Math.max(1, W)));
    var truthPx = [px(box.Rb), px(box.Rt), px(box.Bt)];
    var diagPx = dist(px(box.Fb), px(box.Lt));
    var ghosts = ghostSpots(truthPx, diagPx, W, H, rnd, tolFor(diagPx));
    return {
      box: box,
      /* handle order: 0 far-bottom (Rb), 1 far-top (Rt), 2 top-back (Bt) */
      place: ghosts.map(function (g) { return { x: g.x / W, y: g.y / H }; }),
      phase: 'edit',
    };
  }

  function newRound() {
    var k;
    round += 1;
    idx = 0;
    scores = [];
    roundOver = false;
    activeHandle = 0;
    touchedAny = false;
    disarmRoundBtn();
    /* kill any live drag so a stale pointer can't grab the new box */
    if (dragPointer !== null) {
      try { canvas.releasePointerCapture(dragPointer); } catch (e) {}
    }
    dragPointer = null;
    dragIdx = -1;
    itemsThisRound = (FIRST_VISIT && round === 1) ? 2 : ITEMS_PER_ROUND;
    items = [];
    for (k = 0; k < itemsThisRound; k++) items.push(newItem(k));
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    btnDone.hidden = false;
    setDoneLabel('done', '✓');
    /* one primary CTA while a round is live: done */
    btnRound.classList.remove('btn-primary');
    /* verbs, not nouns: "vanishing point" is what the reveal DRAWS, so the
       picture gets to define it. The first screen just says what to do. */
    hint.textContent = 'box 1/' + itemsThisRound +
      ' — drag dots 1·2·3 until the box looks solid: each edge you move should aim ' +
      'off toward the same far-off point as the matching edge of the face already drawn. ' +
      'press near a dot and it still picks it up.';
    draw();
  }

  /* The glyph on the primary button is DECORATION. Writing "done ✓" and
     "next ▸" straight into textContent made a screen reader announce the
     first control of the drill as "done check mark" and then "next black
     right-pointing small triangle" — the markup wraps every other glyph in
     the drill (the ↻ on "new round") in aria-hidden for exactly this
     reason, and the primary CTA, the one a beginner meets first, was the
     one that did not. Same shape the sibling drills use. */
  function setDoneLabel(txt, sym) {
    btnDone.textContent = sym ? txt + ' ' : txt;
    if (!sym) return;
    var s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = sym;
    btnDone.appendChild(s);
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function seg(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

  /* The full name where the sheet can hold it (both marks plus a
     chevron and its gap), the old abbreviation on a sheet that cannot.
     Measured, not guessed — a 10px mono glyph is not the same width on
     every platform. */
  function vpLabel() {
    ctx.save();
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    var w = ctx.measureText('vanishing point →').width;
    ctx.restore();
    return (w + 22 <= 0.5 * W) ? 'vanishing point' : 'vp';
  }

  /* An × where a vanishing point is on the sheet, a chevron at the sheet
     edge (on the horizon) where it lies beyond. */
  function drawVpMark(c, v, hyPx, label) {
    ctx.strokeStyle = c.accentInk;
    ctx.fillStyle = c.accentInk;
    ctx.lineWidth = 1.5;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    if (v.x >= 6 && v.x <= W - 6) {
      seg({ x: v.x - 5, y: v.y - 5 }, { x: v.x + 5, y: v.y + 5 });
      seg({ x: v.x - 5, y: v.y + 5 }, { x: v.x + 5, y: v.y - 5 });
      /* An on-sheet VP is always the RIGHT one (vlx is negative by
         construction), so a label pinned left of it at v.x + 8 runs off
         the sheet the moment it is longer than "vp" — which is exactly
         what naming the thing properly makes it. Flip to the other side
         when it will not fit, and never let either end leave the sheet. */
      var lw = ctx.measureText(label).width;
      if (v.x + 8 + lw <= W - 4) {
        ctx.textAlign = 'left';
        ctx.fillText(label, v.x + 8, v.y + 13);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(label, Math.max(Math.min(v.x - 8, W - 4), Math.min(lw + 4, W)), v.y + 13);
      }
      ctx.textAlign = 'left';   /* leave the context as the other branch does */
    } else {
      var right = v.x > W - 6;
      var ex = right ? W - 8 : 8, dir = right ? 1 : -1;
      seg({ x: ex - dir * 7, y: hyPx - 4 }, { x: ex, y: hyPx });
      seg({ x: ex, y: hyPx }, { x: ex - dir * 7, y: hyPx + 4 });
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText(right ? label + ' →' : '← ' + label, ex - dir * 10, hyPx + 13);
      ctx.textAlign = 'left';
    }
  }

  /* ---- repaint scheduling ----
     A trackpad or a pen hands over positions faster than the screen shows
     them. Repainting synchronously inside every pointermove redrew the
     whole cube — two vanishing points, every edge, the ghosts, the labels
     — several times inside one displayed frame, and only the last of those
     was ever seen. draw() now just ASKS for the next frame; paint() runs
     once, right before the browser composites. */
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
    var item = items[idx];
    if (!item) return;
    var b = item.box;
    var vpl = px(b.vpl), vpr = px(b.vpr);
    var Fb = px(b.Fb), Ft = px(b.Ft), Lb = px(b.Lb), Lt = px(b.Lt);
    var tRb = px(b.Rb), tRt = px(b.Rt), tBt = px(b.Bt);
    var pRb = px(item.place[0]), pRt = px(item.place[1]), pBt = px(item.place[2]);
    var hyPx = b.hy * H;
    var reveal = item.phase === 'reveal';

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* horizon */
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    seg({ x: 0, y: hyPx }, { x: W, y: hyPx });
    ctx.setLineDash([]);
    ctx.fillStyle = c.muted;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('eye level', W - 8, hyPx - 5);
    ctx.textAlign = 'left';

    if (reveal) {
      /* construction lines: each converging edge extended to its VP */
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.25;
      seg(Lb, vpl); seg(Lt, vpl);
      seg(tRb, vpr); seg(tRt, vpr);
      seg(tBt, vpr); seg(tBt, vpl);
      ctx.globalAlpha = 1;
      /* The edit screen teaches this with a picture and the words "these
         edges aim here"; the reveal then marked the same idea "vp" — a
         two-letter abbreviation of a term the drill never spells out
         anywhere. Spell it, and fall back only when the sheet is too
         narrow to hold it. */
      var vpTag = vpLabel();
      [vpl, vpr].forEach(function (v) { drawVpMark(c, v, hyPx, vpTag); });
    } else {
      /* Teach the vanishing point BEFORE the first done press, with a
         picture rather than a word: the two edges of the face you were
         GIVEN, extended until they meet. The reveal draws exactly this for
         the dots you place; showing one of them up front is what turns
         "aim at its vanishing point" from jargon into something visible.
         It gives nothing away — this is the other VP from the one the
         dots hang off. */
      ctx.save();
      ctx.strokeStyle = c.accentInk;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      seg(Lb, vpl); seg(Lt, vpl);
      ctx.restore();
      /* full alpha: accentInk is the AA-safe weight on both papers, and a
         label that teaches the drill's central term must be readable */
      drawVpMark(c, vpl, hyPx, 'these edges aim here');
    }

    /* the given front-left face, lightly shaded */
    ctx.beginPath();
    ctx.moveTo(Fb.x, Fb.y); ctx.lineTo(Ft.x, Ft.y); ctx.lineTo(Lt.x, Lt.y); ctx.lineTo(Lb.x, Lb.y);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.stroke();

    /* the player's five edges — tinted toward the accent during edit so
       "yours" reads apart from the given face at a glance; muted during
       reveal so the truth pops */
    ctx.strokeStyle = reveal ? c.muted : c.accentInk;
    ctx.globalAlpha = reveal ? 0.7 : 1;
    ctx.lineWidth = 2;
    seg(Fb, pRb); seg(Ft, pRt); seg(pRb, pRt); seg(Lt, pBt); seg(pRt, pBt);
    ctx.globalAlpha = 1;

    if (reveal) {
      /* true cube + delta whiskers to the placed dots. accentInk, not raw
         accent: the answer is the one thing that must never be marginal,
         and raw mint sits at ~2.9:1 on the paper card. */
      ctx.strokeStyle = c.accentInk;
      ctx.lineWidth = 2.5;
      seg(Fb, tRb); seg(Ft, tRt); seg(tRb, tRt); seg(Lt, tBt); seg(tRt, tBt);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      seg(pRb, tRb); seg(pRt, tRt); seg(pBt, tBt);
      ctx.setLineDash([]);
      ctx.fillStyle = c.accentInk;
      [tRb, tRt, tBt].forEach(function (p) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
      });
    } else {
      /* handles: the fill is a decorative tint, the ring is the affordance,
         so the ring gets the AA-safe ink on both papers */
      [pRb, pRt, pBt].forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
        ctx.fillStyle = c.accent;
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.accentInk;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = c.ink;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        /* numbered on the sheet for everyone, not only where a keyboard is
           plausible: the feedback line names the dot it blames, and the
           player has to be able to see which one that is. */
        ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), p.x + HANDLE_R + 3, p.y);
        ctx.textBaseline = 'alphabetic';
        if (i === activeHandle) {
          ctx.strokeStyle = c.accentInk;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_R + 5, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });
      if (KEYS_HINT) {
        ctx.fillStyle = c.muted;
        ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('keys: 1/2/3 pick a dot · arrows nudge · enter = done', 8, H - 8);
      }
    }
  }

  /* ---- input: drag handles (pointerId-guarded, grab-offset so a
     re-grab never warps your dot), keyboard nudges ---- */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function moveHandle(i, p) {
    var item = items[idx];
    if (!item) return;
    item.place[i] = { x: clamp(p.x, 10, W - 10) / W, y: clamp(p.y, 10, H - 10) / H };
    touchedAny = true;
    draw();
  }

  var dragPointer = null, dragIdx = -1, dragOff = { x: 0, y: 0 };
  var dragType = '', lastPenAt = 0;

  /* Palm rejection. pointerId guarding alone only rejects the SECOND
     contact — on a tablet the palm usually lands FIRST — so a pen press
     takes the sheet off a touch that is mid-drag, and a touch press is
     ignored for a moment after any pen. */
  function palmBlocked(ev) {
    return ev.pointerType === 'touch' && lastPenAt && (Date.now() - lastPenAt) < 1200;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    var item = items[idx];
    if (roundOver || !item || item.phase !== 'edit') return;
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (palmBlocked(ev)) return;
    if (dragPointer !== null) {
      if (!(ev.pointerType === 'pen' && dragType === 'touch')) return;
      try { canvas.releasePointerCapture(dragPointer); } catch (e) {}
      dragPointer = null;
      dragIdx = -1;
    }
    ev.preventDefault();
    /* preventDefault suppresses click-to-focus; restore it so the
       keyboard nudges work right after a grab */
    try { canvas.focus({ preventScroll: true }); } catch (e) { canvas.focus(); }
    var p = pointerPos(ev);
    var reach = hitR();
    var bestI = -1, bestD = reach, i, d;
    for (i = 0; i < 3; i++) {
      d = dist(p, px(item.place[i]));
      if (d < bestD) { bestD = d; bestI = i; }
    }
    /* Snap rather than refuse. A press up to 3× the reach takes the
       nearest dot — a screenless tablet cannot see its own hand, and a
       silent `return` there reads as "the page is frozen". The grab offset
       is kept, so the dot never teleports: press roughly, drag precisely. */
    if (bestI < 0) {
      bestD = 3 * reach;
      for (i = 0; i < 3; i++) {
        d = dist(p, px(item.place[i]));
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI < 0) {
        hint.textContent = 'nothing to grab there — the three dots are numbered 1 · 2 · 3. ' +
          'press near one (near counts) and drag it.';
        return;
      }
    }
    dragPointer = ev.pointerId;
    dragType = ev.pointerType;
    dragIdx = bestI;
    activeHandle = bestI;
    /* grab-offset: the dot stays put on grab and follows relative to
       where you took hold — no teleport under the finger */
    var hp = px(item.place[bestI]);
    dragOff = { x: hp.x - p.x, y: hp.y - p.y };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (dragPointer === null || ev.pointerId !== dragPointer) return;
    ev.preventDefault();
    var p = pointerPos(ev);
    moveHandle(dragIdx, { x: p.x + dragOff.x, y: p.y + dragOff.y });
  });

  function endDrag(ev) {
    if (dragPointer === null || ev.pointerId !== dragPointer) return;
    dragPointer = null;
    dragType = '';
    dragIdx = -1;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  /* a pointerup lost outside the canvas used to freeze the box until
     "new round", because pointerdown returns early while one is in flight */
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('keydown', function (ev) {
    var item = items[idx];
    if (roundOver || !item) return;
    if (ev.key === 'Enter') { ev.preventDefault(); onDone(); return; }
    if (item.phase !== 'edit') return;
    if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
      activeHandle = Number(ev.key) - 1;
      draw();
      return;
    }
    var step = ev.shiftKey ? 1 : 4, dx = 0, dy = 0;
    if (ev.key === 'ArrowLeft') dx = -step;
    else if (ev.key === 'ArrowRight') dx = step;
    else if (ev.key === 'ArrowUp') dy = -step;
    else if (ev.key === 'ArrowDown') dy = step;
    else return;
    ev.preventDefault();
    var cur = px(item.place[activeHandle]);
    moveHandle(activeHandle, { x: cur.x + dx, y: cur.y + dy });
  });

  /* ---- done → score item → reveal → next / finish ---- */
  function onDone() {
    var item = items[idx];
    if (roundOver || !item) return;
    if (item.phase === 'edit') {
      var t = [px(item.box.Rb), px(item.box.Rt), px(item.box.Bt)];
      var p = item.place.map(px);
      var ds = [dist(p[0], t[0]), dist(p[1], t[1]), dist(p[2], t[2])];
      var faceDiag = dist(px(item.box.Fb), px(item.box.Lt));
      var s = itemScore(ds, faceDiag, tolFor(faceDiag));
      var wi = 0;
      if (ds[1] > ds[wi]) wi = 1;
      if (ds[2] > ds[wi]) wi = 2;
      var dpx = isFinite(ds[wi]) ? Math.round(ds[wi]) : null;
      var way = offsetWords(p[wi].x - t[wi].x, p[wi].y - t[wi].y);
      var worst = 'furthest off: ' + HANDLE_NAMES[wi] +
        (dpx === null ? '' : ' — ' + dpx + 'px') +
        (way ? (dpx === null ? ' — ' : ', ') + way : '');
      scores.push(s);
      item.phase = 'reveal';
      if (idx === itemsThisRound - 1) {
        finishRound(worst);
      } else {
        setDoneLabel('next', '▸');
        hint.textContent = 'true cube revealed — this box: ' + Math.round(s) + '. ' + worst + '. press next.';
        showToast('box ' + (idx + 1) + ': ' + Math.round(s));
      }
      draw();
      return;
    }
    idx += 1;
    activeHandle = 0;
    setDoneLabel('done', '✓');
    hint.textContent = 'box ' + (idx + 1) + '/' + itemsThisRound + ' — ' +
      (idx === 2
        ? 'this one is turned sharply away, so the right-hand side gets narrow fast. ' +
          'done when it reads solid.'
        : 'drag dots 1 · 2 · 3, then press done.');
    draw();
  }

  function finishRound(worstNote) {
    roundOver = true;
    btnDone.hidden = true;
    btnRound.classList.add('btn-primary');
    var res = ArtDaily.report(roundScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    hint.textContent = 'last box: ' + Math.round(scores[scores.length - 1]) + ' (' + worstNote +
      ') — round done, press “new round” to go again.';
    /* A first-ever round has no previous best, so isNewBest is
       trivially true and "new best!" celebrates nothing — on the one
       round where the number most needs saying what it IS. The SDK
       marks that round with isFirst; an older vendored SDK simply
       leaves it undefined and the old wording stands. */
    showToast(res.isFirst
      ? 'first score ' + res.score + ' / 100 — your mark to beat'
      : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest && !res.isFirst);
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
  btnDone.addEventListener('click', onDone);

  /* "new round" arms first when it would throw away a live round — a
     second press within the window confirms, otherwise it snaps back.
     A mis-tap on a three-box round should never cost you the round. */
  var roundArmTimer = null, roundArmed = false;
  function disarmRoundBtn() {
    roundArmed = false;
    clearTimeout(roundArmTimer);
    btnRound.innerHTML = 'new round <span aria-hidden="true">↻</span>';
  }
  btnRound.addEventListener('click', function () {
    if (!roundOver && (touchedAny || idx > 0) && !roundArmed) {
      roundArmed = true;
      btnRound.textContent = 'discard round?';
      roundArmTimer = setTimeout(disarmRoundBtn, 2600);
      return;
    }
    newRound(); /* newRound disarms */
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; paintNow(); });
  /* the hardware can change mid-session (a laptop user plugs in a tablet);
     the reach and the perfect zone follow it */
  ArtDaily.onInput(draw);
  /* geometry is stored normalized, so a resize just rescales the sheet —
     and a resize that changed nothing does not even do that */
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      if (fitCanvas()) paintNow();
    });
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
