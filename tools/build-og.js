#!/usr/bin/env node
/* Regenerates og/<slug>.png — one share card per live drill — from js/registry.js.
   Run it, look at the pictures, commit the result.

   This is NOT a build step. Same contract as tools/build-sitemap.js: the site is
   still plain files, deploy is still `git push`, and nothing runs this on the
   server. It exists because every venue this site launches into is image-first,
   and 42 drill URLs sharing one generic og.png means every post looks like the
   same post.

     node tools/build-og.js              # all live drills
     node tools/build-og.js lines box-check   # just these, for iterating

   Must be run from the repo root (like build-sitemap.js — paths are relative).

   ---------------------------------------------------------------------------
   WHY IT LOOKS LIKE THIS

   The card is a page from the same sketchbook as the site: paper #F6EFDF under
   a 22px dot grid, a #FDFAF1 sheet with the off-square corners .sheet uses, a
   strip of washi tape in the drill's accent, the watercolour blob from
   .card-blob with the drill's emoji on it, and Caveat for the display type.
   Every colour below is copied from css/style.css :root — if a token changes
   there, change it here too; there is no way to share them without a build step.

   ---------------------------------------------------------------------------
   THE TWO RENDERING TRAPS, AND HOW THEY ARE SOLVED

   1. CAVEAT. librsvg does not implement @font-face, so `src: url(data:...)`
      in the SVG is silently ignored and the headline falls back to whatever
      fontconfig hands out — a real failure, because it looks fine until you
      compare it to the site. It resolves fonts through fontconfig instead, so
      the fix is to hand fontconfig the font: a generated fonts.conf pointing at
      a private font directory. fontconfig WILL list the .woff2 (FreeType reads
      the container) but cairo cannot rasterise from it — verified: rendering
      through a woff2-only dir produced a file byte-identical to rendering with
      a deliberately bogus family name. So the woff2 is decompressed to a real
      .ttf first, with woff2_decompress.
      This is proved, not assumed: verifyCaveat() renders the same probe twice,
      once as Caveat and once as a family that cannot exist, and aborts the whole
      run if the two PNGs come out identical.

   2. EMOJI. librsvg renders Noto Color Emoji as a flat ink silhouette, and the
      CBDT bitmap strikes make the glyph ignore font-size (a 70px request draws
      at the font's native 136px and overruns whatever box you drew for it).
      ImageMagick's pango: delegate renders the same font in full colour, so
      each emoji is rendered separately, trimmed to its ink, and embedded in the
      card SVG as a base64 <image> at a size we choose. Nothing can overflow,
      and the colours match what a visitor actually sees on the page.
      The strike caps out around 121px of content, which is why EMOJI_BOX is 132
      and not larger — past that it would just be upscaled blur.

   Needs on PATH: rsvg-convert, magick (ImageMagick 7), woff2_decompress,
   fc-match, and Noto Color Emoji installed. All are checked for by name before
   anything is written, with the package that provides them named in the error.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

/* ===== tokens — copied from css/style.css :root (light; a share card is paper) ===== */
const PAPER = '#F6EFDF';   /* --bg    */
const CARD  = '#FDFAF1';   /* --card  */
const INK   = '#33291E';   /* --ink   */
const MUTED = '#766850';   /* --muted */
const LINE  = '#D9CBB2';   /* --line  */
const SHADE = '#3B2F20';   /* --shadow, without its alpha */

const ACCENTS = {
  coral:     '#E26D5A',
  sunny:     '#E9A93D',
  mint:      '#56A382',
  sky:       '#5C93B8',
  lilac:     '#907BC0',
  bubblegum: '#D077A0',
};

/* ===== layout — 1200x630 is the Open Graph size every venue crops from ===== */
const W = 1200, H = 630;
const SHEET = { x: 56, y: 46, w: 1088, h: 538 };
const PAD = 56;                           /* sheet padding: where the footer rule ends */
const BLOB  = { cx: 216, cy: 268, w: 232, h: 218 };
const EMOJI_BOX = 132;                    /* see trap 2 — the strike caps near 121px */
const COL = { x: 350, w: SHEET.x + SHEET.w - PAD - 350 };   /* text column: 350 -> 1088 */
const TITLE_SIZE = 90, TITLE_LH = 94, TITLE_MAX_LINES = 2;
const TAG_SIZE = 46,  TAG_LH = 58,  TAG_MAX_LINES = 3;
const CAT_SIZE = 22;
const RULE_Y = 480;                       /* dashed footer rule, like the page's own footer */
const MARK_SIZE = 26, MARK_Y = 534;
const MONO = 'DejaVu Sans Mono, Liberation Mono, Noto Sans Mono, monospace';
const HOST = 'artdaily.sadeali.com';

