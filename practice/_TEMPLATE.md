# `/practice/` — the guide template

**This is a brief for whoever writes one of the six chapter guides.** Follow it exactly.
Six people are writing these in parallel and cannot see each other's work, so anything you
improvise here shows up as an inconsistency in the finished section.

**This file is public.** The repo has a `.nojekyll`, so an `_`-prefixed file is served as-is:
this is readable at `https://artdaily.sadeali.com/practice/_TEMPLATE.md`. That is fine — it
is a craft brief, not a secret. Keep it that way. Nothing about traffic targets, channels,
outreach or revenue goes in this file or in any page under `/practice/`.

---

## 1. The six URLs

One writer per row. The URL is fixed — `/practice/index.html` already links all six and the
links break if you rename yours.

| URL | file to create | chapter | drills it covers |
|---|---|---|---|
| `/practice/colour/` | `practice/colour/index.html` | Colour | 8 |
| `/practice/value/` | `practice/value/index.html` | Value & light | 5 |
| `/practice/line/` | `practice/line/index.html` | Line & hand | 10 |
| `/practice/perspective/` | `practice/perspective/index.html` | Perspective (the registry calls this category `form`) | 11 |
| `/practice/composition/` | `practice/composition/index.html` | Composition | 3 |
| `/practice/observation/` | `practice/observation/index.html` | Observation | 5 |

You own **only** your own folder. Do not touch `practice/index.html`, another chapter's
folder, `css/style.css`, `js/**`, `sdk/**`, `tools/**`, `sitemap.xml`, or any drill's
`index.html`. If you need a change in one of those, say so in your report instead.

---

## 2. Why the page exists, and the bar

The 43 drills can win queries with tool intent — *ellipse practice*, *draw a perfect
circle*. They cannot win the article-dominated ones — *perspective practice exercises*,
*value study exercise*, *gesture drawing practice* — because page one there is long-form
teaching from sites with a decade of authority behind them. A guide is the only structure
that reaches those. It is also the page a teacher forwards, a subreddit links and a
teacher forwards to a student, which is the other half of why it matters.

**The test:** would someone who already knows this subject learn something, and would a
drawing teacher send it to a student? If the answer is no, it is filler and it should not
ship.

**Your one unfair advantage:** this site contains working code that *measures* the skill you
are teaching. Nobody else writing about ellipses can tell you what "too flat" means in
numbers. You can, because the scoring function is right there. Use it — it is the reason
these pages are worth reading at all.

### The truth rule (this is the whole point of the section)

**Every number you print must come from the drill's own `js/game.js`.** Open the file, read
the scoring function, quote the real constant or the real formula. If you cannot verify a
number, do not print it. Never invent a tolerance, a threshold or a percentage — not even a
plausible one, not even rounded "for readability".

How to find them:

```sh
# from the repo root
sed -n '1,60p' <slug>/js/game.js                 # the constants live at the top, commented
grep -n 'function .*[Ss]core\|clamp\|TOL\|ZERO\|PERFECT' <slug>/js/game.js
grep -n 'PROFILE\|ease:' sdk/artdaily-sdk.js     # the shared hardware allowance
```

A worked example, so you can see the standard. In `lines/js/game.js`:

```js
var REL_FREE = 0.004, FREE_FLOOR_PX = 3;
var REL_ZERO = 0.055, ZERO_FLOOR_PX = 16;
...
free: Math.max(REL_FREE * L, FREE_FLOOR_PX),
zero: e * Math.max(REL_ZERO * L, ZERO_FLOOR_PX),
```

becomes, in the guide:

> Steady Lines measures the RMS perpendicular drift of your stroke away from the straight
> path between the two dots. Anything under `max(0.4% × |AB|, 3px)` is a clean 100; the
> score runs out at `ease × max(5.5% × |AB|, 16px)`. On a 300px pull that is a full 100 up
> to 3px of average wobble, and a zero at 16.5px with a pen or 33px with a mouse.

Note what that does: it names the metric, quotes the formula, **and then converts it into a
number a person can picture.** Do all three. A formula on its own is not teaching.

**Two traps that have already caught people:**

