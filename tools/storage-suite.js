/* Adversarial harness for js/app.js's storage layer.
   Boots the REAL app.js (plus the real registry.js) inside a vm context with
   a minimal DOM stub and a controllable localStorage, then drives finished
   rounds through the page's own postMessage result path — the same path a
   drill in another tab uses. Assertions read only OBSERVABLE surfaces: the
   checklist slots, the closing card, the streak chip, the page toast, and
   the fake disk. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = require("path").join(__dirname, "..");

/* ---- element stub ---- */
function makeEl(tag) {
  const node = {
    nodeType: 1,
    tagName: String(tag || 'div').toUpperCase(),
    childNodes: [],
    attrs: {},
    dataset: {},
    hidden: false,
    className: '',
    id: '', title: '', type: '', href: '',
    open: false,
    style: {
      props: {},
      setProperty(k, v) { this.props[k] = v; },
    },
    _listeners: {},
    _text: '',
    get children() { return this.childNodes.filter(n => n.nodeType === 1); },
    get textContent() {
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map(n => n.textContent).join('');
    },
    set textContent(v) {
      this.childNodes = [];
      this._text = String(v);
      if (this._onWrite) this._onWrite(this._text);
    },
    appendChild(c) {
      this.childNodes.push(c);
      if (this._onWrite) this._onWrite(this.textContent);
      return c;
    },
    insertBefore(c, ref) {
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i === -1) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
      return c;
    },
    removeChild(c) {
      const i = this.childNodes.indexOf(c);
      if (i !== -1) this.childNodes.splice(i, 1);
      return c;
    },
    remove() {},
    get firstChild() { return this.childNodes[0] || null; },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'data-slug') this.dataset.slug = String(v);
    },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    click() { (this._listeners.click || []).forEach(fn => fn({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, preventDefault() {} })); },
    classList: null, /* set below */
    contains() { return false; },
    focus() {},
    querySelector() { return null; },
    scrollIntoView() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  node.classList = {
    add(c) { if (!this.contains(c)) node.className = (node.className + ' ' + c).trim(); },
    remove(c) { node.className = node.className.split(/\s+/).filter(x => x !== c).join(' '); },
    toggle(c, force) {
      const has = this.contains(c);
      const want = force === undefined ? !has : !!force;
      if (want && !has) this.add(c); else if (!want && has) this.remove(c);
    },
    contains(c) { return node.className.split(/\s+/).indexOf(c) !== -1; },
  };
  return node;
}