/* Contrast: the sheet is opaque --card, and the accent washes all sit on the
   paper OUTSIDE it, so every card has the same measured text contrast whatever
   its accent — sampled from the rendered PNGs: --ink on --card is 13.6:1, and
   --muted on --card is 5.2:1, which is AA for body text and AAA at the 46px the
   tagline is set in. Nothing on the card carries meaning by colour alone. */

const OUT_DIR = 'og';
const FONT_WOFF2 = 'fonts/caveat-latin.woff2';

/* ===== small helpers ===== */
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = v => Math.round(v * 100) / 100;

function have(bin) {
  try { execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}
function die(msg) { console.error(`build-og: ${msg}`); process.exit(1); }

/* ===================================================================== */
/* fonts                                                                  */
/* ===================================================================== */

/* A private fontconfig root, kept in the OS temp dir between runs so the font
   cache stays warm and woff2_decompress only reruns when the woff2 changes. */
function prepareFonts() {
  const dir = path.join(os.tmpdir(), 'artdaily-og-fonts');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });

  const ttf = path.join(dir, 'caveat-latin.ttf');
  const src = fs.statSync(FONT_WOFF2);
  if (!fs.existsSync(ttf) || fs.statSync(ttf).mtimeMs < src.mtimeMs) {
    const tmpW = path.join(dir, 'caveat-latin.woff2');
    fs.copyFileSync(FONT_WOFF2, tmpW);
    execFileSync('woff2_decompress', [tmpW], { stdio: 'pipe' });   /* writes .ttf beside it */
    if (!fs.existsSync(ttf)) die('woff2_decompress produced no .ttf');
  }

  /* Noto Color Emoji: ask fontconfig where it is rather than guessing paths. */
  let emojiFile = '';
  try {
    const out = execFileSync('fc-match', ['--format=%{file}\t%{family}', 'Noto Color Emoji'],
      { encoding: 'utf8' });
    const [file, family] = out.split('\t');
    if (/emoji/i.test(family || '')) emojiFile = file;
  } catch (e) { /* fall through to the error below */ }
  if (!emojiFile || !fs.existsSync(emojiFile)) {
    die('Noto Color Emoji is not installed (package: noto-fonts-emoji). ' +
        'Every drill card carries its registry emoji, so this is fatal, not cosmetic.');
  }
  const emojiLink = path.join(dir, 'NotoColorEmoji.ttf');
  try { fs.rmSync(emojiLink, { force: true }); fs.symlinkSync(emojiFile, emojiLink); }
  catch (e) { fs.copyFileSync(emojiFile, emojiLink); }

  /* Two configs on purpose:
       cards  — our dir first, then the system's, so the small mono wordmark can
                resolve to whatever mono the machine has.
       emoji  — our dir ONLY. Nothing may substitute for Noto Color Emoji: a
                missing glyph must fail visibly rather than quietly become a
                Font Awesome or DejaVu silhouette (this machine's fontconfig
                happily serves U+1F3A8 from Font Awesome if you let it). */
  const conf = (includeSystem) => `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <cachedir>${path.join(dir, 'cache')}</cachedir>
${includeSystem ? '  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n' : ''}</fontconfig>
`;
  const cardsConf = path.join(dir, 'fonts-cards.conf');
  const emojiConf = path.join(dir, 'fonts-emoji.conf');
  fs.writeFileSync(cardsConf, conf(true));
  fs.writeFileSync(emojiConf, conf(false));
  return { dir, ttf, cardsConf, emojiConf, emojiFile };
}

/* ===================================================================== */
/* Caveat metrics — for wrapping text librsvg will not wrap for us         */
/* ===================================================================== */