- `ArtDaily.ease()` multiplies motor-skill tolerances by **1.0 for a pen, 1.5 for a finger,
  2.0 for a mouse or trackpad** (`sdk/artdaily-sdk.js`, `PROFILE`). Some bounds are eased
  and some are not — in `lines` the *zero* point is eased and the *free* band is not. Check
  which, and say which, or the number you print is wrong for two-thirds of readers.
- An `ease`-looking argument is not always the hardware one. In `colors/js/game.js` the
  value passed is `ITEM_EASE[itemIdx]` — a per-item difficulty ramp, `[1.35, 1.12, 1.0,
  1.0, 1.0]` — and that drill has no hardware easing at all.

Everything else on the page obeys the same rule. If you write "most beginners", "studies
show", or a share-of-artists percentage, you have to be able to point at the source. It is
easier and better to write the sentence without it.

---

## 3. The path-depth trap

Drills live at `/<slug>/`, one level deep. **Your guide lives at `/practice/<chapter>/`, two
levels deep.** Everything shared is therefore `../../`:

| what | from a drill (`/lines/`) | **from your guide (`/practice/line/`)** |
|---|---|---|
| shared stylesheet | `css/style.css` *(the drill's own local copy)* | `../../css/style.css` *(the site stylesheet)* |
| theme + support JS | `../js/main.js` | `../../js/main.js` |
| a drill | `../ellipses/` | `../../ellipses/` |
| the catalogue | `../` | `../../` |
| the practice hub | — | `../` |
| the font preload | `fonts/…` | `../../fonts/caveat-latin.woff2` |

The webfont is referenced from *inside* `css/style.css`, so it resolves relative to the CSS
file, not to your page. Do not touch that.

**Verify it, do not assume it.** Serve the repo root and load the page:

```sh
cd subdomains/artdaily && python3 -m http.server 8731
# then open http://127.0.0.1:8731/practice/<chapter>/
```

If the paper background is missing, your CSS path is wrong.

---

## 4. The exact `<head>` block

Copy this whole thing. Replace only the `{{...}}` fields. Do not reorder it, do not drop the
comment, do not add a second `<title>`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE — query-first, under 60 characters}}</title>
<meta name="description" content="{{140–160 chars. Say what the guide teaches. May end with: Free, no account needed.}}">
<meta property="og:type" content="article">
<meta property="og:title" content="{{SHORT TITLE — the query half, no tail}}">
<meta property="og:description" content="{{one sentence, ~110 chars}}">
<meta property="og:site_name" content="Art Daily · SadeAli">
<meta property="og:url" content="https://artdaily.sadeali.com/practice/{{chapter}}/">
<!-- The site card. The guides have no art of their own; tools/build-og.js
     builds per-drill cards from the registry and has no guide template yet. -->
