# Deploying Art Daily (zero-build)

Plain static files — deploy = push. GitHub Pages is the whole pipeline:

## 1. Create the repo & push (one time)

Create a **public** repo at github.com/new named `artdaily`, then:

```sh
git remote add origin https://github.com/SadeAli/artdaily.git
git push -u origin main
```

## 2. Enable Pages

GitHub → repo → **Settings → Pages** → Source: *Deploy from a branch* →
Branch: `main`, folder `/ (root)` → Save. The site appears at
`https://sadeali.github.io/artdaily/` within a minute or two.

The empty `.nojekyll` file at the repo root belongs to this step. Without it
Pages runs every push through Jekyll, which publishes a *processed* copy of
the tree and leaves out anything whose name begins with `_` or `.`. When this
repo was one page and a handful of assets that was a rule you could hold in
your head; it is now 43 drill folders and close to 200 files, and the
failure it produces only ever shows up in production — a `_shared/` folder or
a `_notes.md` works on localhost and 404s on the live site. `.nojekyll` turns
the build into a plain copy: what is in the repo is what is served.

## 3. Custom domain + DNS

The repo's `CNAME` file already says `artdaily.sadeali.com`. At the DNS
provider, one record:

```
CNAME  artdaily  →  sadeali.github.io
```

Then repo **Settings → Pages → Custom domain**: `artdaily.sadeali.com` →
wait for the DNS check → **Enforce HTTPS**.

Once live, submit `sitemap.xml` in Google Search Console. It lists 43 URLs —
the page plus every drill at `https://artdaily.sadeali.com/<slug>/` — and it
goes in under the **`sc-domain:sadeali.com`** property, the one that covers
the apex and every subdomain together. This is the reason the drills moved
into this repo at all: a sitemap may only list URLs on the host that serves
it, so drills published at `sadeali.github.io/artdaily-<slug>/` could never
be submitted under the `sadeali.com` property. `game-template/` ships in the
repo but is deliberately not in the sitemap and carries
`<meta name="robots" content="noindex">` — it is a skeleton with a
placeholder canonical, not a drill.

## 4. Ship a drill

Every drill is a folder in this repo, served at
`https://artdaily.sadeali.com/<slug>/`. There is no second repo and no second
Pages setup to do: shipping a drill is a commit here.

1. Copy `game-template/` to `<slug>/` and build the drill — the step-by-step
   checklist is the template's own `README.md`, the design rules and the
   postMessage contract are in `GAME_GUIDE.md`. The folder name *is* the
   address.
2. Keep the folder to `index.html`, `css/style.css`, `js/game.js` and
   `README.md`. The SDK, `support-config.js`, `main.js` and the Caveat font
   are loaded from the page's own copies one level up
   (`../sdk/artdaily-sdk.js`, `../js/…`, and `../../fonts/…` from the
   stylesheet) — do not vendor them back into the folder. They used to be
   copied into every game repo, which meant an SDK fix was 43 pushes and the
   font shipped 43 times.
3. Add its entry to `js/registry.js` with `status: 'live'`. No `url` field:
   the address is derived from the slug. `url` survives only as an override,
   for a drill served from somewhere other than this repo.
4. Add one `<loc>` line to `sitemap.xml`. Nothing generates that file, so a
   drill left out of it is a drill Google is never told about.
5. Push. On the next Pages build the page lists, embeds and scores it.

## 5. The hub card

Add the Art Daily card on sadeali.com (the `www` repo): card block in the
grid + the hero-shell `DESTS` entry — recipe in `www/README.md`
("Add a new project card"). Move the `NEW` badge to this card.

## 6. Retire the old per-game repos (one time)

Before the move each drill was its own repo, published at
`https://sadeali.github.io/artdaily-<slug>/`. Those repos are still live and
still serve a complete copy of the drill, each one canonicalising to itself —
two copies of every drill competing with each other in search. The old clones
are still in the workspace at `../artdaily-games/`, alongside the script that
turns them into redirects:

```sh
cd ../artdaily-games
sh retire-repos.sh          # rewrite + commit each clone, then stop
sh retire-repos.sh --push   # ... and push each one
```

It replaces each repo's contents with a redirect page: a 0-second meta refresh
(Google reads one as a permanent move) plus a canonical to
`https://artdaily.sadeali.com/<slug>/`, and a `location.replace` that carries
`?embed=`, `?theme=` and any `#log=` across, so an old bookmark or a link
someone shared lands on the same drill in the same state. A static Pages site
cannot send a 301, so those are the only two signals available — and the page
is deliberately *not* `noindex`, which would delete the old URL from the index
instead of letting its signals flow to the new one. It walks all 43 clones,
the 42 drills and `artdaily-game-template`.

Nothing is pushed without `--push`, and every clone is a git repo, so any step
is undoable: `git -C <slug> reset --hard HEAD~1`. It has not been run yet.

## Notes

- Every own-asset path is relative — the page works from `file://`, the
  github.io URL and the custom domain alike.
- Local dev serves **this folder**: `python3 -m http.server 8080` here gives
  the page at `/` and every drill at `/<slug>/`, the same layout production
  has. It used to say the workspace root, because the registry carried a
  `dev` path per game pointing at a sibling `../artdaily-games/*` clone;
  both the paths and the field are gone (see `README.md`).
