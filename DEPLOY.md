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

## 3. Custom domain + DNS

The repo's `CNAME` file already says `artdaily.sadeali.com`. At the DNS
provider, one record:

```
CNAME  artdaily  →  sadeali.github.io
```

Then repo **Settings → Pages → Custom domain**: `artdaily.sadeali.com` →
wait for the DNS check → **Enforce HTTPS**. Once live, submit `sitemap.xml`
in Google Search Console.

## 4. Game repos (one per drill)

Each game deploys as its **own** repo named `artdaily-<slug>` (contents of
`../artdaily-games/<slug>/` in the workspace). Same Pages setup — branch
`main`, folder `/ (root)` — but **no CNAME**: plain project Pages is exactly
what `js/registry.js` already points at:

```
https://sadeali.github.io/artdaily-<slug>/
```

Ship order per game: push the repo → enable Pages → open the URL and finish
a round → set its registry entry here to `status: 'live'` (or add the entry)
→ push this repo → **re-run the drill sitemap** and push it:

```sh
cd ../../sadeali.github.io && node gen_sitemap.js && git commit -am "sitemap: <slug>"
```

That repo is the root of `sadeali.github.io`, and it is the only place the
drill URLs can legally be declared — a sitemap may only list URLs on its own
host, so *this* site's `sitemap.xml` cannot cover them. See
`sadeali.github.io/README.md`. Nothing else changes.

## 5. The hub card

Add the Art Daily card on sadeali.com (the `www` repo): card block in the
grid + the hero-shell `DESTS` entry — recipe in `www/README.md`
("Add a new project card"). Move the `NEW` badge to this card.

## Notes

- Every own-asset path is relative — the page works from `file://`, the
  github.io URL and the custom domain alike.
- Local dev serves the **workspace root** so the registry's `dev` paths
  reach the sibling `../artdaily-games/*` folders (see `README.md`).
