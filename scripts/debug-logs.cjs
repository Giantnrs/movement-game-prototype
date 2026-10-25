const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Local development only. Files are never served by the static asset whitelist.
function createDebugLogHandler(directory) {
    const MAX_BYTES = 1024 * 1024;
    return function handleDebugLog(req, res) {
        let pathname;
        try { pathname = new URL(req.url, 'http://localhost').pathname; }
        catch { return false; } // The static handler returns a malformed-URL response.
        if (pathname !== '/__debug/session') return false;
        const reply = (status, data) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(data));
        };
        if (req.method !== 'POST') { reply(405, { error: 'POST required' }); return true; }
        const host = req.headers.host;
        const address = req.socket.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
            !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host || '') ||
            req.headers.origin !== `http://${host}`) {
            reply(403, { error: 'Same-origin localhost requests only' }); return true;
        }
        if (req.headers['content-type'] !== 'application/json') { reply(415, { error: 'JSON required' }); return true; }
        let bytes = 0, oversized = false;
        const chunks = [];
        req.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) {
                if (!oversized) reply(413, { error: 'Log exceeds 1 MiB' });
                oversized = true; chunks.length = 0;
            } else if (!oversized) chunks.push(chunk);
        });
        req.on('end', async () => {
            if (oversized) return;
            let data;
            try {
                data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (data.schemaVersion !== 1 || data.app !== 'active-runner' ||
                    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.sessionId || '') ||
                    !Array.isArray(data.events) || data.events.length > 2000 ||
                    !data.events.every(event => Number.isSafeInteger(event.seq) && typeof event.type === 'string')) {
                    throw Error('Invalid log');
                }
            } catch { reply(400, { error: 'Invalid debug session' }); return; }
            const filename = `${data.sessionId}.json`;
            const target = path.join(directory, filename);
            const temporary = `${target}.${randomUUID()}.tmp`;
            try {
                await fs.mkdir(directory, { recursive: true });
                await fs.writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx' });
                await fs.rename(temporary, target);
                reply(200, { file: `debug-logs/${filename}` });
            } catch {
                await fs.rm(temporary, { force: true }).catch(() => {});
                reply(500, { error: 'Cannot save log; use Download log' });
            }
        });
        return true;
    };
}
module.exports = { createDebugLogHandler };
