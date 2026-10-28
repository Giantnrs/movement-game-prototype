/** pose: see docs/architecture.md for ownership and compatibility rules. */
function createPose({ state, app }) {
    let calibrationActive = false;
    const suspendedPlayers = new WeakSet();
    const laneGateReasons = new WeakMap();

    function beginCalibration() {
        app.camera.invalidatePoseFrame?.();
        app.finishPhoto.resetFinishPhoto();
        app.trackingSafety.resetTrackingSafety();
        app.debug.record('calibration.begin', { expected: state.session.numPlayers });
        app.playerTracking.resetEnrollment();
        app.calibration.resetCalibration();
        app.trackingStatus.clearTrackingStatus();
        app.trackingStatus.resetCalibrationMessages();
        calibrationActive = true;
        for (const player of state.game.players.slice(0, state.session.numPlayers)) {
            player.baseline = 0;
            player.calibrationFrames = 0;
            player.homeX = undefined;
            player.homeXSum = 0;
            app.laneGestures.resetLaneGestures(player);
            suspendedPlayers.delete(player);
            laneGateReasons.delete(player);
        }
    }

    function suspendPlayerInput(player) {
        app.laneGestures.interruptLaneGestures(player);
        player.isJumping = false;
        player.isSquatting = false;
        player.isResting = false;
        player.armsCrossedNow = false;
        player.restingMode = false;
        suspendedPlayers.add(player);
    }

    // Called by the game loop as well as camera callbacks: a stalled camera
    // cannot leave a jump/rest pose active indefinitely.
    function checkPlayerTracking() {
        if (state.game.gameState !== 'playing') return;
        const statuses = app.playerTracking.trackingStatuses();
        const report = app.playerTracking.trackingReport();
        const camera = app.camera.readCameraStatus();
        const safety = app.trackingSafety.updateTrackingSafety(statuses, report, camera);
        statuses.forEach((status, i) => {
            if (safety.paused || (status !== 'tracked' && status !== 'unregistered')) suspendPlayerInput(state.game.players[i]);
        });
        app.trackingStatus.refreshTrackingStatus(statuses, safety, report);
        app.debug.transition('tracking.status', JSON.stringify([statuses, safety, report.rawCount, report.ignored]),
            { statuses, ...safety, report });
        app.debug.sample('tracking.frame', { statuses, ...safety, report, camera });
        app.debug.setDebugStatus({ phase: state.game.gameState, expected: state.session.numPlayers,
            detected: report.rawCount, valid: report.validCount, ignored: report.ignored || [],
            statuses, ...safety, inferenceMs: camera.inferenceMs });
    }

    function onPoseResults(results) {
        const calibrating = state.game.gameState === 'calibrating';
        if (!calibrating && state.game.gameState !== 'playing') return;
        if (app.debug.enabled) {
            const poses = results.landmarks || [];
            app.debug.transition('detection.count', String(poses.length), { detected: poses.length, expected: state.session.numPlayers });
            app.debug.sample('pose.observation', { phase: state.game.gameState, detected: poses.length,
                poses: poses.map(pose => [11, 12, 13, 14, 15, 16, 23, 24].map(id => ({ id, ...pose[id] }))) });
        }
        if (calibrating && !calibrationActive) beginCalibration();
        if (calibrating) {
            const result = app.calibration.updateCalibration(results.landmarks || []);
            app.debug.transition('calibration.status', JSON.stringify([result.phase, result.reason, result.playerIndex,
                result.players?.map(player => player.phase)]),
                { phase: result.phase, reason: result.reason, playerIndex: result.playerIndex,
                    samples: result.samples, progress: result.progress, players: result.players });
            app.debug.setDebugStatus({ phase: `calibration: ${result.phase}`, expected: state.session.numPlayers,
                detected: (results.landmarks || []).length, reason: result.reason, progress: result.progress });
            const guidanceReady = app.trackingStatus.renderCalibration(result);
            if (result.phase === 'complete' && guidanceReady) {
                if (!app.playerTracking.lockPlayers(result.poses)) {
                    app.calibration.resetCalibration();
                    app.trackingStatus.renderCalibration({ phase: 'waiting', reason: 'visibility', progress: 0 });
                    return;
                }
                for (let i = 0; i < state.session.numPlayers; i++) {
                    const pose = result.poses[i];
                    const player = state.game.players[i];
                    player.baseline = (pose[11].y + pose[12].y) / 2;
                    player.homeX = (pose[23].x + pose[24].x) / 2;
                    player.calibrationFrames = result.sampleCounts[i];
                    player.homeXSum = player.homeX * player.calibrationFrames;
                }
                calibrationActive = false;
                app.session.startGameplay();
            }
        } else {
            const poses = app.playerTracking.matchPlayers(results.landmarks || []);
            checkPlayerTracking();
            if (app.trackingSafety.isGameplayPaused()) return;
            app.finishPhoto.observeFinishPlayers(poses);
            for (let i = 0; i < state.session.numPlayers; i++) {
                const player = state.game.players[i];
                if (poses[i] && player.lives > 0) {
                    const resumed = suspendedPlayers.has(player);
                    suspendedPlayers.delete(player);
                    handlePlayerMovement(player, poses[i], !resumed);
                } else suspendPlayerInput(player);
            }
        }
    }

    // Detect arms crossed (resting posture) for shield activation
    function detectArmsCrossed(landmarks) {
        const leftWrist    = landmarks[15];
        const rightWrist   = landmarks[16];
        const leftShoulder = landmarks[11];
        const rightShoulder= landmarks[12];
        const leftElbow    = landmarks[13];
        const rightElbow   = landmarks[14];

        const centerX  = (leftShoulder.x + rightShoulder.x) / 2;
        const shoulderY= (leftShoulder.y + rightShoulder.y) / 2;

        // Because camera is mirrored for display, landmark X is from raw video
        // Left wrist crossing over = leftWrist.x < centerX (moves toward right in raw)
        // Right wrist crossing over = rightWrist.x > centerX
        // Also both wrists should be near chest height (below shoulders by some margin)
        const wristsCrossed = leftWrist.x < centerX && rightWrist.x > centerX;
        const wristsAtChest = leftWrist.y < shoulderY + 0.35 && rightWrist.y < shoulderY + 0.35;
        const elbowsRaised  = leftElbow.y < shoulderY + 0.2 && rightElbow.y < shoulderY + 0.2;

        return wristsCrossed && wristsAtChest && elbowsRaised;
    }

    function handlePlayerMovement(player, landmarks, allowLane = true) {
        if (player.restCooldown > 0) player.restCooldown--;

        const squatThreshold = 0.10, armLevelThreshold = 0.15, armsUpThreshold = -0.15;

        let wasSquatting = player.isSquatting, wasJumping = player.isJumping;
        let wasResting = player.isResting;
        player.isSquatting = false; player.isJumping = false; player.isResting = false;

        const leftShoulder = landmarks[11], rightShoulder = landmarks[12];
        const leftWrist = landmarks[15], rightWrist = landmarks[16];
        const leftArmRaised = leftWrist.y < leftShoulder.y + armLevelThreshold;
        const rightArmRaised = rightWrist.y < rightShoulder.y + armLevelThreshold;
        const bothArmsUp = leftWrist.y < leftShoulder.y + armsUpThreshold && rightWrist.y < rightShoulder.y + armsUpThreshold;
        const levelArms = app.armPostures.readLevelArms(landmarks);
        const bothArmsLevel = levelArms.detected;
        const crouching = (leftShoulder.y + rightShoulder.y) / 2 > player.baseline + squatThreshold;
        const ducking = bothArmsLevel || crouching;
        const duckSource = bothArmsLevel ? 'level_arms' : crouching ? 'crouch' : null;

        // Check arms crossed (resting posture)
        const armsCrossed = detectArmsCrossed(landmarks);
        player.armsCrossedNow = armsCrossed;
        player.restingMode = armsCrossed; // persistent flag for orb collision
        // Active actions block lateral input. Once they end, the confirmed
        // lower/raise cycle provides the guard against accidental lane moves.
        const laneBlockReason = !allowLane ? 'tracking_recovery' : armsCrossed ? 'rest'
            : bothArmsUp ? 'fly' : ducking ? 'duck' : null;
        const canChangeLane = laneBlockReason === null;
        if (app.debug.enabled && laneGateReasons.get(player) !== laneBlockReason) {
            laneGateReasons.set(player, laneBlockReason);
            app.debug.record('input.lane_gate', { player: state.game.players.indexOf(player), blockedBy: laneBlockReason, levelArms, duckSource });
        }
        const laneChange = app.laneGestures.detectLaneGesture(player, landmarks, leftArmRaised, rightArmRaised, canChangeLane);

        if (armsCrossed) {
            player.isResting = true;
            if (player.shieldOrbs >= 5 && !player.shieldActive) {
                player.shieldActive = true;
                player.shieldTimer  = 300;
                player.shieldOrbs -= 5;
                app.hud.updateHUD();
                app.audio.playSynth('shield');
            }
            return;
        } else {
            player.isResting = false;
        }

        if (bothArmsUp) {
            player.isJumping = true;
            if (!wasJumping) { app.energy.recordEnergyAction(player); app.debug.record('input.jump', { player: state.game.players.indexOf(player) }); player.stats.jumps++; app.hud.updateHUD(); app.audio.playSynth('jump'); }
        } else if (ducking) {
            player.isSquatting = true;
            if (!wasSquatting) { app.energy.recordEnergyAction(player); app.debug.record('input.squat', { player: state.game.players.indexOf(player), source: duckSource }); player.stats.squats++; app.hud.updateHUD(); app.audio.playSynth('squat'); }
        }

        if (laneChange !== 0) {
            const nextLane = Math.max(-1, Math.min(1, player.lane + laneChange));
            if (nextLane !== player.lane) {
                app.debug.record('input.lane', { player: state.game.players.indexOf(player), from: player.lane, to: nextLane });
                app.energy.recordEnergyAction(player);
                player.lane = nextLane;
                app.audio.playSynth('lane');
            }
        }
    }

    return { beginCalibration, checkPlayerTracking, onPoseResults, detectArmsCrossed, handlePlayerMovement };
}
