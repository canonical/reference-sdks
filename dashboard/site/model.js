// View model shared by the browser and the Node tests; no DOM access here.

export const LABELS = {
  success: 'passed',
  failure: 'failed',
  timed_out: 'timed out',
  cancelled: 'cancelled',
  startup_failure: "didn't start",
  action_required: 'needs approval',
  setup_failure: 'setup failed',
  in_progress: 'running',
  queued: 'queued',
  waiting: 'waiting',
  pending: 'pending',
  requested: 'requested',
  skipped: 'not run',
  missing: 'no CI run',
  none: '—',
};

const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'setup_failure', 'action_required', 'missing']);
const WAITING = new Set(['in_progress', 'queued', 'waiting', 'pending', 'requested']);

export function tone(state) {
  if (state === 'success') return 'ok';
  if (FAILED.has(state)) return 'bad';
  if (WAITING.has(state)) return 'busy';
  if (state === 'cancelled') return 'warn';
  return 'muted';
}

export const isFailed = (state) => FAILED.has(state);

// State of one stage (build/tests/publish) in a run summary.
export function stageState(run, stage) {
  if (!run) return 'none';
  if (['startup_failure', 'action_required'].includes(run.state)) return run.state;
  const own = run.stages?.[stage]?.state;
  if (own) return own;
  if (stage === 'build' && ['failure', 'timed_out', 'cancelled'].includes(run.stages?.setup?.state)) {
    return run.stages.setup.state === 'failure' ? 'setup_failure' : run.stages.setup.state;
  }
  if (WAITING.has(run.state)) return run.state;
  return run.state === 'success' || run.state === 'failure' ? 'skipped' : (run.state ?? 'none');
}

export function publishStale(branch) {
  const failedAt = Date.parse(branch.lastPublishFailure?.at ?? '');
  const publishedAt = Date.parse(branch.lastPublished?.at ?? '');
  return Number.isFinite(failedAt) && (!Number.isFinite(publishedAt) || failedAt > publishedAt);
}

export function branchProblems(repo, branch) {
  const problems = new Set();
  if (isFailed(stageState(branch.pr, 'build')) || isFailed(stageState(branch.release, 'build'))) problems.add('build');
  if (isFailed(stageState(branch.pr, 'tests')) || isFailed(stageState(branch.release, 'tests'))) problems.add('tests');
  if (isFailed(stageState(branch.release, 'publish')) || publishStale(branch)) problems.add('publish');
  if (branch.renovatePrs.some((pr) => isFailed(pr.ci))) problems.add('renovate');
  return problems;
}

export function repoProblems(repo) {
  const problems = new Set();
  if (repo.error) problems.add('collection');
  const dashboard = repo.renovate?.dashboard;
  if (
    dashboard?.problems.length ||
    dashboard?.sections?.Errored ||
    repo.anomalies?.length ||
    isFailed(repo.renovate?.lastRun?.state) ||
    isFailed(repo.renovate?.lastCheck?.state)
  ) {
    problems.add('renovate');
  }
  return problems;
}

export function summarize(repos) {
  const counts = { build: 0, tests: 0, publish: 0, renovate: 0, collection: 0 };
  let branches = 0;
  for (const repo of repos) {
    const repoLevel = repoProblems(repo);
    if (repoLevel.has('collection')) counts.collection += 1;
    let renovateCounted = repoLevel.has('renovate');
    if (renovateCounted) counts.renovate += 1;
    for (const branch of repo.branches ?? []) {
      branches += 1;
      for (const problem of branchProblems(repo, branch)) {
        if (problem === 'renovate') {
          if (!renovateCounted) counts.renovate += 1;
          renovateCounted = true;
        } else {
          counts[problem] += 1;
        }
      }
    }
  }
  return { sdks: repos.length, branches, counts };
}

export function relativeTime(iso, now = Date.now()) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return 'never';
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Only GitHub links from the snapshot are rendered as anchors.
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
  } catch {
    return null;
  }
}
