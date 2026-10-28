const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function simulation(count = 1, multiplier = 1) {
    let random = 123, paints = 0, draws = 0, paused = false, callback;
    const gradient = { addColorStop() {} };
    const ctx = new Proxy({}, { get(_, key) {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        return () => { draws++; };
    }, set() { return true; } });
    const document = { hidden: false, addEventListener() {}, documentElement: { classList: { contains: () => false } } };
    const math = Object.create(Math); math.random = () => (random = (1664525 * random + 1013904223) >>> 0) / 4294967296;
    const files = ['src/core/state.js', 'src/rendering/world.js', 'src/rendering/entities.js', 'src/rendering/scene.js', 'src/game/simulation.js'];
    const factories = vm.runInNewContext(files.map(source).join('\n') + '\n({createState,createWorld,createEntities,createScene,createSimulation})', {
        document, Math: math, window: { innerWidth: 1280, innerHeight: 800 },
        requestAnimationFrame(fn) { callback = fn; return 1; }
    });
    const state = factories.createState();
    state.session.numPlayers = count;
    Object.assign(state.game, { gameState: 'playing', speedMultiplier: multiplier, skyEffectsEnabled: true, skyStyle: 3 });
    state.game.skyStarBase = [{ x: 200, y: 40, r: 2, hue: 30, twinkle: 0 }];
    state.game.players.forEach(p => Object.assign(p, { active: true, lives: 999, isJumping: true, shieldActive: true, shieldTimer: 1200, lane: 1 }));
    const app = {
        viewport: { ctx }, pose: { checkPlayerTracking() {} }, energy: { updateEnergy() {} },
        trackingSafety: { isGameplayPaused: () => paused }, hud: { updateHUD() {} },
        notifications: { clearOrbNotify() {}, showOrbNotify() {} }, audio: { playSynth() {} },
        feedback: { hideShieldActive() {}, hideLevelUp() {}, showLevelUp() {} }, session: { gameOver() { state.game.gameState = 'gameover'; } }
    };
    app.world = factories.createWorld({ state, app });
    app.entities = factories.createEntities({ state, app });
    app.scene = factories.createScene({ state, app });
    const render = app.scene.renderGameplay;
    app.scene.renderGameplay = () => { paints++; render(); };
    app.simulation = factories.createSimulation({ state, app });
    return { state, app, document, tick: t => app.simulation.gameLoop(t), scheduled: t => callback(t),
        pause(value) { paused = value; app.simulation.resetFrameClock(); }, paints: () => paints, draws: () => draws,
        snapshot: () => JSON.stringify({ game: state.game, random }) };
}

test('fixed simulation preserves scores, obstacles, timers, animation and RNG at 15–144 FPS in both modes', () => {
    for (const count of [1, 2]) for (const multiplier of [0.65, 1]) {
        let baseline;
        for (const fps of [60, 15, 20, 30, 120, 144]) {
            const f = simulation(count, multiplier);
            f.tick(0);
            for (let n = 1; n <= fps * 6; n++) f.scheduled(n * 1000 / fps);
            assert.equal(f.state.game.frameCount, 361, `${count}P ${multiplier} ${fps} FPS`);
            if (!baseline) baseline = f.snapshot();
            else assert.equal(f.snapshot(), baseline, `all state and random consumption at ${fps} FPS`);
            assert.ok(f.paints() <= fps * 6 + 1, 'at most one paint per display callback');
            if (fps < 60) assert.equal(f.paints(), fps * 6 + 1);
        }
    }
});

test('catch-up steps do not skip collision windows and stop immediately at game over', () => {
    for (const fps of [15, 60]) {
        const f = simulation();
        const p = f.state.game.players[0];
        Object.assign(p, { lives: 1, lane: 0, shieldActive: false });
        f.state.game.obstacles = [{ type: 'block', lane: 0, span: 1, depth: 0.70, active: true }];
        f.tick(0);
        for (let n = 1; n <= 4; n++) f.tick(n * 1000 / fps);
        assert.equal(f.state.game.gameState, 'gameover');
        assert.equal(p.lives, 0);
        assert.equal(f.state.game.frameCount, 3);
    }
});

test('tracking pauses, hidden pages, long stalls and reversed clocks never create catch-up debt', () => {
    const f = simulation();
    f.tick(0); f.tick(10);
    f.pause(true); const frozen = f.snapshot(), draws = f.draws();
    f.tick(100); f.tick(5000);
    assert.equal(f.snapshot(), frozen); assert.equal(f.draws(), draws);
    f.pause(false); f.tick(5010);
    assert.equal(f.state.game.frameCount, 2);
    f.tick(10000); assert.equal(f.state.game.frameCount, 2);
    f.tick(10000 + 1000 / 60); assert.equal(f.state.game.frameCount, 3);
    f.tick(5); assert.equal(f.state.game.frameCount, 3);
    f.document.hidden = true; f.tick(1000);
    f.document.hidden = false; f.tick(9000);
    assert.equal(f.state.game.frameCount, 4);
});

