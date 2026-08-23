/* Adversarial suite for the reveal-hold contract on the PRE-BANKING drills:
   the ones whose reveal timer used to file the round and were refactored so
   ArtDaily.report() is banked the moment the last item scores, with
   finishRound() presentation-only. The invariant under test, in every
   scenario: REPORT FIRES EXACTLY ONCE PER COMPLETED ROUND — never zero
   (a lost release, a hidden tab or an impatient "new round" must not
   swallow a played round) and never twice (the defensive fallback in
   finishRound must stay dead code).

   Boots the drill's REAL js/game.js in a vm with a stub DOM, a stub SDK
   that counts report() calls, and a VIRTUAL clock (setTimeout/Date.now),
   then plays rounds through the drill's own event handlers: button
   clicks, keydown, pointer press/release/cancel on the reveal.

   Covered today: light-direction (the riskiest refactor — its timer used
   to reach the filing path directly), game-template (the canonical
   hold-then-tap that every new drill copies) and superimposed (the
   pre-banking launch drill — its repeats are drawn as real pointer
   strokes along the guide the drill itself painted), lines (six
   pulled strokes, filed synchronously at the sixth) and negative-space
   (banked in onDone at the third space; hold-then-tap reveal). The
   harness is generic; a sibling joins by adding a runner beside these. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); }
  else { failures += 1; console.log('  FAIL ' + msg); }
}

/* ---- minimal element ---- */
function makeEl(tag) {
  const node = {
    nodeType: 1, tagName: String(tag || 'div').toUpperCase(), childNodes: [],
    attrs: {}, dataset: {}, hidden: false, className: '', id: '',
    disabled: false, style: {}, _listeners: {}, _text: '',
    get textContent() {
      return this._text + this.childNodes.map((n) => n.textContent).join('');
    },
    set textContent(v) { this.childNodes = []; this._text = String(v); },
    set innerHTML(v) { this.childNodes = []; this._text = String(v); },
    get innerHTML() { return this._text; },
    appendChild(c) { this.childNodes.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); },
    focus() {},
  };
  return node;
}

/* ---- 2d context: every method a no-op, every property writable, plus the
   few that must return something real (image data, text metrics). ---- */
function makeCtx(canvas) {
  const store = { canvas, _arcs: [] };
  return new Proxy({}, {
    get(t, prop) {
      if (prop in store) return store[prop];
      if (prop === 'createImageData' || prop === 'getImageData') {
        return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      }
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'arc') return (x, y, r) => { store._arcs.push({ x, y, r }); };
      return () => {};
    },
    set(t, prop, v) { store[prop] = v; return true; },
  });
}

function makeCanvas() {
  const c = makeEl('canvas');
  c.width = 720; c.height = 450;
  const ctx = makeCtx(c);
  c._ctx = ctx;
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 450 });
  c.setPointerCapture = () => {};
  c.releasePointerCapture = () => {};
  return c;
}

