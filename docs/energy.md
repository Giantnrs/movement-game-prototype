# Energy estimate

`src/game/energy.js` owns per-player calorie totals and a monotonic clock. The
game-over summary reads that total. Starting a run resets it; ending
a run freezes it. Scores, game speed and cumulative gesture counts do not award
calories.

The calculation is `kcal = MET × 3.5 × weightKg / 200 × minutes`. It uses an
explicit **70 kg assumption**, because the game does not collect body weight.
The number is estimated **gross energy** (including standing energy during
play), rather than energy above resting metabolism. The result screen says
“Est. energy”; hover help explains the assumption. Gameplay shows live ranking
instead of calories, and energy accumulation continues privately.

- Quiet gameplay and rest use **1.3 MET**, the Adult Compendium's standing-quietly
  category: [Inactivity](https://pacompendium.com/inactivity/), code 07040.
- A newly accepted lane change, fly or duck starts/extends a **2.5 second** window
  at **3.0 MET**, the light/moderate motion-sensing upper-body video-game category:
  [Video Games](https://pacompendium.com/video-games/), code 22200.
- The 2.5-second window is an application heuristic for recent activity, not a
  validated physiological classifier. Overlapping windows do not stack, and
  actions award no immediate calorie bonus. A fly gesture is not assumed to be
  an actual physical jump. Held postures alone do not continually renew a window.
- Integrate time separately at each intensity when a window ends between frames.
  Rest uses standing intensity even if a prior action window is still open.
- Tracking pauses, hidden tabs, inactive screens and dead/eliminated players
  do not accumulate energy. Pausing clears recent activity and resets the clock
  on resume. A frame gap contributes at most 250 ms, preventing a suspended tab
  or stalled callback from crediting a long unobserved interval. This can
  undercount time on severely stalled devices.

The standard MET conversion is explained by
[ACE Fitness](https://www.acefitness.org/resources/pros/expert-articles/6434/5-things-to-know-about-metabolic-equivalents/).
Compendium values describe typical adult activities; individual energy use varies
with body mass, age, movement and other factors. This camera-based game does not
measure oxygen consumption or individual exertion. See the
[2024 Adult Compendium paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/)
for the population and measurement context.

Unit tests cover the conversion, 15/30/60 Hz clocks, score independence, activity
windows, pause/visibility gaps, per-player totals, rest, death, end and reset.
Browser tests cover the result total and restart in both player modes.
Human webcam tests remain necessary to assess which physical movements are
accepted; the calorie estimate itself is not validated by those tests.
