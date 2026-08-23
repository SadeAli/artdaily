/* ============================================================
   registry.js — the Art Daily game registry.
   THIS FILE IS THE ONLY PLACE THE PAGE KNOWS ABOUT GAMES.
   Every drill is a folder in this repo served at /<slug>/, so an
   entry needs no URL: shipping a new one = add the folder + one
   entry here (full recipe: GAME_GUIDE.md).
   ============================================================ */

/* Skill taxonomy — the paint-tube meters and the per-game chips key
   off these ids. A game tags 1–2 skills (primary first). */
window.ARTDAILY_SKILLS = {
  line:        { label: 'line',        icon: '✏️' },
  ellipses:    { label: 'ellipses',    icon: '🪐' },
  shapes:      { label: 'shapes',      icon: '🔷' },
  symmetry:    { label: 'symmetry',    icon: '🦋' },
  perspective: { label: 'perspective', icon: '📐' },
  colors:      { label: 'colour',      icon: '🎨' },
  values:      { label: 'values',      icon: '🌗' },
  contour:     { label: 'contour',     icon: '🫥' },
  composition: { label: 'composition', icon: '🖼️' },
};

/* A first session for someone who has never drawn here before.
   Deliberately: one drill that needs no drawing at all (a quick win on
   any hardware), one that is satisfying with a mouse, then one real
   stroke drill. The random daily pick can open with something hard —
   a first-timer should not meet Box Check as their first impression. */
window.ARTDAILY_STARTER = ['value-trap', 'colors', 'lines'];

/* Catalogue chapters — the page renders one sketchbook spread per
   category, in this order. A chapter note is the first sentence a
   beginner reads about a whole subject, so it has to gloss its own
   jargon: "value" is the word most likely to bounce off someone on day
   one, and it turns up in four drill names. */
window.ARTDAILY_CATS = {
  colour:      { label: 'colour',             icon: '🎨', note: 'seeing a colour clearly enough to mix it' },
  value:       { label: 'value & light',      icon: '🌗', note: 'value = how light or dark a thing is, colour aside — squint and it is the whole picture' },
  line:        { label: 'line & hand',        icon: '✏️', note: 'confident strokes, drawn from the shoulder' },
  form:        { label: 'form & perspective', icon: '📦', note: 'boxes, planes, and the horizon that rules them' },
  composition: { label: 'composition',        icon: '🖼️', note: 'where things sit in the frame' },
  observation: { label: 'observation',        icon: '👁️', note: 'seeing what is actually there' },
};

/* Each entry:
   slug    — registry key, AND the folder the drill is served from,
             so the page reaches it at '<slug>/' with nothing to keep
             in sync (relative, so file:// and localhost work too)
   cat     — id from ARTDAILY_CATS (which spread it lives on)
   tag     — how it is scored: 'auto' pure math · 'fit' comparison
             algorithm · 'soft' curated answer key
   accent  — palette: coral | sunny | mint | sky | lilac | bubblegum
   skills  — ids from ARTDAILY_SKILLS, primary first
   minutes — honest one-sitting estimate, shown on the card
   status  — 'live' | 'soon'  ('soon' renders a dashed hatching card)
   url     — OPTIONAL. Only for a drill NOT served from /<slug>/; the
             page derives the path from the slug when it is absent. */