/* ---- one booted drill page with a virtual clock ---- */
function boot(slug, ids) {
  const els = {};
  ids.forEach((id) => { els[id] = id === 'gameCanvas' ? makeCanvas() : makeEl(id.slice(0, 3) === 'btn' ? 'button' : 'div'); });

  let now = 1000000;
  let timerSeq = 1;
  const timers = new Map();
  function tick(ms) {
    const until = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      now = Math.max(now, next.t.at);
      timers.delete(next.id);
      next.t.fn();
    }
    now = until;
  }

  const reports = [];
  const ArtDaily = {
    init() {},
    theme: () => 'light',
    onTheme() {},
    onInput() {},
    isPalm: () => false,
    samples: (ev) => [ev],
    best: () => null,
    ease: (px) => px,
    startRadius: (band) => Math.max(34, band || 34),
    roundRandom(round) {
      let s = (round * 2654435761) >>> 0;
      return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    },
    report(score) {
      reports.push(score);
      return { score: Math.round(score), best: null, isNewBest: false, isFirst: reports.length === 1 };
    },
  };

  const documentEl = makeEl('html');
  const doc = {
    documentElement: documentEl,
    hidden: false,
    getElementById: (id) => els[id] || null,
    createElement: (t) => (t === 'canvas' ? makeCanvas() : makeEl(t)),
    createTextNode: (v) => ({ nodeType: 3, textContent: String(v) }),
    activeElement: null,
    _listeners: {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
  };
  const sandbox = {
    document: doc,
    ArtDaily,
    console,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '#808080' }),
    setTimeout: (fn, ms) => { const id = timerSeq++; timers.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame(fn) { return this.setTimeout(() => fn(now), 16); },
    cancelAnimationFrame(id) { this.clearTimeout(id); },
    Date: { now: () => now },
    performance: { now: () => now },
    Math, JSON, Object, Array, String, Number, Boolean, isFinite, isNaN,
    parseInt, parseFloat, Uint8ClampedArray,
    addEventListener(t, fn) { (this._winListeners[t] = this._winListeners[t] || []).push(fn); },
    _winListeners: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, slug, 'js/game.js'), 'utf8'), sandbox, { filename: slug + '/js/game.js' });

  function fire(el, type, props) {
    const ev = Object.assign({ type, preventDefault() {}, pointerType: 'mouse', clientX: 10, clientY: 10 }, props);
    (el._listeners[type] || []).forEach((fn) => fn(ev));
    /* bubble to window for the belt-and-braces pointerup/cancel catchers */
    if (type === 'pointerup' || type === 'pointercancel') {
      (sandbox._winListeners[type] || []).forEach((fn) => fn(ev));
    }
  }

  /* flip document.hidden and speak visibilitychange, like a real tab switch */
  function setHidden(h) {
    doc.hidden = h;
    (doc._listeners.visibilitychange || []).forEach((fn) => fn({}));
  }

  return { els, tick, reports, fire, doc, sandbox, setHidden };
}

/* ============================================================
   light-direction
   ============================================================ */
