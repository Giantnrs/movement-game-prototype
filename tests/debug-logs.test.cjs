const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { createServer } = require('../scripts/serve.cjs');

async function fixture(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-logs-'));
    const server = createServer(undefined, { debugDirectory: directory });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const data = { schemaVersion: 1, app: 'active-runner', sessionId: randomUUID(),
        events: [{ seq: 1, type: 'human.mark', data: { note: 'extra person' } }] };
    const post = (value = data, headers = {}) => fetch(`${origin}/__debug/session`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        body: typeof value === 'string' ? value : JSON.stringify(value)
    });
    try { await run({ directory, origin, data, post }); }
    finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
}

test('debug sessions save and replace one complete JSON file, never served as static content', () => fixture(async ({directory, origin, data, post}) => {
    const first = await post(); assert.equal(first.status, 200);
    assert.equal((await first.json()).file, `debug-logs/${data.sessionId}.json`);
    data.events.push({ seq: 2, type: 'human.finish' });
    assert.equal((await post()).status, 200);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, `${data.sessionId}.json`), 'utf8')), data);
    assert.deepEqual(await fs.readdir(directory), [`${data.sessionId}.json`]);
    assert.equal((await fetch(`${origin}/debug-logs/${data.sessionId}.json`)).status, 404);
}));

test('debug writer rejects cross-origin, malformed and unsafe session paths without creating files', () => fixture(async ({directory, data, post}) => {
    assert.equal((await post(data, { Origin: 'http://other-site.test' })).status, 403);
    assert.equal((await post(data, { Origin: '' })).status, 403);
    assert.equal((await post(data, { 'Content-Type': 'text/plain' })).status, 415);
    for (const value of ['{bad json', { ...data, sessionId: '../outside' }, { ...data, events: null }, null]) {
        assert.equal((await post(JSON.stringify(value))).status, 400);
    }
    assert.deepEqual(await fs.readdir(directory), []);
}));

test('debug writer bounds request size and event count', () => fixture(async ({directory, data, post}) => {
    assert.equal((await post('x'.repeat(1024 * 1024 + 1))).status, 413);
    assert.equal((await post({ ...data, events: Array(2001).fill({seq:1,type:'sample'}) })).status, 400);
    assert.deepEqual(await fs.readdir(directory), []);
}));
