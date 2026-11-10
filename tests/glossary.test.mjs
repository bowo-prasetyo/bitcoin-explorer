import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { GLOSSARY, glossaryEntry, glossaryHtml } from '../glossary.js';
import { parseGlossaryMd } from './glossary-md.mjs';

test('the in-app glossary matches docs/glossary.md word for word', () => {
  assert.deepEqual(GLOSSARY, parseGlossaryMd());
});

test('ids are unique', () => {
  assert.equal(new Set(GLOSSARY.map(e => e.id)).size, GLOSSARY.length);
});

test('every <glossary-term> in the views names a real entry', () => {
  const dir = new URL('../components/', import.meta.url);
  const used = [];
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/<glossary-term[^>]*\sterm="([^"]+)"/g)) used.push(m[1]);
  }
  assert.ok(used.length > 0);
  for (const id of used) assert.ok(glossaryEntry(id), `unknown glossary term "${id}"`);
});

test('glossaryHtml renders bold, italics and code, and escapes the rest', () => {
  assert.equal(
    glossaryHtml('**a** *b* `c` <d> & "e"'),
    '<strong>a</strong> <em>b</em> <code>c</code> &lt;d&gt; &amp; &quot;e&quot;'
  );
  assert.equal(glossaryHtml('`1A1zP1…`'), '<code>1A1zP1…</code>');
});
