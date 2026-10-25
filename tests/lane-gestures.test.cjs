const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');

function fixture(width = 640, height = 480, fps = 60) {
    let now = 0;
    const frameMs = 1000 / fps;
    const source = ['src/core/state.js', 'src/input/arm-postures.js', 'src/input/lane-gestures.js', 'src/input/player-tracking.js', 'src/game/tracking-safety.js', 'src/input/pose.js']
        .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    const factories = vm.runInNewContext(source + '\n({ createState, createArmPostures, createLaneGestures, createPlayerTracking, createTrackingSafety, createPose });', {
        window: { innerWidth: 1280, innerHeight: 800 }, performance: { now: () => now }
    });
    const state = factories.createState();
    state.game.gameState = 'playing';
    for (const player of state.game.players) player.baseline = 0.4;
    const sounds = [];
    const app = {
        energy: { recordEnergyAction() {}, suspendEnergy() {} },
        finishPhoto: { resetFinishPhoto() {}, observeFinishPlayers() {} },
        debug: { enabled: false, record() {}, sample() {}, transition() {}, setDebugStatus() {} },
        camera: { readCameraStatus() { return {}; }, videoElement: { videoWidth: width, videoHeight: height } },
        hud: { updateHUD() {} }, audio: { bgMusic: { pause() {}, play() { return Promise.resolve(); } }, playSynth(type) { sounds.push(type); } },
        trackingStatus: { refreshTrackingStatus() {} }
    };
    app.armPostures = factories.createArmPostures({ state, app });
    app.laneGestures = factories.createLaneGestures({ app });
    app.playerTracking = factories.createPlayerTracking({ state, app });
    app.trackingSafety = factories.createTrackingSafety({ state, app });
    app.pose = factories.createPose({ state, app });
    app.playerTracking.lockPlayers([pose()]);

    // Shoulder-to-wrist vectors in camera pixels, then normalized like MediaPipe.
    function pose(leftAngle = -80, rightAngle = -80) {
        const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, visibility: 1, presence: 1 }));
        points[11] = { x: 0.6, y: 0.4, visibility: 1, presence: 1 };
        points[12] = { x: 0.4, y: 0.4, visibility: 1, presence: 1 };
        points[23] = { x: 0.57, y: 0.7, visibility: 1, presence: 1 };
        points[24] = { x: 0.43, y: 0.7, visibility: 1, presence: 1 };
        for (const [shoulder, wrist, angle, direction] of [[11, 15, leftAngle, 1], [12, 16, rightAngle, -1]]) {
            const radians = angle * Math.PI / 180;
            points[wrist] = { x: points[shoulder].x + direction * Math.cos(radians) * 140 / width,
                y: points[shoulder].y - Math.sin(radians) * 140 / height, visibility: 1, presence: 1 };
            const elbow = wrist === 15 ? 13 : 14;
            points[elbow] = { x:(points[shoulder].x + points[wrist].x)/2,
                y:(points[shoulder].y + points[wrist].y)/2, visibility:1, presence:1 };
        }
        return points;
    }

    const player = state.game.players[0];
    function sample(points, frames = 1, target = player) {
        for (let i = 0; i < frames; i++) {
            now += frameMs;
            app.pose.handlePlayerMovement(target, points);
        }
    }
    function move(left, right = -80, frames = 1, target = player) {
        sample(pose(left, right), frames, target);
    }
    function track(points) {
        now += frameMs;
        app.pose.onPoseResults({ landmarks: points });
    }
    return { state, app, player, sounds, pose, move, sample, track, advance: ms => { now += ms; } };
}

test('holding either arm up changes exactly one lane, regardless of frame count', () => {
    for (const frames of [10, 30, 300]) {
        const left = fixture();
        left.player.lane = 1;
        left.move(0, -80, frames);
        assert.equal(left.player.lane, 0);
        assert.deepEqual(left.sounds, ['lane']);

        const right = fixture();
        right.player.lane = -1;
        right.move(-80, 0, frames);
        assert.equal(right.player.lane, 0);
        assert.deepEqual(right.sounds, ['lane']);
    }
});

