import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFleet } from '../lib/fleet.mjs';
import { createClient } from '../lib/github.mjs';
import {
  baseBranchOf,
  indexRuns,
  lastPublished,
  parseDependencyDashboard,
  pickDependencyDashboard,
  pickMessages,
  prCiState,
  selectBranches,
  stagesFromJobs,
} from '../lib/summarize.mjs';
import { collectRepo } from '../collect.mjs';

const step = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });

const uploadJob = (platform, overrides = {}) => ({
  id: platform === 'amd64' ? 1 : 2,
  name: `build-and-upload (${platform}, self-hosted, linux) / build-and-upload (${platform})`,
  status: 'completed',
  conclusion: 'success',
  html_url: `https://github.com/canonical/go-sdk/actions/runs/9/job/${platform}`,
  steps: [
    step('Set up job'),
    step('Install LXD'),
    step('Install sdkcraft'),
    step(`Pack SDK for ${platform}`),
    step(`Run tests for ${platform}`, 'skipped'),
    step(`Upload SDK for ${platform}`),
  ],
  ...overrides,
});

test('parseFleet reads SDK tables and skips utilities', () => {
  const readme = [
    '## Languages & Runtimes',
    '| SDK | Description |',
    '| [**Go**](https://github.com/canonical/go-sdk) | Go |',
    '| [**Go again**](https://github.com/canonical/go-sdk/) | duplicate |',
    '## Utilities & Templates',
    '| [`template-sdk/`](https://github.com/canonical/template-sdk) | template |',
    '| [**Template**](https://github.com/canonical/template-sdk) | template |',
  ].join('\n');
  assert.deepEqual(parseFleet(readme), [{ name: 'Go', repo: 'canonical/go-sdk', category: 'Languages & Runtimes' }]);
});

test('stagesFromJobs splits build, tests and publish per platform', () => {
  const { stages, failures } = stagesFromJobs([
    uploadJob('amd64'),
    uploadJob('arm64', {
      conclusion: 'failure',
      steps: [step('Install LXD'), step('Pack SDK for arm64'), step('Upload SDK for arm64', 'failure')],
    }),
  ]);
  assert.equal(stages.build.state, 'success');
  assert.equal(stages.tests.state, 'skipped');
  assert.deepEqual(stages.publish.platforms, { amd64: 'success', arm64: 'failure' });
  assert.equal(stages.publish.state, 'failure');
  assert.equal(stages.setup.state, null);
  assert.deepEqual(failures.map((f) => f.step), ['Upload SDK for arm64']);
});

test('stagesFromJobs reports runner and tooling failures as setup', () => {
  const { stages } = stagesFromJobs([
    { id: 3, name: 'build / build', status: 'completed', conclusion: 'failure', steps: [step('Install sdkcraft', 'failure'), step('Pack SDK', 'skipped')] },
  ]);
  assert.equal(stages.setup.state, 'failure');
  assert.equal(stages.build.state, 'skipped');
});

test('stagesFromJobs keeps the worst state when jobs share a platform', () => {
  const { stages } = stagesFromJobs([
    uploadJob('amd64', { steps: [step('Upload SDK for amd64', 'failure')] }),
    uploadJob('amd64', { steps: [step('Upload SDK for amd64')] }),
  ]);
  assert.equal(stages.publish.platforms.amd64, 'failure');
});

test('baseBranchOf falls back to PR list and Renovate branch naming', () => {
  const headToBase = new Map([['feature', '1.25']]);
  assert.equal(baseBranchOf({ pull_requests: [{ base: { ref: '1.24' } }], head_branch: 'x' }, headToBase), '1.24');
  assert.equal(baseBranchOf({ pull_requests: [], head_branch: 'feature' }, headToBase), '1.25');
  assert.equal(baseBranchOf({ pull_requests: [], head_branch: 'renovate/1.27-go-1.x' }, headToBase), '1.27');
  assert.equal(baseBranchOf({ pull_requests: [], head_branch: 'other' }, headToBase), null);
});

