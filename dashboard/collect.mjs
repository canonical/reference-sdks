#!/usr/bin/env node
// Collects per-SDK, per-version-branch CI health into a JSON snapshot for the dashboard.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { parseFleet } from './lib/fleet.mjs';
import { createClient } from './lib/github.mjs';
import {
  history,
  indexRuns,
  lastPublished,
  lastPublishFailure,
  parseLongTermBranches,
  pickDependencyDashboard,
  pickMessages,
  runState,
  selectBranches,
  summarizeRenovatePrs,
  summarizeRun,
} from './lib/summarize.mjs';

export async function collectRepo(gh, sdk, { since, now, maxRunPages = 3, publishLookback = 10 }) {
  const base = `/repos/${sdk.repo}`;
  const meta = await gh.get(base);
  const [branches, longTermVariable, runs, pulls, issues] = await Promise.all([
    gh.paginate(`${base}/branches`, { maxPages: 3 }),
    gh.get(`${base}/actions/variables/LONG_TERM_BRANCHES`, { optional: true }),
    gh.paginate(`${base}/actions/runs`, { params: { created: `>=${since}` }, key: 'workflow_runs', maxPages: maxRunPages }),
    gh.paginate(`${base}/pulls`, { params: { state: 'all', sort: 'updated', direction: 'desc' }, maxPages: 1 }),
    gh.paginate(`${base}/issues`, { params: { state: 'open' }, maxPages: 1 }),
  ]);
  const index = indexRuns(runs, pulls);
  const longTermBranches = parseLongTermBranches(longTermVariable);

  const jobs = new Map();
  const jobsFor = (run) => {
    if (!jobs.has(run.id)) {
      jobs.set(run.id, gh.paginate(`${base}/actions/runs/${run.id}/jobs`, { params: { filter: 'latest' }, key: 'jobs', maxPages: 2 }));
    }
    return jobs.get(run.id);
  };
  const summarize = async (run) => (run ? summarizeRun(run, await jobsFor(run)) : null);
  const annotate = async (summary) => {
    for (const failure of summary?.failures.slice(0, 3) ?? []) {
      failure.messages = pickMessages(await gh.get(`${base}/check-runs/${failure.jobId}/annotations`, { optional: true }));
    }
    return summary;
  };
  const uploadRuns = (branch, params) =>
    gh.get(`${base}/actions/workflows/upload.yml/runs`, { params: { branch, per_page: 1, ...params }, optional: true });

  const versionBranches = [];
  const releaseBranches = [...index.release.keys()].filter((name) => name && name !== meta.default_branch);
  for (const { name, tracked } of selectBranches(branches.map((branch) => branch.name), longTermBranches, releaseBranches)) {
    const prRuns = index.pr.get(name) ?? [];
    let releaseRuns = index.release.get(name) ?? [];
    if (releaseRuns.length === 0) {
      // Quiet branches: show the latest release run even if it predates the window.
      const older = await uploadRuns(name, {});
      releaseRuns = older?.workflow_runs?.slice(0, 1) ?? [];
    }
    const [pr, release, spread] = await Promise.all([
      summarize(prRuns[0]).then(annotate),
      summarize(releaseRuns[0]).then(annotate),
      gh.get(`${base}/contents/tests/spread.yaml`, { params: { ref: name }, optional: true }),
    ]);

    // Walk back through older uploads until every platform has a known successful publish.
    const releases = [release];
    const platforms = Object.keys(release?.stages?.build.platforms ?? {});
    for (const run of releaseRuns.slice(1, publishLookback)) {
      const found = lastPublished(releases)?.platforms ?? {};
      if (platforms.length > 0 && platforms.every((platform) => found[platform])) break;
      releases.push(await summarize(run));
    }
    if (!lastPublished(releases)) {
      const older = await uploadRuns(name, { status: 'success' });
      if (older?.workflow_runs?.[0]) releases.push(await summarize(older.workflow_runs[0]));
    }

    versionBranches.push({
      name,
      tracked,
      hasTests: spread !== null,
      pr,
      release,
      lastPublished: lastPublished(releases),
      lastPublishFailure: lastPublishFailure(releases),
      renovatePrs: summarizeRenovatePrs(pulls, name, index, now),
      history: { pr: history(prRuns), release: history(releaseRuns) },
    });
  }

  const latest = (list) => (list[0] ? { state: runState(list[0]), url: list[0].html_url, at: list[0].created_at } : null);
  return {
    url: meta.html_url,
    archived: meta.archived,
    defaultBranch: meta.default_branch,
    longTermBranches,
    renovate: {
      dashboard: pickDependencyDashboard(issues),
      lastRun: latest(index.renovate),
      lastCheck: latest(index.renovateCheck),
    },
    anomalies: index.anomalies,
    branches: versionBranches,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const { values } = parseArgs({
    options: {
      readme: { type: 'string', default: 'README.md' },
      out: { type: 'string', default: 'dashboard/_site/data.json' },
      days: { type: 'string', default: '30' },
      concurrency: { type: 'string', default: '4' },
      only: { type: 'string', multiple: true },
    },
  });
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error('Set GITHUB_TOKEN (or GH_TOKEN) to a token that can read the SDK repositories.');

  let fleet = parseFleet(await readFile(values.readme, 'utf8'));
  if (values.only) fleet = fleet.filter((sdk) => values.only.includes(sdk.repo));
  if (fleet.length === 0) throw new Error(`No SDK repositories found in ${values.readme}.`);

  const now = Date.now();
  const days = Number(values.days);
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const gh = createClient({ token });

  const repos = await mapLimit(fleet, Number(values.concurrency), async (sdk) => {
    try {
      return { ...sdk, ...(await collectRepo(gh, sdk, { since, now })) };
    } catch (error) {
      console.error(`${sdk.repo}: ${error.message}`);
      return { ...sdk, url: `https://github.com/${sdk.repo}`, error: error.status ? `GitHub API ${error.status}` : error.message };
    }
  });
  // Keep the previously deployed snapshot rather than publishing an empty one.
  if (repos.every((repo) => repo.error)) throw new Error('Every repository failed; refusing to write a snapshot.');

  const server = process.env.GITHUB_SERVER_URL;
  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    windowDays: days,
    since,
    source:
      server && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
    api: gh.stats(),
    repos,
  };
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${values.out}: ${repos.length} SDKs, ${snapshot.api.requests} API requests, ${snapshot.api.rateLimit.remaining} remaining.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
