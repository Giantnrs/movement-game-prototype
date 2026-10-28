const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');

function pose(x = 0.5, { size = 1, hipRatio = 0.7, left = 0.8, right = 0.8 } = {}) {
    const points = Array.from({ length: 33 }, () => ({ x, y: 0.4, visibility: 1, presence: 1 }));
    const point = (px, py) => ({ x: px, y: py, visibility: 1, presence: 1 });
    points[11] = point(x + 0.1 * size, 0.4);
    points[12] = point(x - 0.1 * size, 0.4);
    points[23] = point(x + 0.1 * size * hipRatio, 0.4 + 0.3 * size);
    points[24] = point(x - 0.1 * size * hipRatio, 0.4 + 0.3 * size);
    points[15] = point(x + 0.23 * size, left);
    points[16] = point(x - 0.23 * size, right);
    return points;
}

function fixture(count = 1, fps = 60) {
    let now = 0;
    let calibrationView;
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { style: {}, value: 'en', innerText: '' });
        return elements.get(id);
    } };
    const files = ['src/core/state.js', 'src/input/arm-postures.js', 'src/input/lane-gestures.js', 'src/input/player-tracking.js', 'src/input/calibration.js', 'src/game/tracking-safety.js', 'src/input/pose.js'];
    const factories = vm.runInNewContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') +
        '\n({ createState, createArmPostures, createLaneGestures, createPlayerTracking, createCalibration, createTrackingSafety, createPose });', {
        window: { innerWidth: 1280, innerHeight: 800 }, document, performance: { now: () => now }
    });
    const state = factories.createState();
    state.session.numPlayers = count;
    const app = {
        energy: { recordEnergyAction() {}, suspendEnergy() {} },
        finishPhoto: { resetFinishPhoto() {}, observeFinishPlayers() {} },
        debug: { enabled: false, record() {}, sample() {}, transition() {}, setDebugStatus() {} },
        camera: { readCameraStatus() { return {}; }, videoElement: { videoWidth: 640, videoHeight: 480 } },
        hud: { updateHUD() {} }, audio: { bgMusic: { pause() {}, play() { return Promise.resolve(); } }, playSynth() {} },
        localization: { translations: { en: { learning: 'Learning your neutral pose.' } } },
        trackingStatus: { clearTrackingStatus() {}, refreshTrackingStatus() {}, resetCalibrationMessages() {}, renderCalibration(result) { calibrationView = result; return true; } },
        session: { startGameplay() {
            state.game.gameState = 'playing';
            state.game.players.forEach(player => app.laneGestures.resetLaneGestures(player));
        } }
    };
    app.armPostures = factories.createArmPostures({ state, app });
    app.laneGestures = factories.createLaneGestures({ state, app });
    const tracker = app.playerTracking = factories.createPlayerTracking({ state, app });
    app.calibration = factories.createCalibration({ state, app });
    app.trackingSafety = factories.createTrackingSafety({ state, app });
    app.pose = factories.createPose({ state, app });
    const step = (poses, enroll = false, ms = 1000 / fps) => {
        now += ms;
        if (enroll && !tracker.lockPlayers(poses)) return Array(count).fill(null);
        return tracker.matchPlayers(poses);
    };
    const feed = (poses, frames = 1) => {
        for (let i = 0; i < frames; i++) { now += 1000 / fps; app.pose.onPoseResults({ landmarks: poses }); }
    };
    return { state, app, tracker, step, feed, document, view: () => calibrationView, advance: ms => { now += ms; } };
}

test('hand pointer uses the sole pre-calibration operator or mirrored-left Player 1 without enrolling anyone', () => {
    const one=fixture(),two=fixture(2);
    const first=pose(0.75),second=pose(0.25);
    assert.equal(one.tracker.getHandPointerPose([first]),first);
    assert.equal(one.tracker.getHandPointerPose([first,second]),null);
    assert.equal(two.tracker.getHandPointerPose([second,first]),first);
    assert.equal(two.tracker.getHandPointerPose([first]),first);
    assert.equal(two.tracker.getHandPointerPose([second]),null);
    assert.equal(two.tracker.getHandPointerPose([first,pose(0.7)]),null);
    assert.equal(two.tracker.getHandPointerPose([first,second,pose(0.95)]),null);
    assert.deepEqual(Array.from(two.tracker.trackingStatuses()),['unregistered','unregistered']);
    assert.equal(two.tracker.trackingReport().tracks.length,0);
});

test('after enrollment the hand pointer keeps Player 1 through reordered detections and ignores Player 2 and bystanders', () => {
    const f=fixture(2),first=pose(0.75),second=pose(0.25),bystander=pose(0.95,{size:0.5});
    f.step([first,second],true);
    f.advance(100);
    assert.equal(f.tracker.getHandPointerPose([second,bystander,first]),first);
    f.advance(100);
    assert.equal(f.tracker.getHandPointerPose([second,bystander]),null);
    for(let i=0;i<10;i++) {f.advance(100);assert.equal(f.tracker.getHandPointerPose([second]),null);}
    assert.equal(f.tracker.trackingReport().tracks.length,2,'missing Player 1 is never replaced');
});

