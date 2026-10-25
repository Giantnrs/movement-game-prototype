/** Presentation only; identity matching remains in input/player-tracking.js. */
function createTrackingStatus({ state, app }) {
    const notice = document.getElementById('player-tracking-notice');
    const message = document.getElementById('player-tracking-message');
    const button = document.getElementById('btn-recalibrate-players');
    const MESSAGE_HOLD_MS = 1500;
    let calibrationText = null, shownAt = 0, latestCalibration = null, preparing = false;

    function resetCalibrationMessages() {
        calibrationText = latestCalibration = null;
        preparing = false;
        shownAt = 0;
    }

    function showCalibrationText(title, text) {
        const now = performance.now();
        const same = calibrationText?.title === title && calibrationText?.text === text;
        if (!same && (!calibrationText || now - shownAt >= MESSAGE_HOLD_MS)) {
            document.getElementById('txt-stand-still').textContent = title;
            document.getElementById('txt-learning').textContent = text;
            calibrationText = { title, text };
            shownAt = now;
        }
        return calibrationText?.title === title && calibrationText?.text === text && now - shownAt >= MESSAGE_HOLD_MS;
    }

    function showCalibrationPreparation() {
        resetCalibrationMessages();
        preparing = true;
        refreshCalibrationLanguage();
    }

    function refreshCalibrationLanguage() {
        if (preparing) {
            const copy = app.localization.translations[document.getElementById('lang-select').value].calibration;
            showCalibrationText(copy.titles.waiting, copy.prepare);
        } else if (latestCalibration) renderCalibration(latestCalibration);
    }

    function clearTrackingStatus() {
        notice.hidden = true;
        message.textContent = '';
        app.hud.layoutGameplayNotices();
    }

    function refreshTrackingStatus(statuses, safety = app.trackingSafety.safetyStatus(), report = app.playerTracking.trackingReport()) {
        if (state.game.gameState !== 'playing') { clearTrackingStatus(); return; }
        const missing = statuses.map((status, index) => ({ status, index }))
            .filter(item => item.status !== 'tracked' && item.status !== 'unregistered');
        if (!safety.paused && !missing.length) { clearTrackingStatus(); return; }
        const dict = app.localization.translations[document.getElementById('lang-select').value];
        const names = [state.session.currentPlayerName, state.session.currentPlayer2Name];
        const key = safety.reason === 'player_uncertain' ? 'trackingUncertain'
            : ['tracking_error', 'camera_error'].includes(safety.reason) ? 'trackingError'
            : safety.reason === 'recovering' ? 'trackingRecovering' : missing.some(item => item.status === 'uncertain') ? 'trackingUncertain'
            : missing.some(item => item.status === 'checking') ? 'trackingChecking' : 'trackingLost';
        const text = dict[key].replace('{players}', missing.map(item => names[item.index]).join(', '))
            .replace('{detected}', report.rawCount).replace('{expected}', state.session.numPlayers);
        if (message.textContent !== text) message.textContent = text;
        button.textContent = dict.trackingRecalibrate;
        notice.hidden = false;
        app.hud.layoutGameplayNotices();
    }

    function renderCalibration(result) {
        latestCalibration = result;
        preparing = false;
        const copy = app.localization.translations[document.getElementById('lang-select').value].calibration;
        const phase = result.phase === 'complete' ? 'sampling' : result.phase;
        let text = result.phase === 'waiting'
            ? copy.reasons[result.reason].replace('{count}', state.session.numPlayers)
            : copy[result.phase === 'ready' ? 'hold' : 'sample'];
        if (state.session.numPlayers === 2 && Number.isInteger(result.playerIndex) && result.reason !== 'players') {
            text = `${copy.player.replace('{number}', result.playerIndex + 1)}: ${text}`;
        }
        const settled = showCalibrationText(copy.titles[phase], text);
        document.getElementById('calibration-bar').style.width = `${Math.round(result.progress * 100)}%`;
        // Continue checking real poses while the last instruction gets its
        // minimum reading time. No timer may finalize stale calibration data.
        return result.phase !== 'complete' || settled;
    }

    return { clearTrackingStatus, refreshTrackingStatus, renderCalibration, resetCalibrationMessages,
        showCalibrationPreparation, refreshCalibrationLanguage };
}