test('less than 15 degrees of lowering cannot rearm another lane move', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(0, -80, 10);
    for (let i = 0; i < 50; i++) { move(-14.99); move(0); }
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, ['lane']);
});

test('an exact 15-degree drop followed by a 15-degree raise permits one fresh move', () => {
    for (const side of ['left', 'right']) {
        const { player, move, sounds } = fixture();
        player.lane = side === 'left' ? 1 : -1;
        const gesture = (angle, frames = 10) => side === 'left' ? move(angle, -80, frames) : move(-80, angle, frames);
        gesture(0);
        gesture(-15, 20);
        assert.equal(player.lane, 0, 'lowering never changes lane');
        gesture(0);
        assert.equal(player.lane, side === 'left' ? -1 : 1);
        gesture(0);
        assert.equal(sounds.filter(type => type === 'lane').length, 2);
    }
});

test('continuing downward or holding the lowered pose never counts as a new raise', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(0, -80, 10);
    for (const angle of [-15, -20, -25, -30]) move(angle, -80, 30);
    move(-20);
    assert.equal(player.lane, 0, 'a small upward jitter is insufficient');
    move(-15, -80, 10);
    assert.equal(player.lane, -1);
    assert.deepEqual(sounds, ['lane', 'lane']);
});

test('lowering is measured from the highest position reached during the raise', () => {
    const { player, move } = fixture();
    player.lane = 1;
    move(0, -80, 10); move(40, -80, 10); move(26, -80, 20); move(40, -80, 10);
    assert.equal(player.lane, 0);
    move(25, -80, 20); move(40, -80, 10);
    assert.equal(player.lane, -1);
});

test('15-degree gating uses the camera aspect ratio and is independent of viewport size', () => {
    for (const [width, height] of [[640, 480], [1280, 720]]) {
        const { player, state, move } = fixture(width, height);
        player.lane = 1;
        move(0, -80, 10); move(-14.9, -80, 20); move(0, -80, 10);
        assert.equal(player.lane, 0);
        state.viewport.gameWidth = 300;
        state.viewport.gameHeight = 1200;
        move(-15, -80, 20); move(0, -80, 10);
        assert.equal(player.lane, -1);
    }
});

test('each player and arm has its own gesture cycle', () => {
    const { player, state, move } = fixture();
    const other = state.game.players[1];
    player.lane = 1; other.lane = 1;
    move(0, -80, 10);
    move(0, -80, 100, other);
    assert.equal(player.lane, 0);
    assert.equal(other.lane, 0);
    move(-15, -80, 20); move(0, -80, 10);
    assert.equal(player.lane, -1);
    assert.equal(other.lane, 0);
    move(-80, -80, 20); move(-80, 0, 10);
    assert.equal(player.lane, 0, 'the opposite arm can perform its own raise');
});

test('jump, duck, and rest poses do not turn into lane moves when one arm stays up', () => {
    for (const action of ['jump', 'duck', 'rest']) {
        const { player, pose, move, sample, sounds } = fixture();
        if (action === 'jump') move(60, 60, 30);
        else if (action === 'duck') move(0, 0, 30);
        else {
            const crossed = pose(0, 0);
            crossed[15].x = 0.4; crossed[16].x = 0.6;
            sample(crossed, 30);
        }
        move(action === 'jump' ? 60 : 0, -80, 100);
        assert.equal(player.lane, 0, action);
        assert.equal(sounds.filter(type => type === 'lane').length, 0, action);
        move(-80, -80, 30);
        move(0, -80, 10);
        assert.equal(player.lane, -1, action);
    }
});