window.ARTDAILY_GAMES = [

  /* ---- colour ---- */
  {
    slug: 'colors', name: 'Color Mixer',
    tagline: 'mix the exact target colour by eye',
    icon: '🎨', accent: 'coral', skills: ['colors'],
    cat: 'colour', tag: 'auto', minutes: 4,
    status: 'live',
  },
  {
    slug: 'palette-pick', name: 'Palette Pick',
    tagline: 'pick the 3 colours that carry the scene',
    icon: '🖍️', accent: 'sky', skills: ['colors'],
    cat: 'colour', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'mix-to-target', name: 'Mix to Target',
    tagline: 'blend base pigments into the target colour',
    icon: '⚗️', accent: 'mint', skills: ['colors'],
    cat: 'colour', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'value-trap', name: 'Value Trap',
    /* First drill of the starter session, so this tagline is the first
       instruction a beginner ever reads here: it echoes the drill's own
       opening hint instead of naming "value" at them. */
    tagline: 'tap the colour as light as the grey',
    icon: '🪤', accent: 'sunny', skills: ['values', 'colors'],
    cat: 'colour', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'neutral-hunt', name: 'Neutral Hunt',
    tagline: 'spot the true neutral among the near-greys',
    icon: '🕵️', accent: 'lilac', skills: ['colors'],
    cat: 'colour', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'temperature-sort', name: 'Temperature Sort',
    tagline: 'order the swatches warm to cool',
    icon: '🌡️', accent: 'bubblegum', skills: ['colors'],
    cat: 'colour', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'colour-constancy', name: 'Colour Constancy',
    tagline: 'match what the colour is, not what it looks like',
    icon: '🎭', accent: 'coral', skills: ['colors', 'values'],
    cat: 'colour', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'sun-and-sky', name: 'Sun & Sky',
    /* Filed under colour, not value & light, on purpose: every rung of
       its rail carries the same Rec.709 luminance, so the answer cannot
       be found by value at all — it is a mixing judgement. */
    tagline: 'the sun warms the light, the sky cools the shade',
    icon: '🌤️', accent: 'sky', skills: ['colors', 'values'],
    cat: 'colour', tag: 'auto', minutes: 3,
    status: 'live',
  },

  /* ---- value & light ---- */
  {
    slug: 'values', name: 'Value Squint',
    tagline: 'sort values and match greys like a squinting painter',
    icon: '🌗', accent: 'sunny', skills: ['values', 'colors'],
    cat: 'value', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'sphere-shade', name: 'Shade a Sphere',
    tagline: 'place the terminator, core and bounce light',
    icon: '🌑', accent: 'lilac', skills: ['values'],
    cat: 'value', tag: 'soft', minutes: 4,
    status: 'live',
  },
  {
    slug: 'value-thumbnail', name: 'Value Thumbnail',
    tagline: 'reduce the scene to three flat values',
    icon: '🎞️', accent: 'sky', skills: ['values'],
    cat: 'value', tag: 'fit', minutes: 4,
    status: 'live',
  },
  {
    slug: 'hatch-ramp', name: 'Hatch a Ramp',
    tagline: 'make a gradient with your own hand',
    icon: '🖍️', accent: 'sunny', skills: ['values', 'line'],
    cat: 'value', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'light-direction', name: 'Light Direction',
    tagline: 'read the form, place the light',
    icon: '🔦', accent: 'mint', skills: ['values'],
    cat: 'value', tag: 'auto', minutes: 2,
    status: 'live',
  },

  /* ---- line & hand ---- */
  {
    slug: 'warm-up', name: 'Warm Up',
    tagline: 'loosen the arm — speed over accuracy',
    icon: '🌀', accent: 'mint', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'superimposed', name: 'Superimposed Lines',
    tagline: 'draw the same line four times',
    icon: '✏️', accent: 'sky', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'lines', name: 'Steady Lines',
    /* "ghost" is studio jargon and the drill shows two dots, not
       checkpoints — say what the hand does. */
    tagline: 'press on A, pull one straight stroke to B',
    icon: '✏️', accent: 'mint', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    /* Sits next to Steady Lines because it is the same instrument — one
       committed stroke, graded on how far it strayed — turned through 360
       degrees. It is also the one drill here aimed at a query people
       actually type in numbers ("draw a perfect circle"), which is why it
       exists at all; see TITLE-MAP.md. */
    slug: 'circle', name: 'Full Circle',
    tagline: 'draw one circle freehand, all the way round',
    icon: '⭕', accent: 'lilac', skills: ['line', 'ellipses'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'ellipses', name: 'Ellipse Orbit',
    tagline: 'draw clean ellipses inside their bounding planes',
    icon: '🪐', accent: 'sky', skills: ['ellipses', 'line'],
    cat: 'line', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'draw-through', name: 'Draw Through',
    tagline: 'three laps that land on each other',
    icon: '🛟', accent: 'coral', skills: ['ellipses', 'line'],
    cat: 'line', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'symmetry', name: 'Mirror Mirror',
    tagline: 'finish the other half of the figure',
    icon: '🦋', accent: 'lilac', skills: ['symmetry', 'shapes'],
    cat: 'line', tag: 'fit', minutes: 4,
    status: 'live',
  },
  {
    slug: 'angle-snap', name: 'Angle Snap',
    tagline: 'strike the asked angle without a grid',
    icon: '🧭', accent: 'sunny', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'steady-tunnel', name: 'Steady Tunnel',
    tagline: 'steer one stroke through the narrowing pass',
    icon: '🌀', accent: 'coral', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'even-spacing', name: 'Even Spacing',
    tagline: 'tick and hatch at a steady rhythm',
    icon: '📏', accent: 'bubblegum', skills: ['line'],
    cat: 'line', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'line-weight', name: 'Line Weight',
    tagline: "redraw the stroke's taper on purpose",
    icon: '🖋️', accent: 'sky', skills: ['line'],
    cat: 'line', tag: 'fit', minutes: 3,
    status: 'live',
  },

  /* ---- form & perspective ---- */
  {
    slug: 'perspective', name: 'Vanishing Act',
    tagline: 'hunt vanishing points and aim receding edges',
    icon: '📐', accent: 'bubblegum', skills: ['perspective', 'line'],
    cat: 'form', tag: 'auto', minutes: 4,
    status: 'live',
  },
  {
    slug: 'cube-from-plane', name: 'Cube From Plane',
    tagline: 'grow the face into a correct cube',
    icon: '🎲', accent: 'mint', skills: ['perspective', 'shapes'],
    cat: 'form', tag: 'fit', minutes: 4,
    status: 'live',
  },
  {
    slug: 'box-check', name: 'Box Check',
    tagline: 'draw a box, get a convergence critique',
    icon: '📦', accent: 'coral', skills: ['perspective', 'line'],
    cat: 'form', tag: 'fit', minutes: 4,
    status: 'live',
  },
  {
    slug: 'vp-hunt', name: 'Vanishing Point Hunt',
    tagline: 'find the VPs and horizon in the scene',
    icon: '🔭', accent: 'sky', skills: ['perspective'],
    cat: 'form', tag: 'auto', minutes: 3,
    status: 'live',
  },
  {
    slug: 'rotate-place', name: 'Rotate & Place',
    tagline: 'spin the box into the target pose',
    icon: '🧊', accent: 'lilac', skills: ['shapes', 'perspective'],
    cat: 'form', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'ellipse-in-plane', name: 'Ellipse in Plane',
    tagline: 'lay a correct ellipse onto the face',
    icon: '🥏', accent: 'bubblegum', skills: ['ellipses', 'perspective'],
    cat: 'form', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'cylinder-ends', name: 'Cylinder Ends',
    tagline: 'the far end is rounder — but how much?',
    icon: '🥫', accent: 'sky', skills: ['ellipses', 'perspective'],
    cat: 'form', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'cast-shadow', name: 'Cast Shadow',
    tagline: 'construct the shadow the light demands',
    icon: '🕯️', accent: 'sunny', skills: ['perspective', 'values'],
    cat: 'form', tag: 'fit', minutes: 4,
    status: 'live',
  },
  {
    slug: 'horizon-read', name: 'Horizon Read',
    tagline: "estimate the camera's eye level",
    icon: '🌅', accent: 'coral', skills: ['perspective'],
    cat: 'form', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'cross-contour', name: 'Wrap the Form',
    tagline: 'draw the line that wraps around the form',
    icon: '🍥', accent: 'lilac', skills: ['contour', 'perspective'],
    cat: 'form', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'down-the-row', name: 'Down the Row',
    tagline: 'the gaps close up — draw the next post',
    icon: '🪵', accent: 'mint', skills: ['perspective', 'line'],
    cat: 'form', tag: 'auto', minutes: 3,
    status: 'live',
  },

  /* ---- composition ---- */
  {
    slug: 'crop-it', name: 'Crop It',
    tagline: 'find the strongest crop of the scene',
    icon: '✂️', accent: 'coral', skills: ['composition'],
    cat: 'composition', tag: 'soft', minutes: 3,
    status: 'live',
  },
  {
    slug: 'focal-place', name: 'Focal Placement',
    tagline: 'place the subject where the frame wants it',
    icon: '🎯', accent: 'mint', skills: ['composition'],
    cat: 'composition', tag: 'soft', minutes: 2,
    status: 'live',
  },
  {
    slug: 'counterweight', name: 'Counterweight',
    tagline: 'a small shape far out holds up a big one near the middle',
    icon: '🪶', accent: 'sunny', skills: ['composition', 'values'],
    cat: 'composition', tag: 'fit', minutes: 2,
    status: 'live',
  },

  /* ---- observation & memory ---- */
  {
    slug: 'contour-memory', name: 'Contour Memory',
    tagline: 'see it, lose it, redraw it',
    icon: '🫥', accent: 'sunny', skills: ['contour', 'shapes'],
    cat: 'observation', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'proportion-eye', name: 'Proportion Eye',
    tagline: 'mark the halves and thirds by eye',
    icon: '⚖️', accent: 'mint', skills: ['shapes'],
    cat: 'observation', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'negative-space', name: 'Negative Space',
    tagline: 'draw the gap, not the object',
    icon: '🕳️', accent: 'sky', skills: ['shapes', 'contour'],
    cat: 'observation', tag: 'fit', minutes: 3,
    status: 'live',
  },
  {
    slug: 'anatomy-spot', name: 'Anatomy Spot',
    tagline: 'find the figure with the wrong proportions',
    icon: '🔍', accent: 'bubblegum', skills: ['shapes'],
    cat: 'observation', tag: 'auto', minutes: 2,
    status: 'live',
  },
  {
    slug: 'gesture-capture', name: 'Gesture Capture',
    tagline: 'catch the line of action in seconds',
    icon: '💃', accent: 'lilac', skills: ['line', 'contour'],
    cat: 'observation', tag: 'soft', minutes: 4,
    status: 'live',
  },
];
