# Neutral Hunt 🕵️

Spot the true neutral among the near-greys — a colour drill that trains
your eye to catch subtle temperature casts, the ones that sneak into
"grey" mixes on the palette.

Each grid shows nine chips at similar L\* (50–65): eight carry a Lab
temperature cast (hues ≥ 25° apart), one is a true neutral (C < 0.5).
Tap the neutral; every attempt reveals each chip's cast ("warm +7",
"cool +4", "neutral" — violet and magenta casts are named rather than
called warm/cool, since their temperature is context-dependent). The
reveal shows the pick's score and lingers longer on a wrong pick
(2.6 s vs 1.2 s); tap anywhere on the revealed grid to advance early.
Five grids per round, casts shrinking from C 10–16 down to C 3.5–6.
Scoring: correct = 100, wrong = `100 · clamp(1 − C/Cmax, 0, 1) · 0.55`
where `Cmax` is the strongest cast on that grid (rounded per grid); the
round is the mean of five, with the per-grid breakdown shown at round
end. Grading each miss against its own grid keeps the credit honest —
the casts shrink as the round goes on, so a fixed yardstick would pay
more for missing the hard grids than the easy ones. Tapping at random
lands near 19/100; the neutral is the only route to 100.

Run it: `python3 -m http.server 8080` in the repo root one level up, then open
`http://localhost:8080/neutral-hunt/` — the SDK, the page chrome and the font
live at `../`, out of reach of a server rooted in this folder. Zero build,
zero deps.

Part of [Art Daily](https://artdaily.sadeali.com/) · more at [sadeali.com](https://sadeali.com/).

## What changed in the input-fairness pass

The reveal no longer auto-advances. It used to expire 1.2s after a
correct pick with the fresh grid live 250ms later, so an acknowledging
click landed as a real, scored pick on a grid the player had never seen.
Now nothing changes until you press "next grid" or tap the grid. The
late grids' casts stop at 5 units instead of 3.5 (below that an
uncalibrated laptop panel simply cannot show them), the page opens with a
one-line screen check about blue-light filters, and the reveal explains
what the "+12" on a cast pill means.

## Input fairness

Nothing in this drill is a stroke, so nothing in it is eased per device.
Reading a colour is the same judgement from a pen, a trackpad or a thumb,
and widening the tolerance for a phone would just hand it free points for
the one thing the drill is actually testing. The HUD's "scoring for…"
chip is the shared SDK reporting which pointer it detected; here it
changes no number.

What hardware *can* decide is whether you are able to enter the answer
you meant, and that is what is guaranteed instead:

* nine chips in a 3×3 grid, never under 56px tall (48px below 480px) and
  typically much wider — well above the 44px floor;
* nothing ever advances on a timer: the reveal stays up until you ask for
  the next grid, and a 250ms guard stops a double-tap landing as a pick
  on a grid you have not looked at.

The choice is discrete: pointer precision does not enter the score
anywhere. What *does* vary by hardware is the screen — the casts shrink
to C 5–7 by grid 5, which is why the floor was raised off 3.5, below
what an uncalibrated laptop panel can show.

