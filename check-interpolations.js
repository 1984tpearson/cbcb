// Catches the bug that shipped today: an identifier interpolated into a template
// literal that nothing anywhere declares. Babel compiles it fine, it throws at
// runtime, an enclosing catch swallows it, and the feature silently does nothing.
//
// The signature is simple and precise: the name appears ONLY inside ${...} and
// nowhere else in the file. A real variable is always written somewhere too.
const fs = require('fs');
let bad = [];
for (const file of [require('path').join(__dirname, 'index.html'), require('path').join(__dirname, 'site-config.js'), require('path').join(__dirname, 'image-prompt.js')]) {
  const src = fs.readFileSync(file, 'utf8');
  const interpolated = new Set();
  for (const m of src.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*[.\[}?|)\s]/g)) interpolated.add(m[1]);
  for (const name of interpolated) {
    const outside = new RegExp(`(^|[^.\\w$])${name}\\b(?!\\s*\\})`, 'g');
    const hits = [...src.matchAll(outside)].filter(m => {
      const before = src.slice(Math.max(0, m.index - 2), m.index + (m[1] ? m[1].length : 0) + 1);
      return !before.includes('${');
    });
    if (hits.length === 0) bad.push(`${file.split('/').pop()}: ${name}`);
  }
}
if (bad.length) { console.error('interpolated but never declared:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('template-literal identifiers: all declared somewhere');
