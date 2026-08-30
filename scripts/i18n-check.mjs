// Which sentences in the code have no translation yet, and which translations
// no longer match any sentence in the code. Run: npm run i18n:check
//
// The English sentence is the key, so editing an English string silently
// orphans its translation. This is the thing that catches that.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    // i18n.ts documents t() in its own comments; scanning it would report its
    // examples as untranslated strings.
    else if (/\.tsx?$/.test(name) && name !== 'i18n.ts') files.push(path);
  }
};
walk(join(root, 'src'));
files.push(join(root, 'App.tsx'));

const pattern = new RegExp("\\bt\\(\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\")", 'g');
const used = new Set();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(pattern)) {
    const text = (match[1] ?? match[2]).replace(/\\'/g, "'");
    // `split('.')` and friends also end in a t; one character is never a
    // sentence, so the noise stops here.
    if (text.trim().length > 1) used.add(text);
  }
}

// Words that reach t() through a variable rather than a literal.
for (const text of JSON.parse(readFileSync(join(root, 'src/strings/indirect.json'), 'utf8'))) used.add(text);

// Every table is checked, not just the first one. A language that quietly falls
// behind still renders — in English — which is exactly the failure that hides.
const tables = readdirSync(join(root, 'src/strings'))
  .filter((name) => name.endsWith('.ts'))
  .sort();

const keyPattern = new RegExp("^\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\")\\s*:", 'gm');
let broken = 0;

for (const name of tables) {
  const table = readFileSync(join(root, 'src/strings', name), 'utf8');
  const translated = new Set([...table.matchAll(keyPattern)].map((match) => (match[1] ?? match[2]).replace(/\\'/g, "'")));

  const missing = [...used].filter((text) => !translated.has(text)).sort();
  const orphan = [...translated].filter((text) => !used.has(text)).sort();

  for (const text of missing) console.log(`${name}  untranslated  ${JSON.stringify(text)}`);
  for (const text of orphan) console.log(`${name}  orphaned      ${JSON.stringify(text)}`);
  console.log(`${name.padEnd(8)} ${translated.size} translated, ${missing.length} untranslated, ${orphan.length} orphaned`);
  broken += missing.length + orphan.length;
}

console.log(`\n${used.size} strings in the code, ${tables.length} tables`);
process.exit(broken > 0 ? 1 : 0);