/* librsvg has no text wrapping and no <foreignObject>, so every line break is
   decided here. Reads cmap(4) + hmtx out of the .ttf: enough for advance widths
   of the default instance. Two known and deliberate approximations:
     - kerning (GPOS) is not applied;
     - the Bold instance of this variable font is a few percent wider than the
       default the hmtx table describes.
   Both are absorbed by BOLD_FUDGE/PLAIN_FUDGE, which are set to OVER-estimate.
   Overestimating is the safe direction: it wraps a word early. Underestimating
   would push text off the sheet, which is the failure this whole function
   exists to prevent — and fitLines() shrinks the size if a word cannot fit at all. */
const BOLD_FUDGE = 1.08, PLAIN_FUDGE = 1.02;

function loadMetrics(ttfPath) {
  const b = fs.readFileSync(ttfPath);
  const count = b.readUInt16BE(4), tab = {};
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    tab[b.toString('ascii', o, o + 4)] = { off: b.readUInt32BE(o + 8) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (!tab[t]) die(`Caveat .ttf has no ${t} table`);
  const upem = b.readUInt16BE(tab.head.off + 18);
  const numH = b.readUInt16BE(tab.hhea.off + 34);

  /* pick the Unicode subtable: (3,1) BMP is what Caveat ships */
  const c = tab.cmap.off, subs = b.readUInt16BE(c + 2);
  let off = 0;
  for (let i = 0; i < subs; i++) {
    const p = c + 4 + i * 8, plat = b.readUInt16BE(p), enc = b.readUInt16BE(p + 2);
    if (plat === 3 && (enc === 1 || enc === 10)) off = c + b.readUInt32BE(p + 4);
    else if (!off && plat === 0) off = c + b.readUInt32BE(p + 4);
  }
  if (!off || b.readUInt16BE(off) !== 4) die('Caveat cmap is not format 4 — the reader needs updating');

  const segs = b.readUInt16BE(off + 6) / 2;
  const endO = off + 14, startO = endO + segs * 2 + 2, deltaO = startO + segs * 2, rangeO = deltaO + segs * 2;
  const map = new Map();
  for (let s = 0; s < segs; s++) {
    const end = b.readUInt16BE(endO + s * 2), start = b.readUInt16BE(startO + s * 2);
    const delta = b.readInt16BE(deltaO + s * 2), ro = b.readUInt16BE(rangeO + s * 2);
    if (start === 0xFFFF) continue;
    for (let ch = start; ch <= end; ch++) {
      let g;
      if (ro === 0) g = (ch + delta) & 0xFFFF;
      else {
        const gi = rangeO + s * 2 + ro + (ch - start) * 2;
        if (gi + 1 >= b.length) continue;
        g = b.readUInt16BE(gi);
        if (g) g = (g + delta) & 0xFFFF;
      }
      if (g) map.set(ch, g);
    }
  }
  const advance = g => b.readUInt16BE(tab.hmtx.off + Math.min(g, numH - 1) * 4);

  return {
    missing(text) {
      const out = [];
      for (const ch of text) if (!map.has(ch.codePointAt(0))) out.push(ch);
      return out;
    },
    width(text, size, bold) {
      let u = 0;
      for (const ch of text) {
        const g = map.get(ch.codePointAt(0));
        if (g === undefined) continue;
        u += advance(g);
      }
      return (u / upem) * size * (bold ? BOLD_FUDGE : PLAIN_FUDGE);
    },
  };
}

function greedy(metrics, text, size, maxW, bold) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (metrics.width(next, size, bold) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = word;
    if (metrics.width(cur, size, bold) > maxW) return null;   /* one word wider than the column */
  }
  if (cur) lines.push(cur);
  return lines;
}

/* Wrap to fit the column, then BALANCE: a greedy wrap leaves orphans ("…the sky
   cools the / shade") which look like a mistake on a share card. Once the line
   count is known, re-wrap at the narrowest width that still produces that many
   lines, which evens them out. Shrinks the type only if a single word cannot
   fit the column at all. Returns {lines, size}. */
function fitLines(metrics, text, size, maxW, maxLines, bold) {
  for (let s = size; s > size * 0.6; s -= 2) {
    const lines = greedy(metrics, text, s, maxW, bold);
    if (!lines || lines.length > maxLines) continue;
    if (lines.length < 2) return { lines, size: s };
    let lo = 1, hi = maxW, best = lines;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const attempt = greedy(metrics, text, s, mid, bold);
      if (attempt && attempt.length <= lines.length) { best = attempt; hi = mid; }
      else lo = mid;
    }
    return { lines: best, size: s };
  }
  return null;
}