function runLightDirection() {
  console.log('== light-direction: report exactly once per round, under every hold path ==');
  const IDS = ['gameCanvas', 'hint', 'toast', 'hudRound', 'hudScore', 'hudBest',
    'btnDone', 'btnRound', 'btnHow', 'howTo', 'inputMode'];
  const SKIP = 1101;   /* > SKIP_LOCK_MS (1100) */
  const REVEAL = 7000; /* REVEAL_MS */
  const p = boot('light-direction', IDS);
  const { els, tick, reports, fire, doc } = p;
  const canvas = els.gameCanvas;

  const phase = () => {
    /* observable phase: 'lock it in' = aim, 'next/finish' = reveal, 'finished' = done */
    const b = els.btnDone.textContent;
    if (b.indexOf('finished') === 0) return 'done';
    if (b.indexOf('next') === 0 || b.indexOf('finish') === 0) return 'reveal';
    return 'aim';
  };
  const lock = () => els.btnDone.click();
  const advanceBtn = () => { tick(SKIP); els.btnDone.click(); };

  /* -- round 1: button path; the bank precedes the last reveal's end -- */
  for (let i = 0; i < 5; i++) { lock(); advanceBtn(); }
  lock();
  ok(reports.length === 1, 'round 1 banked at the sixth lock, before its reveal ends (reports=' + reports.length + ')');
  ok(phase() === 'reveal', 'last reveal still on screen after the bank');
  advanceBtn();
  ok(reports.length === 1, 'closing the last reveal does not report again');
  ok(phase() === 'done' && els.btnDone.disabled === true, 'round closes to done, lock button dead');
  ok(els.hint.textContent.indexOf('/100') !== -1, 'hint speaks the round score');

  /* -- round 2: the auto-advance timer path -- */
  els.btnRound.click(); /* phase done -> immediate new round */
  for (let i = 0; i < 5; i++) { lock(); tick(REVEAL); }
  lock();
  ok(reports.length === 2, 'round 2 banked at the sixth lock on the timer path');
  tick(REVEAL);
  ok(reports.length === 2 && phase() === 'done', 'timer closing the last reveal does not report again');

  /* -- round 3: held press freezes the beat; cancel on a hidden tab parks it -- */
  els.btnRound.click();
  lock();
  fire(canvas, 'pointerdown', { pointerId: 6 });
  fire(canvas, 'pointerup', { pointerId: 6 });
  ok(phase() === 'reveal', 'a tap inside the skip-lock cannot eat the reveal — it re-arms the beat');
  tick(REVEAL);
  ok(phase() === 'aim', 'and the re-armed beat advances in full');
  lock(); tick(SKIP);
  fire(canvas, 'pointerdown', { pointerId: 7 });
  tick(60000);
  ok(phase() === 'reveal', 'a held press holds the reveal open for a full minute');
  fire(canvas, 'pointerup', { pointerId: 7 });
  ok(phase() === 'aim', 'the release advances to the next form');
  lock(); tick(SKIP);
  fire(canvas, 'pointerdown', { pointerId: 8 });
  doc.hidden = true;
  fire(canvas, 'pointercancel', { pointerId: 8 });
  tick(60000);
  ok(phase() === 'reveal', 'a cancelled hold on a hidden tab parks the reveal (no re-armed timer)');
  doc.hidden = false;
  fire(canvas, 'pointerdown', { pointerId: 9 });
  fire(canvas, 'pointerup', { pointerId: 9 });
  ok(phase() === 'aim', 'a tap after returning advances the parked reveal');
  for (let i = 0; i < 2; i++) { lock(); advanceBtn(); }
  lock();
  ok(reports.length === 3, 'round 3 reported exactly once through both hold paths');
  advanceBtn();
  ok(reports.length === 3, 'round 3 close is presentation-only');

  /* -- round 4: key auto-repeat is inert; impatient "new round" cannot double-file -- */
  els.btnRound.click();
  for (let i = 0; i < 5; i++) fire(canvas, 'keydown', { key: 'Enter', repeat: true });
  ok(phase() === 'aim' && reports.length === 3, 'held-Enter auto-repeat locks nothing');
  fire(canvas, 'keydown', { key: 'Enter', repeat: false });
  ok(phase() === 'reveal', 'a real Enter locks the form');
  fire(canvas, 'keydown', { key: 'Enter', repeat: false });
  ok(phase() === 'reveal', 'Enter inside the skip-lock window cannot eat the reveal');
  tick(SKIP);
  fire(canvas, 'keydown', { key: 'Enter', repeat: false });
  ok(phase() === 'aim', 'Enter after the window advances');
  for (let i = 0; i < 4; i++) { lock(); advanceBtn(); }
  lock();
  ok(reports.length === 4, 'round 4 banked at the sixth lock');
  els.btnRound.click(); /* mid-reveal: first press only asks */
  ok(els.btnRound.textContent.indexOf('discard') !== -1, '"new round" during the last reveal asks first');
  els.btnRound.click(); /* confirmed: flushes finishRound, then deals */
  ok(reports.length === 4, 'flushing a banked round through "new round" does not report again');
  ok(phase() === 'aim', 'and a fresh round is dealt');

  ok(reports.every((s) => isFinite(s) && s >= 0 && s <= 100), 'every reported score is a real 0-100');
}

/* ============================================================
   game-template — the canonical hold-then-tap every new drill copies
   ============================================================ */
