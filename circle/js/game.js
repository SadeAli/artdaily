/* ============================================================
   game.js — Full Circle: draw one freehand circle, in one stroke,
   and lift. Six a round, roughly forty seconds.

   The whole drill is closed-form geometry. A least-squares circle
   is fitted to the sampled stroke (Kåsa, derived in fitCircle
   below), and the score is the radial deviation from that fitted
   circle, RMS'd ALONG THE LINE and divided by the fitted radius —
   so a small circle and a big one are judged on exactly the same
   scale, and so is a fast hand and a slow one. Nothing is compared
   against a stored answer, a model, or another player.

   Closure is scored explicitly, because a stroke that stops
   three-quarters of the way round is not a circle:
     · under MIN_TURNS of a full turn the stroke is NOT SCORED at
       all. It is not a penalty either — the drill says how far you
       got and draws a ring at the lift point, so a trackpad that
       ran out of pad can carry the same stroke on. `lines` refuses
       a pull that stops short of B the same way.
     · above it, the arc you are missing (or the arc you doubled,
       past a tenth of a turn of overlap, at half weight) is
       converted to pixels and costs up to CLOSE_MAX points.

   Hardware fairness (protocol v1 input profile): what this drill
   grades is EXECUTING a stroke, not finding a target, so the
   zero-point is ArtDaily.ease()d — pen 1.0, finger 1.5, mouse or
   trackpad 2.0 — and never floored against startRadius(). A wrist
   pivoting a mouse cannot creep the way a nib can. startRadius()
   is used for the one thing here that IS an acquisition: the ring
   you press inside to carry a lifted stroke on.

   Size fairness: every tolerance in the drill is a plain fraction
   of the fitted radius, with no absolute pixel term anywhere in the
   reachable range — the pixel floors that used to sit under them
   are pinned to MIN_RADIUS_PX, the smallest circle the drill will
   score at all, so they can only ever apply to a circle that is
   being refused. See the note above `band`.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'circle';
  var CIRCLES_PER_ROUND = 6;

  /* ---- what counts as a readable attempt ---- */
  var MIN_SAMPLES = 8;       /* fewer points than this has no shape to fit */
  var MIN_PATH_PX = 40;      /* a shorter path is a press with a twitch */
  /* THE SMALLEST CIRCLE THIS DRILL SCORES, as a fitted radius in pixels.
     Below it an attempt is refused — never penalised — and it is the one
     number the tolerance bands are pinned to, so that above it every
     tolerance is a plain fraction of the radius and nothing absolute
     survives to make a small circle cheaper than a big one (see `band`).
     It matches the floor inside minRadius(), which is what the sheet
     actually refuses on, so raising this from the 12px it used to be
     changes nothing a player can reach: the sheet already turned away
     everything under 40. */
  var MIN_RADIUS_PX = 40;
  var MIN_TURNS = 0.8;       /* under four fifths of a turn is not a circle */
  var OVER_FREE_TURNS = 0.10;/* overlap this far past your start is free */
  var OVER_WEIGHT = 0.5;     /* past that, an overlap costs half what a gap does */

  /* ---- roundness band, as a fraction of the FITTED radius ----
     free = still a flat 100, zero = the roundness score has run out.
     Both ends are pure fractions, which is the whole of what makes a
     60px circle and a 300px circle the same drill. */
  var FREE_REL = 0.012;
  var ZERO_REL = 0.13;

  /* ---- closure band, same shape, its own numbers ---- */
  var CLOSE_MAX = 45;               /* points a gap can cost */
  var CLOSE_FREE_REL = 0.04;
  var CLOSE_ZERO_REL = 0.75;

  /* ---- pacing ---- */
  var REVEAL_MIN_MS = 1800;         /* floor for a repeat reveal */
  var FIRST_REVEAL_MIN_MS = 4000;   /* floor for the first of the sitting */
  var MS_PER_WORD = 60000 / 200;    /* ~200 words a minute */
  var GHOSTS_KEPT = 2;

  /* ============================================================
     PURE SCORING — geometry in, numbers and words out. No canvas,
     no DOM, no state. Everything below this line lifts straight
     into node (see README.md) and must hold, for ANY input:
       · a finite 0–100, never NaN, never a throw;
       · monotonic in the error — more wrong never scores higher;
       · a perfect circle reaches 100, garbage floors near 0.
     `ease` is the multiplier from ArtDaily.ease(1).
     ============================================================ */

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* A sample flagged `gap` is the first one after the pen came back DOWN:
     the drill lets a stroke that ran out of trackpad carry on, and the
     straight run from where you lifted to where you pressed again is not
     line you drew. Every length in this file skips it. */
  function isGap(p) { return !!(p && p.gap); }

  function pathLength(pts) {
    var s = 0, i;
    if (!pts) return 0;
    for (i = 1; i < pts.length; i++) {
      /* The null guard arcWeights() right below already has. This block's own
         contract promises a finite 0-100 and never a throw, and a null element
         would have thrown on .x — unreachable from the sheet, since stroke is
         only ever fed by posIn(), but the contract is the contract. */
      if (!pts[i] || !pts[i - 1]) continue;
      if (isGap(pts[i])) continue;
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return isFinite(s) ? s : 0;
  }

  /* ---------------------------------------------------------
     ARC-LENGTH WEIGHTS — the one derivation two functions share.

     ArtDaily.samples() hands over every position the digitizer felt,
     and a digitizer samples on a CLOCK — 120 to 1000 times a second,
     see the comment on samples() in the SDK — not on a ruler. So the
     number of samples lying in a stretch of line is proportional to
     the TIME the hand spent there, which is to say inversely
     proportional to how fast it was moving. ANY sum over samples is
     therefore a sum over time, and a drill that scores the geometry
     must not have one: whip through your flat spot and it lands in
     the average a third as often as the arc beside it, the shape
     never changed, and the score goes up.

     Every average this drill takes is really an integral along the
     line, with respect to arc length s:

         mean(f) = (1/L) ∫₀ᴸ f(s) ds

     The samples are the nodes of a polyline through that line, so
     apply the trapezoid rule. One chord of length ℓᵢ between nodes i
     and i+1 contributes ℓᵢ·(fᵢ + fᵢ₊₁)/2; collect the terms belonging
     to each node and node i carries

         wᵢ = (ℓᵢ₋₁ + ℓᵢ)/2       — half the chord on each side

     with the two ENDS of the stroke carrying only the one half-chord
     they actually have, which is the whole of the end correction:
     giving an end sample a full chord would count arc that is not
     there. Sum the weights and

         Σ wᵢ = ½Σℓᵢ₋₁ + ½Σℓᵢ = L

     exactly, so dividing by Σ wᵢ divides by the length of the line
     and by nothing else.

     Zero chords, twice over. A duplicate or coincident sample has
     zero chord on both sides, so its weight is zero and it does not
     vote — which is exactly right (it adds no line) and incidentally
     closes the pause exploit: holding still on a good part of the
     stroke used to stack every average with free copies of one good
     sample. And a stroke whose samples are ALL coincident has L = 0,
     where the integral is not defined at all; there the weights fall
     back to uniform, which is what the integral degenerates to when
     every sample sits in the same place. Neither case produces 0/0.

     Lifts. A stroke that ran out of trackpad can be carried on, and the
     run from where the pen lifted to where it pressed again is not line
     that was drawn — under a count it was one sample among hundreds and
     did not matter, under a weight it is a chord up to a resume ring
     wide and would matter a great deal. So a sample flagged `gap` gets
     no chord INTO it: the samples either side of a lift are the ends of
     their own segments and carry the one half-chord each really has, and
     L is the length of the segments the pen actually drew. Measured in
     the node harness on a circle carried on after a lift, the flag is
     worth 3-10 points across the whole width of the resume ring (r=150,
     pressing back down 10/30/45/60px off the line: 100/100/94.4/87.8
     flagged against 100/96.7/87.8/79.4 unflagged) — and what is left is
     the deviation the player really drew by landing wide, which still
     costs, as it should.

     `at` is how far along the line each sample sits, which is how the
     stroke gets quartered by ARC rather than by index.

     Total: a null point or a non-finite coordinate makes a chord of
     length zero rather than a NaN weight. */
  function arcWeights(pts) {
    var n = pts.length, i, c, L = 0;
    var chord = new Array(n), at = new Array(n), w = new Array(n);
    for (i = 0; i < n; i++) {
      at[i] = L;
      c = 0;
      if (i < n - 1 && pts[i] && pts[i + 1] && !isGap(pts[i + 1])) {
        c = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (!(isFinite(c) && c > 0)) c = 0;
      }
      chord[i] = c;
      L += c;
    }
    var byArc = isFinite(L) && L > 0;
    for (i = 0; i < n; i++) {
      w[i] = byArc ? ((i > 0 ? chord[i - 1] : 0) + chord[i]) / 2 : 1;
    }
    return { w: w, chord: chord, at: at, L: L, byArc: byArc,
             span: byArc ? L : Math.max(1, n - 1) };
  }

  /* ---------------------------------------------------------
     THE FIT — least squares, derived rather than guessed.

     A circle is  (x−a)² + (y−b)² = r².  Expanded:

         x² + y² − 2ax − 2by + (a² + b² − r²) = 0

     Kåsa's insight is that with the substitution g = a²+b²−r² the
     residual

         f_i = (x_i² + y_i²) − 2a·x_i − 2b·y_i + g

     is LINEAR in the three unknowns (a, b, g), so minimising Σ w_i·f_i²
     is an ordinary linear least-squares problem with a closed-form
     answer — no iteration, no starting guess, no way to fail to
     converge. The w_i are the arc-length weights derived above, for
     the reason given there: an unweighted Σ is a sum over the clock,
     so an unweighted fit is pulled toward whichever arc the hand
     dawdled on. Weighting is a one-word change to every sum below
     and to the count they are divided by (n becomes Σ w_i = L), and
     the closed form is otherwise untouched.

     (It minimises the ALGEBRAIC distance rather than the
     true geometric one, which biases the radius very slightly when
     the samples cover only a short arc. This drill refuses to score
     anything under four fifths of a turn, which is exactly the
     regime where that bias is worth caring about.)

     Setting the three partial derivatives to zero:

    ∂/∂a: Σ w_i f_i x_i = 0   ∂/∂b: Σ w_i f_i y_i = 0   ∂/∂g: Σ w_i f_i = 0

     Work in coordinates centred on the weighted centroid, u = x − x̄
     and v = y − ȳ with x̄ = Σw·x / Σw, so Σw·u = Σw·v = 0. Writing
     W = Σ w_i and Suu = Σ w_i·u_i² (and so on for every S below), the
     third equation collapses to

         Σw(u²+v²) + W·g = 0  →   g = −(Suu + Svv)/W
                              →   r² = uc² + vc² + (Suu + Svv)/W

     and the first two become a 2×2 system in the centre (uc, vc):

         Suu·uc + Suv·vc = ½(Suuu + Suvv)
         Suv·uc + Svv·vc = ½(Svvv + Svuu)

     which Cramer's rule solves outright. Centring first is not
     cosmetic: on a canvas the raw x² terms are ~10⁶ and the
     information about the centre lives in their differences, so the
     uncentred normal equations lose most of their precision to
     cancellation.

     Returns null — never a NaN circle — for fewer than MIN_SAMPLES
     points, a non-finite coordinate, a total weight that is not
     positive, or a determinant too small to divide by, which is what
     collinear points (a straight line) and a single dot both
     produce.
     --------------------------------------------------------- */
  function fitCircle(pts) {
    if (!pts || pts.length < MIN_SAMPLES) return null;
    var n = pts.length, i;
    for (i = 0; i < n; i++) {
      /* typeof first, and no coercion: isFinite('400') is true, so a
         numeric STRING used to sail through this guard — it only ever
         failed later, and by accident, on `sx += pts[i].x` concatenating
         instead of adding. A weighted sum multiplies, which coerces, so
         the accident is gone and the guard has to be the real one. Junk
         coordinates are refused here, not scored 100. */
      if (!pts[i] || typeof pts[i].x !== 'number' || typeof pts[i].y !== 'number' ||
          !isFinite(pts[i].x) || !isFinite(pts[i].y)) return null;
    }
    var aw = arcWeights(pts), wt = aw.w;
    var W = 0, sx = 0, sy = 0;
    for (i = 0; i < n; i++) { W += wt[i]; sx += wt[i] * pts[i].x; sy += wt[i] * pts[i].y; }
    if (!isFinite(W) || W <= 0) return null;
    var mx = sx / W, my = sy / W;
    if (!isFinite(mx) || !isFinite(my)) return null;
    var Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
    for (i = 0; i < n; i++) {
      var wi = wt[i];
      var u = pts[i].x - mx, v = pts[i].y - my;
      var uu = u * u, vv = v * v;
      Suu += wi * uu; Svv += wi * vv; Suv += wi * u * v;
      Suuu += wi * uu * u; Svvv += wi * vv * v;
      Suvv += wi * u * vv; Svuu += wi * v * uu;
    }
    /* Suu + Svv is W × the weighted mean squared distance from the
       centroid: the natural scale of this stroke, and zero only when
       every sample is the same point. The determinant has units of that
       scale squared, so testing it against 1e-9 × scale² is a SCALE-FREE
       degeneracy test — a tiny circle is not mistaken for a straight
       line. Scaling the whole stroke by k scales the weights by k too,
       so both sides move by k⁶ and the test is unchanged. */
    var scale = Suu + Svv;
    if (!isFinite(scale) || scale <= 0) return null;
    var D = 2 * (Suu * Svv - Suv * Suv);
    if (!isFinite(D) || Math.abs(D) < 1e-9 * scale * scale) return null;
    var e1 = Suuu + Suvv;   /* Σ u(u²+v²) */
    var e2 = Svvv + Svuu;   /* Σ v(u²+v²) */
    var uc = (Svv * e1 - Suv * e2) / D;
    var vc = (Suu * e2 - Suv * e1) / D;
    var r2 = uc * uc + vc * vc + scale / W;
    if (!isFinite(uc) || !isFinite(vc) || !isFinite(r2) || r2 <= 0) return null;
    var r = Math.sqrt(r2);
    if (!isFinite(r) || r <= 0) return null;
    return { x: mx + uc, y: my + vc, r: r };
  }

  /* How much of a full turn the stroke actually travelled around the
     fitted centre. Signed steps, each wrapped into (−π, π], summed and
     then taken absolute — so a clockwise circle and an anticlockwise
     one read the same, and a stroke that doubles back cancels itself
     out instead of counting twice. */
  function arcTurns(pts, fit) {
    if (!fit || !pts || pts.length < 2) return 0;
    var total = 0, i, a, d;
    var prev = Math.atan2(pts[0].y - fit.y, pts[0].x - fit.x);
    for (i = 1; i < pts.length; i++) {
      a = Math.atan2(pts[i].y - fit.y, pts[i].x - fit.x);
      d = a - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      total += d;
      prev = a;
    }
    return isFinite(total) ? Math.abs(total) / (2 * Math.PI) : 0;
  }

  /* The eight compass sectors, named the way a person would say them.
     Index 0 is due right and they run anticlockwise in SCREEN terms
     (canvas y grows downward, so `top` is negative y). */
  var WHERE = ['right', 'top right', 'top', 'top left',
               'left', 'bottom left', 'bottom', 'bottom right'];

  function sectorOf(dx, dy) {
    var x = Number(dx), y = Number(dy);
    if (!isFinite(x) || !isFinite(y) || (x === 0 && y === 0)) return -1;
    var ang = Math.atan2(-y, x);                    /* screen y up-is-negative */
    if (!isFinite(ang)) return -1;
    var k = Math.round(ang / (Math.PI / 4)) % 8;
    return (k + 8) % 8;
  }

  function whereWord(dx, dy) {
    var k = sectorOf(dx, dy);
    return k < 0 ? '' : WHERE[k];
  }

  /* ---------------------------------------------------------
     EVERY RADIAL READING, IN ONE PASS — WEIGHTED BY ARC LENGTH,
     NEVER BY SAMPLE COUNT.

     Why it cannot be a count. ArtDaily.samples() hands over every
     position the digitizer felt, and a digitizer samples on a CLOCK
     — 120 to 1000 times a second, see the comment on samples() in
     the SDK — not on a ruler. So the number of samples lying in a
     stretch of line is proportional to the TIME the hand spent
     there, which is to say inversely proportional to how fast it
     was moving. Average by counting samples and you are averaging
     over time: whip through your flat spot and it lands in the mean
     a third as often as the arc beside it. The shape never changed
     and the score went up. Measured on ONE fixed path with a flat
     spot 9% of the radius deep, sampled at a constant 120Hz, before
     this was weighted: 84.0 drawn evenly, 86.5 at twice the speed
     through the flat, 89.8 at four times, 92.6 at eight. Worse, it
     inverted the drill's own coaching — roundTendency says to slow
     down through the stretch you go wrong in, and slowing to half
     speed through the flat scored 83.2, BELOW the even 84.0.

     What the drill promises instead is the RMS over the LINE, which
     is an integral with respect to arc length s:

         rms² = (1/L) ∫₀ᴸ e(s)² ds

     The samples are the nodes of a polyline through that line, so
     apply the trapezoid rule. One chord of length ℓᵢ between nodes
     i and i+1 contributes ℓᵢ·(eᵢ² + eᵢ₊₁²)/2; collect the terms
     belonging to each node and node i carries

         wᵢ = (ℓᵢ₋₁ + ℓᵢ)/2       — half the chord on each side

     with the two ENDS of the stroke carrying only the one half-chord
     they actually have, which is the whole of the end correction:
     giving an end sample a full chord would count arc that is not
     there. Sum those weights and

         Σ wᵢ = ½Σℓᵢ₋₁ + ½Σℓᵢ = L

     exactly, so dividing by Σ wᵢ divides by the length of the line
     and by nothing else. The drift and the sector means are averages
     of the same e(s) over the same line, so they take the same
     weights, and the stroke is quartered by ARC rather than by index
     for the same reason.

     Zero chords, twice over. A duplicate or coincident sample has
     zero chord on both sides, so its weight is zero and it does not
     vote — which is exactly right (it adds no line) and incidentally
     closes the pause exploit: holding still on a good part of the
     stroke used to stack the average with free copies of one good
     sample. And a stroke whose samples are ALL coincident has L = 0,
     where the integral is not defined at all; there the weights fall
     back to uniform, which is what the integral degenerates to when
     every sample sits in the same place. Neither case can produce
     0/0.

     What this deliberately does NOT change: uniform speed and
     digitizer rate were already invariant — the same stroke reads
     within a tenth of a point at 60, 120, 240, 500 and 1000Hz — and
     a trapezoid weight is a refinement of the uniform one, not a
     replacement for it, so that invariance survives untouched.

     Returns:
       rms      arc-length RMS of |distance from the fitted centre −
                fitted radius| (exactly integrated, see below)
       worst    the largest single such deviation, and where it sat
                (a maximum, so it needs no weight)
       drift    mean signed deviation of the LAST quarter of the
                stroke BY ARC minus that of the first — a circle that
                spirals open as the arm swings round has a big
                positive drift and only a middling `worst`, and that
                is a different mistake with a different fix
       sectors  mean signed deviation in each of the eight sectors,
                for the round-end tendency (null where nothing was
                drawn, or where nothing drawn there had any length)
     --------------------------------------------------------- */
  function radialRead(pts, fit) {
    if (!pts || !fit || !pts.length) return null;
    var n = pts.length, i, d, e, w;
    var aw = arcWeights(pts), wt = aw.w, chord = aw.chord, at = aw.at;
    var span = aw.span, byArc = aw.byArc;

    var dev = new Array(n), wsum = 0, worst = -1, wi = -1, wsigned = 0;
    var firstSum = 0, firstW = 0, lastSum = 0, lastW = 0;
    var secSum = [0, 0, 0, 0, 0, 0, 0, 0], secW = [0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < n; i++) {
      if (!pts[i]) return null;
      d = Math.hypot(pts[i].x - fit.x, pts[i].y - fit.y);
      e = d - fit.r;
      if (!isFinite(e)) return null;
      dev[i] = e;
      w = wt[i];
      wsum += w;
      if (Math.abs(e) > worst) { worst = Math.abs(e); wi = i; wsigned = e; }
      var p = (byArc ? at[i] : i) / span;
      if (p <= 0.25) { firstSum += e * w; firstW += w; }
      if (p >= 0.75) { lastSum += e * w; lastW += w; }
      var sec = sectorOf(pts[i].x - fit.x, pts[i].y - fit.y);
      if (sec >= 0) { secSum[sec] += e * w; secW[sec] += w; }
    }
    /* Σw is L when byArc and n when not, so it is positive by
       construction — but it is a divisor, and a divisor gets checked. */
    if (!(isFinite(wsum) && wsum > 0)) return null;

    /* THE RMS IS THE ONE READING WHOSE INTEGRAND IS QUADRATIC in e, and
       for a quadratic the node weights above are not exact — they are the
       trapezoid rule, which is exact only for something that varies
       linearly. Treating the samples as a polyline says e DOES vary
       linearly along each chord, and that integral is elementary:

           ∫₀^ℓ (eᵢ + (eᵢ₊₁ − eᵢ)·s/ℓ)² ds
                    = ℓ·(eᵢ² + eᵢ·eᵢ₊₁ + eᵢ₊₁²)/3

       — the trapezoid's ℓ·(eᵢ² + eᵢ₊₁²)/2 plus the cross term it drops.
       The two agree to a rounding error whenever e barely moves between
       samples, which is nearly every stroke; they part company exactly
       where e swings INSIDE one chord, which is the under-sampled fast
       stroke and the one-sample spike — the two cases this weighting
       exists to get right, and where the trapezoid overstates by up to
       half. (a² + ab + b² is never negative, so nothing here can put a
       negative number under the square root.) The LINEAR readings — the
       drift, the sector means, and the fit's own centroid — keep the node
       weights, where the trapezoid is exact and no cross term exists.

       No arc, no integral: fall back to the plain mean of e², which is
       what the integral degenerates to when every sample is one point. */
    var sum = 0, a, b;
    if (byArc) {
      for (i = 0; i < n - 1; i++) {
        if (!(chord[i] > 0)) continue;
        a = dev[i]; b = dev[i + 1];
        sum += chord[i] * (a * a + a * b + b * b) / 3;
      }
    } else {
      for (i = 0; i < n; i++) sum += dev[i] * dev[i];
    }
    if (!isFinite(sum) || sum < 0) return null;
    var rms = Math.sqrt(sum / wsum);
    if (!isFinite(rms) || wi < 0) return null;
    var sectors = [];
    for (i = 0; i < 8; i++) sectors.push(secW[i] > 0 ? secSum[i] / secW[i] : null);
    return {
      rms: rms,
      worst: worst,
      worstIndex: wi,
      worstSigned: wsigned,
      drift: (lastW > 0 ? lastSum / lastW : 0) - (firstW > 0 ? firstSum / firstW : 0),
      sectors: sectors,
    };
  }

  /* ---------------------------------------------------------
     A TOLERANCE BAND: A PLAIN FRACTION OF THE FITTED RADIUS, with
     only the ZERO end eased. free = still a flat 100, zero = the
     score has run out.

     There is no absolute pixel term in here, and that is the point.
     Both ends used to carry a floor — `max(1.2%·r, 1px)` and
     `ease·max(13%·r, 6px)` — and a floor is a fraction in disguise:
     `max(k·r, F)` is exactly `k·max(r, F/k)`, so it grades every
     circle below F/k as though it were bigger than it is. The two
     floors put that break-even at 83px and 46px of radius, while
     the smallest circle the SHEET accepts is 40px on a phone, so
     the whole bottom of the reachable range was being graded in a
     wider relative band than the top of it. At r=40 the band was
     2.50%/15.00% of the radius against a big circle's 1.20%/13.00%,
     and the same relative wobble bought, measured over 25 seeds:
     +11.2 points at 5% wobble, +12.0 at 8%, +13.0 at 12%. The
     reachable range on a phone sheet is r=40..148, so that was
     about twelve free points available on every single attempt —
     most of a rung of the drill's own ladder — while three separate
     pieces of copy told the player size was not scored.

     What a floor is actually FOR is the other end of the same
     problem: a pure fraction of a small enough radius is a
     sub-pixel tolerance, and a circle nobody can draw well enough
     to score is a broken drill, not a hard one. That job belongs to
     a MINIMUM RADIUS, not to a wider band — refuse the circle you
     cannot measure instead of grading it kindly — so the clamp here
     is pinned to MIN_RADIUS_PX, the smallest radius this drill
     scores at all. Above it (which is every attempt that scores)
     the band is exactly proportional to r, so the score is a
     function of deviation/radius and of nothing else, and a scaled
     copy of an attempt is the same number. Below it the clamp only
     keeps the divisor positive for input the sheet refuses anyway.
     At MIN_RADIUS_PX = 40 the free zone is 0.48px, comfortably
     above the ~0.3px RMS a whole-pixel digitizer quantises to, so
     a clean small circle can still reach 100.

     Total — a junk radius or a junk ease still comes back a usable
     band with zero > free, so nothing downstream divides by zero. */
  function band(r, ease, relFree, relZero) {
    var e = (isFinite(ease) && ease > 0) ? ease : 1;
    var R = (isFinite(r) && r > MIN_RADIUS_PX) ? r : MIN_RADIUS_PX;
    var free = relFree * R;
    var zero = e * relZero * R;
    if (!isFinite(free) || free < 0) free = relFree * MIN_RADIUS_PX;
    if (!isFinite(zero) || zero <= free) zero = free + relZero * MIN_RADIUS_PX;
    return { free: free, zero: zero };
  }

  function roundnessBand(r, ease) {
    return band(r, ease, FREE_REL, ZERO_REL);
  }
  function closureBand(r, ease) {
    return band(r, ease, CLOSE_FREE_REL, CLOSE_ZERO_REL);
  }

  /* How much arc is missing, in pixels, so the closure error is measured
     in the same units as everything else on the sheet and can be drawn.
     A stroke that runs PAST its own start is the smaller sin — the line
     is closed, it just overlaps — so a tenth of a turn of overlap is
     free and the rest costs half what a gap of the same length does. */
  function closureGapPx(turns, r) {
    var t = isFinite(turns) ? turns : 0;
    var R = (isFinite(r) && r > 0) ? r : 0;
    var short = Math.max(0, 1 - t);
    var over = Math.max(0, t - 1 - OVER_FREE_TURNS);
    var g = (short + OVER_WEIGHT * over) * 2 * Math.PI * R;
    return isFinite(g) && g > 0 ? g : 0;
  }

  function roundnessScore(rms, tol) {
    if (!isFinite(rms) || rms < 0) return 0;
    return 100 * clamp01(1 - (rms - tol.free) / (tol.zero - tol.free));
  }

  function closureLoss(gapPx, ctol) {
    if (!isFinite(gapPx) || gapPx < 0) return CLOSE_MAX;
    return CLOSE_MAX * clamp01((gapPx - ctol.free) / (ctol.zero - ctol.free));
  }

  /* THE ONE READING. Everything the drill knows about an attempt comes
     out of here — the number, the words, the picture — so the sentence
     and the score can never be two separate measurements that drift
     apart. Returns null only when the stroke cannot be read as a curve
     at all (too few samples, a straight line, a single point); the
     caller treats that as "no attempt", not as a zero. */
  function measure(points, ease) {
    var fit = fitCircle(points);
    if (!fit) return null;
    var rad = radialRead(points, fit);
    if (!rad) return null;
    var tol = roundnessBand(fit.r, ease);
    var ctol = closureBand(fit.r, ease);
    var turns = arcTurns(points, fit);
    var gap = closureGapPx(turns, fit.r);
    var loss = closureLoss(gap, ctol);
    var round = roundnessScore(rad.rms, tol);
    var tooShort = !(turns >= MIN_TURNS);
    var tooSmall = !(fit.r >= MIN_RADIUS_PX);
    var score = (tooShort || tooSmall) ? 0 : Math.max(0, Math.min(100, round - loss));
    if (!isFinite(score)) score = 0;
    /* Where the widest drift sat, and where the two ends of the stroke
       left their gap — both as offsets FROM THE FITTED CENTRE, because
       that is the frame the sector words are named in. Carried on the
       reading itself so the words never have to reach into canvas
       state, which is what makes the whole sentence testable in node. */
    var wp = points[rad.worstIndex];
    var a0 = points[0], aN = points[points.length - 1];
    return {
      fit: fit, rms: rad.rms, worst: rad.worst, worstIndex: rad.worstIndex,
      worstSigned: rad.worstSigned, drift: rad.drift, sectors: rad.sectors,
      tol: tol, ctol: ctol, turns: turns, gap: gap,
      loss: loss, roundness: round, score: score,
      tooShort: tooShort, tooSmall: tooSmall,
      worstPoint: { x: wp.x - fit.x, y: wp.y - fit.y },
      gapMid: { x: (a0.x + aN.x) / 2 - fit.x, y: (a0.y + aN.y) / 2 - fit.y },
    };
  }

  /* The 0–100 for one attempt, for anything that only wants the number
     (and for the node harness). Total for every input there is: null,
     [], two points, a straight line, NaN coordinates. */
  function circleScore(points, ease) {
    var m = measure(points, ease);
    return m ? m.score : 0;
  }

  /* ---- ONE ladder of sizes, spent by every sentence in the drill ----
     Five words, and the player learns what each is worth once. The cuts
     are placed where the SCORE changes character rather than at tidy
     fractions of the tolerance, because the adjective is printed in the
     same breath as the number: "a hair off — 71" reads as the drill
     lying, and a beginner told they were a hair off stops correcting.

     Two entry points, one ladder:
       sizeWord(d, z)  grades a distance against a tolerance
       scoreWord(s)    grades a 0–100 directly
     The band edges agree because the roundness score is
     100·(1 − (d − free)/(zero − free)) and free is about an eighth of
     zero, so d/z of 0.08 / 0.25 / 0.5 / 0.8 lands at roughly
     100 / 85 / 57 / 23 out of 100.

     Junk in, the WIDEST word out — never the flattering one. A broken
     measurement that reads "dead on" beside a 12 says the drill is
     broken, because it would be. Magnitudes must ARRIVE as numbers:
     Number(null), Number(''), Number(false) and Number([]) are all 0,
     which would land a reading that never happened on the top rung. */
  var LADDER = ['dead on', 'a hair', 'a little', 'well', 'way'];

  function sizeWord(d, z) {
    if (typeof d !== 'number' || typeof z !== 'number') return 'way';
    if (!isFinite(d) || d < 0 || !isFinite(z) || z <= 0) return 'way';
    var f = d / z;
    if (f <= 0.08) return LADDER[0];
    if (f <= 0.25) return LADDER[1];
    if (f <= 0.5) return LADDER[2];
    if (f <= 0.8) return LADDER[3];
    return LADDER[4];
  }

  function scoreWord(s) {
    if (typeof s !== 'number' || !isFinite(s)) return 'way';
    if (s >= 92) return LADDER[0];
    if (s >= 75) return LADDER[1];
    if (s >= 50) return LADDER[2];
    if (s >= 20) return LADDER[3];
    return LADDER[4];
  }

  /* WHAT WENT WRONG, in ordinary words — the part of this drill the
     thin toys do not have. Three candidate stories, and the one that
     actually dominates gets told:

       closure  you stopped before your own start, or ran past it
       drift    the radius creeps as the stroke comes back round —
                one systematic mistake, not a local wobble
       local    a flat spot or a bulge, and where it sat

     They are compared as SEVERITIES — each error divided by the
     tolerance it is graded against — so a big number in generous units
     never beats a small one in strict units. Pure and total: a missing
     reading comes back a usable clause. */
  var STORY_QUIET = 0.30;   /* below this there is nothing worth naming */

  function story(m) {
    if (!m) return { clause: 'that one did not read as a circle', sev: 1 };
    var zero = (m.tol && m.tol.zero > 0) ? m.tol.zero : 1;
    var czero = (m.ctol && m.ctol.zero > 0) ? m.ctol.zero : 1;
    var sevLocal = (isFinite(m.worst) && m.worst > 0) ? m.worst / zero : 0;
    var sevDrift = isFinite(m.drift) ? Math.abs(m.drift) / zero : 0;
    var sevClose = (isFinite(m.gap) && m.gap > 0) ? m.gap / czero : 0;
    var sev = Math.max(sevLocal, Math.max(sevDrift, sevClose));
    if (!isFinite(sev)) sev = 1;

    if (sevClose >= sevLocal && sevClose >= sevDrift && sevClose > 0) {
      if (m.turns > 1) return { clause: 'you run past your own start', sev: sev };
      /* the gap sits between the last sample and the first, so name the
         sector its midpoint falls in */
      var w = m.gapMid ? whereWord(m.gapMid.x, m.gapMid.y) : '';
      return { clause: w ? 'you close early, leaving a gap at the ' + w
                         : 'you close early, leaving a gap', sev: sev };
    }
    if (sevDrift >= sevLocal && sevDrift > 0) {
      return { clause: m.drift > 0 ? 'it drifts out as you come back round'
                                   : 'it tightens as you come back round', sev: sev };
    }
    var where = m.worstPoint ? whereWord(m.worstPoint.x, m.worstPoint.y) : '';
    if (!where) return { clause: 'it wanders off the circle', sev: sev };
    return { clause: (m.worstSigned < 0 ? 'flat on the ' : 'it bulges at the ') + where,
             sev: sev };
  }

  /* The per-attempt sentence. The words and the number always travel
     together, in that order, and THE SIZE WORD IS GRADED OFF THE SCORE
     ITSELF, so the two cannot contradict each other whatever the
     geometry did. The top rung has two forms because a 94 earned with a
     visible gap still owes the player the reason: "Round the whole way"
     only when there is nothing left worth naming. */
  function attemptHead(m, score) {
    var n = Number(score);
    var num = isFinite(n) ? Math.round(Math.max(0, Math.min(100, n))) : null;
    var big = scoreWord(isFinite(n) ? n : NaN);
    var st = story(m);
    var head;
    if (big === 'dead on') {
      head = st.sev <= STORY_QUIET ? 'Round the whole way' : 'Nearly there, ' + st.clause;
    } else {
      head = big.charAt(0).toUpperCase() + big.slice(1) + ' off, ' + st.clause;
    }
    return num === null ? head : head + ' — ' + num;
  }

  function attemptWords(m, score) {
    var head = attemptHead(m, score);
    /* "out of 100 for that one" is furniture from the second reveal on —
       which is exactly why the beat is budgeted against attemptHead and
       not against this. */
    return /—/.test(head) ? head + ' out of 100 for that one' : head;
  }

  function roundScore(scores) {
    if (!scores || !scores.length) return 0;
    var sum = 0, i, v;
    for (i = 0; i < scores.length; i++) {
      v = Number(scores[i]);
      sum += isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
    }
    var out = sum / scores.length;
    return isFinite(out) ? out : 0;
  }

  /* ---- the round's habit, which no single circle can show ----
     Nearly everybody is flat in the same place, round after round, and
     which place it is depends on the hand and on whether the circle is
     being drawn from the wrist or the shoulder. That is the correction
     worth having: per-attempt words fix the next circle, this fixes the
     next round.

     GATED ON CONTRADICTION, NOT ON MAJORITY. A mean grows with the
     scatter, so "most of them leaned this way" fires hardest on the
     beginner spraying the sheet — the template's own note records 82–92%
     false positives on pure noise. This fires only when NOT ONE attempt
     went the other way in that sector, which makes the line a
     description of the round rather than an inference about the player.

     Deviations arrive already divided by each attempt's own zero-point,
     so six circles of different sizes are on one scale. Pure and total:
     junk, a short round and an empty list all come back ''. */
  /* An absolute floor, in units of the round's own zero-point, so a
     machine-perfect round cannot fire on a rounding error. */
  var TENDENCY_FLOOR = 0.05;
  /* And the gate that actually does the work: the lean has to be this many
     times the round's OWN scatter. Measured against a fixed fraction of the
     tolerance instead, the test is device-dependent — the same physical
     habit clears it on a pen and misses on a trackpad, whose zero-point is
     twice as wide — and it gets easier the wilder the round is, which is
     the trap the arcade's bias line was rewritten for. Against the round's
     own scatter it is neither: measured over 1,500 simulated rounds per
     level, this fires on 5.5-5.9% of rounds with NO habit in them at any
     wobble and on either profile, and on 59-71% of rounds with a real one.
     Re-checked when the sector means moved to arc-length weights, over 800
     pen rounds per level: no-habit rounds fire on 0.0/0.0/3.9/6.8% at
     2/5/9/15% wobble against 0.0/0.1/6.1/6.1% under the old count-weighted
     means, and rounds with a real habit on 100/100/100/99.9% against
     100/100/100/98.1%. The weighting did not move this gate. */
  var TENDENCY_REL = 1.2;
  /* Above this much scatter — measured against the same zero-point the
     round was scored with — there is no habit left to see, only noise, and
     the honest thing is silence. It is the beginner spraying the sheet who
     is most likely to be handed an invented lean, and an invented
     correction is how scatter turns into a real habit. Measured across
     3,000 simulated rounds per level, this statistic runs 0.08 for a
     2%-of-radius wobble, 0.21 at 5%, 0.37 at 9% and 0.63 at 15% — so 0.5
     silences the round that is all scatter and leaves the rest alone. */
  var TENDENCY_MAX_SCATTER = 0.5;

  function roundTendency(reads) {
    if (!reads || !reads.length || reads.length < 4) return '';
    var i, k, mean;

    /* EACH ATTEMPT IS CENTRED ON ITSELF FIRST. A local dent drags the
       fitted circle toward it and shrinks its radius, so the remaining
       sectors all read as bulging outward — a phantom the raw sector
       means fire on, in the wrong direction, naming the side opposite the
       actual flat spot. Subtracting each attempt's own mean deviation
       removes that global shift and leaves only what is local to the
       sector, which is what a habit actually is. */
    var dev = [];
    for (i = 0; i < reads.length; i++) {
      var row = (reads[i] && reads[i].sectors) || [];
      var tot = 0, m = 0;
      for (k = 0; k < 8; k++) {
        if (typeof row[k] === 'number' && isFinite(row[k])) { tot += row[k]; m++; }
      }
      if (m < 5) { dev.push(null); continue; }
      var base = tot / m, out = [];
      for (k = 0; k < 8; k++) {
        out.push((typeof row[k] === 'number' && isFinite(row[k])) ? row[k] - base : null);
      }
      dev.push(out);
    }

    /* How much this round wanders, in the same units. */
    var scatterSum = 0, scatterN = 0;
    for (i = 0; i < dev.length; i++) {
      if (!dev[i]) continue;
      var rowSum = 0, rowN = 0;
      for (k = 0; k < 8; k++) {
        if (typeof dev[i][k] === 'number') { rowSum += Math.abs(dev[i][k]); rowN++; }
      }
      if (rowN) { scatterSum += rowSum / rowN; scatterN++; }
    }
    if (!scatterN) return '';
    var scatter = scatterSum / scatterN;
    if (!isFinite(scatter) || scatter > TENDENCY_MAX_SCATTER) return '';
    var need = Math.max(TENDENCY_FLOOR, TENDENCY_REL * scatter);

    /* --- flat, or bulging, in the same sector, every time ---
       Gated on CONTRADICTION, not on majority: fire only when not one
       attempt went the other way in that sector, which makes the line a
       description of the round rather than an inference about the player.
       Then the lean itself has to clear `need`. */
    var flatK = -1, flatM = 0, wideK = -1, wideM = 0;
    for (k = 0; k < 8; k++) {
      var sum = 0, count = 0, allFlat = true, allWide = true;
      for (i = 0; i < dev.length; i++) {
        var v = dev[i] ? dev[i][k] : null;
        if (typeof v !== 'number' || !isFinite(v)) { allFlat = false; allWide = false; continue; }
        count++; sum += v;
        if (v >= 0) allFlat = false;
        if (v <= 0) allWide = false;
      }
      if (count < 4) continue;
      mean = sum / count;
      if (allFlat && mean <= -need && mean < flatM) { flatM = mean; flatK = k; }
      if (allWide && mean >= need && mean > wideM) { wideM = mean; wideK = k; }
    }
    /* A FLAT READING WINS OVER A WIDE ONE. The two are not symmetric: a
       dent on one side makes the opposite side read as a bulge, so a
       genuine flat spot on the left routinely qualifies as "wide at the
       bottom" as well. Preferring the flat candidate took the share of
       firings that named the real spot (or a sector beside it) from 68%
       to 83% in simulation, and costs a real bulge nothing — a bulge with
       no dent opposite it has no flat candidate to lose to. */
    var worstK = flatK >= 0 ? flatK : wideK;
    var worstMean = flatK >= 0 ? flatM : wideM;
    var dir = flatK >= 0 ? -1 : 1;
    /* --- or the radius creeps the same way, every time ---
       A spiral is a global, monotone trend rather than a local dent, and
       it has its own fix, so it is worth telling apart from a flat spot.
       Same shape of gate: contradiction, then a lean measured against the
       round's own scatter. */
    var dsum = 0, dn = 0, dpos = 0, dneg = 0;
    for (i = 0; i < reads.length; i++) {
      var d = reads[i] && reads[i].driftNorm;
      if (typeof d !== 'number' || !isFinite(d)) continue;
      dn++; dsum += d;
      if (d > 0) dpos++; else if (d < 0) dneg++;
    }
    var driftMean = dn >= 4 ? dsum / dn : 0;
    var driftFires = dn >= 4 &&
      ((driftMean >= need && dneg === 0) || (driftMean <= -need && dpos === 0));

    /* Both can qualify at once — a circle that opens as it goes round is
       also, sector by sector, wider at the end. Compare them the way the
       per-attempt clause compares its three stories: as strengths against
       their own thresholds, and tell the bigger one. */
    var sectorStrength = worstK >= 0 ? Math.abs(worstMean) / need : 0;
    var driftStrength = driftFires ? Math.abs(driftMean) / need : 0;

    if (driftStrength > sectorStrength) {
      if (driftMean > 0) {
        return 'Every circle this round opened out as it came back round. ' +
               'The arm is widening as it swings: fix your eye on the point you ' +
               'started from and finish there.';
      }
      return 'Every circle this round tightened as it came back round. ' +
             'The hand is pulling in to close: keep the same speed all the way ' +
             'and let the line meet its own start.';
    }

    if (worstK >= 0) {
      var how = sizeWord(Math.abs(worstMean), 1);
      /* The ladder's top rung means "no difference worth naming", which
         contradicts the gate above having fired at all. It can only be
         reached from the absolute floor, so the honest word there is the
         next rung down — never "the left, dead on out". */
      if (how === 'dead on') how = 'a hair';
      var side = WHERE[worstK];
      if (dir < 0) {
        return 'Every circle this round went flat in the same place — the ' + side +
               ', ' + how + ' out. That is usually the wrist reaching the end of its ' +
               'arc: turn the paper, or swing the whole circle from the shoulder.';
      }
      return 'Every circle this round bulged in the same place — the ' + side +
             ', ' + how + ' out. Slow down through that stretch and let the shoulder ' +
             'carry it instead of the fingers.';
    }
    return '';
  }

  /* ---- the beat, counted rather than guessed ----
     A reveal wiped before it can be read is not a lesson. Budget the
     text that is NEW on the screen at ~200 words a minute, and count
     the words rather than estimating them so the number cannot drift
     away from the copy the next time anyone edits it. An em dash is a
     pause, not a word. */
  function readingMs(text) {
    var parts = String(text === null || text === undefined ? '' : text).split(/\s+/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (/[0-9a-z]/i.test(parts[i])) n++;
    return n * MS_PER_WORD;
  }

  /* `seen` is how many reveals this SITTING has shown — never the round
     number, never the item index. `newText` is the part of the sentence
     that is actually new: the whole line on the first reveal, when
     nothing on the screen is furniture yet, and only the clause after
     that. */
  function revealBeat(seen, newText) {
    var floor = seen ? REVEAL_MIN_MS : FIRST_REVEAL_MIN_MS;
    return Math.max(floor, readingMs(newText));
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

  ArtDaily.init({ slug: SLUG });

  /* ---- theme-aware inks, resolved once per THEME ----
     `mark` is --canvas-accent, the accent mixed toward --ink: every mark
     on this sheet carries information, and the raw watercolour accents
     are decorative-strength on paper. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--lilac').trim();
    var c = {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
      mark: cs.getPropertyValue('--canvas-accent').trim() || accent,
    };
    if (c.ink && c.muted && accent) { inkCache = c; inkTheme = t; }
    return c;
  }

  /* ---- the sheet ----
     ONE fixed aspect ratio at every width, on purpose. A reveal that
     survives a rotation has to be re-projected, and a re-projection is
     only faithful when it is UNIFORM: scale x and y by different
     factors and the fitted circle the number was measured against
     redraws as an ellipse, which is the one shape this drill is about.
     With the aspect pinned, a resize is a single scale factor and the
     picture is a scaled copy of itself — and because the score is the
     radial deviation DIVIDED BY the fitted radius, a scaled copy of a
     71 is still a 71. */
  var ASPECT = 0.85;
  var W = 0, H = 0, lastDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var dpr = window.devicePixelRatio || 1;
    if (w === W && dpr === lastDpr) return false;
    W = w;
    H = Math.max(1, Math.round(W * ASPECT));
    lastDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* The smallest circle worth judging: below this the tolerance band is a
     handful of pixels wide and the drill is measuring the digitizer
     rather than the hand. Refused, never penalised — and it is NOT a
     penalty band or a size score, it is the one place size appears in
     the drill at all.

     Unchanged by the size fix, on purpose. It no longer has a loophole
     to close — the band above is a plain fraction of the radius now, so
     a small circle is graded in the same relative band as a big one and
     there is nothing to be won by drawing small — which leaves this rule
     doing only the job it should: refusing the circle too small to
     measure. So it stays exactly where it was, and nothing a player could
     draw before is refused now.

     Kept deliberately low for the same reason as before. This is the one
     rule that can refuse a beginner's very first attempt, and a refusal
     in the first thirty seconds reads as the drill being broken however
     politely it is worded. At a tenth of the sheet's short side the floor
     bites at about a 118px circle on a desktop sheet and an 80px one on a
     phone — smaller than a tentative first try. Its 40px floor is the
     same number MIN_RADIUS_PX and the tolerance band are pinned to, which
     is what makes the band purely relative everywhere a score exists. */
  function minRadius() { return Math.max(40, 0.10 * Math.min(W, H)); }

  /* What this drill grades is executing a stroke, so the zero-point is
     eased and NOT floored against startRadius() — see the header. */
  function easeFactor() { return ArtDaily.ease(1); }

  /* The one acquisition in the drill: the ring you press inside to
     carry a lifted stroke on. 60px across at the very least — a radius
     floor of 30 — and 72px on a mouse, 122px on a pen, because it is a
     touch target. */
  function resumeRadius() { return Math.max(ArtDaily.startRadius(36), 30); }

  /* ---- round state ---- */
  var round = 0, idx = 0, scores = [], reads = [], playing = false, reported = false;
  var drawing = false, stroke = [], ghosts = [];
  var activePointer = null, activeType = null;
  var pending = null;        /* a stroke that stopped short, waiting to carry on */
  var reveal = null, revealTimer = null;
  /* The pointer currently HOLDING the reveal (the beat-is-a-floor rule in
     the pointerdown handler): press cancels the pending advance, release
     advances — so a quick tap is the same skip this drill always had, and
     keeping the finger down keeps the screen (WCAG 2.2.1). Cleared by the
     release/cancel handlers, nextItem and newRound; the visibilitychange
     re-arm checks it so a hidden tab cannot un-hold a held reveal. */
  var holdPointer = null;
  /* Reveals shown this SITTING. Never reset by newRound(): everything
     taught once — the long beat, the naming of the dotted band, the
     opening clause about how the drill marks you — hangs off this, so a
     beginner pressing "new round" before their first circle cannot
     silently downgrade the one screen it was all written for. */
  var revealsSeen = 0;
  var lastScore = null;

  function raf(fn) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  /* ---- the prompt ---- */
  function itemHint(i) {
    var head = 'Circle ' + (i + 1) + ' of ' + CIRCLES_PER_ROUND + ' — ';
    if (revealsSeen === 0) {
      return head + 'draw one circle freehand, all the way round to where you ' +
             'started, then lift. The rounder it is, the more it scores.';
    }
    /* "size is never scored" was not true when this line was written: the
       tolerance band had pixel floors under it, so the same shape drawn
       small scored about twelve points higher. It is true now — the band
       is a plain fraction of the radius — and the second half is the part
       that is still worth saying, because it is about the HAND rather
       than the scoring: your wobble is a fixed number of pixels, so it is
       a smaller fraction of a big circle. */
    if (i === 1) return head + 'one stroke, all the way round. Try a bigger one: the same shape scores the same at any size, and a big circle is easier to keep round.';
    if (i === CIRCLES_PER_ROUND - 1) return head + 'last one. Make it big and swing it from the shoulder.';
    return head + 'one stroke, all the way round, then lift.';
  }

  function newRound() {
    clearTimeout(revealTimer);
    revealTimer = null;
    holdPointer = null;
    round += 1;
    idx = 0;
    scores = [];
    reads = [];
    ghosts = [];
    stroke = [];
    pending = null;
    reveal = null;
    drawing = false;
    activePointer = null;
    activeType = null;
    reported = false;
    lastScore = null;
    playing = true;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hideToast();
    hint.textContent = itemHint(0);
    draw();
  }

  /* ---- the sheet, in words ----
     role="img", so this name IS the picture to anyone who cannot see
     it, and a name written once in the HTML describes a blank rectangle
     for the whole session. Held to the same bar as the scoring: it runs
     inside draw(), which runs inside the pointer handler, so a throw
     would stop the canvas painting mid-stroke — and it is read out
     loud, where "NaN out of 100" is worse than silence. */
  var sheetName = '';
  function describeSheet() {
    var txt;
    if (reveal) {
      txt = 'Drill sheet: the circle you drew, with the truest circle through it ' +
            'drawn over the top and a dotted band around it where the score runs out. ' +
            String(reveal.words || 'Off the circle') + '.';
      if (!playing && typeof lastScore === 'number' && isFinite(lastScore)) {
        txt += ' Round done: ' + Math.round(lastScore) + ' out of 100.';
      }
    } else if (pending) {
      txt = 'Drill sheet: the part of a circle you have drawn so far, ' +
            Math.round(pending.pct) + ' per cent of the way round, with a dashed ring ' +
            'at the point where you lifted.';
    } else if (playing) {
      txt = 'Drill sheet: blank paper. Circle ' + (idx + 1) + ' of ' + CIRCLES_PER_ROUND +
            ' — draw one circle freehand and lift.';
    } else {
      txt = 'Drill sheet: empty. Press “new round” to start.';
    }
    if (txt === sheetName) return;
    sheetName = txt;
    canvas.setAttribute('aria-label', txt);
  }

  /* ---- painting ---- */
  /* Lifts the pen where the player lifted theirs: a `gap` sample starts a
     new subpath rather than continuing the old one. The picture then shows
     the same line the score measures — a straight chord drawn across a
     break the scoring deliberately ignores is the picture and the number
     disagreeing, in the one drill whose whole point is that they cannot. */
  function polyline(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      if (isGap(pts[i])) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  function label(c, x, y, text) {
    ctx.save();
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 10;
    var lx = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x));
    var ly = Math.max(10, Math.min(H - 10, y));
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = c.card;
    ctx.fillRect(lx - w / 2, ly - 8, w, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.muted;
    ctx.fillText(text, lx, ly);
    ctx.restore();
  }

  function drawGhosts(c) {
    if (!ghosts.length) return;
    ctx.save();
    for (var g = 0; g < ghosts.length; g++) {
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 2;
      polyline(ghosts[g]);
    }
    ctx.restore();
  }

  /* The reveal: what you drew, the truest circle through it, the band
     the score is measured in, and the point of widest drift ticked. All
     of it FROZEN at the moment it was scored — the radius, both
     tolerance edges and the mark — because the hardware and the canvas
     can both change while a printed number cannot. */
  function drawReveal(c, rv) {
    /* the band first, behind everything */
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.arc(rv.cx, rv.cy, Math.max(1, rv.r + rv.zero), 0, Math.PI * 2);
    ctx.stroke();
    if (rv.r - rv.zero > 2) {
      ctx.beginPath();
      ctx.arc(rv.cx, rv.cy, rv.r - rv.zero, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    /* What the player drew, one rung heavier than the truth drawn over it:
       the two lines lie on top of each other wherever the attempt was good,
       and on paper the accent is mixed toward --ink, so at equal weights
       they are hard to tell apart at a glance. The thicker ink with the
       thinner accent inside it reads as one line with a core, which is
       exactly what "here is the circle you meant" should look like. */
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    polyline(rv.points);

    /* the truest circle through it, over the top */
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rv.cx, rv.cy, rv.r, 0, Math.PI * 2);
    ctx.stroke();

    /* the widest drift: a dot on the ink, a dash out to the true circle */
    if (rv.worst && rv.worst.d >= 2) {
      ctx.save();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(rv.worst.p.x, rv.worst.p.y);
      ctx.lineTo(rv.worst.foot.x, rv.worst.foot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.arc(rv.worst.p.x, rv.worst.p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* the gap, when there is one worth drawing: a dashed chord from
       where the stroke ended back to where it started */
    if (rv.gapEnds) {
      ctx.save();
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(rv.gapEnds.a.x, rv.gapEnds.a.y);
      ctx.lineTo(rv.gapEnds.b.x, rv.gapEnds.b.y);
      ctx.stroke();
      ctx.restore();
    }

    /* the score, in the middle of the circle it belongs to */
    ctx.save();
    ctx.font = '900 30px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var s = String(Math.round(rv.score));
    var cx = Math.max(24, Math.min(W - 24, rv.cx));
    var cy = Math.max(18, Math.min(H - 18, rv.cy));
    ctx.fillStyle = c.mark;
    ctx.fillText(s, cx, cy);
    ctx.restore();

    /* Named on the spot, once, on the only screen where they are new: a
       dotted band and a smooth ring nobody has seen before are jargon
       that happens to be drawn instead of typed. */
    if (rv.first) {
      label(c, rv.cx + rv.r * 0.71, rv.cy - rv.r * 0.71, 'true circle');
      label(c, rv.cx - (rv.r + rv.zero) * 0.71, rv.cy + (rv.r + rv.zero) * 0.71, 'score ends here');
    }
  }

  function drawResume(c) {
    ctx.save();
    ctx.strokeStyle = c.mark;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(pending.lift.x, pending.lift.y, pending.ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    describeSheet();
    drawGhosts(c);
    if (reveal) { drawReveal(c, reveal); return; }
    if (!playing) return;
    if (pending) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2.5;
      polyline(pending.points);
      drawResume(c);
    }
    if (drawing) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2.5;
      polyline(stroke);
    }
  }

  var paintPending = false;
  function paintSoon() {
    if (paintPending) return;
    paintPending = true;
    raf(function () { paintPending = false; draw(); });
  }

  /* ---- input ----
     MAP THROUGH THE CONTENT BOX. The shared sheet is border-box with a
     1px border on .game-canvas, so getBoundingClientRect() measures a
     box two pixels wider than the one the bitmap is painted into, and
     the reflex `clientX - rect.left` is off by the border at one edge
     and by the accumulated stretch at the other. */
  function posIn(ev, rect, cw, ch, bx, by) {
    return {
      x: (cw > 0) ? (ev.clientX - rect.left - bx) * W / cw : 0,
      y: (ch > 0) ? (ev.clientY - rect.top - by) * H / ch : 0,
    };
  }
  function metrics() {
    var rect = canvas.getBoundingClientRect();
    var cw = canvas.clientWidth || rect.width;
    var ch = canvas.clientHeight || rect.height;
    return { rect: rect, cw: cw, ch: ch,
             bx: (rect.width - cw) / 2, by: (rect.height - ch) / 2 };
  }
  function pointerPos(ev) {
    var m = metrics();
    return posIn(ev, m.rect, m.cw, m.ch, m.bx, m.by);
  }

  function abortStroke() {
    if (activePointer !== null) {
      try { canvas.releasePointerCapture(activePointer); } catch (e) {}
    }
    drawing = false;
    activePointer = null;
    activeType = null;
    stroke = [];
  }

  /* A pointer is `primary` only while it is the first active one of its
     type, so a new primary of the SAME type proves the stored one has
     ended. This is the only recovery a finger has: every touch gets a
     fresh pointerId, so no release for the old one can ever arrive. */
  function ownerGone(ev) {
    return ev.isPrimary === true && ev.pointerType === activeType;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    /* Only a press that means "here". A right-click, a middle-click and
       a pen's barrel button are pointerdowns like any other, and this is
       the one press whose browser default is still wanted, so it leaves
       before anything cancels it. `button` is 0 for a finger and for a
       pen's tip, so touch and pen are untouched. */
    if (ev.button > 0) return;
    /* Cancelled for the presses this drill IGNORES as well as the ones
       it accepts: a reveal owns the sheet for a couple of seconds, which
       is exactly long enough for an impatient hand to press and drift,
       dragging a text selection over the hint line or popping a long-
       press callout across the picture the beat exists to let them read. */
    ev.preventDefault();
    /* A palm is not an attempt. The heel of the hand lands before the
       nib; the SDK owns this test because it is the only thing that sees
       a nib hovering. Ignored, never counted against them. */
    if (ArtDaily.isPalm(ev)) return;
    if (!playing) return;
    if (reveal) {
      /* THE BEAT IS A FLOOR, NOT A DEADLINE (WCAG 2.2.1). The press
         cancels the pending advance and the RELEASE moves on — a quick
         tap is exactly the skip this drill always had, and a press that
         stays down holds the screen for as long as the hand does. Never
         scored, never counted; a palm already returned above. */
      clearTimeout(revealTimer);
      revealTimer = null;
      holdPointer = ev.pointerId;
      return;
    }
    if (drawing) {
      /* the same pointer down twice with no release in between means its
         release was lost (press on the sheet, drag off the frame, let go
         over the page); a pen outranks a palm already holding the stroke;
         a finger's lost release shows up as a new primary of its type */
      if (ev.pointerId === activePointer) abortStroke();
      else if (ev.pointerType === 'pen' && activeType !== 'pen') abortStroke();
      else if (ownerGone(ev)) abortStroke();
      else return;
    }
    var p = pointerPos(ev);
    if (pending && Math.hypot(p.x - pending.lift.x, p.y - pending.lift.y) <= pending.ring) {
      /* carrying on the stroke a short throw forced you to break. Flag
         the sample the pen comes back down on: the run from the lift
         point to here was never drawn, so nothing may measure or draw
         across it (see isGap / arcWeights). */
      p.gap = true;
      stroke = pending.points;
      stroke.push(p);
      pending = null;
      hint.textContent = 'Carrying on from where you lifted — keep going round.';
    } else {
      pending = null;
      stroke = [p];
    }
    drawing = true;
    activePointer = ev.pointerId;
    activeType = ev.pointerType;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!drawing || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    /* Full-rate sampling: the digitizer runs at 120–1000Hz and hands the
       frame's whole run of positions over on the one dispatched event.
       Reading only that event throws the rest away, and a drill that
       scores geometry then scores a smoother circle than the hand drew —
       a fidelity bug that surfaces as a fairness one. The canvas is
       measured ONCE for the whole run; painting is once a frame. */
    var m = metrics();
    var evs = ArtDaily.samples(ev);
    for (var i = 0; i < evs.length; i++) {
      stroke.push(posIn(evs[i], m.rect, m.cw, m.ch, m.bx, m.by));
    }
    paintSoon();
  });

  function endStroke(ev) {
    /* The release of a reveal-holding press advances the item — see the
       hold branch in pointerdown. Before the drawing guard, because a
       reveal press never sets `drawing`. */
    if (holdPointer !== null && ev.pointerId === holdPointer) {
      holdPointer = null;
      if (playing && reveal) nextItem();
      return;
    }
    if (!drawing || ev.pointerId !== activePointer) return;
    if (ev.cancelable) ev.preventDefault();
    drawing = false;
    activePointer = null;
    activeType = null;
    if (stroke.length < MIN_SAMPLES || pathLength(stroke) < MIN_PATH_PX) {
      stroke = [];
      pending = null;
      hint.textContent = 'That was a press, not a circle — no penalty. Draw one full circle and lift.';
      draw();
      return;
    }
    var ease = easeFactor();
    var m = measure(stroke, ease);
    if (!m) {
      pending = null;
      stroke = [];
      hint.textContent = 'That did not read as a circle — no penalty. Draw one full circle and lift.';
      draw();
      return;
    }
    /* A stroke that stopped short is not a bad circle, it is an
       unfinished one — a trackpad running out of pad, a finger reaching
       the edge of the glass. Not scored, not penalised, resumable. */
    if (m.tooShort) {
      var last = stroke[stroke.length - 1];
      pending = {
        points: stroke,
        lift: { x: last.x, y: last.y },
        ring: resumeRadius(),
        pct: Math.max(1, Math.min(99, Math.round(m.turns * 100))),
      };
      stroke = [];
      hint.textContent = 'You got ' + pending.pct + '% of the way round — no penalty. ' +
        'Press inside the dashed ring to carry the same circle on, or start a fresh one anywhere.';
      draw();
      return;
    }
    if (m.fit.r < minRadius()) {
      pending = null;
      stroke = [];
      hint.textContent = 'That one is too small for the drill to judge — no penalty. Draw a bigger one.';
      draw();
      return;
    }
    if (m.fit.x - m.fit.r < -10 || m.fit.x + m.fit.r > W + 10 ||
        m.fit.y - m.fit.r < -10 || m.fit.y + m.fit.r > H + 10) {
      pending = null;
      stroke = [];
      hint.textContent = 'That one ran off the paper — no penalty. Keep the whole circle on the sheet.';
      draw();
      return;
    }
    scoreAttempt(stroke, m);
  }
  canvas.addEventListener('pointerup', endStroke);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', endStroke);
  /* iOS drops capture without a pointerup — treat it as the lift it is */
  canvas.addEventListener('lostpointercapture', endStroke);

  function cancelStroke(ev) {
    /* A CANCELLED holding press is not an "advance" — the player did not
       lift on purpose. Drop the hold and hand the beat back, full. */
    if (holdPointer !== null && ev.pointerId === holdPointer) {
      holdPointer = null;
      if (playing && reveal && revealTimer === null && !document.hidden) {
        revealTimer = setTimeout(nextItem, (reveal && reveal.beat) || REVEAL_MIN_MS);
      }
      return;
    }
    if (!drawing || ev.pointerId !== activePointer) return;
    abortStroke();
    if (playing && !reveal) {
      hint.textContent = 'Your device interrupted that stroke — no penalty. Go again.';
    }
    draw();
  }
  canvas.addEventListener('pointercancel', cancelStroke);
  window.addEventListener('pointercancel', cancelStroke);

  function scoreAttempt(points, m) {
    var wp = points[m.worstIndex];
    var a0 = points[0], aN = points[points.length - 1];
    var seen = revealsSeen;
    revealsSeen += 1;
    var words = attemptWords(m, m.score);
    var line = words + '.';
    if (!seen) {
      /* Both new marks are labelled on the sheet itself, beside the thing
         they name, so this line only has to point at them — naming them a
         second time in prose would buy 4 more seconds of beat for nothing. */
      line += ' The two rings are named on the sheet. Tap it for the next one.';
    }
    /* The beat is budgeted against the text that is NEW on the screen: the
       whole sentence on the first reveal of the sitting, when nothing is
       furniture yet, and only the clause and its number after that. */
    var newText = seen ? attemptHead(m, m.score) : line;

    /* Everything the picture needs, frozen: the radius, the tolerance
       that sized the band, the mark. Once a number is printed, nothing
       the player has not done may change the picture it describes — and
       both the hardware (onInput) and the canvas (a rotation) can move
       under a reveal that is still on screen. */
    var foot = {
      x: m.fit.x + (wp.x - m.fit.x) * (m.fit.r / Math.max(1e-6, Math.hypot(wp.x - m.fit.x, wp.y - m.fit.y))),
      y: m.fit.y + (wp.y - m.fit.y) * (m.fit.r / Math.max(1e-6, Math.hypot(wp.x - m.fit.x, wp.y - m.fit.y))),
    };
    reveal = {
      points: points,
      cx: m.fit.x, cy: m.fit.y, r: m.fit.r,
      zero: m.tol.zero,
      score: m.score,
      words: words,
      first: !seen,
      worst: { p: { x: wp.x, y: wp.y }, foot: foot, d: m.worst },
      gapEnds: (m.loss >= 4 && m.turns < 1) ? { a: { x: a0.x, y: a0.y }, b: { x: aN.x, y: aN.y } } : null,
      beat: revealBeat(seen, newText),
    };
    stroke = [];
    scores.push(m.score);
    /* only what the round-end tendency reads, already normalised by this
       attempt's own zero-point so six circles of different sizes sit on
       one scale */
    var z = m.tol.zero > 0 ? m.tol.zero : 1;
    var sectors = [];
    for (var i = 0; i < 8; i++) {
      sectors.push(typeof m.sectors[i] === 'number' ? m.sectors[i] / z : null);
    }
    reads.push({ sectors: sectors, driftNorm: m.drift / z });
    idx += 1;
    hint.textContent = line;
    draw();
    /* The last circle does NOT wait on the beat: finishing is
       synchronous, so report() can never be raced by "new round"
       landing during the reveal. The reveal stays on the sheet. */
    if (idx >= CIRCLES_PER_ROUND) { finishRound(); return; }
    clearTimeout(revealTimer);
    revealTimer = setTimeout(nextItem, reveal.beat);
  }

  /* A hidden tab is not a reading player: background timers keep running
     and spend the whole lesson on a tab nobody is looking at. Park the
     advance and hand the beat back in full on return. This timer only
     ever advances an ITEM — the last one finishes synchronously — so it
     can never file a round twice. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (playing && reveal && revealTimer === null && holdPointer === null) {
      revealTimer = setTimeout(nextItem, (reveal && reveal.beat) || REVEAL_MIN_MS);
    }
  });

  function nextItem() {
    revealTimer = null;
    holdPointer = null;
    if (!playing || !reveal) return;
    ghosts.push(reveal.points);
    if (ghosts.length > GHOSTS_KEPT) ghosts.shift();
    reveal = null;
    pending = null;
    hint.textContent = itemHint(idx);
    draw();
  }

  /* "New best!" is trivially true on a player's first ever round, fired
     on the one round where they most need to be told what the number is
     FOR. So round one says that instead, and the celebrating starts from
     round two. The last circle keeps its own words here too: it is an
     attempt like any other and is owed the same reveal as the first five. */
  function roundWords(res, last, tendency) {
    var head = (last ? last + '. ' : '') + 'Round done — ' + res.score + ' out of 100';
    var tail = tendency ? ' ' + tendency : '';
    if (res.isFirst) return head + '. That is your bar now — press “new round” and beat it.' + tail;
    if (res.isNewBest) return head + ', your best yet.' + tail;
    return head + ' (best ' + res.best + ').' + tail;
  }

  function finishRound() {
    playing = false;
    pending = null;
    clearTimeout(revealTimer);
    revealTimer = null;
    draw();
    if (reported) return;         /* exactly once per round, on every path */
    reported = true;
    var res = ArtDaily.report(roundScore(scores));
    lastScore = res.score;
    describeSheet();
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
    /* The sixth circle is an attempt like any other and is owed the same
       reveal as the first five, so its words lead the round-end line
       rather than being wiped by the score. */
    hint.textContent = roundWords(res, reveal ? reveal.words : '', roundTendency(reads));
    showToast(res.isFirst ? 'first score ' + res.score + ' / 100'
            : res.isNewBest ? 'new best! ' + res.score + ' / 100'
            : 'score ' + res.score + ' / 100',
      res.isNewBest && !res.isFirst);
  }

  var toastTimer = null;
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }
  /* A sticker, not a second voice: it says nothing the hint line has not
     already said in a fuller sentence, and two live regions written in
     the same tick queue up and say the same thing twice. */
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

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; draw(); });
  /* The hardware changed mid-session. Resize the geometry, never
     re-judge what is already on screen: the reveal's band was frozen at
     the ease the stroke was drawn under, and stays there. */
  ArtDaily.onInput(function () {
    if (pending) pending.ring = resumeRadius();
    draw();
  });

  /* Everything already drawn sits in CSS pixels placed against the old
     canvas box, so a resize has to carry it across or the reveal — the
     whole lesson — strands itself off-sheet. The aspect ratio is pinned,
     so this is a single uniform scale about the centre: the picture
     becomes a scaled copy of itself, and a scaled copy of a 71 is still
     a 71, because the score is a ratio. */
  function reproject(s, oldW, oldH) {
    var ox = oldW / 2, oy = oldH / 2, nx = W / 2, ny = H / 2;
    function pt(p) { p.x = nx + (p.x - ox) * s; p.y = ny + (p.y - oy) * s; }
    function pts(list) { for (var i = 0; i < list.length; i++) pt(list[i]); }
    for (var g = 0; g < ghosts.length; g++) pts(ghosts[g]);
    if (reveal) {
      pts(reveal.points);
      var c = { x: reveal.cx, y: reveal.cy };
      pt(c);
      reveal.cx = c.x; reveal.cy = c.y;
      reveal.r *= s;
      reveal.zero *= s;
      pt(reveal.worst.p);
      pt(reveal.worst.foot);
      reveal.worst.d *= s;
      if (reveal.gapEnds) { pt(reveal.gapEnds.a); pt(reveal.gapEnds.b); }
    }
    if (pending) {
      pts(pending.points);
      pt(pending.lift);
    }
  }

  var fitPending = false;
  function onResize() {
    if (fitPending) return;
    fitPending = true;
    raf(function () {
      fitPending = false;
      var oldW = W, oldH = H;
      if (!fitCanvas()) return;
      if (drawing) {
        /* the sheet rescaled under a live stroke (a rotation) — void the
           attempt rather than score it against a canvas it was not drawn
           on. No penalty, and the round is still finishable. */
        abortStroke();
        if (playing && !reveal) {
          hint.textContent = 'The screen changed size — no penalty. Draw that one again.';
        }
      }
      if (oldW > 1 && oldH > 1) reproject(W / oldW, oldW, oldH);
      if (pending) pending.ring = resumeRadius();
      draw();
    });
  }
  window.addEventListener('resize', onResize);
  /* also catches the canvas measuring 0 at boot — opened in a background
     tab, or laid out a frame late */
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