/* ---- one scenario = one fresh page boot ---- */
function boot(opts) {
  opts = opts || {};
  const disk = new Map(Object.entries(opts.disk || {}));
  const diskLog = [];
  let denySet = !!opts.denySet;            /* setItem throws while true */
  let denyRemove = !!opts.denyRemove;

  const els = {};                          /* id -> element */
  const IDS = ['catalogue', 'jumpNav', 'todayList', 'todayHead', 'todayDone', 'todayNote',
    'shareBtn', 'streakChip', 'skillMeters', 'metersEmpty', 'resetBtn', 'player',
    'playerFrame', 'playerTitle', 'playerOpen', 'playerClose', 'playerStatus', 'playerNext',
    'record', 'closing', 'pageToast', 'footerSignup', 'footerSignupForm', 'footerSignupSaid',
    'footerSignupEmail', 'themeToggle', 'closing'];
  IDS.forEach(id => { els[id] = makeEl(id === 'todayList' || id === 'skillMeters' ? 'ul' : 'div'); els[id].id = id; });
  ['streakChip', 'todayNote', 'record', 'closing', 'skillMeters', 'shareBtn', 'playerNext', 'footerSignup', 'themeToggle'].forEach(id => { els[id].hidden = true; });

  const toastWrites = [];
  els.pageToast._onWrite = (t) => { if (t) toastWrites.push(t); };

  const winListeners = {};
  const documentEl = makeEl('html');
  const doc = {
    documentElement: documentEl,
    head: makeEl('head'),
    activeElement: null,
    getElementById(id) { return els[id] || null; },
    createElement: makeEl,
    createTextNode(s) { return { nodeType: 3, textContent: String(s) }; },
    createElementNS(ns, tag) { return makeEl(tag); },
    querySelector() { return null; },
    addEventListener(t, fn) { (winListeners['doc:' + t] = winListeners['doc:' + t] || []).push(fn); },
  };
  documentEl.dataset.theme = 'light';

  const sandbox = {
    console, setTimeout, clearTimeout, URL, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, parseInt, isFinite, isNaN, encodeURIComponent, decodeURIComponent,
    document: doc,
    location: { href: 'http://localhost:8080/', origin: 'http://localhost:8080', pathname: '/', search: '', hash: '' },
    history: { replaceState() {} },
    navigator: {},
    localStorage: {
      getItem(k) { return disk.has(k) ? disk.get(k) : null; },
      setItem(k, v) {
        if (denySet) throw new Error('QuotaExceededError (simulated)');
        disk.set(k, String(v)); diskLog.push(['set', k]);
      },
      removeItem(k) {
        if (denyRemove) throw new Error('SecurityError (simulated)');
        disk.delete(k); diskLog.push(['remove', k]);
      },
    },
    MutationObserver: class { observe() {} },
    confirm: () => true,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/registry.js'), 'utf8'), sandbox, { filename: 'registry.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

  return {
    els, disk, diskLog, toastWrites, winListeners,
    setDenySet(v) { denySet = !!v; },
    /* a finished round arriving from "another tab" — app.js path (b) */
    fire(slug, score) {
      (winListeners.message || []).forEach(fn => fn({
        data: { type: 'artdaily:result', slug, version: 1, score },
        origin: 'http://localhost:8080',
        source: { postMessage() {} },
      }));
    },
    /* what the checklist shows: [ [slug, doneBool], ... ] */
    slots() {
      return els.todayList.children.map(li => {
        const btn = li.children[0];
        return [btn.getAttribute('data-slug'), btn.classList.contains('done')];
      });
    },
    doneLine() { return els.todayDone.textContent; },
    closingShown() { return !els.closing.hidden; },
    streakChip() { return els.streakChip.hidden ? null : els.streakChip.textContent; },
    reset() { els.resetBtn.click(); },
    /* simulate another tab writing the store, then the storage event */
    otherTabWrites(json) {
      disk.set('artdaily-progress-v1', json);
      (winListeners.storage || []).forEach(fn => fn({ key: 'artdaily-progress-v1' }));
    },
    storedDays() {
      const raw = disk.get('artdaily-progress-v1');
      if (!raw) return null;
      try { return JSON.parse(raw).days; } catch (e) { return 'UNPARSEABLE'; }
    },
  };
}

/* ---- assertions ---- */
let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok  ' + name); }
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

/* Scenario 1: healthy storage, newcomer plays the starter trio. */
console.log('\n[1] healthy storage — three rounds, starter trio');
{
  const p = boot();
  p.fire('value-trap', 70);
  p.fire('colors', 80);
  p.fire('lines', 90);
  const slots = p.slots();
  check('3 slots all done', slots.length === 3 && slots.every(s => s[1]), JSON.stringify(slots));
  check('done line says 3/3', /3\/3 done/.test(p.doneLine()), p.doneLine());
  check('closing card shown', p.closingShown());
  check('streak chip = 1 day', /1 day/.test(p.streakChip() || ''), String(p.streakChip()));
  const days = p.storedDays();
  const today = Object.keys(days || {})[0];
  check('disk holds 3 scores', days && today && Object.keys(days[today]).length === 3, JSON.stringify(days));
}

/* Scenario 2: storage denied from the start — the wave-19 reproduction,
   plus the promise-copy gates: nothing on the page may promise that
   tomorrow remembers today while the fallback is on. */
console.log('\n[2] storage denied — three rounds must all stick in memory');
{
  const p = boot({ denySet: true });
  p.fire('value-trap', 70);
  check('day-one note suppressed (it promises persistence)', p.els.todayNote.hidden, p.els.todayNote.textContent);
  check('no streak-promise tail in the done line', !/keeps the streak|longest run/.test(p.doneLine()), p.doneLine());
  p.fire('colors', 80);
  p.fire('lines', 90);
  const slots = p.slots();
  check('3 slots all done', slots.length === 3 && slots.every(s => s[1]), JSON.stringify(slots));
  check('done line says 3/3', /3\/3 done/.test(p.doneLine()), p.doneLine());
  check('closing card shown', p.closingShown());
  const streakLine = p.els.closing.children.filter(c => c.className === 'closing-streak')[0];
  check('closing streak line says the true thing, not "come back tomorrow"',
    streakLine && /isn’t letting the page save/.test(streakLine.textContent) &&
    !/come back tomorrow/.test(streakLine.textContent), streakLine && streakLine.textContent);
  check('streak chip = 1 day', /1 day/.test(p.streakChip() || ''), String(p.streakChip()));
  check('disk untouched', p.storedDays() === null);
  const note = p.toastWrites.filter(t => /not letting the page save/.test(t));
  check('honest toast queued exactly once', note.length === 1, JSON.stringify(p.toastWrites));
}

/* Scenario 2b: healthy storage still gets the day-one bridge. */
console.log('\n[2b] healthy storage — the day-one note and closing promise still render');
{
  const p = boot();
  p.fire('value-trap', 70);
  check('day-one note shown', !p.els.todayNote.hidden && /day two makes it a streak/.test(p.els.todayNote.textContent), p.els.todayNote.textContent);
  p.fire('colors', 80);
  p.fire('lines', 90);
  const streakLine = p.els.closing.children.filter(c => c.className === 'closing-streak')[0];
  check('closing line promises tomorrow', streakLine && /come back tomorrow/.test(streakLine.textContent), streakLine && streakLine.textContent);
}

/* Scenario 3: reset while in fallback mode must not resurrect anything. */
console.log('\n[3] denied storage — reset wipes the memory store too');
{
  const p = boot({ denySet: true, denyRemove: true,
    disk: { 'artdaily-progress-v1': JSON.stringify({ days: { '2026-08-20': { lines: 55 } }, streak: { count: 1, last: '2026-08-20', freezes: 0 }, skills: {}, badges: {}, seen: {} }) } });
  p.fire('value-trap', 70);
  p.reset();
  const slotsAfterReset = p.slots();
  check('after reset nothing done', slotsAfterReset.every(s => !s[1]), JSON.stringify(slotsAfterReset));
  p.fire('colors', 80);
  const slots = p.slots();
  const doneCount = slots.filter(s => s[1]).length;
  check('one round after reset = exactly 1 done', doneCount === 1, JSON.stringify(slots));
  check('old disk day not resurrected in done line', !/2 days|full/.test(p.doneLine()), p.doneLine());
}

/* Scenario 4: healthy storage — the cross-tab guard still adopts disk. */
console.log('\n[4] healthy storage — another tab’s write is adopted, not clobbered');
{
  const p = boot();
  p.fire('value-trap', 70);
  const today = Object.keys(p.storedDays())[0];
  /* other tab logs colors 80 on top of our value-trap */
  const merged = JSON.parse(p.disk.get('artdaily-progress-v1'));
  merged.days[today].colors = 80;
  p.otherTabWrites(JSON.stringify(merged));
  p.fire('lines', 90);
  const days = p.storedDays();
  check('all three survive (no clobber)', Object.keys(days[today]).length === 3, JSON.stringify(days));
  check('checklist shows 3/3', /3\/3 done/.test(p.doneLine()), p.doneLine());
}

/* Scenario 5: setItem starts working again mid-session — fallback must be
   sticky, so a stale snapshot can never overwrite disk bytes written by
   another tab while we were dark. */
console.log('\n[5] denied then "recovered" — fallback stays sticky, disk never touched');
{
  const p = boot({ denySet: true });
  p.fire('value-trap', 70);
  /* another tab (with working storage, hypothetically) writes the store */
  p.disk.set('artdaily-progress-v1', JSON.stringify({ days: { '2026-01-01': { colors: 99 } }, streak: { count: 1, last: '2026-01-01', freezes: 0 }, skills: {}, badges: {}, seen: {} }));
  p.setDenySet(false);          /* quota freed */
  p.fire('colors', 80);
  const days = p.storedDays();
  check('disk bytes not clobbered by our snapshot', days && days['2026-01-01'] && days['2026-01-01'].colors === 99, JSON.stringify(days));
  const slots = p.slots();
  check('our session still ticks in memory', slots.filter(s => s[1]).length === 2, JSON.stringify(slots));
}

/* Scenario 6: removal refused BEFORE any save has failed — the ghost check.
   The store already carries pins (post-migration shape), so boot performs
   no backfill persist and the fallback is still unarmed when reset is
   pressed. removeItem is refused; without the ghost check the next adopt
   read the old disk text back and resurrected the wiped store. */
console.log('\n[6] reset with removal refused, fallback not yet armed — nothing resurrects');
{
  const old = { days: { '2026-08-20': { lines: 55 } },
    streak: { count: 1, last: '2026-08-20', freezes: 0, longest: 1 },
    skills: {}, badges: {}, seen: {}, picks: { '2026-08-20': ['lines', 'colors', 'values'] } };
  const p = boot({ denySet: true, denyRemove: true,
    disk: { 'artdaily-progress-v1': JSON.stringify(old) } });
  p.reset();
  p.fire('value-trap', 70);
  const slots = p.slots();
  check('exactly one drill done after reset+round', slots.filter(s => s[1]).length === 1, JSON.stringify(slots));
  check('old day not resurrected (record shows 1 day)',
    !/2 days practised/.test(p.els.record.textContent), p.els.record.textContent.slice(0, 80));
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all scenarios green'));
process.exit(failures ? 1 : 0);
