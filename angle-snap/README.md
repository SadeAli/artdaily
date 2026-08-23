# Angle Snap — an Art Daily drill

Eyeball an angle, commit in one stroke. Each item shows an anchor dot A, a grey
**reference** line through it (labelled on the canvas), and a prompt in plain
words — "45° counter-clockwise, from the grey reference line". An amber arrow at
A turns the same way on every item. Pull one stroke; the true ray, a protractor
arc and your "off by N°" appear. Press and hold to study the reveal for as long
as you like, release for the next item.

**Scoring** is pure geometry: the stroke's least-squares direction versus the
target angle, falling linearly to 0 at 27° of error past a free zone.

**The free zone is the hardware's, and only the hardware's.** What this drill
scores is a *direction*, fitted over every sample of the pull, so wobble,
smoothness and speed cancel out of the maths — a shaky mouse line and a
ruler-straight tablet line with the same principal axis score the same. That is
why the 27° falloff is *not* eased: it measures the eye, and the eye is the same
on every desk. What the hardware does touch is the pointing jitter at the two
ends of the pull — ±2.5px is ±3.6° over a 40px pull and ±1.2° over a 120px one,
and a mouse jitters about twice as far as a pen nib. So the free zone is
`min(8°, 2° + atan(ArtDaily.ease(2.5px) / pull))`: it widens on short pulls and
widens again for a mouse or finger, and the drill stops accepting a pull it then
statistically punishes.

**The anchor never refuses a press.** It used to demand a landing inside a 28px
ring, six times a round, at a fresh random spot each time — on a screenless
tablet mapped to a 1920px screen that is a 4.4mm target acquired with your hand
out of sight, and it was the single worst thing in the drill for that hardware.
Since only direction is scored and direction is translation-invariant, a stroke
begun anywhere is simply slid onto A and graded unchanged. The dashed ring
(`ArtDaily.startRadius(28)`) is now a suggestion, and the reveal draws your ink
and the true ray from a shared origin.

**Right size, wrong way** is detected and named. Misreading `+45°` as `−45°`
turned a flawless stroke into a 0 and told a competent beginner their angle
sense was catastrophic. The prompt now spells the direction out as a word
instead of a 3px-wide sign glyph in a handwriting face, and a stroke that lands
within `ease × 8°` of the *mirrored* target gets a named, free retry.

**Also fixed for small and touch hardware**: the canvas runs taller under 520px
(the anchor's placement band had collapsed to 12px on a phone); the resize
handler only re-places A when the width actually changed, so an iOS URL-bar
collapse no longer teleports the anchor mid-round; a pen pointer outranks a palm
that landed first; `pointercancel` and `lostpointercapture` are handled wherever
`pointerup` is; coalesced pointer events keep a 120Hz flick intact; a
single-frame flick falls back to the release position instead of being told it
was "too short"; and the stylesheet suppresses the iOS long-press callout,
double-tap zoom on the controls, and pull-to-refresh.

The first item of every round puts the reference flat or straight up, so the
first judgement of the day is anchored to something you already have an
intuition for.

Plain HTML/CSS/JS, no build, no third-party code in the drill itself; reports to artdaily.sadeali.com via
the repo's own SDK at `../sdk/artdaily-sdk.js` (protocol v1).
Live: https://artdaily.sadeali.com/angle-snap/
