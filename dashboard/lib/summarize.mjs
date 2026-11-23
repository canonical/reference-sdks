// Pure classification of GitHub Actions data. Network access lives in collect.mjs.

// Workflow files of the reference SDK layout (see canonical/sdkcraft-actions).
export const WORKFLOWS = {
  'build.yml': 'pr',
  'upload.yml': 'release',
  'renovate.yml': 'renovate',
  'renovate-check.yml': 'renovateCheck',
};

// Step names emitted by the sdkcraft-actions reusable build.yml and upload.yml.
const STAGES = [
  ['build', /^Pack\b/i],
  ['tests', /^(Run tests|Test)\b/i],
  ['publish', /^(Upload|Publish|Release)\b/i],
];

const SEVERITY = {
  startup_failure: 8,
  failure: 7,
  timed_out: 7,
  action_required: 6,
  cancelled: 5,
  in_progress: 3,
  queued: 3,
  waiting: 3,
  pending: 3,
  requested: 3,
  success: 1,
  neutral: 0,
  skipped: 0,
};

export const VERSION_BRANCH = /^\d+(\.\d+)*$/;

export function worst(states) {
  let result = null;
  for (const state of states) {
    if (state == null) continue;
    if (result === null || (SEVERITY[state] ?? 2) > (SEVERITY[result] ?? 2)) result = state;
  }
  return result;
}

export function workflowKind(run) {
  return WORKFLOWS[run.path?.split('/').pop()?.split('@')[0]] ?? null;
}

export function runState(run) {
  return run.status === 'completed' ? run.conclusion : run.status;
}

function stepState(step) {
  return step.status === 'completed' ? step.conclusion : step.status;
}

function platformOf(stepName, jobName) {
  return /\bfor (\S+)$/.exec(stepName)?.[1] ?? /\(([\w-]+)[,)]/.exec(jobName)?.[1] ?? 'default';
}

// Fold a run's jobs into per-stage, per-platform states. Failures before the first stage
// step (runner, LXD, sdkcraft install) are reported as `setup` so they are not
// mistaken for SDK build failures.
export function stagesFromJobs(jobs) {
  const stages = { setup: emptyStage(), build: emptyStage(), tests: emptyStage(), publish: emptyStage() };
  const failures = [];
  for (const job of jobs) {
    const steps = job.steps ?? [];
    let reachedStage = false;
    let failedStep = null;
    for (const step of steps) {
      const stage = STAGES.find(([, pattern]) => pattern.test(step.name))?.[0];
      const state = stepState(step);
      if (state === 'failure' && !failedStep) failedStep = step.name;
      if (!stage) {
        if (!reachedStage && state === 'failure') record(stages.setup, platformOf('', job.name), 'failure');
        continue;
      }
      reachedStage = true;
      record(stages[stage], platformOf(step.name, job.name), state);
    }
    if (steps.length === 0 && job.status === 'completed' && job.conclusion !== 'success' && job.conclusion !== 'skipped') {
      record(stages.setup, platformOf('', job.name), job.conclusion);
    }
    if (['failure', 'timed_out', 'cancelled'].includes(job.conclusion)) {
      failures.push({
        jobId: job.id,
        job: job.name,
        step: failedStep,
        conclusion: job.conclusion,
        url: job.html_url,
        messages: [],
      });
    }
  }
  for (const stage of Object.values(stages)) stage.state = worst(Object.values(stage.platforms));
  return { stages, failures };
}

function emptyStage() {
  return { state: null, platforms: {} };
}

// Monorepos run several jobs per platform; keep the worst outcome per platform.
function record(stage, platform, state) {
  stage.platforms[platform] = worst([stage.platforms[platform], state]);
}

export function summarizeRun(run, jobs) {
  if (!run) return null;
  const { stages, failures } = jobs ? stagesFromJobs(jobs) : { stages: null, failures: [] };
  return {
    id: run.id,
    url: run.html_url,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    actor: run.actor?.login ?? null,
    state: runState(run),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    stages,
    failures,
  };
}

export function isRenovatePr(pr) {
  return /^renovate(\[bot\])?$/.test(pr.user?.login ?? '') || pr.head?.ref?.startsWith('renovate/');
}

// Pull-request runs for deleted PR branches lose `pull_requests`; fall back to the
// PR list and the Renovate `renovate/<base>-<dep>` branch naming.
export function baseBranchOf(run, headToBase) {
  return (
    run.pull_requests?.[0]?.base?.ref ??
    headToBase.get(run.head_branch) ??
    /^renovate\/(\d+(?:\.\d+)*)-/.exec(run.head_branch ?? '')?.[1] ??
    null
  );
}

const byNewest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);

