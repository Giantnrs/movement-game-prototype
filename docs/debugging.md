# Human camera test

Run `npm run build` and `npm start`, then open
[debug mode](http://127.0.0.1:8080/?debug=1). Reload an existing tab to get the new
build. The bottom-left developer panel can be collapsed to clear the play area.

1. Calibrate with only the selected players, standing in the suggested positions.
2. Raise each arm, and both arms, while checking that the same player stays
   locked. Have another person enter at a separate position. The game should
   continue, and the extra candidate should be labeled **ignored**. Bystander
   gestures must not affect a player.
3. Repeat from each side and at different distances in both modes. Closely
   overlapping, equally plausible candidates should pause with an identification
   warning rather than transfer control. Step apart; a clear match held for one
   second should recover automatically.
4. Briefly step out while the bystander stays. The game must pause instead of
   filling your slot with that person. Return to the original position; a stable
   match should recover while the bystander remains. Losses over two seconds or
   ambiguous overlaps require a longer, one-second confirmation near the last
   trusted position. They must not permanently disable matching. **Recalibrate &
   restart** remains an optional restart.
5. After fly and each duck gesture, lower an arm by at least 15 degrees and hold
   briefly, then raise it again after the action ends. The first fresh cycle
   should move once without a cooldown delay. Holding an arm up should not repeat.
6. Check both duck gestures: crouch, or extend both arms to the sides near
   shoulder height with elbows reasonably straight. Bent arms with hands in front
   of the chest alone should not duck. Fly and crossed-arm rest still work.
7. At any mismatch between expected and observed behavior, type what happened
   and click **Mark issue**. Useful notes include who entered/left, which side,
   whether the count changed and whether the score stopped.
8. Click **Finish & save** and wait for `Saved: debug-logs/<session-id>.json`.
   Tell the coding agent the test is done and include the session ID if several
   tabs/tests are running. The agent can read the file directly in the workspace.
   Use **Download log** if autosave fails or testing a static hosted copy.

The panel's camera is raw/unmirrored so its labels agree with detector indexes;
the usual player camera remains mirrored. C0/C1/etc are current detector-order
candidates, not persistent identities. Green `C → P` labels mean a locked slot
accepted that candidate on this frame. Orange **ignored** candidates are
bystanders while all player slots are matched; **unmatched** means no accepted
slot, including during a loss or ambiguity.
The count is the number of poses actually returned by MediaPipe, up to four.
If two people are visible but the count stays at one, the detector did not return
the extra body. Mark overlaps where identity changes or is unclear, so we can
separate detector limitations from matching faults. Extra count alone no longer
pauses play. A single merged pose cannot prove which person it represents.

Each debug session autosaves every two seconds to ignored `debug-logs/` and has a
browser backup in `active_runner_debug_last_session`. Finish stops recording;
reload with `?debug=1` to start a new session. Logs keep only the most recent
2000 events or roughly 800 KB; `droppedEvents` indicates discarded history.
Mark and finish soon after reproducing an issue. Files contain eight body landmarks
per candidate (shoulders, elbows, hips, wrists), confidence, detection counts, timing,
calibration phases/reasons, position/scale match evidence and rejection reasons,
match costs, proposed/accepted assignments, ignored candidate indexes, accepted slot
statuses, pause/resume reasons, input actions, errors, notes and a source build ID.
They contain no camera images or audio. Normal mode does not record diagnostics.

## Reviewing a test

Read the latest session by file modification time, verify `buildId` against the
current bundle, then locate `human.mark` and nearby events by `ms`/`seq`. Check:

- `detection.count` / `pose.observation`: did MediaPipe report the extra person?
- `tracking.frame`: raw/valid counts, profiles, costs, position/scale rejection
  evidence, proposed/accepted assignments, ignored indexes, statuses and camera
  timing. `tracks[].recovery` shows brief/extended confirmation duration, elapsed
  time and fresh sample count. A proposed assignment may be rejected. Count changes alone should not
  pause play while all slots stay tracked.
- `game.pause`, `game.pause_reason`, `game.resume`: was safety applied before input?
- `camera.inference.error`, `runtime.error`, `runtime.rejection`: did processing
  fail, or did camera time stop advancing?
- `input.lane` / `input.jump` / `input.squat`: did an action occur near the issue?
- `input.lane_gate`: which active action blocked lateral input? `blockedBy: null`
  means the posture gate cleared. A held arm still needs a fresh release/raise
  cycle; no post-duck cooldown exists. `levelArms` includes the elbow extension,
  horizontal angles and outward reach used for the arm-based duck decision.
  `duckSource` / squat event `source` distinguish `level_arms` from `crouch`. Older logs
  without elbows can show wrist-position failures but cannot verify elbow shape.

Use the user's observation alongside telemetry. Synthetic regression tests verify
the policy and UI; they cannot establish real-world model detection accuracy.
