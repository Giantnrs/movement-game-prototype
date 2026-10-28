# Active Runner — Canvas 2D

A modular rebuild of the movement game, with the original pose thresholds, frame
timing, scoring, and single/two-player rules retained. Runtime code is organized
into focused subsystems for future development.

Leaderboards now start empty and retain real scores across reloads.
Each leaderboard keeps only the highest score per player name, ignoring case
and surrounding spaces. Existing duplicates are consolidated automatically;
Normal and Chill personal bests remain separate. The live HUD uses each active
player's current-run score alongside all saved results, including their own
historical best as a separate entry. Only the current run is highlighted.
Daily streaks start at Day 1, advance once per local calendar day, and reset after a missed day.
Prototype demo scores and inflated streaks are cleared once after this update;
names and display preferences are retained. The three-day shield bonus is earned
equally by all players, once per day after reaching a streak of at least three.

Each arm raise now changes one lane. To move again with the same arm, lower it
at least 15 degrees, hold it there briefly (150 ms), and raise it again. Noisy
tracking readings are filtered. Holding the arm up does not repeat moves; both
players have independent gesture cycles. After fly or duck ends, a confirmed
fresh lower-and-raise cycle works immediately; there is no post-duck cooldown.
Duck by crouching, or by extending both arms sideways near shoulder height with
reasonably straight elbows. Hands held in front of the chest alone do not duck.

The gameplay HUD uses four equal-height tiles with larger labels and numbers.
In single-player mode, the fourth tile shows three nearby entries including the current live rank/name,
against the current mode's saved local top five and active runs. At the top or
bottom it fills all three rows from the available side, if enough entries exist.
Names ranked first, second and third have 🥇, 🥈 and 🥉 medals.
The current row is highlighted; unfinished scores never change saved results.
In two-player mode, each fourth tile displays that player's name in large,
centered text. HUD labels are translated in English and Māori, while personal
names stay as entered.
Responsive rows preserve readable text on smaller screens.
Score, lives and shields have 🏆, ❤️ and 🛡️ icons alongside their labels.
At game over, a framed final camera image with Active Runner branding, score
and the local finish date (`DD/MM/YYYY`)
appears beside single-player results (below on narrow screens). Two-player mode
first shows a large finish photo with a crown over the winner's last trusted
head position. Close it with × or Escape to see statistics. Photos stay in memory
and are cleared on close/replay; no image is saved or uploaded. If the camera
has no usable frame, results open normally.
Both finish photos receive a fixed +0.7 EV exposure lift; their text and crown
retain their original colors.
Energy and movement counts appear on the result screen. “Est. energy” uses
elapsed playing time and recent accepted movement, assuming 70 kg; tracking
pauses are excluded.
See [energy assumptions and sources](docs/energy.md) for the formula and limits.

Calibration starts automatically once each player is suitably positioned with
shoulders and hips visible. It collects a brief 750 ms torso sample; hands can
move naturally. Players become ready independently in either mode. Brief tracking
glitches pause sampling; a problem lasting over 300 ms clears only the affected
player's progress. Both players must be present and suitable for a fresh final
check before any slots lock. The position zones allow more room to stand apart.
Each on-screen instruction stays for at least 1.5 seconds; progress and position
checks keep updating. A finished sample is retained while the last instruction
settles, so there is no extra sampling window or requirement to restart everyone.
Keep only the intended players in frame while calibrating. During gameplay,
bystanders are ignored while the locked players remain clearly matched. Matching
follows hip position and movement continuity; shoulder width is a soft cue so
arm raises do not fail a fixed shoulder-width check. Missing players, ambiguous
identity or unavailable tracking pause the whole game. Scoring, collisions, timers
and animation freeze; the camera keeps running. The game resumes after everyone
is reliably matched for half a second, even if bystanders remain.
The calibration card shows a mirrored live camera preview in either mode so
players can check that their shoulders and hips are in view.
Brief losses require a stable 300 ms match. After ambiguity or a loss over two
seconds, return near the last trusted position and hold steady for one second.
The system keeps checking the original locked profile and resumes automatically
after confirmation; ongoing ambiguity stays paused. **Recalibrate & restart**
remains an optional way to start a fresh run. This uses body landmarks and motion, so similar bodies can
still be indistinguishable; physical-camera validation remains necessary.

## Run

Requires Node.js 22 or newer for development tools. The game itself remains a static
website and has no new runtime package dependencies.

```sh
npm run build
npm start
```

