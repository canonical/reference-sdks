import {
  LABELS,
  branchProblems,
  publishStale,
  relativeTime,
  repoProblems,
  safeUrl,
  stageState,
  summarize,
  tone,
} from './model.js';

const TILES = [
  ['build', 'Build failures', 'branches'],
  ['tests', 'Test failures', 'branches'],
  ['publish', 'Store publish failures', 'branches'],
  ['renovate', 'Renovate issues', 'SDKs'],
];

const state = { data: null, search: '', problemsOnly: false, problem: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function link(href, ...children) {
  const url = safeUrl(href);
  return url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, ...children) : el('span', {}, ...children);
}

function badge(stateName, { label, href, title, prefix } = {}) {
  const text = label ?? LABELS[stateName] ?? stateName ?? '—';
  const node = el('span', { class: `badge ${tone(stateName)}`, title: title ?? null }, prefix ? el('b', { text: prefix }) : null, text);
  return href ? link(href, node) : node;
}

function runTitle(run, stage) {
  if (!run) return 'No run in the collection window';
  const platforms = Object.entries(run.stages?.[stage]?.platforms ?? {})
    .map(([platform, s]) => `${platform}: ${LABELS[s] ?? s}`)
    .join('\n');
  return [`${run.event} on ${run.headBranch} by ${run.actor ?? 'unknown'}`, `started ${relativeTime(run.createdAt)}`, platforms]
    .filter(Boolean)
    .join('\n');
}

function stageBadge(run, stage, prefix) {
  const s = stageState(run, stage);
  let label = LABELS[s] ?? s;
  if (['queued', 'waiting', 'pending'].includes(s) && run) label = `${label} ${relativeTime(run.createdAt).replace(' ago', '')}`;
  return badge(s, { label, prefix, href: run?.url, title: runTitle(run, stage) });
}

function sdkCell(repo, rowspan) {
  const dashboard = repo.renovate?.dashboard;
  const notes = [];
  if (repo.error) notes.push(badge('failure', { label: `collection failed: ${repo.error}` }));
  if (dashboard) {
    const errored = dashboard.sections?.Errored ?? 0;
    const issues = dashboard.problems.length + errored;
    notes.push(
      badge(issues ? 'failure' : 'success', {
        label: issues ? `dependency dashboard: ${issues} problem${issues > 1 ? 's' : ''}` : 'dependency dashboard',
        href: dashboard.url,
        title: [...dashboard.problems, ...Object.entries(dashboard.sections).map(([k, v]) => `${k}: ${v}`)].join('\n') || 'No problems reported',
      }),
    );
    if (dashboard.duplicates.length) notes.push(badge('cancelled', { label: `${dashboard.duplicates.length} stale dashboard issue(s)`, href: dashboard.duplicates[0] }));
  } else if (!repo.error) {
    notes.push(badge('none', { label: 'no dependency dashboard' }));
  }
  if (repo.renovate?.lastRun) notes.push(badge(repo.renovate.lastRun.state, { prefix: 'renovate.yml', href: repo.renovate.lastRun.url, title: relativeTime(repo.renovate.lastRun.at) }));
  if (repo.renovate?.lastCheck) notes.push(badge(repo.renovate.lastCheck.state, { prefix: 'renovate-check', href: repo.renovate.lastCheck.url, title: relativeTime(repo.renovate.lastCheck.at) }));
  for (const anomaly of repo.anomalies ?? []) {
    notes.push(
      badge(anomaly.kind, {
        prefix: anomaly.workflow,
        label: `${LABELS[anomaly.kind]}${anomaly.branch ? ` (${anomaly.branch})` : ''}`,
        href: anomaly.url,
        title: `${relativeTime(anomaly.at)} by ${anomaly.actor ?? 'unknown'}`,
      }),
    );
  }
  return el(
    'th',
    { scope: 'rowgroup', rowspan, class: 'sdk' },
    link(repo.url, repo.name),
    el('div', { class: 'repo', text: repo.repo }),
    el('div', { class: 'category', text: repo.category }),
    el('div', { class: 'notes' }, notes),
  );
}

