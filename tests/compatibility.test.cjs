const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const os = require('node:os');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.cjs');
const { build, root } = require('../scripts/build.cjs');
const { assetPaths } = require('../scripts/assets.cjs');

// The relocation changes URLs only. Keep the original behavior baseline intact.
function canonicalizeMedia(value) {
    if (typeof value === 'string' && value.includes('assets/')) {
        for (const [old, current] of Object.entries(assetPaths)) {
            value = value.replaceAll(`../${current}`, old).replaceAll(current, old);
        }
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalizeMedia);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalizeMedia(item)]));
    }
    return value;
}

// Compare against the actual pre-refactor source, never a recreated specification.
const baselineRef = '6778c34';
const original = execFileSync('git', ['show', `${baselineRef}:index.html`], { cwd: root, encoding: 'utf8' });
const oldScripts = [...original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
const groups = {
    session: ['currentPlayerName', 'currentPlayer2Name', 'isCameraInitialized', 'numPlayers'],
    game: ['orbNotifyTimer', 'gameState', 'score', 'speed', 'frameCount', 'obstacles', 'gameLoopId',
        'speedMultiplier', 'levelUpTimer', 'nextMilestone', 'blockRestTimer', 'skyEffectsEnabled',
        'skyStarBase', 'skyParticles', 'skyStyle', 'orbs', 'streakBonusGranted', 'players', 'nextShieldScore', 'nextHeartScore'],
    viewport: ['gameWidth', 'gameHeight']
};
const functions = [...oldScripts[3][1].matchAll(/^(?:async )?function (\w+)\(/gm)].map(match => match[1]);

// These widgets/storage policies intentionally changed at the user's request.
// Dedicated tests below assert their new behavior; other gameplay still uses the
// untouched original baseline, including movement, scoring, collisions and pixels.
const currentHtml = fs.readFileSync(path.join(root,'index.html'),'utf8');
const hudSection = html => html.match(/<!-- 1 PLAYER HUD -->[\s\S]*?(?=<!-- Login \()/)?.[0] || '';
const changedHudIds = [...new Set([original,currentHtml].flatMap(html => [...hudSection(html).matchAll(/\bid="([^"]+)"/g)].map(match=>match[1])))];
const changedWidgets = new Set([...changedHudIds, 'final-p1-energy', 'final-p2-energy', 'final-p1-energy-col', 'final-p2-energy-col', 'debug-panel', 'debug-camera', 'debug-summary', 'debug-status', 'debug-save-status',
    'game-over-layout', 'finish-photo-single', 'finish-photo-single-canvas', 'finish-photo-dialog', 'finish-photo-title', 'finish-photo-close', 'finish-photo-dual-canvas',
    'debug-finish', 'debug-mark', 'debug-note', 'debug-download', 'leaderboard-body', 'gameover-leaderboard-body', 'streak-big-msg',
    'player-tracking-notice', 'player-tracking-message', 'btn-recalibrate-players',
    'calibration-camera-preview', 'cam-calibration', 'calibration-camera-status',
    // Gameplay label positions now follow HUD geometry rather than fixed offsets.
    // Dedicated tests assert their content/lifetime and placement below the HUD.
    'orb-notify', 'orb-notify-text',
    'dot-2ago', 'dot-yesterday', 'dot-today', ...[1, 2, 3].flatMap(day => [`streak-day-${day}`, `streak-day-label-${day}`])]);
const changedStorage = new Set(['leaderboard_data_version', 'streak_data_version',
    'game_leaderboard_normal', 'game_leaderboard_chill']);

function bridge(legacy) {
    const read = legacy ? `{${Object.entries(groups).map(([group, names]) => `${group}: {${names.join(',')}}`).join(',')}}` : 'state';
    const calls = legacy ? `{${functions.join(',')}}` : 'Object.assign({}, ...Object.values(app))';
    const assignments = Object.entries(groups).flatMap(([group, names]) => names.map(name =>
        `case '${name}': ${legacy ? name : `state.${group}.${name}`} = value; break;`)).join('\n');
    return `\nwindow.__gameTest = {
        read() { return JSON.parse(JSON.stringify(${read})); },
        energyTotals() { return ${legacy ? '[]' : 'state.game.players.slice(0,state.session.numPlayers).map(player=>app.energy.readEnergy(player))'}; },
        has(name) { return typeof (${calls})[name] === 'function'; },
        call(name, ...args) {
            if (name === 'onPoseResults') window.__advancePoseTime(1000 / 60);
            return (${calls})[name](...args);
        },
        patch(values) { for (const [key, value] of Object.entries(values)) { switch (key) { ${assignments} default: throw Error(key); } } }
    };
    window.__checkpoints = [];
    window.__record = label => window.__checkpoints.push({
        label, state: window.__gameTest.read(),
        elements: [...document.querySelectorAll('[id]')].map(el => [el.id, el.className, el.style.cssText,
            el.children.length ? null : el.textContent]),
        canvases: [...document.querySelectorAll('canvas')].map(c => [c.id, c.toDataURL()])
    });\n`;
}

function replaceVisionImports(source) {
    return source.replace(/import\("https:\/\/[^"\n]+"\)/g, 'window.__loadVision()');
}

const legacyHtml = original.replace(oldScripts[3][0], `<script>${replaceVisionImports(oldScripts[3][1])}${bridge(true)}</script>`);
const bundle = replaceVisionImports(build()).replace(/\}\)\(\);\n$/, `${bridge(false)}})();\n`);
let browser, server, origin, debugDirectory;

before(async () => {
    debugDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-runner-debug-test-'));
    server = createServer((req, res) => {
        // Only the legacy test page uses old URLs; production serves the new paths.
        const legacyPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
        if (assetPaths[legacyPath]) req.url = '/' + assetPaths[legacyPath];
        const body = req.url === '/legacy.html' ? legacyHtml : req.url === '/dist/game.js' ? bundle : null;
        if (body === null) return false;
        res.writeHead(200, { 'Content-Type': req.url.endsWith('.js') ? 'text/javascript' : 'text/html' });
        res.end(body); return true;
    }, { debugDirectory });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
        // Avoid GPU readback rounding differences between fresh browser contexts.
        args: ['--disable-accelerated-2d-canvas']
    });
});

after(async () => {
    await browser?.close();
    fs.rmSync(debugDirectory, { recursive: true, force: true });
    if (server) await new Promise(resolve => server.close(resolve));
});

async function prepare(legacy, options = {}) {
    const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 800 }, timezoneId: 'Pacific/Auckland' });
    // External services are deterministic test doubles. Their real implementations are unchanged.
    await context.route('https://**/*', route => route.request().url().startsWith('https://cdn.tailwindcss.com')
        ? route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' }) : route.abort());
    await context.addInitScript(({ stored }) => {
        let seed = 123456789;
        Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
        const RealDate = Date;
        let poseTime = 0;
        window.__advancePoseTime = milliseconds => { poseTime += milliseconds; };
        Object.defineProperty(performance, 'now', { value: () => poseTime });
        let currentDate = '2026-10-24T00:00:00.000Z';
        window.__setNow = value => { currentDate = value; };
        window.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [currentDate])); }
            static now() { return new RealDate(currentDate).getTime(); }
        };
        let next = 1;
        const frames = new Map(), timers = new Map();
        const nativeFrame = window.requestAnimationFrame.bind(window);
        window.__settleResize = () => new Promise(resolve => nativeFrame(() => nativeFrame(resolve)));
        window.requestAnimationFrame = callback => { const id = next++; frames.set(id, callback); return id; };
        window.cancelAnimationFrame = id => frames.delete(id);
        window.setTimeout = (callback, delay) => { const id = next++; timers.set(id, { callback, delay }); return id; };
        window.clearTimeout = id => timers.delete(id);
        window.__advanceFrames = count => {
            for (let n = 0; n < count; n++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(n * 1000 / 60)); }
        };
        window.__pendingFrameCount = () => frames.size;
        window.__flushTimers = () => { const pending = [...timers.values()].sort((a, b) => a.delay - b.delay); timers.clear(); pending.forEach(timer => timer.callback()); };
        window.__effects = [];
        window.alert = message => window.__effects.push(['alert', message]);
        const playing = new WeakSet();
        const nativeMediaPlay = HTMLMediaElement.prototype.play;
        const nativeMediaPause = HTMLMediaElement.prototype.pause;
        const nativePaused = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused').get;
        HTMLMediaElement.prototype.play = function () {
            playing.add(this);
            return window.__realCameraPlayback && this.id === 'webcam-video' ? nativeMediaPlay.call(this) : Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function () {
            playing.delete(this);
            if (window.__realCameraPlayback && this.id === 'webcam-video') nativeMediaPause.call(this);
        };
        HTMLMediaElement.prototype.load = function () {};
        Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() {
            return window.__realCameraPlayback && this.id === 'webcam-video' ? nativePaused.call(this) : !playing.has(this);
        } });
        window.AudioContext = class {
            state = 'running'; currentTime = 0; destination = {};
            resume() { return Promise.resolve(); }
            createOscillator() {
                const log = window.__effects;
                return { frequency: { setValueAtTime: (...args) => log.push(['frequency', ...args]), linearRampToValueAtTime: (...args) => log.push(['ramp', ...args]) },
                    connect() { return { connect() {} }; }, start() {}, stop() {}, disconnect() {} };
            }
            createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} }; }
        };
        window.__visionFailure = false;
        window.__cameraFailure = false;
        window.__loadVision = async () => {
            if (window.__visionFailure) throw Error('Test AI unavailable');
            return {
                FilesetResolver: { forVisionTasks: async url => { window.__effects.push(['vision-files', url]); return {}; } },
                PoseLandmarker: { createFromOptions: async (_, options) => {
                    window.__effects.push(['vision-options', options]);
                    return { detectForVideo: () => {
                        if (window.__visionDetectFailure) throw Error('Test body tracker unavailable');
                        return { landmarks: [] };
                    } };
                } }
            };
        };
        navigator.mediaDevices.getUserMedia = async options => {
            window.__effects.push(['camera', options]);
            if (window.__cameraFailure) throw Error('Test camera denied');
            return new MediaStream();
        };
        if (!sessionStorage.getItem('__test_storage_seeded')) {
            for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
            sessionStorage.setItem('__test_storage_seeded', 'true');
        }
    }, { stored: options.stored || {} });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/${legacy ? 'legacy.html' : 'index.html'}${options.debug ? '?debug=1' : ''}`, { waitUntil: 'load' });
    assert.deepEqual(errors, [], 'No errors on page load');
    return { context, page, errors };
}

async function snapshot(page) {
    const result = await page.evaluate(() => {
        // Wall-clock CSS animation progress is unrelated to game-frame timing.
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 0; }
        const ids = [...document.querySelectorAll('[id]')].map(element => ({
            id: element.id, attrs: [...element.attributes].map(a => [a.name, a.value]),
            text: element.children.length ? null : element.textContent,
            value: 'value' in element ? element.value : null,
            rect: (() => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()
        }));
        return {
            state: window.__gameTest.read(), ids, htmlClass: document.documentElement.className,
            storage: Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])),
            effects: window.__effects,
            checkpoints: window.__checkpoints,
            canvases: [...document.querySelectorAll('canvas')].map(c => [c.id, c.toDataURL()])
        };
    });
    for (const frame of [result, ...result.checkpoints]) {
        // Requested calibration copy now has a minimum readable duration and
        // localized preparation. Preserve widget attributes and other geometry.
        const guidanceIds=['txt-stand-still','txt-learning'];
        for(const element of frame.ids||[]) if(guidanceIds.includes(element.id)) delete element.text;
        for(const element of frame.elements||[]) if(guidanceIds.includes(element[0])) element[3]=null;
        // The requested post-action fix retires only the old pose-frame cooldown.
        // Dedicated transition tests cover the new immediate fresh-cycle behavior.
        for (const player of frame.state.game.players) delete player.actionCooldown;
        frame.canvases = frame.canvases.filter(([id]) => !['cam-calibration', 'debug-camera', 'finish-photo-single-canvas', 'finish-photo-dual-canvas'].includes(id));
        frame.canvases = frame.canvases.map(([id, data]) => [id, createHash('sha256').update(data).digest('hex')]);
        // Animation-frame handles are opaque: starting the camera loop
        // explicitly changes their numbers, not game-loop scheduling state.
        if (frame.state.game.gameLoopId !== undefined) frame.state.game.gameLoopId = 'scheduled';
        const calibrationPhase = ['pre-calibrating', 'calibrating'].includes(frame.state.game.gameState);
        // Calibration now uses its own full-frame preview instead of the small
        // gameplay feeds. Compare those feeds normally in every other phase.
        const gameplayCameras = new Set(['cam-single', 'cam-left', 'cam-right', 'split-cam-container']);
        if (calibrationPhase) {
            if (frame.ids) frame.ids = frame.ids.filter(element => !gameplayCameras.has(element.id));
            if (frame.elements) frame.elements = frame.elements.filter(([id]) => !gameplayCameras.has(id));
        }
        if (frame.ids) {
            // Offline Tailwind leaves the old HUD in normal flow. The compact
            // absolute HUD moves only the empty screen stack's origin in play.
            if (frame.state.game.gameState === 'playing') {
                const stack=frame.ids.find(element=>element.id==='center-screens');
                if (stack?.rect?.[3]===0) delete stack.rect;
            }
            const sourceVideo = frame.ids.find(element => element.id === 'webcam-video');
            sourceVideo.attrs = sourceVideo.attrs.filter(([name]) => name !== 'muted');
            delete sourceVideo.rect; // The decoder is now rendered offscreen at 1px.
            // The requested live preview changes only the calibration card's
            // geometry. Preserve its text, progress, classes and all game state.
            if (calibrationPhase) {
                for (const element of frame.ids) {
                    if (['calibration-screen', 'btn-calibration-back', 'txt-stand-still',
                        'calibration-bar', 'txt-learning', 'center-screens'].includes(element.id)) delete element.rect;
                }
            }
        }
        // Requested bug fix: an expired gameplay notification must not leak into
        // non-playing screens. Its original in-game lifetime is still compared.
        if (frame.state.game.gameState !== 'playing') {
            delete frame.state.game.orbNotifyTimer;
            if (frame.ids) frame.ids = frame.ids.filter(element => !['orb-notify', 'orb-notify-text'].includes(element.id));
            if (frame.elements) frame.elements = frame.elements.filter(([id]) => !['orb-notify', 'orb-notify-text'].includes(id));
            // Tailwind is stubbed here, so the leaked absolute overlay instead
            // adds normal-flow height to its parent. Only that ancestor's
            // offline geometry changes when the requested label is hidden.
            if (frame.ids) {
                const parent = frame.ids.find(element => element.id === 'center-screens');
                if (parent) delete parent.rect;
            }
        }
    }
    result.ids = result.ids.filter(element => !changedWidgets.has(element.id));
    for (const checkpoint of result.checkpoints) {
        checkpoint.elements = checkpoint.elements.filter(([id]) => !changedWidgets.has(id));
    }
    for (const key of changedStorage) delete result.storage[key];
    // The player-lock feature deliberately expands candidate detection to four.
    // A dedicated test checks the new value; retain every other camera option.
    for (const effect of result.effects) {
        if (effect[0] === 'vision-options') delete effect[1].numPoses;
    }
    return canonicalizeMedia(result);
}

async function compareScenario(run, options) {
    const legacy = await prepare(true, options);
    const current = await prepare(false, options);
    try {
        await run(legacy.page);
        await run(current.page);
        assert.deepEqual(current.errors, legacy.errors, 'Runtime errors match');
        assert.deepEqual(current.errors, [], 'Scenario has no runtime errors');
        const actual = await snapshot(current.page), expected = await snapshot(legacy.page);
        for (const key of Object.keys(expected)) {
            if (key === 'checkpoints') {
                assert.equal(actual.checkpoints.length, expected.checkpoints.length);
                for (let i = 0; i < expected.checkpoints.length; i++) {
                    for (const field of Object.keys(expected.checkpoints[i])) {
                        assert.deepEqual(actual.checkpoints[i][field], expected.checkpoints[i][field],
                            `${expected.checkpoints[i].label}: ${field}`);
                    }
                }
            } else assert.deepEqual(actual[key], expected[key], key);
        }
    } finally { await legacy.context.close(); await current.context.close(); }
}

test('existing page markup, utility classes, and CSS are preserved around relocated assets and the tracking overlay', () => {
    const normalize = html => canonicalizeMedia(html).replace(/<style>[\s\S]*?<\/style>|<link rel="stylesheet" href="styles\/game.css">/g, '<!-- styles -->')
        .replace(/        <!-- 1 PLAYER HUD -->[\s\S]*?(?=        <!-- Login \()/g, '')
        .replaceAll(' data-energy-estimate', '')
        .replaceAll('>EST. ENERGY<', '>ENERGY<')
        .replace(/            <!-- Finish photo layout start -->\n            <div id="game-over-layout">\n/g, '')
        .replace(/            <!-- Finish photo single -->[\s\S]*?<!-- End finish photo single -->\n/g, '')
        .replace('            </div><!-- Finish photo layout end -->\n', '')
        .replace(/<!-- Finish photo dialog -->[\s\S]*?<!-- End finish photo dialog -->\n/g, '')
        .replace(/<!-- DEBUG PANEL:[\s\S]*?<!-- END DEBUG PANEL -->\n/g, '')
        .replace(/                <!-- Calibration camera preview -->[\s\S]*?<!-- End calibration camera preview -->\n/g, '')
        .replace('autoplay muted playsinline', 'autoplay playsinline')
        .replace(/\n    <!-- Player tracking recovery -->[\s\S]*?<!-- End player tracking recovery -->\n/g, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<!-- script -->')
        .replace(/<!-- Day dots -->[\s\S]*?(?=<!-- Next button -->)/g, '<!-- streak progress -->\n')
        .replace(/<!--[\s\S]*?-->/g, '').trimEnd();
    // Comments may change as obsolete prototype references are removed.
    const normalizeCss = css => canonicalizeMedia(css)
        .replace(/\n\/\* Compact gameplay HUD \*\/[\s\S]*?\/\* End compact gameplay HUD \*\/\n?/g, '')
        .replace(/\n\/\* Finish photo presentation \*\/[\s\S]*?\/\* End finish photo presentation \*\/\n?/g, '')
        .replace(/\n\/\* Debug panel:[\s\S]*?\/\* End debug panel \*\/\n?/g, '')
        .replace(/\/\* Calibration camera preview \*\/[\s\S]*?\/\* End calibration camera preview \*\//g, '')
        .replace(/\/\* Player tracking overlay \*\/[\s\S]*?\/\* End player tracking overlay \*\//g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '').trimEnd();
    assert.equal(normalize(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), normalize(original));
    assert.equal(normalizeCss(fs.readFileSync(path.join(root, 'styles/game.css'), 'utf8')), normalizeCss(original.match(/<style>([\s\S]*?)<\/style>/)[1]));
});

test('initial screens and persisted preferences match at three viewport sizes', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
        for (const theme of ['light', 'dark']) await compareScenario(async page => {
            await page.evaluate(() => window.__advanceFrames(3));
        }, { viewport, stored: { game_theme: theme, game_lang: 'mi', player_name: 'Aroha', player2_name: 'Moana', instruction_voice_muted: 'true', game_leaderboard_normal: '[{"name":"Old","score":999}]' } });
    }
});

test('login, modes, leaderboards, warning audio, and every tutorial slide match', async () => {
    await compareScenario(page => page.evaluate(async () => {
        const click = id => document.getElementById(id).click();
        click('btn-continue');
        const name = document.getElementById('player-name'); name.value = 'Aroha'; name.dispatchEvent(new Event('input'));
        click('lang-btn-mi'); click('login-theme-toggle'); click('btn-continue');
        window.__record('login and streak');
        window.__flushTimers(); click('btn-streak-next');
        click('btn-mode-2p'); click('btn-play');
        document.getElementById('player2-name').value = 'Moana';
        click('btn-speed-chill'); window.toggleLeaderboard(); window.switchLBTab('chill'); window.switchLBTab('normal'); window.toggleLeaderboard();
        window.__record('two-player dashboard and speed');
        await window.__gameTest.call('initCameraSequence');
        click('warning-read-btn'); await Promise.resolve(); click('warning-read-btn'); click('warning-continue-btn');
        window.__record('first tutorial slide');
        click('instruction-mute'); click('instruction-mute'); click('instruction-next'); click('instruction-prev');
        for (let i = 0; i < 5; i++) { click('instruction-next'); window.__record(`tutorial next ${i}`); }
        click('start-btn'); window.__flushTimers();
    }));
});

test('camera and AI failure paths match', async () => {
    for (const failure of ['__visionFailure', '__cameraFailure']) await compareScenario(page => page.evaluate(async failure => {
        window[failure] = true;
        await window.__gameTest.call('initCameraSequence');
    }, failure));
});

test('post-calibration pose identity, gestures, shields, and split-screen rendering match', async () => {
    for (const count of [1, 2]) await compareScenario(page => page.evaluate(count => {
        const api = window.__gameTest;
        const pose = x => {
            const points = Array.from({ length: 33 }, () => ({ x, y: 0.4, z: 0, visibility: 1 }));
            points[11].x = x + 0.08; points[12].x = x - 0.08;
            points[23] = { x: x + 0.06, y: 0.7 }; points[24] = { x: x - 0.06, y: 0.7 };
            return points;
        };
        const left = pose(0.75), right = pose(0.25);
        for (const p of [left, right]) { p[15] = { x: 0.9, y: 0.8 }; p[16] = { x: 0.1, y: 0.8 }; }
        // Readiness and time-based calibration intentionally replace the old
        // first-frame lock/60-frame policy. Compare unchanged gameplay from
        // identical prepared players; dedicated tests exercise real calibration.
        const prepared = api.read().game.players;
        for (let i = 0; i < count; i++) Object.assign(prepared[i], {
            baseline:0.4, calibrationFrames:60, homeX:i === 0 ? 0.75 : 0.25, homeXSum:i === 0 ? 45 : 15
        });
        api.patch({ numPlayers:count, players:prepared });
        if (api.has('lockPlayers')) api.call('lockPlayers', count === 1 ? [left] : [left,right]);
        api.call('startGameplay');
        window.__record('prepared players');
        for (const wrists of [[0.4,0.8],[0.8,0.4],[0.1,0.1],[0.4,0.4],[0.8,0.8]]) {
            left[15].y = wrists[0]; left[16].y = wrists[1];
            if (wrists[0] === 0.4 && wrists[1] === 0.4) {
                left[15].x = left[11].x + 0.14; left[16].x = left[12].x - 0.14;
            } else { left[15].x = 0.9; left[16].x = 0.1; }
            for (const [s,e,w] of [[11,13,15],[12,14,16]]) {
                left[e] = { x:(left[s].x+left[w].x)/2, y:(left[s].y+left[w].y)/2 };
            }
            const singleArm = (wrists[0] < 0.55) !== (wrists[1] < 0.55);
            // Compare unchanged lane direction using one raise and a neutral
            // release. Sustained raises now have their own requested behavior.
            for (let i = 0; i < (singleArm ? 10 : 30); i++) api.call('onPoseResults', { landmarks: count === 1 ? [left] : [left, right] });
            if (singleArm) {
                left[15].y = 0.8; left[16].y = 0.8;
                for (let i = 0; i < 30; i++) api.call('onPoseResults', { landmarks: count === 1 ? [left] : [left, right] });
            }
            window.__advanceFrames(2);
            window.__record(`gesture ${wrists}`);
        }
        const players = api.read().game.players; players[0].shieldOrbs = 5;
        api.patch({ players });
        left[15] = { x: 0.1, y: 0.4 }; left[16] = { x: 0.9, y: 0.4 };
        left[13] = { x: 0.8, y: 0.4 }; left[14] = { x: 0.7, y: 0.4 };
        api.call('onPoseResults', { landmarks: count === 1 ? [left] : [right, left] });
        window.__advanceFrames(12);
        window.__record('crossed arms and active shield');
    }, count));
});

test('spawning, progression, collisions, collection, game over, and restart match', async () => {
    for (const count of [1, 2]) await compareScenario(page => page.evaluate(count => {
        const api = window.__gameTest;
        api.patch({ numPlayers: count, currentPlayerName: 'Aroha', currentPlayer2Name: 'Moana' });
        localStorage.setItem('current_streak', '3');
        localStorage.setItem('last_login_date', '2026-10-24');
        api.call('startGameplay');
        window.__record('new run and streak rewards');
        for (const score of [0, 150, 250]) {
            api.patch({ score }); for (let i = 0; i < 30; i++) api.call('spawnObstacle');
            window.__record(`spawning at ${score}`);
        }
        api.patch({ obstacles: [], score: 99.99, nextMilestone: 100 });
        window.__advanceFrames(5);
        window.__record('first milestone');
        for (const type of ['block', 'high', 'low', 'low-wide', 'door']) {
            const players = api.read().game.players;
            for (const p of players) { p.lives = 9; p.lane = 0; p.invulnerableFrames = 0; p.isJumping = false; p.isSquatting = false; p.shieldActive = false; }
            api.patch({ players, obstacles: [{ lane: 0, span: 3, depth: 0.8, type, active: true }] });
            window.__advanceFrames(1);
            window.__record(`obstacle collision ${type}`);
        }
        for (const type of ['shield', 'heart']) {
            api.patch({ obstacles: [], orbs: [{ lane: 0, depth: 0.8, type, active: true, bobOffset: 0 }] });
            window.__advanceFrames(1);
            window.__record(`orb collection ${type}`);
        }
        let players = api.read().game.players;
        players[0].shieldActive = true; players[0].shieldTimer = 2;
        api.patch({ players, obstacles: [{ lane: 0, span: 1, depth: 0.8, type: 'block', active: true }] });
        window.__advanceFrames(3);
        window.__record('shield absorbed hit and expired');
        api.patch({ obstacles: [], score: 401, nextMilestone: 400, skyStyle: 3 }); window.__advanceFrames(2);
        window.__record('last milestone');
        players = api.read().game.players; players[0].lives = 0;
        api.patch({ players }); window.__advanceFrames(1);
        window.__record('game over');
        window.switchGOLBTab('chill'); window.toggleLeaderboard(); window.toggleLeaderboard();
        document.getElementById('btn-play-again').click(); window.__flushTimers();
        window.__record('play again');
        api.call('startGameplay'); api.call('gameOver'); document.getElementById('restart-btn').click();
    }, count));
});

test('resizing preserves viewport and original projection behavior', async () => {
    await compareScenario(async page => {
        await page.setViewportSize({ width: 900, height: 600 });
        await page.evaluate(() => window.__settleResize());
        await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.__gameTest.call('startGameplay'); window.__advanceFrames(5); });
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.evaluate(() => window.__settleResize());
        await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.__advanceFrames(3); });
    });
});

test('legacy leaderboard data is cleared once; real scores persist, rank, and remain separate by mode', async () => {
    const { context, page, errors } = await prepare(false, { stored: {
        game_leaderboard_normal: '[{"name":"WaikatoChamp","score":187}]',
        game_leaderboard_chill: '[{"name":"MargaretW","score":94}]'
    } });
    try {
        const initial = await page.evaluate(() => {
            window.toggleLeaderboard();
            return { normal: window.__gameTest.call('getLeaderboard'), text: document.getElementById('leaderboard-body').textContent };
        });
        assert.deepEqual(initial.normal, []);
        assert.match(initial.text, /No scores yet/);
        const saved = await page.evaluate(() => {
            const api = window.__gameTest;
            api.patch({ currentPlayerName: 'Aroha' });
            for (const score of [42.9, 80, 10, 60, 20, 100]) api.call('saveScore', score);
            api.patch({ speedMultiplier: 0.4 }); api.call('saveScore', 88.9);
            window.switchLBTab('chill');
            return { normal: api.call('getLeaderboard', 'game_leaderboard_normal'), chill: api.call('getLeaderboard'), text: document.getElementById('leaderboard-body').textContent };
        });
        assert.deepEqual(saved.normal, [{ name:'Aroha', score:100 }]);
        assert.deepEqual(saved.chill, [{ name: 'Aroha', score: 88 }]);
        assert.match(saved.text, /Aroha/);
        await page.reload({ waitUntil: 'load' });
        const reloaded = await page.evaluate(() => ({
            normal: window.__gameTest.call('getLeaderboard', 'game_leaderboard_normal'),
            chill: window.__gameTest.call('getLeaderboard', 'game_leaderboard_chill')
        }));
        assert.deepEqual(reloaded.normal, saved.normal);
        assert.deepEqual(reloaded.chill, saved.chill);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('duplicate player records migrate to personal bests across tables, live ranking, saves and reloads',async()=>{
    const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1',
        game_leaderboard_normal:JSON.stringify([{name:' aroha ',score:40},{name:'Aroha',score:100},{name:'Mere',score:90},
            {name:'Kiri',score:80},{name:'Tama',score:70},{name:'Hemi',score:60}]),
        game_leaderboard_chill:JSON.stringify([{name:'Aroha',score:15},{name:'aroha',score:30},{name:'Mere',score:20}])}});
    try {
        const result=await page.evaluate(()=>{
            const api=window.__gameTest;
            const initial=JSON.parse(localStorage.getItem('game_leaderboard_normal'));
            const chill=JSON.parse(localStorage.getItem('game_leaderboard_chill'));
            api.patch({currentPlayerName:'aroha'});api.call('saveScore',60);api.call('saveScore',120);api.call('saveScore',120);
            window.switchLBTab('normal');api.call('renderGameOverLeaderboard');
            const table=id=>[...document.getElementById(id).querySelectorAll('tr')].map(row=>[...row.cells].map(cell=>cell.textContent));
            const dashboard=table('leaderboard-body'),gameOver=table('gameover-leaderboard-body');
            api.call('startGameplay');
            const current=document.querySelector('#hud-ranking-1p .hud-rank-current');
            const live={name:current.querySelector('.hud-rank-name').title,score:current.querySelector('.hud-rank-score').textContent,
                duplicates:[...document.querySelectorAll('#hud-ranking-1p .hud-rank-name')].filter(el=>el.title.toLowerCase()==='aroha').length};
            api.patch({score:60});api.call('updateHUD');
            const lowerLive=document.querySelector('#hud-ranking-1p .hud-rank-current .hud-rank-score').textContent;
            api.call('gameOver');const lowerSaved=api.call('getLeaderboard')[0].score;
            api.call('startGameplay');
            api.patch({score:130});api.call('updateHUD');
            const higherLive=document.querySelector('#hud-ranking-1p .hud-rank-current .hud-rank-score').textContent;
            const unsaved=JSON.parse(localStorage.getItem('game_leaderboard_normal'))[0].score;
            api.call('gameOver');
            return {initial,chill,dashboard,gameOver,live,lowerLive,lowerSaved,higherLive,unsaved,finished:api.call('getLeaderboard')};
        });
        assert.deepEqual(result.initial.map(entry=>entry.score),[100,90,80,70,60]);
        assert.deepEqual(result.chill,[{name:'aroha',score:30},{name:'Mere',score:20}]);
        for(const table of [result.dashboard,result.gameOver]) {
            assert.equal(table.length,5);
            assert.equal(table.filter(row=>row[1].toLowerCase().includes('aroha')).length,1);
            assert.equal(table[0][2],'120');
        }
        assert.match(result.gameOver[0][1],/⬅/,'personal best highlights despite name casing');
        assert.deepEqual(result.live,{name:'aroha',score:'0',duplicates:1});assert.equal(result.unsaved,120);
        assert.equal(result.lowerLive,'60');assert.equal(result.lowerSaved,120);assert.equal(result.higherLive,'130');
        assert.deepEqual(result.finished[0],{name:'aroha',score:130});assert.equal(result.finished.length,5);
        await page.reload({waitUntil:'load'});
        const persisted=await page.evaluate(()=>({normal:window.__gameTest.call('getLeaderboard'),
            chill:window.__gameTest.call('getLeaderboard','game_leaderboard_chill')}));
        assert.deepEqual(persisted.normal,result.finished);assert.deepEqual(persisted.chill,result.chill);
        assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('malformed leaderboard records recover and names render as text', async () => {
    const { context, page, errors } = await prepare(false, { stored: {
        leaderboard_data_version: '1', game_leaderboard_normal: '{broken json'
    } });
    try {
        const result = await page.evaluate(() => {
            const api = window.__gameTest;
            const invalid = api.call('getLeaderboard');
            localStorage.setItem('game_leaderboard_normal', JSON.stringify([null, {}, { name: '', score: 5 }, { name: 'Bad', score: '100' }, { name: 'Real', score: 30 }]));
            const cleaned = api.call('getLeaderboard');
            api.patch({ currentPlayerName: '<img src=x onerror=alert(1)>' });
            api.call('saveScore', 40);
            api.call('saveScore', NaN); api.call('saveScore', -3); api.call('saveScore', Infinity);
            const body = document.getElementById('leaderboard-body');
            return { invalid, cleaned, board: api.call('getLeaderboard'), text: body.textContent, images: body.querySelectorAll('img').length };
        });
        assert.deepEqual(result.invalid, []);
        assert.deepEqual(result.cleaned, [{ name: 'Real', score: 30 }]);
        assert.deepEqual(result.board.map(player => player.score), [40, 30]);
        assert.match(result.text, /<img src=x onerror=alert\(1\)>/);
        assert.equal(result.images, 0);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('first-day players mark the first circle and receive no special-name bonus', async () => {
    for (const name of ['bin', 'pavani', 'simin', 'moosa', 'Aroha']) {
        const { context, page, errors } = await prepare(false, { stored: {
            player_name: name, current_streak: '3', last_login_date: '2026-10-24', streak_bonus_claimed_date: '2026-10-24'
        } });
        try {
            const result = await page.evaluate(() => {
                document.getElementById('btn-continue').click();
                const dots = [1, 2, 3].map(day => document.getElementById(`streak-day-${day}`).textContent);
                const number = document.getElementById('streak-big-number').textContent;
                const firstIsCurrent = document.getElementById('streak-day-1').getAttribute('aria-current');
                const savedName = localStorage.getItem('player_name');
                window.__gameTest.call('startGameplay');
                return { dots, number, firstIsCurrent, savedName, state: window.__gameTest.read(), banner: document.getElementById('streak-bonus-banner').classList.contains('hidden') };
            });
            assert.equal(result.number, '1', name);
            assert.deepEqual(result.dots, ['✓', '', ''], name);
            assert.equal(result.firstIsCurrent, 'step', name);
            assert.equal(result.savedName, name);
            assert.equal(result.state.game.players[0].shieldOrbs, 0, name);
            assert.equal(result.state.game.streakBonusGranted, false, name);
            assert.equal(result.banner, true, name);
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
});

test('streaks advance once per local day, survive reload, reset after a gap, and award earned bonuses once', async () => {
    const { context, page, errors } = await prepare(false, { stored: { player_name: 'Aroha' } });
    try {
        await page.evaluate(() => document.getElementById('btn-continue').click());
        await page.reload({ waitUntil: 'load' });
        const days = await page.evaluate(() => {
            const results = [];
            for (const date of ['2026-10-24T10:30:00Z', '2026-10-24T11:30:00Z', '2026-10-24T12:30:00Z', '2026-10-25T11:30:00Z']) {
                window.__setNow(date);
                document.getElementById('btn-continue').click();
                results.push({
                    number: document.getElementById('streak-big-number').textContent,
                    dots: [1, 2, 3].map(day => document.getElementById(`streak-day-${day}`).textContent),
                    date: localStorage.getItem('last_login_date')
                });
            }
            return results;
        });
        assert.deepEqual(days.map(day => day.number), ['1', '2', '2', '3']);
        assert.deepEqual(days.map(day => day.dots), [['✓', '', ''], ['✓', '✓', ''], ['✓', '✓', ''], ['✓', '✓', '✓']]);
        assert.deepEqual(days.map(day => day.date), ['2026-10-24', '2026-10-25', '2026-10-25', '2026-10-26']);
        const bonus = await page.evaluate(() => {
            const api = window.__gameTest;
            api.patch({ numPlayers: 2 });
            api.call('startGameplay');
            const first = api.read().game.players.map(player => player.shieldOrbs);
            api.call('startGameplay');
            const again = api.read().game.players.map(player => player.shieldOrbs);
            window.__setNow('2026-10-28T00:00:00Z');
            document.getElementById('btn-continue').click();
            const reset = localStorage.getItem('current_streak');
            const noticeHidden = document.getElementById('streak-reward-notice').classList.contains('hidden');
            return { first, again, reset, noticeHidden };
        });
        assert.deepEqual(bonus, { first: [5, 5], again: [0, 0], reset: '1', noticeHidden: true });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('held lane gestures move once and reset when starting a new run', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(() => {
            const api = window.__gameTest;
            const neutral = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4 }));
            neutral[11] = { x: 0.6, y: 0.4 }; neutral[12] = { x: 0.4, y: 0.4 };
            neutral[23] = { x: 0.57, y: 0.7 }; neutral[24] = { x: 0.43, y: 0.7 };
            neutral[15] = { x: 0.8, y: 0.8 }; neutral[16] = { x: 0.2, y: 0.8 };
            api.patch({ gameState: 'calibrating' });
            for (let i = 0; i < 240; i++) api.call('onPoseResults', { landmarks: [neutral] });
            const raised = neutral.map(point => ({ ...point }));
            raised[15].y = 0.4;
            for (let i = 0; i < 100; i++) api.call('onPoseResults', { landmarks: [raised] });
            const first = api.read().game.players[0].lane;
            // startGameplay reuses player objects, so its reset must clear the
            // private gesture latch rather than relying on new object identity.
            api.call('startGameplay');
            for (let i = 0; i < 100; i++) api.call('onPoseResults', { landmarks: [raised] });
            return { first, again: api.read().game.players[0].lane };
        });
        assert.deepEqual(result, { first: -1, again: -1 });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('orb notifications disappear at game over and stay hidden on the dashboard and tutorial', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(async () => {
            const api = window.__gameTest;
            const hidden = () => document.getElementById('orb-notify').classList.contains('hidden');
            api.call('startGameplay');
            api.call('showOrbNotify', '🛡️ Shield orb incoming!', 'rgba(6,182,212,0.95)');
            const duringPlay = hidden();
            api.call('gameOver');
            const gameOver = { hidden: hidden(), timer: api.read().game.orbNotifyTimer };
            document.getElementById('restart-btn').click();
            const dashboard = hidden();
            api.patch({ gameState: 'loading' });
            await api.call('initCameraSequence');
            document.getElementById('warning-continue-btn').click();
            return { duringPlay, gameOver, dashboard, tutorial: hidden(),
                tutorialVisible: !document.getElementById('instructions-screen').classList.contains('hidden') };
        });
        assert.deepEqual(result, { duringPlay: false, gameOver: { hidden: true, timer: 0 }, dashboard: true, tutorial: true, tutorialVisible: true });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('orb notification expiration and replacement retain the original 120-frame duration', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(() => {
            const api = window.__gameTest;
            const status = () => ({ timer: api.read().game.orbNotifyTimer, hidden: document.getElementById('orb-notify').classList.contains('hidden') });
            api.call('startGameplay');
            api.call('showOrbNotify', '🛡️ Shield orb incoming!', 'cyan');
            window.__advanceFrames(119);
            const beforeExpiry = status();
            window.__advanceFrames(1);
            const expired = status();
            api.call('showOrbNotify', '🛡️ +1 Shield!', 'cyan');
            window.__advanceFrames(60);
            api.call('showOrbNotify', '💗 +1 Life!', 'pink');
            const replacement = { ...status(), text: document.getElementById('orb-notify-text').textContent };
            window.__advanceFrames(119);
            const replacementBeforeExpiry = status();
            window.__advanceFrames(1);
            return { beforeExpiry, expired, replacement, replacementBeforeExpiry, replacementExpired: status() };
        });
        assert.deepEqual(result, {
            beforeExpiry: { timer: 1, hidden: false }, expired: { timer: 0, hidden: true },
            replacement: { timer: 120, hidden: false, text: '💗 +1 Life!' },
            replacementBeforeExpiry: { timer: 1, hidden: false }, replacementExpired: { timer: 0, hidden: true }
        });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('orb notifications are blocked outside gameplay and cleared on tutorial entry or run restart', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(() => {
            const api = window.__gameTest;
            const status = () => ({ timer: api.read().game.orbNotifyTimer, hidden: document.getElementById('orb-notify').classList.contains('hidden') });
            const blocked = ['login', 'dashboard', 'loading', 'pre-calibrating', 'calibrating', 'gameover'].map(gameState => {
                api.patch({ gameState });
                api.call('showOrbNotify', '🛡️ Shield orb incoming!', 'cyan');
                return status();
            });
            api.call('startGameplay');
            api.call('showOrbNotify', '🛡️ Shield orb incoming!', 'cyan');
            api.patch({ gameState: 'loading' });
            api.call('showInstructionsScreen');
            const tutorial = status();
            api.call('startGameplay');
            api.call('showOrbNotify', '🛡️ Shield orb incoming!', 'cyan');
            api.call('startGameplay');
            return { blocked, tutorial, newRun: status() };
        });
        const cleared = { timer: 0, hidden: true };
        assert.deepEqual(result, { blocked: Array.from({ length: 6 }, () => cleared), tutorial: cleared, newRun: cleared });
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('calibrated player slots reject newcomers and preserve a missing player slot in both modes', async () => {
    for (const count of [1, 2]) {
        const { context, page, errors } = await prepare(false);
        try {
            const result = await page.evaluate(count => {
                const api = window.__gameTest;
                const pose = (x, raised = false, size = 1) => {
                    const points = Array.from({ length: 33 }, () => ({ x, y: 0.4, visibility: 1, presence: 1 }));
                    points[11].x = x + 0.1 * size; points[12].x = x - 0.1 * size;
                    points[23] = { x: x + 0.07 * size, y: 0.4 + 0.3 * size };
                    points[24] = { x: x - 0.07 * size, y: 0.4 + 0.3 * size };
                    points[15] = { x: x + 0.23 * size, y: raised ? 0.4 : 0.8 };
                    points[16] = { x: x - 0.23 * size, y: 0.8 };
                    return points;
                };
                const first = pose(0.75), second = pose(0.25);
                const feed = (poses, frames) => { for (let i = 0; i < frames; i++) api.call('onPoseResults', { landmarks: poses }); };
                api.patch({ numPlayers: count, gameState: 'calibrating' });
                feed(count === 1 ? [first] : [second, first], 240);
                const hidden = () => document.getElementById('player-tracking-notice').hidden;
                const bystander = pose(0.05, true, 0.5);
                feed(count === 1 ? [bystander, first] : [bystander, second, first], 30);
                const ignored = api.read().game.players.slice(0, count).map(player => player.lane);
                const normalNotice = hidden();
                feed(count === 1 ? [first, bystander] : [first, bystander, pose(0.25, true)], 10);
                const intentional = api.read().game.players.slice(0, count).map(player => player.lane);
                feed(count === 1 ? [bystander] : [pose(0.25, true), bystander], 30);
                const lost = { lanes: api.read().game.players.slice(0, count).map(player => player.lane), hidden: hidden(),
                    message: document.getElementById('player-tracking-message').textContent };
                api.call('gameOver');
                return { ignored, normalNotice, intentional, lost, afterGameOver: hidden() };
            }, count);
            assert.deepEqual(result.ignored, Array(count).fill(0));
            assert.equal(result.normalNotice, true);
            assert.deepEqual(result.intentional, count === 1 ? [0] : [0, -1]);
            assert.deepEqual(result.lost.lanes, count === 1 ? [0] : [0, -1]);
            assert.equal(result.lost.hidden, false);
            assert.match(result.lost.message, /Player 1 lost/);
            assert.equal(result.afterGameOver, true);
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
});

test('ambiguous players pause while matching recovers; manual recalibration still restarts and camera considers four candidates', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(async () => {
            const api = window.__gameTest;
            window.__flushTimers(); // Finish the startup intro before exercising pointer input.
            await api.call('initCameraSequence');
            const options = window.__effects.find(effect => effect[0] === 'vision-options')[1];
            const pose = (x, size = 1) => {
                const points = Array.from({ length: 33 }, () => ({ x, y: 0.4, visibility: 1 }));
                points[11].x = x + 0.1 * size; points[12].x = x - 0.1 * size;
                points[23] = { x: x + 0.07 * size, y: 0.4 + 0.3 * size };
                points[24] = { x: x - 0.07 * size, y: 0.4 + 0.3 * size };
                points[15] = { x: x + 0.23 * size, y: 0.8 };
                points[16] = { x: x - 0.23 * size, y: 0.8 };
                return points;
            };
            const feed = (poses, frames) => { for (let i = 0; i < frames; i++) api.call('onPoseResults', { landmarks: poses }); };
            api.patch({ gameState: 'calibrating' });
            feed([pose(0.5)], 240);
            feed([pose(0.5), pose(0.52)], 1);
            const warning = document.getElementById('player-tracking-message').textContent;
            const visible = !document.getElementById('player-tracking-notice').hidden;
            feed([pose(0.52)], 40);
            const stillLocked = api.call('trackingStatuses');
            window.__trackingRecalibrationPose = pose(0.3, 0.7);
            return { numPoses: options.numPoses, warning, visible, stillLocked };
        });
        // Verify the recovery overlay fits a narrow viewport and accepts a real
        // pointer click rather than bypassing hit testing with element.click().
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#bg-intro').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
        const rectangle = await page.locator('#player-tracking-notice').boundingBox();
        assert.ok(rectangle && rectangle.x >= 0 && rectangle.x + rectangle.width <= 390);
        if (process.env.TRACKING_QA_SCREENSHOT) {
            await page.locator('#player-tracking-notice').screenshot({ path: process.env.TRACKING_QA_SCREENSHOT });
        }
        await page.locator('#btn-recalibrate-players').click();
        const recovery = await page.evaluate(() => {
            const api = window.__gameTest;
            const restarting = { gameState: api.read().game.gameState, hidden: document.getElementById('player-tracking-notice').hidden };
            window.__flushTimers();
            for (let i = 0; i < 240; i++) api.call('onPoseResults', { landmarks: [window.__trackingRecalibrationPose] });
            const after = { gameState: api.read().game.gameState, homeX: api.read().game.players[0].homeX,
                hidden: document.getElementById('player-tracking-notice').hidden };
            return { restarting, after };
        });
        assert.equal(result.numPoses, 4);
        assert.match(result.warning, /Cannot identify Player 1/);
        assert.equal(result.visible, true);
        assert.deepEqual(result.stillLocked, ['checking']);
        assert.deepEqual(recovery.restarting, { gameState: 'pre-calibrating', hidden: true });
        assert.equal(recovery.after.gameState, 'playing');
        assert.ok(Math.abs(recovery.after.homeX - 0.3) < 1e-9);
        assert.equal(recovery.after.hidden, true);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('localized HUD tiles share height and fit desktop, portrait and landscape screens in both themes', async () => {
    for (const count of [1,2]) {
        const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1',
            game_leaderboard_normal:JSON.stringify([{name:'Mere',score:100},{name:'Hemi',score:20}])}});
        try {
            await page.evaluate(count=>{
                window.__flushTimers();
                document.getElementById('login-screen-wrap').style.display='none';
                document.getElementById('bg-intro').style.display='none';
                document.querySelectorAll('#center-screens > div').forEach(el=>el.classList.add('hidden'));
                window.__gameTest.patch({numPlayers:count,currentPlayerName:'Aroha',currentPlayer2Name:'Tama'});
                window.__gameTest.call('startGameplay');
                const players=window.__gameTest.read().game.players;
                players.forEach((player,index)=>{player.score=42-index*3;});
                window.__gameTest.patch({players,score:42});
                window.__gameTest.call('updateHUD');
            },count);
            for(const viewport of [{width:1920,height:854},{width:1280,height:800},{width:844,height:390},{width:390,height:844},{width:320,height:568}]) {
                await page.setViewportSize(viewport);
                await page.evaluate(()=>window.__settleResize());
                for(const lang of ['en','mi']) for(const dark of [false,true]) {
                    const geometry=await page.evaluate(({count,dark,lang})=>{
                        window.__gameTest.call('setLoginLang',lang);
                        document.documentElement.classList.toggle('dark',dark);
                        const hud=document.getElementById(`hud-${count}p`);
                        const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};
                        return {labels:[...hud.querySelectorAll('.hud-label > span:last-child')].map(el=>el.textContent),
                            ariaLabel:hud.getAttribute('aria-label'),rankingAria:document.getElementById('hud-ranking-1p').getAttribute('aria-label'),
                            hud:rect(hud),tiles:[...hud.querySelectorAll('.hud-tile')].map(rect),
                            overflow:[...hud.querySelectorAll('p')].filter(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1).map(el=>({class:el.className,width:el.clientWidth,scrollWidth:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight})),
                            names:[...hud.querySelectorAll('.hud-player-name')].map(el=>el.textContent),
                            singleName:!!document.getElementById('p1-hud-name-1p'),
                            energy:hud.querySelector('[data-energy-estimate]'),
                            sizes:[...hud.querySelectorAll('.hud-label,.hud-value,.hud-rank-row,.hud-player-name')].map(el=>parseFloat(getComputedStyle(el).fontSize)),
                            titleStyles:[...hud.querySelectorAll('.hud-label')].map(el=>{
                                const style=getComputedStyle(el);return [style.fontSize,style.lineHeight,style.fontWeight,style.textTransform];
                            }),
                            currentNames:[...hud.querySelectorAll('.hud-rank-current .hud-rank-name')].map(el=>el.title),
                            rankingWidths:[...hud.querySelectorAll('.hud-ranking,.hud-name-tile')].map(el=>el.getBoundingClientRect().width),
                            medalNames:[...hud.querySelectorAll('.hud-rank-name')].filter(el=>!el.parentElement.hidden).map(el=>el.textContent),
                            icons:[...hud.querySelectorAll('.hud-icon')].map(el=>el.textContent),
                            rankOverflow:[...hud.querySelectorAll('.hud-rank-number,.hud-rank-score')].some(el=>el.scrollWidth>el.clientWidth+1)};
                    },{count,dark,lang});
                    const labels=lang==='mi'?['Kaute','Oranga','Ārai']:['Score','Lives','Shields'];
                    assert.deepEqual(geometry.labels,count===1?[...labels,lang==='mi'?'Tūranga':'Live ranking']:[...labels,...labels]);
                    assert.equal(geometry.ariaLabel,lang==='mi'?(count===1?'Ngā tatauranga o te kēmu':'Ngā tatauranga o ngā kaitākaro'):(count===1?'Game statistics':'Player statistics'));
                    assert.equal(geometry.rankingAria,lang==='mi'?'Ngā tūranga ā-rohe':'Live local ranking');
                    assert.equal(geometry.tiles.length,4*count);
                    assert.ok(geometry.tiles.every(tile=>Math.abs(tile.height-geometry.tiles[0].height)<1),'fourth tile has equal height');
                    const maxHeight=count===1?(viewport.width>760?132:272):(viewport.width>1100?164:viewport.width>600?302:436);
                    assert.ok(geometry.hud.height<=maxHeight,'HUD uses bounded responsive rows');
                    for(const tile of geometry.tiles) assert.ok(tile.left>=0&&tile.right<=viewport.width&&tile.bottom<=geometry.hud.bottom+1,'tiles stay inside HUD and screen');
                    assert.deepEqual(geometry.overflow,[],`text fits ${lang} ${count}p ${viewport.width}px`);
                    assert.equal(geometry.singleName,false);
                    assert.deepEqual(geometry.names,count===1?[]:['Aroha','Tama']);
                    assert.equal(geometry.energy,null,'energy is absent from the gameplay HUD');
                    assert.ok(geometry.sizes.every(size=>size>=18),'labels and ranking never shrink below 18px');
                    assert.deepEqual(geometry.currentNames,count===1?['Aroha']:[]);
                    assert.equal(geometry.rankOverflow,false);
                    assert.deepEqual(geometry.icons,Array.from({length:count},()=>count===1?['🏆','❤️','🛡️','📊']:['🏆','❤️','🛡️']).flat());
                    assert.ok(geometry.titleStyles.every(style=>JSON.stringify(style)===JSON.stringify(geometry.titleStyles[0])),'ranking title shares other HUD title typography');
                    if(viewport.width===1920) assert.ok(geometry.rankingWidths.every(width=>width<=(count===1?400:250)),'ranking tile is narrower while fonts stay large');
                    if(count===1) assert.ok(geometry.medalNames.some(name=>name.startsWith('🥇 ')));
                    else assert.deepEqual(geometry.medalNames,[],'two-player tiles contain names without ranking rows');
                    if(process.env.HUD_QA_DIRECTORY&&((viewport.width===1920&&!dark)||(viewport.width===390&&dark))) {
                        fs.mkdirSync(process.env.HUD_QA_DIRECTORY,{recursive:true});
                        await page.evaluate(()=>window.__gameTest.call('renderGameplay'));
                        await page.screenshot({path:path.join(process.env.HUD_QA_DIRECTORY,`hud-${count}p-${viewport.width}-${lang}-${dark?'dark':'light'}.png`)});
                    }
                }
            }
            assert.deepEqual(errors,[]);
        } finally {await context.close();}
    }
});

test('live-ranking title stays at the top with one, two or three names in either language and theme',async()=>{
    const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1'}});
    try {
        await page.evaluate(()=>{
            window.__flushTimers();
            document.getElementById('login-screen-wrap').style.display='none';
            document.getElementById('bg-intro').style.display='none';
            document.querySelectorAll('#center-screens > div').forEach(el=>el.classList.add('hidden'));
            window.__gameTest.patch({numPlayers:1,currentPlayerName:'Aroha'});
            window.__gameTest.call('startGameplay');
        });
        for(const width of [1920,1280,844,390,320]) {
            await page.setViewportSize({width,height:854});
            await page.evaluate(()=>window.__settleResize());
            for(const lang of ['en','mi']) for(const dark of [false,true]) {
                const layouts=await page.evaluate(({lang,dark})=>{
                    const api=window.__gameTest;
                    api.call('setLoginLang',lang);
                    document.documentElement.classList.toggle('dark',dark);
                    const tile=document.getElementById('hud-ranking-1p');
                    const title=tile.querySelector('.hud-label');
                    const board=[{name:'Mere',score:200},{name:'Hemi',score:50}];
                    return [0,1,2,0].flatMap(savedCount=>{
                        localStorage.setItem('game_leaderboard_normal',JSON.stringify(board.slice(0,savedCount)));
                        return [0,100,300].map(score=>{
                            api.patch({score});api.call('updateHUD');
                            const t=tile.getBoundingClientRect(),h=title.getBoundingClientRect();
                            const style=getComputedStyle(tile);
                            const rows=[...tile.querySelectorAll('[data-rank-row]')].filter(row=>!row.hidden);
                            return {savedCount,rows:rows.length,height:t.height,title:title.textContent,
                                offset:h.top-t.top,expected:parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop),
                                rowsBelowTitle:rows.every(row=>row.getBoundingClientRect().top>=h.bottom-0.1)};
                        });
                    });
                },{lang,dark});
                for(const layout of layouts) {
                    assert.equal(layout.rows,layout.savedCount+1);
                    assert.equal(layout.height,132);
                    assert.ok(Math.abs(layout.offset-layout.expected)<0.1,
                        `title stays at the tile's top padding: ${width}px ${lang}, ${layout.rows} row(s), ${dark?'dark':'light'}`);
                    assert.ok(layout.rowsBelowTitle,'ranking rows follow the title');
                    assert.ok(layout.title.includes(lang==='mi'?'Tūranga':'Live ranking'));
                }
            }
        }
        assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('two-player fourth tiles show each slot’s name safely across replay, localization and mode changes',async()=>{
    const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1',
        game_leaderboard_normal:JSON.stringify([{name:'Saved player',score:100}])}});
    try {
        const result=await page.evaluate(()=>{
            const api=window.__gameTest;
            const stored=localStorage.getItem('game_leaderboard_normal');
            const names=()=>[...document.querySelectorAll('#hud-2p .hud-name-tile')].map(tile=>({
                name:tile.textContent.trim(),title:tile.querySelector('.hud-player-name').title,
                children:tile.children.length,parent:tile.closest('section').id
            }));
            api.patch({numPlayers:2,currentPlayerName:'Māui',currentPlayer2Name:'<img src=x onerror=alert(1)>'});
            api.call('startGameplay');const first=names();
            api.call('setLoginLang','mi');const translated=names();
            api.patch({currentPlayerName:'Aroha',currentPlayer2Name:'Aroha'});
            api.call('startGameplay');const replay=names();
            api.patch({numPlayers:1});api.call('startGameplay');
            const singleRanking=!!document.querySelector('#hud-1p .hud-rank-current');
            api.patch({numPlayers:2,currentPlayerName:'A very long player name with macrons: Māui',currentPlayer2Name:'Z'.repeat(120)});
            api.call('startGameplay');
            return {first,translated,replay,singleRanking,
                rankRows:document.querySelectorAll('#hud-2p [data-rank-row],#hud-2p [data-ranking-label]').length,
                images:document.querySelectorAll('#hud-2p img').length,
                unchanged:localStorage.getItem('game_leaderboard_normal')===stored};
        });
        assert.deepEqual(result.first,[
            {name:'Māui',title:'Māui',children:1,parent:'hud-p2'},
            {name:'<img src=x onerror=alert(1)>',title:'<img src=x onerror=alert(1)>',children:1,parent:'hud-p1'}
        ]);
        assert.deepEqual(result.translated,result.first);
        assert.deepEqual(result.replay.map(row=>row.name),['Aroha','Aroha']);
        assert.equal(result.singleRanking,true);assert.equal(result.rankRows,0);
        assert.equal(result.images,0);assert.equal(result.unchanged,true);
        for(const width of [1920,844,390,320]) {
            await page.setViewportSize({width,height:854});
            await page.evaluate(()=>window.__settleResize());
            const tiles=await page.evaluate(()=>[...document.querySelectorAll('#hud-2p .hud-name-tile')].map(tile=>{
                const name=tile.querySelector('.hud-player-name');
                const t=tile.getBoundingClientRect(),n=name.getBoundingClientRect();
                return {fits:n.left>=t.left&&n.right<=t.right&&n.top>=t.top&&n.bottom<=t.bottom,
                    height:t.height,nameHeight:n.height,font:parseFloat(getComputedStyle(name).fontSize),title:name.title};
            }));
            assert.ok(tiles.every(tile=>tile.fits&&tile.height===132&&tile.nameHeight<=84&&tile.font>=36&&tile.title.length>30),
                `long names remain large, bounded and available in title text at ${width}px`);
        }
        assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('live ranking updates neighbors, handles empty boards, localizes and renders names safely without saving',async()=>{
    const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1',
        game_leaderboard_normal:JSON.stringify([{name:'Mere',score:100},{name:'Māui',score:50},{name:'Hemi',score:20}])}});
    try {
        const result=await page.evaluate(()=>{
            const api=window.__gameTest;api.patch({currentPlayerName:'Aroha'});api.call('startGameplay');
            const tile=document.getElementById('hud-ranking-1p');
            const rows=()=>[...tile.querySelectorAll('[data-rank-row]')].filter(row=>!row.hidden).map(row=>[...row.children].map(el=>el.textContent));
            const stored=localStorage.getItem('game_leaderboard_normal');
            api.patch({score:40});api.call('updateHUD');const middle=rows();
            api.patch({score:60});api.call('updateHUD');const overtaken=rows();
            api.patch({score:101});api.call('updateHUD');const first=rows();
            const firstHighlight=tile.querySelector('.hud-rank-current').dataset.rankRow;
            api.patch({score:0});api.call('updateHUD');const last=rows();
            const lastHighlight=tile.querySelector('.hud-rank-current').dataset.rankRow;
            const unchanged=localStorage.getItem('game_leaderboard_normal')===stored;
            api.patch({score:101,speedMultiplier:0.7,currentPlayerName:'<img src=x onerror=alert(1)>'});api.call('updateHUD');
            const empty=rows();const images=tile.querySelectorAll('img').length;
            api.call('setLoginLang','mi');
            return {middle,overtaken,first,last,firstHighlight,lastHighlight,unchanged,empty,images,title:tile.querySelector('[data-ranking-label]').textContent,
                translated:rows(),energy:!!document.querySelector('.gameplay-hud [data-energy-estimate]')};
        });
        assert.deepEqual(result.middle,[['#2','🥈 Māui','50'],['#3','🥉 Aroha','40'],['#4','Hemi','20']]);
        assert.deepEqual(result.overtaken,[['#1','🥇 Mere','100'],['#2','🥈 Aroha','60'],['#3','🥉 Māui','50']]);
        assert.deepEqual(result.first,[['#1','🥇 Aroha','101'],['#2','🥈 Mere','100'],['#3','🥉 Māui','50']]);
        assert.deepEqual(result.last,[['#2','🥈 Māui','50'],['#3','🥉 Hemi','20'],['#4','Aroha','0']]);
        assert.equal(result.firstHighlight,'0');assert.equal(result.lastHighlight,'2');
        assert.equal(result.unchanged,true);assert.equal(result.images,0);assert.equal(result.energy,false);
        assert.deepEqual(result.empty,[['#1','🥇 <img src=x onerror=alert(1)>','101']]);
        assert.equal(result.title,'Tūranga');assert.deepEqual(result.translated,result.empty);
        assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('live ranking keeps same-name historical and current rows separate and highlights only the current run',async()=>{
    const {context,page,errors}=await prepare(false,{stored:{leaderboard_data_version:'1',
        game_leaderboard_normal:JSON.stringify([{name:'tester',score:1000},{name:'another player',score:500}])}});
    try {
        const result=await page.evaluate(()=>{
            const api=window.__gameTest;
            api.patch({currentPlayerName:'tester'});api.call('startGameplay');
            const tile=document.getElementById('hud-ranking-1p');
            const rows=()=>[...tile.querySelectorAll('[data-rank-row]')].filter(row=>!row.hidden).map(row=>({
                text:[...row.children].map(el=>el.textContent),current:row.classList.contains('hud-rank-current')
            }));
            const stored=localStorage.getItem('game_leaderboard_normal');
            api.patch({score:200});api.call('updateHUD');const lower=rows();
            api.patch({score:1000});api.call('updateHUD');const tied=rows();
            api.patch({score:1001});api.call('updateHUD');const higher=rows();
            return {lower,tied,higher,unchanged:localStorage.getItem('game_leaderboard_normal')===stored};
        });
        assert.deepEqual(result.lower,[
            {text:['#1','🥇 tester','1000'],current:false},
            {text:['#2','🥈 another player','500'],current:false},
            {text:['#3','🥉 tester','200'],current:true}
        ]);
        assert.deepEqual(result.tied,[
            {text:['#1','🥇 tester','1000'],current:false},
            {text:['#2','🥈 tester','1000'],current:true},
            {text:['#3','🥉 another player','500'],current:false}
        ]);
        assert.deepEqual(result.higher,[
            {text:['#1','🥇 tester','1001'],current:true},
            {text:['#2','🥈 tester','1000'],current:false},
            {text:['#3','🥉 another player','500'],current:false}
        ]);
        assert.equal(result.unchanged,true);assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('energy remains available on game over, freezes after the run and resets in either mode',async()=>{
    for(const count of [1,2]) {
        const {context,page,errors}=await prepare(false);
        try {
            const result=await page.evaluate(count=>{
                const api=window.__gameTest;
                api.patch({numPlayers:count});api.call('startGameplay');
                // Advance only the energy clock: movement/scoring are irrelevant.
                for(let i=0;i<600;i++){window.__advancePoseTime(100);api.call('updateEnergy');}
                api.patch({score:99999,speed:100});api.call('updateHUD');
                const hud=api.energyTotals().map(value=>value.toFixed(1));
                api.call('gameOver');
                const final=Array.from({length:count},(_,i)=>document.getElementById(`final-p${i+1}-energy`).textContent);
                window.__advancePoseTime(60000);api.call('updateEnergy');api.call('updateHUD');
                const stopped=api.energyTotals().map(value=>value.toFixed(1));
                api.call('startGameplay');
                const reset=api.energyTotals().map(value=>value.toFixed(1));
                return {hud,final,stopped,reset};
            },count);
            assert.deepEqual(result.hud,Array(count).fill('1.6'));
            assert.deepEqual(result.final,result.hud);
            assert.deepEqual(result.stopped,result.hud);
            assert.deepEqual(result.reset,Array(count).fill('0.0'));
            assert.deepEqual(errors,[]);
        } finally {await context.close();}
    }
});

async function prepareFinishCamera(page, count) {
    await page.evaluate(async count=>{
        window.__flushTimers();
        document.getElementById('login-screen-wrap').style.display='none';
        document.getElementById('bg-intro').style.display='none';
        document.querySelectorAll('#center-screens > div').forEach(el=>el.classList.add('hidden'));
        window.__realCameraPlayback=true;
        const source=document.createElement('canvas');source.width=640;source.height=480;
        const ctx=source.getContext('2d');
        window.__paintFinishFrame=color=>{
            ctx.fillStyle=color;ctx.fillRect(0,0,320,480);
            ctx.fillStyle='red';ctx.fillRect(320,0,320,480);
            for(const x of [160,480]) {
                ctx.fillStyle='#fcd4b7';ctx.beginPath();ctx.arc(x,120,42,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='white';ctx.fillRect(x-50,180,100,220);
            }
            ctx.fillStyle='#808080';ctx.fillRect(20,420,40,20);
        };
        window.__paintFinishFrame('blue');
        const video=document.getElementById('webcam-video');
        const stream=source.captureStream(30);
        window.__finishTestStream=stream;
        video.srcObject=stream;video.muted=true;
        await video.play();
    },count);
    await page.waitForFunction(()=>document.getElementById('webcam-video').readyState>=2,null,{polling:50,timeout:5000});
    await page.evaluate(count=>{
        const pose=x=>{
            const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
            p[0]={x,y:0.25};p[2]={x:x-0.03,y:0.23};p[5]={x:x+0.03,y:0.23};
            p[11].x=x+0.1;p[12].x=x-0.1;
            p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
            p[15]={x:x+0.13,y:0.8};p[16]={x:x-0.13,y:0.8};return p;
        };
        const api=window.__gameTest;
        api.patch({numPlayers:count,currentPlayerName:'Aroha',currentPlayer2Name:'Tama',gameState:'calibrating'});
        const poses=count===1?[pose(0.5)]:[pose(0.75),pose(0.25)];
        for(let i=0;i<240;i++)api.call('onPoseResults',{landmarks:poses});
    },count);
}

test('single-player final photo is mirrored, branded, frozen beside results, responsive and cleared on replay',async()=>{
    const {context,page,errors}=await prepare(false);
    try {
        await prepareFinishCamera(page,1);
        const result=await page.evaluate(()=>{
            window.__setNow('2026-12-31T12:30:00.000Z'); // Local New Zealand date is already 1 January.
            const photo=document.getElementById('finish-photo-single-canvas');
            const ctx=photo.getContext('2d');
            const texts=[];const fill=ctx.fillText.bind(ctx);
            ctx.fillText=(text,...args)=>{texts.push(text);fill(text,...args);};
            const api=window.__gameTest;api.patch({score:123});api.call('gameOver');
            const pixel=x=>[...ctx.getImageData(x,300,1,1).data].slice(0,3);
            const exposed=[...ctx.getImageData(600,430,1,1).data].slice(0,3);
            const footer=[...ctx.getImageData(20,photo.height-10,1,1).data].slice(0,3);
            window.__frozenFinishPhoto=photo.toDataURL();
            window.__paintFinishFrame('lime');window.__finishTestStream.getVideoTracks()[0].requestFrame();
            return {left:pixel(20),right:pixel(620),exposed,footer,
                label:photo.getAttribute('aria-label'),texts,single:!document.getElementById('finish-photo-single').hidden,
                dialog:document.getElementById('finish-photo-dialog').open,
                results:!document.getElementById('game-over-screen').classList.contains('hidden'),
                height:photo.height,stored:Object.values(localStorage).some(value=>String(value).includes('data:image'))};
        });
        assert.deepEqual(result.left,[255,0,0]);assert.deepEqual(result.right,[0,0,255]);
        assert.ok(result.exposed.every(channel=>Math.abs(channel-160)<=1),'+0.7 EV raises sRGB mid-gray to about 160');
        assert.deepEqual(result.footer,[23,37,84],'branding is not exposed');
        await page.waitForFunction(()=>{
            const probe=document.createElement('canvas');probe.width=640;probe.height=480;
            const ctx=probe.getContext('2d');ctx.drawImage(document.getElementById('webcam-video'),0,0);
            const pixel=ctx.getImageData(20,300,1,1).data;return pixel[1]>180&&pixel[0]<50;
        },null,{polling:50,timeout:5000});
        assert.equal(await page.evaluate(()=>window.__frozenFinishPhoto===document.getElementById('finish-photo-single-canvas').toDataURL()),true);
        assert.match(result.label,/Active Runner.*Aroha.*123/);
        assert.match(result.label,/01\/01\/2027$/);assert.ok(result.texts.includes('01/01/2027'),'date is painted into the frozen image');
        assert.equal(result.single,true);assert.equal(result.dialog,false);assert.equal(result.results,true);
        assert.ok(result.height>480);assert.equal(result.stored,false);
        const desktop=await page.evaluate(()=>({photo:document.getElementById('finish-photo-single').getBoundingClientRect().toJSON(),
            modal:document.getElementById('game-over-screen').getBoundingClientRect().toJSON()}));
        assert.ok(desktop.photo.left>=desktop.modal.right+20,'photo sits outside and to the right of results');
        assert.equal(desktop.photo.width,504,'desktop photo is 40% wider than the former 360px frame');
        if(process.env.FINISH_PHOTO_QA_DIRECTORY) {
            fs.mkdirSync(process.env.FINISH_PHOTO_QA_DIRECTORY,{recursive:true});
            await page.screenshot({path:path.join(process.env.FINISH_PHOTO_QA_DIRECTORY,'single-desktop.png')});
        }
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(()=>window.__settleResize());
        const mobile=await page.evaluate(()=>{
            const photo=document.getElementById('finish-photo-single').getBoundingClientRect();
            const modal=document.getElementById('game-over-screen').getBoundingClientRect();
            const layout=document.getElementById('game-over-layout');
            return {stacked:photo.top>=modal.bottom,contained:photo.left>=0&&photo.right<=innerWidth,
                scrollable:layout.scrollHeight>layout.clientHeight};
        });
        assert.equal(mobile.stacked,true);assert.equal(mobile.contained,true);assert.equal(mobile.scrollable,true);
        await page.evaluate(()=>document.getElementById('restart-btn').click());
        const cleared=await page.evaluate(()=>({hidden:document.getElementById('finish-photo-single').hidden,
            width:document.getElementById('finish-photo-single-canvas').width,state:window.__gameTest.read().game.gameState}));
        assert.deepEqual(cleared,{hidden:true,width:0,state:'dashboard'});assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('dual-player final photo crowns the real winner, closes with cross or Escape, then reveals frozen results',async()=>{
    for(const scenario of [
        {lives:[0,3],scores:[80,60],winner:1},
        {lives:[3,0],scores:[60,80],winner:0},
        {lives:[0,0],scores:[20,30],winner:1},
        {lives:[0,0],scores:[30,30],winner:0},
        {lives:[0,3],scores:[80,60],winner:1,stale:true}
    ]) {
        const {context,page,errors}=await prepare(false);
        try {
            await prepareFinishCamera(page,2);
            const result=await page.evaluate(scenario=>{
                window.__setNow('2026-12-31T12:30:00.000Z');
                const canvas=document.getElementById('finish-photo-dual-canvas');const ctx=canvas.getContext('2d');
                const texts=[];const fill=ctx.fillText.bind(ctx);
                ctx.fillText=(text,...args)=>{texts.push(text);fill(text,...args);};
                const api=window.__gameTest;const players=api.read().game.players;
                players.forEach((player,i)=>{player.lives=scenario.lives[i];player.score=scenario.scores[i];});
                api.patch({players});
                if(scenario.stale)window.__advancePoseTime(501);
                api.call('gameOver');
                const gold=[0,0];
                for(let half=0;half<2;half++) {
                    const pixels=ctx.getImageData(half*320,10,320,145).data;
                    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]>140&&pixels[i+2]<90)gold[half]++;
                }
                const dialog=document.getElementById('finish-photo-dialog');const r=dialog.getBoundingClientRect();
                return {gold,exposed:[...ctx.getImageData(600,430,1,1).data].slice(0,3),
                    footer:[...ctx.getImageData(20,canvas.height-10,1,1).data].slice(0,3),
                    open:dialog.open,hidden:document.getElementById('game-over-screen').classList.contains('hidden'),
                    focused:document.activeElement.id,contained:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
                    almostFull:r.width>innerWidth*0.9&&r.height>innerHeight*0.9,
                    winner:document.getElementById('winner-name').textContent,label:canvas.getAttribute('aria-label'),texts};
            },scenario);
            if(scenario.stale)assert.equal(result.gold[scenario.winner],0,'stale head positions never crown the wrong location');
            else assert.ok(result.gold[scenario.winner]>200,'crown appears above winner’s mirrored head');
            assert.equal(result.gold[1-scenario.winner],0,'losing player has no crown');
            assert.ok(result.exposed.every(channel=>Math.abs(channel-160)<=1),'dual-player camera pixels receive +0.7 EV too');
            assert.deepEqual(result.footer,[23,37,84]);
            assert.equal(result.open,true);assert.equal(result.hidden,true);assert.equal(result.focused,'finish-photo-close');
            assert.equal(result.contained,true);assert.equal(result.almostFull,true);
            assert.equal(result.winner,scenario.winner===0?'Aroha':'Tama');
            assert.match(result.label,new RegExp(result.winner));
            assert.match(result.label,/01\/01\/2027$/);assert.ok(result.texts.includes('01/01/2027'));
            if(process.env.FINISH_PHOTO_QA_DIRECTORY&&scenario.winner===1&&scenario.lives[1]>0&&!scenario.stale) {
                fs.mkdirSync(process.env.FINISH_PHOTO_QA_DIRECTORY,{recursive:true});
                await page.screenshot({path:path.join(process.env.FINISH_PHOTO_QA_DIRECTORY,'dual-winner.png')});
            }
            if(scenario.winner===0)await page.keyboard.press('Escape');
            else await page.locator('#finish-photo-close').click();
            const closed=await page.evaluate(()=>({open:document.getElementById('finish-photo-dialog').open,
                visible:!document.getElementById('game-over-screen').classList.contains('hidden'),
                width:document.getElementById('finish-photo-dual-canvas').width,focus:document.activeElement.id,
                state:window.__gameTest.read().game.gameState}));
            assert.deepEqual(closed,{open:false,visible:true,width:0,focus:'restart-btn',state:'gameover'});
            await page.evaluate(()=>document.getElementById('btn-play-again').click());
            assert.equal(await page.evaluate(()=>document.getElementById('finish-photo-dialog').open),false);
            assert.deepEqual(errors,[]);
        }finally{await context.close();}
    }
});

test('missing camera at game over skips the photo and leaves normal results usable',async()=>{
    for(const count of [1,2]) {
        const {context,page,errors}=await prepare(false);
        try {
            const result=await page.evaluate(count=>{
                const api=window.__gameTest;api.patch({numPlayers:count});api.call('startGameplay');api.call('gameOver');
                return {single:document.getElementById('finish-photo-single').hidden,
                    dual:document.getElementById('finish-photo-dialog').open,
                    visible:!document.getElementById('game-over-screen').classList.contains('hidden')};
            },count);
            assert.deepEqual(result,{single:true,dual:false,visible:true});assert.deepEqual(errors,[]);
        }finally{await context.close();}
    }
});

test('real accepted gestures affect only their player energy and tracking pauses freeze both estimates',async()=>{
    const {context,page,errors}=await prepare(false);
    try {
        const result=await page.evaluate(()=>{
            const api=window.__gameTest;
            const pose=(x,fly=false)=>{
                const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                p[11].x=x+0.1;p[12].x=x-0.1;
                p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
                p[15]={x:x+0.12,y:fly?0.1:0.8};p[16]={x:x-0.12,y:fly?0.1:0.8};
                return p;
            };
            api.patch({numPlayers:2,gameState:'calibrating'});
            for(let i=0;i<240;i++)api.call('onPoseResults',{landmarks:[pose(0.75),pose(0.25)]});
            api.call('resetEnergy');
            for(let i=0;i<100;i++){
                window.__advancePoseTime(100-1000/60);
                api.call('onPoseResults',{landmarks:[pose(0.75,i%20===0),pose(0.25)]});
                api.call('updateEnergy');
            }
            api.call('updateHUD');
            const values=()=>api.energyTotals().map(value=>value.toFixed(1));
            const moving=values();const jumping=api.read().game.players[0].stats.jumps;
            api.call('onPoseResults',{landmarks:[]});api.call('updateHUD');
            const paused=values();
            for(let i=0;i<300;i++){window.__advancePoseTime(100);api.call('updateEnergy');}
            api.call('updateHUD');
            return {moving,jumping,paused,after:values(),isPaused:api.call('isGameplayPaused')};
        });
        assert.deepEqual(result.moving,['0.6','0.3']);
        assert.equal(result.jumping,5);
        assert.equal(result.isPaused,true);
        assert.deepEqual(result.after,result.paused);
        assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('gameplay labels stay below either HUD, stack, and reposition after resize or dismissal', async () => {
    for (const count of [1, 2]) {
        const { context, page, errors } = await prepare(false);
        try {
            // External Tailwind is stubbed in this suite. Give the active HUD
            // representative row geometry, then vary its height independently
            // of the viewport to reproduce labels overlapping taller HUD text.
            await page.addStyleTag({ content: `
                #hud-${count}p { position:absolute;left:24px;top:24px;width:calc(100% - 48px);box-sizing:border-box;overflow:hidden; }
                #hud-${count}p:not(.hidden) { display:flex;justify-content:space-between;gap:12px; }
                #hud-${count}p p { margin:0;font-size:14px;line-height:20px; }
            ` });
            await page.evaluate(count => {
                const api = window.__gameTest;
                window.__flushTimers();
                document.getElementById('login-screen-wrap').style.display = 'none';
                api.patch({ numPlayers: count });
                api.call('startGameplay');
            }, count);
            for (const viewport of [{ width:1280, height:800 }, { width:390, height:844 }, { width:844, height:390 }]) {
                await page.setViewportSize(viewport);
                await page.evaluate(count => {
                    const api = window.__gameTest;
                    document.getElementById(`hud-${count}p`).style.height = `${innerHeight < 500 ? 140 : 220}px`;
                    api.call('updateHUD');
                    api.call('refreshTrackingStatus', Array(count).fill('lost'));
                    api.call('showOrbNotify', 'Shield orb incoming!', 'rgb(6,182,212)');
                }, count);
                const geometry = await page.evaluate(count => {
                    const rect = id => {
                        const r = document.getElementById(id).getBoundingClientRect();
                        return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, height:r.height };
                    };
                    return { hud:rect(`hud-${count}p`), tracking:rect('player-tracking-notice'), orb:rect('orb-notify') };
                }, count);
                assert.ok(geometry.tracking.top >= geometry.hud.bottom + 12, 'tracking notice clears HUD text');
                assert.ok(geometry.orb.top >= geometry.tracking.bottom + 12, 'orb label clears the tracking notice');
                for (const label of [geometry.tracking, geometry.orb]) {
                    assert.ok(label.height > 0 && label.bottom <= viewport.height - 11, 'notice stays within available height');
                    assert.ok(label.left >= 0 && label.right <= viewport.width, 'notice stays within viewport width');
                }
                // Change the HUD height while labels are already on screen.
                const moved = await page.evaluate(count => {
                    const api = window.__gameTest;
                    const hud = document.getElementById(`hud-${count}p`);
                    hud.style.height = `${hud.getBoundingClientRect().height + 16}px`;
                    api.call('updateHUD');
                    return { hud:hud.getBoundingClientRect().bottom,
                        tracking:document.getElementById('player-tracking-notice').getBoundingClientRect().top };
                }, count);
                assert.ok(moved.tracking >= moved.hud + 12);
                const alone = await page.evaluate(() => {
                    window.__gameTest.call('clearTrackingStatus');
                    return document.getElementById('orb-notify').getBoundingClientRect().top;
                });
                assert.ok(Math.abs(alone - (moved.hud + 12)) < 1, 'dismissing tracking removes its reserved space');
            }
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
});

test('calibration displays a live full-frame mirrored video in both modes, including replay and re-entry', async () => {
    for (const count of [1, 2]) {
        const { context, page, errors } = await prepare(false);
        try {
            const waiting = await page.evaluate(count => {
                const api = window.__gameTest;
                window.__flushTimers();
                document.getElementById('login-screen-wrap').classList.add('hidden');
                api.patch({ numPlayers:count });
                document.getElementById('start-btn').click();
                return { state:api.read().game.gameState, waiting:!document.getElementById('calibration-camera-status').hidden };
            }, count);
            assert.deepEqual(waiting, { state:'pre-calibrating', waiting:true });
            await page.evaluate(async count => {
                // A real decoded video stream, generated locally with no webcam
                // permission or external model. Distinct halves detect cropping.
                const source = document.createElement('canvas');
                window.__realCameraPlayback = true;
                // Disable autoplay to ensure production startup calls play().
                document.getElementById('webcam-video').autoplay = false;
                source.width = count === 1 ? 640 : 1280;
                source.height = count === 1 ? 480 : 720;
                const ctx = source.getContext('2d');
                window.__paintCameraFrame = color => {
                    ctx.fillStyle = color; ctx.fillRect(0,0,source.width / 2,source.height);
                    ctx.fillStyle = 'blue'; ctx.fillRect(source.width / 2,0,source.width / 2,source.height);
                };
                window.__paintCameraFrame('red');
                const stream = source.captureStream(30);
                window.__cameraTestStream = stream;
                navigator.mediaDevices.getUserMedia = async () => stream;
                await window.__gameTest.call('initCameraSequence');
                document.getElementById('warning-screen').classList.add('hidden');
            }, count);
            await page.waitForFunction(() => {
                window.__advanceFrames(1);
                const canvas = document.getElementById('cam-calibration');
                const data = canvas.getContext('2d').getImageData(canvas.width / 4,canvas.height / 2,1,1).data;
                return data[0] > 180 && data[1] < 50;
            }, null, { polling:50, timeout:5000 });
            const preview = await page.evaluate(() => {
                const canvas = document.getElementById('cam-calibration');
                return { waiting:!document.getElementById('calibration-camera-status').hidden,
                    right:Array.from(canvas.getContext('2d').getImageData(canvas.width * 0.75,canvas.height / 2,1,1).data),
                    aspect:canvas.width / canvas.height,
                    mirror:getComputedStyle(canvas).transform,
                    singleHidden:document.getElementById('cam-single').classList.contains('hidden'),
                    splitHidden:document.getElementById('split-cam-container').style.display === 'none' };
            });
            assert.equal(preview.waiting, false);
            assert.equal(preview.aspect, count === 1 ? 4/3 : 16/9);
            assert.ok(preview.right[2] > 180 && preview.right[0] < 50, 'both halves of the camera remain visible');
            assert.equal(preview.mirror, 'matrix(-1, 0, 0, 1, 0, 0)');
            assert.equal(preview.singleHidden, true);
            assert.equal(preview.splitHidden, true);
            await page.evaluate(() => {
                window.__paintCameraFrame('lime');
                window.__cameraTestStream.getVideoTracks()[0].requestFrame();
                window.__flushTimers();
            });
            await page.waitForFunction(() => {
                window.__advanceFrames(1);
                const canvas = document.getElementById('cam-calibration');
                return canvas.getContext('2d').getImageData(canvas.width / 4,canvas.height / 2,1,1).data[1] > 180;
            }, null, { polling:50, timeout:5000 });
            // An inference exception must not stop the video or its next frame.
            await page.evaluate(() => {
                window.__visionDetectFailure = true;
                window.__paintCameraFrame('magenta');
                window.__cameraTestStream.getVideoTracks()[0].requestFrame();
            });
            await page.waitForFunction(() => {
                window.__advanceFrames(1);
                const canvas = document.getElementById('cam-calibration');
                const pixel = canvas.getContext('2d').getImageData(canvas.width / 4,canvas.height / 2,1,1).data;
                return pixel[0] > 180 && pixel[2] > 180 && pixel[1] < 50;
            }, null, { polling:50, timeout:5000 });
            const trackingFailure = await page.locator('#calibration-camera-status').textContent();
            assert.match(trackingFailure, /Camera is live, but body tracking is unavailable/);
            await page.evaluate(() => {
                window.__visionDetectFailure = false;
                window.__paintCameraFrame('lime');
                window.__cameraTestStream.getVideoTracks()[0].requestFrame();
            });
            await page.waitForFunction(() => {
                window.__advanceFrames(1);
                const canvas = document.getElementById('cam-calibration');
                return canvas.getContext('2d').getImageData(canvas.width / 4,canvas.height / 2,1,1).data[1] > 180 &&
                    document.getElementById('calibration-camera-status').hidden;
            }, null, { polling:50, timeout:5000 });
            // Calibration entry must explicitly resume an existing paused stream.
            const wasPaused = await page.evaluate(() => {
                const video = document.getElementById('webcam-video');
                video.pause();
                const paused = video.paused;
                document.getElementById('btn-calibration-back').click();
                document.getElementById('start-btn').click();
                return paused;
            });
            assert.equal(wasPaused, true);
            await page.waitForFunction(() => !document.getElementById('webcam-video').paused, null, { polling:50, timeout:5000 });
            for (const viewport of [{ width:1280,height:800 }, { width:390,height:844 }, { width:844,height:390 }]) {
                await page.setViewportSize(viewport);
                const fit = await page.evaluate(() => {
                    const card = document.getElementById('calibration-screen').getBoundingClientRect();
                    const canvas = document.getElementById('cam-calibration').getBoundingClientRect();
                    return { height:card.height, left:canvas.left >= card.left, right:canvas.right <= card.right,
                        imageFit:getComputedStyle(document.getElementById('cam-calibration')).objectFit };
                });
                assert.ok(fit.height <= viewport.height - 47, 'calibration remains accessible on short screens');
                assert.equal(fit.left && fit.right, true);
                assert.equal(fit.imageFit, 'contain', 'the full image is preserved without stretching');
            }
            const transitions = await page.evaluate(count => {
                const api = window.__gameTest;
                const visible = () => document.getElementById('calibration-screen').getBoundingClientRect().height > 0;
                document.getElementById('btn-calibration-back').click();
                const back = visible();
                document.getElementById('start-btn').click();
                const reenter = { visible:visible(), waiting:!document.getElementById('calibration-camera-status').hidden };
                api.call('startGameplay');
                const gameplay = { preview:visible(), single:!document.getElementById('cam-single').classList.contains('hidden'),
                    split:document.getElementById('split-cam-container').style.display === 'flex' };
                api.call('gameOver');
                document.getElementById('btn-play-again').click();
                const replay = { visible:visible(), waiting:!document.getElementById('calibration-camera-status').hidden };
                window.__cameraTestStream.getTracks().forEach(track => track.stop());
                return { back, reenter, gameplay, replay };
            }, count);
            assert.equal(transitions.back, false);
            assert.deepEqual(transitions.reenter, { visible:true, waiting:false });
            assert.deepEqual(transitions.gameplay, { preview:false, single:count === 1, split:count === 2 });
            assert.deepEqual(transitions.replay, { visible:true, waiting:false });
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
});

test('camera startup reports playback failure, retries the existing stream, and keeps one preview loop', async () => {
    const { context, page, errors } = await prepare(false);
    try {
        const result = await page.evaluate(async () => {
            const api = window.__gameTest;
            const video = document.getElementById('webcam-video');
            const normalPlay = video.play.bind(video);
            const before = window.__pendingFrameCount();
            video.play = () => Promise.reject(Error('Test playback rejected'));
            await api.call('initCameraSequence');
            const failed = { alert:window.__effects.find(effect => effect[0] === 'alert')?.[1],
                dashboard:!document.getElementById('dashboard-screen').classList.contains('hidden'),
                loops:window.__pendingFrameCount() - before };
            video.play = normalPlay;
            await api.call('initCameraSequence');
            const first = window.__pendingFrameCount() - before;
            await api.call('initCameraSequence');
            const second = window.__pendingFrameCount() - before;
            video.pause();
            document.getElementById('start-btn').click();
            await Promise.resolve();
            const resumed = !video.paused;
            return { failed, first, second, resumed, afterReentry:window.__pendingFrameCount() - before,
                acquisitions:window.__effects.filter(effect => effect[0] === 'camera').length };
        });
        assert.match(result.failed.alert, /Camera video could not start/);
        assert.equal(result.failed.dashboard, true);
        assert.equal(result.failed.loops, 0);
        assert.equal(result.first, 1);
        assert.equal(result.second, 1);
        assert.equal(result.afterReentry, 1);
        assert.equal(result.acquisitions, 1);
        assert.equal(result.resumed, true);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('position-first calibration tolerates hands and brief glitches, resets prolonged bad input and finalizes fresh locks in both modes', async () => {
    for (const count of [1,2]) {
        const { context, page, errors } = await prepare(false);
        try {
            const result = await page.evaluate(count => {
                const api = window.__gameTest;
                const lang = count === 1 ? 'en' : 'mi';
                api.call('setLoginLang', lang);
                api.patch({ numPlayers:count });
                document.getElementById('login-screen-wrap').classList.add('hidden');
                document.getElementById('start-btn').click();
                window.__flushTimers();
                const pose = x => {
                    const points = Array.from({ length:33 }, () => ({ x,y:0.4,visibility:1,presence:1 }));
                    points[11].x = x + 0.1; points[12].x = x - 0.1;
                    points[23] = { x:x + 0.07,y:0.7 }; points[24] = { x:x - 0.07,y:0.7 };
                    points[15] = { x:x + 0.15,y:0.8 }; points[16] = { x:x - 0.15,y:0.8 };
                    return points;
                };
                const good = count === 1 ? [pose(0.5)] : [pose(0.75),pose(0.25)];
                const bad = count === 1 ? [pose(0.15)] : [pose(0.54),pose(0.46)];
                const feed = (poses,n) => { for (let i = 0; i < n; i++) api.call('onPoseResults',{ landmarks:poses }); };
                const snapshot = () => ({ state:api.read().game.gameState, statuses:api.call('trackingStatuses'),
                    progress:parseFloat(document.getElementById('calibration-bar').style.width),
                    title:document.getElementById('txt-stand-still').textContent,
                    message:document.getElementById('txt-learning').textContent,
                    baselines:api.read().game.players.slice(0,count).map(player => player.baseline) });
                feed(bad,150);
                const waiting = snapshot();
                for (const person of good) {
                    person[15] = {x:0.5,y:0.35,visibility:0.1};
                    person[16] = {x:0.45,y:0.4,presence:0.1};
                }
                feed(good,20);
                const sampling = snapshot();
                const interrupted = good.map(p => p.map(point => ({ ...point })));
                interrupted[0][11].visibility = 0.1;
                feed(interrupted,1);
                const paused = snapshot();
                feed(interrupted,30);
                const reset = snapshot();
                feed(good,20);
                const retry = snapshot();
                feed(good,160);
                const complete = snapshot();
                return { waiting,sampling,paused,reset,retry,complete };
            }, count);
            for (const state of [result.waiting,result.sampling,result.paused,result.reset,result.retry]) {
                assert.equal(state.state,'calibrating');
                assert.deepEqual(state.statuses,Array(count).fill('unregistered'),'no provisional permanent identities');
                assert.deepEqual(state.baselines,Array(count).fill(0),'no partial neutral baseline');
                assert.ok(state.title && state.message,'phase-specific guidance in selected language');
            }
            assert.equal(result.waiting.progress,0);
            assert.ok(result.sampling.progress > 0 && result.sampling.progress < 100);
            assert.ok(result.paused.progress >= result.sampling.progress,'brief glitches preserve samples');
            assert.equal(result.paused.title,result.sampling.title,'readable guidance does not flash on a noisy frame');
            assert.equal(result.reset.progress,count === 1 ? 0 : 50,'only the affected player loses progress');
            assert.ok(result.retry.progress > result.reset.progress && result.retry.progress < 100);
            assert.equal(result.complete.state,'playing');
            assert.deepEqual(result.complete.statuses,Array(count).fill('tracked'));
            assert.equal(result.complete.progress,100);
            for (const baseline of result.complete.baselines) assert.ok(Math.abs(baseline - 0.4) < 1e-9);
            assert.deepEqual(errors,[]);
        } finally { await context.close(); }
    }
});

test('calibration guidance holds 1.5 seconds while brief invalid input pauses, prolonged loss resets and locks require fresh valid input',async()=>{
    for(const count of [1,2]) {
        const {context,page,errors}=await prepare(false);
        try {
            const result=await page.evaluate(count=>{
                const api=window.__gameTest;
                api.call('setLoginLang',count===1?'en':'mi');api.patch({numPlayers:count});
                document.getElementById('start-btn').click();
                const changes=[];
                const record=()=>{
                    const title=document.getElementById('txt-stand-still').textContent;
                    const text=document.getElementById('txt-learning').textContent;
                    const last=changes.at(-1);
                    if(!last||last.title!==title||last.text!==text)changes.push({at:performance.now(),title,text});
                };
                record();window.__advancePoseTime(1500);window.__flushTimers();
                const pose=x=>{
                    const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                    p[11].x=x+0.1;p[12].x=x-0.1;p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
                    p[15]={x:x+0.15,y:0.8};p[16]={x:x-0.15,y:0.8};return p;
                };
                const good=count===1?[pose(0.5)]:[pose(0.75),pose(0.25)];
                const feed=(poses,n)=>{for(let i=0;i<n;i++){
                    window.__advancePoseTime(50-1000/60);api.call('onPoseResults',{landmarks:poses});record();
                }};
                feed(good,21);
                const before={state:api.read().game.gameState,statuses:api.call('trackingStatuses'),
                    progress:document.getElementById('calibration-bar').style.width};
                const held=changes.at(-1).text;
                feed([],1);
                const interrupted={progress:document.getElementById('calibration-bar').style.width,
                    text:document.getElementById('txt-learning').textContent,statuses:api.call('trackingStatuses')};
                feed([],10);
                const cleared=document.getElementById('calibration-bar').style.width;
                for(let i=0;i<160&&api.read().game.gameState!=='playing';i++)feed(good,1);
                const finishAt=performance.now();const after=api.read().game.gameState;
                api.call('gameOver');document.getElementById('btn-play-again').click();
                return {changes,before,interrupted,cleared,held,finishAt,after,reentry:document.getElementById('txt-learning').textContent};
            },count);
            assert.equal(result.before.state,'calibrating');assert.equal(result.before.progress,'100%');
            assert.deepEqual(result.before.statuses,Array(count).fill('unregistered'),'valid sampling waits for final text reading time');
            assert.equal(result.interrupted.progress,'100%');assert.equal(result.interrupted.text,result.held);
            assert.equal(result.cleared,'0%');
            assert.deepEqual(result.interrupted.statuses,Array(count).fill('unregistered'),'unsafe input cannot finalize while text is held');
            for(let i=1;i<result.changes.length;i++)assert.ok(result.changes[i].at-result.changes[i-1].at>=1500-1e-6,'each changed instruction gets its reading window');
            assert.equal(result.after,'playing');assert.ok(result.finishAt-result.changes.at(-1).at>=1500-1e-6);
            assert.equal(result.reentry,count===1?'Get ready…':'Kia rite…');assert.deepEqual(errors,[]);
        }finally{await context.close();}
    }
});

test('a missing locked player freezes simulation and audio even when a bystander remains in both modes', async () => {
    for (const count of [1,2]) {
        const {context,page,errors} = await prepare(false);
        try {
            const result = await page.evaluate(count => {
                const api = window.__gameTest;
                const pose = (x,size=1) => {
                    const p = Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                    p[11].x=x+0.1*size;p[12].x=x-0.1*size;
                    p[23]={x:x+0.07*size,y:0.4+0.3*size};p[24]={x:x-0.07*size,y:0.4+0.3*size};
                    p[15]={x:x+0.23*size,y:0.8};p[16]={x:x-0.23*size,y:0.8};return p;
                };
                const good = count === 1 ? [pose(0.5)] : [pose(0.75),pose(0.25)];
                const feed=(poses,n)=>{for(let i=0;i<n;i++) api.call('onPoseResults',{landmarks:poses});};
                api.patch({numPlayers:count,gameState:'calibrating'});feed(good,240);
                const players=api.read().game.players;
                players[0].shieldActive=true;players[0].shieldTimer=120;
                api.patch({players, obstacles:[{lane:0,span:1,depth:0.8,type:'block',active:true}],levelUpTimer:60});
                feed(count === 1 ? [pose(0.05,0.4)] : [good[1],pose(0.05,0.4)],1);
                const before=api.read().game;
                window.__advanceFrames(120);api.call('advanceFrame');
                const after=api.read().game;
                const frozen=JSON.stringify({...before,gameLoopId:0})===JSON.stringify({...after,gameLoopId:0});
                const warning=document.getElementById('player-tracking-message').textContent;
                const paused=api.call('isGameplayPaused');
                const musicPaused=document.getElementById('bg-music').paused;
                feed([...good,pose(0.05,0.4)],60);
                window.__advanceFrames(1);
                return {frozen,warning,paused,musicPaused,resumed:!api.call('isGameplayPaused'),
                    advanced:api.read().game.frameCount>before.frameCount,musicResumed:!document.getElementById('bg-music').paused};
            },count);
            assert.equal(result.frozen,true); assert.equal(result.paused,true); assert.equal(result.musicPaused,true);
            assert.match(result.warning,/Player 1 lost/);
            assert.equal(result.resumed,true);assert.equal(result.advanced,true);assert.equal(result.musicResumed,true);
            assert.deepEqual(errors,[]);
        } finally {await context.close();}
    }
});

test('debug mode records detections, matching, pauses and issue marks, and saves a readable human-test file', async () => {
    const {context,page,errors} = await prepare(false,{debug:true});
    try {
        const result = await page.evaluate(async () => {
            const api=window.__gameTest;
            const pose=x=>{
                const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                p[11].x=x+0.1;p[12].x=x-0.1;p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
                p[15]={x:x+0.23,y:0.8};p[16]={x:x-0.23,y:0.8};return p;
            };
            const feed=(poses,n)=>{for(let i=0;i<n;i++)api.call('onPoseResults',{landmarks:poses});};
            api.patch({gameState:'calibrating'});feed([pose(0.5)],240);
            feed([pose(0.5),pose(0.1)],1);
            const ignored=api.call('trackingReport').ignored;
            feed([pose(0.1)],1);
            document.getElementById('debug-note').value='Player left; bystander stayed';
            document.getElementById('debug-mark').click();
            feed([pose(0.5),pose(0.1)],60);
            await api.call('finishDebugLog');
            return {data:api.call('debugSnapshot'),status:api.call('status'),
                browserCopy:JSON.parse(localStorage.getItem('active_runner_debug_last_session')),
                visible:!document.getElementById('debug-panel').hidden,ignored};
        });
        assert.equal(result.visible,true);assert.equal(result.status.recording,false);
        assert.deepEqual(result.ignored,[1]);
        assert.match(result.status.saveState,/^Saved: debug-logs\//);
        const file=path.join(debugDirectory,`${result.data.sessionId}.json`);
        const saved=JSON.parse(fs.readFileSync(file,'utf8'));
        assert.deepEqual(saved,result.data);assert.deepEqual(result.browserCopy,result.data);
        assert.match(saved.buildId,/^[a-f0-9]{16}$/);
        for(const type of ['debug.start','calibration.begin','calibration.status','game.start','detection.count','pose.observation','tracking.frame','tracking.status','game.pause','game.resume','human.mark','human.finish']) {
            assert.ok(saved.events.some(event=>event.type===type),type);
        }
        const mark=saved.events.find(event=>event.type==='human.mark');
        assert.match(mark.data.note,/Player left/);assert.equal(mark.data.observed.paused,true);
        assert.equal(saved.latest.paused,false);
        const downloaded = page.waitForEvent('download');
        await page.locator('#debug-download').click();
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), `active-runner-debug-${saved.sessionId}.json`);
        assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), 'utf8')), saved);
        assert.deepEqual(errors,[]);
    } finally {await context.close();}
});

test('normal mode hides diagnostics and creates no debug storage or events',async()=>{
    const {context,page,errors}=await prepare(false);
    try {
        const result=await page.evaluate(async()=>{
            const api=window.__gameTest;api.call('record','test',{note:'disabled'});await api.call('flushDebugLog');
            return {hidden:document.getElementById('debug-panel').hidden,events:api.call('debugSnapshot').events,
                stored:localStorage.getItem('active_runner_debug_last_session')};
        });
        assert.deepEqual(result,{hidden:true,events:[],stored:null});assert.deepEqual(errors,[]);
    }finally{await context.close();}
});

test('locked players automatically recover after ambiguity or long loss without restarting either mode', async () => {
    for (const count of [1,2]) {
        for (const cause of ['ambiguity','absence']) {
            const {context,page,errors}=await prepare(false);
            try {
                const result=await page.evaluate(({count,cause})=>{
                    const api=window.__gameTest;
                    const pose=(x,raised=false,size=1)=>{
                        const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                        p[11].x=x+0.1*size;p[12].x=x-0.1*size;
                        p[23]={x:x+0.07*size,y:0.4+0.3*size};p[24]={x:x-0.07*size,y:0.4+0.3*size};
                        p[15]={x:x+0.23*size,y:raised ? 0.4 : 0.8};p[16]={x:x-0.23*size,y:0.8};return p;
                    };
                    const positions=count===1 ? [0.5] : [0.75,0.25];
                    const neutral=positions.map(x=>pose(x));
                    const feed=(poses,n)=>{for(let i=0;i<n;i++)api.call('onPoseResults',{landmarks:poses});};
                    api.patch({numPlayers:count,gameState:'calibrating'});feed(neutral,240);
                    const before=api.read().game;
                    const profiles=api.call('trackingReport').tracks.map(track=>track.profile);
                    feed(cause==='ambiguity' ? [...neutral,pose(positions[0]+0.02)] : [],150);
                    const paused=api.call('isGameplayPaused');
                    const returned=[pose(0.05,true,0.4),...positions.map(x=>pose(x,true))];
                    feed(returned,65);
                    const confirming=api.call('isGameplayPaused');
                    const frozenScore=api.read().game.score;
                    feed(returned,35);
                    const resumed=!api.call('isGameplayPaused');
                    const heldLanes=api.read().game.players.slice(0,count).map(player=>player.lane);
                    window.__advanceFrames(1);
                    const after=api.read().game;
                    return {paused,confirming,frozenScore,beforeScore:before.score,resumed,heldLanes,
                        advanced:after.score>before.score,sameBaselines:after.players.slice(0,count).every((player,i)=>player.baseline===before.players[i].baseline),
                        profilesUnchanged:JSON.stringify(profiles)===JSON.stringify(api.call('trackingReport').tracks.map(track=>track.profile)),
                        noticeHidden:document.getElementById('player-tracking-notice').hidden,
                        state:after.gameState,ignored:api.call('trackingReport').ignored};
                },{count,cause});
                assert.equal(result.paused,true);assert.equal(result.confirming,true);
                assert.equal(result.frozenScore,result.beforeScore);
                assert.equal(result.resumed,true);assert.equal(result.advanced,true);
                assert.deepEqual(result.heldLanes,Array(count).fill(0),'held arms do not replay input on recovery');
                assert.equal(result.sameBaselines,true);assert.equal(result.profilesUnchanged,true);
                assert.equal(result.noticeHidden,true);assert.equal(result.state,'playing');
                assert.deepEqual(result.ignored,[0]);assert.deepEqual(errors,[]);
            } finally {await context.close();}
        }
    }
});

test('fly and duck transitions accept the first fresh lane raise in both modes and log active action gates', async () => {
    for (const count of [1,2]) {
        const {context,page,errors}=await prepare(false,{debug:true});
        try {
            const result=await page.evaluate(async count=>{
                const api=window.__gameTest;
                const positions=count===1 ? [0.5] : [0.75,0.25];
                const pose=(x,left=-80,right=-80,offset=0)=>{
                    const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                    p[11].x=x+0.1;p[12].x=x-0.1;p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
                    for(const [shoulder,wrist,angle,direction] of [[11,15,left,1],[12,16,right,-1]]) {
                        const radians=angle*Math.PI/180;
                        p[wrist]={x:p[shoulder].x+direction*Math.cos(radians)*140/640,
                            y:p[shoulder].y-Math.sin(radians)*140/480,visibility:1,presence:1};
                        const elbow=wrist===15 ? 13 : 14;
                        p[elbow]={x:(p[shoulder].x+p[wrist].x)/2,y:(p[shoulder].y+p[wrist].y)/2,visibility:1,presence:1};
                    }
                    return p.map(point=>({...point,y:point.y+offset}));
                };
                const feed=(left,right,n,offset=0)=>{
                    for(let i=0;i<n;i++) {
                        window.__advancePoseTime(1000/20-1000/60);
                        api.call('onPoseResults',{landmarks:positions.map(x=>pose(x,left,right,offset))});
                    }
                };
                api.patch({numPlayers:count,gameState:'calibrating'});feed(-80,-80,80);
                const checkpoints=[];
                for(const action of ['fly','duck','crouch']) {
                    if(action==='fly') {feed(60,60,8);feed(0,0,1);}
                    else if(action==='duck') feed(0,0,8);
                    else feed(-80,-80,8,0.12);
                    feed(-80,-80,6);
                    const left=action!=='duck';
                    feed(left ? 0 : -80,left ? -80 : 0,4);
                    const moved=api.read().game.players.slice(0,count).map(player=>player.lane);
                    feed(left ? 0 : -80,left ? -80 : 0,20);
                    const held=api.read().game.players.slice(0,count).map(player=>player.lane);
                    checkpoints.push({moved,held,paused:api.call('isGameplayPaused')});
                }
                await api.call('finishDebugLog');
                return {checkpoints,gates:api.call('debugSnapshot').events.filter(event=>event.type==='input.lane_gate').map(event=>event.data.blockedBy)};
            },count);
            assert.deepEqual(result.checkpoints,[-1,0,-1].map(lane=>({moved:Array(count).fill(lane),held:Array(count).fill(lane),paused:false})));
            for(const reason of ['fly','duck',null]) assert.ok(result.gates.includes(reason),`logged ${reason} gate`);
            assert.deepEqual(errors,[]);
        } finally {await context.close();}
    }
});

test('level arms or crouching duck while chest hands stay neutral in both modes',async()=>{
    for(const count of [1,2]) {
        const {context,page,errors}=await prepare(false,{debug:true});
        try {
            const result=await page.evaluate(async count=>{
                const api=window.__gameTest;
                const centers=count===1 ? [0.5] : [0.75,0.25];
                const pose=(x,mode)=>{
                    const p=Array.from({length:33},()=>({x,y:0.4,visibility:1,presence:1}));
                    p[11].x=x+0.1;p[12].x=x-0.1;p[23]={x:x+0.07,y:0.7};p[24]={x:x-0.07,y:0.7};
                    const level=['level','folded'].includes(mode),fly=mode==='fly';
                    p[15]={x:x+(level ? 0.24 : 0.13),y:level ? 0.4 : fly ? 0.1 : 0.8};
                    p[16]={x:x-(level ? 0.24 : 0.13),y:p[15].y};
                    for(const [s,e,w] of [[11,13,15],[12,14,16]]) p[e]={x:(p[s].x+p[w].x)/2,y:(p[s].y+p[w].y)/2};
                    if(mode==='chest') {
                        p[15]={x:x+0.04,y:0.48};p[16]={x:x-0.04,y:0.48};
                        p[13]={x:x+0.15,y:0.55};p[14]={x:x-0.15,y:0.55};
                    }
                    if(mode==='folded') {p[13].y+=0.15;p[14].y+=0.15;}
                    return mode==='crouch' ? p.map(point=>({...point,y:point.y+0.12})) : p;
                };
                const feed=(mode,n)=>{for(let i=0;i<n;i++)api.call('onPoseResults',{landmarks:centers.map(x=>pose(x,mode))});};
                api.patch({numPlayers:count,gameState:'calibrating'});feed('neutral',240);
                const checkpoints=[];
                for(const mode of ['chest','folded','crouch','neutral','level','level','chest','fly']) {
                    feed(mode,20);
                    checkpoints.push(api.read().game.players.slice(0,count).map(p=>({duck:p.isSquatting,fly:p.isJumping,squats:p.stats.squats,lane:p.lane})));
                }
                await api.call('finishDebugLog');
                const sample=api.call('debugSnapshot').events.find(event=>event.type==='pose.observation');
                const duckSources=api.call('debugSnapshot').events.filter(event=>event.type==='input.squat').map(event=>event.data.source);
                return {checkpoints,duckSources,ids:sample.data.poses[0].map(point=>point.id),paused:api.call('isGameplayPaused')};
            },count);
            const expected=[false,false,true,false,true,true,false,false].map((duck,index)=>Array.from({length:count},()=>({duck,fly:index===7,squats:index>=4 ? 2 : index>=2 ? 1 : 0,lane:0})));
            assert.deepEqual(result.checkpoints,expected);
            assert.ok(result.duckSources.includes('crouch')&&result.duckSources.includes('level_arms'));
            assert.ok(result.ids.includes(13)&&result.ids.includes(14),'debug logs retain elbow evidence');
            assert.equal(result.paused,false);assert.deepEqual(errors,[]);
        } finally {await context.close();}
    }
});