test('fresh lane raises work promptly after fly, level-arm duck or crouching at different camera rates', () => {
    for (const fps of [15,20,30,60]) {
        for (const action of ['fly','arms-duck','crouch']) {
            for (const side of ['left','right']) {
                const {player,pose,move,sample,sounds}=fixture(640,480,fps);
                const frames=ms=>Math.ceil(fps*ms/1000)+2;
                if(action==='fly') {
                    move(60,60,frames(300));
                    move(0,0,1); // Leaving fly can briefly pass through the duck pose.
                } else if(action==='arms-duck') move(0,0,frames(300));
                else sample(pose().map(point=>({...point,y:point.y+0.12})),frames(300));
                move(-80,-80,frames(200));
                assert.equal(player.lane,0,`${fps} fps ${action}: lowering does not move`);
                const raise=()=>side==='left' ? move(0,-80,frames(100)) : move(-80,0,frames(100));
                raise();
                assert.equal(player.lane,side==='left' ? -1 : 1,`${fps} fps ${action}: first fresh raise works`);
                raise();
                assert.equal(sounds.filter(sound=>sound==='lane').length,1,'holding does not repeat');
            }
        }
    }
});

test('a 15-degree release confirmed during fly or duck permits a fresh raise as that action ends', () => {
    for (const fps of [15,20,30,60]) {
        for (const action of ['fly','duck']) {
            for (const side of ['left','right']) {
                const {player,move,sounds}=fixture(640,480,fps);
                const frames=ms=>Math.ceil(fps*ms/1000)+2;
                const peak=action==='fly' ? 60 : 0;
                move(peak,peak,frames(250));
                if(side==='left') move(peak-15,peak,frames(200));
                else move(peak,peak-15,frames(200));
                assert.equal(player.lane,0,'active fly/duck blocks lane movement');
                if(side==='left') move(peak,-80,frames(100));
                else move(-80,peak,frames(100));
                assert.equal(player.lane,side==='left' ? -1 : 1,`${fps} fps ${action}: confirmed fresh cycle is usable immediately`);
                assert.equal(sounds.filter(sound=>sound==='lane').length,1);
            }
        }
    }
});

test('temporary pose loss does not rearm a held gesture', () => {
    const { player, pose, track } = fixture();
    player.lane = 1;
    for (let i = 0; i < 10; i++) track([pose(0)]);
    for (let i = 0; i < 100; i++) track([]);
    for (let i = 0; i < 100; i++) track([pose(0)]);
    assert.equal(player.lane, 0);
});

test('lane boundaries consume the gesture without an extra movement sound', () => {
    const { player, move, sounds } = fixture();
    player.lane = -1;
    move(0, -80, 100);
    assert.equal(player.lane, -1);
    assert.deepEqual(sounds, []);
});

test('the reproduced 20° → 4° → 20° spike does not cause a second lane change', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    assert.equal(player.lane, 0);
    move(4);
    move(20, -80, 30);
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, ['lane']);
});

test('brief multi-frame dips and repeated jitter cannot rearm a held arm', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    for (let i = 0; i < 30; i++) {
        move(0, -80, 3);
        move(20, -80, 3);
    }
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, ['lane']);
});

test('a release shorter than 150ms is rejected, while a stable release permits a new raise', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    move(0, -80, 8);
    move(20, -80, 10);
    assert.equal(player.lane, 0);
    move(0, -80, 20);
    move(20, -80, 10);
    assert.equal(player.lane, -1);
    assert.deepEqual(sounds, ['lane', 'lane']);
});

test('one bad upward sample cannot become a false peak or trigger a pending raise', () => {
    const { player, move, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    move(60);
    move(20, -80, 30);
    move(35, -80, 10);
    assert.equal(player.lane, 0, 'an isolated 60° reading never becomes the release reference');
    move(0, -80, 20);
    for (let i = 0; i < 10; i++) { move(20, -80, 2); move(0, -80, 3); }
    assert.equal(player.lane, 0, 'a brief upward wobble after release does not count as a raise');
    move(20, -80, 10);
    assert.equal(player.lane, -1);
    assert.deepEqual(sounds, ['lane', 'lane']);
});

test('a brief initial raised reading is rejected without slowing down a deliberate raise', () => {
    const { player, move, sounds } = fixture();
    move(-80, -80, 10);
    move(20, -80, 2);
    move(-80, -80, 10);
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, []);
    move(20, -80, 10);
    assert.equal(player.lane, -1);
});

