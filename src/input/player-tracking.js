/** Calibration-owned player slots. Unmatched poses never enroll during play. */
function createPlayerTracking({ state, app }) {
    const MIN_CONFIDENCE = 0.55;
    const STALE_MS = 500;
    const REACQUIRE_MS = 300;
    const LONG_LOSS_MS = 2000;
    const EXTENDED_REACQUIRE_MS = 1000;
    const AMBIGUITY_MARGIN = 0.35;
    let tracks = [];
    let calibrationTracks = [], calibrationToken = 0;
    let frameId = 0;
    let report = { frameId: 0, rawCount: 0, validCount: 0, selected: [], accepted: [], ignored: [], costs: [], candidates: [] };

    function resetEnrollment() {
        tracks = [];
        resetCalibrationSelection();
        report = { frameId: ++frameId, rawCount: 0, validCount: 0, selected: [], accepted: [], ignored: [], costs: [], candidates: [] };
    }

    function resetCalibrationSelection() { calibrationTracks = []; }

    // Temporary associations only: these never enroll gameplay slots. A new
    // association gets a new token so readiness cannot mix two people's samples.
    function selectCalibrationPlayers(poses, zones) {
        const now = performance.now();
        const candidates = poses.map(describe);
        const hipX = pose => [23, 24].every(id => Number.isFinite(pose?.[id]?.x) &&
            Number.isFinite(pose[id].y)) ? (pose[23].x + pose[24].x) / 2 : null;
        const bounds = pose => {
            const points = [11, 12, 23, 24].map(id => pose?.[id]);
            if (!points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return null;
            return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
                right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) };
        };
        const boxes = poses.map(bounds);
        const overlaps = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.02 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.04;
        return zones.map((zone, slot) => {
            let track = calibrationTracks[slot];
            if (track && (now < track.lastSeen || now - track.lastSeen > 300)) {
                calibrationTracks[slot] = track = null;
            }
            const eligible = poses.map((pose, index) => ({ index, x: hipX(pose) }))
                .filter(item => item.x !== null && item.x >= zone[0] - 1e-6 && item.x <= zone[1] + 1e-6);
            let selected;
            if (track) {
                const ranked = eligible.map(({ index }) => {
                    const candidate = candidates[index];
                    if (!candidate) return { index, cost: Infinity };
                    const distance = Math.hypot((candidate.center.x - track.center.x) / 0.12,
                        (candidate.center.y - track.center.y) / 0.12);
                    const torso = Math.abs(Math.log(candidate.torso / track.profile.torso));
                    const hip = Math.abs(Math.log(candidate.hipWidth / track.profile.hipWidth));
                    return { index, cost: distance <= 1 && torso <= 0.22 && hip <= 0.35
                        ? distance + torso * 0.15 + hip * 0.15 : Infinity };
                }).filter(item => Number.isFinite(item.cost)).sort((a, b) => a.cost - b.cost);
                if (ranked.length > 1 && ranked[1].cost - ranked[0].cost < AMBIGUITY_MARGIN) {
                    return { reason: 'uncertain', token: track.token };
                }
                selected = ranked[0]?.index;
                // Keep invalid torso frames available for readiness guidance,
                // but never substitute a different valid person during grace.
                if (selected === undefined && eligible.length === 1 && !candidates[eligible[0].index]) selected = eligible[0].index;
                if (selected === undefined) return { reason: 'steady', token: track.token };
            } else {
                if (eligible.length > 1) return { reason: 'uncertain' };
                selected = eligible[0]?.index;
            }
            if (selected === undefined) return {};
            const box = boxes[selected];
            if (boxes.some((other, index) => index !== selected && overlaps(box, other))) {
                return { index: selected, bounds: box, reason: 'uncertain', token: track?.token };
            }
            if (candidates[selected]) {
                if (!track) {
                    track = { ...createTrack(candidates[selected], now), token: ++calibrationToken };
                    calibrationTracks[slot] = track;
                }
                track.center = candidates[selected].center;
                track.lastSeen = now;
            }
            return { index: selected, bounds: box, token: track?.token };
        });
    }

    function describe(landmarks, index) {
        const indices = [11, 12, 23, 24];
        if (!indices.every(index => {
            const point = landmarks?.[index];
            return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
                ['visibility', 'presence'].every(key => point[key] === undefined ||
                    (Number.isFinite(point[key]) && point[key] >= MIN_CONFIDENCE));
        })) return null;
        const video = app.camera.videoElement;
        const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
        const points = indices.map(index => ({ x: landmarks[index].x * aspect, y: landmarks[index].y }));
        const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const shoulders = midpoint(points[0], points[1]);
        const center = midpoint(points[2], points[3]);
        const shoulderWidth = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const hipWidth = Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y);
        const torso = Math.hypot(shoulders.x - center.x, shoulders.y - center.y);
        if (Math.min(shoulderWidth, hipWidth, torso) < 0.03) return null;
        return { index, landmarks, center, shoulderWidth, hipWidth, torso, hipRatio: hipWidth / shoulderWidth };
    }

    function createTrack(candidate, now) {
        return { profile: { shoulderWidth: candidate.shoulderWidth, hipWidth: candidate.hipWidth,
                torso: candidate.torso, hipRatio: candidate.hipRatio },
            center: candidate.center, velocity: { x: 0, y: 0 }, lastSeen: now,
            status: 'tracked', recovery: null, extendedRecovery: false };
    }

    function evaluateMatch(track, candidate, now) {
        const profile = track.profile;
        const widthDifference = Math.abs(Math.log(candidate.shoulderWidth / profile.shoulderWidth));
        const torsoDifference = Math.abs(Math.log(candidate.torso / profile.torso));
        const hipDifference = Math.abs(Math.log(candidate.hipWidth / profile.hipWidth));
        const recovering = track.status !== 'tracked';
        const dt = recovering ? 0 : Math.min(Math.max(now - track.lastSeen, 0), 125) / 1000;
        const predicted = { x: track.center.x + track.velocity.x * dt, y: track.center.y + track.velocity.y * dt };
        const xGate = Math.max(0.12, Math.min(0.3, profile.hipWidth * 1.15));
        const yGate = Math.max(0.25, Math.min(0.4, profile.torso));
        const distance = Math.hypot((candidate.center.x - predicted.x) / xGate, (candidate.center.y - predicted.y) / yGate);
        const recoveryDistance = Math.hypot((candidate.center.x - predicted.x) / (xGate * (recovering ? 0.65 : 1)),
            (candidate.center.y - predicted.y) / (yGate * (recovering ? 0.8 : 1)));
        const evidence = { distance, recoveryDistance, widthDifference, torsoDifference, hipDifference };
        if (distance > 1) return { ...evidence, cost: Infinity, ambiguityCost: Infinity, reason: 'position' };
        // Hip position and bounded motion lead association. Fixed hips/torso
        // reject gross scale changes without treating raised shoulders as a
        // different person. Shoulder width contributes only a capped soft cost.
        if (hipDifference > 0.45 || torsoDifference > 0.6) {
            return { ...evidence, cost: Infinity, ambiguityCost: Infinity, reason: 'body_scale' };
        }
        const cost = distance * 2 + Math.min(widthDifference, 1) * 0.1 +
            Math.min(torsoDifference, 1) * 0.15 + Math.min(hipDifference, 1) * 0.15;
        // Use the same ambiguity scale before/after loss. Narrowing the recovery
        // gate must not make unchanged overlapping people suddenly look distinct.
        return { ...evidence, cost: recoveryDistance > 1 ? Infinity : cost, ambiguityCost: cost,
            reason: recoveryDistance > 1 ? 'recovery_position' : 'plausible' };
    }

    function lose(track, status = 'lost') {
        track.status = status;
        track.recovery = null;
        track.velocity = { x: 0, y: 0 };
        if (status === 'uncertain') track.extendedRecovery = true;
    }

    function expire(now) {
        for (const track of tracks) {
            if (now - track.lastSeen > LONG_LOSS_MS) track.extendedRecovery = true;
            if (now - track.lastSeen > STALE_MS && track.status === 'tracked') lose(track);
        }
    }

    function updateTrack(track, candidate, now) {
        if (track.status !== 'tracked') {
            const recovery = track.recovery;
            // An interrupted or moving candidate must start its confirmation again.
            if (!recovery || now - recovery.lastAt > STALE_MS ||
                Math.hypot(candidate.center.x - recovery.center.x, candidate.center.y - recovery.center.y) > 0.06) {
                track.recovery = { since: now, lastAt: now, center: candidate.center, samples: 1 };
                track.status = 'checking';
                return false;
            }
            // Only fresh observations can advance confirmation. The watchdog
            // never counts as a sample or extends the last trusted position.
            if (now <= recovery.lastAt) return false;
            recovery.lastAt = now;
            recovery.samples++;
            const requiredMs = track.extendedRecovery ? EXTENDED_REACQUIRE_MS : REACQUIRE_MS;
            const requiredSamples = track.extendedRecovery ? 5 : 3;
            if (now - recovery.since < requiredMs || recovery.samples < requiredSamples) return false;
            track.recovery = null;
            track.status = 'tracked';
            track.extendedRecovery = false;
        }
        const dt = Math.max(now - track.lastSeen, 1) / 1000;
        for (const axis of ['x', 'y']) {
            const speed = (candidate.center[axis] - track.center[axis]) / dt;
            track.velocity[axis] = Math.max(-0.6, Math.min(0.6, speed)) * 0.5 + track.velocity[axis] * 0.5;
        }
        track.center = candidate.center;
        track.lastSeen = now;
        return true;
    }

    // Called only after readiness and neutral-pose sampling have completed.
    function lockPlayers(poses) {
        const candidates = poses.map(describe);
        if (candidates.length !== state.session.numPlayers || candidates.some(candidate => !candidate)) return false;
        candidates.sort((a, b) => b.center.x - a.center.x);
        tracks = candidates.map(candidate => createTrack(candidate, performance.now()));
        report = { frameId: ++frameId, rawCount: poses.length, validCount: candidates.length,
            selected: candidates.map(candidate => candidate.index), accepted: candidates.map(candidate => candidate.index),
            ignored: [], costs: [], candidates: [] };
        return true;
    }

    function matchPlayers(poses) {
        const now = performance.now();
        const candidates = poses.map(describe).filter(Boolean);
        expire(now);
        const evidence = tracks.map(track => candidates.map(candidate => evaluateMatch(track, candidate, now)));
        const costs = evidence.map(row => row.map(item => item.cost));
        const ambiguityCosts = evidence.map(row => row.map(item => item.ambiguityCost));
        // Reject an ambiguous row (two plausible people) or column (one body
        // plausibly belongs to both players). Never break ties by detector order.
        const ambiguous = new Set();
        for (let i = 0; i < ambiguityCosts.length; i++) {
            const sorted = ambiguityCosts[i].filter(Number.isFinite).sort((a, b) => a - b);
            if (sorted.length > 1 && sorted[1] - sorted[0] < AMBIGUITY_MARGIN) ambiguous.add(i);
        }
        for (let j = 0; j < candidates.length; j++) {
            const possible = ambiguityCosts.map((row, i) => ({ i, cost: row[j] })).filter(item => Number.isFinite(item.cost));
            if (possible.length > 1) possible.forEach(item => ambiguous.add(item.i));
        }
        const selected = costs.map(row => {
            let best = -1;
            row.forEach((cost, index) => { if (Number.isFinite(cost) && (best < 0 || cost < row[best])) best = index; });
            return best;
        });
        // No two tracks may claim the same candidate, even with unequal costs.
        for (let i = 0; i < selected.length; i++) {
            if (selected[i] >= 0 && selected.some((candidate, other) => other !== i && candidate === selected[i])) ambiguous.add(i);
        }
        report = { frameId: ++frameId, at: now, rawCount: poses.length, validCount: candidates.length,
            selected: selected.map(index => index < 0 ? null : candidates[index].index), ambiguous: [...ambiguous],
            costs: costs.map(row => row.map(cost => Number.isFinite(cost) ? Math.round(cost * 1000) / 1000 : null)),
            ambiguityCosts: ambiguityCosts.map(row => row.map(cost => Number.isFinite(cost) ? Math.round(cost * 1000) / 1000 : null)),
            evidence: evidence.map(row => row.map(({ cost, ambiguityCost, ...item }) => item)),
            candidates: candidates.map(({ index, center, shoulderWidth, hipWidth, torso, hipRatio }) => ({ index, center, shoulderWidth, hipWidth, torso, hipRatio })) };
        const matched = Array.from({ length: state.session.numPlayers }, (_, i) => {
            const track = tracks[i];
            if (!track) return null;
            if (ambiguous.has(i)) { lose(track, 'uncertain'); return null; }
            if (selected[i] < 0) { lose(track); return null; }
            const candidate = candidates[selected[i]];
            return updateTrack(track, candidate, now) ? candidate.landmarks : null;
        });
        report.accepted = matched.map((pose, i) => pose ? report.selected[i] : null);
        // Only call candidates ignored when all locked slots were identified.
        report.ignored = matched.every(Boolean)
            ? poses.map((_, index) => index).filter(index => !report.accepted.includes(index)) : [];
        return matched;
    }

    function trackingStatuses() {
        expire(performance.now());
        return Array.from({ length: state.session.numPlayers }, (_, i) => tracks[i]?.status || 'unregistered');
    }

    function trackingReport() {
        return { ...report, tracks: tracks.map(track => ({ center: track.center, profile: track.profile,
            ageMs: Math.round(performance.now() - track.lastSeen), status: track.status,
            recovery: { mode: track.extendedRecovery ? 'extended' : 'brief',
                requiredMs: track.extendedRecovery ? EXTENDED_REACQUIRE_MS : REACQUIRE_MS,
                elapsedMs: track.recovery ? Math.round(performance.now() - track.recovery.since) : 0,
                samples: track.recovery?.samples || 0 } })) };
    }

    function getHandPointerPose(poses) {
        // After explicit enrollment, only the original matched Player 1 can
        // operate the UI, including on result/dashboard screens.
        if (tracks.length) return matchPlayers(poses)[0] || null;
        // Before calibration there are no identity locks. Use only an
        // unambiguous intended position; this never creates a player slot.
        if (!poses.length || poses.length > state.session.numPlayers) return null;
        const candidates = poses.map(describe);
        if (candidates.some(candidate => !candidate)) return null;
        candidates.sort((a, b) => b.center.x - a.center.x);
        if (state.session.numPlayers === 1) return candidates[0].landmarks;
        const centerX = candidate => (candidate.landmarks[23].x + candidate.landmarks[24].x) / 2;
        if (centerX(candidates[0]) < 0.54) return null;
        if (candidates[1] && (centerX(candidates[1]) > 0.46 ||
            centerX(candidates[0]) - centerX(candidates[1]) < 0.18)) return null;
        return candidates[0].landmarks;
    }

    return { resetEnrollment, lockPlayers, matchPlayers, trackingStatuses, trackingReport, getHandPointerPose,
        resetCalibrationSelection, selectCalibrationPlayers };
}