/* ===================================================================== */
/* emoji                                                                  */
/* ===================================================================== */

const emojiCache = new Map();

function emojiImage(glyph, env) {
  if (emojiCache.has(glyph)) return emojiCache.get(glyph);
  /* pango markup: the emoji themselves contain no markup characters, but escape
     anyway so a future registry entry cannot inject one. */
  const markup = `<span font="Noto Color Emoji 40">${xml(glyph)}</span>`;
  let png;
  try {
    png = execFileSync('magick', [
      '-background', 'none', '-density', '300', `pango:${markup}`,
      '-trim', '+repage', '-depth', '8', 'png:-',
    ], { env, maxBuffer: 1 << 24 });
  } catch (e) {
    die(`could not render emoji ${glyph}: ${e.message}`);
  }
  if (!png || png.length < 500) die(`emoji ${glyph} rendered empty — not in Noto Color Emoji?`);
  /* PNG IHDR: width/height at bytes 16..24 */
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (w < 24 || h < 24) die(`emoji ${glyph} rendered ${w}x${h} — too small to be a real glyph`);
  const img = { w, h, b64: png.toString('base64'), bytes: png.length };
  emojiCache.set(glyph, img);
  return img;
}

/* ===================================================================== */
/* the card                                                               */
/* ===================================================================== */

/* CSS border-radius with four different corners, as a path. Adjacent radii on
   every side sum to exactly the side length in both shapes below, which is what
   makes .card-blob a blob and not a rounded rectangle. */
function blobPath(x, y, w, h, r) {
  const [tl, tr, br, bl] = r;   /* each [rx, ry] as a fraction of w, h */
  const p = (fx, fy) => [fx * w, fy * h];
  const [tlx, tly] = p(tl[0], tl[1]), [trx, try_] = p(tr[0], tr[1]);
  const [brx, bry] = p(br[0], br[1]), [blx, bly] = p(bl[0], bl[1]);
  return [
    `M ${n(x + tlx)} ${n(y)}`,
    `L ${n(x + w - trx)} ${n(y)}`,
    `A ${n(trx)} ${n(try_)} 0 0 1 ${n(x + w)} ${n(y + try_)}`,
    `L ${n(x + w)} ${n(y + h - bry)}`,
    `A ${n(brx)} ${n(bry)} 0 0 1 ${n(x + w - brx)} ${n(y + h)}`,
    `L ${n(x + blx)} ${n(y + h)}`,
    `A ${n(blx)} ${n(bly)} 0 0 1 ${n(x)} ${n(y + h - bly)}`,
    `L ${n(x)} ${n(y + tly)}`,
    `A ${n(tlx)} ${n(tly)} 0 0 1 ${n(x + tlx)} ${n(y)}`,
    'Z',
  ].join(' ');
}

/* px corner radii, in the .sheet order: 6px 14px 8px 12px, scaled for a sheet
   this size. Kept small so the card still reads as a cut sheet of paper. */
function sheetPath(x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii;
  return [
    `M ${x + tl} ${y}`,
    `H ${x + w - tr}`, `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}`,
    `V ${y + h - br}`, `A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}`,
    `H ${x + bl}`,     `A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}`,
    `V ${y + tl}`,     `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}`,
    'Z',
  ].join(' ');
}

/* monospace advance is 0.6em in every mono this will realistically resolve to;
   only used to size two decorative accent rules, never to place text. */
const monoW = (text, size, tracking) => text.length * size * 0.6 + Math.max(0, text.length - 1) * tracking;

