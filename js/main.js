/* Theme toggle + Stage-0 footer support links. Everything here is an
   enhancement — the page must stay usable with JS disabled. */
(function () {
  'use strict';

  var S = window.SUPPORT || {};
  var root = document.documentElement;

  /* [config key, base URL, short label] — same order as the hub. */
  var PLATFORMS = [
    ['kofi', 'https://ko-fi.com/', 'Ko-fi'],
    ['buymeacoffee', 'https://buymeacoffee.com/', 'Coffee'],
    ['githubSponsors', 'https://github.com/sponsors/', 'Sponsor'],
    ['liberapay', 'https://liberapay.com/', 'Liberapay'],
    ['patreon', 'https://patreon.com/', 'Patreon'],
  ];

  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.hidden = false; /* ships hidden so no-JS visitors never see a dead button */
    toggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('sadeali-theme', next); } catch (e) {}
      dismissDarkHint(true);
    });
  }

  /* ---- the dark-extension callout ----
     Dark-mode EXTENSIONS repaint the page by rewriting colours, and on a
     site whose every surface is mixed from its own tokens that repaint
     sometimes breaks text against background. The site ships a real dark
     mode on every page — this points at it, but ONLY for visitors whose
     page is actually being repainted: everyone else never sees it. Shown
     until acted on; the ✕ or using the toggle retires it for good
     (localStorage `sadeali-darkhint` — listed on /privacy/). */
  var HINT_KEY = 'sadeali-darkhint';
  var hintBox = null;

  function dismissDarkHint(remember) {
    if (remember) { try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {} }
    if (hintBox && hintBox.parentNode) hintBox.parentNode.removeChild(hintBox);
    hintBox = null;
  }

  function darkExtensionActive() {
    /* the common one announces itself */
    if (root.hasAttribute('data-darkreader-mode') || root.hasAttribute('data-darkreader-scheme')) return true;
    if (document.querySelector('style.darkreader, meta[name="darkreader"]')) return true;
    /* generic probe: paint a known colour inline and read it back — an
       extension that rewrites colours rewrites this one too. (Chromium's
       own paint-time force-dark leaves computed styles alone, and that
       repaint is not the broken one being reported.) */
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;width:2px;height:2px;' +
      'background-color:rgb(251,247,240);color:rgb(52,41,29);';
    document.body.appendChild(probe);
    var cs = getComputedStyle(probe);
    var hit = cs.backgroundColor !== 'rgb(251, 247, 240)' || cs.color !== 'rgb(52, 41, 29)';
    document.body.removeChild(probe);
    return hit;
  }

  function showDarkHint() {
    if (hintBox || !toggle || toggle.hidden) return;
    if (root.dataset.theme === 'dark') return;   /* already there */
    var r = toggle.getBoundingClientRect();
    if (!r.width) return;                        /* toggle not actually on screen */

    var css = document.createElement('style');
    css.textContent =
      '.darkhint{position:fixed;z-index:80;max-width:248px;padding:9px 30px 9px 12px;' +
      'background:var(--card,#FDFAF1);color:var(--ink,#33291E);' +
      'border:1px solid var(--line,#D9CBB2);border-radius:5px 11px 6px 10px;' +
      'box-shadow:0 2px 0 var(--shadow,rgba(59,47,32,.16));' +
      'font-size:.78rem;line-height:1.45;}' +
      '.darkhint::before{content:"";position:absolute;top:-6px;right:14px;' +
      'width:10px;height:10px;transform:rotate(45deg);' +
      'background:var(--card,#FDFAF1);' +
      'border-left:1px solid var(--line,#D9CBB2);border-top:1px solid var(--line,#D9CBB2);}' +
      '.darkhint b{white-space:nowrap;}' +
      '.darkhint-x{position:absolute;top:2px;right:4px;border:0;background:none;' +
      'color:var(--muted,#766850);font:inherit;font-size:.9rem;cursor:pointer;padding:2px 5px;}' +
      '.darkhint-x:focus-visible{outline:2px solid var(--ink,#33291E);outline-offset:1px;}';
    document.head.appendChild(css);

    hintBox = document.createElement('div');
    hintBox.className = 'darkhint';
    hintBox.setAttribute('role', 'note');
    hintBox.setAttribute('aria-live', 'polite');
    var msg = document.createElement('span');
    msg.textContent = 'a dark-mode extension seems to be repainting this page — ' +
      'the site has its own dark mode, the \u263e button right up here.';
    var x = document.createElement('button');
    x.className = 'darkhint-x';
    x.setAttribute('aria-label', 'dismiss this tip');
    x.textContent = '\u2715';
    x.addEventListener('click', function () { dismissDarkHint(true); });
    hintBox.appendChild(msg);
    hintBox.appendChild(x);
    document.body.appendChild(hintBox);

    function place() {
      if (!hintBox) return;
      var t = toggle.getBoundingClientRect();
      hintBox.style.top = Math.round(t.bottom + 10) + 'px';
      hintBox.style.right = Math.max(8, Math.round(window.innerWidth - t.right - 6)) + 'px';
    }
    place();
    window.addEventListener('resize', place);
    /* the topbar scrolls away; a floating tip must not follow the page
       around. Not remembered — an unread tip may show again next load. */
    window.addEventListener('scroll', function () { dismissDarkHint(false); }, { once: true });
  }

  (function armDarkHint() {
    if (window.top !== window.self) return;      /* the framing page shows its own */
    if (root.dataset.theme === 'dark') return;
    try { if (localStorage.getItem(HINT_KEY)) return; } catch (e) {}
    try {
      if (window.matchMedia && matchMedia('(forced-colors: active)').matches) return;
    } catch (e) {}
    /* extensions paint late — look twice, then let it go */
    setTimeout(function () {
      if (darkExtensionActive()) { showDarkHint(); return; }
      setTimeout(function () {
        if (darkExtensionActive()) showDarkHint();
      }, 3000);
    }, 1200);
  })();

  var slot = document.getElementById('supportLinks');
  if (slot) {
    PLATFORMS.filter(function (p) { return S[p[0]]; }).slice(0, 2).forEach(function (p) {
      var dot = document.createElement('span');
      dot.textContent = '·';
      dot.setAttribute('aria-hidden', 'true');
      var a = document.createElement('a');
      a.href = p[1] + S[p[0]];
      a.textContent = p[2];
      a.rel = 'noopener';
      slot.appendChild(dot);
      slot.appendChild(a);
    });

    /* "Embed this drill" — drill pages only. The SDK is the discriminator:
       drill pages load it before this file, the hub and the prose pages
       never load it at all. The link routes to the for-teachers walkthrough,
       which holds the one-line iframe snippet and the swap-the-address
       instruction — the drill page itself stays free of teacher chrome. */
    if (window.ArtDaily) {
      var edot = document.createElement('span');
      edot.textContent = '·';
      edot.setAttribute('aria-hidden', 'true');
      var elink = document.createElement('a');
      elink.href = 'https://artdaily.sadeali.com/for-teachers/#embedHead';
      elink.textContent = 'Embed this drill';
      slot.appendChild(edot);
      slot.appendChild(elink);
    }
  }
})();