test('only explicit calibration can enroll players, supplying exactly the selected player poses', () => {
    const { tracker, step } = fixture();
    const player = pose(0.7), bystander = pose(0.2);
    assert.equal(step([player])[0], null);
    assert.equal(tracker.matchPlayers([player], true)[0], null, 'matching cannot begin enrollment');
    assert.equal(step([player, bystander], true)[0], null);
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    assert.equal(step([player], true)[0], player);
    assert.equal(step([bystander])[0], null);
    for (let i = 0; i < 100; i++) assert.equal(step([bystander])[0], null);
});

test('newcomers and detector order changes do not take over a registered single player', () => {
    const { step } = fixture();
    const player = pose(0.7), newcomer = pose(0.2), background = pose(0.7, { size: 0.5 });
    step([player], true);
    for (const candidates of [[newcomer, player], [player, newcomer], [background, newcomer, player]]) {
        assert.equal(step(candidates)[0], player);
    }
    assert.equal(step([background])[0], null, 'a different body at the same position is rejected');
});

test('two-player slots persist when only one player remains visible', () => {
    const { step } = fixture(2);
    const first = pose(0.75), second = pose(0.25), third = pose(0.95, { size: 0.5 });
    const enrolled = step([second, first], true);
    assert.equal(enrolled[0], first);
    assert.equal(enrolled[1], second);
    const matched = step([third, second]);
    assert.equal(matched[0], null);
    assert.equal(matched[1], second, 'the remaining player does not shift into slot zero');
});

test('matching follows gradual motion rather than fixed horizontal order', () => {
    const { step } = fixture(2);
    step([pose(0.75), pose(0.25)], true);
    for (let i = 1; i <= 15; i++) {
        const first = pose(0.75 + i * 0.004), second = pose(0.25 + i * 0.004);
        const matched = step(i % 2 ? [second, first] : [first, second]);
        assert.equal(matched[0], first);
        assert.equal(matched[1], second);
    }
});

test('calibrated body proportions stay fixed and cannot drift into a different person', () => {
    const { step } = fixture();
    step([pose()], true);
    assert.equal(step([pose(0.5, { hipRatio: 1.4 })])[0], null);
    for (let i = 0; i < 60; i++) assert.equal(step([pose(0.5, { hipRatio: 1.4 })])[0], null);
});

test('overlapping candidates pause and can recover after a clear stable match', () => {
    const { tracker, step } = fixture();
    const original = pose(0.6), intruder = pose(0.62);
    step([original], true);
    const profile = JSON.stringify(tracker.trackingReport().tracks[0].profile);
    for (let i = 0; i < 120; i++) {
        assert.equal(step([original, intruder])[0], null);
        assert.equal(tracker.trackingStatuses()[0], 'uncertain');
    }
    for (let i = 0; i < 40; i++) assert.equal(step([original])[0], null);
    assert.equal(tracker.trackingStatuses()[0], 'checking');
    let result;
    for (let i = 0; i < 30; i++) result = step([original]);
    assert.equal(result[0], original);
    assert.equal(tracker.trackingStatuses()[0], 'tracked');
    assert.equal(JSON.stringify(tracker.trackingReport().tracks[0].profile), profile);
});

test('one candidate plausible for both players cannot swap or merge their identities', () => {
    const { tracker, step } = fixture(2);
    step([pose(0.65), pose(0.35)], true);
    const matched = step([pose(0.5)]);
    assert.equal(matched[0], null);
    assert.equal(matched[1], null);
    assert.deepEqual(Array.from(tracker.trackingStatuses()), ['uncertain', 'uncertain']);
});

test('a brief loss requires a stable 300ms match before controls resume', () => {
    const { step, tracker } = fixture();
    const original = pose();
    step([original], true);
    step([]);
    for (let i = 0; i < 18; i++) assert.equal(step([original])[0], null);
    assert.equal(tracker.trackingStatuses()[0], 'checking');
    let result;
    for (let i = 0; i < 3; i++) result = step([original]);
    assert.equal(result[0], original);
    assert.equal(tracker.trackingStatuses()[0], 'tracked');
});

test('long losses keep the original slot and recover after one second of stable matching', () => {
    const { step, tracker, advance } = fixture();
    const original = pose();
    step([original], true);
    advance(5000);
    for (let i = 0; i < 40; i++) assert.equal(step([original])[0], null);
    assert.equal(tracker.trackingStatuses()[0], 'checking');
    assert.equal(tracker.trackingReport().tracks[0].recovery.requiredMs, 1000);
    let result;
    for (let i = 0; i < 30; i++) result = step([original]);
    assert.equal(result[0], original);
    assert.equal(tracker.trackingStatuses()[0], 'tracked');
});