function buildSVG(game, metrics, env, cats) {
  const accent = ACCENTS[game.accent];
  if (!accent) die(`${game.slug}: unknown accent "${game.accent}" — not in css/style.css`);
  const cat = (cats[game.cat] && cats[game.cat].label) || game.cat;

  const title = fitLines(metrics, game.name, TITLE_SIZE, COL.w, TITLE_MAX_LINES, true);
  if (!title) die(`${game.slug}: name "${game.name}" will not fit the card`);
  const tag = fitLines(metrics, game.tagline, TAG_SIZE, COL.w, TAG_MAX_LINES, false);
  if (!tag) die(`${game.slug}: tagline "${game.tagline}" will not fit the card`);

  const gone = metrics.missing(game.name + game.tagline).filter(c => !/\s/.test(c));
  if (gone.length) die(`${game.slug}: Caveat has no glyph for ${JSON.stringify(gone.join(''))}`);

  /* vertical block: category + title + tagline, optically centred on the blob */
  const CAT_H = 28, GAP_CAT = 30, GAP_TAG = 18;
  const blockH = CAT_H + GAP_CAT + title.lines.length * TITLE_LH + GAP_TAG + tag.lines.length * TAG_LH;
  let y = BLOB.cy - blockH / 2 - 2;

  const catBaseline = y + 22;
  y += CAT_H + GAP_CAT;
  const titleBaselines = title.lines.map((_, i) => y + title.size * 0.75 + i * TITLE_LH);
  y += title.lines.length * TITLE_LH + GAP_TAG;
  const tagBaselines = tag.lines.map((_, i) => y + tag.size * 0.74 + i * TAG_LH);

  const emoji = emojiImage(game.icon, env);
  const scale = Math.min(EMOJI_BOX / emoji.w, EMOJI_BOX / emoji.h);
  const ew = emoji.w * scale, eh = emoji.h * scale;
  const ex = BLOB.cx - ew / 2, ey = BLOB.cy - eh / 2 - 4;

  const bx = BLOB.cx - BLOB.w / 2, by = BLOB.cy - BLOB.h / 2;
  /* .card-blob: border-radius: 58% 42% 55% 45% / 48% 60% 40% 52% */
  const blob = blobPath(bx, by, BLOB.w, BLOB.h,
    [[0.58, 0.48], [0.42, 0.60], [0.55, 0.40], [0.45, 0.52]]);
  /* .sheet: border-radius: 6px 14px 8px 12px — a cut sheet, not a rounded rectangle */
  const sheet = sheetPath(SHEET.x, SHEET.y, SHEET.w, SHEET.h, [6, 14, 8, 12]);

  const catW = monoW(cat, CAT_SIZE, 2.4);

  /* The wordmark is the whole URL, not the brand: "Art Daily" is a name this
     site cannot win in search (artdaily.com has held it since 1996), so the
     literal address is the only thing worth burning into a share image — and
     the per-drill path means a screenshot is still directions.
     For a bare host wordmark instead, this one line becomes `const mark = HOST;`. */
  const mark = `${HOST}/${game.path || game.slug}`;
  let markSize = MARK_SIZE;
  const markMax = SHEET.w - PAD * 2;
  while (monoW(mark, markSize, 1.6) > markMax && markSize > 16) markSize -= 1;
  const markW = monoW(mark, markSize, 1.6);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- the page's own paper: 22px dot grid over three soft washes (the site's
         sunny + sky, plus one in this drill's accent so the paper is its colour too) -->
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="11" cy="11" r="1.2" fill="${INK}" opacity="0.07"/>
    </pattern>
    <radialGradient id="washA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${ACCENTS.sunny}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${ACCENTS.sunny}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="washB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${ACCENTS.sky}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${ACCENTS.sky}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="washC" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <!-- watercolour blob behind the icon, straight from .card-blob -->
    <radialGradient id="blobwash" cx="0.32" cy="0.28" r="0.86">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.46"/>
      <stop offset="0.70" stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0.03"/>
    </radialGradient>
    <!-- washi tape: accent wash with the diagonal shine .card::before has -->
    <pattern id="tape" width="31" height="31" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
      <rect width="18" height="31" fill="#FFFFFF" opacity="0.30"/>
    </pattern>
    <filter id="sheetshadow" x="-6%" y="-8%" width="112%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="13" flood-color="${SHADE}" flood-opacity="0.14"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <ellipse cx="1020" cy="-30" rx="700" ry="330" fill="url(#washA)"/>
  <ellipse cx="-120" cy="252" rx="620" ry="400" fill="url(#washB)"/>
  <ellipse cx="1120" cy="700" rx="560" ry="330" fill="url(#washC)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>

  <!-- the sheet: a hair off-square, like a cut sheet -->
  <path d="${sheet}" fill="${SHADE}" opacity="0.13" transform="translate(0 4)"/>
  <path d="${sheet}" fill="${CARD}" stroke="${LINE}" stroke-width="2" filter="url(#sheetshadow)"/>

  <!-- washi tape holding the sheet down -->
  <g transform="rotate(-2.5 600 ${SHEET.y})">
    <rect x="492" y="${SHEET.y - 27}" width="216" height="54" rx="3" fill="${accent}" opacity="0.6"/>
    <rect x="492" y="${SHEET.y - 27}" width="216" height="54" rx="3" fill="url(#tape)"/>
  </g>

  <path d="${blob}" fill="url(#blobwash)"/>
  <image x="${n(ex)}" y="${n(ey)}" width="${n(ew)}" height="${n(eh)}"
         xlink:href="data:image/png;base64,${emoji.b64}"/>

  <!-- category, pencil-marked like .tagmark -->
  <text x="${COL.x}" y="${n(catBaseline)}" font-family="${MONO}" font-size="${CAT_SIZE}"
        letter-spacing="2.4" font-weight="700" fill="${MUTED}">${xml(cat)}</text>
  <rect x="${COL.x}" y="${n(catBaseline + 9)}" width="${n(catW)}" height="3" fill="${accent}" opacity="0.65"/>

  <!-- the drill's name -->
${title.lines.map((l, i) => `  <text x="${COL.x}" y="${n(titleBaselines[i])}" font-family="Caveat" font-size="${title.size}" font-weight="700" fill="${INK}">${xml(l)}</text>`).join('\n')}

  <!-- its tagline, verbatim from the registry -->
${tag.lines.map((l, i) => `  <text x="${COL.x}" y="${n(tagBaselines[i])}" font-family="Caveat" font-size="${tag.size}" fill="${MUTED}">${xml(l)}</text>`).join('\n')}

  <!-- footer: the page's own dashed rule, then the address -->
  <line x1="${SHEET.x + PAD}" y1="${RULE_Y}" x2="${SHEET.x + SHEET.w - PAD}" y2="${RULE_Y}"
        stroke="${LINE}" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
  <circle cx="${SHEET.x + SHEET.w - PAD}" cy="${RULE_Y}" r="5" fill="${accent}" opacity="0.75"/>
  <text x="${SHEET.x + PAD}" y="${MARK_Y}" font-family="${MONO}" font-size="${markSize}"
        letter-spacing="1.6" font-weight="700" fill="${INK}">${xml(mark)}</text>
  <rect x="${SHEET.x + PAD}" y="${MARK_Y + 9}" width="${n(markW)}" height="3" fill="${accent}" opacity="0.6"/>
</svg>
`;
}

/* ===================================================================== */
/* verification                                                           */
/* ===================================================================== */

/* Renders one probe twice — once asking for Caveat, once asking for a family
   that cannot exist — and compares the bytes. Identical output means fontconfig
   never found Caveat and both fell back to the same face, i.e. every card would
   ship in the wrong typeface while looking perfectly fine on its own. */
function verifyCaveat(env, tmp) {
  const probe = fam => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140" viewBox="0 0 600 140">` +
      `<text x="10" y="100" font-family="${fam}" font-size="72" font-weight="700" fill="#000">Steady Lines</text></svg>`;
    const f = path.join(tmp, 'probe.svg'), o = path.join(tmp, 'probe.png');
    fs.writeFileSync(f, svg);
    execFileSync('rsvg-convert', [f, '-o', o], { env });
    return fs.readFileSync(o);
  };
  const real = probe('Caveat');
  const bogus = probe('ZZ Absolutely No Such Family');
  if (real.equals(bogus)) {
    die('Caveat did NOT render — rsvg-convert produced identical output for "Caveat" and for a\n' +
        '  family that does not exist, so the headline silently fell back. The generated\n' +
        '  fontconfig is not being honoured, or the .woff2 -> .ttf step failed.');
  }
}

