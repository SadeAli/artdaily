# Value Thumbnail 🎞️

Reduce the scene to three flat values. Each round paints one procedural
landscape; you rebuild its value pattern on a 12×8 grid. Two inputs,
same scoring: **tile mode** — pick a brush swatch and drag to paint
cells (a plain tap cycles a cell light → mid → dark and picks that
value up as your brush); **brush mode** — paint the thumbnail freehand
in strokes, which get downsampled onto the same 12×8 grid on "done".
Trains squinting and mass-shaping: seeing (and painting) the big value
pattern instead of the objects.

Scoring: the scene renders to an offscreen canvas, each cell averages
to a luminance, and natural-breaks clustering (exact Fisher–Jenks,
k = 3) of those means defines the scene's own light/mid/dark cuts — so
smooth gradients don't hide arbitrary tercile lines. Cells whose mean
sits within ε of a cut are borderline: either neighbouring value earns
full credit and the reveal marks them dotted. Exact cell = 1, one step
off = 0.15, flipped = 0; the mean is then rescaled against the best
flat one-value grid, which lands exactly on 30 — perfect is 100, zero
observation can't beat 30.

After "done" the true map overlays your grid (dashed = one off,
solid = flipped, dotted = borderline), tapping the grid flips your
answer ↔ the full truth pattern, and tapping the scene flips it to its
three-value poster. "new round" asks before discarding painted work.

Run: `python3 -m http.server 8080` in the repo root, not this folder —
the SDK, the page chrome and the font are loaded from above it — then
open `localhost:8080/value-thumbnail/`. Plain files, no build.

Part of [Art Daily](https://artdaily.sadeali.com/) · a [SadeAli](https://sadeali.com/) experiment.

## What changed in the input-fairness pass

Lifting mid-drag no longer corrupts the thumbnail. A trackpad cannot
cross 96 cells in one throw, and every re-place that landed inside a
single cell used to read as a deliberate tap — cycling that cell AND
stealing the brush, so the next drag painted dozens of cells the wrong
value. A press that lands near the last lift, soon after, now continues
the same stroke, and picking up a value is the swatches' job alone. The
grid opens on mid rather than on the loudest wrong answer, the 12×8 guide
stays visible over the freehand pad, and "flipped" is defined where it
first appears.

## Input fairness
The lift-and-re-place window that lets a trackpad cross 96 cells in several
throws (`RESUME_MS 450`, `RESUME_PX 48`) is a trackpad affordance, so it now
only applies to `pointerType === 'mouse'`. A finger and an absolute-mapped
pen never run out of surface, and on a phone 48px is not quite two cells —
so the ordinary habit of painting a mass and then tapping a neighbour to fix
it landed inside the window and painted instead of cycling.


Scores are only ever compared against your own history, so the drill
eases its tolerances for the hardware in your hand and says which one it
eased for (the "scoring for…" chip in the HUD). A pen keeps the strict
reference; a mouse or trackpad, which pivots at the wrist and cannot
creep, gets roughly double the room; a finger sits between. Start and
grab zones move the other way — a screenless tablet needs the *biggest*
targets, because the hand is out of sight. Relative tolerances carry an
absolute pixel floor so a phone is never held to a stricter standard
than a desktop for the same drill.