function runTemplate() {
  console.log('== game-template: the hold-then-tap pattern itself ==');
  const IDS = ['gameCanvas', 'hint', 'toast', 'hudRound', 'hudScore', 'hudBest',
    'btnRound', 'btnHow', 'howTo', 'inputMode'];
  const p = boot('game-template', IDS);
  const { els, tick, reports, fire, setHidden } = p;
  const canvas = els.gameCanvas;
  const BEAT = 20000; /* > any revealBeat (the first reveal is MEASURED from its own words — 27 words = 8.1s here) */

  const tap = () => { fire(canvas, 'pointerdown', { pointerId: 1, button: 0, isPrimary: true, clientX: 300, clientY: 200 }); };
  const inReveal = () => els.hint.textContent.indexOf('Target ') !== 0;
  const roundDone = () => els.hint.textContent.indexOf('Round done') !== -1;

  /* -- round 1: taps + timer; the last tap files synchronously -- */
  tap();                            /* item 1 scored, reveal up */
  ok(inReveal(), 'a tap scores and raises the reveal');
  fire(canvas, 'pointerdown', { pointerId: 9, button: 2 });
  ok(inReveal() && reports.length === 0, 'a right-click is ignored, not counted');
  tick(BEAT);                       /* timer advances */
  ok(!inReveal(), 'the beat advances an unheld reveal');
  for (let i = 0; i < 3; i++) { tap(); tick(BEAT); }
  tap();                            /* fifth tap: finishRound runs synchronously */
  ok(reports.length === 1, 'the fifth tap files the round synchronously (reports=' + reports.length + ')');
  tick(120000);
  ok(reports.length === 1 && roundDone(), 'the round-end reveal stays up and never re-files');

  /* -- round 2: held reveal survives a tab switch; parked reveal comes back -- */
  els.btnRound.click();
  tap();                            /* reveal up, timer armed */
  tap();                            /* press during reveal: HOLDS (cancels timer) */
  tick(60000);
  ok(inReveal(), 'a press holds the reveal open indefinitely');
  setHidden(true);
  setHidden(false);
  tick(60000);
  ok(inReveal(), 'a tab switch does not re-arm a HELD reveal');
  tap();                            /* the next press advances */
  ok(!inReveal(), 'the next press advances the held reveal');
  tap();                            /* item 2 scored, timer armed */
  setHidden(true);                  /* hidden: timer parked */
  tick(60000);
  ok(inReveal(), 'a hidden tab parks the reveal instead of spending it');
  setHidden(false);                 /* visible again: beat handed back in full */
  ok(inReveal(), 'the beat restarts only on return');
  tick(BEAT);
  ok(!inReveal(), 'and then advances normally');
  tap(); tick(BEAT);
  tap(); tick(BEAT);
  tap();
  ok(reports.length === 2, 'round 2 filed exactly once through hold + park (reports=' + reports.length + ')');

  ok(reports.every((sc) => isFinite(sc) && sc >= 0 && sc <= 100), 'every reported score is a real 0-100');
}

/* ============================================================
   superimposed — pre-banking launch drill; strokes drawn for real
   ============================================================ */