/* ===================================================================== */
/* main                                                                   */
/* ===================================================================== */

for (const bin of ['rsvg-convert', 'magick', 'woff2_decompress', 'fc-match']) {
  if (!have(bin)) die(`${bin} is not on PATH (packages: librsvg, imagemagick, woff2, fontconfig)`);
}
if (!fs.existsSync('js/registry.js')) die('run this from the repo root — js/registry.js not found');
if (!fs.existsSync(FONT_WOFF2)) die(`${FONT_WOFF2} not found`);

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/registry.js', 'utf8'), ctx);
const cats = ctx.window.ARTDAILY_CATS || {};

/* 'soon' is a promise, not a page — same rule as build-sitemap.js. */
let live = ctx.window.ARTDAILY_GAMES.filter(g => g.status === 'live');
const only = [...new Set(process.argv.slice(2).filter(a => !a.startsWith('-')))];
const subset = only.length ? live.filter(g => only.includes(g.slug)) : live;

/* ===== the chapter guides =====
   The six guides under practice/ are prose, not drills, so they have no registry
   entry — but they are the pages most likely to be SHARED, because they are what a
   teacher forwards and what a roundup links. Without their own card all seven render
   the generic site image, which is the same failure the drills had.

   Built from ARTDAILY_CATS so the chapter's own icon and note are reused rather than
   restated: the card and the catalogue spread say the same thing because they read
   the same source. `path` differs from `slug` here — the file is og/practice-line.png
   but the wordmark has to read artdaily.sadeali.com/practice/line. */
