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

  function freshStore() { return { days: {}, streak: { count: 0, last: '' }, skills: {} }; }

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
    if (!isPlainish(s.skills)) s.skills = {};
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

  /* A lapsed streak silently dies — never show a stale count. */
  function streakAlive() {
    var st = store.streak;
    return st.count > 0 && (st.last === todayKey() || st.last === yesterdayKey());
  }

  /* ---- today's warmup: deterministic 3-game spread ---- */

  function daySeed() {
    var n = new Date();
    return Math.floor(new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() / 86400000);
  }

  function slugHash(seed, slug) {
    var h = seed ^ 0x9e3779b9;
    for (var i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 2654435761);
    return h >>> 0;
  }

  /* Rank live games by hash, take distinct categories first so the
     warmup never doubles up a chapter; top back up if needed. */
  function todayPick() {
    var seed = daySeed();
    var ranked = liveGames.slice().sort(function (a, b) {
      return slugHash(seed, b.slug) - slugHash(seed, a.slug);
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
      streakChip.textContent = '🔥 ' + store.streak.count + (store.streak.count === 1 ? ' day' : ' days');
      streakChip.setAttribute('aria-label', store.streak.count + '-day streak');
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

    var st = store.streak;
    if (st.last !== tk) {
      st.count = (st.last === yesterdayKey()) ? (st.count || 0) + 1 : 1;
      st.last = tk;
    }
    saveStore();

    renderToday();
    renderStreak();
    renderMeters();
    fillMeta(g);
    if (statusEl) {
      var picks = todayPick();
      var scores = dayScores(tk);
      var perfect = picks.length > 0 && picks.every(function (p) { return typeof scores[p.slug] === 'number'; });
      statusEl.textContent = 'recorded ✓ ' + score + '/100' +
        (perfect ? ' · ★ perfect day — copy your card up top' : '');
    }
    updateNextBtn();
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

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var text = shareText();
      function confirmCopy() {
        shareBtn.textContent = 'copied ✓';
        shareBtn.classList.add('copied');
        if (shareTimer) clearTimeout(shareTimer);
        shareTimer = setTimeout(function () {
          shareBtn.textContent = SHARE_LABEL;
          shareBtn.classList.remove('copied');
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
    });
  }

  /* ---- reset ---- */

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('reset all local progress? streak, ticks and skill levels will be wiped.')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      store = freshStore();
      renderToday();
      renderStreak();
      renderMeters();
      liveGames.forEach(fillMeta);
      if (statusEl) statusEl.textContent = '';
    });
  }

  /* ---- boot ---- */

  renderCatalogue();
  renderToday();
  renderStreak();
  renderMeters();

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