function renovateCell(branch) {
  if (branch.renovatePrs.length === 0) return el('td', {}, el('span', { class: 'muted', text: 'none open' }));
  return el(
    'td',
    {},
    el(
      'div',
      { class: 'stack' },
      branch.renovatePrs.map((pr) =>
        badge(pr.ci, {
          prefix: `#${pr.number}`,
          href: pr.url,
          title: `${pr.title}\nopened ${relativeTime(pr.createdAt)} by ${pr.author}`,
        }),
      ),
    ),
  );
}

function publishCell(branch) {
  const release = branch.release;
  const platforms = Object.entries(release?.stages?.publish.platforms ?? {});
  const failing = platforms.filter(([, s]) => tone(s) === 'bad').map(([p]) => p);
  return el(
    'td',
    {},
    el(
      'div',
      { class: 'stack' },
      stageBadge(release, 'publish', 'Latest'),
      failing.length ? el('span', { class: 'small bad-text', text: failing.join(', ') }) : null,
      publishStale(branch) ? badge('failure', { label: `failed ${relativeTime(branch.lastPublishFailure.at)}`, href: branch.lastPublishFailure.url }) : null,
    ),
  );
}

function lastPublishedCell(branch) {
  const published = branch.lastPublished;
  if (!published) return el('td', {}, el('span', { class: 'bad-text', text: 'never (in lookback)' }));
  const title = Object.entries(published.platforms)
    .map(([platform, p]) => `${platform}: ${relativeTime(p.at)}`)
    .join('\n');
  const ageDays = (Date.now() - Date.parse(published.at)) / 86400000;
  return el('td', { title }, link(published.url, el('span', { class: ageDays > 60 ? 'warn-text' : '', text: relativeTime(published.at) })));
}

function dots(runs) {
  return el(
    'span',
    { class: 'dots' },
    [...runs].reverse().map((run) => link(run.url, el('span', { class: `dot ${tone(run.state)}`, title: `${LABELS[run.state] ?? run.state} — ${relativeTime(run.at)}` }))),
  );
}

function failureRow(branch, columns) {
  const failures = [
    ...(branch.pr?.failures ?? []).map((f) => ['PR', f]),
    ...(branch.release?.failures ?? []).map((f) => ['Release', f]),
  ].filter(([, f]) => f.conclusion !== 'cancelled' || f.messages.length);
  if (failures.length === 0) return null;
  return el(
    'tr',
    { class: 'failures' },
    el(
      'td',
      { colspan: columns },
      el(
        'details',
        {},
        el('summary', { text: `${failures.length} failing job${failures.length > 1 ? 's' : ''}` }),
        el(
          'ul',
          {},
          failures.map(([source, f]) =>
            el(
              'li',
              {},
              el('b', { text: `${source}: ` }),
              link(f.url, f.step ? `${f.step}` : f.job),
              el('span', { class: 'muted', text: ` (${f.job})` }),
              f.messages.length ? el('pre', { text: f.messages.join('\n') }) : null,
            ),
          ),
        ),
      ),
    ),
  );
}

function matches(repo, branch) {
  const query = state.search.trim().toLowerCase();
  if (query && ![repo.name, repo.repo, repo.category, branch?.name].some((v) => v?.toLowerCase().includes(query))) return false;
  const problems = new Set([...repoProblems(repo), ...(branch ? branchProblems(repo, branch) : [])]);
  if (state.problem) return problems.has(state.problem);
  if (state.problemsOnly) return problems.size > 0;
  return true;
}

