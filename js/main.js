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
    });
  }

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
