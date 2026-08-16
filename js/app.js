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
  var STREAK_NOTES = {
    freeze: '❄️ a banked rest day covered yesterday — your streak survived',
    earned: '❄️ rest day banked — miss a day and your streak still holds',
    both:   '❄️ a banked rest day covered yesterday — and you banked another',
  };

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

  /* Counters need their RANGE checked, not just their type. A streak count
     that arrives negative (a half-written store, an older writer, a hand
     edit) type-checks as a number and then survives every guard: the chip
     stays hidden and the streak badges stay locked while the player
     practises daily, one silent day per day, until it climbs back past 0. */
  function whole(n, max) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0) n = 0;
    return (max != null && n > max) ? max : n;
  }

  /* The one shape a day key ever has — dateKey() writes it, seedForKey()
     takes it back apart. Declared up here because loadStore runs at boot,
     long before the warmup section that also uses it. */
  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    if (!isPlainish(s)) s = {};
    if (!isPlainish(s.days)) s.days = {};
    /* A day holds finished rounds, and a finished round is a whole number
       out of 100 — recordResult clamps every score it writes. Anything else
       in there is corruption (a hand edit, a half-written store, an older
       writer), and it does not sit quietly: a value of Infinity read back
       out as "best Infinity/100" under a card and "done · Infinity/100" on
       the checklist, and a negative one as "best -4/100". Clean it at the
       door, once per load, instead of asking a dozen readers to guard. */
    Object.keys(s.days).forEach(function (k) {
      var d = s.days[k];
      /* A key that is not a day key is not a day. Nothing can ever reach one
         again — dayScores only ever asks for a dateKey(), and seedForKey
         rejects it so it can never be picked for or replayed — but it still
         got counted: renderRecord's headline is Object.keys(store.days), so
         one junk key read as an extra "day practised", its scores as extra
         drills done, and its slugs as extra "different drills". Drop it at
         the door with the junk values below. */
      if (!DAY_RE.test(k)) { delete s.days[k]; return; }
      if (!isPlainish(d)) { s.days[k] = {}; return; }
      Object.keys(d).forEach(function (slug) {
        var v = d[slug];
        if (typeof v !== 'number' || !isFinite(v)) { delete d[slug]; return; }
        d[slug] = Math.max(0, Math.min(100, Math.round(v)));
      });
    });
    if (!isPlainish(s.streak)) s.streak = {};
    if (typeof s.streak.last !== 'string') s.streak.last = '';
    s.streak.count = whole(s.streak.count);
    s.streak.freezes = whole(s.streak.freezes, 2);  /* 2 = the cap touchStreak banks to */
    if (!isPlainish(s.skills)) s.skills = {};
    if (!isPlainish(s.badges)) s.badges = {};   /* badgeId -> day earned */
    if (!isPlainish(s.seen)) s.seen = {};       /* one-time UI flags */
    return s;
  }

  var store = loadStore();

  /* ---- derived-state caches ----
     bestFor and pickForKey are pure functions of store.days, and both were
     recomputed from scratch on every render. fillMeta asks bestFor once per
     drill (one full walk of every logged day PER DRILL in the registry, 38
     of them today and one more with every drill shipped); renderRecord asks picksForKey
     once per LOGGED DAY, and each of those ranks the whole catalogue with a
     hash per comparison. Measured on a one-year store that is ~1.25 MILLION
     hash rounds for a single recorded score — tens of milliseconds of blocked
     main thread at the exact moment the player is waiting to see their number,
     and it grows with every day they practise. Both caches are dropped whole
     the moment anything writes to the store, so a stale one cannot outlive a
     round. */
  var bestCache = null;
  var pickCache = Object.create(null);

  function invalidateDerived() { bestCache = null; pickCache = Object.create(null); }

  /* Every path that swaps the whole store in goes through here, so no caller
     has to remember that the caches exist. In-place writes call
     invalidateDerived() directly. */
  function setStore(s) { store = s; invalidateDerived(); return store; }

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

  /* slug -> highest score ever recorded for it. One walk of the store
     answers every drill, instead of one walk per drill. */
  function bestIndex() {
    if (bestCache) return bestCache;
    var m = Object.create(null);
    Object.keys(store.days).forEach(function (k) {
      var d = dayScores(k);
      Object.keys(d).forEach(function (s) {
        var v = d[s];
        if (typeof v === 'number' && (m[s] === undefined || v > m[s])) m[s] = v;
      });
    });
    bestCache = m;
    return m;
  }

  function bestFor(slug) {
    var v = bestIndex()[slug];
    return v === undefined ? null : v;
  }

  /* The page's whole promise about scoring is on the legend line: "you are
     only ever compared with your own past rounds". It was never kept — a
     finished round said "recorded ✓ 62/100" and stopped, so a number that
     was 19 below the player's own best and a number that beat it read
     identically. Worse, a day keeps only its HIGHEST score (see
     recordResult), so a second, weaker go announced "recorded ✓ 62" while
     the checklist behind the dialog still said 81 and nothing explained
     the contradiction.

     PURE: (score, todayPrev, prevBest) -> the delta in words. todayPrev is
     what today already holds for this drill (null if this is the first go
     today); prevBest is the all-time best BEFORE this round (null if the
     drill has never been played). Both are read before the write. */
  function deltaNote(score, todayPrev, prevBest) {
    function num(v) { return typeof v === 'number' && isFinite(v); }
    /* Every number that reaches the sentence goes through r(): scores
       arrive rounded, but a hand-edited or half-written store can hold a
       float, and "13 under your best of 71.2" is not a sentence anyone
       should read on a page that promises whole numbers out of 100. */
    function r(v) { return Math.round(v); }
    if (!num(score)) return '';
    if (num(todayPrev)) {
      var d = r(score) - r(todayPrev);
      if (d > 0) {
        return (num(prevBest) && r(score) > r(prevBest))
          ? 'new best · +' + d + ' on your last go'
          : '+' + d + ' on your last go today';
      }
      if (d === 0) return 'same as your last go today';
      /* Say what the record actually kept, or the checklist behind the
         dialog looks like it is lying. */
      return (-d) + ' under your last go · today keeps the ' + r(todayPrev);
    }
    if (!num(prevBest)) return 'first go at this drill — this is the mark to beat';
    if (r(score) > r(prevBest)) return 'new best · +' + (r(score) - r(prevBest)) + ' on your old ' + r(prevBest);
    if (r(score) === r(prevBest)) return 'matched your best of ' + r(prevBest);
    return (r(prevBest) - r(score)) + ' under your best of ' + r(prevBest);
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
      /* Spending a freeze and banking one can land on the same day
         (count 4 → miss a day → play → 5). Say both, or the player is
         handed a rest day nobody ever mentions. */
      note = (note === 'freeze') ? 'both' : 'earned';
    }
    return note;
  }

  /* ---- today's warmup: deterministic 3-game spread ---- */

  /* ONE seed function, keyed by a local day key, for every caller —
     today's pick, tomorrow's preview and the practice record. Deriving
     it twice (once from local midnight, once from local noon) put the
     record a whole day out of step everywhere east of Greenwich.
     (DAY_RE is declared up by loadStore, which needs it at boot.) */

  function seedForKey(k) {
    var p = DAY_RE.exec(String(k));
    if (!p) return null;
    return Math.floor(new Date(+p[1], +p[2] - 1, +p[3]).getTime() / 86400000);
  }

  function keyForOffset(n) { var d = new Date(); d.setDate(d.getDate() + (n || 0)); return dateKey(d); }

  function slugHash(seed, slug) {
    var h = seed ^ 0x9e3779b9;
    for (var i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 2654435761);
    return h >>> 0;
  }

  /* Rank live games by hash, take distinct categories first so the
     warmup never doubles up a chapter; top back up if needed.
     Pure function of the day number, so tomorrow's plan can be shown today
     and the record can replay what any past day asked for.
     NOT globally aligned, despite what this comment used to claim: the seed
     comes from LOCAL midnight, so on the same calendar date a player east
     of Greenwich gets seed N-1 and one west of it gets seed N — two valid,
     self-consistent rotations, one day apart. Fixing that would rewrite
     which drills every past day asked for, and with it the "full warmups"
     count in the practice record, so it is a migration, not a tweak. */
  function pickForKey(key) {
    var seed = seedForKey(key);
    if (seed === null) return [];
    /* Same day key + same store = same three drills, so rank once. Callers
       ask constantly: renderToday, todayComplete, nextUnfinished, shareText
       and renderClosing all want today's triple for a single recorded score,
       and renderRecord replays one key per logged day. */
    var cached = pickCache[key];
    if (cached) return cached;
    var p = DAY_RE.exec(String(key));
    /* Rank by hash, but bias against drills done in the last few days so
       a daily habit stays varied, and against chapters with few drills —
       picking one per distinct chapter made composition's 2 drills show
       as often as line's 9. */
    var recent = {};
    for (var i = 1; i <= 6; i++) {
      /* Walk CALENDAR days back from the picked day. Stepping in
         milliseconds from seed*86400000 walks back from a UTC instant,
         which east of Greenwich skipped yesterday entirely — the one day
         this bias exists to protect against. */
      var k = dateKey(new Date(+p[1], +p[2] - 1, +p[3] - i));
      Object.keys(dayScores(k)).forEach(function (s) { recent[s] = Math.max(recent[s] || 0, 7 - i); });
    }
    var perCat = {};
    liveGames.forEach(function (g) { perCat[g.cat] = (perCat[g.cat] || 0) + 1; });

    /* Weigh each drill ONCE. The comparator used to hash both sides on every
       comparison, so ranking the whole catalogue cost ~n·log n hashes instead of n —
       about ten times the work, repeated for every day in the record. Sort is
       stable and the weights are identical, so the order is unchanged. */
    var weighed = liveGames.map(function (g) {
      return { g: g, w: slugHash(seed, g.slug) / 4294967295 +
        (perCat[g.cat] || 1) * 0.06 - (recent[g.slug] || 0) * 0.25 };
    });
    weighed.sort(function (a, b) { return b.w - a.w; });
    var ranked = weighed.map(function (x) { return x.g; });
    var picked = [];
    var seen = {};
    ranked.forEach(function (g) {
      var cat = g.cat || '';
      if (picked.length < 3 && !seen[cat]) { seen[cat] = true; picked.push(g); }
    });
    ranked.forEach(function (g) {
      if (picked.length < 3 && picked.indexOf(g) === -1) picked.push(g);
    });
    pickCache[key] = picked;
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

  /* Which three drills a given day asked for. The starter session is a
     property of the DAY it was served (store.seen.starter), not of "is
     the store empty right this second" — otherwise the newcomer's first
     result flips their curated checklist to three strangers, and the
     record later judges that day against a triple it never showed. */
  function picksForKey(k) {
    if (store.seen.starter === k) {
      var s = starterPick();
      if (s) return s;
    }
    return pickForKey(k);
  }

  function todayPick() {
    if (isNewcomer()) {
      var s = starterPick();
      if (s) return s;
    }
    return picksForKey(todayKey());
  }
  function tomorrowPick() { return pickForKey(keyForOffset(1)); }

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

  /* How many drills have been finished across every day — NOT how many
     rounds were played, which this store cannot answer and never could: a
     day keeps only the HIGHEST score per drill (see recordResult), so five
     goes at Value Trap on one day leave exactly one number behind. It was
     labelled "rounds" in the practice record, which read back a smaller
     count than the player had actually done and got smaller the more they
     replayed. The name says what it counts now, so the label can too. */
  function drillsLogged() {
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
    var minutes = 0;
    todayList.textContent = '';
    picks.forEach(function (g) {
      var isDone = typeof scores[g.slug] === 'number';
      if (isDone) done++;
      minutes += Number(g.minutes) || 0;
      var li = document.createElement('li');
      var btn = el('button', 'today-slot accent-' + g.accent + (isDone ? ' done' : ''));
      btn.type = 'button';
      /* Second line: the drill's own instruction before you play it,
         your score after. A name and a skill chip alone ("Value Trap ·
         values") tell a first-timer nothing about what their hand is
         about to do — and once played, the day's score was invisible
         here until the closing card appeared.
         The score alone is still half a sentence: 78/100 means nothing
         without the only yardstick this page has, the player's own best.
         The player-foot status names it too, but that line dies with the
         dialog — this one stays on the page all day. */
      var what;
      if (isDone) {
        var sc = scores[g.slug];
        var bst = bestFor(g.slug);
        what = 'done · ' + sc + '/100 · ' +
          (typeof bst === 'number' && bst > sc ? 'your best ' + bst : 'your best yet');
      } else {
        what = g.tagline || '';
      }
      btn.setAttribute('aria-label', g.name + (what ? ' — ' + what : '') +
        (isDone ? '' : ' — not done yet'));
      btn.appendChild(el('span', 'today-tick', isDone ? '✓' : '☐'));
      var ic = el('span', 'slot-icon', g.icon);
      ic.setAttribute('aria-hidden', 'true');
      btn.appendChild(ic);
      var body = el('span', 'slot-body');
      body.appendChild(el('span', 'slot-name', g.name));
      if (what) body.appendChild(el('span', 'slot-what', what));
      btn.appendChild(body);
      btn.appendChild(skillChip((g.skills && g.skills[0]) || ''));
      /* Tagged so closePlayer can hand focus back to THIS control rather
         than to the catalogue card for the same drill (see closePlayer). */
      btn.setAttribute('data-slug', g.slug);
      btn.addEventListener('click', function () { openPlayer(g, 'today'); });
      li.appendChild(btn);
      todayList.appendChild(li);
    });
    var all = picks.length > 0 && done === picks.length;
    if (todayDone) {
      /* "0/3 done · perfect day ★ when all three" is a scoreboard, and a
         scoreboard means nothing to someone who has not played yet. On a
         cold first visit say the price and the verb instead. */
      todayDone.textContent = (isNewcomer() && picks.length)
        ? 'your first three · about ' + minutes + ' min in total · pick one to start'
        : all
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
    var p = Number(points);
    /* A non-finite total (a store holding 1e999 parses straight to
       Infinity) made lo and hi both Infinity, so pct came out NaN and the
       meter rendered "lv Infinity" with a `--w: NaN%` fill. The cap also
       keeps (base+1)² exact, which is what stops hi - lo from collapsing
       to 0 and dividing by zero. */
    if (!isFinite(p) || p < 0) p = 0;
    if (p > 1e9) p = 1e9;
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

    var logged = drillsLogged();
    var drills = distinctSlugs().length;
    var perfect = 0;
    dayKeys.forEach(function (k) {
      var picks = picksForKey(k);
      var sc = dayScores(k);
      if (picks.length && picks.every(function (g) { return typeof sc[g.slug] === 'number'; })) perfect++;
    });

    box.textContent = '';
    var stats = el('p', 'record-stats');
    /* Every count in this line owes a singular — on day one the record read
       "1 day practised · 1 round · 1 different drills · 0 full warmups", and
       the one broken plural was the one every player sees first. */
    [[dayKeys.length, dayKeys.length === 1 ? 'day practised' : 'days practised'],
     [logged, logged === 1 ? 'drill done' : 'drills done'],
     [drills, drills === 1 ? 'different drill' : 'different drills'],
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
      /* "rounds" is the one thing this number is NOT — a day keeps only the
         highest score per drill, so five goes at Value Trap leave one key
         behind. The headline stat was renamed to "drills done" for exactly
         that reason (see drillsLogged); the dot titles were left behind
         still promising a round count the store cannot answer. */
      dot.title = dateKey(d) + ' — ' + n + (n === 1 ? ' drill' : ' drills');
      strip.appendChild(dot);
    }
    box.appendChild(strip);
    box.appendChild(el('p', 'record-note', 'the last 30 days · filled = you practised'));

    /* What ❄️ means, in text a finger can reach. The rest-day rule used to
       live in the streak chip's title= and in a 4-second toast on the day
       it was earned: a title never opens on a touchscreen, so the one
       device where a player is most likely to miss a day was also the one
       where nothing ever explained the thing that saves their streak. */
    if (streakAlive()) {
      var st = store.streak;
      box.appendChild(el('p', 'record-note',
        '🔥 ' + st.count + '-day streak' +
        (st.freezes > 0
          ? ' · ❄️ ' + st.freezes + ' rest ' + (st.freezes === 1 ? 'day' : 'days') + ' banked'
          : '') +
        ' — every 5th day banks a rest day (❄️), and one missed day spends a banked rest day instead of resetting the count'));
    }
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
      /* The tube itself was aria-hidden, so the entire section — the one
         place the page shows long-run progress — read as "colour lv 3" and
         nothing else: how full the tube is, which is the whole metaphor,
         was visual-only. A progressbar with a real value says it out loud.
         levelInfo clamps pct to 0-100 and lv to a finite integer for any
         stored total (negative, NaN, Infinity), so the label can never
         become "NaN% to level NaN". */
      var track = el('span', 'meter-track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(info.pct));
      track.setAttribute('aria-label',
        'level ' + info.lv + ' — ' + info.pct + '% of the way to level ' + (info.lv + 1));
      var fill = el('span', 'meter-fill');
      fill.style.setProperty('--w', info.pct + '%');
      track.appendChild(fill);
      li.appendChild(track);
      /* "lv 3" is the same fact the progressbar just gave its name; keep it
         on screen, keep it out of the announcement. */
      var lv = el('span', 'meter-lv', 'lv ' + info.lv);
      lv.setAttribute('aria-hidden', 'true');
      li.appendChild(lv);
      meters.appendChild(li);
    });
  }

  /* ---- result recording ---- */

  /* `lead` (optional) is how the CALLER wants this round announced on the
     page toast — the paths with no player foot to write into. It is built
     here, not by the caller, because it needs the delta sentence, and it is
     queued BEFORE any milestone: the answer to what you just did comes
     first, the congratulations follow. */
  function recordResult(g, score, lead) {
    /* Re-read before touching anything: a second tab (or this tab after
       an overnight sleep) may have logged rounds since `store` was last
       loaded, and writing our own snapshot back would erase them. Every
       mutation in this file is read-modify-write for the same reason. */
    setStore(loadStore());
    var tk = todayKey();
    var firstEver = drillsLogged() === 0;  /* asked BEFORE this round lands */
    /* Both read BEFORE the write, or the comparison is against this very
       round and every score is trivially "your best". */
    var prevBest = bestFor(g.slug);
    var todayPrev = dayScores(tk)[g.slug];
    if (typeof todayPrev !== 'number') todayPrev = null;
    /* Pin the curated first session to this day BEFORE the first score
       lands, so finishing a drill cannot swap the checklist out. */
    if (isNewcomer() && starterPick()) store.seen.starter = tk;
    if (!isPlainish(store.days[tk])) store.days[tk] = {};
    var day = store.days[tk];
    if (typeof day[g.slug] !== 'number' || score > day[g.slug]) day[g.slug] = score;
    /* the day just changed under the caches — every read below must be new */
    invalidateDerived();

    function bump(id, pts) {
      if (!id) return;
      store.skills[id] = Math.round(((Number(store.skills[id]) || 0) + pts) * 100) / 100;
    }
    bump(g.skills && g.skills[0], score / 100);
    bump(g.skills && g.skills[1], score / 200);

    var streakNote = touchStreak();

    var perfect = todayComplete();
    var earned = checkBadges(score, perfect);
    saveStore();

    /* The very first score anyone sees here is a bare number out of 100,
       which reads like a grade on a test. Say what it actually is the one
       time it matters; after that, name the delta against their own past. */
    var note = firstEver
      ? 'your very first round · only your best on a drill sticks, so go again'
      : deltaNote(score, todayPrev, prevBest);

    renderToday();
    renderStreak();
    renderMeters();
    renderRecord();
    fillMeta(g);
    if (statusEl) {
      statusEl.textContent = 'recorded ✓ ' + score + '/100' +
        (note ? ' — ' + note : '') +
        (perfect ? ' · ★ warmup complete' : '');
      statusEl.classList.toggle('is-best', note.indexOf('new best') === 0);
    }
    updateNextBtn();

    /* Just hand these to the queue — it paces them (see toastPage). They
       used to be fired on a 600ms ladder while each toast asked for 4200ms
       of reading time, so a streak note plus two badges was three sentences
       that each got 600ms on screen and clobbered one another mid-word. */
    if (typeof lead === 'function') toastPage(lead(score, note));
    if (STREAK_NOTES[streakNote]) toastPage(STREAK_NOTES[streakNote]);
    earned.forEach(function (b) { toastPage(b.icon + ' ' + b.name + ' — ' + b.hint); });
    if (perfect) renderClosing();
  }

  /* Is today's warmup finished right now? ONE definition — the result
     path, the cross-tab path and the closing card all ask this, and a
     second copy of the rule is a second chance to disagree with it. */
  function todayComplete() {
    var picks = todayPick(), sc = dayScores(todayKey());
    return picks.length > 0 && picks.every(function (g) { return typeof sc[g.slug] === 'number'; });
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

    /* "🪤 82 · 🎨 91 · ✏️ 70" is a cipher: three numbers with no way to
       tell which drill earned which, and to a screen reader it is three
       emoji names and three integers. Say the drill, and say whether the
       number was a personal best — that is the whole review of the day.
       The names fixed half of that; the emoji were still in the text node,
       so the day's review still opened with "mouse trap". They are
       decoration sitting next to the name they decorate — hide them. */
    var row = el('p', 'closing-scores');
    picks.forEach(function (g, i) {
      if (i) row.appendChild(document.createTextNode(' · '));
      var s = scores[g.slug];
      var part = el('span', 'closing-score');
      var sIcon = el('span', '', g.icon);
      sIcon.setAttribute('aria-hidden', 'true');
      part.appendChild(sIcon);
      part.appendChild(document.createTextNode(
        ' ' + g.name + ' ' + (typeof s === 'number' ? s : '–')));
      if (typeof s === 'number' && s === bestFor(g.slug)) {
        part.appendChild(el('span', 'closing-pb', ' best ★'));
      }
      row.appendChild(part);
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
        var tmIcon = el('span', '', g.icon);
        tmIcon.setAttribute('aria-hidden', 'true');
        t.appendChild(tmIcon);
        t.appendChild(document.createTextNode(' ' + g.name));
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
  /* read-modify-write, like every other mutation here */
  function markAskSeen() {
    setStore(loadStore());
    store.seen.ask = true;
    saveStore();
  }

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
    form.addEventListener('submit', function () { markAskSeen(); });
    wrap.appendChild(form);

    var no = el('button', 'ask-no', 'no thanks');
    no.type = 'button';
    no.addEventListener('click', function () {
      markAskSeen();
      wrap.remove();
    });
    wrap.appendChild(no);
    return wrap;
  }

  /* ---- a small page-level toast for milestones ---- */

  /* ONE queue, ONE timer. Three separate schedulers used to write into this
     one box — a 4200ms auto-hide, a 600ms milestone ladder in recordResult
     and a 2200ms flush ladder — so whichever fired last simply overwrote
     whatever was on screen. Finish your first day and "🌱 first drill" was
     replaced 600ms later by "★ perfect day", which was replaced again: three
     congratulations, none of them readable, and (the box is aria-live) three
     announcements cutting each other off. Now a message is queued, shown for
     its full dwell, blanked for a beat so the next one registers as new, and
     only then replaced. */
  var TOAST_DWELL = 3800;   /* time one message stays up */
  var TOAST_GAP = 240;      /* blank beat between two messages */
  var TOAST_MAX = 6;        /* a burst is a handful of milestones, never more */
  var toastTimer = null;
  var toastQueue = [];
  var toastBusy = false;

  /* Wiping progress must also wipe the congratulations already in flight —
     otherwise "🌱 first drill — you started" lands half a second after the
     player deleted the drill it is talking about. */
  function clearToasts() {
    toastQueue.length = 0;
    toastBusy = false;
    clearTimeout(toastTimer);
    toastTimer = null;
    var box = $('pageToast');
    if (box) box.textContent = '';
  }

  function pumpToasts() {
    if (toastBusy) return;
    /* A showModal()'d <dialog> is promoted to the browser's top layer,
       which paints above every z-index in the page — a toast shown now
       would sit under the dialog's backdrop and auto-hide long before
       the player closes it. Hold milestones until the dialog is gone. */
    if (player && player.open) return;
    var box = $('pageToast');
    if (!box) { toastQueue.length = 0; return; }
    if (!toastQueue.length) { box.textContent = ''; return; }
    var msg = toastQueue.shift();
    toastBusy = true;
    /* Text only — never `hidden`. The box is a permanent role="status"
       region; hiding it between messages took it out of the accessibility
       tree, so every milestone was written into a region that did not exist
       and then revealed, which AT may treat as a new region rather than an
       announcement. Emptying it leaves the region in place (and paints
       nothing, via .page-toast:empty). */
    box.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.textContent = '';
      toastBusy = false;
      toastTimer = setTimeout(pumpToasts, TOAST_GAP);
    }, TOAST_DWELL);
  }

  function toastPage(msg) {
    if (!msg) return;
    toastQueue.push(msg);
    if (toastQueue.length > TOAST_MAX) toastQueue.splice(0, toastQueue.length - TOAST_MAX);
    pumpToasts();
  }

  function flushToasts() { pumpToasts(); }

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
    if (!(player && player.open)) { nextBtn.hidden = true; return; }
    var nxt = nextUnfinished();
    if (nxt) {
      nextBtn.textContent = 'next: ' + nxt.name + ' →';
      nextBtn.setAttribute('data-act', 'next');
      nextBtn.hidden = false;
      return;
    }
    /* Finishing the third drill printed "★ warmup complete" in the foot and
       then offered nothing: the closing card — the day's three scores,
       tomorrow's pick, the share button — renders in the hero, behind the
       modal. Close from a catalogue card and focus goes back to that card
       halfway down the page, so the summary was never seen at all. */
    if (todayComplete()) {
      nextBtn.textContent = "see today's card →";
      nextBtn.setAttribute('data-act', 'card');
      nextBtn.hidden = false;
      return;
    }
    nextBtn.hidden = true;
  }

  /* Close the dialog and land on the day's summary — focus included, since
     the scroll that focus() causes is half the point and the other half is
     that a screen reader arrives at the scores instead of the catalogue. */
  function showClosing() {
    closePlayer();
    var c = $('closing');
    if (!c || c.hidden) return;
    c.setAttribute('tabindex', '-1');
    /* focus() scrolls the element into view by itself, and scrollIntoView
       then scrolls to a different spot — two jumps for one press, which
       reads as the page arguing with you. Suppress the first where the
       option is supported and let the deliberate one land. */
    if (typeof c.focus === 'function') {
      try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); }
    }
    if (typeof c.scrollIntoView === 'function') c.scrollIntoView({ block: 'center' });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      if (nextBtn.getAttribute('data-act') === 'card') { showClosing(); return; }
      var nxt = nextUnfinished();
      if (nxt) openPlayer(nxt, 'today');  /* always a checklist drill */
    });
  }

  /* ---- player dialog ---- */

  var openGame = null;

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  /* The theme button is an icon with no text, and its only state cue is
     WHICH icon is showing — which is exactly the cue a screen reader user
     does not get (both <svg>s are aria-hidden, and only CSS decides which
     one is displayed). "Toggle light or dark theme" is true in both states
     and therefore useless in either: it never says where you are or where
     pressing it goes. Name the destination instead, and keep it in step
     with the theme via the observer that is already watching data-theme.
     (main.js owns the click; it is a vendored network file and stays
     untouched.) */
  var themeBtn = $('themeToggle');
  function syncThemeLabel() {
    if (!themeBtn) return;
    var next = currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', next);
    themeBtn.title = next;
  }

  function postTheme() {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: 'artdaily:theme', theme: currentTheme() }, '*');
    } catch (e) {}
  }

  /* Focus returns to the control that OPENED the player — which is not
     always the catalogue card. Restoring focus always scrolls that element
     into view, so sending a player who started from the hero checklist
     back to a card halfway down the catalogue threw away their place on
     the page every time they closed a drill. */
  var openerSlug = null;
  var openerFrom = 'card';  /* 'today' = the hero checklist · 'card' = catalogue */

  /* Is the iframe currently pointed at a drill? dialog.close() fires its
     'close' event asynchronously and that lands back in closePlayer, so
     without this the frame was navigated to about:blank twice per exit —
     a whole extra document teardown during the one frame the player is
     watching the dialog disappear. */
  var frameLoaded = false;
  /* The waiting line has two states and they are not the same promise:
     the drill is still arriving, versus the drill is up and listening. */
  var playerReady = false;
  var gotResult = false;

  /* A drill on a phone can take a second or two to arrive, and until it
     does the player is looking at an empty rectangle under the words
     "finish a round and your score lands here" — which reads as a page
     that swallowed the tap. Say "opening" until the drill checks in. */
  function markPlayerReady() {
    if (playerReady || gotResult || !openGame) return;
    playerReady = true;
    if (statusEl) statusEl.textContent = 'finish a round and your score lands here';
  }

  /* Fallback for a drill whose SDK never posts artdaily:ready — the iframe
     load event always fires. Ignored for the about:blank teardown. */
  if (frame) frame.addEventListener('load', function () { if (frameLoaded) markPlayerReady(); });

  function openPlayer(g, from) {
    var url = gameUrl(g);
    if (!player || typeof player.showModal !== 'function' || !frame) {
      location.href = url; /* no <dialog> support: just visit the game */
      return;
    }
    openGame = g;
    openerSlug = g.slug;
    openerFrom = (from === 'today') ? 'today' : 'card';
    if (titleEl) {
      /* The icon is decoration that a screen reader reads out loud as its
         CLDR name — "artist palette Color Mixer". Split it out and hide it
         so the bar announces the drill, not the emoji. */
      titleEl.textContent = '';
      var tIcon = el('span', '', g.icon);
      tIcon.setAttribute('aria-hidden', 'true');
      titleEl.appendChild(tIcon);
      titleEl.appendChild(document.createTextNode(' ' + g.name));
    }
    /* The dialog's own name, which is what a screen reader reads the moment
       focus lands on it below. "Game player" is true of every drill and
       therefore tells you nothing about the one that just opened. */
    player.setAttribute('aria-label', g.name + ' — drill player');
    if (openLink) openLink.href = url;
    frame.title = g.name;
    playerReady = false;
    gotResult = false;
    frame.src = url + '?embed=1&theme=' + currentTheme();
    frameLoaded = true;
    if (statusEl) {
      statusEl.textContent = 'opening ' + g.name + '…';
      /* the previous drill's new-best colour must not tint this drill's
         "waiting" line */
      statusEl.classList.remove('is-best');
    }
    if (!player.open) player.showModal();
    /* Put focus on the dialog itself, every open — including the "next
       warmup →" case where the dialog is ALREADY open and only the drill
       changed, which used to leave focus sitting on a button whose label
       had silently become a different drill (or which updateNextBtn was
       about to hide out from under it).
       Left to itself, showModal() gives the first tab stop to "open full
       page ↗": the first thing a keyboard player could press was a link out
       to a new tab, and the announcement was a bare link with no clue which
       drill had opened. The dialog carries the per-drill aria-label set
       above, so landing here says "Steady Lines — drill player, dialog" and
       Tab still walks link → ✕ → the game → next. */
    if (typeof player.focus === 'function') {
      try { player.focus({ preventScroll: true }); } catch (e) { player.focus(); }
    }
    updateNextBtn();
    document.documentElement.style.overflow = 'hidden'; /* scroll lock */
  }

  function closePlayer() {
    openGame = null;
    if (frame && frameLoaded) {
      frameLoaded = false;
      frame.src = 'about:blank'; /* stops the game's loop */
    }
    document.documentElement.style.overflow = '';
    if (player && player.open) player.close();
    /* renderToday rebuilds the checklist buttons, so look the control up
       by slug rather than holding a node that no longer exists. */
    if (openerSlug) {
      var sel = '[data-slug="' + openerSlug + '"]';
      var back = (openerFrom === 'today' && document.querySelector('.today-slot' + sel)) ||
        document.querySelector('.card' + sel);
      if (back && typeof back.focus === 'function') back.focus();
      openerSlug = null;
    }
    flushToasts(); /* milestones earned inside the dialog, now visible */
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

  /* Where a drill legitimately lives, for validating a message that did
     not come from our own iframe. */
  function originOf(url) {
    try { return new URL(url, location.href).origin; } catch (e) { return null; }
  }

  function gameBySlug(slug) {
    return liveGames.filter(function (g) { return g.slug === slug; })[0] || null;
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.version !== 1) return;

    /* (a) the drill embedded in our own player */
    if (player && player.open && openGame && frame && ev.source === frame.contentWindow) {
      if (d.slug !== openGame.slug) return;
      if (d.type === 'artdaily:ready') { postTheme(); markPlayerReady(); return; }
      if (d.type !== 'artdaily:result') return;
      gotResult = true;   /* a late load event must not overwrite the score */
      recordResult(openGame, Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))));
      return;
    }

    /* (b) a drill playing in its own tab that we opened — its
       window.opener is us. Trust it only if the message's origin is
       where that drill is actually published. */
    if (d.type !== 'artdaily:result') return;
    var g = gameBySlug(d.slug);
    if (!g || originOf(g.url) !== ev.origin) return;
    var s = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
    /* The status line lives in the player foot, which is not on screen for
       a drill played in its own tab — so the delta has to ride the toast. */
    recordResult(g, s, function (sc, note) {
      return g.icon + ' ' + g.name + ' ' + sc + (note ? ' · ' + note : '') +
        ' — from your other tab';
    });
    /* Acknowledge. A postMessage whose targetOrigin no longer matches is
       dropped without throwing, so the drill cannot tell "posted" from
       "delivered" on its own — it shows a recoverable link until this
       lands, and only then swaps it for the ✓. */
    try {
      if (ev.source && typeof ev.source.postMessage === 'function') {
        ev.source.postMessage(
          { type: 'artdaily:logged', slug: g.slug, version: 1, score: s }, ev.origin);
      }
    } catch (e) {}
  });

  /* A drill opened directly (a bookmark, a shared link) has no opener,
     so it offers a link home carrying the score: #log=slug,score */
  function consumeLogHash() {
    var m = /(?:^|#|&)log=([a-z0-9-]+),(\d{1,3})/i.exec(location.hash || '');
    if (!m) return;
    /* The pattern is case-insensitive but slugs are not, and the hash is
       cleared below either way — so "#log=LINES,87" (a link retyped by hand,
       or auto-capitalised on its way through a message) matched, cleared
       itself, failed the exact lookup and threw the round away with nothing
       on screen to say so. This is the LAST route a standalone score has
       home; match the parser's own leniency instead of losing it. */
    var g = gameBySlug(m[1].toLowerCase());
    var s = Math.max(0, Math.min(100, parseInt(m[2], 10)));
    /* Clear it first: a refresh must not replay the same score. */
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    if (!g) return;
    recordResult(g, s, function (sc, note) {
      return g.icon + ' ' + g.name + ' ' + sc + (note ? ' · ' + note : '') +
        ' — added to your record';
    });
  }

  /* Theme relay: follow the page toggle into the open game, and keep the
     toggle's own label pointing at where the next press goes. */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      syncThemeLabel();
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

  /* Shared by the hero button and the closing card's copy — so the reset
     timer hangs off the BUTTON, not off this module. One shared timer
     let the second button's copy cancel the first button's reset and
     leave it stuck reading "copied ✓". */
  function copyShare(btn) {
    var text = shareText();
    function confirmCopy() {
      btn.textContent = 'copied ✓';
      btn.classList.add('copied');
      if (btn._copyTimer) clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(function () {
        btn._copyTimer = null;
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
      setStore(freshStore());
      clearToasts();  /* milestones already scheduled are no longer true */
      hideClosing();  /* else it keeps showing the scores just wiped */
      renderAll();
      updateNextBtn();
      if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('is-best'); }
      /* The only confirmation a reset ever gave was things vanishing —
         the ticks, the tubes, the record. Nothing announced, so a screen
         reader player pressed "reset it", answered the confirm, and then
         had no way to know whether anything happened. Queued after
         clearToasts so it is the only thing in the queue. */
      toastPage('progress cleared — streak, ticks and paint tubes are back to empty');
    });
  }

  /* The closing card is a snapshot of one finished day: it must go the
     moment that day's numbers stop being true (reset, or midnight). */
  function hideClosing() {
    var c = $('closing');
    if (!c) return;
    c.textContent = '';
    c.hidden = true;
  }

  function renderAll() {
    renderToday();
    renderStreak();
    renderMeters();
    renderRecord();
    liveGames.forEach(fillMeta);
  }

  /* The closing card is a snapshot of a finished day, so it has to follow
     the day both ways: another tab can complete the warmup (show it) or
     reset the whole store (drop it, rather than keep displaying scores
     that no longer exist anywhere). */
  function syncClosing() {
    if (todayComplete()) renderClosing();
    else hideClosing();
  }

  /* ---- boot ---- */

  renderCatalogue();
  renderToday();
  renderStreak();
  renderMeters();
  renderRecord();
  syncThemeLabel();
  consumeLogHash();
  /* The closing card was only ever built at the instant the third drill
     landed (and on a cross-tab storage event). Refresh the page — or come
     back later the same day — and the day's whole review was gone: no
     scores, no tomorrow, no share, even though the day was still complete.
     syncClosing shows it when today IS finished and hides it otherwise. */
  syncClosing();

  /* Day rollover: a tab left open overnight re-renders the checklist
     and streak for the new day when it next becomes visible. It also
     re-reads the store — a day-old snapshot in memory would otherwise be
     written back over everything logged since. */
  var renderedDay = todayKey();
  function maybeRollover() {
    if (todayKey() === renderedDay) return;
    renderedDay = todayKey();
    setStore(loadStore());
    hideClosing(); /* yesterday's closing card is not today's */
    renderAll();
  }
  document.addEventListener('visibilitychange', maybeRollover);
  window.addEventListener('focus', maybeRollover);

  /* Another tab wrote progress: adopt it rather than keep a snapshot
     that our next save would write back over theirs. */
  window.addEventListener('storage', function (ev) {
    if (ev && ev.key && ev.key !== STORE_KEY) return;
    setStore(loadStore());
    renderAll();
    syncClosing();
    updateNextBtn();
  });
})();