test('indexRuns groups by workflow and branch and flags runs that never started', () => {
  const runs = [
    { id: 1, path: '.github/workflows/upload.yml', head_branch: '1.24', head_sha: 'a', status: 'completed', conclusion: 'success', created_at: '2026-11-01T00:00:00Z' },
    { id: 2, path: '.github/workflows/upload.yml', head_branch: '1.24', head_sha: 'b', status: 'completed', conclusion: 'failure', created_at: '2026-11-02T00:00:00Z' },
    { id: 3, path: '.github/workflows/build.yml', event: 'pull_request', head_branch: 'renovate/1.24-x', head_sha: 'c', pull_requests: [], status: 'completed', conclusion: 'action_required', created_at: '2026-11-03T00:00:00Z', name: 'Build SDK', html_url: 'https://github.com/x' },
    { id: 4, path: '.github/workflows/renovate.yml', head_branch: 'main', head_sha: 'd', status: 'completed', conclusion: 'startup_failure', created_at: '2026-11-04T00:00:00Z', name: 'Renovate' },
  ];
  const index = indexRuns(runs, []);
  assert.deepEqual(index.release.get('1.24').map((r) => r.id), [2, 1]);
  assert.deepEqual(index.pr.get('1.24').map((r) => r.id), [3]);
  assert.deepEqual(index.renovate.map((r) => r.id), [4]);
  assert.deepEqual(index.anomalies.map((a) => [a.kind, a.branch]), [
    ['startup_failure', 'main'],
    ['action_required', '1.24'],
  ]);
});

test('prCiState distinguishes missing CI from pending', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const pr = { created_at: '2026-11-23T11:00:00Z', updated_at: '2026-11-23T11:00:00Z' };
  assert.equal(prCiState(pr, [], now), 'missing');
  assert.equal(prCiState({ ...pr, updated_at: '2026-11-23T11:55:00Z' }, [], now), 'pending');
  assert.equal(prCiState(pr, [{ event: 'pull_request', status: 'completed', conclusion: 'startup_failure' }], now), 'startup_failure');
  assert.equal(prCiState(pr, [{ event: 'push', status: 'completed', conclusion: 'failure' }], now), 'missing');
});

test('parseDependencyDashboard extracts problems and actionable sections', () => {
  const body = [
    'intro',
    '## Repository Problems',
    '',
    ' - ⚠️ WARN: Base branch does not exist - skipping',
    '## Errored',
    ' - [ ] <!-- retry-branch=renovate/a -->Update a',
    ' - [ ] <!-- retry-branch=renovate/b -->Update b',
    '## Detected dependencies',
    ' - `go 1.24`',
  ].join('\n');
  assert.deepEqual(parseDependencyDashboard(body), {
    problems: ['WARN: Base branch does not exist - skipping'],
    sections: { Errored: 2 },
  });
});

test('pickDependencyDashboard prefers the Renovate app issue and reports stale duplicates', () => {
  const dashboard = pickDependencyDashboard([
    { number: 1, title: 'Dependency Dashboard', user: { login: 'github-actions[bot]' }, html_url: 'https://github.com/o/r/issues/1', body: '' },
    { number: 5, title: 'Dependency Dashboard', user: { login: 'renovate[bot]' }, html_url: 'https://github.com/o/r/issues/5', body: '' },
    { number: 6, title: 'Dependency Dashboard', pull_request: {}, user: { login: 'renovate[bot]' } },
  ]);
  assert.equal(dashboard.number, 5);
  assert.deepEqual(dashboard.duplicates, ['https://github.com/o/r/issues/1']);
});

test('selectBranches combines numeric, tracked and released branches', () => {
  assert.deepEqual(selectBranches(['main', '1.24', '1.9', 'latest', 'jazzy', 'feature'], ['latest', '1.24'], ['jazzy']), [
    { name: 'latest', tracked: true },
    { name: 'jazzy', tracked: false },
    { name: '1.24', tracked: true },
    { name: '1.9', tracked: false },
  ]);
  assert.deepEqual(selectBranches(['1.0'], null), [{ name: '1.0', tracked: null }]);
});

test('lastPublished keeps the newest success per platform', () => {
  const summary = (updatedAt, platforms) => ({ updatedAt, url: `https://github.com/${updatedAt}`, stages: { publish: { platforms } } });
  const result = lastPublished([
    summary('2026-11-03T00:00:00Z', { amd64: 'success', arm64: 'failure' }),
    summary('2026-11-01T00:00:00Z', { amd64: 'success', arm64: 'success' }),
  ]);
  assert.equal(result.at, '2026-11-03T00:00:00Z');
  assert.equal(result.platforms.arm64.at, '2026-11-01T00:00:00Z');
});

test('pickMessages prefers specific annotations over exit codes', () => {
  assert.deepEqual(
    pickMessages([
      { annotation_level: 'failure', message: 'Process completed with exit code 1.' },
      { annotation_level: 'warning', message: 'Node 20 deprecated' },
      { annotation_level: 'failure', message: 'error: spread task check-launch failed' },
    ]),
    ['error: spread task check-launch failed'],
  );
  assert.deepEqual(pickMessages([{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }]), ['Process completed with exit code 1.']);
});