test('uncertain torso landmarks and malformed poses cannot enroll or update a player', () => {
    for (const [index, key, value] of [[11, 'visibility', 0.1], [24, 'presence', 0.2], [23, 'x', NaN], [12, 'y', Infinity]]) {
        const { step } = fixture();
        const bad = pose(); bad[index][key] = value;
        assert.equal(step([bad], true)[0], null);
        const original = pose(); step([original], true);
        assert.equal(step([bad])[0], null);
    }
    const { step } = fixture();
    assert.equal(step([[]], true)[0], null);
});

test('all players must calibrate; a missing second player is never automatically replaced', () => {
    const { state, feed, app } = fixture(2);
    state.game.gameState = 'calibrating';
    const first = pose(0.75), second = pose(0.25);
    feed([first], 65);
    assert.equal(state.game.gameState, 'calibrating');
    assert.equal(state.game.players[0].calibrationFrames, 0);
    feed([second, first], 30);
    feed([first], 10);
    assert.equal(state.game.gameState, 'calibrating');
    feed([first, second], 150);
    assert.equal(state.game.gameState, 'playing');
    assert.ok(state.game.players[0].calibrationFrames >= 5);
    assert.ok(state.game.players[1].calibrationFrames >= 5);
    app.pose.beginCalibration();
    state.game.gameState = 'calibrating';
    feed([pose(0.8, { size: 0.7 }), pose(0.2, { size: 0.7 })], 150);
    assert.equal(state.game.gameState, 'playing', 'explicit recalibration can register different players');
});

test('lost or stalled tracking clears jump, duck, rest and pending lane gestures', () => {
    const { state, app, feed, advance } = fixture();
    state.game.gameState = 'calibrating';
    feed([pose()], 150);
    const player = state.game.players[0];
    feed([pose(0.5, { left: 0.4 })], 10);
    assert.equal(player.lane, -1);
    player.lane = 0;
    player.isJumping = player.isSquatting = player.isResting = player.armsCrossedNow = player.restingMode = true;
    advance(600);
    app.pose.checkPlayerTracking();
    for (const key of ['isJumping', 'isSquatting', 'isResting', 'armsCrossedNow', 'restingMode']) assert.equal(player[key], false);
    feed([pose(0.5, { left: 0.4 })], 60);
    assert.equal(player.lane, 0, 'a held arm cannot replay a move when tracking returns');
    feed([pose()], 30);
    feed([pose(0.5, { left: 0.4 })], 10);
    assert.equal(player.lane, -1, 'a fresh deliberate gesture still works');
});

test('a suitable position starts torso sampling immediately and locks after a short sample and fresh final check', () => {
    const { state, feed, tracker, view } = fixture();
    state.game.gameState = 'calibrating';
    feed([pose()], 30);
    assert.equal(view().phase, 'sampling');
    assert.ok(view().progress > 0.5);
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    assert.equal(state.game.players[0].baseline, 0);
    feed([pose()], 16);
    assert.equal(view().phase, 'sampling');
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    assert.equal(state.game.players[0].calibrationFrames, 0);
    feed([pose()], 10);
    assert.equal(state.game.gameState, 'playing');
    assert.equal(tracker.trackingStatuses()[0], 'tracked');
    assert.ok(Math.abs(state.game.players[0].baseline - 0.4) < 1e-9);
});

test('unsuitable positions give guidance and can recover automatically without locking', () => {
    const scenarios = [
        ['players', () => []],
        ['visibility', () => { const p = pose(); p[11].visibility = 0.1; return [p]; }],
        ['visibility', () => { const p = pose(); p[24].x = NaN; return [p]; }],
        ['frame', () => { const p = pose(); p[12].x = -0.05; return [p]; }],
        ['closer', () => [pose(0.5, { size:0.3 })]],
        ['back', () => { const p = pose(); p[23].y = p[24].y = 0.95; return [p]; }],
        ['neutral', () => { const p = pose(); p[11].y = 0.46; p[12].y = 0.34; return [p]; }],
        ['center', () => [pose(0.15)]]
    ];
    for (const [reason, invalid] of scenarios) {
        const { state, feed, tracker, view } = fixture();
        state.game.gameState = 'calibrating';
        feed(invalid(), 150);
        assert.equal(view().phase, 'waiting', reason);
        assert.equal(view().reason, reason);
        assert.equal(view().progress, 0);
        assert.equal(tracker.trackingStatuses()[0], 'unregistered');
        feed([pose()], 150);
        assert.equal(state.game.gameState, 'playing', `${reason}: corrected position automatically starts a fresh attempt`);
    }
});

