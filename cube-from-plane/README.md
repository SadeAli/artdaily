# Cube From Plane 🎲

Grow one drawn face into a correct two-point-perspective cube. Trains
seeing edges as rays to vanishing points instead of "placing corners".

**The drill**: the sheet shows a horizon and one vertical face of a
cube. Drag three numbered corner dots — 1 far-bottom, 2 far-top, 3
top-back — until all nine visible edges converge; press done. Three
boxes per round (two on a first-ever round, so the first reported score
arrives in about a minute), the right VP pulling in each box. Every
attempt ends with the true cube revealed in the accent, edges extended
faintly to the vanishing points (marked with an × on the sheet, or an
edge chevron when they lie beyond it).

**The vanishing point is taught before it is demanded**: during the edit
phase the drawn face's own two horizontal edges are extended, faintly, to
the left VP and labelled *these edges aim here*. The word only appears
once the picture has defined it.

**Real geometry**: the truth is an actual unit cube projected through a
real pinhole camera (`makeCube` in `js/game.js`) — the 90° constraint
ties the vanishing-point pair to the focal length, so the given square
face secretly fixes both VPs. Nothing about the answer is arbitrary: a
player who knows the measuring-point construction can derive it from
the sheet alone.

**Scoring** (pure functions at the top of `js/game.js`): per corner,
`err = dist(placed, true) / faceDiagonal`; a box scores
`100 · clamp(1 − mean(err)/0.30, 0, 1)` with a perfect zone so 100 is
reachable; the round is the mean of the boxes, reported 0–100. The reveal
hint names the dot that landed furthest off, by the number printed beside
it on the sheet — how far off in px, and which way it sat from the true
corner (`offsetWords`, pure), because a bare pixel count is not
something a hand can act on.

**The perfect zone is the hardware's, the ramp is yours.** `perfectZone()`
takes 1.5% of the face diagonal as the pen standard, opens it with
`ArtDaily.ease()` (×2 mouse or trackpad, ×1.5 finger — a wrist cannot
creep the way a nib can) and floors it in *pixels*: at least 4px eased,
9px on a coarse screen. A relative-only tolerance halved on a phone,
where a 140px face diagonal made 1.5% a 2.1px target — under the input
device's own noise. The 0.30 ramp to zero is identical on every device on
purpose: that part is judgement, not hardware. The trackpad's old
penalty is gone too — it reported `pointerType: 'mouse'` and so was held
to the pen's tolerance while a phone got a zone twice as wide.

Dots are grabbed within `ArtDaily.startRadius(26)` — 44px on a pen
tablet, where the hand is out of sight — and a press up to 3× that away
**snaps** to the nearest dot, keeping its grab offset so nothing
teleports. A press with no dot in range now says so instead of returning
in silence. The dots start 25–33% of the diagonal (plus the perfect zone)
off the truth, so pressing done without moving anything can never clear
30 on any hardware — the meter starts where the looking starts.

**Run it**: `python3 -m http.server 8080` in the repo root above this
folder, then open `/cube-from-plane/` — the sdk, the shared chrome and the
font all sit above here, so a server rooted in this folder serves the drill
without any of them. Plain HTML/CSS/JS, zero build, zero deps, no third-party code in the drill itself.

Part of [Art Daily](https://artdaily.sadeali.com/), a sketchbook of tiny
scored drills, from [sadeali.com](https://sadeali.com/).
