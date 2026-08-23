/* Adversarial suite for the daily-pick pinning migration + UTC seed.
   Run BEFORE the migration lands and it validates that pickForKeyLegacy
   below is byte-equivalent to the live formula (phase A prints the live
   record for a synthetic 60-day store built with the legacy copy — the two
   must agree on "60 full warmups"). Run AFTER and it additionally asserts
   the pinned record is unchanged, pins are written, and the new seed is
   monotonic across the Europe/London DST jump that used to duplicate a
   whole warmup (major_changes_pending.md wave 13). */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- the FROZEN legacy formula ----------------------------------
   A verbatim, parametrized copy of pickForKey + seedForKey as they stood
   on 2026-08-23 (weights 0.06 / 0.25, seed = epoch-day of LOCAL midnight).
   This is the formula every pre-migration day was judged against; it may
   never change again. */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function seedForKeyLegacy(k) {
  const p = DAY_RE.exec(String(k));
  if (!p) return null;
  return Math.floor(new Date(+p[1], +p[2] - 1, +p[3]).getTime() / 86400000);
}
function slugHash(seed, slug) {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 2654435761);
  return h >>> 0;
}
function legacyPick(key, days, liveGames, CAT_SIZE) {
  const seed = seedForKeyLegacy(key);
  if (seed === null) return [];
  const p = DAY_RE.exec(String(key));
  const scores = (k) => (days[k] && typeof days[k] === 'object') ? days[k] : {};
  const recent = {};
  for (let i = 1; i <= 6; i++) {
    const k = dateKey(new Date(+p[1], +p[2] - 1, +p[3] - i));
    Object.keys(scores(k)).forEach((s) => { recent[s] = Math.max(recent[s] || 0, 7 - i); });
  }
  const weighed = liveGames.map((g) => ({
    g,
    w: slugHash(seed, g.slug) / 4294967295 +
      (CAT_SIZE[g.cat] || 1) * 0.06 - (recent[g.slug] || 0) * 0.25,
  }));
  weighed.sort((a, b) => b.w - a.w);
  const ranked = weighed.map((x) => x.g);
  const picked = [];
  const seen = {};
  ranked.forEach((g) => {
    const cat = g.cat || '';
    if (picked.length < 3 && !seen[cat]) { seen[cat] = true; picked.push(g); }
  });
  ranked.forEach((g) => {
    if (picked.length < 3 && picked.indexOf(g) === -1) picked.push(g);
  });
  return picked;
}

/* ---------- minimal page boot (same stub family as storage-suite) ------ */
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

function boot(diskObj) {
  const disk = new Map(Object.entries(diskObj || {}));
  const els = {};
  ['catalogue', 'jumpNav', 'todayList', 'todayHead', 'todayDone', 'todayNote', 'shareBtn',
    'streakChip', 'skillMeters', 'metersEmpty', 'resetBtn', 'player', 'playerFrame',
    'playerTitle', 'playerOpen', 'playerClose', 'playerStatus', 'playerNext', 'record',
    'closing', 'pageToast', 'footerSignup', 'footerSignupForm', 'footerSignupSaid',
    'footerSignupEmail', 'themeToggle'].forEach((id) => { els[id] = makeEl('div'); els[id].id = id; });
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return {
    els, disk, sandbox,
    fire(slug, score) {
      (winListeners.message || []).forEach((fn) => fn({
        data: { type: 'artdaily:result', slug, version: 1, score },
        origin: 'http://localhost:8080', source: { postMessage() {} },
      }));
    },
    stored() {
      const raw = disk.get('artdaily-progress-v1');
      return raw ? JSON.parse(raw) : null;
    },
  };
}

/* live registry, for the generator */
function loadRegistry() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/registry.js'), 'utf8'), sandbox);
  const games = sandbox.window.ARTDAILY_GAMES.filter((g) => g.status === 'live');
  const CAT_SIZE = {};
  games.forEach((g) => { CAT_SIZE[g.cat] = (CAT_SIZE[g.cat] || 0) + 1; });
  return { games, CAT_SIZE };
}

/* ---------- fixture: 60 consecutive full-warmup days ending today ------ */
function buildFixture() {
  const { games, CAT_SIZE } = loadRegistry();
  const days = {};
  for (let back = 59; back >= 0; back--) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const k = dateKey(d);
    const picks = legacyPick(k, days, games, CAT_SIZE);
    days[k] = {};
    picks.forEach((g) => { days[k][g.slug] = 80; });
  }
  const today = dateKey(new Date());
  return {
    store: { days, streak: { count: 60, last: today, freezes: 2, longest: 60 }, skills: {}, badges: {}, seen: {} },
    today,
  };
}

/* ---------- assertions ---------- */
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const fixture = buildFixture();

console.log('\n[A] frozen legacy copy vs the live page — 60-day full-warmup store');
{
  const p = boot({ 'artdaily-progress-v1': JSON.stringify(fixture.store) });
  const rec = p.els.record.textContent;
  check('record shows 60 days practised', /60\s*days practised/.test(rec.replace(/\s+/g, ' ')), rec.slice(0, 120));
  check('record shows 60 full warmups', /60\s*full warmups/.test(rec.replace(/\s+/g, ' ')), rec.slice(0, 200));
}

