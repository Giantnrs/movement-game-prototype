/** session: see docs/architecture.md for ownership and compatibility rules. */
function createSession({ state, app }) {
    function startGameplay() {
        app.camera.invalidatePoseFrame();
        app.handPointer.resetHandPointer();
        app.finishPhoto.resetFinishPhoto();
        app.trackingSafety.resetTrackingSafety();
        app.debug.record('game.start', { players: state.session.numPlayers, speedMultiplier: state.game.speedMultiplier,
            energy: app.energy.energyAssumptions() });
        app.notifications.clearOrbNotify();
        app.trackingStatus.clearTrackingStatus();
        document.getElementById('calibration-screen').classList.add('hidden');
        document.getElementById('shield-active-hud').classList.add('hidden');

        if (state.session.numPlayers === 1) {
            document.getElementById('hud-1p').classList.remove('hidden');
            document.getElementById('hud-2p').classList.add('hidden');
        } else {
            document.getElementById('hud-1p').classList.add('hidden');
            document.getElementById('hud-2p').classList.remove('hidden');
            document.getElementById('hud-p2').classList.remove('hidden');
            // p2-hud-name = LEFT board = players[0] = person entered first (P1 name)
            // p1-hud-name = RIGHT board = players[1] = person entered second (P2 name)
            document.getElementById('p2-hud-name').innerText = state.session.currentPlayerName;
            document.getElementById('p1-hud-name').innerText = state.session.currentPlayer2Name;
        }

        state.game.gameState = 'playing'; state.game.score = 0; state.game.speed = 4; state.game.frameCount = 0; state.game.obstacles = []; state.game.orbs = [];
        state.game.levelUpTimer = 0; state.game.nextMilestone = 100; state.game.streakBonusGranted = false; state.game.blockRestTimer = 0;
        state.game.skyStyle = 0; state.game.skyParticles = [];
        // Sky starts immediately with base style
        state.game.skyEffectsEnabled = true;
        state.game.skyStarBase = Array.from({ length: 28 }, () => ({
            x: Math.random() * state.viewport.gameWidth,
            y: Math.random() * app.world.horizonY * 0.88,
            r: 0.7 + Math.random() * 2,
            twinkle: Math.random() * Math.PI * 2,
            hue: Math.floor(Math.random() * 360)
        }));

        for (let i=0; i<state.session.numPlayers; i++) {
            app.laneGestures.resetLaneGestures(state.game.players[i]);
            state.game.players[i].lives = 3; state.game.players[i].lane = 0; state.game.players[i].stats = {squats: 0, jumps: 0}; state.game.players[i].score = 0;
            state.game.players[i].invulnerableFrames = 0;
            state.game.players[i].shieldOrbs = 0; state.game.players[i].shieldActive = false; state.game.players[i].shieldTimer = 0;
            state.game.players[i].isResting = false; state.game.players[i].armsCrossedNow = false; state.game.players[i].restingMode = false; state.game.players[i].restCooldown = 0; state.game.players[i].eliminated = false;
            state.game.players[i].renderX = undefined;
            state.game.players[i].renderYOffset = 0; state.game.players[i].renderScaleX = 1; state.game.players[i].renderScaleY = 1;
            state.game.players[i].renderAngle = 0; state.game.players[i].renderArmL = undefined; state.game.players[i].renderArmR = undefined;
        }

        // The daily bonus is earned by a real streak, once per local calendar day.
        const streak = Number(localStorage.getItem('current_streak')) || 0;
        const todayStr = app.progress.getLocalDateKey();
        const claimedDate = localStorage.getItem('streak_bonus_claimed_date');
        const loggedInToday = localStorage.getItem('last_login_date') === todayStr;
        document.getElementById('streak-bonus-banner').classList.add('hidden');

        // Grant shields
        if (loggedInToday && streak >= 3 && claimedDate !== todayStr) {
            for (let i = 0; i < state.session.numPlayers; i++) state.game.players[i].shieldOrbs = 5;
            localStorage.setItem('streak_bonus_claimed_date', todayStr);
            state.game.streakBonusGranted = true;
            document.getElementById('streak-reward-notice').classList.add('hidden');
        }
        if (state.game.streakBonusGranted) {
            document.getElementById('streak-bonus-text').textContent = `🔥 ${streak}-Day Login Streak  🛡️ +5 Shields!`;
            const banner = document.getElementById('streak-bonus-banner');
            banner.classList.remove('hidden');
            banner.style.animation = 'none';
            banner.offsetHeight;
            banner.style.animation = '';
            setTimeout(() => banner.classList.add('hidden'), 4500);
        }

        app.energy.resetEnergy();
        app.hud.updateHUD();
        app.camera.showCameraForMode();
        app.audio.bgMusic.currentTime = 0; app.audio.bgMusic.play().catch(e => console.log(e));
        if(state.game.gameLoopId) cancelAnimationFrame(state.game.gameLoopId);
        app.simulation.resetFrameClock();
        app.simulation.gameLoop();
    }

    function gameOver() {
        app.energy.stopEnergy();
        app.debug.record('game.over', { score: state.game.score });
        app.trackingSafety.resetTrackingSafety();
        state.game.gameState = 'gameover';
        app.notifications.clearOrbNotify();
        app.trackingStatus.clearTrackingStatus();
        app.audio.bgMusic.pause(); app.audio.playSynth('hit');
        app.scores.saveScore(state.game.score);
        app.leaderboards.renderGameOverLeaderboard();
        document.getElementById('shield-active-hud').classList.add('hidden');
        document.getElementById('hud-1p').classList.add('hidden');
        document.getElementById('hud-2p').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');
        let winnerIndex = null;

        if (state.session.numPlayers === 2) {
            document.getElementById('game-over-screen').classList.add('mode-2p');
            // Hide score row — only show winner banner + stats
            document.getElementById('score-row').style.display = 'none';
            document.getElementById('final-p2-container').classList.remove('hidden');

            // players[0] = LEFT board = currentPlayerName (entered first)
            // players[1] = RIGHT board = currentPlayer2Name (entered second)
            // Stats cards: final-p1-name = LEFT, final-p2-name = RIGHT
            document.getElementById('final-p1-stats-name').classList.remove('hidden');
            document.getElementById('final-p1-stats-name').innerText = state.session.currentPlayerName;
            document.getElementById('final-p2-stats-name').innerText = state.session.currentPlayer2Name;
            document.getElementById('final-p1-squats').innerText = state.game.players[0].stats.squats;
            document.getElementById('final-p1-jumps').innerText = state.game.players[0].stats.jumps;
            document.getElementById('final-p1-energy').textContent = app.energy.readEnergy(state.game.players[0]).toFixed(1);
            document.getElementById('final-p2-squats').innerText = state.game.players[1].stats.squats;
            document.getElementById('final-p2-jumps').innerText = state.game.players[1].stats.jumps;
            document.getElementById('final-p2-energy').textContent = app.energy.readEnergy(state.game.players[1]).toFixed(1);

            // Winner = whoever still has lives (survivor wins)
            let winnerName, winnerScore;
            if (state.game.players[0].lives <= 0 && state.game.players[1].lives > 0) {
                winnerIndex = 1;
                winnerName  = state.session.currentPlayer2Name;
                winnerScore = Math.floor(state.game.players[1].score || 0);
            } else if (state.game.players[1].lives <= 0 && state.game.players[0].lives > 0) {
                winnerIndex = 0;
                winnerName  = state.session.currentPlayerName;
                winnerScore = Math.floor(state.game.players[0].score || 0);
            } else {
                // Both died simultaneously — higher score wins
                const p0 = Math.floor(state.game.players[0].score || 0);
                const p1 = Math.floor(state.game.players[1].score || 0);
                winnerIndex = p0 >= p1 ? 0 : 1;
                winnerName  = p0 >= p1 ? state.session.currentPlayerName : state.session.currentPlayer2Name;
                winnerScore = Math.max(p0, p1);
            }

            document.getElementById('winner-banner').classList.remove('hidden');
            document.getElementById('winner-name').innerText  = winnerName;
            document.getElementById('winner-score').innerText = winnerScore;

            // Show winner stamp on the correct stats card
            document.getElementById('winner-stamp-p1').classList.remove('show');
            document.getElementById('winner-stamp-p2').classList.remove('show');
            const stampId = winnerIndex === 0 ? 'winner-stamp-p1' : 'winner-stamp-p2';
            setTimeout(() => document.getElementById(stampId).classList.add('show'), 400);
        } else {
            // Single player
            document.getElementById('game-over-screen').classList.remove('mode-2p');
            document.getElementById('final-p1-name').innerText = state.session.currentPlayerName;
            document.getElementById('final-p1-stats-name').classList.add('hidden');
            document.getElementById('score-row').style.display = '';
            document.getElementById('final-score').innerText = Math.floor(state.game.score);
            document.getElementById('final-p1-squats').innerText = state.game.players[0].stats.squats;
            document.getElementById('final-p1-jumps').innerText = state.game.players[0].stats.jumps;
            document.getElementById('final-p1-energy').textContent = app.energy.readEnergy(state.game.players[0]).toFixed(1);
            document.getElementById('final-p2-container').classList.add('hidden');
            document.getElementById('winner-banner').classList.add('hidden');
        }

        // Health tip
        const tip = app.tutorial.HEALTH_TIPS[Math.floor(Math.random() * app.tutorial.HEALTH_TIPS.length)];
        document.getElementById('health-tip-title').textContent = tip.title;
        document.getElementById('health-tip-body').textContent = tip.body;
        app.finishPhoto.showFinishPhoto(winnerIndex);
    }

    return { startGameplay, gameOver };
}