test('walking across the image cannot finish torso sampling', () => {
    const { state, feed, tracker, view } = fixture();
    state.game.gameState = 'calibrating';
    for (let i = 0; i < 240; i++) feed([pose(0.5 + 0.15 * Math.sin(i / 20))]);
    assert.equal(state.game.gameState, 'calibrating');
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    assert.ok(view().progress < 1);
    feed([pose()], 150);
    assert.equal(state.game.gameState, 'playing');
});

test('a prolonged unsuitable pose discards its sample rather than mixing the next baseline', () => {
    const { state, feed, tracker, view } = fixture();
    state.game.gameState = 'calibrating';
    feed([pose()], 30);
    assert.equal(view().phase, 'sampling');
    const invalid = pose(); invalid[11].visibility = 0.1;
    feed([invalid], 20);
    assert.equal(view().phase, 'waiting');
    assert.equal(view().progress, 0);
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    const adjusted = pose(0.52).map(point => ({ ...point, y:point.y + 0.03 }));
    feed([adjusted], 30);
    assert.equal(state.game.gameState, 'calibrating');
    feed([adjusted], 30);
    assert.equal(state.game.gameState, 'playing');
    assert.ok(Math.abs(state.game.players[0].baseline - 0.43) < 1e-9);
    assert.ok(Math.abs(state.game.players[0].homeX - 0.52) < 1e-9);
});

test('new candidates can replace an uncompleted attempt without a sticky identity lock', () => {
    const { state, feed, tracker } = fixture();
    state.game.gameState = 'calibrating';
    feed([pose()], 30);
    feed([], 20);
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    feed([pose(0.55, { size:0.8 })], 150);
    assert.equal(state.game.gameState, 'playing');
    assert.ok(Math.abs(state.game.players[0].homeX - 0.55) < 1e-9);
});

test('missing camera time cannot complete a partial calibration sample', () => {
    const { state, feed, advance, tracker, view } = fixture();
    state.game.gameState = 'calibrating';
    feed([pose()], 30);
    advance(2000);
    feed([pose()]);
    assert.equal(view().phase, 'waiting');
    assert.equal(view().reason, 'steady');
    assert.equal(view().progress, 0);
    assert.equal(tracker.trackingStatuses()[0], 'unregistered');
    feed([pose()], 30);
    assert.equal(state.game.gameState, 'calibrating');
    feed([pose()], 30);
    assert.equal(state.game.gameState, 'playing');
});

test('calibration uses elapsed time consistently at 15, 30 and 60 camera frames per second', () => {
    for (const fps of [15,30,60]) {
        const { state, feed, tracker, view } = fixture(1,fps);
        state.game.gameState = 'calibrating';
        feed([pose()], Math.ceil(fps * 0.4));
        assert.equal(view().phase, 'sampling', `${fps} fps immediate sampling`);
        feed([pose()], Math.ceil(fps * 0.2));
        assert.equal(view().phase, 'sampling', `${fps} fps sampling`);
        assert.equal(tracker.trackingStatuses()[0], 'unregistered');
        feed([pose()], Math.ceil(fps * 0.4));
        assert.equal(state.game.gameState, 'playing', `${fps} fps completion`);
    }
});

test('two players keep separate zones and detector-order-independent samples', () => {
    const { state, feed, tracker, view } = fixture(2);
    state.game.gameState = 'calibrating';
    feed([pose(0.54),pose(0.46)], 150);
    assert.equal(view().reason, 'sides');
    const first = pose(0.75), second = pose(0.25);
    for (let i = 0; i < 30; i++) feed(i % 2 ? [first,second] : [second,first]);
    assert.equal(view().phase, 'sampling');
    feed([first]);
    assert.deepEqual(Array.from(tracker.trackingStatuses()), ['unregistered','unregistered']);
    for (let i = 0; i < 130; i++) feed(i % 2 ? [first,second] : [second,first]);
    assert.equal(state.game.gameState, 'playing');
    assert.ok(Math.abs(state.game.players[0].homeX - 0.75) < 1e-9);
    assert.ok(Math.abs(state.game.players[1].homeX - 0.25) < 1e-9);
});

test('each player becomes ready independently and one brief torso dropout preserves both samples', () => {
    const { state, feed, tracker, view } = fixture(2);
    state.game.gameState = 'calibrating';
    const first = pose(0.7), second = pose(0.3);
    const hidden = pose(0.3); hidden[11].visibility = 0.1;
    feed([first, hidden], 60);
    assert.equal(view().players[0].phase, 'ready');
    assert.equal(view().players[1].progress, 0);
    assert.deepEqual(Array.from(tracker.trackingStatuses()), ['unregistered','unregistered']);
    feed([first, second], 20);
    const before = view().progress;
    const noisy = pose(0.7); noisy[24].presence = 0.1;
    feed([noisy, second]);
    assert.ok(view().progress >= before, 'the other player continues sampling');
    assert.equal(state.game.gameState, 'calibrating', 'an invalid player cannot finalize locks');
    feed([first, second], 30);
    assert.equal(state.game.gameState, 'calibrating', 'fresh final confirmation follows completed samples');
    feed([first, second], 10);
    assert.equal(state.game.gameState, 'playing');
});

