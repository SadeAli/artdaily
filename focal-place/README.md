# Focal Placement — an Art Daily drill

Trains subject placement: six generated 3:2 frames per round, each with a
horizon, a wash and (later) a rock or bush. Scribble a quick thumbnail where
the subject goes — the centre of your mark is the placement, so a plain tap
still works — then lock it in. The subject faces the way the prompt says,
and it is drawn into the prompt so you can see it before you mark.

Scoring per frame (curated guidelines, pure functions in `js/game.js`):
thirds proximity 0–50 (distance to the nearest thirds intersection, full
within 6% of the diagonal), breathing room 0–30 (frame fraction ahead of
the facing, full at ≥ 0.5), separation 0–20 (≥ 18% of frame width from the
secondary element; automatic 20 when there is none). Round = mean of six.
Frames are re-rolled until a search over that same scoring proves a full
100 is placeable, so a perfect round is always reachable.

Every lock reveals the split (thirds · room · separation), the best
placement the frame allows as a ghost subject — matching it always scores
full marks — the four thirds anchors ranked behind it, and the breathing
room you actually left as a percentage. Arrows nudge, enter locks.

Run it: `python3 -m http.server 8080` in the repo root one level up — the
page loads its SDK, its chrome and its font from above this folder, so a
server rooted here serves it without them — then open `/focal-place/`.
No build, no deps, no network.

Part of [Art Daily](https://artdaily.sadeali.com/) ·
[more experiments](https://sadeali.com/)

## What changed in the input-fairness pass

Four frames per round, not six — it is a one-verb drill. Frame 1 shows a
faint "somewhere like here" ring so the first mark is informed rather
than blind, the last frame tightens the full-credit radius (and says so)
so an improving player has something to sharpen, and the separation rule
is now DRAWN as the ring you have to stay outside of. The decorative
extreme horizons are gone: none of the three rules ever read them, so
they signalled difficulty the score did not measure.

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

