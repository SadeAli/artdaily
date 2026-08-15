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
     sign-up at the end of a completed warmup — see buildAsk in js/app.js. */
  buttondown: '',       /* buttondown.email username, e.g. 'sadeali' */

  githubSponsors: '',   /* github.com/sponsors username, e.g. 'SadeAli' */
  kofi: '',             /* ko-fi.com page name, e.g. 'sadeali' */
  buymeacoffee: '',     /* buymeacoffee.com page name */
  liberapay: '',        /* liberapay.com username */
  patreon: '',          /* patreon.com page name */
};