<meta property="og:image" content="https://artdaily.sadeali.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Art Daily — tiny daily drills for artists">
<link rel="canonical" href="https://artdaily.sadeali.com/practice/{{chapter}}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{SHORT TITLE}}">
<meta name="twitter:description" content="{{same sentence as og:description}}">
<meta name="twitter:image" content="https://artdaily.sadeali.com/og.png">
<link rel="icon" href="data:image/svg+xml,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'&gt;&lt;text y='.9em' font-size='90'&gt;{{EMOJI}}&lt;/text&gt;&lt;/svg&gt;">
<link rel="preload" href="../../fonts/caveat-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../../css/style.css">
{{THE SHARED <style> BLOCK — section 5, verbatim}}
<script>
(function(){var q=null,t=null;try{q=new URLSearchParams(location.search).get('theme');}catch(e){}try{t=localStorage.getItem('sadeali-theme');}catch(e){}var v=(q==='light'||q==='dark')?q:t;document.documentElement.dataset.theme=(v==='dark')?'dark':'light';})();
</script>
<script type="application/ld+json">
{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Art Daily", "item": "https://artdaily.sadeali.com/"}, {"@type": "ListItem", "position": 2, "name": "Practice", "item": "https://artdaily.sadeali.com/practice/"}, {"@type": "ListItem", "position": 3, "name": "{{CHAPTER NAME}}", "item": "https://artdaily.sadeali.com/practice/{{chapter}}/"}]}
</script>
</head>
```

`BreadcrumbList` is the **only** JSON-LD on the page. No `Article`, no `FAQPage`, no
`HowTo` — an `Article` block wants a `datePublished` that nobody will ever maintain, and a
stale one is worse than none.

The theme script must stay **inline and before the body**, or the page flashes white before
going dark. It is byte-identical to the one every drill uses.

### Per-chapter head values

`{{EMOJI}}` and `{{CHAPTER NAME}}` are fixed — they have to match the cards on the hub:

| chapter | `{{chapter}}` | `{{EMOJI}}` | `{{CHAPTER NAME}}` |
|---|---|---|---|
| Colour | `colour` | 🎨 | Colour |
| Value & light | `value` | 🌗 | Value & light |
| Line & hand | `line` | ✏️ | Line & hand |
| Perspective | `perspective` | 📐 | Perspective |
| Composition | `composition` | 🖼️ | Composition |
| Observation | `observation` | 👁️ | Observation |

### The title

Query-first, **under 60 characters**, one natural mention of the phrase and never two.
Do not append "| Art Daily" — the name collides with a 30-year-old art newspaper and the
suffix would spend twelve characters on a term that cannot rank.

Check your title is not a near-duplicate of the drill title it sits above (`/values/` is
already *Value Study Practice — sort values and match greys by eye*, so the value guide must
not also lead with "Value Study Practice").

Starting points — verify the length yourself and change them if you can do better:

| chapter | target query | suggested title |
|---|---|---|
| colour | how to practise colour mixing · colour exercises | `Colour Mixing Exercises — how to train your colour eye` |
| value | value study exercise · how to do a value study | `Value Studies — how to practise seeing light and dark` |
| line | line drawing exercises · how to draw a straight line | `Line Drawing Exercises — how to pull a confident stroke` |
| perspective | perspective practice exercises · perspective drawing exercises | `Perspective Drawing Exercises — practise the fundamentals` |
| composition | composition exercises drawing · rule of thirds practice | `Composition Exercises for Drawing — beyond the thirds` |
| observation | observational drawing exercises · how to draw what you see | `Observational Drawing Exercises — training the eye` |

---

## 5. The shared `<style>` block — copy verbatim

**Add no new CSS to `css/style.css`.** That file is shared by all 43 drills and is owned by
another agent right now; a change there is a change to 43 pages.

The guides therefore carry their own small block, and it is the same block on every page in
the section. Paste it exactly as it is below, in the position marked in the `<head>`. Do not
edit it, do not "tidy" it, do not add to it — if all six writers add their own line, the
section stops looking like one thing.

```html
<style>
/* ---- /practice/ prose ----
   NOT in css/style.css on purpose: that file is the shared sketchbook theme
   every one of the 43 drills loads too, and these seven pages are the only
   long-form copy on the site. Tokens only, so both themes come free.
   This block is byte-identical on every page in the section — see
   /practice/_TEMPLATE.md. Change it there and here together, or the six
   guides stop looking like one section. */
.guide { width: 100%; max-width: 44rem; margin: 0 auto; padding: 6px 20px 4px; overflow-wrap: break-word; }
.guide h1 {
  margin: 4px 0 8px;
  font-family: var(--hand);
  font-size: clamp(2rem, 7vw, 2.9rem);
  font-weight: 700;
  line-height: 1.05;
  text-decoration: underline wavy var(--accent, var(--sunny)) 2px;
  text-underline-offset: 9px;
}
.guide h2 { margin: 34px 0 6px; font-family: var(--hand); font-size: clamp(1.55rem, 5vw, 1.95rem); font-weight: 700; line-height: 1.12; }
.guide h3 { margin: 22px 0 4px; font-family: var(--hand); font-size: 1.3rem; font-weight: 700; line-height: 1.15; }
.guide p, .guide li { font-size: 0.95rem; line-height: 1.7; }
.guide p { margin: 0 0 12px; }
.guide ul, .guide ol { margin: 0 0 14px; padding-left: 1.35em; }
.guide li { margin: 0 0 7px; }
.guide a { color: var(--link); font-weight: 700; }
.guide code { font-size: 0.86rem; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 8%, transparent); }
.guide .lede { margin: 0 0 18px; font-family: var(--hand); font-size: 1.35rem; line-height: 1.35; color: var(--muted); }
/* the one thing no other article about these subjects can print: the real
   constant, lifted out of the drill's own scoring function */
