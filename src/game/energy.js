/** Time-based gross energy estimate; assumptions and sources: docs/energy.md. */
function createEnergy({ state, app }) {
    const WEIGHT_KG = 70;
    const STANDING_MET = 1.3, ACTIVE_MET = 3;
    const ACTION_WINDOW_MS = 2500, MAX_FRAME_GAP_MS = 250;
    let records = new WeakMap(), lastAt = 0, running = false, suspended = false;

    function estimateKcal(met, milliseconds, weightKg = WEIGHT_KG) {
        if (![met, milliseconds, weightKg].every(Number.isFinite) || met < 0 || milliseconds < 0 || weightKg <= 0) return 0;
        return met * 3.5 * weightKg / 200 * milliseconds / 60000;
    }

    function energyAssumptions() {
        return { weightKg: WEIGHT_KG, standingMet: STANDING_MET, activeMet: ACTIVE_MET,
            actionWindowMs: ACTION_WINDOW_MS, kind: 'estimated gross kcal' };
    }

    function resetEnergy() {
        records = new WeakMap();
        for (const player of state.game.players.slice(0, state.session.numPlayers)) {
            records.set(player, { kcal: 0, activeUntil: 0 });
        }
        running = true;
        suspended = false;
        lastAt = performance.now();
    }

    function updateEnergy() {
        if (!running) return;
        const now = performance.now();
        const milliseconds = Math.max(0, Math.min(MAX_FRAME_GAP_MS, now - lastAt));
        lastAt = now;
        if (suspended || state.game.gameState !== 'playing' || app.trackingSafety.isGameplayPaused() || document.hidden) return;
        for (const player of state.game.players.slice(0, state.session.numPlayers)) {
            const record = records.get(player);
            if (!record || player.lives <= 0 || player.eliminated) continue;
            const activeMs = player.isResting || player.restingMode ? 0
                : Math.max(0, Math.min(now, record.activeUntil) - (now - milliseconds));
            record.kcal += estimateKcal(ACTIVE_MET, activeMs) + estimateKcal(STANDING_MET, milliseconds - activeMs);
        }
    }

    function recordEnergyAction(player) {
        updateEnergy();
        if (!running || suspended || state.game.gameState !== 'playing' || app.trackingSafety.isGameplayPaused() || document.hidden) return;
        const record = records.get(player);
        if (record) record.activeUntil = performance.now() + ACTION_WINDOW_MS;
    }

    function suspendEnergy(value) {
        updateEnergy();
        suspended = value;
        lastAt = performance.now();
        if (value) for (const player of state.game.players) {
            const record = records.get(player);
            if (record) record.activeUntil = 0;
        }
    }

    function stopEnergy() { updateEnergy(); running = false; }
    function readEnergy(player) { return records.get(player)?.kcal || 0; }

    return { estimateKcal, energyAssumptions, resetEnergy, updateEnergy, recordEnergyAction, suspendEnergy, stopEnergy, readEnergy };
}
