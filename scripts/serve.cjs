const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { root } = require('./build.cjs');
const { createDebugLogHandler } = require('./debug-logs.cjs');

const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};

// Serve only the game and its assets, excluding documents and nested repositories.
function allowed(relative) {
    return /^(index\.html|dist\/game\.js|src\/.*\.js|styles\/.*\.css|assets\/images\/[^/]+\.(png|jpg)|assets\/videos\/[^/]+\.mp4|assets\/audio\/(?:music\/|voice\/)?[^/]+\.mp3)$/.test(relative);
}

function createServer(override, { debugDirectory = path.join(root, 'debug-logs') } = {}) {
    const handleDebugLog = createDebugLogHandler(debugDirectory);
    return http.createServer((req, res) => {
        if (override?.(req, res)) return;
        if (handleDebugLog(req, res)) return;
        let relative;
        try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html'; }
        catch { res.writeHead(400).end(); return; }
        if (!allowed(relative) || relative.split('/').includes('..')) {
            res.writeHead(404).end(); return;
        }
        const file = path.join(root, relative);
        fs.stat(file, (error, stat) => {
            if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
            const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
            const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
            if (range) {
                const start = Number(range[1]);
                const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
                if (start > end || start >= stat.size) {
                    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return;
                }
                res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
                fs.createReadStream(file, { start, end }).pipe(res);
            } else {
                res.writeHead(200, { ...headers, 'Content-Length': stat.size });
                fs.createReadStream(file).pipe(res);
            }
        });
    });
}

if (require.main === module) {
    const port = Number(process.env.PORT || 8080);
    createServer().listen(port, '127.0.0.1', () => console.log(`Active Runner: http://127.0.0.1:${port}`));
}

module.exports = { createServer };
