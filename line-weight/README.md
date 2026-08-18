# Line Weight — an Art Daily drill

Live: https://artdaily.sadeali.com/line-weight/ · plays inside the
[Art Daily](https://artdaily.sadeali.com/) player via the shared SDK.

The top ribbon is one stroke that gets thicker and thinner along its
length (thick→thin, thin→thick, thin-thick-thin, two bumps, freehand).
Redraw it on the dashed guide below with the thicks and thins in the
same places. Five strokes per round, difficulty ramps through the
shapes.

**How you ask for thickness.** A pen that reports pressure uses
pressure. Everything else — mouse, trackpad, finger — uses **height
above the guide**: ride the dashes for a hairline, climb into the
shaded band above them to lay weight on, and a live dot shows the width
you are asking for. The old fallback drove width from pointer *speed*,
which is the OS pointer-acceleration curve applied to hand speed: a
mouse player was scored against their system preferences slider, the
heaviest widths needed a ~40 px/s crawl, and the naturally ballistic
slow-fast-slow of a drag is the inverse of nearly every target shape —
an honest mouse attempt scored 0 on all five profiles. Height is
aimable by every device, and it teaches the same lesson: *where* the
weight goes.

**Lifting is free.** Position along the drill is horizontal progress
across the guide, not arc length, so an attempt can be pulled in as
many passes as the hardware needs — a trackpad cannot cross 650px in
one contact, and that is the trackpad's business, not a drawing fault.
Press again anywhere and carry on filling the line in; nothing is
scored until the guide is inked end to end (97% — 63 of the 64
positions, so at most one is ever flat-extrapolated), and “start this
stroke over” wipes an attempt at no cost. A lift that leaves one END
bare says which end, because “you lifted at 95%” names a number and no
direction, and pulling the same honest sweep again lands on the same
95%. Dwelling registers instead of vanishing, and a stolen gesture
(`pointercancel`, `lostpointercapture`) is a free lift rather than a
score.

**Scoring** takes both width profiles over 64 evenly spaced positions,
min-max normalizes them (shape match, not absolute size) and scores the
RMS difference. The RMS that reaches zero is `ArtDaily.ease()`d per
input mode and capped at 0.50 — measured, not taste: a constant-weight
stroke, the exact mistake the drill corrects, sits at ~0.34 RMS and
noise at ~0.42, so a zero point past 0.5 would start paying for the
failure. Pen keeps exactly the standard it had (0.34); mouse/trackpad
and finger get 0.50. A one-weight stroke loses 20%, and that gate is
widened by the same ratio. The HUD says which mode it scored for and
the reveal chip repeats it — scores are only ever compared against your
own history, so easing per mode is fair.

Also: the width source is locked at the press that opens an attempt and
never switches mid-stroke; pressure is pen-only (an Android finger's
`pressure` is contact-area squash, not intent); a pen pointerdown evicts
a palm that landed first; coalesced events keep a 120Hz sweep intact;
and the sheet is taller on phones.

Zero build, no trackers: plain HTML/CSS/JS. Run `python3 -m http.server 8080`
in the repo root one level up — the SDK, the page chrome and the font come from
`../`, so a server rooted in this folder cannot reach them — then open
`http://localhost:8080/line-weight/`.
