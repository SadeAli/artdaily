/* ============================================================
   registry.js — the Art Daily game registry.
   THIS FILE IS THE ONLY PLACE THE PAGE KNOWS ABOUT GAMES.
   Every game lives in its own repo and deploys on its own URL;
   shipping a new one = push its repo + add one entry here
   (full recipe: GAME_GUIDE.md).
   ============================================================ */

/* Skill taxonomy — filter chips, per-skill progress meters and the
   daily-warmup spread all key off these ids. A game may tag 1–2
   skills (primary first). Add a skill here before using it below. */
window.ARTDAILY_SKILLS = {
  line:        { label: 'line',        icon: '✏️' },
  ellipses:    { label: 'ellipses',    icon: '🪐' },
  shapes:      { label: 'shapes',      icon: '🔷' },
  symmetry:    { label: 'symmetry',    icon: '🦋' },
  perspective: { label: 'perspective', icon: '📐' },
  colors:      { label: 'colors',      icon: '🎨' },
  values:      { label: 'values',      icon: '🌗' },
  contour:     { label: 'contour',     icon: '🫥' },
};

/* Each entry:
   slug    — registry key; repo is github.com/SadeAli/artdaily-<slug>
   accent  — hub palette: coral | sunny | mint | sky | lilac | bubblegum
   skills  — ids from ARTDAILY_SKILLS, primary first
   minutes — honest one-sitting estimate, shown on the card
   url     — where the game is deployed (its own repo's Pages URL;
             swap for a custom domain any time — nothing else changes)
   dev     — sibling path when the whole workspace is served locally,
             so `python3 -m http.server` from sadeali.com/ just works
   status  — 'live' | 'soon'  ('soon' renders a dashed hatching card) */
window.ARTDAILY_GAMES = [
  {
    slug: 'lines',
    name: 'Steady Lines',
    tagline: 'ghost straight strokes through the checkpoints',
    icon: '✏️',
    accent: 'mint',
    skills: ['line'],
    minutes: 3,
    url: 'https://sadeali.github.io/artdaily-lines/',
    dev: '../artdaily-games/lines/',
    status: 'live',
  },
  {
    slug: 'ellipses',
    name: 'Ellipse Orbit',
    tagline: 'draw clean ellipses inside their bounding planes',
    icon: '🪐',
    accent: 'sky',
    skills: ['ellipses', 'line'],
    minutes: 3,
    url: 'https://sadeali.github.io/artdaily-ellipses/',
    dev: '../artdaily-games/ellipses/',
    status: 'live',
  },
  {
    slug: 'colors',
    name: 'Color Mixer',
    tagline: 'mix the exact target color by eye',
    icon: '🎨',
    accent: 'coral',
    skills: ['colors'],
    minutes: 4,
    url: 'https://sadeali.github.io/artdaily-colors/',
    dev: '../artdaily-games/colors/',
    status: 'live',
  },
  {
    slug: 'values',
    name: 'Value Squint',
    tagline: 'sort values and match grays like a squinting painter',
    icon: '🌗',
    accent: 'sunny',
    skills: ['values', 'colors'],
    minutes: 3,
    url: 'https://sadeali.github.io/artdaily-values/',
    dev: '../artdaily-games/values/',
    status: 'live',
  },
  {
    slug: 'symmetry',
    name: 'Mirror Mirror',
    tagline: 'finish the other half of the figure',
    icon: '🦋',
    accent: 'lilac',
    skills: ['symmetry', 'shapes'],
    minutes: 4,
    url: 'https://sadeali.github.io/artdaily-symmetry/',
    dev: '../artdaily-games/symmetry/',
    status: 'live',
  },
  {
    slug: 'perspective',
    name: 'Vanishing Act',
    tagline: 'hunt vanishing points and aim receding edges',
    icon: '📐',
    accent: 'bubblegum',
    skills: ['perspective', 'line'],
    minutes: 4,
    url: 'https://sadeali.github.io/artdaily-perspective/',
    dev: '../artdaily-games/perspective/',
    status: 'live',
  },
  {
    slug: 'contour',
    name: '?????',
    tagline: 'something’s hatching…',
    icon: '🫥',
    accent: 'sunny',
    skills: ['contour'],
    minutes: 0,
    url: '',
    dev: '',
    status: 'soon',
  },
];