function cameraFixture() {
    let now = 0, requests = [], poseResults = [], observed = [], errors = [], bitmaps = 0;
    const video = { readyState: 2, paused: false, ended: false, currentTime: 1, videoWidth: 640, videoHeight: 480 };
    const elements = new Map([['webcam-video', video]]);
    const document = { hidden: false, addEventListener() {}, getElementById(id) {
        if (!elements.has(id)) elements.set(id, { width: 320, height: 240, style: {}, classList: { add() {}, remove() {} },
            getContext: () => ({ drawImage() {}, save() {}, restore() {}, translate() {}, scale() {}, clearRect() {} }) });
        return elements.get(id);
    } };
    const state = { session: { isCameraInitialized: true, numPlayers: 1 }, game: { gameState: 'calibrating' } };
    const app = {
        poseInference: { inferPose(bitmap, timestamp) { return new Promise((resolve, reject) => requests.push({ resolve, reject, timestamp })); } },
        pose: { onPoseResults: result => poseResults.push(result) }, handPointer: { resetHandPointer() {}, checkHandPointer() {}, observeHandPointer: p => observed.push(p) },
        playerTracking: { getHandPointerPose: p => p[0], trackingReport: () => ({}) }, debug: { record() {}, sample() {} }, debugPanel: { drawDebugFrame() {} }
    };
    const create = vm.runInNewContext(source('src/input/camera.js') + '\ncreateCamera', {
        document, performance: { now: () => now }, requestAnimationFrame: () => 1,
        createImageBitmap: async () => { bitmaps++; return { close() {} }; }, console: { error: (...args) => errors.push(args) }
    });
    app.camera = create({ state, app });
    const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return { state, app, video, document, requests, poseResults, observed, errors, drain,
        advance: ms => { now += ms; }, bitmaps: () => bitmaps };
}

test('camera has one in-flight frame, keeps scheduling, then captures the latest frame without a backlog', async () => {
    const f = cameraFixture();
    const first = f.app.camera.predictWebcam(); await f.drain();
    f.video.currentTime = 2;
    f.app.camera.predictWebcam(); f.app.camera.predictWebcam(); await f.drain();
    assert.equal(f.requests.length, 1); assert.equal(f.bitmaps(), 1);
    f.requests[0].resolve({ landmarks: [['first']], inferenceMs: 12 }); await first;
    const next = f.app.camera.predictWebcam(); await f.drain();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve({ landmarks: [['latest']], inferenceMs: 10 }); await next;
    assert.deepEqual(JSON.parse(JSON.stringify(f.poseResults)), [{ landmarks: [['first']] }, { landmarks: [['latest']] }]);
    assert.equal(f.app.camera.readCameraStatus().inferenceMs, 10);
});

test('stale, hidden, reversed-camera and previous-phase/generation results cannot supply poses or hand input', async () => {
    for (const scenario of ['stale', 'hidden', 'reversed', 'phase', 'generation', 'mode']) {
        const f = cameraFixture();
        const work = f.app.camera.predictWebcam(); await f.drain();
        if (scenario === 'stale') f.advance(251);
        if (scenario === 'hidden') f.document.hidden = true;
        if (scenario === 'reversed') f.video.currentTime = 0;
        if (scenario === 'phase') f.state.game.gameState = 'playing';
        if (scenario === 'generation') f.app.camera.invalidatePoseFrame();
        if (scenario === 'mode') f.state.session.numPlayers = 2;
        f.requests[0].resolve({ landmarks: [['stale']], inferenceMs: 300 }); await work;
        assert.ok(f.poseResults.every(result => result.landmarks.length === 0), scenario);
        assert.equal(f.observed.length, 0, scenario);
    }
});

test('inference errors suspend input but allow a fresh worker result to recover', async () => {
    const f = cameraFixture();
    let work = f.app.camera.predictWebcam(); await f.drain();
    f.requests[0].reject(Error('inference failed')); await work;
    assert.equal(f.app.camera.readCameraStatus().trackingError, true);
    assert.equal(f.poseResults[0].landmarks.length, 0);
    f.video.currentTime++;
    work = f.app.camera.predictWebcam(); await f.drain();
    f.requests[1].resolve({ landmarks: [['fresh']], inferenceMs: 20 }); await work;
    assert.equal(f.app.camera.readCameraStatus().trackingError, false);
    assert.equal(f.poseResults[1].landmarks[0][0], 'fresh');
});
