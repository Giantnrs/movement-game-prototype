/** One lane intent per arm-raise cycle, tracked separately for each player. */
function createLaneGestures({ app }) {
    const REARM_DEGREES = 15;
    const ANGLE_EPSILON = 1e-6;
    const LOWER_HOLD_MS = 150;
    const RAISE_HOLD_MS = 60;
    const MIN_STABLE_SAMPLES = 3;
    const MIN_CONFIDENCE = 0.6;
    const MAX_SAMPLE_GAP_MS = 250;
    const gesturesByPlayer = new WeakMap();

    function resetLaneGestures(player) {
        gesturesByPlayer.delete(player);
    }

    function discardEvidence(gesture) {
        gesture.samples = [];
        gesture.confirmation = null;
        // Uncertain tracking must not turn a previously lowered arm into a
        // fresh raise on reacquisition. Keep the latch and require a new release.
        if (gesture.phase === 'lowered') gesture.phase = 'holding';
    }

    function interruptLaneGestures(player) {
        const gestures = gesturesByPlayer.get(player);
        if (!gestures) return;
        discardEvidence(gestures.left);
        discardEvidence(gestures.right);
        gestures.lastSampleAt = undefined;
    }

    function isTracked(point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            ['visibility', 'presence'].every(key => point[key] === undefined ||
                (Number.isFinite(point[key]) && point[key] >= MIN_CONFIDENCE));
    }

    function armAngle(shoulder, wrist) {
        const video = app.camera.videoElement;
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 480;
        const horizontal = Math.abs(wrist.x - shoulder.x) * width;
        const vertical = (shoulder.y - wrist.y) * height;
        if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || horizontal + Math.abs(vertical) === 0) return NaN;
        return Math.atan2(vertical, horizontal) * 180 / Math.PI;
    }

    function stableFor(gesture, kind, now, duration) {
        if (gesture.confirmation?.kind !== kind) {
            gesture.confirmation = { kind, since: now, samples: 0 };
        }
        const confirmation = gesture.confirmation;
        confirmation.samples++;
        return confirmation.samples >= MIN_STABLE_SAMPLES && now - confirmation.since >= duration;
    }

    function latch(gesture, angle) {
        gesture.phase = 'holding';
        gesture.peak = angle;
        gesture.confirmation = null;
    }

    function confirmRaise(gesture, angle, raised, enabled, now) {
        if (!raised) {
            gesture.confirmation = null;
            return false;
        }
        if (!enabled) {
            latch(gesture, angle);
            return false;
        }
        if (!stableFor(gesture, 'raise', now, RAISE_HOLD_MS)) return false;
        latch(gesture, angle);
        return true;
    }

    function updateArm(gesture, rawAngle, raised, enabled, now) {
        if (!Number.isFinite(rawAngle)) {
            discardEvidence(gesture);
            return false;
        }
        // A rolling median rejects an isolated spike without allowing that
        // spike to become a new peak or a new lowest release angle.
        gesture.samples.push(rawAngle);
        if (gesture.samples.length > 3) gesture.samples.shift();
        if (gesture.samples.length < 3) {
            if (raised && !enabled) latch(gesture, rawAngle);
            return false;
        }
        const angle = [...gesture.samples].sort((a, b) => a - b)[1];

        if (gesture.phase === 'ready') {
            return confirmRaise(gesture, angle, raised, enabled, now);
        }

        if (gesture.phase === 'holding') {
            gesture.peak = Math.max(gesture.peak, angle);
            if (gesture.peak - angle + ANGLE_EPSILON >= REARM_DEGREES) {
                if (stableFor(gesture, 'lower', now, LOWER_HOLD_MS)) {
                    gesture.phase = 'lowered';
                    gesture.low = angle;
                    gesture.confirmation = null;
                }
            } else gesture.confirmation = null;
            return false;
        }

        gesture.low = Math.min(gesture.low, angle);
        if (raised && angle - gesture.low + ANGLE_EPSILON >= REARM_DEGREES) {
            return confirmRaise(gesture, angle, raised, enabled, now);
        }
        gesture.confirmation = null;
        return false;
    }

    function detectLaneGesture(player, landmarks, leftRaised, rightRaised, enabled) {
        let gestures = gesturesByPlayer.get(player);
        if (!gestures) {
            gestures = { left: { phase: 'ready', samples: [] }, right: { phase: 'ready', samples: [] } };
            gesturesByPlayer.set(player, gestures);
        }
        const now = performance.now();
        if (![11, 12, 15, 16].every(index => isTracked(landmarks[index]))) {
            interruptLaneGestures(player);
            return 0;
        }
        if (gestures.lastSampleAt !== undefined &&
            (now < gestures.lastSampleAt || now - gestures.lastSampleAt > MAX_SAMPLE_GAP_MS)) {
            interruptLaneGestures(player);
        }
        gestures.lastSampleAt = now;
        // Even blocked poses consume raises, so leaving a squat/jump/rest cannot
        // turn a held arm into a delayed lane change.
        const left = updateArm(gestures.left, armAngle(landmarks[11], landmarks[15]), leftRaised, enabled && !rightRaised, now);
        const right = updateArm(gestures.right, armAngle(landmarks[12], landmarks[16]), rightRaised, enabled && !leftRaised, now);
        return left ? -1 : right ? 1 : 0;
    }

    return { detectLaneGesture, resetLaneGestures, interruptLaneGestures };
}