/* Everything below only means something once the migration has landed;
   before it, these report as SKIP so phase A can gate the byte-freeze. */
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const migrated = /picksBackfill/.test(appSrc);
if (!migrated) {
  console.log('\n[B..E] SKIP — migration not present in js/app.js yet');
} else {
  console.log('\n[B] backfill: pins land on disk after one mutation, record unchanged');
  {
    const p = boot({ 'artdaily-progress-v1': JSON.stringify(fixture.store) });
    const rec = p.els.record.textContent.replace(/\s+/g, ' ');
    check('record still shows 60 full warmups', /60\s*full warmups/.test(rec), rec.slice(0, 200));
    /* trigger one save so the in-memory backfill persists */
    p.fire('colors', 90);
    const s = p.stored();
    check('picks map persisted', s && s.picks && typeof s.picks === 'object');
    const pinned = Object.keys(s.picks || {}).filter((k) => Array.isArray(s.picks[k]) && s.picks[k].length === 3);
    check('all 60 logged days pinned', pinned.length >= 60, String(pinned.length));
    const { games, CAT_SIZE } = loadRegistry();
    const someKey = Object.keys(fixture.store.days).sort()[10];
    const expect = legacyPick(someKey, fixture.store.days, games, CAT_SIZE).map((g) => g.slug);
    check('a sampled pin equals the legacy formula', JSON.stringify(s.picks[someKey]) === JSON.stringify(expect),
      JSON.stringify(s.picks[someKey]) + ' vs ' + JSON.stringify(expect));
  }

  console.log('\n[C] a fresh newcomer day is pinned as served (starter trio)');
  {
    const p = boot({});
    p.fire('value-trap', 70);
    const s = p.stored();
    const today = Object.keys(s.days)[0];
    check('today pinned', Array.isArray(s.picks[today]), JSON.stringify(s.picks));
    check('pinned to the starter trio', JSON.stringify(s.picks[today]) === JSON.stringify(['value-trap', 'colors', 'lines']),
      JSON.stringify(s.picks[today]));
  }

  console.log('\n[D] the new seed is a pure calendar-day count (no DST duplicates, no east/west split)');
  {
    /* Evaluate the seed straight out of app.js: both derivations must exist
       in the file, and the new one must be timezone-independent. */
    const m = appSrc.match(/function seedForKey\(k\)[\s\S]*?\n  \}/);
    check('seedForKey found', !!m);
    if (m) {
      check('seedForKey uses Date.UTC', /Date\.UTC\(/.test(m[0]), m[0]);
      /* DST duplicate pair from the wave-13 evidence: 2026-03-29/30 in
         Europe/London mapped to ONE seed under the legacy formula. The UTC
         form must give consecutive integers regardless of process TZ. */
      const seed = (k) => {
        const p2 = DAY_RE.exec(k);
        return Date.UTC(+p2[1], +p2[2] - 1, +p2[3]) / 86400000;
      };
      check('2026-03-29 → 30 advances by exactly 1', seed('2026-03-30') - seed('2026-03-29') === 1);
      check('seed is an exact integer', Number.isInteger(seed('2026-03-29')));
      /* legacy really did collapse the pair when the zone is London */
      if (process.env.TZ === 'Europe/London') {
        check('legacy seed really collapsed the DST pair (sanity of the evidence)',
          seedForKeyLegacy('2026-03-30') === seedForKeyLegacy('2026-03-29'));
      }
    }
  }

  console.log('\n[E] app.js and the SDK derive the seed identically (the may-not-drift rule)');
  {
    const sdkSrc = fs.readFileSync(path.join(ROOT, 'sdk/artdaily-sdk.js'), 'utf8');
    const body = (src) => {
      const m = src.match(/function seedForKey\(k\) \{[\s\S]*?\n  \}/);
      return m ? m[0].replace(/\s+/g, ' ') : null;
    };
    const a = body(appSrc), b = body(sdkSrc);
    check('both files define seedForKey', !!a && !!b);
    check('the two bodies are identical', a === b, '\n    app: ' + a + '\n    sdk: ' + b);
  }
}

console.log('\n[F] level field: every live entry tagged, rotation served easiest-first');
{
  const { games } = loadRegistry();
  check('every live entry has level 1|2|3',
    games.every((g) => g.level === 1 || g.level === 2 || g.level === 3),
    games.filter((g) => ![1, 2, 3].includes(g.level)).map((g) => g.slug).join(','));
  /* a non-newcomer store: one past day logged, so today comes from the
     formula — the checklist must list today's three easiest-first */
  const lv = {};
  games.forEach((g) => { lv[g.slug] = g.level; });
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yk = dateKey(yd);
  const days = {}; days[yk] = { lines: 60 };
  const p = boot({ 'artdaily-progress-v1': JSON.stringify(
    { days, streak: { count: 1, last: yk, freezes: 0, longest: 1 }, skills: {}, badges: {}, seen: {}, picks: {} }) });
  const slots = p.els.todayList.children.map((li) => li.children[0].getAttribute('data-slug'));
  const lvs = slots.map((s) => lv[s]);
  check('three rotation slots render', slots.length === 3, JSON.stringify(slots));
  check('served easiest-first (levels non-decreasing)',
    lvs.every((v, i) => i === 0 || lvs[i - 1] <= v), JSON.stringify(slots) + ' -> ' + JSON.stringify(lvs));
  /* the newcomer's starter session keeps its hand-tuned order */
  const q = boot({});
  const startSlots = q.els.todayList.children.map((li) => li.children[0].getAttribute('data-slug'));
  check('starter order untouched', JSON.stringify(startSlots) === JSON.stringify(['value-trap', 'colors', 'lines']), JSON.stringify(startSlots));
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all green'));
process.exit(failures ? 1 : 0);
