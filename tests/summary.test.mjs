import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeChecks } from '../summary.js';

const ok = { state: 'ok' };
const fail = { state: 'fail' };
const error = { state: 'error' };
const na = { state: 'na' };
const waiting = { state: 'na', needsConfirm: true };

test('pending while any check runs', () => {
  assert.deepEqual(summarizeChecks([ok, null, null]), {
    state: 'pending',
    title: 'Checking in your browser… (1 of 3 done)'
  });
});

test('all passed', () => {
  assert.deepEqual(summarizeChecks([ok, ok, ok]), {
    state: 'ok',
    title: 'All 3 checks passed in your browser'
  });
  assert.equal(summarizeChecks([ok]).title, 'The 1 check passed in your browser');
});

test('not-applicable checks are left out of the count', () => {
  assert.deepEqual(summarizeChecks([ok, na, ok]), {
    state: 'ok',
    title: 'All 2 checks passed in your browser · 1 not applicable'
  });
});

test('any failure wins, even with errors', () => {
  assert.deepEqual(summarizeChecks([ok, fail, error]), {
    state: 'fail',
    title: "1 of 3 checks FAILED: this data doesn't add up. See below."
  });
});

test("checks that couldn't run are never a pass", () => {
  assert.deepEqual(summarizeChecks([ok, error, ok]), {
    state: 'error',
    title: "2 of 3 checks passed · 1 couldn't run"
  });
});

test('checks waiting for the user are called out', () => {
  assert.deepEqual(summarizeChecks([ok, waiting, ok]), {
    state: 'na',
    title: '2 of 3 checks passed · 1 waiting for you to start it'
  });
});

test('nothing to check', () => {
  assert.deepEqual(summarizeChecks([na, na]), {
    state: 'na',
    title: 'Nothing on this page can be checked yet.'
  });
});
