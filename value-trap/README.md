# Value Trap 🪤

Find the colour that matches the value — a daily drill for
[Art Daily](https://artdaily.sadeali.com/). One grey target chip (L* 30–75)
and six loudly-hued colour chips; exactly one shares the grey's value. Tap it,
then every chip flips to its greyscale equivalent with L* labels — the squint
view — so you see exactly how far off you were. The squint view stays up until
you say so: "next", a tap anywhere on the board including the chips themselves,
Enter, or 1–6 — no timer, so misses can be studied and the final item's squint
view survives round end. A short guard
after each swap ignores taps queued across the change, so a late tap can never
score against an item you never saw. On hover-pointer devices each chip wears
its 1–6 key numeral. Trains value judgement under hue interference: hue is
shouting, value is whispering.

Scoring (sRGB → linear → relative luminance → CIE L*, all pure functions):
correct pick = 100; a miss earns partial credit for being close in value,
`38 · (1 − |L*chosen − L*target| / reach)³`, where `reach` is 3.8× the
closest a wrong chip can sit on that item — so the nearest wrong chip is
worth a visible ~15 whether the item is easy or hard, and the furthest
still fades to nothing.
The fade is cubic on purpose: one chip in six is right by construction, so
blind tapping floors at ~17/100 before any judgement happens — cubic keeps a
blind round near that floor (measured mean 24 over 20,000 simulated rounds)
while a round of nothing but tightest-possible near-misses banks 15.
Round score = mean of 6 items; distractor margins shrink 12 → 5 L* within the round.

Run it: `python3 -m http.server 8080` in the repo root, not this folder —
the SDK, the page chrome and the font are loaded from above it — then open
`localhost:8080/value-trap/`.
No build step, no dependencies, no tracking.

Part of [Art Daily](https://artdaily.sadeali.com/) · a
[SadeAli](https://sadeali.com/) experiment.

## What changed in the input-fairness pass

Six colour chips, not four: one right answer in four meant a blind
tapper banked 25/100 before any judgement at all. The partial credit for
a near miss is now measured against each item's own gap, so the closest
wrong chip is always worth a visible ~15 rather than 3.5 on the easy
items and 20 on the hard one. "L*" is introduced as "value" on item 1,
and the first screen says why value matters at all.

## Input fairness

Nothing in this drill is a stroke, so nothing in it is eased per device.
Reading a colour is the same judgement from a pen, a trackpad or a thumb,
and widening the tolerance for a phone would just hand it free points for
the one thing the drill is actually testing. The HUD's "scoring for…"
chip is the shared SDK reporting which pointer it detected; here it
changes no number.

What hardware *can* decide is whether you are able to enter the answer
you meant, and that is what is guaranteed instead:

* six chips, never under 84px tall (72px below 520px), two or three to a
  row — far above the 44px floor;
* keys 1–6 pick, and any board tap, Enter or a digit advances the squint
  view, so the drill is fully playable without a pointer at all.

The choice is discrete: pointer precision does not enter the score
anywhere. The only clock in the drill is a 250ms guard that ignores taps
queued across a board change, in both directions.

