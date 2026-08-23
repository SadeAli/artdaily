/* Adversarial suite for the SDK's injected standalone chrome: the hand-off
   bar, the daily note, and the sheet-share button. Boots the real
   sdk/artdaily-sdk.js on a stubbed standalone drill page and drives
   ArtDaily.init / roundRandom / report the way a drill does. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function makeEl(tag) {
  const node = {
    nodeType: 1, tagName: String(tag || 'div').toUpperCase(), childNodes: [],
    attrs: {}, dataset: {}, hidden: false, className: '', id: '', title: '',
    type: '', href: '', parentNode: null,
    style: {},
    _listeners: {}, _text: '',
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
    /* Real DOM turns a textContent assignment into one text node that later
       appendChild()s sit AFTER — so the getter is own-text plus children,
       never one or the other. */
    get textContent() {
      return this._text + this.childNodes.map((n) => n.textContent).join('');
    },
    set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this._text = String(v); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const sib = this.parentNode.childNodes;
      const i = sib.indexOf(this);
      return i === -1 ? null : (sib[i + 1] || null);
    },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this;
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i === -1) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
      return c;
    },
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i !== -1) { this.childNodes.splice(i, 1); c.parentNode = null; } return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get firstChild() { return this.childNodes[0] || null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({})); },
    contains() { return false; },
    focus() {},
    querySelector() { return null; },
  };
  return node;
}

function walk(root, fn) {
  const out = [];
  (function rec(n) {
    if (!n || n.nodeType !== 1) return;
    if (fn(n)) out.push(n);
    (n.childNodes || []).forEach(rec);
  })(root);
  return out;
}

