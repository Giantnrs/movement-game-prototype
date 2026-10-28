/** Move the interface cursor with a compact, relative hand touchpad. */
function createHandPointer({ state, app }) {
    const MAX_GAP_MS = 250;
    let activeHand = null, lastAt, position = null, reference = null;
    let samples = [];

    function valid(point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
            ['visibility', 'presence'].every(key => point[key] === undefined ||
                (Number.isFinite(point[key]) && point[key] >= 0.6));
    }

    function releaseHand() {
        activeHand = null;
        lastAt = undefined;
        reference = null;
        samples = [];
        app.handCursor.clearHandCursor();
    }

    function resetHandPointer() {
        releaseHand();
        position = null;
    }

    function observeHandPointer(pose) {
        const now = performance.now();
        if (state.game.gameState === 'playing' || !state.session.isCameraInitialized || document.hidden || !document.hasFocus() ||
            ![11, 12, 23, 24].every(index => valid(pose?.[index]))) {
            resetHandPointer(); return;
        }
        if (lastAt !== undefined && (now <= lastAt || now - lastAt > MAX_GAP_MS)) {
            resetHandPointer();
        }
        const shoulderY = (pose[11].y + pose[12].y) / 2;
        const width = Math.abs(pose[11].x - pose[12].x);
        const torso = (pose[23].y + pose[24].y) / 2 - shoulderY;
        if (width < 0.05 || torso < 0.1) { resetHandPointer(); return; }
        // A brief confidence dropout must not silently choose the other hand.
        if (activeHand !== null && !valid(pose[activeHand])) {
            reference = null;
            samples = [];
            app.handCursor.clearHandCursor(); return;
        }
        const raised = (index, allowance = 0.2) => valid(pose[index]) &&
            pose[index].y <= shoulderY + torso * allowance + 1e-6;
        const hand = activeHand !== null && raised(activeHand, 0.4) ? activeHand
            : raised(16) ? 16 : raised(15) ? 15 : null;
        // Lowering is a clutch: re-position the hand without moving the cursor.
        if (hand === null) { releaseHand(); return; }
        if (hand !== activeHand || !reference) {
            app.handCursor.clearHandCursor();
            position ??= { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            samples = [];
            activeHand = hand;
            // Capture a compact touchpad around the raised wrist. A full-screen
            // swipe needs only 0.8 shoulder widths / 0.45 torso heights; body
            // landmark noise cannot rescale the pad while the hand is raised.
            reference = { x: pose[hand].x, y: pose[hand].y, cursor: { ...position },
                width: width * 0.8, height: torso * 0.45 };
        }
        const marginX = Math.min(26, window.innerWidth / 2);
        const marginY = Math.min(26, window.innerHeight / 2);
        samples.push({ x: pose[hand].x, y: pose[hand].y });
        if (samples.length > 3) samples.shift();
        const median = axis => [...samples].map(point => point[axis]).sort((a, b) => a - b)[Math.floor((samples.length - 1) / 2)];
        const intent = {
            x: reference.cursor.x - (median('x') - reference.x) / reference.width * Math.max(0, window.innerWidth - marginX * 2),
            y: reference.cursor.y + (median('y') - reference.y) / reference.height * Math.max(0, window.innerHeight - marginY * 2)
        };
        // Rebase confirmed edge overshoot, so reversing a swipe immediately
        // comes back onscreen. Filter before rebasing: a lone spike cannot drag
        // the touchpad origin to a new place.
        for (const [axis, low, high] of [['x', marginX, window.innerWidth - marginX], ['y', marginY, window.innerHeight - marginY]]) {
            const bounded = Math.max(low, Math.min(high, intent[axis]));
            reference.cursor[axis] += bounded - intent[axis];
            intent[axis] = bounded;
        }
        if (lastAt !== undefined) {
            const dx = intent.x - position.x, dy = intent.y - position.y;
            const distance = Math.hypot(dx, dy);
            const deadzone = Math.max(10, Math.min(32, Math.max(window.innerWidth, window.innerHeight) / 45));
            // Strong filtering near rest, quicker response for intentional moves.
            const tau = 180 - 125 * Math.min(1, Math.max(0, distance - 20) / 120);
            const alpha = (1 - Math.exp(-(now - lastAt) / tau)) * Math.max(0, distance - deadzone) / (distance || 1);
            position = { x: position.x + dx * alpha, y: position.y + dy * alpha };
        }
        lastAt = now;
        // The median intent stays ahead of visual smoothing and rejects isolated
        // wrist spikes. Sustained departures still cancel a pending dwell.
        app.handCursor.updateHandCursor(position, intent, now);
    }

    function checkHandPointer() {
        const now = performance.now();
        const video = app.camera.videoElement;
        if (state.game.gameState === 'playing' || document.hidden || !document.hasFocus() || !state.session.isCameraInitialized || video.paused || video.ended ||
            (lastAt !== undefined && (now < lastAt || now - lastAt > MAX_GAP_MS))) resetHandPointer();
    }

    window.addEventListener('blur', resetHandPointer);
    window.addEventListener('resize', resetHandPointer);
    document.addEventListener('visibilitychange', resetHandPointer);
    return { observeHandPointer, checkHandPointer, resetHandPointer };
}
