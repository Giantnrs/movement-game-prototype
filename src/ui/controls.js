/** controls: see docs/architecture.md for ownership and compatibility rules. */
function createControls({ state, app }) {
    let calibrationTimeout;

    function handleNameCommand(input) {
        if (input.value.trim().toLowerCase() !== 'clear!') return false;
        app.scores.clearLeaderboards();
        input.value = '';
        app.localization.updateLoginNameCheck();
        const lang = document.getElementById('lang-select').value;
        alert(app.localization.translations[lang].leaderboardsCleared);
        input.focus();
        return true;
    }

    function startCalibration() {
        clearTimeout(calibrationTimeout);
        app.pose.beginCalibration();
        document.getElementById('calibration-screen').classList.remove('hidden');
        document.getElementById('calibration-bar').style.width = '0%';
        state.game.gameState = 'pre-calibrating';
        app.trackingStatus.showCalibrationPreparation();
        app.camera.showCalibrationPreview();
        calibrationTimeout = setTimeout(() => {
            if (state.game.gameState === 'pre-calibrating') state.game.gameState = 'calibrating';
        }, 1500);
    }

    function bind() {
        document.getElementById('lang-select').addEventListener('change', (e) => app.localization.setLoginLang(e.target.value));
        document.getElementById('lang-btn-en').addEventListener('click', () => app.localization.setLoginLang('en'));
        document.getElementById('lang-btn-mi').addEventListener('click', () => app.localization.setLoginLang('mi'));
        document.getElementById('theme-select').addEventListener('change', (e) => app.preferences.updateTheme(e.target.value));
        document.getElementById('login-theme-toggle').addEventListener('click', () => {
            const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
            app.preferences.updateTheme(next);
        });
        for (const id of ['player-name', 'player2-name']) {
            document.getElementById(id).addEventListener('input', (e) => {
                handleNameCommand(e.target);
                if (id === 'player-name') app.localization.updateLoginNameCheck();
            });
        }
        document.getElementById('player-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-continue').click();
        });

        document.getElementById('btn-mode-1p').addEventListener('click', () => {
            state.session.numPlayers = 1; state.game.players[1].active = false;
            document.getElementById('p2-name-input-wrap').classList.add('hidden');
            document.getElementById('btn-mode-1p').classList.replace('border-transparent', 'border-indigo-400');
            document.getElementById('btn-mode-1p').classList.replace('bg-gray-200', 'bg-indigo-600');
            document.getElementById('btn-mode-1p').classList.replace('text-gray-800', 'text-white');
            document.getElementById('btn-mode-2p').classList.replace('border-indigo-400', 'border-transparent');
            document.getElementById('btn-mode-2p').classList.replace('bg-indigo-600', 'bg-gray-200');
            document.getElementById('btn-mode-2p').classList.replace('text-white', 'text-gray-800');
            // Show speed buttons, reset to Normal
            state.game.speedMultiplier = 1;
            document.getElementById('btn-speed-normal').className = 'flex-1 bg-green-600 text-white font-bold py-3 rounded-xl border-4 border-green-400 transform transition text-xl';
            document.getElementById('btn-speed-chill').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl border-4 border-transparent transform transition text-xl';
        });

        document.getElementById('btn-mode-2p').addEventListener('click', () => {
            state.session.numPlayers = 2; state.game.players[1].active = true;
            document.getElementById('p2-name-input-wrap').classList.remove('hidden');
            document.getElementById('player2-name').focus();
            document.getElementById('btn-mode-2p').classList.replace('border-transparent', 'border-indigo-400');
            document.getElementById('btn-mode-2p').classList.replace('bg-gray-200', 'bg-indigo-600');
            document.getElementById('btn-mode-2p').classList.replace('text-gray-800', 'text-white');
            document.getElementById('btn-mode-1p').classList.replace('border-indigo-400', 'border-transparent');
            document.getElementById('btn-mode-1p').classList.replace('bg-indigo-600', 'bg-gray-200');
            document.getElementById('btn-mode-1p').classList.replace('text-white', 'text-gray-800');
            // Show speed buttons, reset to Normal
            state.game.speedMultiplier = 1;
            document.getElementById('btn-speed-normal').className = 'flex-1 bg-green-600 text-white font-bold py-3 rounded-xl border-4 border-green-400 transform transition text-xl';
            document.getElementById('btn-speed-chill').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl border-4 border-transparent transform transition text-xl';
        });

        document.getElementById('btn-speed-normal').addEventListener('click', () => {
            state.game.speedMultiplier = 1;
            document.getElementById('btn-speed-normal').className = 'flex-1 bg-green-600 text-white font-bold py-3 rounded-xl border-4 border-green-400 transform transition text-xl';
            document.getElementById('btn-speed-chill').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl border-4 border-transparent transform transition text-xl';
            if (document.getElementById('lb-mode-label')) document.getElementById('lb-mode-label').innerText = 'Normal';
            app.leaderboards.renderLeaderboard();
        });

        document.getElementById('btn-speed-chill').addEventListener('click', () => {
            state.game.speedMultiplier = 0.4;
            document.getElementById('btn-speed-chill').className = 'flex-1 bg-cyan-600 text-white font-bold py-3 rounded-xl border-4 border-cyan-400 transform transition text-xl';
            document.getElementById('btn-speed-normal').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl border-4 border-transparent transform transition text-xl';
            if (document.getElementById('lb-mode-label')) document.getElementById('lb-mode-label').innerText = 'Chill';
            app.leaderboards.renderLeaderboard();
        });

        document.getElementById('btn-continue').addEventListener('click', () => {
            if (handleNameCommand(document.getElementById('player-name'))) return;
            const name = document.getElementById('player-name').value.trim();
            if (!name) {
                const lang = document.getElementById('lang-select').value;
                alert(lang === 'mi' ? 'Kuhuna tō ingoa koa.' : 'Please enter your name.');
                return;
            }
            state.session.currentPlayerName = name;
            localStorage.setItem('player_name', name);

            const streak = app.progress.calculateStreak();
            app.streak.renderStreak(streak);

            // Show streak screen
            document.getElementById('login-screen-wrap').classList.add('hidden');
            document.getElementById('streak-screen').classList.remove('hidden');
            state.game.gameState = 'dashboard';
            if (streak >= 3 && typeof startFireworks === 'function') startFireworks();
        });

        // ── Back button navigation ──
        document.getElementById('btn-streak-back').addEventListener('click', () => {
            document.getElementById('streak-screen').classList.add('hidden');
            document.getElementById('login-screen-wrap').classList.remove('hidden');
            if (typeof stopFireworks === 'function') stopFireworks();
        });

        document.getElementById('btn-dashboard-back').addEventListener('click', () => {
            document.getElementById('dashboard-screen').classList.add('hidden');
            document.getElementById('login-screen-wrap').classList.remove('hidden');
        });

        document.getElementById('btn-warning-back').addEventListener('click', () => {
            app.warning.stopWarningAudio();
            document.getElementById('warning-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
        });

        document.getElementById('btn-start-back').addEventListener('click', () => {
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
        });

        document.getElementById('btn-calibration-back').addEventListener('click', () => {
            clearTimeout(calibrationTimeout);
            state.game.gameState = 'loading';
            document.getElementById('calibration-screen').classList.add('hidden');
            document.getElementById('start-screen').classList.remove('hidden');
        });

        document.getElementById('btn-streak-next').addEventListener('click', () => {
            document.getElementById('streak-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            if (typeof stopFireworks === 'function') stopFireworks();
            app.localization.updateLanguage(document.getElementById('lang-select').value);
            app.leaderboards.renderLeaderboard();
        });

        document.getElementById('btn-play').addEventListener('click', () => {
            // Read P2 name if in 2P mode
            if (state.session.numPlayers === 2) {
                if (handleNameCommand(document.getElementById('player2-name'))) return;
                const p2name = document.getElementById('player2-name').value.trim();
                if (!p2name) {
                    alert('Please enter Player 2\'s name.');
                    document.getElementById('player2-name').focus();
                    return;
                }
                state.session.currentPlayer2Name = p2name;
                localStorage.setItem('player2_name', p2name);
            }
            document.getElementById('dashboard-screen').classList.add('hidden');
            document.getElementById('loading-screen').classList.remove('hidden');
            state.game.gameState = 'loading';
            app.camera.initCameraSequence();
        });

        document.getElementById('warning-continue-btn').addEventListener('click', () => {
            app.warning.stopWarningAudio();
            document.getElementById('warning-screen').classList.add('hidden');
            app.tutorial.showInstructionsScreen();
        });

        document.getElementById('warning-read-btn').addEventListener('click', app.warning.toggleWarningRead);

        document.getElementById('instruction-advance').addEventListener('click', app.tutorial.advanceInstruction);
        document.getElementById('instruction-next').addEventListener('click', (e) => { e.stopPropagation(); app.tutorial.advanceInstruction(); });
        document.getElementById('instruction-prev').addEventListener('click', (e) => { e.stopPropagation(); app.tutorial.goBackInstruction(); });
        document.getElementById('instruction-skip').addEventListener('click', (e) => { e.stopPropagation(); app.tutorial.skipInstructions(); });
        document.getElementById('instruction-mute').addEventListener('click', (e) => { e.stopPropagation(); app.tutorial.toggleInstructionMute(); });

        document.getElementById('start-btn').addEventListener('click', () => {
            app.audio.audioCtx.resume();
            app.audio.bgMusic.play().then(() => { app.audio.bgMusic.pause(); app.audio.bgMusic.currentTime = 0; }).catch(e => console.log(e));
            document.getElementById('start-screen').classList.add('hidden');
            startCalibration();
        });

        document.getElementById('btn-recalibrate-players').addEventListener('click', () => {
            if (state.game.gameState !== 'playing') return;
            app.audio.bgMusic.pause();
            app.notifications.clearOrbNotify();
            app.feedback.hideShieldActive();
            app.feedback.hideLevelUp();
            document.getElementById('hud-1p').classList.add('hidden');
            document.getElementById('hud-2p').classList.add('hidden');
            if (state.game.gameLoopId) cancelAnimationFrame(state.game.gameLoopId);
            startCalibration();
        });

        document.getElementById('restart-btn').addEventListener('click', () => {
            app.finishPhoto.resetFinishPhoto();
            document.getElementById('game-over-screen').classList.remove('mode-2p');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('winner-stamp-p1').classList.remove('show');
            document.getElementById('winner-stamp-p2').classList.remove('show');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            document.getElementById('shield-active-hud').classList.add('hidden');
            app.camera.videoElement.classList.add('hidden');
            app.camera.camSingle.classList.add('hidden');
            document.getElementById('split-cam-container').style.display = 'none';
            // Close leaderboard modal if open
            const lbModal = document.getElementById('lb-modal');
            if (lbModal) lbModal.style.display = 'none';
            document.getElementById('gameover-lb-wrap').classList.add('hidden');
            document.getElementById('btn-gameover-lb').textContent = '🏆 Leaderboard';
            if (document.getElementById('winner-banner')) document.getElementById('winner-banner').classList.add('hidden');
            if (document.getElementById('final-p2-score-container')) document.getElementById('final-p2-score-container').classList.add('hidden');
            state.game.gameState = 'dashboard';
            app.world.drawStaticBackground();
            app.leaderboards.renderLeaderboard();
        });

        document.getElementById('btn-play-again').addEventListener('click', () => {
            app.finishPhoto.resetFinishPhoto();
            // Reset game-over screen state
            document.getElementById('game-over-screen').classList.remove('mode-2p');
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('winner-stamp-p1').classList.remove('show');
            document.getElementById('winner-stamp-p2').classList.remove('show');
            if (document.getElementById('winner-banner')) document.getElementById('winner-banner').classList.add('hidden');
            document.getElementById('gameover-lb-wrap').classList.add('hidden');
            document.getElementById('shield-active-hud').classList.add('hidden');
            // Jump straight to calibration — skip warning & tutorial
            app.audio.audioCtx.resume();
            startCalibration();
        });
    }


    return { bind };
}
