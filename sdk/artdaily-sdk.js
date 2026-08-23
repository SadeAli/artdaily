/* ============================================================
   artdaily-sdk.js — protocol v1.
   The single bridge between a drill and the Art Daily page.
   There is now exactly one copy of this file: every drill is a
   folder one level down and loads it as ../sdk/artdaily-sdk.js, so
   an edit here lands in all 43 at once — bump protocol versions in
   place (see GAME_GUIDE.md). It used to be vendored byte-identically
   into each game's own repo, which made a protocol change 43 pushes
   and let the copies drift apart between them.

   A game only ever calls:
     ArtDaily.init({ slug: 'lines' })      once, on load
     ArtDaily.report(score)                0–100, per finished drill
     ArtDaily.onTheme(fn)                  redraw hook (canvas games)
     ArtDaily.roundRandom(round)           the round's content generator
   Everything else — embed detection, theme sync with the parent
   page, personal bests, and the seeded day that makes two players'
   scores mean the same thing — is handled here.

   Wire format (postMessage, non-sensitive data only, so '*'
   target origins are fine; listeners validate source + shape):
     game → page  {type:'artdaily:ready',  slug, version:1}
     game → page  {type:'artdaily:result', slug, version:1, score}
     page → game  {type:'artdaily:theme',  theme:'dark'|'light'}
     page → game  {type:'artdaily:logged', slug, version:1, score}
                  (receipt for a standalone hand-off; see below)
   ============================================================ */