test('low visibility or presence cannot start a move or confirm a release', () => {
    for (const [landmark, field] of [[15, 'visibility'], [11, 'visibility'], [16, 'presence'], [12, 'presence']]) {
        const { player, pose, sample, move, sounds } = fixture();
        player.lane = 1;
        const untrusted = pose(20);
        untrusted[landmark][field] = 0.1;
        sample(untrusted, 30);
        assert.equal(player.lane, 1, `${landmark}.${field}`);
        move(20, -80, 10);
        assert.equal(player.lane, 0);
        const badRelease = pose(0);
        badRelease[landmark][field] = 0.1;
        sample(badRelease, 30);
        move(20, -80, 10);
        assert.equal(player.lane, 0);
        assert.deepEqual(sounds, ['lane']);
    }
});

test('tracking gaps cancel partial release evidence instead of counting missing time as a hold', () => {
    const { player, move, advance, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    move(0, -80, 5);
    advance(1000);
    move(0);
    move(20, -80, 10);
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, ['lane']);
});

test('pose loss cancels a confirmed release so reacquiring a raised arm cannot replay it', () => {
    const { player, move, track, pose, sounds } = fixture();
    player.lane = 1;
    move(20, -80, 10);
    move(0, -80, 20);
    track([]);
    for (let i = 0; i < 20; i++) track([pose(20)]);
    assert.equal(player.lane, 0);
    assert.deepEqual(sounds, ['lane']);
    move(0, -80, 20);
    move(20, -80, 10);
    assert.equal(player.lane, -1);
});

test('stable release and raise cycles work at different camera frame rates', () => {
    for (const fps of [15, 30, 60]) {
        const { player, move, sounds } = fixture(640, 480, fps);
        const frames = Math.ceil(fps * 0.3);
        player.lane = 1;
        move(20, -80, frames);
        assert.equal(player.lane, 0, `${fps} fps first raise`);
        move(0, -80, frames);
        move(20, -80, frames);
        assert.equal(player.lane, -1, `${fps} fps second raise`);
        assert.deepEqual(sounds, ['lane', 'lane']);
    }
});

test('chest-height hands stay neutral while both crouching and level arms can duck',()=>{
    const {player,pose,sample,move,sounds}=fixture();
    const chest=pose();
    chest[15]={x:0.54,y:0.48};chest[16]={x:0.46,y:0.48};
    chest[13]={x:0.65,y:0.55};chest[14]={x:0.35,y:0.55};
    sample(chest,30);
    assert.equal(player.isSquatting,false);assert.equal(player.isResting,false);
    const folded=pose(0,0);folded[13].y+=0.15;folded[14].y+=0.15;
    sample(folded,30);
    assert.equal(player.isSquatting,false);
    sample(pose().map(point=>({...point,y:point.y+0.12})),30);
    assert.equal(player.isSquatting,true,'crouching remains a separate duck trigger');
    assert.equal(player.stats.squats,1);assert.equal(player.lane,0);
    sample(chest,30);assert.equal(player.isSquatting,false);
    move(0,0,30);
    assert.equal(player.isSquatting,true);assert.equal(player.stats.squats,2);
    move(0,0,30);assert.equal(player.stats.squats,2,'holding level arms counts once');
    sample(chest,30);assert.equal(player.isSquatting,false);
    move(60,60,30);assert.equal(player.isJumping,true);assert.equal(player.isSquatting,false);
    assert.equal(sounds.filter(sound=>sound==='lane').length,0);
});