test('createClient follows pagination and retries server errors', async () => {
  const calls = [];
  const responses = [
    new Response('oops', { status: 502 }),
    new Response(JSON.stringify([1, 2]), { headers: { link: '<https://api.github.com/x?page=2>; rel="next"', 'x-ratelimit-remaining': '10' } }),
    new Response(JSON.stringify([3]), { headers: { 'x-ratelimit-remaining': '9' } }),
  ];
  const gh = createClient({
    token: 't',
    sleep: async () => {},
    fetchImpl: async (url) => {
      calls.push(url);
      return responses.shift();
    },
  });
  assert.deepEqual(await gh.paginate('/x'), [1, 2, 3]);
  assert.equal(calls.length, 3);
  assert.equal(gh.stats().rateLimit.remaining, 9);
});

test('createClient returns null for optional resources that are missing or forbidden', async () => {
  const gh = createClient({ token: 't', fetchImpl: async () => new Response('{}', { status: 403 }) });
  assert.equal(await gh.get('/repos/o/r/actions/variables/X', { optional: true }), null);
  await assert.rejects(gh.get('/repos/o/r'), /403/);
});

test('collectRepo assembles a branch summary from API responses', async () => {
  const run = (id, overrides) => ({
    id,
    html_url: `https://github.com/canonical/go-sdk/actions/runs/${id}`,
    status: 'completed',
    conclusion: 'success',
    actor: { login: 'renovate[bot]' },
    pull_requests: [],
    ...overrides,
  });
  const runs = [
    run(10, { path: '.github/workflows/upload.yml', event: 'push', head_branch: '1.24', head_sha: 's1', conclusion: 'failure', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T01:00:00Z' }),
    run(9, { path: '.github/workflows/upload.yml', event: 'push', head_branch: '1.24', head_sha: 's0', created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T01:00:00Z' }),
    run(8, { path: '.github/workflows/build.yml', event: 'pull_request', head_branch: 'renovate/1.24-go', head_sha: 'p1', created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T01:00:00Z' }),
  ];
  const routes = {
    '/repos/canonical/go-sdk': { html_url: 'https://github.com/canonical/go-sdk', default_branch: 'main', archived: false },
    '/repos/canonical/go-sdk/branches': [{ name: 'main' }, { name: '1.24' }],
    '/repos/canonical/go-sdk/actions/variables/LONG_TERM_BRANCHES': { value: '["1.24"]' },
    '/repos/canonical/go-sdk/actions/runs': runs,
    '/repos/canonical/go-sdk/pulls': [
      { number: 3, state: 'open', title: 'Update go', html_url: 'https://github.com/canonical/go-sdk/pull/3', user: { login: 'renovate[bot]' }, created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z', head: { ref: 'renovate/1.24-go', sha: 'p1' }, base: { ref: '1.24' } },
    ],
    '/repos/canonical/go-sdk/issues': [],
    '/repos/canonical/go-sdk/contents/tests/spread.yaml': {},
    '/repos/canonical/go-sdk/actions/runs/10/jobs': [uploadJob('amd64', { conclusion: 'failure', steps: [step('Pack SDK for amd64'), step('Upload SDK for amd64', 'failure')] })],
    '/repos/canonical/go-sdk/actions/runs/9/jobs': [uploadJob('amd64')],
    '/repos/canonical/go-sdk/actions/runs/8/jobs': [{ id: 7, name: 'build / build', status: 'completed', conclusion: 'success', steps: [step('Pack SDK'), step('Run tests')] }],
    '/repos/canonical/go-sdk/check-runs/1/annotations': [{ annotation_level: 'failure', message: 'store: 503' }],
  };
  const gh = {
    get: async (path, { optional } = {}) => {
      if (path in routes) return routes[path];
      if (optional) return null;
      throw new Error(`unexpected ${path}`);
    },
    paginate: async (path) => {
      if (!(path in routes)) throw new Error(`unexpected ${path}`);
      return routes[path];
    },
  };
  const repo = await collectRepo(gh, { repo: 'canonical/go-sdk' }, { since: '2026-10-24', now: Date.parse('2026-11-23T00:00:00Z') });
  assert.equal(repo.branches.length, 1);
  const [branch] = repo.branches;
  assert.equal(branch.name, '1.24');
  assert.equal(branch.tracked, true);
  assert.equal(branch.hasTests, true);
  assert.equal(branch.pr.stages.tests.state, 'success');
  assert.equal(branch.release.stages.publish.state, 'failure');
  assert.deepEqual(branch.release.failures[0].messages, ['store: 503']);
  assert.equal(branch.lastPublished.at, '2026-11-10T01:00:00Z');
  assert.equal(branch.lastPublishFailure.at, '2026-11-20T01:00:00Z');
  assert.deepEqual(branch.renovatePrs.map((pr) => pr.ci), ['success']);
});
