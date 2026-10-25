# Tracking recovery fixtures

`tracking-recovery.json` retains anonymized matching geometry around the two
reported recovery failures. It excludes images, names, notes, browser metadata
and raw landmarks. Values are rounded to seven decimal places.

Each frame contains elapsed milliseconds and candidate arrays in this order:
`[raw index, hip center x, hip center y, shoulder width, hip width, torso length]`.
Horizontal coordinates and dimensions already account for the 4:3 camera aspect
ratio. The tests reconstruct equivalent poses for the matching subsystem.

These are sampled debug observations and transition events, not every original
camera frame. They test the recorded matching/recovery sequence; browser tests
separately exercise gameplay pausing, input suspension and automatic resume.
