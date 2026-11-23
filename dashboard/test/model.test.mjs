import assert from 'node:assert/strict';
import { test } from 'node:test';

import { branchProblems, publishStale, safeUrl, stageState, summarize } from '../site/model.js';

const run = (state, stages = {}) => ({
  state,
  stages: {
    setup: { state: null, platforms: {} },
    build: { state: null, platforms: {} },
    tests: { state: null, platforms: {} },
    publish: { state: null, platforms: {} },
    ...Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, { state: v, platforms: {} }])),
  },
});

const branch = (overrides = {}) => ({ name: '1.0', pr: null, release: null, renovatePrs: [], lastPublished: null, lastPublishFailure: null, ...overrides });

test('stageState surfaces setup failures and runs that never started', () => {
  assert.equal(stageState(null, 'build'), 'none');
  assert.equal(stageState(run('startup_failure'), 'tests'), 'startup_failure');
  assert.equal(stageState(run('failure', { setup: 'failure' }), 'build'), 'setup_failure');
  assert.equal(stageState(run('failure', { setup: 'failure' }), 'tests'), 'skipped');
  assert.equal(stageState(run('success', { build: 'success' }), 'build'), 'success');
  assert.equal(stageState(run('queued'), 'publish'), 'queued');
});

test('publishStale is true when the latest failure is newer than the latest success', () => {
  assert.equal(publishStale(branch({ lastPublishFailure: { at: '2026-11-02' }, lastPublished: { at: '2026-11-01' } })), true);
  assert.equal(publishStale(branch({ lastPublishFailure: { at: '2026-11-01' }, lastPublished: { at: '2026-11-02' } })), false);
  assert.equal(publishStale(branch()), false);
});

test('branchProblems and summarize classify per category', () => {
  const failing = branch({
    pr: run('failure', { build: 'success', tests: 'failure' }),
    release: run('failure', { build: 'success', publish: 'failure' }),
    renovatePrs: [{ ci: 'missing' }],
  });
  assert.deepEqual([...branchProblems({}, failing)].sort(), ['publish', 'renovate', 'tests']);
  const repos = [
    { branches: [failing, branch()], renovate: { dashboard: { problems: ['WARN'], sections: {} } }, anomalies: [] },
    { error: 'GitHub API 404', branches: [] },
  ];
  assert.deepEqual(summarize(repos), { sdks: 2, branches: 2, counts: { build: 0, tests: 1, publish: 1, renovate: 1, collection: 1 } });
});

test('safeUrl only allows https GitHub links', () => {
  assert.equal(safeUrl('https://github.com/canonical/go-sdk'), 'https://github.com/canonical/go-sdk');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://github.com.evil.example/x'), null);
  assert.equal(safeUrl(undefined), null);
});
