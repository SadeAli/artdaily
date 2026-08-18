# Colour Constancy 🎭

Match what the colour *is*, not what it looks like. One coloured light tints a
whole mini-scene — the ground, a white card, a grey block, an off-hue prop, and
the patch. The scene is composed honestly as reflectance × illuminant per
channel in **linear RGB** (a tinted light only removes energy, so nothing ever
clips); you discount the light and rebuild the patch's true surface colour with
hue/sat/light sliders (plus ±1 nudge buttons — tap for exactly one step, hold to walk — for exact landings on touch) on a
neutral grey field, then lock it in. Four colours per round — the light gets
stronger and the patch more muted, so the cast bites harder as you go. A tinted
light can only take energy away, so a deal now and then would barely move the
patch at all (nothing blue to remove under a yellow light); those are re-dealt,
because an item where "copy what you see" already wins teaches nothing.

Scoring: per colour, ΔE (CIE76) between your lock and the true reflectance →
`100 × clamp(1 − ΔE/30, 0, 1)`; the round score is the mean of the four (shown
running in the HUD as you lock). Every reveal switches the light to neutral so
you watch the cast fall away, and prints your signed hue/sat/light misses; the
round ends with your average bias — which way your eye leans against coloured
light.

Run it: `python3 -m http.server 8080` in the repo root above this folder
(the drill loads its sdk, chrome and font from up there), open
`localhost:8080/colour-constancy/`.
No build, no deps, no network. Part of [Art Daily](https://artdaily.sadeali.com/),
a [SadeAli](https://sadeali.com/) experiment.

## What changed in the input-fairness pass

The three anchor objects are labelled on screen (white card / grey block
/ prop) and the white card is drawn largest — following the drill's only
instruction used to require finding three unlabelled 26px squares. The
patch is named while you play. Scoring now measures the lesson rather
than your slider hand: the part of your miss lying along the light's own
direction is charged at full rate and ordinary slop across it at 30%, so
understanding the light and being a few degrees out beats being precise
about the wrong colour. The sliders open near what the patch LOOKS like
(pushed further into the cast, so it is never a free score) rather than
on an unrelated teal.

## Input fairness
One thing this drill deliberately does NOT ease: the score. `ZERO_ERR = 30` is the same
ΔE on every device. What it does instead is make the exact answer reachable
from any of them — the slider row goes two-line on a phone so the hue track
is ~228px rather than ~152px (1.57°/px, not 2.36°/px), and holding a ±
button walks the value instead of stepping it. Measured: a player who read
the light perfectly and missed only by where their finger landed used to
score a mean 74.6 on a phone against 96.2 on a laptop; the wider track alone
takes that to 82.6, and one short hold on the stepper takes it to 100.


Scores are only ever compared against your own history, so the drill
eases its tolerances for the hardware in your hand and says which one it
eased for (the "scoring for…" chip in the HUD). A pen keeps the strict
reference; a mouse or trackpad, which pivots at the wrist and cannot
creep, gets roughly double the room; a finger sits between. Start and
grab zones move the other way — a screenless tablet needs the *biggest*
targets, because the hand is out of sight. Relative tolerances carry an
absolute pixel floor so a phone is never held to a stricter standard
than a desktop for the same drill.

