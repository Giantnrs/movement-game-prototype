const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');
const { build, root, versionStylesheet } = require('./build.cjs');
const { checkAssets } = require('./assets.cjs');

assert.equal(fs.readFileSync(path.join(root, 'dist/game.js'), 'utf8'), build(),
    'dist/game.js is stale. Run npm run build.');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.equal(html, versionStylesheet(html, fs.readFileSync(path.join(root, 'styles/game.css'))),
    'Stylesheet cache version is stale. Run npm run build.');
for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if (src.startsWith('https://')) continue;
    new Script(fs.readFileSync(path.join(root, src), 'utf8'), { filename: src });
}
assert(!/<script\b[^>]*>\s*[^\s<]/.test(html), 'Keep executable code in src/.');
assert(!/<style>/.test(html), 'Keep page styling in styles/.');
assert(fs.existsSync(path.join(root, 'styles/game.css')));
console.log('Source syntax, page references, and generated bundle are valid.');
const { references, assets } = checkAssets();
console.log(`${references} local references and ${assets} media assets are valid.`);
