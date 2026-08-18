# Temperature Sort 🌡️

Order five swatches warm → cool: drag chips into place, or tap one then
another to swap (the keyboard/assistive path). Trains colour-temperature
judgement on the unambiguous orange→yellow→green→blue arc
(magenta/purple stay out — their temperature is context-dependent).
Swatches share lightness and chroma (OKLCH, gamut-fitted) so hue is the
only honest cue; hue gaps shrink from ~45° to ~16° across a round's 4 sets.

Scoring: Kendall's tau rescaled to 0–100 — (concordant − discordant
pairs) ÷ 10 pairs × 100, floored at 0, per set; round = mean of the 4
sets. Perfect = 100, one adjacent swap = 80 (each inversion costs 20),
reversed = 0. Tau rather than raw concordance because raw concordance
pays a shuffled row exactly 50/100 on average — a shrug scored as half
marks; under tau a shuffle averages ~16. After each set the true warmth
ranks and hue-arc positions are revealed on a warm→cool strip (the
numbers carry the split — accent sat at its true rank, graphite was
misplaced — and a correct swatch's tick is drawn heavier; the strip's
space is always reserved so buttons never shift).

Run: `python3 -m http.server 8080` in the repo root, not this folder —
the SDK, the page chrome and the font are loaded from above it — then
open `localhost:8080/temperature-sort/`.
Part of [Art Daily](https://artdaily.sadeali.com/) · [sadeali.com](https://sadeali.com/).

## What changed in the input-fairness pass

The drag threshold is eased per hardware and floored at 10px: at 6px an
ordinary trackpad tap crossed it, moved nothing, and then had its click
swallowed — so roughly every other tap silently did nothing. A gesture
that ends in the slot it started in is now treated as a tap. The score's
zero point sits below a shuffle rather than at it, so "half the pairs
right" reads 17 instead of 0; the tap-to-swap path has a visible line of
its own; and the warm→cool arc is shown unmarked before the first scored
set so the two words are anchored by something you can see.

## Input fairness

Nothing in this drill is a stroke, so nothing in it is eased per device.
Reading a colour is the same judgement from a pen, a trackpad or a thumb,
and widening the tolerance for a phone would just hand it free points for
the one thing the drill is actually testing. The HUD's "scoring for…"
chip is the shared SDK reporting which pointer it detected; here it
changes no number.

What hardware *can* decide is whether you are able to enter the answer
you meant, and that is what is guaranteed instead:

* the drag threshold is the one number this drill eases:
  `Math.max(10, ArtDaily.ease(6))` — 12px on a mouse or trackpad, 10px on
  a pen or a finger. The old flat 6px sat under the drift of an ordinary
  trackpad tap, so roughly every other tap crossed it, moved nothing, and
  had its click swallowed;
* a chip that wanders past the threshold and lands back in its own slot
  is treated as a shaky tap, not a drag, and the click is let through;
* tap-one-then-another swaps two chips, so a trackpad, a keyboard or an
  assistive device never has to drag at all;
* chips are `flex: 1` with a hard `min-width: 44px`, 72px tall (60px
  below 480px), and `touch-action: pan-y` keeps vertical page scrolling
  working while horizontal drags sort.

The score itself — Kendall's tau on the order you leave behind — is
identical on every device.