function runSuperimposed() {
  console.log('== superimposed: four traced repeats a set, banked at the fourth set ==');
  const IDS = ['gameCanvas', 'hint', 'toast', 'hudRound', 'hudScore', 'hudBest',
    'btnFinish', 'btnUndo', 'btnRound', 'btnHow', 'howTo', 'inputMode'];
  const p = boot('superimposed', IDS);
  const { els, tick, reports, fire, doc } = p;
  const canvas = els.gameCanvas;
  const GUARD = 601;   /* > SKIP_GUARD_MS (600) */
  const REVEAL = 2400; /* REVEAL_MS */
  let pid = 100;

  /* The guide's endpoints, recovered from the drill's own drawing calls:
     drawGuide strokes the end ring at r=7 and drawStartDot fills the dot
     at r=6.5 — both constants unique on the sheet. Latest occurrence wins
     (the guide is redrawn on every draw()). */
  function guideEnds() {
    const arcs = canvas._ctx._arcs;
    let a = null, b = null;
    for (let i = arcs.length - 1; i >= 0 && (!a || !b); i--) {
      if (!b && arcs[i].r === 7) b = arcs[i];
      if (!a && arcs[i].r === 6.5) a = arcs[i];
    }
    return { a, b };
  }

  function traceRepeat() {
    const { a, b } = guideEnds();
    const id = pid++;
    fire(canvas, 'pointerdown', { pointerId: id, isPrimary: true, clientX: a.x, clientY: a.y });
    for (let i = 1; i <= 24; i++) {
      fire(canvas, 'pointermove', { pointerId: id, isPrimary: true,
        clientX: a.x + (b.x - a.x) * i / 24, clientY: a.y + (b.y - a.y) * i / 24 });
    }
    fire(canvas, 'pointerup', { pointerId: id, isPrimary: true, clientX: b.x, clientY: b.y });
  }
  const revealing = () => els.hint.textContent.indexOf('Tap for the next set') !== -1 ||
                         els.hint.textContent.indexOf('The band is your spread') !== -1;
  const roundDone = () => els.hint.textContent.indexOf('round done') !== -1;
  const playSet = () => { for (let i = 0; i < 4; i++) traceRepeat(); };

  /* -- round 1 -- */
  playSet();
  ok(revealing(), 'four traced repeats score the set and raise its reveal');
  fire(canvas, 'pointerdown', { pointerId: 90, isPrimary: true, clientX: 5, clientY: 5 });
  fire(canvas, 'pointerup', { pointerId: 90, isPrimary: true, clientX: 5, clientY: 5 });
  ok(revealing(), 'a tap inside the 600ms guard cannot skip the reveal');
  tick(REVEAL);
  ok(!revealing(), 'and the beat it re-armed advances in full');
  playSet();                              /* set 2 */
  tick(GUARD);
  fire(canvas, 'pointerdown', { pointerId: 91, isPrimary: true, clientX: 5, clientY: 5 });
  tick(60000);
  ok(revealing(), 'a held press keeps the set reveal up for a minute');
  fire(canvas, 'pointerup', { pointerId: 91, isPrimary: true, clientX: 5, clientY: 5 });
  ok(!revealing(), 'the release moves to the next set');
  playSet();                              /* set 3 */
  tick(GUARD);
  fire(canvas, 'pointerdown', { pointerId: 92, isPrimary: true, clientX: 5, clientY: 5 });
  doc.hidden = true;
  fire(canvas, 'pointercancel', { pointerId: 92, isPrimary: true, clientX: 5, clientY: 5 });
  tick(60000);
  ok(revealing(), 'a cancelled hold on a hidden tab parks the reveal');
  doc.hidden = false;
  fire(canvas, 'pointerdown', { pointerId: 93, isPrimary: true, clientX: 5, clientY: 5 });
  fire(canvas, 'pointerup', { pointerId: 93, isPrimary: true, clientX: 5, clientY: 5 });
  ok(!revealing(), 'a tap after returning advances the parked reveal');
  playSet();                              /* set 4: the bank */
  ok(reports.length === 1, 'the round is banked the instant the fourth set scores (reports=' + reports.length + ')');
  ok(!roundDone(), 'while its reveal is still on screen');
  tick(REVEAL);
  ok(reports.length === 1 && roundDone(), 'closing the last reveal is presentation only');

  /* -- round 2: impatient "new round" during the fourth reveal -- */
  els.btnRound.click();
  for (let i = 0; i < 4; i++) { playSet(); if (i < 3) tick(REVEAL); }
  ok(reports.length === 2, 'round 2 banked at its fourth set');
  els.btnRound.click();                   /* mid-reveal: flushes, then deals */
  ok(reports.length === 2, 'flushing a banked round through "new round" does not report again');
  ok(!roundDone() && !revealing(), 'and a fresh round is dealt');

  ok(reports.every((sc) => isFinite(sc) && sc >= 0 && sc <= 100), 'every reported score is a real 0-100');
}