.guide .measured {
  margin: 0 0 14px;
  padding: 10px 14px;
  font-size: 0.88rem;
  border-left: 3px solid color-mix(in srgb, var(--accent, var(--sunny)) 60%, transparent);
  background: color-mix(in srgb, var(--ink) 4%, transparent);
  border-radius: 0 8px 8px 0;
}
.guide .measured b { font-family: var(--hand); font-size: 1.1rem; font-weight: 700; display: block; }
.guide .guide-more { margin-top: 20px; padding-top: 12px; border-top: 1px dashed var(--line); font-size: 0.86rem; color: var(--muted); }
/* .section is 1080px wide for a 43-card catalogue. Narrow it to the prose
   column so a page of guide text and a block of cards share one left edge. */
.section.guide-cards { max-width: 44rem; }
</style>
```

If your guide genuinely needs a style that does not exist — and it almost certainly does not
— add it **at the end of your own page's block**, under a comment saying which chapter it
belongs to and why, and flag it in your report so it can be folded back into this template.

---

## 6. Classes you may use

These are real and already in `css/style.css` (verified against the file). Use them; do not
reinvent them.

**Chrome — copy the markup in section 7, do not hand-roll it**
`.topbar` · `.topbar-spacer` · `.backlink` · `.iconbtn` · `.ic-moon` · `.ic-sun` ·
`.footer` · `.footnav` · `.heart-ink` · `.fineprint`

**Layout**
`.section` — the 1080px page column, with `padding: 30px 20px 4px`
`.sheet` — the paper card surface (border, off-square radius, drop shadow)
`.grid` — responsive card grid, `minmax(235px, 1fr)`, with a settle-in animation

**A card, if you want one** — `.grid > li > a.card` with, inside it:
`.card-blob` (the watercolour blob behind an emoji) · `.card-title` · `.card-tagline` ·
`.card-meta` · `.card-skills` + `.skillchip` · `.tagmark` (the how-it-is-scored pencil mark)

**Headings for a card block**
`.cat-head` (a flex row) containing `.cat-icon`, an `<h2>`, `.cat-count`; then `.cat-note`

**Accents** — put one on a section or a card to set `--accent`, which paints the wavy
underline, the washi tape and the blob:
`.accent-coral` · `.accent-sunny` · `.accent-mint` · `.accent-sky` · `.accent-lilac` ·
`.accent-bubblegum`
Use the accent that matches the drill on the catalogue where there is one, so the colours
agree across the site.

**Prose — from the shared block in section 5, not from `css/style.css`**
`.guide` (the 44rem reading column; put your prose in it)
`.guide .lede` (the handwritten one-line summary under the `<h1>`)
`.guide .measured` (**the callout for a quoted constant — this is the page's signature; use
it for the real formula you lifted out of `game.js`,** with the `<b>` as its label)
`.guide .guide-more` (the dashed-rule link line at the very end)
`.section.guide-cards` (narrows a `.section` card block to the prose column so a page of
text and a block of cards share one left edge)

**Do not use** anything named `.game-*`, `.term*`, `.hud*`, `.howto`, `.about`, `.stage` or
`.btn`. Those live in each drill's *own* `css/style.css`, not the site one, and will simply
not exist on your page.

---

## 7. Page structure and heading hierarchy

Exactly one `<h1>`. `<h2>` for sections. `<h3>` beneath. Never skip a level, never use a
heading for its size.

```html
<body>
<div class="topbar">
  <a class="backlink" href="../" aria-label="practice">← practice</a>
  <div class="topbar-spacer"></div>
  <button class="iconbtn" id="themeToggle" aria-label="Toggle light or dark theme" title="Toggle theme" hidden>
    <svg class="ic-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>
    <svg class="ic-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </button>
</div>

<main>

<section class="guide accent-{{ACCENT}}">
  <h1>{{The chapter, as a person would say it}}</h1>
  <p class="lede">{{one handwritten line — what this page is}}</p>
  {{2–3 paragraphs: what the subject is, why it is the thing that decides whether a
    drawing works, and what this page is going to do about it. No throat-clearing —
    the first sentence must already be teaching.}}
</section>