Open [localhost:8080](http://127.0.0.1:8080). Existing Tailwind and MediaPipe CDN
dependencies still require internet access. Camera access requires localhost or
HTTPS. Deploy the HTML, `dist/`, `src/config/`, `src/audio/music.js`, `src/effects/`,
`styles/`, and `assets/` together. A static deployment can include
the entire `src/` directory for simplicity.

`dist/game.js` is checked in, so the existing static hosting workflow still works.
Rebuild it after changing runtime source files. Styles and page markup remain
directly editable in `styles/game.css` and `index.html`.

Media files are tracked in `assets/images/`, `assets/videos/`, and `assets/audio/`.
Audio has `music/` and `voice/` subfolders. `assets/manifest.json` records the
original and current resource paths; keep it updated when adding or moving media.
HTML and JavaScript use page-relative asset URLs. CSS uses stylesheet-relative
URLs, such as `../assets/images/background.png`.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds, checks and tests
`codex/rebuild-canvas-2d`, then deploys it to GitHub Pages on each push.
It checks out the full history so compatibility tests can read revision
`6778c34`. Manual runs are also available in the Actions tab.

In the GitHub repository's **Settings → Pages**, select **GitHub Actions** as the
publishing source. If the `github-pages` environment restricts deployment branches,
allow `codex/rebuild-canvas-2d` in its environment settings.

To prepare the same static upload locally:

```sh
npm run build:pages
```

This creates ignored `_site/` containing only `index.html`, runtime code,
styles and media. Development files, debug logs and `local-archive/` are excluded.
The build updates the stylesheet URL with a content hash so browsers fetch new
CSS after deployment instead of keeping an older cached layout.
All asset URLs are relative, so the game supports a repository Pages subpath.
The HTTPS site can request camera access; CDN dependencies still need internet.

## Hand-controlled buttons

After starting the camera, raise either hand near shoulder height or above.
Hand control works on interface screens only. Starting a run hides the cursor
and cancels any pending click; it stays disabled during gameplay and tracking
pauses, then becomes available again on the results screen.
A mirrored hand cursor follows it. Move your hand to a visible button and keep
the cursor there for two seconds; the green ring fills, then clicks the button.
Move away or lower your hand before selecting the same button again. Mouse and
keyboard controls still work. Only buttons are selected; typing and scrolling
continue to use the normal controls.
The control area stays fixed while your hand is raised, with smoothing to reduce
camera jitter. Lower and raise your hand to recenter after changing position.
Small movements near a button edge are tolerated. A brief tracking spike pauses
the ring in amber without clicking; a clear movement away cancels the hold.

In two-player mode, Player 1 (the person on the left in the mirrored preview)
controls the cursor. Before calibration, stand on that side with the intended
players clearly separated. After calibration, only the originally matched Player
1 can control it; Player 2 and bystanders cannot take over. The range is relative
to the player's shoulders, so they can reach the whole interface from their side.

Missing/uncertain joints, a camera gap over 250 ms, leaving a button, switching
hands, scrolling or using the mouse/keyboard cancels progress. Background or
unfocused pages cannot click. Progress advances only with fresh camera results.
The camera continues inference on warning, tutorial, dashboard and result screens
so those buttons work too, including closing the final-photo dialog.

This feature needs physical-webcam testing for comfort, lighting and pointing
accuracy. Automated tests use synthetic pose coordinates and camera fixtures.

## Human testing with debug logs

Open [debug mode](http://127.0.0.1:8080/?debug=1). The developer panel shows raw
candidate counts, locked-player matches, pause reasons, and an annotated live
camera. Type a short observation and click **Mark issue** when something goes
wrong. Click **Finish & save** when done, then tell the coding agent to inspect
`debug-logs/`. **Download log** provides a portable JSON copy.

The local `npm start` server automatically saves a bounded recent event history
there every two seconds. That folder is ignored by Git. Logs contain landmark
coordinates and diagnostic events; they contain no camera images or audio.
Without `?debug=1`, the panel and recording are disabled. See
[the human-test guide](docs/debugging.md) for test scenarios and log details.

## Validate

```sh
npm ci
npx playwright install chromium
npm run build
npm run check
npm test
```

To use an installed Chrome instead of downloading Chromium:

```sh
PLAYWRIGHT_CHANNEL=chrome npm test
```

`npm run check` verifies syntax, local resource references (including CSS URLs),
the asset manifest, and reproducible build output. Media tests verify original
file hashes, HTTP content types, and byte-range streaming. The browser suite
compares the rebuild with the original game at Git
revision `6778c34`; retain that revision in the checkout's history. Comparisons
cover original HTML/CSS, DOM state and geometry, Canvas PNG hashes, storage,
audio calls, screen navigation, calibration, gestures, gameplay, and resizing.
Requested leaderboard/streak changes have dedicated tests and explicit exclusions
from the original behavior comparison, without replacing its baseline.
Lane gesture tests additionally cover the 15-degree release/raise cycle and
interactions with ducking, flying, resting, and starting another run.

Browser comparisons use deterministic clocks, random values, animation frames,
software Canvas rendering, and external-service doubles. Tailwind is stubbed in these offline tests; exact
markup, classes, and stylesheet equality separately protect the styled layout,
allowing only the explicit media URL relocation recorded in the manifest.
They do not replace checking a physical webcam and the live MediaPipe service.

See [architecture](docs/architecture.md) for module ownership, startup order, and
compatibility constraints, and [AGENTS.md](AGENTS.md) for coding guidance.

Unrelated Overleaf projects, their ZIP, a duplicate repository, and Finder
metadata are stored in `local-archive/`.
That folder is ignored by Git and is local-only; it is not part of the game or
included in fresh checkouts.
