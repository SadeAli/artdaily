# artdaily.sadeali.com — Art Daily

The daily-practice sketchbook of the SadeAli network: a catalogue of 42 tiny
scored drills for artists, grouped into six chapters — colour, value & light,
line & hand, form & perspective, composition, observation & memory. Most
drills are drawn, not clicked: you commit a stroke and the geometry judges
it. Warm paper, washi tape,
handwritten Caveat headings (vendored font, OFL — `fonts/LICENSE.txt`);
dark mode is the "night studio". This repo is the **whole site**: the page
— discovery, today's warmup checklist, streaks and the paint-tube skill
meters — plus every drill, each one a folder here served at
`artdaily.sadeali.com/<slug>/`.

## Run it

No build step, no dependencies — serve **this folder** and you have the
whole thing: the page at `/`, every drill at `/<slug>/`.

```sh
python3 -m http.server 8080
# then visit http://localhost:8080/
```

This used to say "serve the workspace root", because the drills lived in
sibling repos under `../artdaily-games/` and every registry entry carried a
`dev` path to reach them — which meant localhost and the live site loaded
games from two different places, and a drill could be fine in one and
broken in the other. The drills are folders in this repo now, so there is
one path and no `dev` field. Every game link is relative, so `file://`
resolves them too: open `index.html` straight off disk and the cards go
where they should.

## How the arcade works

The page knows nothing about any game except its `js/registry.js` entry —
games embed in the player dialog's iframe and talk through three postMessage
types (ready / result / theme). Full contract and drill design rules:
`GAME_GUIDE.md`.

## Add a game

Copy `game-template/` to `<slug>/` in this repo and follow its README (the
step-by-step ship checklist). The folder name is the slug and the slug is
the address — `/<slug>/` — so there is no URL to keep in sync anywhere.
Finishing move: one new entry in `js/registry.js` — the card, category
spread, jump nav, daily warmup and meters all derive from it. Each entry
also carries `cat` (which chapter), `tag` (how it's scored: `auto` pure
math · `fit` comparison algorithm · `soft` curated answer key — shown as
the little pencil mark on the card) and `level` (1 tap-judgement · 2
standard stroke · 3 construction — the day's warmup is served
easiest-first off it; rubric in the registry header).

## What gets stored (and where)

Everything is localStorage and no account is needed to play; nothing the
drills record is sent to a server. The
drills are folders on this domain now, so the page, the player iframe and a
drill opened in its own tab all share one origin and one store — it used to
be one store per game repo:

- `artdaily-progress-v1` —
  `{ days: { "YYYY-MM-DD": { <slug>: bestScoreThatDay } },
     streak: { count, last, freezes, longest }, skills: { <skillId>: points } }`.
  `longest` is the high-water mark a broken streak leaves behind.
  Day keys use the **local** timezone; a missed day quietly ends the streak.
  The progress section has a reset link.
- `artdaily-best-<slug>` — the personal best the SDK keeps for standalone
  play. When the browser refuses that store at all (private mode) the SDK
  falls back to an in-memory best for the sitting, so a drill never greets
  a returning player with "that is your bar now" every round.
- `sadeali-theme` — the network-wide light/dark choice.

## Support / monetization switches (Stage 0)

`js/support-config.js` holds the donation surfaces (Ko-fi, Buy Me a Coffee,
GitHub Sponsors, Liberapay, Patreon). Each footer link stays completely
hidden until the matching account name is filled in — never a broken link.
`.github/FUNDING.yml` adds the Sponsor button on GitHub.

## Structure

```
index.html        the sketchbook page (hero + today's checklist + category
                  spreads + progress + player dialog)
<slug>/           one drill, served at /<slug>/ — 43 of these folders: the
                  42 catalogued drills plus game-template/. Each holds only
                  index.html, css/style.css, js/game.js and README.md
css/style.css     the sketchbook theme (paper-first tokens + components)
fonts/            Caveat (vendored, OFL) + license — the one copy, loaded
                  by the page and by every drill's css/style.css
js/registry.js    THE game registry — the only place the page knows games
js/app.js         category spreads, daily warmup, streaks, meters, player
js/main.js        theme toggle + Stage-0 footer links — the drills load
                  this same file as ../js/main.js
js/support-config.js  the donation switches, page and drills alike
sdk/artdaily-sdk.js   canonical protocol-v1 SDK — every drill loads THIS
                  copy as ../sdk/artdaily-sdk.js, so a fix goes in here and
                  is live everywhere at once; it used to be vendored into
                  each game repo as its own js/artdaily-sdk.js, 43 copies
                  to keep byte-identical by hand
GAME_GUIDE.md     how to build + register a game
robots.txt        allows all crawlers + points at the sitemap
sitemap.xml       the page + the 42 drills; game-template/ ships too but is
                  noindex and stays out of it
CNAME             artdaily.sadeali.com
.nojekyll         serve the tree exactly as pushed — no Jekyll build
.github/FUNDING.yml   GitHub Sponsor button (commented until accounts exist)
```

Deploy = push. See `DEPLOY.md` for the one-time Pages + DNS setup.