/* ============================================================
   lines — files synchronously at the sixth stroke, reveal stays up
   ============================================================ */
function runLines() {
  console.log('== lines: six pulled strokes, filed at the sixth, reveal immortal ==');
  const IDS = ['gameCanvas', 'hint', 'toast', 'hudRound', 'hudScore', 'hudBest',
    'btnRound', 'btnHow', 'howTo', 'inputMode'];
  const p = boot('lines', IDS);
  const { els, tick, reports, fire, doc } = p;
  const canvas = els.gameCanvas;
  const REVEAL = 1500; /* REVEAL_MS */
  let pid = 200;

  /* A and B are the two r=6 dots drawEndpoints fills, A first then B —
     so scanning the drill's own arc() calls backwards, the last r=6 is B
     and the one before it is A. */
  function pairEnds() {
    const arcs = canvas._ctx._arcs;
    let b = null, a = null;
    for (let i = arcs.length - 1; i >= 0; i--) {
      if (arcs[i].r === 6) { if (!b) b = arcs[i]; else { a = arcs[i]; break; } }
    }
    return { a, b };
  }

  function pullStroke() {
    const { a, b } = pairEnds();
    const id = pid++;
    fire(canvas, 'pointerdown', { pointerId: id, isPrimary: true, clientX: a.x, clientY: a.y });
    for (let i = 1; i <= 24; i++) {
      fire(canvas, 'pointermove', { pointerId: id, isPrimary: true,
        clientX: a.x + (b.x - a.x) * i / 24, clientY: a.y + (b.y - a.y) * i / 24 });
    }
    fire(canvas, 'pointerup', { pointerId: id, isPrimary: true, clientX: b.x, clientY: b.y });
  }
  const revealing = () => els.hint.textContent.indexOf('tap for next') !== -1;
  const roundDone = () => els.hint.textContent.indexOf('round done') !== -1;

  /* -- round 1 -- */
  pullStroke();
  ok(revealing(), 'a pulled stroke scores and raises its reveal');
  tick(REVEAL);
  ok(!revealing(), 'the unheld reveal advances on the beat');
  pullStroke();                                  /* stroke 2 */
  fire(canvas, 'pointerdown', { pointerId: 95, isPrimary: true, clientX: 5, clientY: 5 });
  tick(60000);
  ok(revealing(), 'a held press keeps the reveal up (no guard window here by design)');
  fire(canvas, 'pointerup', { pointerId: 95, isPrimary: true, clientX: 5, clientY: 5 });
  ok(!revealing(), 'the release moves on');
  pullStroke();                                  /* stroke 3 */
  fire(canvas, 'pointerdown', { pointerId: 96, isPrimary: true, clientX: 5, clientY: 5 });
  doc.hidden = true;
  fire(canvas, 'pointercancel', { pointerId: 96, isPrimary: true, clientX: 5, clientY: 5 });
  tick(60000);
  ok(revealing(), 'a cancelled hold on a hidden tab parks the reveal');
  doc.hidden = false;
  fire(canvas, 'pointerdown', { pointerId: 97, isPrimary: true, clientX: 5, clientY: 5 });
  fire(canvas, 'pointerup', { pointerId: 97, isPrimary: true, clientX: 5, clientY: 5 });
  ok(!revealing(), 'a tap after returning advances it');
  pullStroke(); tick(REVEAL);                    /* stroke 4 */
  pullStroke(); tick(REVEAL);                    /* stroke 5 */
  ok(reports.length === 0, 'nothing filed before the sixth stroke');
  pullStroke();                                  /* stroke 6: files synchronously */
  ok(reports.length === 1 && roundDone(), 'the sixth stroke files the round synchronously (reports=' + reports.length + ')');
  tick(120000);
  ok(reports.length === 1 && roundDone(), 'the round-end reveal stays up and never re-files');
  els.btnRound.click();
  ok(!roundDone(), 'new round deals fresh');
  pullStroke();
  for (let i = 0; i < 5; i++) { tick(REVEAL); pullStroke(); }
  ok(reports.length === 2, 'round 2 files exactly once');

  ok(reports.every((sc) => isFinite(sc) && sc >= 0 && sc <= 100), 'every reported score is a real 0-100');
}

