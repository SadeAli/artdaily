# Value Squint — sort values and match grays

A daily drill for value control: seeing lightness on its own, with hue and
chroma squinted away. Six items per round (~45 seconds): sort three gray
ladders light → dark (tap two chips to swap; ranges narrow as you go), then
match a gray to a colored swatch's value three times (saturation drops, so the
near-grays get sneaky). Each match takes either input — drag the **slider**, or
switch to the **hatch** pad and scribble strokes onto white paper until the
coverage holds the same tone. Both feed the identical L\* pipeline, so hatching
trains the drawing hand against the same ruler.

Scoring is honest geometry. Ladders use Kendall tau over the 15 chip pairs —
`100 · max(0, 2·ordered/15 − 1)` — so a perfect light → dark run is 100, a
reversed one is 0, and the shuffle you were dealt is worth ~0 until you actually
sort it. Matches convert both swatches to CIE L\* via relative luminance (the
hatch pad averages its pixels in *linear* light, the way squinting really blurs
them) and score `100 · (1 − ΔL*/22)`, with the first 1 L\* forgiven for slider
granularity. Round score = mean of the six items, 0–100. After every item the
ideal answer is revealed over your attempt, and it waits for you — nothing
auto-advances.

## What changed in the input-fairness pass

The hatch pad is usable on a trackpad: a fat translucent nib covers the
whole range in five to ten passes instead of 26-39, with an eraser and a
stroke-level undo so one overshoot no longer costs the item. The tone is
painted from the whole stroke in one pass, so a 120Hz pen and a 60Hz
mouse darken the paper identically. Because hatching is a drawn mark, its
window is eased per hardware; the slider, which is pure eye, is not — and
only the HAND's share is eased, not the whole window. The pen keeps the
slider's own 22 L\*; a finger gets 27 and a trackpad 32. It used to be
`ease(22)`, i.e. 44 on a trackpad, and at 44 an untouched white pad scored
above zero on 54% of deals and up to 87/100 for laying no ink at all. A pad
with no ink on it is no longer an answer at all: it cannot be locked in.
"L*" is spoken as "steps out of 100" on screen.

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

## Run it

No build step, no dependencies — but serve the **repo root**, not this
folder. The drill loads `../sdk/artdaily-sdk.js`, `../js/main.js` and the
font from above itself, so a server rooted here starts it with no SDK, no
chrome and no font:

```sh
cd ..                 # the artdaily repo root
python3 -m http.server 8080
# then visit http://localhost:8080/values/
```

Part of [Art Daily](https://artdaily.sadeali.com/), a
[SadeAli](https://sadeali.com/) experiment.