export function indexRuns(runs, pulls) {
  const headToBase = new Map();
  for (const pr of [...pulls].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    headToBase.set(pr.head.ref, pr.base.ref);
  }
  const index = { pr: new Map(), release: new Map(), renovate: [], renovateCheck: [], bySha: new Map(), anomalies: [] };
  for (const run of [...runs].sort(byNewest)) {
    const kind = workflowKind(run);
    const branch = kind === 'pr' ? baseBranchOf(run, headToBase) : run.head_branch;
    if (kind === 'pr' || kind === 'release') {
      if (!index[kind].has(branch)) index[kind].set(branch, []);
      index[kind].get(branch).push(run);
    } else if (kind) {
      index[kind].push(run);
    }
    if (!index.bySha.has(run.head_sha)) index.bySha.set(run.head_sha, []);
    index.bySha.get(run.head_sha).push(run);
    const state = runState(run);
    if (state === 'startup_failure' || state === 'action_required') {
      index.anomalies.push({
        kind: state,
        workflow: run.name ?? run.path,
        branch,
        url: run.html_url,
        at: run.created_at,
        actor: run.actor?.login ?? null,
      });
    }
  }
  return index;
}

export function prCiState(pr, runsForSha, now, graceMinutes = 15) {
  const states = runsForSha.filter((run) => run.event === 'pull_request' || run.event === 'pull_request_target').map(runState);
  if (states.length > 0) return worst(states);
  const ageMinutes = (now - Date.parse(pr.updated_at ?? pr.created_at)) / 60000;
  return ageMinutes > graceMinutes ? 'missing' : 'pending';
}

export function summarizeRenovatePrs(pulls, branch, index, now) {
  return pulls
    .filter((pr) => pr.state === 'open' && pr.base.ref === branch && isRenovatePr(pr))
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login ?? null,
      createdAt: pr.created_at,
      ci: prCiState(pr, index.bySha.get(pr.head.sha) ?? [], now),
    }));
}

const DASHBOARD_IGNORED = new Set(['detected dependencies', 'open', 'other branches', 'ignored or blocked']);

// Extract actionable sections from a Renovate "Dependency Dashboard" issue body.
export function parseDependencyDashboard(body) {
  const result = { problems: [], sections: {} };
  let section = null;
  for (const raw of (body ?? '').split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!section || DASHBOARD_IGNORED.has(section.toLowerCase()) || !line.startsWith('- ')) continue;
    if (section.toLowerCase() === 'repository problems') {
      result.problems.push(line.slice(2).replace(/^⚠️\s*/u, '').trim());
    } else {
      result.sections[section] = (result.sections[section] ?? 0) + 1;
    }
  }
  return result;
}

export function pickDependencyDashboard(issues) {
  const dashboards = issues.filter((issue) => !issue.pull_request && /dependency dashboard/i.test(issue.title));
  const preferred = dashboards.find((issue) => issue.user?.login === 'renovate[bot]') ?? dashboards[0];
  if (!preferred) return null;
  return {
    number: preferred.number,
    url: preferred.html_url,
    author: preferred.user?.login ?? null,
    updatedAt: preferred.updated_at,
    duplicates: dashboards.filter((issue) => issue !== preferred).map((issue) => issue.html_url),
    ...parseDependencyDashboard(preferred.body),
  };
}

// Version branches: LONG_TERM_BRANCHES, numeric names, and any branch with release runs
// (covers named tracks such as `latest` or `jazzy` when the variable is unreadable).
export function selectBranches(branchNames, longTermBranches, releaseBranches = []) {
  const tracked = Array.isArray(longTermBranches) ? new Set(longTermBranches.map(String)) : null;
  const names = new Set(branchNames.filter((name) => VERSION_BRANCH.test(name)));
  for (const name of [...(tracked ?? []), ...releaseBranches]) if (branchNames.includes(name)) names.add(name);
  return [...names]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => ({ name, tracked: tracked ? tracked.has(name) : null }));
}

export function parseLongTermBranches(variable) {
  if (!variable?.value) return null;
  try {
    const value = JSON.parse(variable.value);
    return Array.isArray(value) ? value.map(String) : null;
  } catch {
    return null;
  }
}

export function history(runs, limit = 10) {
  return (runs ?? []).slice(0, limit).map((run) => ({ state: runState(run), url: run.html_url, at: run.created_at }));
}

// Most recent successful upload per platform across already-summarised release runs.
export function lastPublished(summaries) {
  const platforms = {};
  for (const summary of summaries) {
    for (const [platform, state] of Object.entries(summary?.stages?.publish.platforms ?? {})) {
      if (state === 'success' && !platforms[platform]) platforms[platform] = { at: summary.updatedAt, url: summary.url };
    }
  }
  const latest = Object.values(platforms).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return latest ? { ...latest, platforms } : null;
}

export function lastPublishFailure(summaries) {
  const failed = summaries.find((summary) => ['failure', 'timed_out'].includes(summary?.stages?.publish.state));
  return failed ? { at: failed.updatedAt, url: failed.url } : null;
}

// Check-run annotations carry the error text; the generic exit-code line is a last resort.
export function pickMessages(annotations, limit = 3) {
  const failures = (annotations ?? []).filter((a) => a.annotation_level === 'failure' && a.message);
  const specific = failures.filter((a) => !/^Process completed with exit code \d+\.?$/.test(a.message.trim()));
  const chosen = specific.length > 0 ? specific : failures;
  return [...new Set(chosen.map((a) => a.message.trim().slice(0, 500)))].slice(0, limit);
}
