// Parses docs/glossary.md into [{ id, term, text }] (shared by the sync
// test). Not a test file itself.
import { readFileSync } from 'node:fs';

export function slug(term) {
  return term.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseGlossaryMd(path = new URL('../docs/glossary.md', import.meta.url)) {
  const entries = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^- \*\*(.+?)\*\*: (.*)$/.exec(line);
    if (m) entries.push({ id: slug(m[1]), term: m[1], text: m[2] });
    else if (/^  \S/.test(line) && entries.length) entries.at(-1).text += ' ' + line.trim();
  }
  return entries;
}
