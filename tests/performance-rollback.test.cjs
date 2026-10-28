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
        pause(value) { paused = value; }, paints: () => paints, draws: () => draws,
        snapshot: () => JSON.stringify({ game: state.game, random }) };
}

test('rollback advances and renders exactly once per animation callback without catch-up', () => {
    for (const count of [1, 2]) for (const multiplier of [0.65, 1]) {
        let baseline;
        for (const fps of [15, 30, 60, 120, 144]) {
            const f = simulation(count, multiplier);
            f.tick(0);
            for (let n = 1; n <= 60; n++) f.scheduled(n * 1000 / fps);
            assert.equal(f.state.game.frameCount, 61);
            assert.equal(f.paints(), 61);
            if (!baseline) baseline = f.snapshot();
            else assert.equal(f.snapshot(), baseline, 'callback count preserves animation and random order');
            f.scheduled(60000);
            assert.equal(f.state.game.frameCount, 62, 'a long gap still produces only one step');
            assert.equal(f.paints(), 62);
        }
    }
});

test('rollback keeps tracking pauses frozen and resumes with one frame', () => {
    const f = simulation(2);
    f.tick(0);
    f.pause(true);
    const frozen = f.snapshot(), draws = f.draws();
    f.scheduled(100); f.scheduled(60000);
    assert.equal(f.snapshot(), frozen);
    assert.equal(f.draws(), draws);
    f.pause(false); f.scheduled(60001);
    assert.equal(f.state.game.frameCount, 2);
    assert.equal(f.paints(), 2);
});
