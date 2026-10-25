# Working on Active Runner

## Scope and compatibility

- Work in this repository's root game. `local-archive/` holds ignored, local-only
  report/poster projects and a duplicate repository; leave its contents alone
  unless requested.
- Preserve behavior and layout during architectural work. Treat observed original
  behavior as the contract, including quirks. Propose bug fixes separately.
- Read `docs/architecture.md` before changing subsystem boundaries.

## Source ownership

- Edit `src/` for JavaScript, `styles/game.css` for CSS, and `index.html` for markup.
  `dist/game.js` is generated; rebuild it instead of editing it directly.
- Keep media in `assets/images/`, `assets/videos/`, and `assets/audio/` (with
  `music/` and `voice/` subfolders). Update `assets/manifest.json` when adding or
  moving resources. CSS asset URLs resolve relative to the stylesheet.
- Use one focused subsystem per file. Keep private variables inside its factory.
  Shared mutable values belong in `src/core/state.js`.
- Cross-subsystem calls go through the injected `app` capability object. Add or
  change wiring in `src/main.js`; update `scripts/sources.json` for new sources.
- Keep Canvas drawing in `src/rendering/`, body tracking in `src/input/`, game
  progression in `src/game/`, persistence in `src/storage/`, and DOM presentation
  in `src/ui/`. Session orchestration intentionally coordinates these boundaries.
- Preserve the original render/update order. Drawing currently advances some
  animation state and consumes random values; reordering changes behavior.
- Do not add frameworks, change dependency versions, or rewrite inline HTML event
  contracts as part of a structural refactor. Change media paths only when
  requested, relink every reference, and preserve file contents.

## Verification

- Run `npm run build` and `npm run check` after runtime changes.
- Run `npm test` for changes to behavior, wiring, or rendering. Use
  `PLAYWRIGHT_CHANNEL=chrome npm test` if using installed Chrome.
- Keep compatibility tests anchored to original revision `6778c34`. Do not update
  the baseline merely to make a regression pass. Requested behavior changes must
  have explicit scoped exclusions and dedicated tests; see the leaderboard,
  streak, lane-gesture, and player-lock policies in `docs/architecture.md`.
- Enroll or replace tracked players only through explicit calibration. Keep
  matching private to `src/input/player-tracking.js`; ambiguous or missing poses
  must suspend controls rather than silently filling or swapping player slots.
  Keep position readiness and 750 ms per-player torso sampling in
  `src/input/calibration.js`. Start sampling as soon as position is suitable,
  allow natural hand motion, and retain independent readiness. Brief bad frames
  pause progress and block completion; loss over 300 ms clears only the affected
  sample. Camera stalls/time reversal reset all samples. Finalize all locks
  together only after fresh valid confirmation, never from a timer or missing
  poses. Preparation must recover without permanent locks or partial baselines.
  Calibration title/instruction timing belongs in `ui/tracking-status.js`: hold
  each pair for at least 1500 ms and show the latest prompt without queuing old
  ones. Keep completed torso samples while final guidance settles, with fresh
  validation on every camera result. Progress and validation remain immediate.
- Tracking safety belongs in `src/game/tracking-safety.js`. Pause updates and
  rendering together while retaining camera inference. Resolve matches before
  accepting input. Ignore bystanders while all locked players are clearly matched;
  raw pose count alone must not pause gameplay. Ambiguity/long loss must keep
  checking the original slot and require extended stable confirmation, never
  permanently disable matching. Keep ambiguity scoring consistent across recovery
  gates. Keep position/continuity primary
  and shoulder width a soft cue. Do not resume on watchdog checks alone.
- Keep level-arm duck geometry in `src/input/arm-postures.js`. Require outward
  extension, near-horizontal wrists/elbows and reliable joint coordinates; wrist
  height alone must not activate the arm gesture. Physical crouching remains a
  separate duck trigger using the calibrated shoulder baseline.
- Diagnostics are opt-in (`?debug=1`), bounded, and contain no images/audio. Keep
  `debug-logs/` ignored; tests must save in temporary directories. Read
  `docs/debugging.md` when reviewing a human test.
- Keep energy estimation in `src/game/energy.js`, independent of score and speed.
  Final results must use its shared total. Preserve pause exclusion and
  disclose weight/intensity assumptions; see `docs/energy.md`. Keep HUD tiles
  equal in height, with large readable text. The fourth tile shows a live local
  ranking: three nearby saved/live entries including the current name/position.
  Fill from the available side at the top/bottom; never fabricate missing
  entries. Highlight the current row and prefix top-three names with medals.
  Keep unfinished scores out of storage and use the current game mode's board.
- Leaderboards keep one personal best per canonical player name (trim, Unicode
  NFC and lowercase; keep accents). Deduplicate before taking the top five and
  consolidate existing boards without resetting real scores. The live HUD uses
  actual current-run scores alongside all saved records, including same-name
  personal bests. Identify live rows by player slot, never by name. Never
  substitute a personal best or save unfinished live scores.
- Report verification limits, including any lack of physical webcam testing.
- Keep final-camera-photo presentation in `src/ui/finish-photo.js`. Session owns
  the winner decision; pose input supplies only trusted matched head positions.
  Keep photos in memory, clear them on close/replay, preserve aspect ratio and
  mirror crown coordinates with the image. Camera/capture failure must leave
  results usable. Keep the dual photo closeable by keyboard and pointer.
- Leave unrelated existing changes alone. Do not commit or publish unless asked.