window.ArtDaily = (function () {
  'use strict';

  var VERSION = 1;
  var slug = '';
  var themeListeners = [];

  /* Cross-origin access to window.parent throws in some engines —
     any throw still means "we are inside someone's iframe". */
  var embedded = (function () {
    try { return window.parent !== window; } catch (e) { return true; }
  })();

  var params = (function () {
    try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; }
  })();

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = (t === 'light') ? 'light' : 'dark';
  }

  /* One observer serves both theme sources — a parent message and the
     game's own standalone toggle — so onTheme() never misses either. */
  var observed = currentTheme();
  new MutationObserver(function () {
    var t = currentTheme();
    if (t === observed) return;
    observed = t;
    themeListeners.forEach(function (fn) {
      try { fn(t); } catch (e) {}
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function post(msg) {
    if (!embedded) return;
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  /* ============================================================
     INPUT PROFILE (protocol v1, additive — a drill that ignores all of
     this behaves exactly as before).

     The same stroke means different things per hardware. A 15px wobble
     over a 300px line is sloppy from a pen and excellent from a mouse,
     which pivots at the wrist and cannot creep. Scoring every mode
     against the pen's standard silently tells beginners on the laptop
     they came with that they are bad at drawing — and they leave.

     Scores are only ever compared against the player's own history, so
     easing per mode is fair. The mode is shown in the drill's HUD so
     the record stays honest, and it is detected silently from the first
     pointer event — a beginner should never face a setup question
     before their first drill.
     ============================================================ */

  var mode = null;                /* 'pen' | 'mouse' | 'touch' */
  var modeListeners = [];

  /* ease: multiplies the error value at which a drill's score hits zero.
     pen = the reference. Mouse/trackpad need roughly double before an
     honest attempt reads as an honest attempt; a finger sits between.
     startRadius: pen needs the BIGGEST start zones despite being the
     most precise instrument — on a screenless tablet the hand is out of
     sight, so acquiring a small target is the hardest thing it does. */
  var PROFILE = {
    pen:   { ease: 1.0, start: 1.7, label: 'pen' },
    mouse: { ease: 2.0, start: 1.0, label: 'mouse or trackpad' },
    touch: { ease: 1.5, start: 1.6, label: 'finger' },
  };

  function profile() { return PROFILE[mode] || PROFILE.mouse; }

  /* Every number that crosses this boundary is checked for finiteness.
     A drill's tolerance is often computed (a fraction of a reference
     length, a fitted radius), and a degenerate round — zero-length
     reference, collinear points, an empty stroke — hands over NaN or
     Infinity. Passing that through silently poisons the drill's whole
     score: NaN loses every comparison so the score becomes NaN, and
     report() then files it as 0 with nothing logged anywhere. */
  function finite(v, fallback) {
    v = Number(v);
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  /* Any drill with an #inputMode element gets the label kept current for
     free — the score is eased, so the page says what it eased for. */
  function paintModeChip() {
    var el = document.getElementById('inputMode');
    if (!el) return;
    el.textContent = 'scoring for ' + profile().label;
    el.hidden = false;
  }

  function applyMode(m) {
    if (!m || m === mode) return;
    var was = profile();
    mode = m;
    try { localStorage.setItem('artdaily-input', m); } catch (e) {}
    paintModeChip();
    /* Only notify when the numbers a drill can actually SEE have moved.
       The very first press of a session takes mode null → 'mouse', but
       profile() already answered PROFILE.mouse before it, so nothing about
       the scoring changed. */
    if (profile() === was) return;
    modeListeners.forEach(function (fn) { try { fn(m); } catch (e) {} });
  }

  /* A profile change may not land in the middle of a press.
     Mode is detected on pointerdown, from a CAPTURE-phase listener — it
     runs BEFORE the canvas sees that same press. Applying the change there
     rebuilds the drill's geometry under the player's hand (steady-tunnel
     regenerates its corridor in onInput), and swings startRadius between
     the zone that was drawn and the zone that judges the hit: a saved
     'mouse' profile meeting a newly plugged-in pen jumped a 28px start dot
     to 48px mid-press. So a change that moves the numbers is queued and
     applied at the release that ends the press — and after that release
     has been dispatched, so the stroke is scored under the same ease it
     was drawn under. A no-op transition costs nothing and applies at once. */
  var pendingMode = null;
  var pointersDown = 0;

  function setMode(m) {
    if (!m) return;
    /* The newest press is the last word on what the hand is holding, so it
       also CANCELS a queue that contradicts it. Returning early here instead
       left a switch queued by a gesture whose release was never seen, and the
       next release — of a gesture made with the CURRENT hardware — applied it:
       press on the canvas, drag off the iframe, let go over the page, and the
       drill never gets that pointerup (the counter only self-heals on the next
       press). The trackpad round after that was then scored under the pen's
       ease, halving the zero-point on a stroke drawn with a mouse, and the HUD
       chip said "scoring for pen" while a trackpad was in use. It corrected
       itself one press later, which is one whole round too late. */
    if (m === mode) { pendingMode = null; return; }
    if (PROFILE[m] === profile()) { applyMode(m); return; }
    pendingMode = m;
  }

  /* A queued switch is applied at a RELEASE and nowhere else. There is no
     force flag: see the pointerdown listener for the press-start flush that
     used to exist and why it could only ever fire in the one window where it
     was wrong. */
  function flushMode() {
    if (!pendingMode) return;
    if (pointersDown > 0) return;
    var m = pendingMode;
    pendingMode = null;
    applyMode(m);
  }

  /* A pen outranks a finger, on the same clock the drills' input guards
     read through isPalm() below. Artists rest the palm on the glass mid-
     stroke; the drill refuses to draw with that contact, so it must not
     re-tune the scoring either — a stray palm used to flip the profile
     to 'touch' (ease 1.5) and score the pen's stroke, and every later
     one, against the finger's tolerance. */
  var PEN_LOCKOUT_MS = 700;   /* the lockout, for the profile and for isPalm */
  var lastPenAt = -1e9;

  function notePen(ev) {
    /* pointermove keeps this fresh for the whole stroke (and while the
       nib hovers), so a palm landing mid-stroke is always inside the
       lockout — no pointerup needed, nothing to leak if one is lost. */
    if (ev.pointerType === 'pen') lastPenAt = ev.timeStamp || 0;
  }

  /* ONE definition of "that contact is a palm, not an attempt", shared by
     the profile lockout below and by the drills through isPalm(). The two
     may not disagree about what a palm is: the SDK refusing to re-tune the
     scoring for a contact that the drill then scored is the worst of both.
     `t` is passed in rather than read off the event, so the caller that has
     already normalised a timestamp does not normalise it twice — and so a
     caller with no usable clock can hand over NaN and get `false`. */
  function isPalmAt(ev, t) {
    if (!ev || ev.pointerType !== 'touch') return false;
    var since = t - lastPenAt;
    /* Bounded BELOW as well as above. A difference computed across two time
       origins can come out negative, and NaN fails both comparisons — which
       is the answer we want, because this predicate REFUSES A PLAYER'S
       PRESS. A false palm silently eats a tap that was really made, and
       that is the one failure worse than letting a palm through. Never true
       before the pen has spoken at all: lastPenAt starts a billion ms back,
       so a finger-only player is never once tested against a pen. */
    return since >= 0 && since < PEN_LOCKOUT_MS;
  }

  /* A release can go missing — a swallowed pointercancel, a tab hidden
     mid-press — and would otherwise pin this counter above zero for the
     rest of the session, freezing the queued switch forever. No real
     gesture sits idle for two seconds, so a gap that long means whatever
     was down is long gone. */
  var GESTURE_IDLE_MS = 2000;
  var lastPointerAt = -1e9;

  /* Capture phase so a drill's own handler cannot stop us seeing it, and
     PASSIVE because none of these handlers ever calls preventDefault. A
     non-passive window-level pointer listener puts every gesture anywhere
     on the page — including a plain scroll past the drill — through a
     blocking hit-test before the compositor may move a pixel, and this
     file is loaded on every drill in the arcade. `passive` is per-listener,
     so a drill's own non-passive canvas handler still cancels what it likes.
     An engine too old to read the options object sees a truthy value and
     reads it as `capture: true`, which is what it used to be told. */
  var SNIFF = { capture: true, passive: true };

  window.addEventListener('pointerdown', function (ev) {
    var t = ev.timeStamp || 0;
    /* NOTHING IS FLUSHED HERE. A press-start flush used to stand above this
       line, on the reasoning that a counter of zero means the previous
       gesture's releases all landed, so a queued switch belongs to a gesture
       that is already over and is safe to apply. The premise is true and the
       conclusion is still wrong, because this listener is on `window` in the
       CAPTURE phase: it runs BEFORE the drill's own handler for this very
       press. Applying there moves the drill's geometry in the gap between the
       last frame the player could see and the moment that same press is
       scored — a tap drill's target slides (the template pads its target by
       the ring radius, so a mouse→pen switch walks it up to 15px across a
       900px sheet, 17 points of score), and the ease() the stroke is judged
       by is not the one it was drawn under. That is the mid-press swing this
       whole queue exists to prevent, arriving through the front door.
       And it could only ever fire in exactly that case. pendingMode is set
       only from this listener, while pointersDown >= 1; the only route back
       to zero with a switch still queued is releasePointer, which schedules
       the flush itself on the next task. So "pointersDown is 0 and something
       is still pending" IS the window between a release and its own flush —
       a window a press can slip into whenever an input task outruns a 0ms
       timer, which is the ordering a real scheduler prefers. Outside that
       window the call was a no-op. No-op when it was safe, geometry-moving
       when it fired: the honest version of it is nothing at all.
       A switch queued by a gesture whose release never arrived is not
       stranded by this. The idle repair below hands the counter back to zero
       on the next press, so THAT press's release flushes — one gesture later
       than the old line promised, and never inside one. */
    if (t - lastPointerAt > GESTURE_IDLE_MS) pointersDown = 0;
    lastPointerAt = t;
    pointersDown += 1;      /* counted before the palm guard can return */
    notePen(ev);
    if (isPalmAt(ev, t)) return;
    setMode(ev.pointerType === 'pen' ? 'pen' : ev.pointerType === 'touch' ? 'touch' : 'mouse');
  }, SNIFF);

  window.addEventListener('pointermove', function (ev) {
    notePen(ev);
    /* Only a move WITH contact keeps the gesture alive. Bare hover must
       not: a mouse drifting over the page would otherwise hold a leaked
       counter fresh forever and the idle reset would never fire. */
    if (ev.buttons) lastPointerAt = ev.timeStamp || 0;
  }, SNIFF);

  function releasePointer(ev) {
    lastPointerAt = (ev && ev.timeStamp) || lastPointerAt;
    pointersDown = Math.max(0, pointersDown - 1);
    /* Deferred one task so the drill's own release handler — which scores
       the stroke through ease() — has already run under the old profile. */
    if (!pointersDown && pendingMode) setTimeout(function () { flushMode(); }, 0);
  }
  window.addEventListener('pointerup', releasePointer, SNIFF);
  window.addEventListener('pointercancel', releasePointer, SNIFF);

  (function bootMode() {
    var saved = null;
    try { saved = localStorage.getItem('artdaily-input'); } catch (e) {}
    if (saved === 'pen' || saved === 'mouse' || saved === 'touch') { mode = saved; return; }
    /* Before the first stroke, guess from the device rather than assume
       a pen: a coarse pointer without hover is a finger. */
    try {
      if (window.matchMedia && matchMedia('(any-pointer: coarse)').matches &&
          !matchMedia('(any-hover: hover)').matches) mode = 'touch';
    } catch (e) {}
  })();

  /* ============================================================
     STANDALONE HAND-OFF

     The record lives under the page's own localStorage key, and the
     page is the only thing that writes it. A drill opened in its own
     tab is a folder on that same site now, so it shares the origin and
     could reach in — but a drill writing the page's store directly is
     exactly the coupling this protocol exists to avoid, so a score
     earned out there is still handed over rather than written.
     (Before the drills moved into this repo they ran on their own host
     and could not have reached it at all. A hidden cross-origin iframe
     used to bridge that; browsers partitioned the storage and it
     silently stopped working, which is why the two routes below —
     not a third — are what a standalone round gets.)

     Two honest routes instead:
       1. If this tab was opened FROM the page, its window.opener is the
          page — post the result straight to it and it lands live. It
          replies {type:'artdaily:logged'}: posting is NOT delivering,
          because a postMessage whose targetOrigin no longer matches
          (the opener tab navigated away from HOME) is dropped silently,
          with no throw to catch. Claiming "sent ✓" off a bare
          window.opener check loses the score for good.
       2. Until that receipt arrives — and forever, if there is no opener
          at all — offer a link carrying the score back. One tap, and the
          page records it. Injected here so all drills get it without
          each one needing its own button.
     ============================================================ */

  var HOME = 'https://artdaily.sadeali.com';

  function logUrl(score) {
    return HOME + '/#log=' + encodeURIComponent(slug) + ',' + score;
  }

  /* The best of THIS sitting. The bar is rewritten by every round, so
     handing over the round just played meant a player who did 41, 92,
     then a tired 38 could only ever log the 38. (Not the all-time best
     from readBest(): that may have been earned on another day, and the
     page would file it under today.) */
  var sessionBest = null;
  var lastRound = 0;
  var ackHooked = false;
  /* The bar speaks ONCE per sitting; see the note in showHandOff(). */
  var announced = false;

  function handOffStandalone(round) {
    lastRound = round;
    if (sessionBest === null || round > sessionBest) sessionBest = round;
    /* Hook the receipt first and paint the link second, so neither can
       be clobbered by an acknowledgement that arrives in between. */
    if (!ackHooked) {
      ackHooked = true;
      window.addEventListener('message', function (ev) {
        if (ev.origin !== HOME) return;
        var d = ev.data;
        if (!d || d.type !== 'artdaily:logged' || d.slug !== slug) return;
        showHandOff(lastRound, sessionBest, true);
      });
    }
    showHandOff(round, sessionBest, false);
    /* The post carries THIS round, not the session best: over an opener
       every round is posted as it happens and the page keeps the best of
       the day already. Only the link needs the best, because it is one
       click that has to stand for the whole sitting. */
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'artdaily:result', slug: slug, version: VERSION, score: round }, HOME);
      }
    } catch (e) {}
  }

  /* The daily note: one quiet line under the hand-off bar, once per
     sitting, saying out loud the thing the seeded-content section built
     and nothing player-facing ever mentioned — round 1 of a sitting is
     today's shared round, and tomorrow deals a fresh one. That fact is the
     site's honest reason to come back, and a search visitor landing on a
     drill page had no way to learn it.

     Four deliberate limits:
     - Only when dailyDealt is true, so the three unseeded drills never
       carry a claim that is false for them (the truth rule).
     - Present tense about the MECHANIC ("round 1 is today's round"), not
       about the round just played — a player who pressed "new round"
       before finishing round 1 reports off a practice round, and "that
       was today's round" would be a lie there.
     - The "same for everyone" half is EARNED, not assumed. It shipped
       without that clause, because under the old local-midnight seed two
       players either side of Greenwich on the same calendar date held
       seeds one apart and the sentence was false across an ocean. The
       seed is a pure function of the date label now (see seedForKey),
       so everyone whose calendar says today holds today's round — and
       "a fresh one lands at midnight" stays true everywhere, because the
       day key still flips at the local one.
     - A plain <p>, never a live region. The drill's #hint is the one
       spoken channel (GAME_GUIDE's rule), and this line is ambient chrome
       a browse-mode reader still reaches.

     Styled from here, not from the 44 vendored per-drill stylesheets —
     they have drifted into more than a dozen variants and only tokens can
     be assumed. Colours are tokens, so both themes come for free. */
  var dailyNoteDone = false;

  function showDailyNote(bar) {
    if (dailyNoteDone || !dailyDealt || !bar || !bar.parentNode) return;
    dailyNoteDone = true;
    if (!document.getElementById('artdailyDailyNoteCss')) {
      var css = document.createElement('style');
      css.id = 'artdailyDailyNoteCss';
      css.textContent = '.daily-note{margin:8px 0 0;font-size:0.78rem;color:var(--muted);}';
      (document.head || document.documentElement).appendChild(css);
    }
    var note = document.createElement('p');
    note.className = 'daily-note';
    note.textContent = 'round 1 is today’s round — the same one for everyone playing today. a fresh one lands at midnight.';
    bar.parentNode.insertBefore(note, bar.nextSibling);
  }

  /* A decorative glyph, hidden from assistive tech. "→" and "✓" are read
     out as "rightwards arrow" and "check mark", so the one sentence a
     standalone screen-reader player hears after a round used to end in a
     noise word — and the link's accessible name, which is what a
     links-list announces out of context, ended "record rightwards arrow". */
  function glyph(ch) {
    var s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = ch;
    return s;
  }

  function showHandOff(round, best, delivered) {
    var bar = document.getElementById('artdailyHandoff');
    if (!bar) {
      /* Find the host BEFORE building the bar: a drill with neither hook
         used to leave a fresh orphan <p> behind on every single round. */
      var host = document.querySelector('.game-controls') || document.querySelector('.game-body');
      if (!host || !host.parentNode) return;
      bar = document.createElement('p');
      bar.id = 'artdailyHandoff';
      bar.className = 'handoff';
      /* Live for its FIRST paint only — see the note below. Painted silently
         from the very start, a standalone screen-reader player would never
         learn that the route back to their record exists at all. */
      bar.setAttribute('role', 'status');
      host.parentNode.insertBefore(bar, host.nextSibling);
    }
    /* …and quiet from the second paint on. A drill has exactly ONE spoken
       channel, its #hint line, which carries the round's reveal — and this
       bar is written in the SAME TICK as that line, from inside report().
       Two polite regions written in one tick do not merge, they queue: the
       player heard "Round done — 84 out of 100 (best 91). Most taps landed
       low and right — aim high and left next round." and then, behind it,
       "scored 84 — add it to my Art Daily record", every round, in every
       drill in the arcade. The score is not news here; the drill just said
       it in a fuller sentence. What IS news is that a route home exists,
       and that is news exactly once. After the first paint the bar keeps
       updating on screen and stays reachable by tab and in browse mode —
       it simply stops interrupting to say the same number twice.
       (The rule it was breaking is GAME_GUIDE.md's "one spoken channel",
       which the toast in the template was already fixed to obey.) */
    if (announced) bar.removeAttribute('role');
    announced = true;
    /* After the bar, so the first thing under the controls is still the
       route home; sits outside the bar so the sweep of the bar's leading
       children can never eat it. Once per sitting, and only on a drill
       that really dealt from the day. */
    showDailyNote(bar);
    if (delivered) {
      /* The rule the paint below already obeys, finally applied to the ONE
         branch that still broke it: removing the focused element drops focus
         to <body>. This paint destroys the link on purpose — the receipt says
         the score is home, so there is nothing left to click — but it is
         fired by the OPENER'S REPLY, an event the player did not cause and
         cannot see coming, and focus really can be sitting on that link when
         it lands: a drill that cancels its canvas pointerdown (the template
         does, and so does anything built from it) never blurs a control a
         keyboard player tabbed onto, so they can play a whole round still
         standing on that link.
         They were dropped to the top of the document, mid-round, by a
         message from another tab.
         The link cannot be kept, so focus is HANDED somewhere sensible
         instead of dropped: the bar itself, which is the element whose text
         just changed, so what a screen reader announces on landing is "sent
         to your Art Daily record" — the answer to "where did my link go".
         tabIndex -1 makes it focusable without adding a tab stop, and the
         next Tab carries on from here rather than from the page top. Moved
         only when focus was already inside the bar; taking it from anywhere
         else would be its own bug. Guarded because this runs inside
         report(), where a throw would cost the round its score. */
      var refocus = false;
      try { refocus = bar.contains(document.activeElement); } catch (e) {}
      bar.textContent = '';
      bar.appendChild(document.createTextNode('sent to your Art Daily record '));
      bar.appendChild(glyph('✓'));
      if (refocus) {
        try { bar.tabIndex = -1; bar.focus(); } catch (e) {}
      }
      return;
    }
    /* The LINK NODE IS REUSED across rounds. Rebuilding the whole bar every
       round destroyed and recreated the only control on it, and removing a
       focused element drops focus to <body> — a keyboard player who had
       tabbed to "add it to my record" lost their place the moment the next
       round ended. role="status" implies aria-atomic, so the region is
       re-announced in full either way: nothing is lost by keeping the node. */
    var a = bar.querySelector('a.handoff-link');
    /* querySelector reaches any descendant, and the sweep below only skips
       DIRECT children — so a link that something else has nested would be
       swept away and then insertBefore'd against, which throws inside
       report(). Anything but our own direct child is rebuilt from scratch. */
    if (a && a.parentNode !== bar) a = null;
    if (!a) {
      bar.textContent = '';
      a = document.createElement('a');
      a.className = 'handoff-link';
      a.appendChild(document.createTextNode('add it to my Art Daily record '));
      a.appendChild(glyph('→'));
      bar.appendChild(a);
    }
    a.href = logUrl(best);
    /* Replace only what sits in front of the link. */
    while (bar.firstChild && bar.firstChild !== a) bar.removeChild(bar.firstChild);
    /* The separator goes through glyph() like every other one in this file.
       '·' is read out as "middle dot", and it sat bare in the middle of the
       one sentence a standalone screen-reader player gets after a round —
       the same defect the link's own '→' was already fixed for, two lines
       away from the helper written to fix it. Splitting the sentence into
       three nodes is safe: the sweep above drops EVERY leading child, so the
       count of nodes in front of the link is never assumed to be one. */
    if (best > round) {
      bar.insertBefore(document.createTextNode('scored ' + round + ' '), a);
      bar.insertBefore(glyph('·'), a);
      bar.insertBefore(document.createTextNode(' best this session ' + best + ' — '), a);
    } else {
      bar.insertBefore(document.createTextNode('scored ' + round + ' — '), a);
    }
  }

  function bestKey() { return 'artdaily-best-' + slug; }

  /* The sitting's best, mirrored in memory, because localStorage is not
     always there to be used. Safari's private mode throws on setItem — that
     one is unchanged. The other used to be the common case: a browser told to
     block third-party storage throws on getItem too, and the player dialog's
     iframe was cross-origin, so the arcade's MAIN path hit it. That iframe is
     first-party now and the mirror is no longer load-bearing there — but it
     stays, because a drill embedded on anyone else's site lands right back in
     it, and because private mode never went away.
     With no mirror, readBest() answers null after every round, so report()
     calls EVERY round the first one ever played: isFirst true forever,
     isNewBest true forever, and `best` merely the round just finished. The
     drill then prints "Round done — 20 out of 100. That is your bar now —
     press new round and beat it." directly after an 84, with 20 standing in
     the HUD's "best" column. Both are simply false.
     A memory best is not a record — it dies with the tab, and the page keeps
     the real progress in its own store either way — but it stops the drill
     lying for the length of a sitting. Storage still wins whenever it
     answers, so nothing moves for a player who has one. */
  var memBest = null;

  /* Clamped on the way OUT as well as in: a best outside 0–100 can only
     come from a corrupted or hand-edited store, and it is not harmless —
     a stored "200" is a best no round can ever beat, so isNewBest never
     fires again and the HUD prints "200" next to a 0–100 score. Clamping
     is the identity on every value report() has ever written. */
  function readBest() {
    var v = NaN;
    try { v = parseInt(localStorage.getItem(bestKey()), 10); } catch (e) {}
    if (isNaN(v)) return memBest;   /* nothing stored, or no store to read */
    return Math.max(0, Math.min(100, v));
  }

  /* ============================================================
     SEEDED CONTENT (protocol v1, additive)

     THE PROBLEM. 39 of the 42 drills call Math.random() for their own
     items, so two people playing the same drill on the same day are not
     playing the same drill. A score off that is a number with no
     denominator: nothing to share, nothing to rank, nothing to argue
     with. This section gives a drill a generator whose output is a pure
     function of (today, this drill), so "84 on Steady Lines today" means
     one thing everywhere.

     NOTHING ON THE WIRE MOVES, so VERSION stays 1. The four message
     shapes are unchanged — ready, result, theme, logged — and this adds
     no fifth. That is not merely tidy: js/app.js drops any inbound
     message whose `version !== 1`, so bumping the number here would stop
     every standalone score being recorded, sitewide, for nothing.

     TWO GENERATORS, NAMED FOR WHAT THEY ARE FOR:

       ArtDaily.dailyRandom(stream)     today's ROUND — same for everyone
       ArtDaily.practiceRandom()        a REPLAY — fresh every time

     They are two names rather than one function with a flag because a
     flag is a thing you get wrong once and never notice. A player who
     presses "new round" five times must not be handed the same five
     items five times; a player comparing a score with a friend must be
     handed exactly the same ones. Both are true at once, and which one a
     line of code wants is visible in the line of code.

     ArtDaily.roundRandom(round, stream) spells the usual rule once so 39
     drills do not each re-decide it: round 1 is the day's round, round 2
     and on are practice.

     Each returns a callable rng() in [0, 1) — a drop-in for
     Math.random() — carrying the four helpers the drills hand-rolled 26
     different times (range, int, pick, chance, shuffle), each written to
     consume draws in exactly the order the hand-rolled version did, so a
     conversion cannot silently reshuffle a round.
     ============================================================ */

  /* --- the day, derived exactly as js/app.js derives it -------------
     MIRRORED, NOT SHARED: a drill loads this file, and never loads
     js/app.js, so there is no import to make. DAY_RE, dateKey() and
     seedForKey() below are line-for-line the ones in js/app.js (the
     store-key regex, the local day key, and the seed). THEY MAY NOT
     DRIFT APART — tools/pick-suite.js phase E compares the two
     seedForKey bodies byte for byte and fails if they differ. The page
     uses that integer to decide which three drills a day asks for; the
     drill uses it to decide what is inside one.

     THE DAY KEY IS LOCAL; THE SEED IS LABEL-PURE (since 2026-08-23).
     dateKey() still names the day by the player's own calendar — the
     ritual flips at local midnight, which is the right midnight for a
     daily habit. But seedForKey() is now Date.UTC of the parsed Y/M/D:
     a pure function of the date LABEL, so everyone whose calendar says
     the same date holds the same seed, in every timezone. The old form
     (epoch-day of local midnight) split east/west of Greenwich and
     collapsed two spring days onto one seed in every zone whose UTC
     offset crosses zero at DST. Past days are safe because the page pins
     every played day's triple in its store (js/app.js, store.picks) —
     nothing replays this function for history. A leaderboard keyed on
     daySeed() still needs a ~48h window: one seed is live for as long as
     its date is someone's today somewhere on earth. */
  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function seedForKey(k) {
    var p = DAY_RE.exec(String(k));
    if (!p) return null;
    return Date.UTC(+p[1], +p[2] - 1, +p[3]) / 86400000;
  }

  /* Mixes a string into a 32-bit seed — js/app.js ~469, unchanged, so a
     future leaderboard can recompute a player's round from the two
     published functions alone. Used twice: day × slug, then × stream. */
  function mixString(seed, str) {
    var h = seed ^ 0x9e3779b9;
    str = String(str);
    for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
    return h >>> 0;
  }

  /* mulberry32. Chosen over sfc32 and xorshift128+ for one reason that
     matters more here than raw quality: it holds ONE 32-bit word of
     state, which is exactly the shape mixString() already hands over, so
     there is no seed-expansion step to get subtly wrong or to have to
     re-specify server-side later. Its period is 2^32 and it clears
     PractRand well past any load a drill puts on it — a round draws
     tens of values, not billions — and its output avalanches hard enough
     that consecutive seeds (which is literally what consecutive days
     are) give unrelated streams. sfc32 is the better generator in the
     abstract; it needs four seed words and buys nothing a drawing drill
     can measure.

     DETERMINISTIC ACROSS EVERY ENGINE, which is the whole point. Every
     step is exact 32-bit integer arithmetic: Math.imul is specified as a
     true 32-bit multiply, |0 is ToInt32, >>> is exact, and there is no
     accumulation that could round differently anywhere. The single
     floating-point operation is the last one, and it is exact too: both
     a uint32 and 2^32 are representable in a double, and the quotient is
     a dyadic rational needing at most 32 mantissa bits. No Date, no
     performance.now, no locale, no canvas — nothing a device gets to
     have an opinion about. */
  function makeRng(a, seeded) {
    a = a | 0;

    var rng = function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    /* True for the day's round, false for a replay. Read it to label a
       score — only a `seeded` round is comparable with anyone else's. */
    rng.seeded = !!seeded;

    /* rng.range(lo, hi) IS the `rand(lo, hi)` helper 26 drills already
       carry, to the character: lo + u * (hi - lo). Keeping the affine
       map identical is what makes a conversion provably distribution-
       preserving — u is uniform on [0,1) either way, so every value
       downstream of it keeps exactly the shape it had. */
    rng.range = function (lo, hi) {
      var a0 = finite(lo, 0), b0 = finite(hi, 0);
      return a0 + rng() * (b0 - a0);
    };

    /* Inclusive at BOTH ends — the shape of randInt() in colors and
       rotate-place. Clamped, so a reversed or junk range still returns
       something inside it rather than a NaN index. */
    rng.int = function (lo, hi) {
      var a0 = Math.floor(finite(lo, 0)), b0 = Math.floor(finite(hi, 0));
      if (b0 < a0) { var t = a0; a0 = b0; b0 = t; }
      var v = a0 + Math.floor(rng() * (b0 - a0 + 1));
      return v > b0 ? b0 : v;
    };

    /* list[floor(u * len)], with the same % guard counterweight,
       cross-contour and sun-and-sky wrote by hand. undefined for an
       empty or missing list, which is what those already returned. */
    rng.pick = function (list) {
      if (!list || !list.length) return undefined;
      return list[Math.floor(rng() * list.length) % list.length];
    };

    /* rng.chance(0.5) is `Math.random() < 0.5`, which is the single most
       common draw in the catalogue. p <= 0 never fires, p >= 1 always
       does, junk never does. */
    rng.chance = function (p) { return rng() < finite(p, 0); };

    /* Fisher-Yates, walking DOWN, one draw per step — the exact loop in
       values, temperature-sort, neutral-hunt, horizon-read, crop-it and
       sun-and-sky, so the draw count and order are unchanged by the
       swap. Shuffles IN PLACE and returns the same array: pass
       arr.slice() where the hand-rolled version copied first. */
    rng.shuffle = function (list) {
      if (!list || !list.length) return list;
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    };

    return rng;
  }

  /* Which drill's content this is. init() sets `slug`; the fallback
     covers a drill that asks before init() has run and a file:// open
     with no page around it, where the folder name is still the truth
     (…/lines/ and …/lines/index.html both answer 'lines'). */
  function contentSlug() {
    if (slug) return slug;
    try {
      var parts = String(location.pathname).split('/').filter(Boolean);
      var last = parts[parts.length - 1] || '';
      if (/\.html?$/i.test(last)) last = parts[parts.length - 2] || '';
      return last;
    } catch (e) { return ''; }
  }

  function todaySeed() {
    var s = seedForKey(dateKey(new Date()));
    /* A clock so broken that dateKey() cannot be parsed back still has to
       yield a playable round rather than a NaN one. */
    return (s === null || !isFinite(s)) ? 0 : s;
  }

  /* Has this sitting been dealt the day's shared round? True the moment a
     drill asks dailyRandom for content (nearly all do it at boot, for round
     1), and read by the hand-off bar to decide whether the daily note below
     may be shown at all — a drill that never deals from the day (warm-up,
     hatch-ramp, box-check) must never be described as daily. */
  var dailyDealt = false;

  function dailyRandom(stream) {
    dailyDealt = true;
    var h = mixString(todaySeed() | 0, contentSlug());
    if (stream !== undefined && stream !== null) h = mixString(h | 0, stream);
    return makeRng(h, true);
  }

  /* A replay must not be the same round again — but it must also not be a
     DIFFERENT KIND of round, or "I only got 60 on my second go" stops
     meaning anything. So practice runs the same generator off a throwaway
     seed rather than sitting on Math.random() directly: identical
     distribution, identical helpers, identical everything except that
     nobody can predict it. The counter is there so two generators asked
     for in the same tick are still independent. */
  var practiceNonce = 0;
  function practiceRandom() {
    practiceNonce = (practiceNonce + 1) | 0;
    var s = Math.imul((Math.random() * 4294967296) | 0, 2654435761);
    return makeRng((s ^ Math.imul(practiceNonce, 0x9e3779b9)) | 0, false);
  }

  return {
    version: VERSION,
    isEmbedded: embedded,

    init: function (opts) {
      slug = (opts && opts.slug) || '';

      /* The page passes ?theme= on the iframe src so the game paints in
         the right theme on the very first frame; standalone visits fall
         back to the site-wide localStorage key, then paper (light) —
         Art Daily is a sketchbook, paper is the default. */
      var boot = params.get('theme');
      if (boot !== 'light' && boot !== 'dark') {
        try { boot = localStorage.getItem('sadeali-theme'); } catch (e) { boot = null; }
      }
      applyTheme(boot === 'dark' ? 'dark' : 'light');

      if (params.get('embed') === '1') {
        /* game.css hides the standalone chrome (topbar/footer) off this. */
        document.documentElement.classList.add('embed');
      }

      paintModeChip();

      if (embedded) {
        window.addEventListener('message', function (ev) {
          if (ev.source !== window.parent) return;
          var d = ev.data;
          if (!d || d.type !== 'artdaily:theme') return;
          applyTheme(d.theme);
        });
        post({ type: 'artdaily:ready', slug: slug, version: VERSION });
      }
    },

    /* Call once per *finished* drill with a 0–100 score. The page turns
       these into streaks and skill meters; standalone play keeps a
       personal best on the game's own origin.

       Returns { score, best, isNewBest, isFirst } so the game can
       celebrate honestly. `isFirst` marks the very first round this drill
       has ever recorded on this device: there is no previous best, so
       `isNewBest` is trivially true and "new best!" becomes the first
       thing a beginner is ever told — a celebration of nothing, fired on
       the one round where they most need to be told what the number
       MEANS. Drills branch on isFirst to say that instead. */
    report: function (score) {
      /* Non-finite means the drill's scoring broke, not that the player was
         perfect. Infinity used to clamp UP to 100 — a single divide-by-zero
         in a round (a zero-length reference stroke, a degenerate fit) handed
         out a fake perfect score, wrote it to the permanent personal best,
         and posted it to the page as a real result. Broken scores 0. */
      var s = Math.max(0, Math.min(100, Math.round(finite(score, 0))));
      var prev = readBest();
      var isFirst = prev === null;
      var isNewBest = isFirst || s > prev;
      if (isNewBest) {
        memBest = s;    /* set FIRST: the store is allowed to fail */
        try { localStorage.setItem(bestKey(), String(s)); } catch (e) {}
      }
      post({ type: 'artdaily:result', slug: slug, version: VERSION, score: s });
      if (!embedded) handOffStandalone(s);
      return { score: s, best: isNewBest ? s : prev, isNewBest: isNewBest, isFirst: isFirst };
    },

    best: readBest,

    theme: currentTheme,

    onTheme: function (fn) { if (typeof fn === 'function') themeListeners.push(fn); },

    /* ---- input profile (see the block above) ---- */

    /* 'pen' | 'mouse' | 'touch' — null only before the very first
       pointer event on a device we could not guess. */
    inputMode: function () { return mode; },

    /* Human label for the HUD: "scoring for: mouse or trackpad". */
    inputLabel: function () { return profile().label; },

    /* Multiply the error at which YOUR score reaches zero:
         var zero = ArtDaily.ease(0.055);
       Pen keeps the strict standard; mouse and finger get room.
       Always returns a finite number > 0, so it is safe as a divisor. */
    ease: function (base) {
      var b = finite(base, 1);
      if (b <= 0) b = 1;
      /* The PRODUCT is checked, not just the input. A base that is large
         but perfectly finite still overflows once the profile factor lands
         (mouse doubles it), and an infinite zero-point is the worst possible
         failure: 1 - err/Infinity is exactly 1, so every attempt, however
         wild, scores a fake 100 — the same fake perfect report() exists to
         stop, arriving through the front door instead. Falling back to the
         unmultiplied base keeps the promise the line above makes. */
      return finite(b * profile().ease, b);
    },

    /* Enlarge a start/hit zone the same way:
         var r = ArtDaily.startRadius(28);   // 48 on a pen tablet
       Always returns a finite, HITTABLE radius. A base BELOW ONE PIXEL is
       treated as missing rather than as "a zone a fraction of a pixel
       across": a drill that sizes its zone off the canvas —
       startRadius(Math.min(W, H) * 0.05) — is called once at boot, before
       layout, and a 1px target is every bit as dead a round as a NaN one.
       Guarding only the exact 0 was not enough, because a canvas floors its
       own measured width at 1px (Math.max(1, rect.width) is the standard
       shape), so the base arrives as 0.05, not as a clean 0, and slipped
       through. Only the sign is folded away for a negative base. */
    startRadius: function (base) {
      var b = Math.abs(finite(base, 28));
      if (!(b >= 1)) b = 28;
      /* Checked after the multiply for the same reason ease() is. */
      return Math.max(1, finite(Math.round(b * profile().start), b));
    },

    /* Every position a pointermove actually carried, oldest first:

         var r = canvas.getBoundingClientRect();     // ONCE — see below
         ArtDaily.samples(ev).forEach(function (e) {
           pts.push({ x: e.clientX - r.left, y: e.clientY - r.top });
         });

       MEASURE THE CANVAS ONCE PER EVENT, not once per sample. The usual
       pos(ev) helper calls getBoundingClientRect() itself, so dropping it
       straight into this loop re-measures the element on every sample —
       and a fast pen hands over dozens per frame, all of them describing a
       canvas that cannot have moved between them. Worse, the loop runs in
       the same handler that repaints, so the first of those reads has to
       flush the layout the previous frame dirtied. Hoist the rect and the
       whole run costs one measurement. (If all you want is where the hand
       is NOW — a drag handle, a cursor — you do not need this at all: the
       dispatched event already carries the newest sample, it IS the last
       entry of the run. samples() is for the SHAPE of the stroke between
       two frames, which is the part the dispatched event throws away.)

       A browser delivers pointermove at most once per frame, but the
       digitizer samples far faster than that — 120–1000Hz on a pen tablet
       — and hands the frame's whole run of positions over on the ONE event
       it dispatches. Reading only that event throws the rest away, so a
       fast stroke is sampled at 60Hz whatever the hardware cost: the corner
       of a quick flick vanishes, and a drill that scores the geometry then
       scores a straight line the player did not draw. Judging the hand by
       the samples the browser felt like delivering is not honest scoring.

       Always an array, never a throw, never empty for a real event, and
       [ev] wherever coalescing is unavailable — so the caller needs no
       branch of its own. (Half the drills that need this hand-rolled it
       three different ways; this is that pattern, once.) */
    samples: function (ev) {
      if (!ev) return [];
      try {
        if (typeof ev.getCoalescedEvents === 'function') {
          var list = ev.getCoalescedEvents();
          if (list && list.length) return list;
        }
      } catch (e) {}
      return [ev];
    },

    /* Is this press the PALM of a hand that is holding a pen?

         canvas.addEventListener('pointerdown', function (ev) {
           if (ArtDaily.isPalm(ev)) return;   // ignored, never counted
           …
         });

       An artist rests the heel of the hand on the glass and the nib lands a
       moment later, so first-contact-wins hands the round to the palm: a
       stroke drill records palm drift as the player's line, and a tap drill
       burns an item on a contact somewhere near the wrist. Either way the
       hand that was actually drawing is the one the drill ignored, and the
       score that comes out is not a score of anything.

       True only for a `touch` press inside PEN_LOCKOUT_MS of the last thing
       the pen did — CONTACT OR BARE HOVER, and the hover is the half a
       drill cannot see for itself. This file listens on `window` in the
       CAPTURE phase, so a nib hovering anywhere on the page (or over the
       chrome beside the canvas) has already been noted by the time the
       drill's own handler runs; a guard fed only by the drill's own canvas
       events goes blind the moment the nib lifts off the sheet, which is
       exactly when the palm is still down. Thirty-three drills hand-rolled
       this against their own events, two spellings of the constant and two
       different clocks — this is that guard, once, off the same timestamp
       the profile lockout above already trusts.

       Total: no event, a pointerType that is not 'touch', a missing or
       unusable timeStamp, or a session where no pen has ever spoken all
       answer false. Refusing a press you cannot classify would eat a tap a
       finger-only player really made. */
    isPalm: function (ev) {
      return isPalmAt(ev, (ev && typeof ev.timeStamp === 'number') ? ev.timeStamp : NaN);
    },

    /* Fires when the hardware changes mid-session (a laptop user plugs
       in a tablet, an iPad user picks up the pencil). */
    onInput: function (fn) { if (typeof fn === 'function') modeListeners.push(fn); },

    /* ---- seeded content (see the block above) ---- */

    /* TODAY'S ROUND. Same day + same drill ⇒ the same sequence, on every
       device, in every browser, for every player in this timezone:

         var rng = ArtDaily.dailyRandom();
         var angle = rng.range(-12, 12);
         if (rng.chance(0.5)) flip();

       `stream` (optional, any string or number) forks an INDEPENDENT
       sequence off the same day. Use it, and this is the trap worth
       reading twice: a drill that regenerates an item — on resize, on a
       theme change, when the hardware profile moves — walks a single
       rolling generator further along and hands the player a different
       item than the one that was on screen a frame ago. Ask for
       dailyRandom(itemIndex) at the moment you build item N and the
       answer is the same every time you ask, however often you ask.

       What is identical between two players is the SEQUENCE OF
       NORMALISED DRAWS, not the pixels. A drill lays those draws out
       against its own canvas, and a phone's canvas is not a desktop's,
       so multiply by W and H as LATE as possible: keep the shared thing
       a fraction and let the sheet decide where the fraction lands. A
       value that goes through Math.random() * W is a value nobody else
       can reproduce. */
    dailyRandom: dailyRandom,

    /* A REPLAY. Unpredictable, and a fresh sequence on every call, so
       five goes in one afternoon are five different rounds. Same
       generator and same helpers as dailyRandom, so a practice round is
       drawn from exactly the same distribution as the scored one — it is
       not an easier or a harder version of the drill, only an unshared
       one. */
    practiceRandom: practiceRandom,

    /* The rule, written once instead of 39 times: the first round of a
       sitting is the day's shared round, everything after it is
       practice. Drills already count rounds from 1.

         function newRound() {
           round += 1;
           rng = ArtDaily.roundRandom(round);   // 1 → daily, 2+ → practice
           …
         }

       Check rng.seeded before you claim a score is comparable. */
    roundRandom: function (round, stream) {
      return finite(round, 1) <= 1 ? dailyRandom(stream) : practiceRandom();
    },

    /* 'YYYY-MM-DD' for the local day the seed above is keyed to, and the
       integer it becomes. Exposed for share cards and for whatever files
       a score later: two scores are only comparable if they carry the
       same daySeed, and near a midnight — or across a timezone — they
       will not. Do not re-derive either of these from a Date somewhere
       else; ask here, so there is one answer. */
    dayKey: function () { return dateKey(new Date()); },
    daySeed: todaySeed,
  };
})();
