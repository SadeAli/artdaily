/* ============================================================
   game.js — Line Weight: redraw a stroke's weight profile.
   The top stroke is a filled ribbon whose width ramps (thick→thin,
   thin→thick, thin-thick-thin, two bumps, freehand); the player
   redraws it along the dashed guide below with the same thicks and
   thins.

   WIDTH COMES FROM SOMETHING THE HARDWARE CAN ACTUALLY AIM:
     · pen with real pressure  → pressure (unchanged, still the
       instrument the drill was born for);
     · everything else         → HEIGHT ABOVE THE GUIDE. Ride the
       dashes for a hairline, climb into the band above them to lay
       weight on.
   The old fallback drove width from pointer SPEED, which is the OS
   pointer-acceleration curve applied to hand speed — so a mouse
   player was scored against their system preferences slider, the
   heaviest widths needed a 40px/s crawl, and the naturally
   ballistic slow-fast-slow of a mouse drag is the exact inverse of
   nearly every target profile. Height is aimable by a mouse, a
   trackpad, a thumb and a screenless tablet alike, and it teaches
   the same lesson: WHERE the weight goes.

   Position along the drill is horizontal progress across the
   guide, not arc length, so:
     · a lift is not the end of anything — press again anywhere and
       carry on filling in the profile (a trackpad cannot pull 650px
       in one contact, and that is the trackpad's business, not a
       drawing fault);
     · dwelling registers instead of vanishing;
     · a partial attempt is never scored as a whole one.

   Scoring is pure profile geometry: both width profiles over 64
   evenly spaced positions, min-max normalized (shape match, not
   absolute size), RMS-compared. The RMS that scores zero is
   ArtDaily.ease()d per input mode — pen keeps the strict standard,
   mouse/trackpad and finger get the room their hardware needs, and
   the HUD says which one it scored for. All scoring math sits below
   as pure functions.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'line-weight';
  var STROKES_PER_ROUND = 5;
  var N_SAMPLES = 64;        /* profile resolution for scoring */
  var AVAIL_MIN = 2;         /* px — thinnest width the input maps to */
  var AVAIL_MAX = 16;        /* px — heaviest width the input maps to */
  var EMA_ALPHA = 0.35;      /* width smoothing, per EVENT (the floor) */
  var EMA_BUCKET = 0.85;     /* …and per BUCKET of guide progress — see emaAlpha */
  var REVEAL_MS = 1700;

  /* Pen reference: RMS of the normalized profiles that scores 0.
     ArtDaily.ease() multiplies it per hardware (mouse ×2, finger
     ×1.5). RMS_CAP is the ceiling, and it is measured rather than
     taste: a CONSTANT-weight stroke — the exact mistake this drill
     exists to correct — sits at ~0.34 RMS against these targets and
     random noise at ~0.42, so a zero point past 0.5 starts paying
     for the failure. Capping keeps "one flat weight fails" true in
     every mode, while pen keeps exactly the standard it had. */
  var RMS_BASE = 0.34;
  var RMS_CAP = 0.50;
  /* raw width range under this fraction of the available range = a
     flat, no-dynamics stroke. Eased by the same ratio as the RMS. */
  var FLAT_FRAC = 0.2;
  var FLAT_FACTOR = 0.8;

  /* Inked fraction of the guide that ends an attempt on the next lift.
     It has to mean "end to end", because everything past the last bucket
     the player reached is flat-extrapolated by closeGaps() and then
     scored: at 0.82 a flawless trace that lifted to reposition in the
     last fifth of the guide was scored on a straight tail it never drew
     (a perfect 'two bumps' fell from 98.6 to 56.9). 0.97 = 63 of the 64
     buckets, so at most one bucket is ever extrapolated, while a lift
     anywhere earlier still costs nothing at all. */
  var COVER_DONE = 0.97;
  var COVER_TAP = 0.03;      /* below this the press was a tap, not an attempt */
  var RESUME_MS = 15000;     /* a lift stays resumable this long */
  var PEN_GUARD_MS = 600;    /* touch ignored this long after a pen event */

  /* difficulty ramp: profile kinds, easy → hard, one per stroke.
     Stroke 1 is the plainest shape there is, so the first success
     arrives inside the first attempt. */
  var PROFILE_ORDER = ['taper-out', 'taper-in', 'swell-middle', 'double-swell', 'random-smooth'];
  /* plain words only — the ribbon already shows the shape, the label
     must not need a studio dictionary to decode */
  var PROFILE_LABEL = {
    'taper-out': 'thick → thin',
    'taper-in': 'thin → thick',
    'swell-middle': 'thin → thick → thin',
    'double-swell': 'two bumps',
    'random-smooth': 'freehand — copy the ribbon'
  };

  /* ============================================================
     Pure scoring & mapping — numbers in, numbers out. No canvas,
     no DOM, unit-testable as-is.
     ============================================================ */
  /* NaN-safe, and that is load-bearing rather than tidy: every input
     coordinate reaches the attempt buffer through here (tFromX,
     offsetToWidth, pressureToWidth and fillSpan all clamp01), and
     Math.max/Math.min propagate NaN silently.

     So ONE non-finite coordinate — a coalesced sample with a junk
     clientY, a synthetic event — used to cost the whole stroke, not one
     sample: offsetToWidth returned NaN, the running average took it
     (emaNext(prev, NaN) is NaN and stays NaN for the rest of the
     contact), every later bucket was written NaN, and normalizeProfile
     then read the 64-sample profile as one FLAT weight. Measured: a
     97.8 trace with a single junk coordinate at its second sample
     scored 0 — 64 of 64 buckets NaN — with nothing on the sheet saying
     why. Clamping junk to 0 costs that one sample a hairline instead.  */
  function clamp01(v) {
    v = +v;
    return v > 0 ? (v < 1 ? v : 1) : 0;
  }

  function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  /* Shape s(t) in [0,1] for the fixed profile kinds. */
  function baseShape(kind, t) {
    if (kind === 'taper-out') return 1 - smoothstep(t);
    if (kind === 'taper-in') return smoothstep(t);
    if (kind === 'swell-middle') return Math.sin(Math.PI * t);
    if (kind === 'double-swell') return Math.abs(Math.sin(2 * Math.PI * t));
    return 0.5;
  }

  /* n raw target widths (px). seed: 5 uniforms in [0,1) so that
     'random-smooth' stays pure; other kinds ignore it. */
  function makeTargetProfile(kind, n, wMin, wMax, seed) {
    var ws = [], i, t, s;
    if (kind === 'random-smooth') {
      var f1 = 1 + Math.round(seed[0]);          /* 1–2 half-waves */
      var f2 = 2 + Math.round(seed[1]);          /* 2–3 half-waves */
      var a2 = 0.35 + 0.4 * seed[2];
      var p1 = seed[3] * Math.PI * 2, p2 = seed[4] * Math.PI * 2;
      var raw = [], lo = Infinity, hi = -Infinity;
      for (i = 0; i < n; i++) {
        t = i / (n - 1);
        s = Math.sin(Math.PI * f1 * t + p1) + a2 * Math.sin(Math.PI * f2 * t + p2);
        raw.push(s);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      for (i = 0; i < n; i++) ws.push(wMin + ((raw[i] - lo) / (hi - lo)) * (wMax - wMin));
      return ws;
    }
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      ws.push(wMin + baseShape(kind, t) * (wMax - wMin));
    }
    return ws;
  }

  /* Per-hardware tuning, derived from ONE number: the multiplier
     ArtDaily.ease() reports for the current input mode. Pure — hand
     it 1 and you get the pen standard back. */
  function tuning(easeMul) {
    var m = (typeof easeMul === 'number' && easeMul > 0) ? easeMul : 1;
    var zero = Math.min(RMS_BASE * m, RMS_CAP);
    return {
      rmsZero: zero,
      /* the flat gate is widened by the SAME ratio the RMS was, so a
         trackpad is not told to "commit" for a range its band-height
         control makes harder to swing */
      flatFrac: FLAT_FRAC * RMS_BASE / zero,
      flatFactor: FLAT_FACTOR
    };
  }

  /* Min-max normalize to [0,1]; a flat profile becomes all 0.5. */
  function normalizeProfile(ws) {
    var lo = Infinity, hi = -Infinity, out = [], i;
    for (i = 0; i < ws.length; i++) {
      if (ws[i] < lo) lo = ws[i];
      if (ws[i] > hi) hi = ws[i];
    }
    if (hi - lo < 1e-9) { for (i = 0; i < ws.length; i++) out.push(0.5); return out; }
    for (i = 0; i < ws.length; i++) out.push((ws[i] - lo) / (hi - lo));
    return out;
  }

  function rmsDiff(a, b) {
    var s = 0, i, d;
    for (i = 0; i < a.length; i++) { d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s / a.length);
  }

  /* flatFactor when the raw widths used less than flatFrac of the
     available range (a flat, no-dynamics stroke), else 1. */
  function rangeFactor(rawWs, availMin, availMax, flatFrac, flatFactor) {
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < rawWs.length; i++) {
      if (rawWs[i] < lo) lo = rawWs[i];
      if (rawWs[i] > hi) hi = rawWs[i];
    }
    return (hi - lo) < flatFrac * (availMax - availMin) ? flatFactor : 1;
  }

  function scoreStroke(targetRaw, playerRaw, availMin, availMax, tune) {
    var t = tune || tuning(1);
    var tN = normalizeProfile(targetRaw);
    var pN = normalizeProfile(playerRaw);
    var rms = rmsDiff(tN, pN);
    var factor = rangeFactor(playerRaw, availMin, availMax, t.flatFrac, t.flatFactor);
    var s = 100 * clamp01(1 - rms / t.rmsZero) * factor;
    if (!isFinite(s)) s = 0;
    return {
      score: Math.max(0, Math.min(100, s)),
      rms: rms,
      flat: factor < 1,
      tN: tN,
      pN: pN
    };
  }

  function meanScore(arr) {
    if (!arr.length) return 0;
    var s = 0, i;
    for (i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  /* height above the guide (px, positive = up) → raw width */
  function offsetToWidth(above, span, wMin, wMax) {
    var k = (span > 0) ? clamp01(above / span) : 0;
    return wMin + k * (wMax - wMin);
  }

  function pressureToWidth(p, wMin, wMax) { return wMin + clamp01(p) * (wMax - wMin); }

  function emaNext(prev, raw, alpha) { return prev + alpha * (raw - prev); }

  /* How much of the new raw width the running average takes.

     A FIXED per-event weight lags by a fixed number of EVENTS, which is a
     distance along the guide proportional to how fast the hand is moving.
     That put every thick and thin downstream of where the player actually
     placed it, by further the faster they drew — and this drill dropped
     speed-driven width in the first place so that the same gesture reads
     the same at any speed. The smoothing was quietly putting the speed
     back in: a mathematically perfect "two bumps" pulled at a brisk 20px
     per event scored 46 on a desktop sheet and 23 on a phone.

     So the weight is compounded over the guide progress the sample
     actually covered (perBucket is what ONE of the 64 buckets is worth)
     and floored at the old per-event weight — a hand that is barely
     moving, or climbing straight up at one x where progress is zero,
     keeps exactly the smoothing it has always had. The lag is then about
     a third of a bucket whatever the hardware, the speed or the sheet
     width, instead of anything from a third to eight buckets. */
  function emaAlpha(lastT, t, n, perEvent, perBucket) {
    var floor = (typeof perEvent === 'number' && perEvent > 0 && perEvent <= 1) ? perEvent : 1;
    if (lastT === null || lastT === undefined) return 1;
    var steps = Math.abs(t - lastT) * (n - 1);
    if (!(steps > 0)) return floor;
    var a = 1 - Math.pow(1 - perBucket, steps);
    if (!isFinite(a)) return 1;
    return Math.max(floor, Math.min(1, a));
  }

  /* ---- the attempt buffer: widths laid down over the guide ----
     prof[i] is the width the player asked for at position i/(n-1)
     along the guide; got[i] says whether they have been there yet.
     Everything below is pure array work, so a lift, a resize, a
     resume and a replay all reduce to the same two arrays. */

  function fillSpan(prof, got, t0, w0, t1, w1) {
    var n = prof.length, i, f;
    var lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    var i0 = Math.ceil(lo * (n - 1) - 1e-9);
    var i1 = Math.floor(hi * (n - 1) + 1e-9);
    if (i1 < i0) {
      /* the move landed between two buckets — stamp the nearer one so
         a slow, careful hand still writes something */
      i = Math.round(((t0 + t1) / 2) * (n - 1));
      if (i >= 0 && i < n) { prof[i] = (w0 + w1) / 2; got[i] = true; }
      return;
    }
    for (i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
      f = (Math.abs(t1 - t0) > 1e-9) ? clamp01((i / (n - 1) - t0) / (t1 - t0)) : 0;
      prof[i] = w0 + (w1 - w0) * f;
      got[i] = true;
    }
  }

  function coverage(got) {
    var c = 0, i;
    for (i = 0; i < got.length; i++) if (got[i]) c++;
    return got.length ? c / got.length : 0;
  }

  /* Which END of the guide is still bare, in words.
     The attempt only closes end to end (COVER_DONE), so a sweep that
     started and finished a few pixels INSIDE the dashes leaves a bucket
     untouched at one end and reads to the player as a finished stroke
     that the drill simply refused: "you lifted at 95%. press again and
     keep going" names a number and no direction, and pulling the same
     honest sweep again lands on exactly the same 95%. Naming the bare end
     is the difference between a loop and a fix. '' when the gap is
     somewhere in the middle, where "keep going" is already the answer. */
  function bareEnd(got) {
    var n = got ? got.length : 0;
    if (!n) return '';
    var lo = !got[0], hi = !got[n - 1];
    if (lo && hi) return 'both ends of the guide are still bare';
    if (lo) return 'the start of the guide is still bare';
    if (hi) return 'the finish of the guide is still bare';
    return '';
  }

  /* Bridge the buckets the player skipped (a fast sweep, or the last
     few percent at either end) so a finished attempt is a complete
     64-sample profile. null when nothing was drawn at all. */
  function closeGaps(prof, got) {
    var n = prof.length, out = prof.slice(), i, j, k, first = -1, last = -1;
    for (i = 0; i < n; i++) if (got[i]) { if (first < 0) first = i; last = i; }
    if (first < 0) return null;
    for (i = 0; i < first; i++) out[i] = prof[first];
    for (i = last + 1; i < n; i++) out[i] = prof[last];
    i = first;
    while (i <= last) {
      if (got[i]) { i++; continue; }
      j = i;
      while (j <= last && !got[j]) j++;
      for (k = i; k < j; k++) {
        out[k] = out[i - 1] + (prof[j] - out[i - 1]) * (k - i + 1) / (j - i + 1);
      }
      i = j;
    }
    return out;
  }

  /* One verdict line keyed to where the normalized error concentrated:
     worst third of the guide + which direction it missed. Phrased for
     the control the player actually has — a mouse user has nothing to
     press, so "push harder" is an instruction their hardware cannot
     obey. */
  var ZONE_NAMES = ['at the start', 'through the middle', 'into the finish'];
  var ZONE_MISS = 0.08;   /* per-third RMS below this reads as "on target" */

  /* Where the normalized error concentrated: RMS and signed mean per
     third of the guide. Shared by the per-stroke verdict and the
     round-end coaching so the two can never contradict each other.
     Degenerate input (empty profile, a third with no samples) returns
     finite zeros rather than NaN. */
  function zoneError(tN, pN) {
    var n = Math.min(tN ? tN.length : 0, pN ? pN.length : 0);
    var sq = [0, 0, 0], mean = [0, 0, 0], cnt = [0, 0, 0], i, z, d;
    for (i = 0; i < n; i++) {
      z = Math.min(2, Math.floor(3 * i / n));
      d = pN[i] - tN[i];
      if (!isFinite(d)) continue;
      sq[z] += d * d;
      mean[z] += d;
      cnt[z] += 1;
    }
    var worst = 0;
    for (i = 0; i < 3; i++) {
      sq[i] = cnt[i] ? Math.sqrt(sq[i] / cnt[i]) : 0;
      mean[i] = cnt[i] ? mean[i] / cnt[i] : 0;
      if (sq[i] > sq[worst]) worst = i;
    }
    return { sq: sq, mean: mean, worst: worst, miss: sq[worst] >= ZONE_MISS, under: mean[worst] < 0 };
  }

  function verdictLine(tN, pN, flat, pressureMode) {
    if (flat) {
      return pressureMode
        ? 'too even — press where it lands, lift where it whispers.'
        : 'too even — climb higher for weight, ride the dashes for hairline.';
    }
    var z = zoneError(tN, pN);
    if (!z.miss) return 'clean — the weight lands where it should.';
    var where = ZONE_NAMES[z.worst];
    if (z.under) {
      return (pressureMode ? 'press harder ' : 'climb higher ') + where + '.';
    }
    return (pressureMode ? 'ease off ' : 'drop closer to the dashes ') + where + '.';
  }

  /* The reveal draws the player's RAW widths over the target's ribbon, but
     the score compares both profiles MIN-MAX NORMALIZED — shape, not
     absolute weight, which is the whole point of the drill. So a flawless
     shape pulled along the bottom half of the band scores 100 and is told
     "clean — the weight lands where it should", while the sheet shows that
     same stroke as a hairline ribbon laid inside one nearly twice as thick
     (measured: mean-width ratio 0.57–0.59 against the target, on all five
     profile kinds). The player can SEE a delta the size of the drill and
     the only conclusion left to them is that the scoring is broken. Name
     it: what they are looking at, and why it cost nothing.

     Silent when the two weights are close, and silent when the score is
     low enough that the verdict already has something more useful to say. */
  var SPAN_NOTE_SCORE = 70;   /* below this, the miss is the story, not the weight */
  var SPAN_NOTE_RATIO = 1.4;  /* mean-width ratio, either way, that reads as a different weight */

  function meanWidth(ws) {
    var n = ws ? ws.length : 0, s = 0, i;
    if (!n) return 0;
    for (i = 0; i < n; i++) {
      if (!isFinite(ws[i])) return 0;
      s += ws[i];
    }
    return s / n;
  }

  function spanNote(targetRaw, playerRaw, score) {
    if (!(score >= SPAN_NOTE_SCORE)) return '';
    var t = meanWidth(targetRaw), p = meanWidth(playerRaw);
    if (!(t > 0) || !(p > 0)) return '';
    var r = Math.log(p / t);
    if (!isFinite(r) || Math.abs(r) < Math.log(SPAN_NOTE_RATIO)) return '';
    return r < 0
      ? ' your line ran lighter than the target all through — the drill scores where the weight goes, not how much.'
      : ' your line ran heavier than the target all through — the drill scores where the weight goes, not how much.';
  }

  /* Five strokes each said their piece and then the round ended on
     "press new round" — nothing ever added them up, so a player who
     fades into every finish was told so five times and never once told
     it was a habit. One line, naming the pattern across the round. */
  function roundCoach(records, pressureMode) {
    var n = records ? records.length : 0;
    if (!n) return 'nothing scored this round.';
    var flat = 0, miss = [0, 0, 0], dir = [0, 0, 0], i, r;
    for (i = 0; i < n; i++) {
      r = records[i];
      if (!r) continue;
      if (r.flat) { flat += 1; continue; }
      if (!r.miss) continue;
      miss[r.worst] += 1;
      dir[r.worst] += r.under ? -1 : 1;
    }
    if (flat * 2 >= n) {
      return 'most of your strokes came out one even weight — the change IS the drill: ' +
        (pressureMode ? 'press where the line lands, lift where it leaves.'
                      : 'climb for where the line lands, ride the dashes where it leaves.');
    }
    var w = 0;
    for (i = 1; i < 3; i++) if (miss[i] > miss[w]) w = i;
    if (!miss[w]) {
      /* "all round" has to mean all round. A minority of dead-flat strokes
         does not trip the branch above, and the round used to close by
         telling that player everything landed where it should — flatly
         contradicting the ×0.8 those strokes were just charged. */
      if (!flat) return 'the weight landed where it should all round — take the freehand one faster next time.';
      return (flat === 1 ? 'one stroke' : flat + ' strokes') +
        ' came out one even weight; the rest landed where they should — ' +
        (pressureMode ? 'keep pressing where the line lands and lifting where it leaves.'
                      : 'keep climbing where the line lands and riding the dashes where it leaves.');
    }
    /* a dead tie between too-thin and too-heavy is not "too thin", and it
       cannot be described as happening "more often than not" either */
    if (dir[w] === 0) {
      return 'across the round your weight slipped most ' + ZONE_NAMES[w] +
        ' — sometimes too thin there, sometimes too heavy.';
    }
    return 'across the round your weight slipped most ' + ZONE_NAMES[w] + ' — you were ' +
      (dir[w] < 0 ? 'too thin' : 'too heavy') + ' there more often than not.';
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
  var covLabel = document.getElementById('strokeCov');
  var btnRetry = document.getElementById('btnRetry');

  ArtDaily.init({ slug: SLUG });

  /* '#rgb' / '#rrggbb' / 'rgb(…)' → [r,g,b]; null when unparseable */
  function parseColor(str) {
    var m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(str);
    if (m) return [parseInt(m[1], 16) * 17, parseInt(m[2], 16) * 17, parseInt(m[3], 16) * 17];
    m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(str);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(str);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  /* color-mix(in srgb, a f, b) — same recipe the sheet css uses to ink
     the accent toward graphite so numbers clear AA on paper. */
  function mixColors(a, b, f) {
    var ca = parseColor(a), cb = parseColor(b);
    if (!ca || !cb) return a;
    var r = Math.round(ca[0] * f + cb[0] * (1 - f));
    var g = Math.round(ca[1] * f + cb[1] * (1 - f));
    var bl = Math.round(ca[2] * f + cb[2] * (1 - f));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* ---- theme-aware inks (re-read on every repaint) ---- */
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var ink = cs.getPropertyValue('--ink').trim();
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--sky').trim();
    return {
      ink: ink,
      muted: cs.getPropertyValue('--muted').trim(),
      card: cs.getPropertyValue('--card').trim(),
      accent: accent,
      /* raw accent fails AA as text on the paper card (~3.2:1); mixed
         55% toward ink it clears 4.5:1. Dark passes as-is. */
      accentText: ArtDaily.theme() === 'dark' ? accent : mixColors(accent, ink, 0.55)
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ----
     Phones get a taller sheet: the weight band needs vertical room and
     H = 0.62W leaves a 330px phone with a 205px drill area. */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.round(W * (W < 520 ? 0.82 : 0.62));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- width source ----
     Decided ONCE, at the press that opens an attempt, and held for the
     whole attempt. Previously it could flip mid-stroke (a tablet that
     reports pressure 0 at first contact, or an Android finger whose
     contact-area "pressure" wobbles past a 0.05 threshold), welding
     half a speed profile to half a pressure profile and scoring the
     seam. Pressure is now pen-only for the same reason: an Android
     finger's pressure is fingertip squash, not intent. */
  var penPressureSeen = false;
  var lastPenAt = -1e9;

  function naturalMode(ev) {
    if (ev.pointerType === 'pen' && ((ev.pressure || 0) > 0 || penPressureSeen)) return 'pressure';
    return 'offset';
  }

  /* what the CURRENT attempt is (or the next one will be) driven by.
     Between attempts the sheet ADVERTISES a control — the hint sentence and
     the weight band itself — and it has to be one the hardware in the
     player's hand actually has. penPressureSeen is sticky for the session,
     so an iPad player who put the pencil down, or a laptop player who
     unplugged a tablet, was told "press to thicken, lift off to whisper" —
     an instruction a finger or a trackpad cannot obey — and the weight
     band, which is the whole lesson for every non-pen device, was left off
     the sheet until their first press quietly corrected both. The SDK
     already knows what is in the hand and repaints us on every change. */
  function usingPressure() {
    if (att && att.mode) return att.mode === 'pressure';
    return penPressureSeen && ArtDaily.inputMode() === 'pen';
  }

  function modeHint() {
    return usingPressure()
      ? 'press to thicken, lift off to whisper.'
      : 'ride the dashes for a hairline, climb into the band above them for weight.';
  }

  /* ---- round state ---- */
  var round = 0, strokeIdx = 0, scores = [], spec = null, playing = false;
  /* one zoneError record per scored stroke — what the round-end coaching
     is built from (see roundCoach) */
  var records = [];
  /* spanNote() teaches once per round: it explains the sheet, and an
     explanation repeated on all five strokes stops being one */
  var spanNoted = false;
  var drawing = false, activeId = null, activeType = '', revealing = null, revealTimer = null;
  /* what the pending reveal beat is holding, kept separately from its
     timer handle so a hidden tab can park the beat and hand it back in
     full rather than letting it run out off-screen — see the
     visibilitychange handler */
  var revealJob = null;

  function armReveal(fn) {
    revealJob = fn;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () {
      revealTimer = null;
      revealJob = null;
      fn();
    }, REVEAL_MS);
  }

  function cancelReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    revealJob = null;
  }
  var att = null;          /* the attempt buffer — see newAttempt() */
  var cursor = null;       /* {x, y} live weight readout while drawing */

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function strokeLabel() {
    return 'stroke ' + (strokeIdx + 1) + ' of ' + STROKES_PER_ROUND +
      ' · ' + PROFILE_LABEL[spec.kind];
  }

  /* Later strokes: subtler width span, deeper curve — the ramp is
     mostly the profile kinds themselves (see PROFILE_ORDER). */
  function makeSpec(idx) {
    var kind = PROFILE_ORDER[idx];
    var wMin = idx < 2 ? rand(2, 3.5) : rand(2.5, 5);
    var wMax = idx < 2 ? rand(12.5, 16) : rand(11, 15);
    var seed = [Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
    spec = {
      kind: kind,
      wMin: wMin,
      wMax: wMax,
      ampF: (0.05 + 0.012 * idx + rand(0, 0.03)) * (Math.random() < 0.5 ? -1 : 1),
      tiltF: rand(-0.04, 0.04),
      targetWs: makeTargetProfile(kind, N_SAMPLES, wMin, wMax, seed)
    };
  }

  function newAttempt() {
    var prof = [], got = [], i;
    for (i = 0; i < N_SAMPLES; i++) { prof.push(AVAIL_MIN); got.push(false); }
    att = {
      prof: prof, got: got,
      mode: null,          /* 'pressure' | 'offset', locked for the attempt */
      lastT: null, lastW: AVAIL_MIN, emaW: null,
      liftX: 0, liftY: 0, liftAt: -1e9, lifted: false,
      snapProf: null, snapGot: null
    };
    cursor = null;
  }

  function newRound() {
    cancelReveal();
    round += 1;
    strokeIdx = 0;
    scores = [];
    records = [];
    spanNoted = false;
    drawing = false;
    activeId = null;
    activeType = '';
    revealing = null;
    playing = true;
    newAttempt();
    makeSpec(0);
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    hint.textContent = strokeLabel() + ' — ' + modeHint();
    updateBar();
    draw();
  }

  function updateBar() {
    /* FLOOR, not round: 62 of the 64 buckets is 96.9%, which rounded up to
       a displayed "inked: 97%" — the exact number COVER_DONE asks for — on
       a stroke the drill was about to refuse. The readout must never claim
       a percentage the attempt would not be accepted at. */
    var pct = att ? Math.floor(coverage(att.got) * 100) : 0;
    covLabel.textContent = revealing ? 'inked: 100%' : 'inked: ' + pct + '%';
    btnRetry.disabled = !playing || !!revealing || pct < 1;
  }

  function retryStroke() {
    if (!playing || revealing) return;
    drawing = false;
    activeId = null;
    activeType = '';
    newAttempt();
    hint.textContent = strokeLabel() + ' — cleared. ' + modeHint();
    updateBar();
    draw();
  }

  /* ---- geometry (derived from W/H so resize just redraws) ---- */
  var X_MARGIN = 26;

  function guideSpanPx() { return Math.max(1, W - 2 * X_MARGIN); }

  function tFromX(x) { return clamp01((x - X_MARGIN) / guideSpanPx()); }

  function xFromT(t) { return X_MARGIN + t * guideSpanPx(); }

  function curveY(yBase, t) {
    return yBase + spec.ampF * H * Math.sin(Math.PI * t) + spec.tiltF * H * (t - 0.5);
  }

  function curvePts(yBase) {
    var out = [], i, t;
    for (i = 0; i < N_SAMPLES; i++) {
      t = i / (N_SAMPLES - 1);
      out.push({ x: xFromT(t), y: curveY(yBase, t) });
    }
    return out;
  }

  function yTargetBase() { return H * 0.26; }
  function yGuideBase() { return H * 0.62; }
  function guideY(t) { return curveY(yGuideBase(), t); }

  /* The weight band: how far above the dashes "heaviest" sits. A
     fraction of the sheet with an absolute floor, so a phone still
     gets a band a thumb can travel rather than a 20px sliver. */
  function bandSpan() {
    var gap = yGuideBase() - yTargetBase();
    return Math.max(34, Math.min(Math.round(0.24 * H), Math.round(gap - 26)));
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */
  function ribbonPath(cPts, cWs) {
    var i, n = cPts.length, p0, p1, tx, ty, len, nx, ny, hw;
    var left = [], right = [];
    for (i = 0; i < n; i++) {
      p0 = cPts[Math.max(0, i - 1)];
      p1 = cPts[Math.min(n - 1, i + 1)];
      tx = p1.x - p0.x; ty = p1.y - p0.y;
      len = Math.hypot(tx, ty) || 1;
      nx = -ty / len; ny = tx / len;
      hw = Math.max(0.5, cWs[i]) / 2;
      left.push({ x: cPts[i].x + nx * hw, y: cPts[i].y + ny * hw });
      right.push({ x: cPts[i].x - nx * hw, y: cPts[i].y - ny * hw });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
  }

  function fillRibbon(cPts, cWs, color, alpha) {
    if (cPts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ribbonPath(cPts, cWs);
    ctx.fill();
    ctx.restore();
  }

  /* the inked parts of the attempt, drawn on the guide itself — one
     ribbon per contiguous run, so a lift reads as a visible gap the
     player can go back and fill */
  function fillAttempt(cPts, color, alpha) {
    var i = 0, j, run, runW;
    while (i < N_SAMPLES) {
      if (!att.got[i]) { i++; continue; }
      j = i;
      while (j + 1 < N_SAMPLES && att.got[j + 1]) j++;
      if (j > i) {
        run = []; runW = [];
        for (var k = i; k <= j; k++) { run.push(cPts[k]); runW.push(att.prof[k]); }
        fillRibbon(run, runW, color, alpha);
      }
      i = j + 1;
    }
  }

  function dashedCurve(cPts, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(cPts[0].x, cPts[0].y);
    for (var i = 1; i < cPts.length; i++) ctx.lineTo(cPts[i].x, cPts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function tinyLabel(text, x, y, color, align) {
    ctx.fillStyle = color;
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }

  /* The band IS the lesson for every non-pen player, so it is drawn,
     labelled at both ends, and taught again on the first stroke of a
     round. --muted at 0.8 clears 3:1 against the card in both themes. */
  function drawBand(c, gPts) {
    var span = bandSpan(), i, top = [];
    for (i = 0; i < gPts.length; i++) top.push({ x: gPts[i].x, y: gPts[i].y - span });
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(gPts[0].x, gPts[0].y);
    for (i = 1; i < gPts.length; i++) ctx.lineTo(gPts[i].x, gPts[i].y);
    for (i = top.length - 1; i >= 0; i--) ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    /* the band's top edge is what "heaviest" MEANS, so it holds the
       same 3:1 floor the rest of the sheet's graphics do: --muted at
       0.8 clears it in both themes */
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
    ctx.stroke();
    ctx.restore();
    tinyLabel('heaviest up here', top[0].x, top[0].y - 5, c.muted);
    tinyLabel('hairline on the dashes', gPts[0].x, gPts[0].y + 14, c.muted);
  }

  /* live readout: how thick the pointer is asking for, right now */
  function drawCursor(c) {
    var t = tFromX(cursor.x), gy = guideY(t);
    var w = offsetToWidth(gy - cursor.y, bandSpan(), AVAIL_MIN, AVAIL_MAX);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = c.accentText;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(cursor.x, gy);
    ctx.lineTo(cursor.x, Math.min(gy, cursor.y));
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = c.accentText;
    ctx.beginPath();
    ctx.arc(cursor.x, Math.min(gy, cursor.y), Math.max(2, w / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* First stroke of a round: name the control on the sheet, in words
     and with an arrow. The drill exists to teach where weight goes;
     it must not also make you guess how to ask for it. */
  function drawCoach(c, gPts) {
    var mid = gPts[Math.floor(N_SAMPLES * 0.62)];
    var span = bandSpan();
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = c.accentText;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y - 4);
    ctx.lineTo(mid.x, mid.y - span + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid.x - 4, mid.y - span + 10);
    ctx.lineTo(mid.x, mid.y - span + 3);
    ctx.lineTo(mid.x + 4, mid.y - span + 10);
    ctx.stroke();
    ctx.restore();
    tinyLabel('higher = thicker', mid.x + 8, mid.y - span / 2, c.accentText);
  }

  function drawGraph(c) {
    var gw = Math.min(W * 0.42, 300), gh = H * 0.16;
    var gx = W - gw - 14, gy = H - gh - 12;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = c.card;
    ctx.fillRect(gx - 8, gy - 18, gw + 16, gh + 28);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.restore();
    plotProfile(revealing.tN, gx, gy, gw, gh, c.muted, 2);
    plotProfile(revealing.pN, gx, gy, gw, gh, c.accent, 2);
    /* The graph IS the delta — two curves, and until now nothing said
       which one was yours. "weight shape — target vs yours" named them in
       reading order and left the player to guess the mapping, and at 29
       characters it also ran past the edge of its own card on a phone
       (the card is gw+16 wide, ~154px at 330px sheet). A swatch in each
       curve's own colour beside its own word cannot be misread and fits. */
    var lx = gx;
    lx += legendKey(lx, gy - 6, c.muted, c.muted, 'target');
    legendKey(lx + 10, gy - 6, c.accent, c.accentText, 'yours');
  }

  /* One key: a short rule in the curve's colour, then its word. Returns the
     width it consumed so the next key can sit after it. */
  function legendKey(x, y, lineColor, textColor, text) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 3.5);
    ctx.lineTo(x + 11, y - 3.5);
    ctx.stroke();
    ctx.restore();
    tinyLabel(text, x + 15, y, textColor);
    ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
    return 15 + ctx.measureText(text).width;
  }

  function plotProfile(prof, gx, gy, gw, gh, color, lw) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < prof.length; i++) {
      var x = gx + gw * i / (prof.length - 1);
      var y = gy + gh * (1 - (0.08 + 0.84 * prof[i]));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!spec) return;

    var tPts = curvePts(yTargetBase());
    fillRibbon(tPts, spec.targetWs, c.muted, 0.5);
    dashedCurve(tPts, c.muted, 0.85);
    tinyLabel('match this weight', tPts[0].x, tPts[0].y - 16, c.muted);

    var gPts = curvePts(yGuideBase());

    if (revealing) {
      /* their profile washed over the target's ribbon, in accent */
      fillRibbon(tPts, revealing.player64, c.accent, 0.45);
      /* their own ink, on the guide where they laid it */
      fillRibbon(gPts, revealing.player64, c.ink, 0.6);
      dashedCurve(gPts, c.muted, 0.3);
      /* stroke score chip, top right */
      var label = String(revealing.score);
      ctx.font = '900 17px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      var tw = ctx.measureText(label).width + 18;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = c.card;
      ctx.fillRect(W - 14 - tw, 10, tw, 24);
      ctx.restore();
      ctx.fillStyle = c.accentText;
      ctx.fillText(label, W - 22, 27);
      /* say what it scored FOR — the tolerance was eased for this
         hardware and the record should admit it */
      tinyLabel(revealing.modeNote, W - 14 - tw - 8, 27, c.muted, 'right');
      drawGraph(c);
      return;
    }

    if (!playing) return;

    var byHeight = !usingPressure();
    if (byHeight) drawBand(c, gPts);
    dashedCurve(gPts, c.muted, 0.8);
    tinyLabel('redraw it here', gPts[0].x, gPts[0].y - 16, c.muted);

    fillAttempt(gPts, c.ink, 0.85);
    if (byHeight && strokeIdx === 0 && coverage(att.got) < 0.02) drawCoach(c, gPts);
    if (byHeight && cursor && drawing) drawCursor(c);
  }

  /* ---- input ----
     One attempt may be pulled in as many passes as the hardware needs.
     Position is horizontal progress along the guide, so a resumed pass
     simply carries on filling in the profile — there is nothing to
     stitch and nothing to score twice. */
  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /* pen beats a simultaneous touch: an artist rests the palm BEFORE
     the nib lands, so first-pointer-wins hands the stroke to the palm */
  function penWins(ev) {
    var now = (typeof ev.timeStamp === 'number') ? ev.timeStamp : Date.now();
    if (ev.pointerType === 'pen') { lastPenAt = now; return true; }
    if (ev.pointerType === 'touch' && now - lastPenAt < PEN_GUARD_MS) return false;
    return true;
  }

  function sampleWidth(ev, p) {
    var t = tFromX(p.x), raw;
    if (att.mode === 'pressure') {
      raw = pressureToWidth(ev.pressure || 0, AVAIL_MIN, AVAIL_MAX);
    } else {
      raw = offsetToWidth(guideY(t) - p.y, bandSpan(), AVAIL_MIN, AVAIL_MAX);
    }
    /* att.lastT is still the PREVIOUS sample here — addSample moves it on
       after this returns — so the alpha is weighted by the ground this
       sample covered. */
    att.emaW = (att.emaW === null)
      ? raw
      : emaNext(att.emaW, raw, emaAlpha(att.lastT, t, N_SAMPLES, EMA_ALPHA, EMA_BUCKET));
    return att.emaW;
  }

  /* Feed one sample in. Position IS horizontal progress along the guide,
     so a sample is filed exactly where the pointer put it — the ink
     always appears under the hand, and the profile is compared against a
     target that is laid out the same way along the same guide. (This used
     to reverse a right-to-left pull "as it reads on paper", which painted
     the ribbon at the opposite end of the guide from the pointer and
     scored a spatially perfect trace as its own mirror image.) */
  function addSample(t, w) {
    if (att.lastT === null) fillSpan(att.prof, att.got, t, w, t, w);
    else fillSpan(att.prof, att.got, att.lastT, att.lastW, t, w);
    att.lastT = t;
    att.lastW = w;
  }

  function beginSegment(ev) {
    var p = pointerPos(ev);
    drawing = true;
    activeId = ev.pointerId;
    activeType = ev.pointerType || '';
    att.snapProf = att.prof.slice();
    att.snapGot = att.got.slice();
    att.lastT = null;
    att.emaW = null;
    cursor = p;
    addSample(tFromX(p.x), sampleWidth(ev, p));
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    try { canvas.focus({ preventScroll: true }); } catch (e) {}
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (!playing || revealing) return;
    if (ev.pointerType === 'pen' && (ev.pressure || 0) > 0) penPressureSeen = true;
    if (!penWins(ev)) return;                       /* palm, while a pen is live */
    if (drawing) {
      /* a pen landing on top of a touch stroke evicts it and takes over,
         discarding what the palm drew in this pass */
      if (!(ev.pointerType === 'pen' && activeType === 'touch')) return;
      try { canvas.releasePointerCapture(activeId); } catch (e) {}
      att.prof = att.snapProf ? att.snapProf.slice() : att.prof;
      att.got = att.snapGot ? att.snapGot.slice() : att.got;
      if (coverage(att.got) <= COVER_TAP) newAttempt();
      drawing = false;
      activeId = null;
      activeType = '';
    }
    ev.preventDefault();

    var want = naturalMode(ev);
    var advertised = usingPressure();
    if (att.mode === null) {
      att.mode = want;
      /* the sheet promised one control and the press revealed another
         (a pen whose pressure only shows up at contact) — say so now
         rather than leaving a band on screen that does nothing */
      if (usingPressure() !== advertised) {
        hint.textContent = strokeLabel() + ' — ' + modeHint();
      }
    } else if (att.mode === want || coverage(att.got) <= COVER_TAP) {
      att.mode = want;
    } else if (att.mode === 'pressure') {
      /* the pen that was driving this attempt is gone, and a mouse or a
         finger cannot produce pressure at all — every later sample would
         be one flat weight welded to the half already drawn */
      newAttempt();
      att.mode = want;
      hint.textContent = strokeLabel() + ' — input changed, fresh start. ' + modeHint();
    }
    /* else: a pen whose pressure only turned up after first contact. The
       attempt keeps the height control it opened with — a nib aims height
       as well as anything does — so the resume the hint just promised
       ("press again and keep going") never throws the ink away. The next
       attempt starts in pressure mode. */

    if (att.lifted && coverage(att.got) > COVER_TAP) {
      var p0 = pointerPos(ev);
      var far = Math.hypot(p0.x - att.liftX, p0.y - att.liftY) > ArtDaily.startRadius(60);
      var late = (Date.now() - att.liftAt) > RESUME_MS;
      hint.textContent = (far || late)
        /* quote the button by the label it actually wears, or the player
           hunts the controls for a "start over" that is not there */
        ? strokeLabel() + ' — carrying on from ' + Math.round(coverage(att.got) * 100) + '%. “start this stroke over” if you meant to restart.'
        : strokeLabel() + ' — ' + modeHint();
    }
    att.lifted = false;
    beginSegment(ev);
    updateBar();
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!drawing || ev.pointerId !== activeId) return;
    ev.preventDefault();
    if (ev.pointerType === 'pen' && (ev.pressure || 0) > 0) penPressureSeen = true;
    /* a 120Hz pen delivers several positions per dispatched event —
       reading them all keeps a fast sweep at full fidelity */
    var evs = (typeof ev.getCoalescedEvents === 'function') ? ev.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [ev];
    for (var i = 0; i < evs.length; i++) {
      var p = pointerPos(evs[i]);
      cursor = p;
      addSample(tFromX(p.x), sampleWidth(evs[i], p));
    }
    updateBar();
    draw();
  });

  function endSegment(ev, cancelled) {
    if (!drawing || ev.pointerId !== activeId) return;
    if (ev.cancelable) ev.preventDefault();
    drawing = false;
    activeId = null;
    activeType = '';
    cursor = null;
    var cov = coverage(att.got);
    /* a stolen gesture (system swipe, iOS callout) must never score —
       the player did not choose to stop */
    if (!cancelled && cov >= COVER_DONE) { scoreAttempt(); return; }
    att.lifted = true;
    var p = pointerPos(ev);
    att.liftX = p.x; att.liftY = p.y; att.liftAt = Date.now();
    if (cancelled) {
      hint.textContent = strokeLabel() + ' — stroke interrupted, nothing lost. press again and keep going.';
    } else if (cov <= COVER_TAP) {
      hint.textContent = strokeLabel() + ' — press and pull along the dashes. ' + modeHint();
    } else {
      /* the trackpad case: a lift is hardware, not a drawing fault, and
         it costs nothing — but say WHERE the ink is still missing when it
         is an end, or an honest end-to-end-looking sweep just repeats */
      var bare = bareEnd(att.got);
      hint.textContent = strokeLabel() + ' — you lifted at ' + Math.floor(cov * 100) +
        '%. no penalty: press again and keep going' + (bare ? ' — ' + bare + '.' : '.');
    }
    updateBar();
    draw();
  }

  function onUp(ev) { endSegment(ev, false); }
  function onCancel(ev) { endSegment(ev, true); }

  canvas.addEventListener('pointerup', onUp);
  /* fallback if pointer capture failed and the release lands off-canvas */
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  window.addEventListener('pointercancel', onCancel);
  /* iOS drops capture without a pointerup — same free lift, not a loss */
  canvas.addEventListener('lostpointercapture', onCancel);

  function scoreAttempt() {
    var player64 = closeGaps(att.prof, att.got);
    if (!player64) { updateBar(); draw(); return; }
    var pressureMode = (att.mode === 'pressure');
    var tune = tuning(ArtDaily.ease(1));
    var res = scoreStroke(spec.targetWs, player64, AVAIL_MIN, AVAIL_MAX, tune);
    scores.push(res.score);
    var zone = zoneError(res.tN, res.pN);
    records.push({ flat: res.flat, worst: zone.worst, miss: zone.miss, under: zone.under });
    revealing = {
      player64: player64,
      tN: res.tN,
      pN: res.pN,
      score: Math.round(res.score),
      modeNote: 'scored for ' + ArtDaily.inputLabel()
    };
    newAttempt();
    /* the score's own words, then — once a round — what the ribbons on the
       sheet are showing that the score deliberately ignored */
    var note = spanNoted ? '' : spanNote(spec.targetWs, player64, revealing.score);
    if (note) spanNoted = true;
    hint.textContent = strokeLabel() + ' — ' + revealing.score + ' · ' +
      verdictLine(res.tN, res.pN, res.flat, pressureMode) + note;
    updateBar();
    draw();
    if (scores.length >= STROKES_PER_ROUND) {
      /* the drill is finished NOW — report immediately, so a "new
         round" press (or a closed tab) during this reveal can never
         eat the result; the timer below only swaps the hint text
         while the fifth reveal stays on the sheet. */
      finishRound();
      armReveal(function () {
        /* the round's lesson, not just its exit: five separate verdicts
           add up to one habit worth naming */
        hint.textContent = 'round done — ' + roundCoach(records, pressureMode) +
          ' press "new round" to go again.';
      });
    } else {
      armReveal(nextStep);
    }
  }

  /* advance to the next stroke (never the finish — scoreAttempt reports
     a finished round on the spot, so a cleared timer can't lose it) */
  function nextStep() {
    if (!revealing || strokeIdx + 1 >= STROKES_PER_ROUND) return;
    strokeIdx += 1;
    revealing = null;
    newAttempt();
    makeSpec(strokeIdx);
    hint.textContent = strokeLabel() + ' — ' + modeHint();
    updateBar();
    draw();
  }

  function finishRound() {
    playing = false;
    var res = ArtDaily.report(meanScore(scores));
    hudScore.textContent = String(res.score);
    hudBest.textContent = res.best === null ? '–' : String(res.best);
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

  /* ---- chrome wiring ---- */
  document.getElementById('btnRound').addEventListener('click', newRound);
  btnRetry.addEventListener('click', retryStroke);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);
  /* hardware swapped mid-session (a laptop player plugs in a tablet) —
     the tolerance and the band both move, so say so and repaint */
  ArtDaily.onInput(function () {
    if (playing && !revealing) hint.textContent = strokeLabel() + ' — ' + modeHint();
    draw();
  });

  /* setTimeout keeps firing while the page is hidden, so a notification or
     an app switch during the 1.7s reveal used to advance the drill behind
     the player's back: they came back to the NEXT stroke's blank guide with
     the score chip, the two profile curves and the verdict for the stroke
     they just pulled already gone — and that reveal is the only place this
     drill ever shows the delta it just charged for. Park the beat while
     hidden and hand it back in full.

     Nothing can be lost by parking it: scoreAttempt() reports a finished
     round synchronously the moment the fifth stroke is scored, so the beat
     only ever advances a STROKE or swaps a line of hint text. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      /* keep revealJob — it is what the return re-arms */
      if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
      return;
    }
    if (revealing && revealJob && revealTimer === null) armReveal(revealJob);
  });

  window.addEventListener('resize', function () {
    /* height follows width, so a height-only change (an iOS toolbar
       collapsing mid-round) is a no-op. The attempt is stored as
       widths against fractional positions, so it survives a real
       resize untouched — only the lift point is in pixels. */
    var oldW = W;
    if (Math.abs(canvas.getBoundingClientRect().width - oldW) < 4) return;
    fitCanvas();
    if (att && oldW > 0) {
      var k = W / oldW;
      att.liftX *= k;
      att.liftY *= k;
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