/* ============================================================
   negative-space — pre-banks in onDone; hold-then-tap on the reveal
   ============================================================ */
function runNegativeSpace() {
  console.log('== negative-space: three traced spaces, banked at the third done ==');
  const IDS = ['gameCanvas', 'hint', 'toast', 'hudRound', 'hudScore', 'hudBest',
    'btnDone', 'btnUndo', 'btnAgain', 'btnClear', 'btnRound', 'btnHow', 'howTo', 'inputMode'];
  const p = boot('negative-space', IDS);
  const { els, tick, reports, fire } = p;
  const canvas = els.gameCanvas;
  const REVEAL = 1700;
  let pid = 300;

  function scribble() {
    const id = pid++;
    fire(canvas, 'pointerdown', { pointerId: id, isPrimary: true, clientX: 80, clientY: 80 });
    for (let i = 1; i <= 30; i++) {
      fire(canvas, 'pointermove', { pointerId: id, isPrimary: true,
        clientX: 80 + i * 8, clientY: 80 + ((i % 5) - 2) * 12 });
    }
    fire(canvas, 'pointerup', { pointerId: id, isPrimary: true, clientX: 320, clientY: 80 });
  }
  const inReveal = () => /— \d+ ·/.test(els.hint.textContent);
  const roundDone = () => els.hint.textContent.indexOf('round done') !== -1;

  els.btnDone.click();
  ok(reports.length === 0 && !inReveal(), 'done before any trace scores nothing');
  /* -- round 1 -- */
  for (let i = 0; i < 2; i++) { scribble(); els.btnDone.click(); tick(REVEAL); }
  scribble(); els.btnDone.click();          /* third space: the bank */
  ok(reports.length === 1, 'the round is banked the instant the third space scores (reports=' + reports.length + ')');
  ok(inReveal() && !roundDone(), 'while its reveal is still on screen');
  tick(REVEAL);
  ok(reports.length === 1 && roundDone(), 'closing the last reveal is presentation only');
  tick(120000);
  ok(roundDone() && reports.length === 1, 'the round-end reveal stays up and never re-files');

  /* -- round 2: hold-then-tap -- */
  els.btnRound.click();
  scribble(); els.btnDone.click();
  ok(inReveal(), 'a traced space scores and raises its reveal');
  fire(canvas, 'pointerdown', { pointerId: 95, isPrimary: true, clientX: 5, clientY: 5 });
  fire(canvas, 'pointerup', { pointerId: 95, isPrimary: true, clientX: 5, clientY: 5 });
  tick(60000);
  ok(inReveal(), 'a press holds the reveal open (tap-up does not advance in the hold-then-tap design)');
  fire(canvas, 'pointerdown', { pointerId: 96, isPrimary: true, clientX: 5, clientY: 5 });
  fire(canvas, 'pointerup', { pointerId: 96, isPrimary: true, clientX: 5, clientY: 5 });
  ok(!inReveal(), 'the next press advances to the next space');
  for (let i = 0; i < 2; i++) { scribble(); els.btnDone.click(); if (i === 0) tick(REVEAL); }
  ok(reports.length === 2, 'round 2 banked exactly once (reports=' + reports.length + ')');
  tick(REVEAL);
  ok(reports.length === 2 && roundDone(), 'and closes presentation-only');

  ok(reports.every((sc) => isFinite(sc) && sc >= 0 && sc <= 100), 'every reported score is a real 0-100');
}

runLightDirection();
runTemplate();
runSuperimposed();
runLines();
runNegativeSpace();

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('all green');