const GUIDE_ACCENT = {
  colour: 'coral', value: 'sunny', line: 'mint',
  form: 'sky', composition: 'lilac', observation: 'bubblegum',
};
/* the guide's URL segment, where it differs from the registry's chapter id:
   "form" is the chapter, "perspective" is the word people search for. */
const GUIDE_DIR = { form: 'perspective' };

function guideCards() {
  const out = [];
  for (const id of Object.keys(cats)) {
    const dir = GUIDE_DIR[id] || id;
    if (!fs.existsSync(`practice/${dir}/index.html`)) continue;
    const c = cats[id];
    out.push({
      slug: `practice-${dir}`,
      path: `practice/${dir}`,
      name: c.label,
      tagline: c.note,
      icon: c.icon,
      accent: GUIDE_ACCENT[id] || 'sky',
      cat: 'a practice guide',
    });
  }
  return out;
}
const guides = only.length ? [] : guideCards();
if (only.length && subset.length !== only.length) {
  die(`unknown slug(s): ${only.filter(s => !live.some(g => g.slug === s)).join(', ')}`);
}

const fonts = prepareFonts();
const env = { ...process.env, FONTCONFIG_FILE: fonts.cardsConf };
const emojiEnv = { ...process.env, FONTCONFIG_FILE: fonts.emojiConf };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artdaily-og-'));

verifyCaveat(env, tmp);

const metrics = loadMetrics(fonts.ttf);
fs.mkdirSync(OUT_DIR, { recursive: true });

let bytes = 0, smallest = Infinity, smallestSlug = '';
for (const g of subset.concat(guides)) {
  const svg = buildSVG(g, metrics, emojiEnv, cats);
  const svgFile = path.join(tmp, `${g.slug}.svg`);
  const out = path.join(OUT_DIR, `${g.slug}.png`);
  fs.writeFileSync(svgFile, svg);
  execFileSync('rsvg-convert', [svgFile, '-w', String(W), '-h', String(H), '-o', out], { env });
  const size = fs.statSync(out).size;
  /* a card that is a few hundred bytes is a blank card */
  if (size < 20000) die(`${out} is only ${size} bytes — that is a blank card, not a share image`);
  bytes += size;
  if (size < smallest) { smallest = size; smallestSlug = g.slug; }
}

/* keep og/ in sync with the registry, the way sitemap.xml is */
let pruned = [];
if (!only.length) {
  const wanted = new Set(live.concat(guides).map(g => `${g.slug}.png`));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.png') && !wanted.has(f)) { fs.rmSync(path.join(OUT_DIR, f)); pruned.push(f); }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

const mb = (bytes / 1048576).toFixed(2);
console.log(`og/: ${subset.length + guides.length} cards ${W}x${H} · ${mb} MB · smallest ${(smallest / 1024).toFixed(0)} KB (${smallestSlug}) · Caveat verified, ${emojiCache.size} emoji in colour`);
if (pruned.length) console.log(`og/: removed ${pruned.length} stale card(s): ${pruned.join(', ')}`);
