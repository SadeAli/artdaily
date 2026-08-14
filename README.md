# artdaily.sadeali.com — Art Daily

The daily-practice arcade of the SadeAli network: five-minute drills for
artists — lines, ellipses, colors, values, symmetry, perspective. This repo
is only the **page**: discovery, today's warmup, streaks and skill meters.
Every game is its own repo on its own URL.

## Run it

No build step, no dependencies — but serve the **workspace root**
(`sadeali.com/`), not this folder, so the registry's `dev` paths reach the
sibling game folders:

```sh
cd ../..                      # the sadeali.com workspace root
python3 -m http.server 8080
# then visit http://localhost:8080/subdomains/artdaily/
```

On localhost (or `file://`) the page swaps every game URL for its
`../artdaily-games/<slug>/` sibling; deployed, it uses the live Pages URLs
from the registry.

## How the arcade works

The page knows nothing about any game except its `js/registry.js` entry —
games embed in the player dialog's iframe and talk through three postMessage
types (ready / result / theme). Full contract and drill design rules:
`GAME_GUIDE.md`.

## Add a game

Copy `../artdaily-games/game-template/` and follow its README (the
step-by-step ship checklist). Finishing move: one new entry in
`js/registry.js` — the card, filter chips, daily warmup and meters all
derive from it.

## What gets stored (and where)

Everything is localStorage, no accounts, nothing leaves the browser:

- `artdaily-progress-v1` (this origin) —
  `{ days: { "YYYY-MM-DD": { <slug>: bestScoreThatDay } },
     streak: { count, last }, skills: { <skillId>: points } }`.
  Day keys use the **local** timezone; a missed day quietly ends the streak.
  The progress section has a reset link.
- `artdaily-best-<slug>` (each game's own origin) — the personal best the
  SDK keeps for standalone play.
- `sadeali-theme` — the network-wide light/dark choice.

## Support / monetization switches (Stage 0)

`js/support-config.js` holds the donation surfaces (Ko-fi, Buy Me a Coffee,
GitHub Sponsors, Liberapay, Patreon). Each footer link stays completely
hidden until the matching account name is filled in — never a broken link.
`.github/FUNDING.yml` adds the Sponsor button on GitHub.

## Structure

```
index.html        the arcade page (hero + today plan + drill grid +
                  progress + player dialog)
css/style.css     shared tokens (top, untouched) + page components (below)
js/registry.js    THE game registry — the only place the page knows games
js/app.js         cards, filters, daily warmup, streaks, meters, player
js/main.js        theme toggle + Stage-0 footer links
js/support-config.js  the donation switches
sdk/artdaily-sdk.js   canonical protocol-v1 SDK (games vendor a copy)
GAME_GUIDE.md     how to build + register a game
robots.txt        allows all crawlers + points at the sitemap
sitemap.xml       the single page
CNAME             artdaily.sadeali.com
.github/FUNDING.yml   GitHub Sponsor button (commented until accounts exist)
```

Deploy = push. See `DEPLOY.md` for the one-time Pages + DNS setup.