test('moving or uncertain hands and smaller separated bodies do not prevent calibration in either mode', () => {
    for (const count of [1,2]) {
        const { state, feed } = fixture(count);
        state.game.gameState = 'calibrating';
        for (let frame = 0; frame < 60 && state.game.gameState === 'calibrating'; frame++) {
            const people = (count === 1 ? [0.5] : [0.85,0.15]).map(x => {
                const p = pose(x, { size:0.55 });
                p[15] = { x:0.5 + Math.sin(frame) * 0.4, y:0.3, visibility:0.1 };
                p[16] = { x:0.5, y:0.5 + Math.cos(frame) * 0.4, presence:0.1 };
                return p;
            });
            feed(people);
        }
        assert.equal(state.game.gameState, 'playing');
        for (const player of state.game.players.slice(0,count)) assert.ok(Math.abs(player.baseline - 0.4) < 1e-9);
    }
});

test('a brief bad frame pauses sampled time without resetting or advancing it in either mode', () => {
    for (const count of [1,2]) {
        const { state, feed, view } = fixture(count);
        state.game.gameState = 'calibrating';
        const good = count === 1 ? [pose()] : [pose(0.7),pose(0.3)];
        feed(good, 30);
        const before = view().players[0].progress;
        const bad = good.map(p => p.map(point => ({ ...point })));
        bad[0][11].visibility = 0.1;
        feed(bad, 10);
        assert.equal(view().players[0].progress, before);
        feed(good);
        assert.equal(view().players[0].progress, before, 'missing time is not credited when a player returns');
        feed(good, 10);
        assert.equal(state.game.gameState, 'calibrating', 'a long wall-clock interval cannot replace valid sampling');
        feed(good, 20);
        assert.equal(state.game.gameState, 'playing');
    }
});

test('a prolonged loss clears only the affected player and completion requires both current poses', () => {
    const { state, feed, view, tracker } = fixture(2);
    state.game.gameState = 'calibrating';
    const first = pose(0.7), second = pose(0.3), hidden = pose(0.3);
    hidden[12].visibility = 0.1;
    feed([first, second], 30);
    feed([first, hidden], 30);
    assert.equal(view().players[0].phase, 'ready');
    assert.equal(view().players[1].progress, 0);
    feed([first], 60);
    assert.equal(state.game.gameState, 'calibrating');
    assert.deepEqual(Array.from(tracker.trackingStatuses()), ['unregistered','unregistered']);
    feed([second, first], 30);
    assert.equal(state.game.gameState, 'calibrating', 'the lost player must collect a new sample');
    feed([second, first], 30);
    assert.equal(state.game.gameState, 'playing');
});

test('a natural lean and small pose jitter are allowed during preparation', () => {
    const { state, feed } = fixture();
    state.game.gameState = 'calibrating';
    for (let i = 0; i < 150; i++) {
        const p = pose();
        p[11].x += 0.05; p[12].x += 0.05;
        p[11].y += 0.015; p[12].y -= 0.015;
        const jitter = Math.sin(i) * 0.002;
        for (const point of p) point.y += jitter;
        feed([p]);
    }
    assert.equal(state.game.gameState, 'playing');
    assert.ok(Math.abs(state.game.players[0].baseline - 0.4) < 0.003);
});

test('bystanders are ignored while all locked players keep their input, including low-confidence extras', () => {
    for (const count of [1, 2]) {
        const { state, app, feed, tracker } = fixture(count);
        state.game.gameState = 'calibrating';
        const original = count === 1 ? [pose()] : [pose(0.75), pose(0.25)];
        feed(original, 150);
        const extra = pose(0.05, { size:0.4 }); extra[11].visibility = 0.01;
        const raised = count === 1 ? [pose(0.5, {left:0.4})] : [pose(0.75, {left:0.4}), pose(0.25, {left:0.4})];
        feed([extra, ...raised], 60);
        assert.equal(app.trackingSafety.isGameplayPaused(), false);
        assert.deepEqual(Array.from(tracker.trackingReport().ignored), [0]);
        for (const player of state.game.players.slice(0,count)) assert.equal(player.lane, -1);
        feed([extra], 1);
        assert.equal(app.trackingSafety.isGameplayPaused(), true, 'the bystander cannot fill a missing player slot');
        feed([extra, ...original], 60);
        assert.equal(app.trackingSafety.isGameplayPaused(), false, 'the bystander may remain during recovery');
    }
});

function changeShoulderWidth(points, factor) {
    const center = (points[11].x + points[12].x) / 2;
    for (const id of [11,12]) points[id].x = center + (points[id].x - center) * factor;
    return points;
}