<section class="guide accent-{{ACCENT}}">
  <h2>{{The first real idea}}</h2>
  <p>…</p>
  <h3>{{A part of it}}</h3>
  <p>…</p>
  <p class="measured"><b>What the drill measures</b>{{the quoted formula, then the same
    thing in a number a person can picture}}</p>
  …
</section>

{{more <section class="guide"> blocks — one per idea, three to six of them}}

<section class="guide accent-{{ACCENT}}">
  <h2>How to practise this week</h2>
  {{A short, concrete routine. Which drill, how long, what to watch for, what a change
    in the number would mean. This is the section a teacher forwards.}}
  <p class="guide-more">{{links: the other chapters that touch this, the catalogue}}</p>
</section>

</main>

<footer class="footer">
  <nav class="footnav" aria-label="Site links">
    <a href="https://artdaily.sadeali.com/">More drills</a>
    <span aria-hidden="true">·</span>
    <a href="https://sadeali.com/">More experiments</a>
    <span aria-hidden="true">·</span>
    <a href="https://sadeali.com/support/">Support <span class="heart-ink" aria-hidden="true">♥</span></a>
    <span aria-hidden="true">·</span>
    <a href="https://github.com/SadeAli" rel="me noopener">GitHub</a>
    <span id="supportLinks"></span>
  </nav>
  <p class="fineprint"><span aria-hidden="true"># </span>© SadeAli · free · no ads · no account needed</p>
</footer>

<script src="../../js/support-config.js"></script>
<script src="../../js/main.js"></script>
</body>
</html>
```

The fineprint line reads **exactly**:

```
© SadeAli · free · no ads · no account needed
```

Nothing added, nothing removed.

`#supportLinks` and `#themeToggle` are wired by `js/main.js`. The toggle ships `hidden` on
purpose so a visitor with JavaScript off never sees a dead button. Leave both alone.

### If you build a page that should not be indexed

A draft, a scratch comparison, anything under `/practice/` that is not a finished guide:
put this in its `<head>` and keep it out of the sitemap.

```html
<meta name="robots" content="noindex">
```

A finished guide never carries it.

---

## 8. Length, links, and what the copy may say

**1200–2000 words of real teaching.** Not padded to 2000, not 700 with a big grid. Under
1200 it will not hold an article-dominated query; over 2000 it stops being read. The hub at
`/practice/` is about 1500 — read it first, both for length and for voice.

**Every drill mention is an inline link, in the sentence.** Never a bare list of drills at
the bottom doing the linking work. `<a href="../../ellipses/">…</a>` — two levels up.

**Anchor text is the practice, not the product name.** Write
`<a href="../../lines/">straight-line practice</a>`, or name the drill in the surrounding
sentence — *"…which is what <a href="../../lines/">Steady Lines</a> measures"*. Do not link
the words "here" or "this drill".

**Link across chapters.** Value and colour overlap; line and perspective overlap; ellipses
appear in both line and perspective. One or two cross-links from your chapter to another
guide, in the prose, is right. Ten is a link farm.

**Link up.** Somewhere on the page, link back to `../` (the practice hub) and to `../../`
(the catalogue).

### Voice

Match the drill pages. Read the `<section class="about">` block on `/lines/`, `/values/` and
`/perspective/` before you write a word — that is the register.

Matter-of-fact, warm, specific. Short sentences. Second person. No hype adjectives, no
"unlock", no "master", no exclamation marks. Never market the maker as fun. State a fact and
let it be interesting.

**Jargon is fine to use and never fine to assume.** Gloss it in the same sentence or use the
ordinary word: *"the terminator — the line where the form turns away from the light"*.

### Promises — settled, do not relitigate

**Approved, and these three only:** `free` · `no ads` · `no account needed`

**Forbidden, anywhere in the copy:** "no tracking", "nothing tracked", "no trackers", "no
accounts", "no signup", "stays free", "free forever", "no paywalls", "everything is free".
Optional accounts and an at-most-freemium model are planned, and an absolute that a future
feature falsifies is a broken promise, not a nice line.

**No personal information.** The public identity is SadeAli; contact is GitHub. Never
explain what the brand name means.

**Never write "search Art Daily".** The name collides with a 30-year-old art newspaper and
an established app. Always the literal URL: `artdaily.sadeali.com`.

