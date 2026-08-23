# Steady Tunnel — Art Daily drill

Steer one line down a winding corridor that narrows as you go. Press in
the coral ring, draw to the flag. Three tunnels per round, each tighter
and curvier; ink that crosses a wall flashes coral the moment it happens.

The corridor is a Catmull-Rom path with walls offset at a linearly
shrinking half-width, so the middle of the tunnel is exact ground truth.
Scoring is pure projection geometry — inside fraction, centering,
coverage — in unit-testable functions at the top of `js/game.js`.

## Fair on the hardware beginners actually own

The drill used to be unplayable on the two most common setups, and the
fixes are the interesting part of the code:

- **The corridor follows the canvas and the input mode.** The half-widths
  were absolute pixels, so a 332px phone got the same 16px slot as a
  692px desktop — a 4mm gap steered by a fingertip that covers it. They
  are now a fraction of canvas height with a 12px floor, passed through
  `ArtDaily.ease()` (pen 1x, finger 1.5x, mouse/trackpad 2x). The wiggle
  is eased alongside the width, so a roomier corridor still has to be
  *steered* rather than cleared with a straight line.
- **A lift is not an ending.** Reaching the flag needed one unbroken drag
  longer than a trackpad's physical throw, and a short run was scored and
  banked with no retry — a flawless half run took ~24/100, three times a
  round. Now a press near where your ink stopped continues the same run,
  and a run that never reaches the flag is never scored at all: the hint
  says how far you got and invites you to carry on.
- **The entry ring snaps.** A press within 3x the ring starts the run
  anyway, pulled onto the entry, with the offset fading over the first
  90px so the ink settles under the pointer. A screenless tablet cannot
  see its own hand, and repeated refusals read as a broken site.
- **Coverage stopped being a secret.** It used to multiply the score
  silently; it is now a gate the player is told about, and the reveal
  names both terms that remain — `inside 92% · centred 71% · 84`.
- **Weights rebalanced** to 0.75 inside / 0.25 centring, so a run that
  never touched a wall reads as clean (87.5) instead of a baffling 77.5.
- Palm rejection (a pen outranks a touch, both directions), coalesced
  pointer events, an rAF-throttled repaint, a windowed nearest-sample
  search that is only trusted when it says *inside*, and a width-guarded
  resize handler so an iOS URL bar no longer swaps the tunnel mid-round.

Live: <https://artdaily.sadeali.com/steady-tunnel/> · part of
[artdaily.sadeali.com](https://artdaily.sadeali.com/). No build step,
no third-party code in the drill itself.