/* opts: { canvas: bool } — whether the page has a canvas.game-canvas */
function boot(opts) {
  opts = opts || {};
  const documentEl = makeEl('html');
  documentEl.dataset = { theme: 'light' };
  const head = makeEl('head');
  const body = makeEl('body');
  documentEl.appendChild(head);
  documentEl.appendChild(body);
  const gameBody = makeEl('div'); gameBody.className = 'game-body';
  const h1 = makeEl('h1'); h1.className = 'game-name'; h1.textContent = '✏️ Steady Lines';
  const controls = makeEl('div'); controls.className = 'game-controls';
  body.appendChild(gameBody);
  gameBody.appendChild(h1);
  let canvas = null;
  if (opts.canvas !== false) {
    canvas = makeEl('canvas');
    canvas.className = 'game-canvas';
    canvas.width = 900; canvas.height = 560;
    canvas.toBlob = function (cb) { cb(null); };  /* never composited in node */
    gameBody.appendChild(canvas);
  }
  gameBody.appendChild(controls);

  const matches = (n, sel) => {
    if (sel === '.game-controls') return n.className.split(/\s+/).includes('game-controls');
    if (sel === '.game-body') return n.className.split(/\s+/).includes('game-body');
    if (sel === 'canvas.game-canvas') return n.tagName === 'CANVAS' && n.className.split(/\s+/).includes('game-canvas');
    if (sel === '.game-name') return n.className.split(/\s+/).includes('game-name');
    if (sel === 'a.handoff-link') return n.tagName === 'A' && n.className.split(/\s+/).includes('handoff-link');
    return false;
  };
  const doc = {
    documentElement: documentEl,
    head, body,
    activeElement: null,
    getElementById: (id) => walk(documentEl, (n) => n.id === id)[0] || null,
    querySelector: (sel) => walk(documentEl, (n) => matches(n, sel))[0] || null,
    createElement: makeEl,
    createTextNode: (s) => ({ nodeType: 3, textContent: String(s), parentNode: null }),
  };
  const winListeners = {};
  const sandbox = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, Math, JSON, Object,
    Array, String, Number, Boolean, RegExp, parseInt, isFinite, isNaN,
    encodeURIComponent, decodeURIComponent,
    document: doc,
    location: { href: 'https://artdaily.sadeali.com/lines/', origin: 'https://artdaily.sadeali.com', pathname: '/lines/', search: '', hash: '' },
    navigator: {},
    localStorage: (() => { const m = new Map(); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
    }; })(),
    MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  };
  sandbox.window = sandbox;
  sandbox.window.parent = sandbox.window;      /* standalone: parent === self */
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sdk/artdaily-sdk.js'), 'utf8'), sandbox, { filename: 'artdaily-sdk.js' });
  return {
    sandbox, doc, gameBody, controls, winListeners,
    chrome() {
      /* the elements after .game-controls, in DOM order, by class/id */
      const sib = gameBody.childNodes;
      const from = sib.indexOf(controls);
      return sib.slice(from + 1).map((n) =>
        n.id === 'artdailyHandoff' ? 'handoff'
          : n.className === 'sheetshare' ? 'sheetshare'
          : n.className === 'daily-note' ? 'daily-note' : n.className || n.tagName);
    },
    deliverReceipt(slug) {
      (winListeners.message || []).forEach((fn) => fn({
        origin: 'https://artdaily.sadeali.com',
        data: { type: 'artdaily:logged', slug, version: 1, score: 80 },
      }));
    },
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n[1] seeded drill, canvas page — bar, share button, daily note, in order, once');
{
  const p = boot({ canvas: true });
  const A = p.sandbox.window.ArtDaily;
  A.init({ slug: 'lines' });
  A.roundRandom(1);            /* the drill deals round 1 from the day */
  A.report(84);
  check('order: handoff · sheetshare · daily-note', JSON.stringify(p.chrome()) === JSON.stringify(['handoff', 'sheetshare', 'daily-note']), JSON.stringify(p.chrome()));
  A.report(91);
  check('second round adds nothing', JSON.stringify(p.chrome()) === JSON.stringify(['handoff', 'sheetshare', 'daily-note']), JSON.stringify(p.chrome()));
  const note = p.doc.querySelector ? walk(p.doc.documentElement, (n) => n.className === 'daily-note')[0] : null;
  check('note text carries the earned sentence', note && /the same one for everyone playing today/.test(note.textContent), note && note.textContent);
  check('note is not a live region', note && !note.attrs.role && !note.attrs['aria-live']);
  const btn = walk(p.doc.documentElement, (n) => n.tagName === 'BUTTON')[0];
  check('share button reads "copy the sheet"', btn && /copy the sheet/.test(btn.textContent), btn && btn.textContent);
}

console.log('\n[2] unseeded drill (never calls roundRandom) — no daily note, ever');
{
  const p = boot({ canvas: true });
  const A = p.sandbox.window.ArtDaily;
  A.init({ slug: 'warm-up' });
  A.report(70);
  check('order: handoff · sheetshare only', JSON.stringify(p.chrome()) === JSON.stringify(['handoff', 'sheetshare']), JSON.stringify(p.chrome()));
}

console.log('\n[3] DOM drill (no canvas) — no share button, note still lands');
{
  const p = boot({ canvas: false });
  const A = p.sandbox.window.ArtDaily;
  A.init({ slug: 'values' });
  A.roundRandom(1);
  A.report(66);
  check('order: handoff · daily-note only', JSON.stringify(p.chrome()) === JSON.stringify(['handoff', 'daily-note']), JSON.stringify(p.chrome()));
}

console.log('\n[4] the opener receipt rewrites the bar and eats neither neighbour');
{
  const p = boot({ canvas: true });
  const A = p.sandbox.window.ArtDaily;
  A.init({ slug: 'lines' });
  A.roundRandom(1);
  A.report(84);
  p.deliverReceipt('lines');
  check('order survives the receipt', JSON.stringify(p.chrome()) === JSON.stringify(['handoff', 'sheetshare', 'daily-note']), JSON.stringify(p.chrome()));
  const bar = walk(p.doc.documentElement, (n) => n.id === 'artdailyHandoff')[0];
  check('bar says sent ✓', bar && /sent to your Art Daily record/.test(bar.textContent), bar && bar.textContent);
}

console.log('\n[5] practice-only sitting (roundRandom(2)) — the note may not claim the day');
{
  const p = boot({ canvas: true });
  const A = p.sandbox.window.ArtDaily;
  A.init({ slug: 'lines' });
  A.roundRandom(2);            /* only practice generators this sitting */
  A.report(50);
  check('no daily note', p.chrome().indexOf('daily-note') === -1, JSON.stringify(p.chrome()));
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all green'));
process.exit(failures ? 1 : 0);
