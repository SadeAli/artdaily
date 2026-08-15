/* ============================================================
   app.js — the Art Daily sketchbook page.
   Renders js/registry.js into category spreads of index cards,
   the daily warmup checklist and the paint-tube meters; hosts
   games in the player dialog and turns their postMessage results
   into streaks and skill levels. All state lives in THIS
   origin's localStorage — no accounts, no network. Protocol
   details: GAME_GUIDE.md + sdk/.
   ============================================================ */
(function () {
  'use strict';

  var GAMES = window.ARTDAILY_GAMES || [];
  var SKILLS = window.ARTDAILY_SKILLS || {};
  var CATS = window.ARTDAILY_CATS || {};
  var STORE_KEY = 'artdaily-progress-v1';
  var HOME = 'https://artdaily.sadeali.com';
  var ACCENTS = ['coral', 'sunny', 'mint', 'sky', 'lilac', 'bubblegum'];
  var SHARE_LABEL = "copy today's card";
  var TAG_LABELS = { auto: 'math-scored', fit: 'fit-scored', soft: 'curated' };

  function $(id) { return document.getElementById(id); }

  var catalogue = $('catalogue');
  var jumpNav = $('jumpNav');
  var todayList = $('todayList');
  var todayDone = $('todayDone');
  var shareBtn = $('shareBtn');
  var streakChip = $('streakChip');
  var meters = $('skillMeters');
  var resetBtn = $('resetBtn');
  var player = $('player');
  var frame = $('playerFrame');
  var titleEl = $('playerTitle');
  var openLink = $('playerOpen');
  var closeBtn = $('playerClose');
  var statusEl = $('playerStatus');

  var liveGames = GAMES.filter(function (g) { return g.status === 'live'; });

  /* ---- registry helpers ---- */

  /* file:// or localhost serves the sibling workspace copies from the
     registry's dev paths, so games run without being deployed. */
  function isLocal() {
    return location.protocol === 'file:' ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  function gameUrl(g) {
    return (isLocal() && g.dev) ? g.dev : g.url;
  }

  function taggedSkillIds() {
    return Object.keys(SKILLS).filter(function (id) {
      return GAMES.some(function (g) { return g.skills && g.skills.indexOf(id) !== -1; });
    });
  }

  /* ---- progress store ---- */

  function freshStore() {
    return { days: {}, streak: { count: 0, last: '', freezes: 0 }, skills: {}, badges: {}, seen: {} };
  }

  /* Arrays sneak past typeof checks but JSON.stringify drops their named
     properties, so a corrupt array-shaped store would silently never save. */
  function isPlainish(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    if (!isPlainish(s)) s = {};
    if (!isPlainish(s.days)) s.days = {};
    if (!isPlainish(s.streak)) s.streak = {};
    if (typeof s.streak.count !== 'number') s.streak.count = 0;
    if (typeof s.streak.last !== 'string') s.streak.last = '';
    if (typeof s.streak.freezes !== 'number') s.streak.freezes = 0;
    if (!isPlainish(s.skills)) s.skills = {};
    if (!isPlainish(s.badges)) s.badges = {};   /* badgeId -> day earned */
    if (!isPlainish(s.seen)) s.seen = {};       /* one-time UI flags */
    return s;
  }

  var store = loadStore();

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* Local-timezone day keys — toISOString flips the day at UTC
     midnight, which is the wrong midnight for a daily ritual. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function yesterdayKey() { var d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); }

  function dayScores(key) {
    var d = store.days[key];
    return isPlainish(d) ? d : {};
  }

  function playedToday(slug) { return typeof dayScores(todayKey())[slug] === 'number'; }

  function bestFor(slug) {
    var best = null;
    Object.keys(store.days).forEach(function (k) {
      var v = dayScores(k)[slug];
      if (typeof v === 'number' && (best === null || v > best)) best = v;
    });
    return best;
  }

  /* A lapsed streak silently dies — never show a stale count. A banked
     freeze extends "alive" by one more day (see touchStreak). */
  function daysAgoKey(n) { var d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); }

  function streakAlive() {
    var st = store.streak;
    if (st.count <= 0) return false;
    if (st.last === todayKey() || st.last === yesterdayKey()) return true;
    /* missed exactly one day, but a freeze can still save it */
    return st.last === daysAgoKey(2) && st.freezes > 0;
  }

  /* Beginners miss days; a streak that dies on the first slip is a streak
     nobody keeps. Every 5th day banks a freeze (max 2) and a single
     missed day spends one instead of resetting the count. */
  function touchStreak() {
    var st = store.streak, t = todayKey(), note = null;
    if (st.last === t) return null;                    /* already counted today */
    if (st.last === yesterdayKey()) {
      st.count += 1;
    } else if (st.last === daysAgoKey(2) && st.freezes > 0) {
      st.freezes -= 1;
      st.count += 1;
      note = 'freeze';
    } else {
      st.count = 1;
    }
    st.last = t;
    if (st.count > 0 && st.count % 5 === 0 && st.freezes < 2) {
      st.freezes += 1;
      note = note || 'earned';
    }
    return note;
  }

  /* ---- today's warmup: deterministic 3-game spread ---- */

  function daySeed(offset) {
    var n = new Date();
    return Math.floor(new Date(n.getFullYear(), n.getMonth(), n.getDate() + (offset || 0)).getTime() / 86400000);
  }

  function slugHash(seed, slug) {
    var h = seed ^ 0x9e3779b9;
    for (var i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 2654435761);
    return h >>> 0;
  }

  /* Rank live games by hash, take distinct categories first so the
     warmup never doubles up a chapter; top back up if needed.
     Pure function of the day number, so tomorrow's plan can be shown
     today — and everyone in the world gets the same three. */
  function pickForSeed(seed) {
    /* Rank by hash, but bias against drills done in the last few days so
       a daily habit stays varied, and against chapters with few drills —
       picking one per distinct chapter made composition's 2 drills show
       as often as line's 9. */
    var recent = {};
    for (var i = 1; i <= 6; i++) {
      var k = dateKey(new Date(seed * 86400000 - i * 86400000));
      Object.keys(dayScores(k)).forEach(function (s) { recent[s] = Math.max(recent[s] || 0, 7 - i); });
    }
    var perCat = {};
    liveGames.forEach(function (g) { perCat[g.cat] = (perCat[g.cat] || 0) + 1; });

    var ranked = liveGames.slice().sort(function (a, b) {
      var wa = slugHash(seed, a.slug) / 4294967295 + (perCat[a.cat] || 1) * 0.06 - (recent[a.slug] || 0) * 0.25;
      var wb = slugHash(seed, b.slug) / 4294967295 + (perCat[b.cat] || 1) * 0.06 - (recent[b.slug] || 0) * 0.25;
      return wb - wa;
    });
    var picked = [];
    var seen = {};
    ranked.forEach(function (g) {
      var cat = g.cat || '';
      if (picked.length < 3 && !seen[cat]) { seen[cat] = true; picked.push(g); }
    });
    ranked.forEach(function (g) {
      if (picked.length < 3 && picked.indexOf(g) === -1) picked.push(g);
    });
    return picked;
  }

  /* A brand-new visitor gets the curated starter session instead of the
     random daily one — the first three minutes decide whether they ever
     come back. After any day is logged, the normal rotation takes over. */
  function isNewcomer() { return Object.keys(store.days).length === 0; }

  function starterPick() {
    var want = window.ARTDAILY_STARTER || [];
    var out = [];
    want.forEach(function (slug) {
      var g = liveGames.filter(function (x) { return x.slug === slug; })[0];
      if (g) out.push(g);
    });
    return out.length === 3 ? out : null;
  }

  function todayPick() {
    if (isNewcomer()) {
      var s = starterPick();
      if (s) return s;
    }
    return pickForSeed(daySeed(0));
  }
  function tomorrowPick() { return pickForSeed(daySeed(1)); }

  /* ---- milestones ---- */

  /* Small and honest: each fires once, the first time it becomes true,
     and says something the player actually did. */
  var BADGES = [
    { id: 'first',     icon: '🌱', name: 'first drill',      hint: 'you started' },
    { id: 'perfect',   icon: '★',  name: 'perfect day',      hint: 'all three warmups in one day' },
    { id: 'streak3',   icon: '🔥', name: '3 days running',   hint: 'a habit is forming' },
    { id: 'streak7',   icon: '☄️', name: '7 days running',   hint: 'a week of practice' },
    { id: 'streak30',  icon: '🏔️', name: '30 days running',  hint: 'this is who you are now' },
    { id: 'hundred',   icon: '💯', name: 'a clean 100',      hint: 'nailed one exactly' },
    { id: 'tenDrills', icon: '🎒', name: '10 different drills', hint: 'you have tried the whole studio' },
    { id: 'allCats',   icon: '🗺️', name: 'every chapter',    hint: 'colour, value, line, form, composition, observation' },
  ];

  function totalRounds() {
    var n = 0;
    Object.keys(store.days).forEach(function (k) { n += Object.keys(dayScores(k)).length; });
    return n;
  }

  function distinctSlugs() {
    var set = {};
    Object.keys(store.days).forEach(function (k) {
      Object.keys(dayScores(k)).forEach(function (s) { set[s] = true; });
    });
    return Object.keys(set);
  }

  /* Returns the badges newly earned by this moment (never re-awards). */
  function checkBadges(justScored, perfectToday) {
    var got = [], slugs = distinctSlugs(), st = store.streak;
    function give(id) {
      if (store.badges[id]) return;
      store.badges[id] = todayKey();
      got.push(BADGES.filter(function (b) { return b.id === id; })[0]);
    }
    if (slugs.length >= 1) give('first');
    if (perfectToday) give('perfect');
    if (st.count >= 3) give('streak3');
    if (st.count >= 7) give('streak7');
    if (st.count >= 30) give('streak30');
    if (justScored === 100) give('hundred');
    if (slugs.length >= 10) give('tenDrills');
    var cats = {};
    slugs.forEach(function (s) {
      var g = liveGames.filter(function (x) { return x.slug === s; })[0];
      if (g) cats[g.cat] = true;
    });
    if (Object.keys(cats).length >= Object.keys(CATS).length) give('allCats');
    return got.filter(Boolean);
  }

  /* ---- DOM builders ---- */

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  }

  function skillChip(id) {
    var s = SKILLS[id] || { label: id, icon: '' };
    var chip = el('span', 'skillchip');
    if (s.icon) {
      var ic = el('span', '', s.icon);
      ic.setAttribute('aria-hidden', 'true');
      chip.appendChild(ic);
    }
    chip.appendChild(document.createTextNode(s.label));
    return chip;
  }

  /* ---- cards ---- */

  var metaEls = {};  /* slug -> the card's meta <p> for quick refresh */
  var cardEls = {};  /* slug -> the card element, for the done-stamp */

  function fillMeta(g) {
    var m = metaEls[g.slug];
    if (!m) return;
    m.textContent = '';
    var t = '~' + g.minutes + ' min';
    var best = bestFor(g.slug);
    if (best !== null) t += ' · best ' + best + '/100';
    m.appendChild(document.createTextNode(t));
    var done = playedToday(g.slug);
    if (done) {
      m.appendChild(document.createTextNode(' · '));
      m.appendChild(el('span', 'meta-done', 'today ✓'));
    }
    if (cardEls[g.slug]) cardEls[g.slug].classList.toggle('is-done', done);
  }

  function buildCard(g) {
    var li = document.createElement('li');
    var card;
    if (g.status === 'live') {
      /* Real link: middle-click and JS-off navigation still work;
         plain left clicks open the in-page player instead. */
      card = el('a', 'card accent-' + g.accent);
      card.href = gameUrl(g);
      card.addEventListener('click', function (ev) {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault();
        openPlayer(g);
      });
    } else {
      card = el('div', 'card card-soon accent-' + g.accent);
    }
    if (g.status === 'live' && g.tag && TAG_LABELS[g.tag]) {
      var tm = el('span', 'tagmark', TAG_LABELS[g.tag]);
      tm.title = g.tag === 'auto' ? 'scored by pure math'
        : g.tag === 'fit' ? 'scored by a comparison algorithm'
        : 'scored against a curated answer key';
      card.appendChild(tm);
    }
    var blob = el('span', 'card-blob');
    var icon = el('span', 'card-icon', g.icon);
    icon.setAttribute('aria-hidden', 'true');
    blob.appendChild(icon);
    card.appendChild(blob);
    card.appendChild(el('h3', 'card-title', g.name));
    card.appendChild(el('p', 'card-tagline', g.status === 'live' ? g.tagline : 'something’s hatching…'));
    if (g.status === 'live') {
      var sk = el('span', 'card-skills');
      (g.skills || []).forEach(function (id) { sk.appendChild(skillChip(id)); });
      card.appendChild(sk);
      var meta = el('p', 'card-meta');
      metaEls[g.slug] = meta;
      cardEls[g.slug] = card;
      card.setAttribute('data-slug', g.slug);
      card.appendChild(meta);
      fillMeta(g);
    }
    li.appendChild(card);
    return li;
  }

  /* ---- catalogue: one sketchbook spread per category ---- */

  function renderCatalogue() {
    if (!catalogue) return;
    metaEls = {};
    cardEls = {};
    var catIds = Object.keys(CATS).filter(function (id) {
      return GAMES.some(function (g) { return g.cat === id; });
    });
    catIds.forEach(function (id, i) {
      var cat = CATS[id];
      var games = GAMES.filter(function (g) { return g.cat === id; });
      var live = games.filter(function (g) { return g.status === 'live'; }).length;
      var accent = ACCENTS[i % ACCENTS.length];

      var section = el('section', 'section cat-section accent-' + accent);
      section.id = 'cat-' + id;
      section.setAttribute('aria-label', cat.label);

      var head = el('div', 'cat-head');
      var ic = el('span', 'cat-icon', cat.icon);
      ic.setAttribute('aria-hidden', 'true');
      head.appendChild(ic);
      head.appendChild(el('h2', '', cat.label));
      head.appendChild(el('span', 'cat-count', live + (live === 1 ? ' drill' : ' drills')));
      section.appendChild(head);
      if (cat.note) section.appendChild(el('p', 'cat-note', cat.note));

      var grid = el('ul', 'grid');
      grid.setAttribute('aria-label', cat.label + ' drills');
      games.forEach(function (g) { grid.appendChild(buildCard(g)); });
      section.appendChild(grid);
      catalogue.appendChild(section);

      if (jumpNav) {
        var a = document.createElement('a');
        a.href = '#cat-' + id;
        a.appendChild(document.createTextNode(cat.label));
        var n = el('span', 'n', String(live));
        a.appendChild(n);
        jumpNav.appendChild(a);
      }
    });
    if (jumpNav && jumpNav.children.length) jumpNav.hidden = false;
  }

  /* ---- today's warmup UI ---- */

  function renderToday() {
    if (!todayList) return;
    var picks = todayPick();
    var scores = dayScores(todayKey());
    var done = 0;
    todayList.textContent = '';
    picks.forEach(function (g) {
      var isDone = typeof scores[g.slug] === 'number';
      if (isDone) done++;
      var li = document.createElement('li');
      var btn = el('button', 'today-slot accent-' + g.accent + (isDone ? ' done' : ''));
      btn.type = 'button';
      var cat = CATS[g.cat] || { label: '' };
      btn.setAttribute('aria-label', g.name + ' — ' + cat.label +
        (isDone ? ' — done today, score ' + scores[g.slug] : ' — not done yet'));
      btn.appendChild(el('span', 'today-tick', isDone ? '✓' : '☐'));
      var ic = el('span', 'slot-icon', g.icon);
      ic.setAttribute('aria-hidden', 'true');
      btn.appendChild(ic);
      btn.appendChild(el('span', 'slot-name', g.name));
      btn.appendChild(skillChip((g.skills && g.skills[0]) || ''));
      btn.addEventListener('click', function () { openPlayer(g); });
      li.appendChild(btn);
      todayList.appendChild(li);
    });
    var all = picks.length > 0 && done === picks.length;
    if (todayDone) {
      todayDone.textContent = all
        ? done + '/' + picks.length + ' done · ★ perfect day'
        : done + '/' + picks.length + ' done · perfect day ★ when all three';
    }
    if (shareBtn) shareBtn.hidden = done < 1;
  }

  function renderStreak() {
    if (!streakChip) return;
    if (streakAlive()) {
      var f = store.streak.freezes;
      streakChip.textContent = '🔥 ' + store.streak.count + (store.streak.count === 1 ? ' day' : ' days') +
        (f > 0 ? '  ❄️' + f : '');
      streakChip.setAttribute('aria-label', store.streak.count + '-day streak' +
        (f > 0 ? ', ' + f + ' banked rest day' + (f > 1 ? 's' : '') : ''));
      streakChip.title = f > 0
        ? 'Miss a day and a banked rest day covers it.'
        : 'Practise 5 days to bank a rest day.';
      streakChip.hidden = false;
    } else {
      streakChip.hidden = true;
    }
  }

  /* ---- skill meters ---- */

  /* Quadratic level curve: level N starts at (N-1)² points, so the
     first levels come fast and later ones ask for real practice. */
  function levelInfo(points) {
    var p = Number(points) || 0;
    if (p < 0) p = 0;
    var base = Math.floor(Math.sqrt(p));
    var lo = base * base;
    var hi = (base + 1) * (base + 1);
    var pct = Math.round(((p - lo) / (hi - lo)) * 100);
    return { lv: base + 1, pct: Math.max(0, Math.min(100, pct)) };
  }

  /* ---- practice record ----
     "No accounts" should not mean "no memory". Everything here is
     already on disk in store.days; it just was never shown back. */

  function renderRecord() {
    var box = $('record');
    if (!box) return;
    var dayKeys = Object.keys(store.days).filter(function (k) {
      return Object.keys(dayScores(k)).length > 0;
    });
    if (!dayKeys.length) { box.hidden = true; return; }

    var rounds = totalRounds();
    var drills = distinctSlugs().length;
    var perfect = 0;
    dayKeys.forEach(function (k) {
      var picks = pickForSeed(Math.floor(new Date(k + 'T12:00:00').getTime() / 86400000));
      var sc = dayScores(k);
      if (picks.length && picks.every(function (g) { return typeof sc[g.slug] === 'number'; })) perfect++;
    });

    box.textContent = '';
    var stats = el('p', 'record-stats');
    [[dayKeys.length, dayKeys.length === 1 ? 'day practised' : 'days practised'],
     [rounds, rounds === 1 ? 'round' : 'rounds'],
     [drills, 'different drills'],
     [perfect, perfect === 1 ? 'full warmup' : 'full warmups']].forEach(function (p, i) {
      if (i) stats.appendChild(document.createTextNode(' · '));
      var b = el('b', '', String(p[0]));
      stats.appendChild(b);
      stats.appendChild(document.createTextNode(' ' + p[1]));
    });
    box.appendChild(stats);

    /* last 30 days as a dot strip — the shape of a habit, at a glance */
    var strip = el('div', 'record-strip');
    strip.setAttribute('aria-hidden', 'true');
    for (var i = 29; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var n = Object.keys(dayScores(dateKey(d))).length;
      var dot = el('i', 'rdot' + (n === 0 ? '' : n >= 3 ? ' r3' : ' r1'));
      dot.title = dateKey(d) + ' — ' + n + (n === 1 ? ' round' : ' rounds');
      strip.appendChild(dot);
    }
    box.appendChild(strip);
    box.appendChild(el('p', 'record-note', 'the last 30 days · filled = you practised'));
    box.hidden = false;
  }

  function renderMeters() {
    if (!meters) return;
    var ids = taggedSkillIds();
    var any = ids.some(function (id) { return (Number(store.skills[id]) || 0) > 0; });
    var empty = $('metersEmpty');
    if (empty) empty.hidden = any;
    meters.textContent = '';
    if (!any) { meters.hidden = true; return; }
    meters.hidden = false;
    ids.forEach(function (id, i) {
      var s = SKILLS[id] || { label: id, icon: '' };
      var info = levelInfo(store.skills[id]);
      var li = el('li', 'meter accent-' + ACCENTS[i % ACCENTS.length]);
      var ic = el('span', 'meter-icon', s.icon);
      ic.setAttribute('aria-hidden', 'true');
      li.appendChild(ic);
      li.appendChild(el('span', 'meter-name', s.label));
      var track = el('span', 'meter-track');
      track.setAttribute('aria-hidden', 'true');
      var fill = el('span', 'meter-fill');
      fill.style.setProperty('--w', info.pct + '%');
      track.appendChild(fill);
      li.appendChild(track);
      li.appendChild(el('span', 'meter-lv', 'lv ' + info.lv));
      meters.appendChild(li);
    });
  }

  /* ---- result recording ---- */

  function recordResult(g, score) {
    var tk = todayKey();
    if (!isPlainish(store.days[tk])) store.days[tk] = {};
    var day = store.days[tk];
    if (typeof day[g.slug] !== 'number' || score > day[g.slug]) day[g.slug] = score;

    function bump(id, pts) {
      if (!id) return;
      store.skills[id] = Math.round(((Number(store.skills[id]) || 0) + pts) * 100) / 100;
    }
    bump(g.skills && g.skills[0], score / 100);
    bump(g.skills && g.skills[1], score / 200);

    var streakNote = touchStreak();

    var picks = todayPick();
    var scores = dayScores(tk);
    var perfect = picks.length > 0 && picks.every(function (p) { return typeof scores[p.slug] === 'number'; });
    var earned = checkBadges(score, perfect);
    saveStore();

    renderToday();
    renderStreak();
    renderMeters();
    renderRecord();
    fillMeta(g);
    if (statusEl) {
      statusEl.textContent = 'recorded ✓ ' + score + '/100' +
        (perfect ? ' · ★ warmup complete' : '');
    }
    updateNextBtn();

    if (streakNote === 'freeze') toastPage('❄️ a banked rest day covered yesterday — your streak survived');
    else if (streakNote === 'earned') toastPage('❄️ rest day banked — miss a day and your streak still holds');
    earned.forEach(function (b, i) {
      setTimeout(function () { toastPage(b.icon + ' ' + b.name + ' — ' + b.hint); }, 600 * (i + 1));
    });
    if (perfect) renderClosing();
  }

  /* ---- session closure: the moment the day's warmup is complete ----
     A session needs an ending. This shows what you did, what tomorrow
     holds (the pick is deterministic, so it is knowable today), and —
     only after real delivered value, and only if a support account is
     actually configured — one quiet, dismissible ask. */

  function renderClosing() {
    var box = $('closing');
    if (!box) return;
    var scores = dayScores(todayKey());
    var picks = todayPick();
    box.textContent = '';

    box.appendChild(el('p', 'closing-head', 'that’s today’s warmup done ★'));

    var row = el('p', 'closing-scores');
    picks.forEach(function (g, i) {
      if (i) row.appendChild(document.createTextNode(' · '));
      var s = scores[g.slug];
      row.appendChild(document.createTextNode(g.icon + ' ' + (typeof s === 'number' ? s : '–')));
    });
    box.appendChild(row);

    var st = store.streak;
    var line = st.count > 1 ? '🔥 ' + st.count + ' days running' : '🔥 day one — come back tomorrow and it becomes a streak';
    if (st.freezes > 0) line += ' · ❄️ ' + st.freezes + ' rest day' + (st.freezes > 1 ? 's' : '') + ' banked';
    box.appendChild(el('p', 'closing-streak', line));

    var tom = tomorrowPick();
    if (tom.length) {
      var t = el('p', 'closing-tomorrow');
      t.appendChild(document.createTextNode('tomorrow: '));
      tom.forEach(function (g, i) {
        if (i) t.appendChild(document.createTextNode(' · '));
        t.appendChild(document.createTextNode(g.icon + ' ' + g.name));
      });
      box.appendChild(t);
    }

    var btns = el('p', 'closing-btns');
    var share = el('button', 'sharebtn', "copy today's card");
    share.type = 'button';
    share.addEventListener('click', function () { copyShare(share); });
    btns.appendChild(share);
    box.appendChild(btns);

    var ask = buildAsk();
    if (ask) box.appendChild(ask);

    box.hidden = false;
  }

  /* THE ONE ASK. Deliberately the newsletter, not money: it needs no
     payment rail, it is the higher-value ask for a habit product, and
     "hear when new drills land" is a reason to come back rather than a
     favour. Stage-0 — returns null unless a Buttondown name is set, so
     it can never be a broken form. Shown only after a full warmup on a
     3-day streak (real, repeated value), at most once, dismissible. */
  function buildAsk() {
    var S = window.SUPPORT || {};
    if (!S.buttondown) return null;
    if (store.seen.ask) return null;
    if (store.streak.count < 3) return null;

    var wrap = el('div', 'ask');
    wrap.appendChild(el('p', 'ask-head', 'three days running — want a note when new drills land?'));
    wrap.appendChild(el('p', 'ask-body',
      'Art Daily is free and stays free: no ads, no accounts, nothing tracked. ' +
      'New drills get added most months. One short email when they do — nothing else, unsubscribe anytime.'));

    var form = document.createElement('form');
    form.className = 'ask-form';
    form.action = 'https://buttondown.email/api/emails/embed-subscribe/' + S.buttondown;
    form.method = 'post';
    form.target = '_blank';
    var input = document.createElement('input');
    input.type = 'email';
    input.name = 'email';
    input.required = true;
    input.placeholder = 'you@example.com';
    input.setAttribute('aria-label', 'Email address');
    var send = el('button', 'ask-btn', 'keep me posted');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener('submit', function () {
      store.seen.ask = true;
      saveStore();
    });
    wrap.appendChild(form);

    var no = el('button', 'ask-no', 'no thanks');
    no.type = 'button';
    no.addEventListener('click', function () {
      store.seen.ask = true;
      saveStore();
      wrap.remove();
    });
    wrap.appendChild(no);
    return wrap;
  }

  /* ---- a small page-level toast for milestones ---- */

  var toastTimer = null;
  function toastPage(msg) {
    var box = $('pageToast');
    if (!box) return;
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 4200);
  }

  /* "next warmup →" in the player foot: closes the loop without
     forcing a trip back to the hero. */
  var nextBtn = $('playerNext');

  function nextUnfinished() {
    var scores = dayScores(todayKey());
    var picks = todayPick().filter(function (p) {
      return typeof scores[p.slug] !== 'number' && (!openGame || p.slug !== openGame.slug);
    });
    return picks.length ? picks[0] : null;
  }

  function updateNextBtn() {
    if (!nextBtn) return;
    var nxt = (player && player.open) ? nextUnfinished() : null;
    if (nxt) {
      nextBtn.textContent = 'next: ' + nxt.name + ' →';
      nextBtn.hidden = false;
    } else {
      nextBtn.hidden = true;
    }
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      var nxt = nextUnfinished();
      if (nxt) openPlayer(nxt);
    });
  }

  /* ---- player dialog ---- */

  var openGame = null;

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function postTheme() {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: 'artdaily:theme', theme: currentTheme() }, '*');
    } catch (e) {}
  }

  var openerSlug = null; /* focus returns to this game's card on close */

  function openPlayer(g) {
    var url = gameUrl(g);
    if (!player || typeof player.showModal !== 'function' || !frame) {
      location.href = url; /* no <dialog> support: just visit the game */
      return;
    }
    openGame = g;
    openerSlug = g.slug;
    if (titleEl) titleEl.textContent = g.icon + ' ' + g.name;
    if (openLink) openLink.href = url;
    frame.title = g.name;
    frame.src = url + '?embed=1&theme=' + currentTheme();
    if (statusEl) statusEl.textContent = 'waiting for a finished round…';
    if (!player.open) player.showModal();
    updateNextBtn();
    document.documentElement.style.overflow = 'hidden'; /* scroll lock */
  }

  function closePlayer() {
    openGame = null;
    if (frame) frame.src = 'about:blank'; /* stops the game's loop */
    document.documentElement.style.overflow = '';
    if (player && player.open) player.close();
    /* renderToday rebuilds the checklist buttons, so restore focus to
       the (possibly re-created) card for the game that was open. */
    if (openerSlug) {
      var back = document.querySelector('.card[data-slug="' + openerSlug + '"]');
      if (back && typeof back.focus === 'function') back.focus();
      openerSlug = null;
    }
  }

  /* Esc fallback: with focus on the dialog chrome the native cancel path
     fires, but this also catches Esc bubbling anywhere in the page. */
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && player && player.open) closePlayer();
  });

  if (closeBtn) closeBtn.addEventListener('click', closePlayer);
  if (player) {
    /* Esc arrives as native cancel→close; cleanup converges on 'close'
       so every exit path (button, Esc, backdrop) clears the iframe. */
    player.addEventListener('close', closePlayer);
    player.addEventListener('click', function (ev) {
      if (ev.target === player) closePlayer(); /* backdrop click */
    });
  }

  /* Only trust messages from the iframe we opened, for the game we
     opened, speaking protocol v1. */
  window.addEventListener('message', function (ev) {
    if (!player || !player.open || !openGame) return;
    if (!frame || ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.version !== 1 || d.slug !== openGame.slug) return;
    if (d.type === 'artdaily:ready') { postTheme(); return; }
    if (d.type !== 'artdaily:result') return;
    var score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
    recordResult(openGame, score);
  });

  /* Theme relay: follow the page toggle into the open game. */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      if (player && player.open) postTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ---- share card ---- */

  function shareText() {
    var tk = todayKey();
    var picks = todayPick();
    var scores = dayScores(tk);
    var line = picks.map(function (g) {
      /* Slot format: icon, primary-skill label, score (or ▢). */
      var sk = SKILLS[(g.skills && g.skills[0]) || ''] || {};
      var s = scores[g.slug];
      return g.icon + ' ' + (sk.label || g.slug) + ' ' + (typeof s === 'number' ? s : '▢');
    }).join(' · ');
    var all = picks.length > 0 && picks.every(function (g) {
      return typeof scores[g.slug] === 'number';
    });
    var n = streakAlive() ? store.streak.count : 0;
    return 'Art Daily — ' + tk + '\n' + line + '\n🔥 streak ' + n +
      (all ? ' · ★ perfect day' : '') + '\n' + HOME;
  }

  var shareTimer = null;

  /* Shared by the hero button and the closing card's copy. */
  function copyShare(btn) {
    var text = shareText();
    function confirmCopy() {
      btn.textContent = 'copied ✓';
      btn.classList.add('copied');
      if (shareTimer) clearTimeout(shareTimer);
      shareTimer = setTimeout(function () {
        btn.textContent = SHARE_LABEL;
        btn.classList.remove('copied');
      }, 1500);
    }
    function fallback() {
      try { window.prompt("copy today's card:", text); } catch (e) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(confirmCopy, fallback);
    } else {
      fallback();
    }
  }

  if (shareBtn) shareBtn.addEventListener('click', function () { copyShare(shareBtn); });

  /* ---- reset ---- */

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('reset all local progress? streak, ticks and skill levels will be wiped.')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      store = freshStore();
      renderToday();
      renderStreak();
      renderMeters();
      renderRecord();
      liveGames.forEach(fillMeta);
      if (statusEl) statusEl.textContent = '';
    });
  }

  /* ---- boot ---- */

  renderCatalogue();
  renderToday();
  renderStreak();
  renderMeters();
  renderRecord();

  /* Day rollover: a tab left open overnight re-renders the checklist
     and streak for the new day when it next becomes visible. */
  var renderedDay = todayKey();
  function maybeRollover() {
    if (todayKey() === renderedDay) return;
    renderedDay = todayKey();
    renderToday();
    renderStreak();
    liveGames.forEach(fillMeta);
  }
  document.addEventListener('visibilitychange', maybeRollover);
  window.addEventListener('focus', maybeRollover);
})();
