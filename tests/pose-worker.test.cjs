const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { root } = require('../scripts/build.cjs');
const source = fs.readFileSync(path.join(root, 'src/input/pose-inference.js'), 'utf8');

function client() {
    const workers = [], timers = new Map(); let next = 0;
    class Worker {
        constructor() { workers.push(this); this.messages = []; }
        postMessage(data, transfers) { this.messages.push({ data, transfers }); }
        terminate() { this.terminated = true; }
        reply(data) { this.onmessage({ data }); }
    }
    const factory = vm.runInNewContext(source + '\ncreatePoseInference', {
        Worker, Blob: class {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); }
    });
    const app = { debug: { record() {} } };
    const inference = factory({ app });
    return { workers, timers, inference };
}

test('worker client deduplicates initialization, transfers frames, ignores unrelated IDs and recovers from inference errors', async () => {
    const f = client();
    const init = f.inference.initializePoseInference();
    assert.equal(f.inference.initializePoseInference(), init);
    let w = f.workers[0];
    w.reply({ id: w.messages[0].data.id, type: 'ready', delegate: 'GPU' }); await init;
    let closed = 0;
    const bitmap = { close() { closed++; } };
    let result = f.inference.inferPose(bitmap, 100); await Promise.resolve();
    let message = w.messages.at(-1);
    assert.equal(message.transfers[0], bitmap);
    w.reply({ id: 999, type: 'result', landmarks: ['wrong'] });
    w.reply({ id: message.data.id, type: 'error', message: 'recoverable inference failure' });
    await assert.rejects(result, /recoverable/);
    result = f.inference.inferPose(bitmap, 120); await Promise.resolve();
    message = w.messages.at(-1);
    w.reply({ id: message.data.id, type: 'result', landmarks: ['fresh'] });
    assert.equal((await result).landmarks[0], 'fresh');
    assert.equal(f.timers.size, 0);
});

test('worker crash and request timeout release resources and allow a new worker', async () => {
    for (const crash of [true, false]) {
        const f = client();
        let init = f.inference.initializePoseInference();
        const old = f.workers[0];
        if (crash) old.onerror({ message: 'worker crash', preventDefault() {} });
        else [...f.timers.values()][0]();
        await assert.rejects(init, /worker crash|timed out/);
        assert.equal(old.terminated, true);
        init = f.inference.initializePoseInference();
        const fresh = f.workers[1];
        fresh.reply({ id: fresh.messages[0].data.id, type: 'ready', delegate: 'CPU' }); await init;
        assert.equal(f.timers.size, 0);
    }
});

test('real worker imports the pinned runtime, transfers decoded frames, and leaves UI timers responsive during blocking inference', async () => {
    const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    try {
        for (const fallback of [false, true, 'no-canvas']) {
            const page = await browser.newPage();
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            // Only the external ML engine is doubled. The actual worker bootstrap,
            // OffscreenCanvas, ImageBitmap transfer and message protocol run in Chrome.
            const module = `
                export const FilesetResolver = {forVisionTasks: async url => {
                    if (!url.includes('@0.10.3/wasm')) throw Error('version changed'); return {};
                }};
                export const PoseLandmarker = {createFromOptions: async (_, options) => {
                    if (options.numPoses !== 4 || options.runningMode !== 'VIDEO' || !options.baseOptions.modelAssetPath.includes('pose_landmarker_lite')) throw Error('options changed');
                    if (options.baseOptions.delegate === 'GPU') {
                        if (!(options.canvas instanceof OffscreenCanvas)) throw Error('missing worker canvas');
                        if (${fallback === true}) throw Error('GPU unavailable');
                    }
                    return {detectForVideo(bitmap, timestamp) {
                        const until = performance.now() + 400;
                        while (performance.now() < until) {}
                        return {landmarks: [[{x: bitmap.width, y: bitmap.height, z: timestamp}]]};
                    }};
                }};`;
            const url = `data:text/javascript;base64,${Buffer.from(module).toString('base64')}`;
            const instrumented = source.replace(/https:\/\/(?:cdn.jsdelivr.net|cdn.skypack.dev)[^"]+(?=")/g, url);
            const workerSource = fallback === 'no-canvas' ? instrumented.replace('function poseWorkerRuntime() {', 'function poseWorkerRuntime() { const OffscreenCanvas = undefined;') : instrumented;
            await page.addScriptTag({ content: workerSource + `\nwindow.events = []; window.inference = createPoseInference({app:{debug:{record:(...args)=>events.push(args)}}});` });
            const result = await page.evaluate(async () => {
                await inference.initializePoseInference();
                const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
                const bitmap = await createImageBitmap(canvas);
                let completed = false, ticks = 0;
                const timer = setInterval(() => ticks++, 10);
                const promise = inference.inferPose(bitmap, 123).then(result => { completed = true; return result; });
                await new Promise(resolve => setTimeout(resolve, 150));
                const early = { completed, ticks };
                const response = await promise;
                clearInterval(timer);
                return { early, response, transferred: bitmap.width === 0, delegate: events[0][1].delegate };
            });
            assert.equal(result.early.completed, false, 'inference is still busy');
            assert.ok(result.early.ticks >= 5, 'main-thread timers keep firing during inference');
            assert.equal(result.transferred, true);
            assert.equal(result.delegate, fallback ? 'CPU' : 'GPU');
            assert.deepEqual(result.response.landmarks, [[{ x: 640, y: 480, z: 123 }]]);
            assert.ok(result.response.inferenceMs >= 390);
            assert.deepEqual(errors, []);
            await page.close();
        }
    } finally { await browser.close(); }
});
