const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./build.cjs');

const destination = path.join(root, '_site');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination);

// Only runtime files belong in the published site.
for (const entry of ['index.html', 'assets', 'dist', 'src', 'styles']) {
    fs.cpSync(path.join(root, entry), path.join(destination, entry), {
        recursive: true,
        filter: source => path.basename(source) !== '.DS_Store'
    });
}
fs.writeFileSync(path.join(destination, '.nojekyll'), '');
console.log('Packaged GitHub Pages site in _site/.');
