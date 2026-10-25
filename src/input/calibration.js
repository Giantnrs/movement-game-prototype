/** Position-first torso sampling. Player identities are finalized only on completion. */
function createCalibration({ state, app }) {
    const SAMPLE_MS = 750;
    const GRACE_MS = 300;
    const MIN_SAMPLES = 5;
    const MIN_CONFIDENCE = 0.6;
    const EPSILON = 1e-6;
    const LANDMARKS = [11, 12, 23, 24];
    let slots, lastAt, confirmSince, confirmSamples;

    function emptySlot() {
        return { anchor: null, means: [], samples: 0, elapsed: 0, lastGoodAt: undefined, lastSampleAt: undefined, ready: false };
    }

    function resetCalibration() {
        slots = Array.from({ length: state.session.numPlayers }, emptySlot);
        lastAt = undefined;
        confirmSince = undefined;
        confirmSamples = 0;
    }
    resetCalibration();

    function isVisible(point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            ['visibility', 'presence'].every(key => point[key] === undefined ||
                (Number.isFinite(point[key]) && point[key] >= MIN_CONFIDENCE));
    }

    function center(pose) {
        return (pose[23].x + pose[24].x) / 2;
    }

    function positionProblem(pose, index) {
        if (!LANDMARKS.every(id => isVisible(pose?.[id]))) return 'visibility';
        if (!LANDMARKS.every(id => pose[id].x >= 0.02 - EPSILON && pose[id].x <= 0.98 + EPSILON &&
            pose[id].y >= 0.02 - EPSILON && pose[id].y <= 0.98 + EPSILON)) return 'frame';
        const [left, right, hipLeft, hipRight] = LANDMARKS.map(id => pose[id]);
        const shoulderX = (left.x + right.x) / 2;
        const shoulderY = (left.y + right.y) / 2;
        const hipX = center(pose);
        const hipY = (hipLeft.y + hipRight.y) / 2;
        const width = Math.abs(left.x - right.x);
        const height = hipY - shoulderY;
        if (Math.abs(hipLeft.x - hipRight.x) < 0.025) return 'visibility';
        if (width < 0.07 - EPSILON || height < 0.12 - EPSILON) return 'closer';
        if (width > 0.42 + EPSILON || height > 0.48 + EPSILON || shoulderY < 0.12 || hipY > 0.92) return 'back';
        // Learn a comfortable upright torso; hands do not determine readiness.
        if (Math.abs(left.y - right.y) > Math.max(0.08, height * 0.35) ||
            Math.abs(shoulderX - hipX) > Math.max(0.08, width * 0.75)) return 'neutral';
        const zone = state.session.numPlayers === 1 ? [0.2, 0.8] : index === 0 ? [0.54, 0.9] : [0.1, 0.46];
        if (hipX < zone[0] - EPSILON || hipX > zone[1] + EPSILON) return state.session.numPlayers === 1 ? 'center' : 'sides';
        return null;
    }

    function isSteady(pose, slot) {
        const video = app.camera.videoElement;
        const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
        const torso = (slot.anchor[2].y + slot.anchor[3].y - slot.anchor[0].y - slot.anchor[1].y) / 2;
        const tolerance = Math.max(0.045, Math.min(0.07, torso * 0.2));
        return LANDMARKS.every((id, point) => Math.hypot((pose[id].x - slot.anchor[point].x) * aspect,
            pose[id].y - slot.anchor[point].y) <= tolerance + EPSILON);
    }

    function pauseSlot(index, now) {
        const slot = slots[index];
        slot.lastSampleAt = undefined;
        if (slot.lastGoodAt !== undefined && now - slot.lastGoodAt > GRACE_MS) slots[index] = emptySlot();
    }

    function sampleSlot(pose, index, now) {
        const slot = slots[index];
        if (slot.anchor && !isSteady(pose, slot)) {
            pauseSlot(index, now);
            return 'steady';
        }
        if (!slot.anchor) {
            slot.anchor = LANDMARKS.map(id => ({ x: pose[id].x, y: pose[id].y }));
            slot.means = LANDMARKS.map(() => ({ x: 0, y: 0 }));
        }
        slot.lastGoodAt = now;
        if (!slot.ready) {
            // Invalid frames and camera stalls never count as sampled time.
            if (slot.lastSampleAt !== undefined) slot.elapsed += Math.min(now - slot.lastSampleAt, 100);
            slot.lastSampleAt = now;
            slot.samples++;
            LANDMARKS.forEach((id, point) => {
                for (const axis of ['x', 'y']) slot.means[point][axis] += (pose[id][axis] - slot.means[point][axis]) / slot.samples;
            });
            slot.ready = slot.elapsed + EPSILON >= SAMPLE_MS && slot.samples >= MIN_SAMPLES;
        }
        return null;
    }

    function updateCalibration(poses) {
        const now = performance.now();
        if (slots.length !== state.session.numPlayers) resetCalibration();
        if (lastAt !== undefined && (now < lastAt || now - lastAt > GRACE_MS)) {
            resetCalibration();
            lastAt = now;
            return { phase: 'waiting', reason: 'steady', progress: 0, players: [] };
        }
        lastAt = now;
        const count = state.session.numPlayers;
        const candidates = Array.from({ length: count }, () => []);
        const extra = poses.length > count;
        for (const pose of poses) {
            if (count === 1) candidates[0].push(pose);
            else if ([23, 24].every(id => isVisible(pose?.[id]))) candidates[center(pose) > 0.5 ? 0 : 1].push(pose);
        }
        const ordered = candidates.map(bucket => bucket.length === 1 ? bucket[0] : null);
        let tooClose = false;
        if (count === 2 && ordered.every(pose => pose && LANDMARKS.every(id => isVisible(pose[id])))) {
            const width = pose => Math.abs(pose[11].x - pose[12].x);
            const separation = Math.max(0.18, (width(ordered[0]) + width(ordered[1])) * 0.35 + 0.04);
            tooClose = center(ordered[0]) - center(ordered[1]) + EPSILON < separation;
        }
        const players = ordered.map((pose, index) => {
            let reason = extra ? 'players' : tooClose || candidates[index].length > 1 ? 'sides'
                : !pose ? poses.length < count ? 'players' : 'visibility' : positionProblem(pose, index);
            if (reason) pauseSlot(index, now);
            else reason = sampleSlot(pose, index, now);
            const slot = slots[index];
            return { phase: reason ? 'waiting' : slot.ready ? 'ready' : 'sampling', reason,
                progress: Math.min(slot.elapsed / SAMPLE_MS, 1), samples: slot.samples };
        });
        const progress = players.reduce((sum, player) => sum + player.progress, 0) / count;
        const blocked = players.findIndex(player => player.reason);
        if (blocked !== -1 || !slots.every(slot => slot.ready)) {
            confirmSince = undefined;
            confirmSamples = 0;
            return blocked !== -1
                ? { phase: 'waiting', reason: players[blocked].reason, playerIndex: blocked, progress, players }
                : { phase: 'sampling', progress, players };
        }
        confirmSince ??= now;
        confirmSamples++;
        if (now - confirmSince + EPSILON < 100 || confirmSamples < 3) return { phase: 'sampling', progress: 1, players };
        const averaged = ordered.map((pose, index) => {
            const result = pose.map(point => ({ ...point }));
            LANDMARKS.forEach((id, point) => Object.assign(result[id], slots[index].means[point]));
            return result;
        });
        return { phase: 'complete', progress: 1, poses: averaged, players,
            samples: Math.min(...slots.map(slot => slot.samples)), sampleCounts: slots.map(slot => slot.samples) };
    }

    return { resetCalibration, updateCalibration };
}
