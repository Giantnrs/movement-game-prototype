const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { root, versionStylesheet } = require('../scripts/build.cjs');
const { assetPaths, checkAssets } = require('../scripts/assets.cjs');
const { createServer } = require('../scripts/serve.cjs');

test('stylesheet cache version changes with CSS and remains stable for unchanged builds', () => {
    const html = '<link rel="stylesheet" href="styles/game.css">';
    const first = versionStylesheet(html, '.hud-ranking { justify-content:center; }');
    const next = versionStylesheet(first, '.hud-ranking { justify-content:flex-start; }');
    assert.notEqual(first, next);
    assert.match(next, /href="styles\/game\.css\?v=[a-f\d]{12}"/);
    assert.equal(versionStylesheet(next, '.hud-ranking { justify-content:flex-start; }'), next);
});

test('relocated media is byte-for-byte identical to the original assets', () => {
    for (const [old, current] of Object.entries(assetPaths)) {
        const expected = execFileSync('git', ['rev-parse', `6778c34:${old}`], { cwd: root, encoding: 'utf8' }).trim();
        const actual = execFileSync('git', ['hash-object', '--', current], { cwd: root, encoding: 'utf8' }).trim();
        assert.equal(actual, expected, current);
    }
    checkAssets();
});

test('relocated assets and the CSS background load over HTTP, with media byte ranges', async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const mime = { '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg' };
    try {
        for (const current of Object.values(assetPaths)) {
            const bytes = fs.readFileSync(path.join(root, current));
            const response = await fetch(`${origin}/${current}`, { headers: { Range: 'bytes=0-31' } });
            assert.equal(response.status, 206, current);
            assert.equal(response.headers.get('content-type'), mime[path.extname(current)], current);
            assert.equal(response.headers.get('content-range'), `bytes 0-31/${bytes.length}`, current);
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(0, 32), current);
        }
        const css = await fetch(`${origin}/styles/game.css`);
        const reference = (await css.text()).match(/url\('([^']+)'\)/)[1];
        const background = await fetch(new URL(reference, css.url));
        assert.equal(background.status, 200);
        assert.deepEqual(Buffer.from(await background.arrayBuffer()), fs.readFileSync(path.join(root, assetPaths['background.png'])));
        const video = assetPaths['left.mp4'];
        const length = fs.statSync(path.join(root, video)).size;
        const invalid = await fetch(`${origin}/${video}`, { headers: { Range: `bytes=${length}-` } });
        assert.equal(invalid.status, 416);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
