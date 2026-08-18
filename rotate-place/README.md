# Rotate & Place 🧊

Spin the box into the target pose. A small panel shows an elongated box
(2:1:1.4, one face painted with a dot) at a hidden yaw/pitch; drag the big
box — sideways = yaw, up/down = pitch — until it matches, then lock it in.
Five boxes per round, ramping from near-canonical views to rear-quarter
extreme tilts. Trains mental rotation of primitive forms — the core move
behind drawing boxes, heads and furniture from any angle.

The box is a real solid under a real pinhole camera: the eye sits at
`(0, 0, 9)` in box half-extent units and every vertex divides by its
depth. The projection scale is `9 / (9 − z)`, so it spreads 1.34× across
the solid and at a three-quarter view the near vertical edge comes out
about 30% longer than its far twin — parallel edges converge exactly as
they do in a drawing. Faces are culled
by the true eye-side test (`CAM_D·n_z > half extent`, not a flat
`n_z > 0`), shaded by a real light vector against real normals, and the
painted dot is a circle in the face plane projected point by point, so it
foreshortens and skews honestly.

Fairness note: rotating a cuboid 180° about its own Y axis maps its
vertex set onto itself, so a pose and its twin project to the *same*
outline — under perspective every bit as much as under orthographic. The
painted dot is the only tell, so the generator refuses any target whose
dot face grazes the eye: `|cos(pitch)·cos(yaw)|` must clear the
visibility threshold `HZ / CAM_D` by a margin, which is also why the
steepest tilt stops at 72°.

Scoring is the pure rotation gap: the angle of the relative rotation
between your orientation and the target's (`acos((trace(Ra′·Rb) − 1) / 2)`);
0° off scores 100, 40° off scores 0, round score is the mean of five.
Every lock snaps your pose to whole degrees — targets are whole degrees,
so an exact 100 is reachable by drag, not just by arrow key. After each
lock the target is ghosted over your box and the reveal names the fix in
words: *off by 7.2° — spin 5° right, tip 4° up*.

No dot in the target means you are looking at the back of the box; the
hint says so out loud on the poses where it happens.

Run it: `python3 -m http.server 8080` in the repo root one level up, open
`http://localhost:8080/rotate-place/`. Serving this folder on its own hides the
SDK, the page chrome and the font it loads from `../`. No build, no
dependencies.

Part of [Art Daily](https://artdaily.sadeali.com/) · more at
[sadeali.com](https://sadeali.com/).

## What changed in the input-fairness pass

Drag gain accelerates with pointer speed, so a 170° turn is one trackpad
swipe rather than three, while slow work stays at the fine 0.5°/px. Hold
shift to spin only, alt to tip only — with one free two-axis gesture,
every correction to one axis disturbed the other. The target panel is
bigger, each box opens at a small non-zero pose so it reads as a box from
frame one, the arrow-key path is named in the hint instead of only in the
how-to, and the first two boxes of a first round show the target ghosted
faintly over your own as a scaffold.

## Input fairness

Scores are only ever compared against your own history, so the drill
eases its tolerances for the hardware in your hand and says which one it
eased for (the "scoring for…" chip in the HUD). A pen keeps the strict
reference; a mouse or trackpad, which pivots at the wrist and cannot
creep, gets roughly double the room; a finger sits between. Start and
grab zones move the other way — a screenless tablet needs the *biggest*
targets, because the hand is out of sight. Relative tolerances carry an
absolute pixel floor so a phone is never held to a stricter standard
than a desktop for the same drill.

