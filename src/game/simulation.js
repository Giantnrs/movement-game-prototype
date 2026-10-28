/** simulation: see docs/architecture.md for ownership and compatibility rules. */
function createSimulation({ state, app }) {
    const STEP_MS = 1000 / 60;
    const MAX_GAP_MS = 250;
    let lastFrameAt, remainder = 0;

    function resetFrameClock() {
        lastFrameAt = undefined;
        remainder = 0;
    }
    document.addEventListener('visibilitychange', resetFrameClock);
    function spawnObstacle() {
        let availableTypes = ['high', 'low', 'block'];
        if (state.game.score > 100) availableTypes.push('low-wide');
        if (state.game.score > 200) availableTypes.push('door');

        const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
        let lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
        let span = 1;

        if (type === 'low-wide') { lane = 0; span = 3; }
        else if (type === 'door') {
            span = Math.floor(Math.random() * 3) + 1;
            if (span === 3) { lane = 0; }
            else if (span === 2) { lane = Math.random() < 0.5 ? -0.5 : 0.5; }
        }
        state.game.obstacles.push({ lane, span, depth: 0, type, active: true });
    }

    function advanceFrame() {
        if (app.trackingSafety.isGameplayPaused()) return true;
        state.game.frameCount++;

        // --- Orb notify timer ---
        if (state.game.orbNotifyTimer > 0) {
            state.game.orbNotifyTimer--;
            if (state.game.orbNotifyTimer === 0) app.notifications.clearOrbNotify();
        }

        // --- Shield timer tick ---
        for (let i = 0; i < state.session.numPlayers; i++) {
            let p = state.game.players[i];
            if (p.shieldActive) {
                p.shieldTimer--;
                if (p.shieldTimer <= 0) {
                    p.shieldActive = false;
                    p.shieldTimer = 0;
                    app.feedback.hideShieldActive();
                    // No notification — shield just quietly ends
                }
            }
        }

        if (state.game.levelUpTimer > 0) {
            state.game.levelUpTimer--;
            if (state.game.levelUpTimer === 0) app.feedback.hideLevelUp();
        }

        // Score and obstacle spawning always run (independent of levelUpTimer display)
        {
            state.game.score += (state.game.speed / 100);
            // Track per-player score based on survival
            for (let i = 0; i < state.session.numPlayers; i++) {
                if (state.game.players[i].active && !state.game.players[i].eliminated) {
                    state.game.players[i].score = (state.game.players[i].score || 0) + (state.game.speed / 100);
                }
            }
            state.game.speed = (4 + (state.game.score / 100)) * state.game.speedMultiplier;

            if (state.game.blockRestTimer > 0) state.game.blockRestTimer--;

            if (state.game.score >= state.game.nextMilestone && state.game.nextMilestone <= 400) {
                state.game.levelUpTimer = 300;
                state.game.blockRestTimer = 240; // 4-second block-free rest
                let msg = "";
                if (state.game.nextMilestone === 100) msg = "Fly over three row obstacles!";
                else if (state.game.nextMilestone === 200) msg = "Duck under the door frames!";
                else if (state.game.nextMilestone === 300) msg = "You are a moving star!";
                else if (state.game.nextMilestone === 400) msg = "You are a legend!";
                // Upgrade sky style every 100 pts (0→1→2→3→4)
                state.game.skyStyle = Math.min(state.game.skyStyle + 1, 4);
                app.feedback.showLevelUp(msg);
                app.audio.playSynth('levelup');
                state.game.nextMilestone += 100;
            } else if (state.game.blockRestTimer === 0) {
                let baseSpawnRate = Math.max(40, 100 - Math.floor((4 + state.game.score/100) * 3));
                let spawnRate = Math.floor(baseSpawnRate / state.game.speedMultiplier);
                if (state.game.frameCount % spawnRate === 0) spawnObstacle();
                // Score-based orb spawning — shields every 50, hearts every 100
                if (Math.floor(state.game.score) >= state.game.nextShieldScore) {
                    // Spawn a shield orb at a random lane
                    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
                    state.game.orbs.push({ lane, depth: 0, type: 'shield', active: true, bobOffset: Math.random() * Math.PI * 2 });
                    state.game.nextShieldScore += 50;
                    // Show notification
                    app.notifications.showOrbNotify('🛡️ Shield orb incoming!', 'rgba(6,182,212,0.95)');
                }

                if (Math.floor(state.game.score) >= state.game.nextHeartScore) {
                    // Spawn a heart orb at a random lane
                    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
                    state.game.orbs.push({ lane, depth: 0, type: 'heart', active: true, bobOffset: Math.random() * Math.PI * 2 });
                    state.game.nextHeartScore += 100;
                    // Show notification
                    app.notifications.showOrbNotify('💗 Heart orb incoming!', 'rgba(236,72,153,0.95)');
                }
            }
        }

        // Update obstacles
        state.game.obstacles.forEach(obs => {
            if (obs.active) {
                obs.depth += (state.game.speed * 0.001) + (obs.depth * 0.02);
                if (obs.depth > 1.2) obs.active = false;
            }
        });

        // Update orbs
        state.game.orbs.forEach(orb => {
            if (orb.active) {
                orb.depth += (state.game.speed * 0.001) + (orb.depth * 0.02);
                if (orb.depth > 1.2) orb.active = false;
            }
        });

        const playerDepth = 0.85;

        // --- Collision: obstacles ---
        for (let i = 0; i < state.session.numPlayers; i++) {
            let p = state.game.players[i];
            if (p.invulnerableFrames > 0) p.invulnerableFrames--;
            if (p.lives <= 0) continue;

            for (let obs of state.game.obstacles) {
                if (!obs.active || p.invulnerableFrames > 0) continue;
                if (obs.depth > playerDepth - 0.1 && obs.depth < playerDepth + 0.1) {
                    let isHitLane = Math.abs(p.lane - obs.lane) <= (obs.span - 1) / 2 + 0.01;
                    if (isHitLane) {
                        let hit = false;
                        if (obs.type === 'block') hit = true;
                        else if ((obs.type === 'high' || obs.type === 'door') && !p.isSquatting) hit = true;
                        else if ((obs.type === 'low' || obs.type === 'low-wide') && !p.isJumping) hit = true;

                        if (hit) {
                            if (p.shieldActive) {
                                // Shield absorbs the hit silently — just destroy obstacle
                                obs.active = false;
                                app.audio.playSynth('orb');
                            } else {
                                p.lives--; app.hud.updateHUD(); app.audio.playSynth('hit');
                                if (p.lives > 0) p.invulnerableFrames = 60;
                            }
                        }
                    }
                }
            }

            // --- Collision: orbs — completely ignored during shield/rest period ---
            if (!p.shieldActive && !p.restingMode) {
                for (let orb of state.game.orbs) {
                    // In 2P mode each orb tracks which players have collected it
                    if (state.session.numPlayers === 2) {
                        if (!orb.collectedBy) orb.collectedBy = [];
                        if (orb.collectedBy.includes(i)) continue; // this player already collected it
                    } else {
                        if (!orb.active) continue;
                    }
                    if (orb.depth > playerDepth - 0.12 && orb.depth < playerDepth + 0.12) {
                        if (Math.abs(p.lane - orb.lane) < 0.6) {
                            if (state.session.numPlayers === 2) {
                                orb.collectedBy.push(i);
                                // Deactivate only when both players have collected or passed
                                if (orb.collectedBy.length >= 2) orb.active = false;
                            } else {
                                orb.active = false;
                            }
                            if (orb.type === 'shield') {
                                p.shieldOrbs++;
                                app.hud.updateHUD();
                                app.audio.playSynth('orb');
                                app.notifications.showOrbNotify(`🛡️ +1 Shield!`, 'rgba(6,182,212,0.95)');
                            } else if (orb.type === 'heart') {
                                p.lives = Math.min(p.lives + 1, 9);
                                app.hud.updateHUD();
                                app.audio.playSynth('heart');
                                app.notifications.showOrbNotify('💗 +1 Life!', 'rgba(236,72,153,0.95)');
                            }
                        }
                    }
                }
            }
        }

        // Game ends as soon as any player hits 0 lives
        let anyDead = false;
        for (let i=0; i<state.session.numPlayers; i++) {
            if (state.game.players[i].lives <= 0) anyDead = true;
        }
        if (anyDead) { app.session.gameOver(); return false; }

        state.game.obstacles = state.game.obstacles.filter(o => o.active);
        state.game.orbs = state.game.orbs.filter(o => o.active);
        if (state.game.frameCount % 10 === 0) app.hud.updateHUD();

        return true;
    }

    function gameLoop(timestamp) {
        if (state.game.gameState !== 'playing') { resetFrameClock(); return; }
        app.pose.checkPlayerTracking();
        app.energy.updateEnergy();
        if (app.trackingSafety.isGameplayPaused() || document.hidden) {
            resetFrameClock();
        } else {
            // The immediate session-start call retains its original first step.
            // After a pause the first callback starts a new clock, with no debt.
            let steps = 1;
            if (Number.isFinite(timestamp)) {
                if (lastFrameAt !== undefined) {
                    const elapsed = timestamp - lastFrameAt;
                    if (elapsed < 0 || elapsed > MAX_GAP_MS) {
                        remainder = 0;
                        steps = 0;
                    } else {
                        remainder += elapsed;
                        steps = Math.floor((remainder + 1e-7) / STEP_MS);
                        remainder = Math.max(0, remainder - steps * STEP_MS);
                    }
                }
                lastFrameAt = timestamp;
            }
            for (let step = 0; step < steps; step++) {
                if (!advanceFrame()) { resetFrameClock(); return; }
                // Keep random/animation updates between simulation steps in
                // their original viewport order. Only the last step paints.
                if (step === steps - 1) app.scene.renderGameplay();
                else app.scene.advanceVisualFrame();
            }
        }
        state.game.gameLoopId = requestAnimationFrame(gameLoop);
    }

    return { spawnObstacle, advanceFrame, gameLoop, resetFrameClock };
}
