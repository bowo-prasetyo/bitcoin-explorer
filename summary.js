// summary.js
// One line summing up the verification badges on a page, so nobody has to
// read every badge to know whether the page checked out. Pure; covered by
// tests/summary.test.mjs.
//
// Input: the results the page's <verify-badge>s show (see verify.js), with
// null for a check that is still running.
//
// Output: { state, title }
//   state: 'pending' | 'fail' | 'error' | 'na' | 'ok', the same states a
//          badge uses, so the summary is styled like one.

function plural(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function summarizeChecks(results) {
  const total = results.length;
  const done = results.filter(r => r);

  if (done.length < total) {
    return {
      state: 'pending',
      title: `Checking in your browser… (${done.length} of ${total} done)`
    };
  }

  const count = pred => done.filter(pred).length;

  const ok = count(r => r.state === 'ok');
  const fail = count(r => r.state === 'fail');
  const error = count(r => r.state === 'error');
  const waiting = count(r => r.state === 'na' && r.needsConfirm);
  const na = count(r => r.state === 'na' && !r.needsConfirm);

  // "Nothing to check" results don't count towards "N of M".
  const counted = total - na;

  if (fail) {
    return {
      state: 'fail',
      title: `${fail} of ${plural(counted, 'check', 'checks')} FAILED: ` +
        "this data doesn't add up. See below."
    };
  }

  if (counted === 0) {
    return { state: 'na', title: 'Nothing on this page can be checked yet.' };
  }

  const extras = [];
  if (error) extras.push(`${error} couldn't run`);
  if (waiting) extras.push(`${waiting} waiting for you to start it`);
  if (na) extras.push(`${na} not applicable`);
  const tail = extras.length ? ' · ' + extras.join(' · ') : '';

  if (ok === counted) {
    return {
      state: 'ok',
      title: (counted === 1
        ? 'The 1 check passed in your browser'
        : `All ${counted} checks passed in your browser`) + tail
    };
  }

  return {
    state: error ? 'error' : 'na',
    title: `${ok} of ${plural(counted, 'check', 'checks')} passed` + tail
  };
}