**You may say** that nothing on the site is scored by a model — the drills are closed-form
geometry and colour arithmetic. Four of them (`sphere-shade`, `crop-it`, `focal-place`,
`gesture-capture`, marked *curated* on their cards) compare against a hand-written answer
key. That is true today; check it is still true before you print it.

### Spelling

British where the site already is: **colour**, **grey**, **practise** as a verb in body
copy. **"Practice"** as the noun, and in titles, where search volume decides. Drill folder
names keep their US spelling (`/colors/`) — that is a URL, not a word.

---

## 9. Your chapter's drills

Link by **slug**, not by name: another workflow is rewriting the drill `<title>`s right now,
so a name you copy today may not be the name tomorrow. The slug is the folder and it is
stable.

**colour** — `colors` (Color Mixer) · `palette-pick` (Palette Pick) · `mix-to-target` (Mix to
Target) · `value-trap` (Value Trap) · `neutral-hunt` (Neutral Hunt) · `temperature-sort`
(Temperature Sort) · `colour-constancy` (Colour Constancy) · `sun-and-sky` (Sun & Sky)

**value** — `values` (Value Squint) · `sphere-shade` (Shade a Sphere) · `value-thumbnail`
(Value Thumbnail) · `hatch-ramp` (Hatch a Ramp) · `light-direction` (Light Direction)

**line** — `warm-up` (Warm Up) · `superimposed` (Superimposed Lines) · `lines` (Steady
Lines) · `ellipses` (Ellipse Orbit) · `draw-through` (Draw Through) · `symmetry` (Mirror
Mirror) · `angle-snap` (Angle Snap) · `steady-tunnel` (Steady Tunnel) · `even-spacing` (Even
Spacing) · `line-weight` (Line Weight)

**perspective** — `perspective` (Vanishing Act) · `cube-from-plane` (Cube From Plane) ·
`box-check` (Box Check) · `vp-hunt` (Vanishing Point Hunt) · `rotate-place` (Rotate & Place)
· `ellipse-in-plane` (Ellipse in Plane) · `cylinder-ends` (Cylinder Ends) · `cast-shadow`
(Cast Shadow) · `horizon-read` (Horizon Read) · `cross-contour` (Wrap the Form) ·
`down-the-row` (Down the Row)

**composition** — `crop-it` (Crop It) · `focal-place` (Focal Placement) · `counterweight`
(Counterweight)

**observation** — `contour-memory` (Contour Memory) · `proportion-eye` (Proportion Eye) ·
`negative-space` (Negative Space) · `anatomy-spot` (Anatomy Spot) · `gesture-capture`
(Gesture Capture)

A `circle` drill may land while you are writing. Run `ls ..` from your folder before you
finish: if `../../circle/` exists, the line chapter should link it.

Every drill folder also has a `README.md` and an `<section class="about">` block on its page
that already explains its scoring in the house voice. Read them. **Do not paraphrase them
into your guide** — your page has to say something the drill page does not, or there was no
reason to write it.

---

## 10. Before you report finished

- [ ] Serve the repo root, load `/practice/<chapter>/`, and confirm the **paper background
      and the Caveat headings render**. If they do not, the stylesheet path is wrong.
- [ ] Toggle the theme. Check **light and dark**, and check at **360px wide** — nothing may
      scroll sideways.
- [ ] Every link resolves. Check them all, including `../` and `../../`.
- [ ] Exactly one `<h1>`; no skipped heading levels.
- [ ] `<title>` under 60 characters, and not a duplicate of another page's.
- [ ] Canonical, `og:url` and the third `BreadcrumbList` item all point at
      `https://artdaily.sadeali.com/practice/<chapter>/` with the trailing slash.
- [ ] The fineprint is the exact approved line. Grep the page for the forbidden phrases in
      section 8 and get nothing.
- [ ] **Every number traces to a line of `js/game.js` you actually opened.** List them in
      your report with the file and the constant, so a reviewer can check without
      re-deriving them.
- [ ] 1200–2000 words.
- [ ] `sitemap.xml` is generated by `tools/build-sitemap.js`, which reads the registry and
      knows nothing about `/practice/`. **Do not edit either file.** Report that your URL
      needs adding.
- [ ] Never `git commit`, never `git push`.