test('raised-arm shoulder changes do not break continuous tracking or produce repeat lane moves', () => {
    for (const factor of [0.45,0.669,1.6]) {
        const { state, app, tracker, feed } = fixture();
        state.game.gameState = 'calibrating';
        feed([pose()],150);
        const originalWidth = tracker.trackingReport().tracks[0].profile.shoulderWidth;
        const raised = changeShoulderWidth(pose(0.5, {left:0.4}),factor);
        feed([raised],120);
        assert.equal(app.trackingSafety.isGameplayPaused(),false);
        assert.equal(tracker.trackingStatuses()[0],'tracked');
        assert.equal(state.game.players[0].lane,-1,'held arm produces one move');
        assert.equal(tracker.trackingReport().tracks[0].profile.shoulderWidth,originalWidth,'profile stays fixed');
    }
});

test('position continuity outweighs a bystander matching the neutral shoulder profile', () => {
    const { step, tracker } = fixture();
    step([pose()],true);
    for (let i=0;i<60;i++) {
        const player=changeShoulderWidth(pose(0.5, {left:0.4}),0.669);
        const bystander=pose(0.64);
        const candidates=i%2 ? [player,bystander] : [bystander,player];
        assert.equal(step(candidates)[0],player);
        const report=tracker.trackingReport();
        assert.deepEqual(Array.from(report.ignored),[i%2 ? 1 : 0]);
        assert.ok(report.costs[0].every(Number.isFinite),'both candidates pass the position gate');
    }
});

test('nearby ambiguous people still pause before accepting an arm gesture', () => {
    const {state,app,feed}=fixture();
    state.game.gameState='calibrating';
    feed([pose()],150);
    feed([pose(0.5,{left:0.4}),pose(0.52,{left:0.4})],10);
    assert.equal(app.trackingSafety.safetyStatus().reason,'player_uncertain');
    assert.equal(state.game.players[0].lane,0);
});

test('a missing partner and inference errors pause the entire game until fresh healthy frames arrive', () => {
    const {state, app, feed, advance} = fixture(2);
    state.game.gameState = 'calibrating';
    const both = [pose(0.75), pose(0.25)]; feed(both, 150);
    feed([both[0]],1);
    assert.equal(app.trackingSafety.safetyStatus().reason, 'player_lost');
    feed(both,60);
    assert.equal(app.trackingSafety.isGameplayPaused(), false);
    app.camera.readCameraStatus = () => ({trackingError:true});
    app.pose.checkPlayerTracking();
    assert.equal(app.trackingSafety.safetyStatus().reason,'tracking_error');
    app.camera.readCameraStatus = () => ({});
    app.pose.checkPlayerTracking();
    advance(400); app.pose.checkPlayerTracking();
    assert.equal(app.trackingSafety.isGameplayPaused(),true,'watchdog checks cannot replace fresh camera observations');
    feed(both,60);
    assert.equal(app.trackingSafety.isGameplayPaused(),false);
});

test('an extended recovery rejects bystanders and preserves the trusted position until confirmation', () => {
    const { step, tracker, advance } = fixture();
    step([pose()], true);
    const anchor = JSON.stringify(tracker.trackingReport().tracks[0].center);
    advance(10000);
    for (let i = 0; i < 100; i++) {
        assert.equal(step([pose(0.9),pose(0.5,{size:0.5})])[0], null);
    }
    for (let i = 0; i < 40; i++) assert.equal(step([pose(0.53)])[0], null);
    assert.equal(JSON.stringify(tracker.trackingReport().tracks[0].center), anchor);
    let result;
    for (let i = 0; i < 30; i++) result = step([pose(0.53)]);
    assert.ok(result[0]);
});

test('ambiguity and interrupted or moving recovery candidates restart extended confirmation', () => {
    const { step, tracker } = fixture();
    step([pose()], true);
    step([pose(),pose(0.52)]);
    for (let i = 0; i < 35; i++) assert.equal(step([pose()])[0],null);
    step([]);
    for (let i = 0; i < 35; i++) assert.equal(step([pose()])[0],null);
    step([pose(),pose(0.52)]);
    for (let i = 0; i < 35; i++) assert.equal(step([pose()])[0],null);
    step([pose(0.55)]); // More than 0.06 camera-height units from the recovery anchor.
    assert.ok(tracker.trackingReport().tracks[0].recovery.elapsedMs < 20);
    for (let i = 0; i < 35; i++) assert.equal(step([pose(0.55)])[0],null);
    let result;
    for (let i = 0; i < 30; i++) result=step([pose(0.55)]);
    assert.ok(result[0]);
});

