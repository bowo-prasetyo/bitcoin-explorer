import test from 'node:test';
import assert from 'node:assert/strict';

import { titleFor, shortId, blockTitle } from '../titles.js';

const H = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

test('fixed pages', () => {
  assert.equal(titleFor({ path: '/', params: {} }), 'Assay · Bitcoin explorer');
  assert.equal(titleFor({ path: '/charts', params: {} }), 'Charts · Assay');
  assert.equal(titleFor({ path: '/providers', params: {} }), 'Providers · Assay');
  assert.equal(titleFor({ path: '/glossary', params: {} }), 'Glossary · Assay');
});

test('blocks, transactions and addresses show a short id', () => {
  assert.equal(titleFor({ path: '/block/' + H, params: { hash: H } }), 'Block 000000…8ce26f · Assay');
  assert.equal(titleFor({ path: '/tx/x', params: { txid: H } }), 'Transaction 000000…8ce26f · Assay');
  assert.equal(
    titleFor({ path: '/address/x', params: { addr: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } }),
    'Address 1A1zP1…DivfNa · Assay'
  );
});

test('anything else is not found', () => {
  assert.equal(titleFor({ path: '/nope', params: { unknown: ['nope'] } }), 'Page not found · Assay');
});

test('shortId leaves short values alone', () => {
  assert.equal(shortId('abc'), 'abc');
  assert.equal(shortId(''), '');
  assert.equal(shortId(undefined), '');
});

test('blockTitle uses the height', () => {
  assert.equal(blockTitle(840000), 'Block 840,000 · Assay');
  assert.equal(blockTitle(0), 'Block 0 · Assay');
});
