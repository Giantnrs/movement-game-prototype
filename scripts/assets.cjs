const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./build.cjs');
const assetPaths = require('../assets/manifest.json');

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(file) : [file];
    });
}

function checkAssets() {
    const files = [path.join(root, 'index.html'), ...sourceFiles(path.join(root, 'src')),
        ...sourceFiles(path.join(root, 'styles'))];
    let references = 0;
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        const matches = file.endsWith('.css')
            ? [...source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)]
            : file.endsWith('.html')
                ? [...source.matchAll(/(?:src|href)="([^"]+)"/g)]
                : [...source.matchAll(/['"]([^'"\n]+\.(?:png|jpg|mp4|mp3))['"]/g)];
        for (const [, reference] of matches) {
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
            // CSS URLs resolve from the stylesheet; script-set URLs resolve from the page.
            const base = file.endsWith('.css') ? path.dirname(file) : root;
            const target = path.resolve(base, reference.split(/[?#]/, 1)[0]);
            assert(target.startsWith(root + path.sep), `Asset escapes project: ${reference}`);
            assert(fs.existsSync(target) && fs.statSync(target).isFile(),
                `Missing reference in ${path.relative(root, file)}: ${reference}`);
            references++;
        }
    }
    for (const target of Object.values(assetPaths)) {
        assert(target.startsWith('assets/'), `Media belongs in assets/: ${target}`);
        assert(fs.existsSync(path.join(root, target)), `Missing manifest asset: ${target}`);
    }
    return { references, assets: Object.keys(assetPaths).length };
}

module.exports = { assetPaths, checkAssets };