test('watchdog calls and repeated timestamps cannot complete a recovery', () => {
    const { step, tracker, advance } = fixture();
    step([pose()],true);
    advance(5000);
    step([pose()]);
    for (let i=0;i<100;i++) { step([pose()],false,0); tracker.trackingStatuses(); }
    assert.equal(tracker.trackingReport().tracks[0].recovery.samples,1);
    advance(1500);
    for (let i=0;i<10;i++) tracker.trackingStatuses();
    assert.equal(tracker.trackingStatuses()[0],'checking');
    assert.equal(step([pose()])[0],null,'stale confirmation starts again');
});

for (const recording of require('./fixtures/tracking-recovery.json')) {
    test(`human-log matching geometry recovers after ${recording.case}`, () => {
        const {step,tracker}=fixture();
        const geometry = (cx,cy,sw,hw,torso) => {
            const points=pose();
            points[11]={x:(cx+sw/2)/recording.aspect,y:cy-torso};
            points[12]={x:(cx-sw/2)/recording.aspect,y:cy-torso};
            points[23]={x:(cx+hw/2)/recording.aspect,y:cy};
            points[24]={x:(cx-hw/2)/recording.aspect,y:cy};
            return points;
        };
        const p=recording.profile,c=recording.center;
        step([geometry(c.x,c.y,p.shoulderWidth,p.hipWidth,p.torso)],true,0);
        const profile=JSON.stringify(tracker.trackingReport().tracks[0].profile);
        let previous=0,sawPause=false,recovered=false;
        for(const frame of recording.frames) {
            const matched=step(frame.candidates.map(([, ...values])=>geometry(...values)),false,frame.ms-previous);
            previous=frame.ms;
            if(!matched[0]) sawPause=true;
            if(sawPause && matched[0]) recovered=true;
            if(matched[0]) {
                const center=(matched[0][23].x+matched[0][24].x)/2*recording.aspect;
                assert.ok(Math.abs(center-c.x)<0.12,'the distant bystander never fills the slot');
            }
        }
        assert.equal(sawPause,true);
        assert.equal(recovered,true);
        assert.equal(tracker.trackingStatuses()[0],'tracked');
        assert.equal(JSON.stringify(tracker.trackingReport().tracks[0].profile),profile);
    });
}

test('calibration ignores separate bystanders in both modes at 15, 30 and 60 camera fps', () => {
    for (const count of [1, 2]) for (const fps of [15, 30, 60]) {
        const f = fixture(count, fps);
        f.state.game.gameState = 'calibrating';
        const players = count === 1 ? [pose(0.5)] : [pose(0.75), pose(0.25)];
        const extras = count === 1 ? [pose(0.04, { size:0.3 }), pose(0.96, { size:0.3 })]
            : [pose(0.02, { size:0.3 }), pose(0.98, { size:0.3 })];
        for (let i = 0; i < fps * 1.2; i++) {
            const people = [...players, ...extras];
            f.feed(i % 2 ? people.reverse() : people);
        }
        assert.equal(f.state.game.gameState, 'playing', `${count} players at ${fps} fps`);
        for (let i = 0; i < count; i++) {
            assert.ok(Math.abs(f.state.game.players[i].baseline - 0.4) < 1e-9);
            assert.ok(Math.abs(f.state.game.players[i].homeX - (count === 1 ? 0.5 : i === 0 ? 0.75 : 0.25)) < 1e-9);
        }
    }
});

test('calibration does not choose the first or largest of competing initial candidates', () => {
    const f = fixture();
    f.state.game.gameState = 'calibrating';
    const a = pose(0.3, { size:0.6 }), b = pose(0.7);
    for (let i = 0; i < 100; i++) f.feed(i % 2 ? [a,b] : [b,a]);
    assert.equal(f.view().reason, 'uncertain');
    assert.equal(f.view().progress, 0);
    assert.equal(f.tracker.trackingStatuses()[0], 'unregistered');
    f.feed([b], 60);
    assert.equal(f.state.game.gameState, 'playing');
});

test('a selected calibration candidate survives reordered detections and a distant same-zone bystander', () => {
    const f = fixture();
    f.state.game.gameState = 'calibrating';
    const player = pose(0.3, { size:0.7 }), bystander = pose(0.75, { size:0.6 });
    f.feed([player], 20);
    const before = f.view().progress;
    f.feed([bystander, player], 10);
    assert.ok(f.view().progress > before);
    assert.equal(f.app.calibration.calibrationView().players[0].index, 1);
    f.feed([player, bystander], 30);
    assert.equal(f.state.game.gameState, 'playing');
    assert.ok(Math.abs(f.state.game.players[0].homeX - 0.3) < 1e-9);
});

