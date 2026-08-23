/* Adversarial suite for the per-drill trend block (renderTrends).
   Boots the real js/app.js + js/registry.js under the same stub family as
   tools/storage-suite.js and reads only the rendered #trends surface. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function makeEl(tag) {
  const node = {
    nodeType: 1, tagName: String(tag || 'div').toUpperCase(), childNodes: [],
    attrs: {}, dataset: {}, hidden: false, className: '', id: '', title: '',
    type: '', href: '', open: false,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    _listeners: {}, _text: '',
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
    get textContent() {
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map((n) => n.textContent).join('');
    },
    set textContent(v) { this.childNodes = []; this._text = String(v); },
    appendChild(c) { this.childNodes.push(c); return c; },
    insertBefore(c, ref) {
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i === -1) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
      return c;
    },
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i !== -1) this.childNodes.splice(i, 1); return c; },
    remove() {},
    get firstChild() { return this.childNodes[0] || null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'data-slug') this.dataset.slug = String(v); },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, preventDefault() {} })); },
    classList: null, contains() { return false; }, focus() {},
    querySelector() { return null; }, scrollIntoView() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  };
  node.classList = {
    add(c) { if (!this.contains(c)) node.className = (node.className + ' ' + c).trim(); },
    remove(c) { node.className = node.className.split(/\s+/).filter((x) => x !== c).join(' '); },
    toggle(c, force) {
      const has = this.contains(c);
      const want = force === undefined ? !has : !!force;
      if (want && !has) this.add(c); else if (!want && has) this.remove(c);
    },
    contains(c) { return node.className.split(/\s+/).indexOf(c) !== -1; },
  };
  return node;
}

function boot(storeObj) {
  const disk = new Map();
  if (storeObj) disk.set('artdaily-progress-v1', JSON.stringify(storeObj));
  const els = {};
  ['catalogue', 'jumpNav', 'todayList', 'todayHead', 'todayDone', 'todayNote', 'shareBtn',
    'streakChip', 'skillMeters', 'metersEmpty', 'resetBtn', 'player', 'playerFrame',
    'playerTitle', 'playerOpen', 'playerClose', 'playerStatus', 'playerNext', 'record',
    'closing', 'pageToast', 'footerSignup', 'footerSignupForm', 'footerSignupSaid',
    'footerSignupEmail', 'themeToggle', 'trends'].forEach((id) => { els[id] = makeEl('div'); els[id].id = id; });
  els.trends.hidden = true;
  const winListeners = {};
  const documentEl = makeEl('html');
  documentEl.dataset.theme = 'light';
  const doc = {
    documentElement: documentEl, head: makeEl('head'), activeElement: null,
    getElementById: (id) => els[id] || null,
    createElement: makeEl,
    createTextNode: (s) => ({ nodeType: 3, textContent: String(s) }),
    createElementNS: (ns, tag) => makeEl(tag),
    querySelector: () => null,
    addEventListener() {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, URL, Date, Math, JSON, Object, Array, String,
    Number, Boolean, RegExp, parseInt, isFinite, isNaN, encodeURIComponent, decodeURIComponent,
    document: doc,
    location: { href: 'http://localhost:8080/', origin: 'http://localhost:8080', pathname: '/', search: '', hash: '' },
    history: { replaceState() {} }, navigator: {},
    localStorage: {
      getItem: (k) => (disk.has(k) ? disk.get(k) : null),
      setItem: (k, v) => { disk.set(k, String(v)); },
      removeItem: (k) => { disk.delete(k); },
    },
    MutationObserver: class { observe() {} },
    confirm: () => true,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/registry.js'), 'utf8'), sandbox, { filename: 'registry.js' });
  const t0 = Date.now();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return { els, bootMs: Date.now() - t0 };
}

/* store scaffolding */
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function key(back) {
  const d = new Date(); d.setDate(d.getDate() - back);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function mkStore(days) {
  const today = key(0);
  return { days, streak: { count: 1, last: today, freezes: 0, longest: 1 }, skills: {}, badges: {}, seen: {}, picks: {} };
}

function rows(els) {
  const ul = els.trends.children.find((c) => c.tagName === 'UL');
  return ul ? ul.children.map((li) => ({
    name: li.children[0].textContent,
    words: li.children[1].textContent,
    dots: (li.children[2] ? li.children[2].children.filter((c) => c.tagName === 'CIRCLE').length : 0),
  })) : [];
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n[1] empty store and 2-day drill render nothing');
{
  const a = boot(null);
  check('empty store: block hidden', a.els.trends.hidden);
  const days = {}; days[key(1)] = { lines: 40 }; days[key(0)] = { lines: 50 };
  const b = boot(mkStore(days));
  check('2 logged days: block hidden', b.els.trends.hidden);
}

console.log('\n[2] three rising days — w=1 sentence, exact numbers');
{
  const days = {};
  days[key(4)] = { lines: 40 };
  days[key(2)] = { lines: 55 };
  days[key(0)] = { lines: 71 };
  const p = boot(mkStore(days));
  check('block shown', !p.els.trends.hidden);
  const r = rows(p.els);
  check('one row, Steady Lines', r.length === 1 && r[0].name === 'Steady Lines', JSON.stringify(r));
  check('sentence: latest 71 — up 31 on your first day', r[0] && r[0].words === 'latest 71 — up 31 on your first day', r[0] && r[0].words);
  check('three dots drawn', r[0] && r[0].dots === 3, r[0] && String(r[0].dots));
}

console.log('\n[3] ten days — w=5 averages, up-trend arithmetic');
{
  /* first five 40,42,44,46,48 (avg 44) · last five 60,62,64,66,68 (avg 64) */
  const days = {};
  const scores = [40, 42, 44, 46, 48, 60, 62, 64, 66, 68];
  for (let i = 0; i < 10; i++) days[key(9 - i)] = { colors: scores[i] };
  const p = boot(mkStore(days));
  const r = rows(p.els);
  check('sentence names both windows', r[0] && r[0].words === 'last 5 days played average 64 — up 20 on your first 5', r[0] && r[0].words);
}

console.log('\n[4] down-trend is named plainly and kindly');
{
  const days = {};
  const scores = [80, 80, 80, 80, 80, 60, 60, 60, 60, 60];
  for (let i = 0; i < 10; i++) days[key(9 - i)] = { values: scores[i] };
  const p = boot(mkStore(days));
  const r = rows(p.els);
  check('sentence: 20 under + dips clause', r[0] && r[0].words === 'last 5 days played average 60 — 20 under your first 5 · dips are part of it', r[0] && r[0].words);
}

console.log('\n[5] seven qualifying drills — capped at 5, most-played first, note says so');
{
  const slugs = ['lines', 'colors', 'values', 'ellipses', 'symmetry', 'crop-it', 'warm-up'];
  const days = {};
  /* drill i gets 3+i logged days, so warm-up (9 days) is most played */
  slugs.forEach((s, i) => {
    for (let d = 0; d < 3 + i; d++) {
      const k = key(d);
      (days[k] = days[k] || {})[s] = 50 + d;
    }
  });
  const p = boot(mkStore(days));
  const r = rows(p.els);
  check('exactly 5 rows', r.length === 5, String(r.length));
  check('most-played first (Warm Up)', r[0] && r[0].name === 'Warm Up', r[0] && r[0].name);
  const note = p.els.trends.children.find((c) => c.className.indexOf('trends-note') !== -1);
  check('cap note present', note && /practised most/.test(note.textContent), note && note.textContent);
}

console.log('\n[6] lapsed drill (last played 40+ days ago) still draws its dots');
{
  const days = {};
  days[key(45)] = { lines: 40 };
  days[key(43)] = { lines: 50 };
  days[key(41)] = { lines: 60 };
  const p = boot(mkStore(days));
  const r = rows(p.els);
  check('row renders', r.length === 1, JSON.stringify(r));
  check('window slid back: 3 dots', r[0] && r[0].dots === 3, r[0] && String(r[0].dots));
}

console.log('\n[7] 730-day full store — smoke + boot time');
{
  const days = {};
  for (let d = 0; d < 730; d++) days[key(d)] = { lines: 50 + (d % 40), colors: 60, values: 70 };
  const p = boot(mkStore(days));
  const r = rows(p.els);
  check('renders rows', r.length >= 1, String(r.length));
  check('boot under 2s on a 2-year store', p.bootMs < 2000, p.bootMs + 'ms');
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all green'));
process.exit(failures ? 1 : 0);