function render() {
  const { data } = state;
  const tbody = document.querySelector('#dashboard tbody');
  const rows = [];
  const columns = document.querySelectorAll('#dashboard thead th').length;
  for (const repo of data.repos) {
    const branches = (repo.branches ?? []).filter((branch) => matches(repo, branch));
    if (branches.length === 0) {
      if ((repo.branches ?? []).length === 0 && matches(repo, null)) {
        rows.push(el('tr', { class: 'group-start' }, sdkCell(repo, 1), el('td', { colspan: columns - 1, class: 'muted', text: repo.error ? '' : 'No version branches found' })));
      }
      continue;
    }
    const groupRows = [];
    branches.forEach((branch, i) => {
      const row = el(
        'tr',
        { class: [i === 0 ? 'group-start' : '', branch.tracked === false ? 'untracked' : ''].join(' ').trim() || null },
        el(
          'td',
          { class: 'branch' },
          link(`${repo.url}/tree/${encodeURIComponent(branch.name)}`, branch.name),
          branch.tracked === false ? el('div', { class: 'small muted', text: 'not in LONG_TERM_BRANCHES' }) : null,
        ),
        renovateCell(branch),
        el('td', {}, el('div', { class: 'stack' }, stageBadge(branch.pr, 'build', 'PR'), stageBadge(branch.release, 'build', 'Release'))),
        el(
          'td',
          {},
          el(
            'div',
            { class: 'stack' },
            stageBadge(branch.pr, 'tests', 'PR'),
            stageBadge(branch.release, 'tests', 'Release'),
            branch.hasTests ? null : el('span', { class: 'small muted', text: 'no tests/spread.yaml' }),
          ),
        ),
        publishCell(branch),
        lastPublishedCell(branch),
        el('td', {}, el('div', { class: 'stack' }, el('span', {}, el('b', { class: 'small', text: 'PR ' }), dots(branch.history.pr)), el('span', {}, el('b', { class: 'small', text: 'Rel ' }), dots(branch.history.release)))),
      );
      groupRows.push(row);
      const failures = failureRow(branch, columns - 1);
      if (failures) groupRows.push(failures);
    });
    groupRows[0].prepend(sdkCell(repo, groupRows.length));
    rows.push(...groupRows);
  }
  if (rows.length === 0) rows.push(el('tr', {}, el('td', { colspan: columns, class: 'muted', text: 'Nothing matches the current filter.' })));
  tbody.replaceChildren(...rows);
  document.querySelector('#active-filter').replaceChildren(
    state.problem ? el('button', { type: 'button', id: 'clear-filter', text: `Showing ${state.problem} problems — clear` }) : '',
  );
  document.querySelector('#clear-filter')?.addEventListener('click', () => setProblem(null));
  for (const tile of document.querySelectorAll('.tile')) tile.setAttribute('aria-pressed', String(tile.dataset.problem === state.problem));
}

function setProblem(problem) {
  state.problem = state.problem === problem ? null : problem;
  render();
}

function renderHeader() {
  const { data } = state;
  const summary = summarize(data.repos);
  const meta = document.querySelector('#meta');
  meta.replaceChildren(
    `${summary.sdks} SDKs, ${summary.branches} version branches. Updated ${relativeTime(data.generatedAt)} (${new Date(data.generatedAt).toUTCString()}); `,
    `runs since ${data.since}. `,
    data.source ? link(data.source, 'Collection run') : '',
    summary.counts.collection ? el('span', { class: 'bad-text', text: ` — ${summary.counts.collection} SDK(s) could not be collected` }) : '',
  );
  document.querySelector('#tiles').replaceChildren(
    ...TILES.map(([problem, label, unit]) =>
      el(
        'button',
        { type: 'button', class: `tile ${summary.counts[problem] ? 'bad' : 'ok'}`, 'data-problem': problem, 'aria-pressed': 'false' },
        el('span', { class: 'count', text: summary.counts[problem] }),
        el('span', { class: 'label', text: `${label}` }),
        el('span', { class: 'unit', text: unit }),
      ),
    ),
  );
  for (const tile of document.querySelectorAll('.tile')) tile.addEventListener('click', () => setProblem(tile.dataset.problem));
  document.querySelector('#legend').replaceChildren(
    ...['success', 'failure', 'setup_failure', 'startup_failure', 'action_required', 'missing', 'in_progress', 'cancelled', 'skipped'].map((s) =>
      el('li', {}, badge(s), ` ${s}`),
    ),
  );
}

async function main() {
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  state.data = await res.json();
  const params = new URLSearchParams(location.search);
  state.search = params.get('q') ?? '';
  state.problemsOnly = params.has('problems');
  document.querySelector('#search').value = state.search;
  document.querySelector('#problems-only').checked = state.problemsOnly;
  document.querySelector('#search').addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
  });
  document.querySelector('#problems-only').addEventListener('change', (event) => {
    state.problemsOnly = event.target.checked;
    render();
  });
  renderHeader();
  render();
}

main().catch((error) => {
  document.querySelector('#meta').textContent = `Failed to load dashboard data: ${error.message}`;
});
