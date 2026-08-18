# Negative Space — an Art Daily drill

Trace the trapped paper, not the objects. Each round builds three
compositions (a mug and its handle hole, a pierced arch, interlocking
arcs, leaning slabs) around one enclosed gap. The gap breathes twice
in a wash, goes silent, and you draw its outline right on top of
the picture — three spaces per round, slimmer each time. The first
space of a fresh round stays tinted while you trace. "show again"
replays the breath without touching your work, "undo" drops the last
stroke, "clear" wipes them all.

The gap polygon is generated *first* and the silhouettes are built
around it, so the ground truth is exact — and its narrow side is
floored in absolute pixels (`ArtDaily.startRadius`), because a gap
thinner than the finger tracing it is not a hard drill, it is an
impossible one. Scoring is a symmetric chamfer between your strokes
and the dense-sampled true boundary: distance is measured point→path
(not point→sample), so a fast, sparsely-sampled drag is not punished
for your device's event rate, and the two directions are combined by
the *worse* one, so being close and being complete both have to hold
(pure functions at the top of `js/game.js`). The chamfer that scores
zero is `max(0.09 × gap diagonal, floor) + slop`, both pixel terms
eased per input mode by `ArtDaily.ease()`, so a phone sheet is not a
stricter drill than a desktop one. Lifting the pointer is free: two
strokes whose lift is shorter than ~6% of the gap diagonal are read as
one line, which is what a short-throw trackpad has to do anyway.
Plain HTML/CSS/JS, no build, no
trackers; protocol via the shared, unmodified `../sdk/artdaily-sdk.js`
— see the repo root's `GAME_GUIDE.md`.

Play it live: https://artdaily.sadeali.com/negative-space/