test('overlap pauses only the affected calibration sample, even across a zone boundary', () => {
    const f = fixture(2);
    f.state.game.gameState = 'calibrating';
    const first = pose(0.82), second = pose(0.25), extra = pose(0.93, { size:0.6 });
    f.feed([first, second], 25);
    const before = f.view().players[0].progress;
    f.feed([extra, second, first], 5);
    assert.equal(f.view().players[0].reason, 'uncertain');
    assert.equal(f.view().players[0].progress, before);
    assert.ok(f.view().players[1].progress > before);
    f.feed([extra, first, second], 20);
    assert.equal(f.view().players[0].progress, 0);
    assert.equal(f.view().players[1].phase, 'ready');
    assert.equal(f.state.game.gameState, 'calibrating');
    f.feed([second, first], 60);
    assert.equal(f.state.game.gameState, 'playing');
});

test('a replacement candidate restarts sampling and cannot inherit another torso baseline', () => {
    const f = fixture();
    f.state.game.gameState = 'calibrating';
    const first = pose(0.3, { size:0.6 });
    const second = pose(0.7).map(point => ({ ...point, y:point.y - 0.03 }));
    f.feed([first], 35);
    f.feed([second], 10);
    assert.equal(f.view().players[0].reason, 'steady');
    assert.equal(f.state.game.gameState, 'calibrating');
    f.feed([second], 15);
    assert.ok(f.view().progress < 0.3, 'replacement starts a new full sample after grace');
    f.feed([second], 50);
    assert.equal(f.state.game.gameState, 'playing');
    assert.ok(Math.abs(f.state.game.players[0].baseline - 0.37) < 1e-9);
    assert.ok(Math.abs(f.state.game.players[0].homeX - 0.7) < 1e-9);
});

test('calibration highlights expire on stale camera observations and reset on re-entry', () => {
    const f = fixture();
    f.state.game.gameState = 'calibrating';
    f.feed([pose()], 20);
    assert.ok(f.app.calibration.calibrationView().players[0].bounds);
    f.advance(301);
    assert.equal(f.app.calibration.calibrationView().players.length, 0);
    f.feed([pose()]);
    assert.equal(f.view().progress, 0);
    f.feed([pose()]);
    f.app.pose.beginCalibration();
    assert.equal(f.app.calibration.calibrationView().players.length, 0);
    assert.equal(f.tracker.trackingStatuses()[0], 'unregistered');
});

test('modest torso confidence and sway with offscreen hands calibrate at 15, 30 and 60 fps in both modes', () => {
    for (const count of [1,2]) for (const fps of [15,30,60]) {
        const f = fixture(count,fps);
        f.state.game.gameState = 'calibrating';
        let people;
        for (let frame = 0; frame < Math.ceil(fps * 1.2); frame++) {
            people = (count === 1 ? [0.5] : [0.75,0.25]).map(x => {
                const p = pose(x + (frame % 2 ? 0.05 : 0));
                for (const id of [11,12,23,24]) p[id].visibility = p[id].presence = 0.55;
                p[15] = { x:-0.2,y:1.2,visibility:0.1,presence:0.1 };
                p[16] = { x:1.2,y:1.2,visibility:0.1,presence:0.1 };
                return p;
            });
            f.feed(people);
        }
        assert.equal(f.state.game.gameState,'playing',`${count} players at ${fps} fps`);
        assert.deepEqual(Array.from(f.tracker.trackingStatuses()),Array(count).fill('tracked'));
        const matched = f.step(people);
        for (let i = 0; i < count; i++) {
            assert.equal(matched[i],people[i],'enrollment and gameplay accept the same torso confidence');
            assert.ok(Math.abs(f.state.game.players[i].baseline - 0.4) < 1e-9);
        }
    }
});

test('torso confidence below the relaxed threshold still blocks calibration, enrollment and matching', () => {
    for (const id of [11,12,23,24]) for (const key of ['visibility','presence']) {
        const f = fixture();
        f.state.game.gameState = 'calibrating';
        const bad = pose(); bad[id][key] = 0.549;
        f.feed([bad],70);
        assert.equal(f.state.game.gameState,'calibrating');
        assert.equal(f.view().progress,0);
        assert.equal(f.tracker.lockPlayers([bad]),false);
        assert.equal(f.tracker.lockPlayers([pose()]),true);
        assert.equal(f.step([bad])[0],null);
    }
});

test('movement beyond the relaxed sway limit pauses calibration and prolonged movement clears its sample', () => {
    const f = fixture();
    f.state.game.gameState = 'calibrating';
    f.feed([pose()],20);
    const before = f.view().progress;
    f.feed([pose(0.57)],5);
    assert.equal(f.view().reason,'steady');
    assert.equal(f.view().progress,before);
    f.feed([pose(0.57)],14);
    assert.equal(f.view().progress,0);
    assert.equal(f.state.game.gameState,'calibrating');
    assert.equal(f.tracker.trackingStatuses()[0],'unregistered');
    f.feed([pose(0.57)],5);
    assert.ok(f.view().progress > 0 && f.view().progress < before,'a settled new position starts a fresh sample');
});
