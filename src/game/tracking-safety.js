/** Freeze gameplay until all locked players can be trusted again. */
function createTrackingSafety({ state, app }) {
    const RESUME_MS = 500;
    let paused = false, reason = null, healthySince, healthyFrames = 0, lastFrame;

    function resetTrackingSafety() {
        paused = false;
        reason = null;
        healthySince = undefined;
        healthyFrames = 0;
        lastFrame = undefined;
    }

    function safetyStatus() { return { paused, reason }; }
    function isGameplayPaused() { return paused; }

    function updateTrackingSafety(statuses, report, camera) {
        if (state.game.gameState !== 'playing' || statuses.every(status => status === 'unregistered')) return safetyStatus();
        let next = camera.trackingError ? 'tracking_error' : camera.playbackError ? 'camera_error'
            : statuses.some(status => status === 'uncertain') ? 'player_uncertain'
            : statuses.some(status => status !== 'tracked') ? 'player_lost' : null;
        const now = performance.now();
        if (next) {
            healthySince = undefined;
            healthyFrames = 0;
            lastFrame = undefined;
            if (!paused) {
                app.energy.suspendEnergy(true);
                paused = true;
                app.simulation?.resetFrameClock();
                app.audio.bgMusic.pause();
                app.debug.record('game.pause', { reason: next, detected: report.rawCount, expected: state.session.numPlayers, statuses });
            }
        } else if (paused) {
            if (healthySince === undefined) healthySince = now;
            if (report.frameId !== lastFrame) { healthyFrames++; lastFrame = report.frameId; }
            if (now - healthySince >= RESUME_MS && healthyFrames >= 3) {
                paused = false;
                app.simulation?.resetFrameClock();
                app.energy.suspendEnergy(false);
                app.debug.record('game.resume', { healthyMs: now - healthySince, healthyFrames });
                app.audio.bgMusic.play().catch(error => app.debug.record('audio.resume.error', { message: String(error) }));
            } else next = 'recovering';
        }
        if (reason !== next) app.debug.record('game.pause_reason', { from: reason, to: next });
        reason = next;
        return safetyStatus();
    }

    return { resetTrackingSafety, safetyStatus, isGameplayPaused, updateTrackingSafety };
}
