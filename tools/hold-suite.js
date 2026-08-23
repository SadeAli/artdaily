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
   to reach the filing path directly). The harness is generic; a sibling
   joins by adding a runner beside runLightDirection(). */
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
  const store = { canvas };
  return new Proxy({}, {
    get(t, prop) {
      if (prop in store) return store[prop];
      if (prop === 'createImageData' || prop === 'getImageData') {
        return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      }
      if (prop === 'measureText') return () => ({ width: 8 });
      return () => {};
    },
    set(t, prop, v) { store[prop] = v; return true; },
  });
}

function makeCanvas() {
  const c = makeEl('canvas');
  c.width = 720; c.height = 450;
  c.getContext = () => makeCtx(c);
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
    best: () => null,
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
    addEventListener() {},
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
    Date: { now: () => now },
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

  return { els, tick, reports, fire, doc, sandbox };
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
  for (let i = 0; i < 3; i++) { lock(); advanceBtn(); }
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

runLightDirection();

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('all green');
