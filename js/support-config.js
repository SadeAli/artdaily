/* ============================================================
   support-config.js — Stage-0 monetization switches.
   Every surface stays hidden until you fill in the matching
   account name, so the site never shows a broken link.
   Keep in sync with the hub (see www/DONATIONS.md) and this
   repo's .github/FUNDING.yml.
   ============================================================ */
window.SUPPORT = {
  /* The newsletter is the FIRST ask here (it needs no payout rail, so it
     can be switched on today). Paste the Buttondown username to reveal the
     sign-up at the end of a completed warmup — see buildAsk in js/app.js.
     EMPTIED 2026-08-23 pending sender-vetting: buttondown.com/artdaily
     returns 404 (the embed endpoint 302s to that same 404, while a fake
     handle 404s outright — the account exists but its page is hidden), and
     the two saved "Forbidden" pages at the workspace root are the same
     story. A form that errors in front of launch traffic is worse than no
     form (LAUNCH-DRAFTS prerequisite 5). To re-enable: confirm the page
     loads and the form accepts ONE test address, then put 'artdaily' back —
     every surface reappears on its own. */
  buttondown: '',   /* buttondown.com/artdaily — restore once vetting clears */

  githubSponsors: '',   /* github.com/sponsors username, e.g. 'SadeAli' */
  kofi: '',             /* ko-fi.com page name, e.g. 'sadeali' */
  buymeacoffee: '',     /* buymeacoffee.com page name */
  liberapay: '',        /* liberapay.com username */
  patreon: '',          /* patreon.com page name */
};
