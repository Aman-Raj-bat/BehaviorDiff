const state = {
  scenarios: [],
  runs: [],
  model: null,
  selectedScenario: '',
  selectedStep: null,
  copyPayloads: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const main = $('#main-content');
const scenarioSelect = $('#scenario-select');
const scenarioDetail = $('#scenario-detail');
const runForm = $('#run-form');
const runButton = $('#run-button');
const runStatus = $('#run-status');
const maxAttempts = $('#max-attempts');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pretty(value) {
  if (value === undefined) return '<span class="unavailable">Unavailable</span>';
  return escapeHtml(JSON.stringify(value, null, 2));
}

function display(value, fallback = 'Unavailable') {
  return value === null || value === undefined || value === '' ? `<span class="unavailable">${fallback}</span>` : escapeHtml(value);
}

function outcomeClass(outcome) {
  return String(outcome ?? '').toLowerCase();
}

function outcomeBadge(outcome) {
  return `<span class="outcome-badge ${outcomeClass(outcome)}">${display(outcome)}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  return body;
}

function setRunStatus(message, { error = false } = {}) {
  runStatus.textContent = message;
  runStatus.classList.toggle('error', error);
}

function selectedMode() {
  return new FormData(runForm).get('mode') ?? 'run';
}

function updateModeControls() {
  const shrinking = selectedMode() === 'shrink';
  maxAttempts.disabled = !shrinking;
}

function renderScenarioOptions() {
  scenarioSelect.innerHTML = '<option value="">Choose a scenario…</option>';
  for (const scenario of state.scenarios) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.id;
    scenarioSelect.append(option);
  }
  if (state.selectedScenario) scenarioSelect.value = state.selectedScenario;
  renderScenarioDetail();
}

function renderScenarioDetail() {
  const scenario = state.scenarios.find((item) => item.id === scenarioSelect.value);
  if (!scenario) {
    scenarioDetail.innerHTML = '<span>Select a checked-in scenario.</span>';
    return;
  }
  scenarioDetail.innerHTML = [
    `<strong>${escapeHtml(scenario.name)}</strong>`,
    `<span>${escapeHtml(scenario.reference)} → ${escapeHtml(scenario.candidate)}</span>`,
    `<span>${scenario.stepCount} original steps</span>`,
  ].join('');
}

function renderRecentRuns() {
  const container = $('#recent-runs');
  if (state.runs.length === 0) {
    container.innerHTML = '<span class="muted">No completed runs yet.</span>';
    return;
  }
  container.innerHTML = state.runs.slice(0, 8).map((run) => `
    <button class="recent-run" type="button" data-run-id="${escapeHtml(run.runId)}">
      <span class="run-pill ${outcomeClass(run.outcome)}">${escapeHtml(run.outcome)}</span>
      <strong>${display(run.scenarioName)}</strong>
      <small>${display(run.runId)}${run.minimizedStepCount === null ? '' : ` · ${run.minimizedStepCount} steps`}</small>
    </button>
  `).join('');
}

async function refreshRuns() {
  try {
    const body = await api('/api/runs');
    state.runs = body.runs ?? [];
    renderRecentRuns();
  } catch (error) {
    renderRecentRuns();
  }
}

async function loadScenarios() {
  try {
    const body = await api('/api/scenarios');
    state.scenarios = body.scenarios ?? [];
    if (!state.selectedScenario) state.selectedScenario = state.scenarios[0]?.id ?? '';
    renderScenarioOptions();
  } catch (error) {
    scenarioSelect.innerHTML = '<option value="">Scenario catalog unavailable</option>';
    setRunStatus(error.message, { error: true });
  }
}

function fieldValue(value) {
  return value === null || value === undefined ? '<span class="unavailable">Unavailable</span>' : escapeHtml(value);
}

function serviceCard(service, role) {
  const readiness = service?.ready === true
    ? '<span class="state-ready">ready</span>'
    : service?.ready === false ? '<span class="state-no">not ready</span>' : '<span class="unavailable">Unavailable</span>';
  return `
    <div class="service-card">
      <div><span class="service-name">${fieldValue(service?.fixture)}</span><span class="service-role">${role}</span></div>
      <div class="service-meta"><span>${readiness}</span><span>reset: ${service?.reset === true ? 'yes' : service?.reset === false ? 'no' : '—'}</span><span>pid: ${fieldValue(service?.pid)}</span></div>
    </div>
  `;
}

function metric(label, value, sub = '', extraClass = '') {
  return `<div class="metric-card ${extraClass}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${value}</strong>${sub ? `<span class="metric-sub">${sub}</span>` : ''}</div>`;
}

function countValue(value) {
  return value === null || value === undefined ? '<span class="unavailable">—</span>' : escapeHtml(value);
}

function targetCard(model) {
  const mismatch = model.mismatch;
  const pass = model.outcome === 'PASS';
  return `
    <div class="target-card ${pass ? 'pass-target' : ''}">
      <h4>${pass ? 'No business mismatch recorded' : model.outcome === 'INCONCLUSIVE' ? 'Mismatch target unavailable' : 'Exact target mismatch'}</h4>
      ${mismatch ? `<div class="target-signature">
        <div class="target-field"><label>Step ID</label><code>${display(mismatch.stepId)}</code></div>
        <div class="target-field"><label>JSON Pointer</label><code class="path">${display(mismatch.pointer)}</code></div>
        <div class="target-field"><label>Class</label><code>${display(mismatch.classification)}</code></div>
      </div>` : '<p>No mismatch signature is available in this evidence.</p>'}
      ${model.reason ? `<p>${escapeHtml(model.reason.code ?? 'Run reason')}: ${escapeHtml(model.reason.message ?? 'Details unavailable')}</p>` : ''}
    </div>
  `;
}

function encodePointerPart(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPointer(parent, part) {
  return `${parent}/${encodePointerPart(part)}`;
}

function pointerSet(entries) {
  return new Set((entries ?? []).map((entry) => entry?.pointer).filter((pointer) => typeof pointer === 'string'));
}

function primitive(value) {
  if (value && typeof value === 'object' && value.$missing === true) return '<span class="json-missing">&lt;missing&gt;</span>';
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'string') return `<span class="json-string">&quot;${escapeHtml(value)}&quot;</span>`;
  if (typeof value === 'number') return `<span class="json-number">${escapeHtml(value)}</span>`;
  if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
  return `<span>${escapeHtml(JSON.stringify(value))}</span>`;
}

function jsonTree(value, pointer, depth, differences, ignoredDifferences, label = '') {
  const marker = differences.has(pointer) ? 'diff-node' : ignoredDifferences.has(pointer) ? 'ignored-node' : '';
  const labelHtml = label ? `<span class="json-key">${escapeHtml(label)}:</span> ` : '';
  if (value === undefined) return `<div class="json-line ${marker}" style="--depth:${depth}">${labelHtml}<span class="unavailable">Unavailable</span></div>`;
  if (value === null || typeof value !== 'object' || value.$missing === true) {
    return `<div class="json-line ${marker}" style="--depth:${depth}">${labelHtml}${primitive(value)}</div>`;
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  if (entries.length === 0) {
    return `<div class="json-line ${marker}" style="--depth:${depth}">${labelHtml}<span class="json-punctuation">${Array.isArray(value) ? '[]' : '{}'}</span></div>`;
  }
  const open = Array.isArray(value) ? '[' : '{';
  const close = Array.isArray(value) ? ']' : '}';
  let html = `<div class="json-line ${marker}" style="--depth:${depth}">${labelHtml}<span class="json-punctuation">${open}</span></div>`;
  entries.forEach(([key, child], index) => {
    const childLabel = Array.isArray(value) ? String(key) : String(key);
    html += jsonTree(child, childPointer(pointer, key), depth + 1, differences, ignoredDifferences, childLabel);
    if (index < entries.length - 1) {
      // The tree is intentionally line-oriented; commas are visual only and the displayed value remains the evidence body.
      html += `<div class="json-line" style="--depth:${depth + 1}"><span class="json-punctuation">,</span></div>`;
    }
  });
  html += `<div class="json-line" style="--depth:${depth}"><span class="json-punctuation">${close}</span></div>`;
  return html;
}

function responseMetadata(response) {
  if (!response) return '';
  const headers = response.headers ?? {};
  const values = [];
  if (response.durationMs !== undefined) values.push(`${escapeHtml(response.durationMs)} ms`);
  if (headers['content-type']) values.push(escapeHtml(headers['content-type']));
  if (headers['x-behavior-diff-fixture']) values.push(escapeHtml(headers['x-behavior-diff-fixture']));
  return values.join('<span>·</span>') || '<span class="unavailable">Metadata unavailable</span>';
}

function responsePane(side, data, differences, ignoredDifferences) {
  const response = data?.response;
  const status = response?.status;
  const statusClass = status >= 200 && status < 400 ? 'ok' : status === undefined ? '' : 'bad';
  const request = data?.request;
  const body = response?.body;
  return `
    <div class="response-pane">
      <div class="response-pane-header"><strong>${side === 'reference' ? 'REFERENCE' : 'CANDIDATE'}</strong><span class="status-code ${statusClass}">${status === undefined ? 'HTTP —' : `HTTP ${escapeHtml(status)}`}</span></div>
      ${request ? `<div class="response-meta"><span>${escapeHtml(request.method ?? 'METHOD —')}</span><span>${escapeHtml(request.path ?? 'Path unavailable')}</span></div>` : ''}
      <div class="response-meta">${responseMetadata(response)}</div>
      <div class="response-body">${response ? `<div class="json-tree">${jsonTree(body, '', 0, differences, ignoredDifferences)}</div>` : data?.error ? `<div class="unavailable">${escapeHtml(data.error.code ?? 'Replay error')}: ${escapeHtml(data.error.message ?? 'Details unavailable')}</div>` : '<div class="unavailable">Response unavailable</div>'}</div>
    </div>
  `;
}

function diffPanel(title, differences, className = '') {
  if (!differences || differences.length === 0) return '';
  return `
    <div class="diff-panel ${className}">
      <div class="diff-panel-header">${escapeHtml(title)}</div>
      ${differences.map((difference) => `<div class="diff-row">
        <div class="diff-pointer">${display(difference.pointer)}</div>
        <div class="diff-value reference">${pretty(difference.reference)}</div>
        <div class="diff-value candidate">${pretty(difference.candidate)}</div>
      </div>`).join('')}
    </div>
  `;
}

function responseComparison(model) {
  const steps = model.steps ?? [];
  if (steps.length === 0) {
    return `<section class="section"><div class="section-title"><h3>Response comparison</h3></div><div class="notice">No paired response steps were recorded. This run is ${escapeHtml(model.outcome)}; response bodies are unavailable.</div></section>`;
  }
  const mismatchStep = model.mismatch?.stepId;
  const selected = state.selectedStep && steps.some((step) => step.id === state.selectedStep)
    ? state.selectedStep
    : mismatchStep && steps.some((step) => step.id === mismatchStep) ? mismatchStep : steps[0].id;
  state.selectedStep = selected;
  const step = steps.find((item) => item.id === selected) ?? steps[0];
  const comparison = step.comparison ?? {};
  const differences = comparison.differences ?? [];
  const ignored = comparison.ignoredDifferences ?? [];
  const diffPointers = pointerSet(differences.filter((entry) => entry.pointer !== '$status'));
  const ignoredPointers = pointerSet(ignored);
  return `
    <section class="section">
      <div class="section-title"><h3>Response comparison</h3><p>Recorded paired responses, not re-created summaries</p></div>
      <div class="step-tabs">${steps.map((item) => `<button type="button" class="step-tab ${item.id === selected ? 'selected' : ''} ${item.comparison?.differences?.length ? 'has-diff' : ''}" data-step-id="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button>`).join('')}</div>
      <div class="comparison-head"><strong>${escapeHtml(step.id ?? 'Step unavailable')}</strong><span>expected HTTP ${step.expectedStatus === undefined ? '—' : escapeHtml(step.expectedStatus)}</span></div>
      <div class="response-grid">
        ${responsePane('reference', step.reference, diffPointers, ignoredPointers)}
        ${responsePane('candidate', step.candidate, diffPointers, ignoredPointers)}
      </div>
      ${diffPanel('Business and status differences', differences)}
      ${diffPanel('Ignored differences / explicitly excluded paths', ignored, 'ignored-panel')}
      ${comparison.ignoredPaths?.length ? `<div class="footer-note">Ignored paths configured for this step: ${comparison.ignoredPaths.map((path) => `<code>${escapeHtml(path)}</code>`).join(', ')}</div>` : ''}
    </section>
  `;
}

function shrinkChip(label, value) {
  return `<div class="shrink-chip"><label>${escapeHtml(label)}</label><strong>${value}</strong></div>`;
}

function attemptResult(attempt) {
  if (attempt.result === null) return '<span class="attempt-result unavailable">UNAVAILABLE</span>';
  return `<span class="attempt-result ${attempt.result === 'ACCEPTED' ? 'accepted' : 'rejected'}">${escapeHtml(attempt.result)}</span>`;
}

function attemptTable(attempts, available) {
  if (!available) return '<div class="notice">Reduction attempt records are unavailable in this evidence.</div>';
  if (attempts.length === 0) return '<div class="notice">No reduction attempts were recorded. The baseline may have consumed the full budget.</div>';
  return `<div class="attempts-wrap"><table class="attempt-table"><thead><tr><th>#</th><th>Operation</th><th>Candidate</th><th>Replay</th><th>Decision</th><th>Recorded reason</th></tr></thead><tbody>${attempts.map((attempt) => `
    <tr>
      <td><code>${attempt.attempt === null ? '—' : escapeHtml(attempt.attempt)}</code></td>
      <td><span class="attempt-operation">${display(attempt.operation)}</span><br><code>${display(attempt.location)}</code></td>
      <td>${attempt.candidateStepCount === null ? '<span class="unavailable">—</span>' : escapeHtml(attempt.candidateStepCount)} steps</td>
      <td>${attempt.replayed === null ? '<span class="unavailable">Unavailable</span>' : attempt.replayed ? '<span class="state-ready">yes</span>' : '<span class="muted">no</span>'}</td>
      <td>${attemptResult(attempt)}</td>
      <td class="attempt-reason">${display(attempt.reason)}${attempt.metadata?.error ? `<br><small>${escapeHtml(attempt.metadata.error)}</small>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function shrinkInvestigation(model) {
  const reduction = model.reduction;
  if (!reduction) return '';
  const original = model.scenarios.original;
  const minimized = model.scenarios.minimized;
  const minimal = reduction.minimalUnderOperations === true
    ? '<strong>Minimal under implemented operations.</strong> Greedy step deletion and bounded scalar simplification completed; this is not a proof of a globally optimal minimum.'
    : '<strong>Minimality unavailable.</strong> The evidence does not claim a globally optimal minimum.';
  return `
    <section class="section">
      <div class="section-title"><h3>Shrinking investigation</h3><p>Every decision below is copied from reduction evidence</p></div>
      <div class="shrink-summary">
        ${shrinkChip('Status', display(reduction.status))}
        ${shrinkChip('Original steps', countValue(reduction.originalStepCount))}
        ${shrinkChip('Final steps', countValue(reduction.finalStepCount))}
        ${shrinkChip('Attempts used', reduction.attemptsUsed === null || reduction.maxAttempts === null ? '<span class="unavailable">—</span>' : `${escapeHtml(reduction.attemptsUsed)} / ${escapeHtml(reduction.maxAttempts)}`)}
        ${shrinkChip('Actual replays', countValue(reduction.actualReplays))}
        ${shrinkChip('Accepted operations', countValue(reduction.acceptedOperations))}
      </div>
      <p class="minimal-note">${minimal}</p>
      <div class="scenario-columns">
        <div class="scenario-panel"><h4>Original scenario · ${original?.steps?.length ?? '—'} steps</h4><pre>${pretty(original)}</pre></div>
        <div class="scenario-panel"><h4>Minimized scenario · ${minimized?.steps?.length ?? '—'} steps</h4><pre>${pretty(minimized)}</pre></div>
      </div>
      <div class="section-title" style="margin-top:22px"><h3>Reduction attempts</h3><p>Accepted is not inferred from a changed step count</p></div>
      ${attemptTable(reduction.attempts, reduction.attemptsAvailable)}
    </section>
  `;
}

function scenarioReplay(model) {
  const scenarioJson = model.copyPayloads?.scenario;
  const mismatchJson = model.copyPayloads?.mismatch;
  state.copyPayloads.set('scenario', scenarioJson);
  state.copyPayloads.set('command', model.copyPayloads?.replayCommand);
  state.copyPayloads.set('mismatch', mismatchJson);
  const replayAction = model.scenarios.minimized && model.runId && !model.runId.includes('/')
    ? `<button class="secondary-button" type="button" data-replay-run="${escapeHtml(model.runId)}">Replay minimized scenario</button>`
    : '';
  return `
    <section class="section">
      <div class="section-title"><h3>Scenario and replay evidence</h3><p>Portable artifacts from this run</p></div>
      <div class="heading-actions" style="justify-content:flex-start; margin-bottom:10px">${replayAction}</div>
      <div class="scenario-columns">
        <div class="scenario-panel">
          <div class="command-head"><strong>Minimized scenario JSON</strong><button class="copy-button" type="button" data-copy="scenario">Copy</button></div>
          <pre>${scenarioJson ? escapeHtml(scenarioJson) : '<span class="unavailable">Unavailable</span>'}</pre>
        </div>
        <div class="scenario-panel">
          <div class="command-head"><strong>Target mismatch</strong><button class="copy-button" type="button" data-copy="mismatch" ${mismatchJson ? '' : 'disabled'}>Copy</button></div>
          <pre>${mismatchJson ? escapeHtml(mismatchJson) : '<span class="unavailable">Unavailable</span>'}</pre>
        </div>
      </div>
      <div class="command-block" style="margin-top:9px">
        <div class="command-head"><strong>Recorded replay command</strong><button class="copy-button" type="button" data-copy="command" ${model.copyPayloads?.replayCommand ? '' : 'disabled'}>Copy</button></div>
        <pre>${model.copyPayloads?.replayCommand ? escapeHtml(model.copyPayloads.replayCommand) : '<span class="unavailable">Unavailable</span>'}</pre>
      </div>
      ${model.artifacts ? `<div class="artifact-links"><a href="${escapeHtml(model.artifacts.evidence)}" target="_blank" rel="noreferrer">evidence.json</a><a href="${escapeHtml(model.artifacts.minimizedScenario)}" target="_blank" rel="noreferrer">scenario.replay.json</a>${model.artifacts.originalScenario ? `<a href="${escapeHtml(model.artifacts.originalScenario)}" target="_blank" rel="noreferrer">scenario.original.json</a>` : ''}</div>` : '<div class="footer-note">Artifact paths unavailable.</div>'}
    </section>
  `;
}

function runDetails(model) {
  const run = model.run ?? {};
  return `<dl class="detail-list">
    <div><dt>Run ID</dt><dd>${display(model.runId)}</dd></div>
    <div><dt>Evidence schema</dt><dd>${model.raw?.schemaVersion === undefined ? '<span class="unavailable">Unavailable</span>' : escapeHtml(model.raw.schemaVersion)}</dd></div>
    <div><dt>Started</dt><dd>${display(run.startedAt)}</dd></div>
    <div><dt>Duration</dt><dd>${run.durationMs === undefined ? '<span class="unavailable">Unavailable</span>' : `${escapeHtml(run.durationMs)} ms`}</dd></div>
    <div><dt>Scenario SHA-256</dt><dd>${display(model.scenario.sha256)}</dd></div>
    <div><dt>Exit code</dt><dd>${model.exitCode === null ? '<span class="unavailable">Unavailable</span>' : escapeHtml(model.exitCode)}</dd></div>
  </dl>`;
}

function renderModel(model) {
  state.model = model;
  state.selectedStep = model.mismatch?.stepId ?? model.steps?.[0]?.id ?? null;
  const outcome = outcomeClass(model.outcome);
  const serviceReference = model.services?.reference;
  const serviceCandidate = model.services?.candidate;
  const stepCountLabel = model.reduction
    ? `${countValue(model.counts.originalStepCount)} → ${countValue(model.counts.minimizedStepCount)}`
    : countValue(model.counts.minimizedStepCount);
  const stepCountSub = model.reduction ? 'original → minimized' : 'recorded scenario steps';
  const replaySub = model.counts.actualReplays === null ? 'not recorded' : 'real HTTP evaluations';
  main.innerHTML = `
    <div class="run-view">
      <div class="run-heading">
        <div>
          ${outcomeBadge(model.outcome)}
          <h2>${display(model.scenario.name, 'Unnamed scenario')}</h2>
          <p>${display(serviceReference?.fixture)} <span class="muted">reference</span> <span class="muted">→</span> ${display(serviceCandidate?.fixture)} <span class="muted">candidate</span></p>
          <div class="run-id">${display(model.runId)}</div>
        </div>
        <div class="heading-actions">${model.outcome === 'REGRESSION' ? '<span class="muted" style="font-size:11px">Business difference recorded</span>' : model.outcome === 'PASS' ? '<span class="muted" style="font-size:11px">No unignored differences recorded</span>' : '<span class="muted" style="font-size:11px">Evidence is incomplete</span>'}</div>
      </div>

      <div class="metric-grid">
        ${metric('Outcome', `<span class="${outcome}">${escapeHtml(model.outcome)}</span>`, `exit ${model.exitCode === null ? '—' : escapeHtml(model.exitCode)}`)}
        ${metric(model.reduction ? 'Steps' : 'Scenario steps', stepCountLabel, stepCountSub)}
        ${metric('Actual replays', countValue(model.counts.actualReplays), replaySub)}
        ${metric(model.reduction ? 'Shrink attempts' : 'Shrink attempts', countValue(model.counts.attemptsUsed), model.reduction ? 'budget includes baseline' : 'not run')}
        ${metric('Target', model.mismatch ? `<code>${display(model.mismatch.pointer)}</code>` : '<span class="unavailable">Unavailable</span>', model.mismatch ? display(model.mismatch.stepId) : 'no mismatch signature', 'target')}
      </div>

      ${model.reason ? `<div class="notice"><strong>${escapeHtml(model.reason.code ?? 'Run reason')}</strong> — ${escapeHtml(model.reason.message ?? 'The evidence did not include a detail message.')}</div>` : ''}

      <div class="service-strip">${serviceCard(serviceReference, 'reference')} ${serviceCard(serviceCandidate, 'candidate')}</div>

      <div class="investigation-columns">
        <div>${responseComparison(model)}${shrinkInvestigation(model)}${scenarioReplay(model)}</div>
        <aside>
          <section class="section" style="margin-top:0"><div class="section-title"><h3>Mismatch signature</h3><p>Stable target</p></div>${targetCard(model)}</section>
          <section class="section"><div class="section-title"><h3>Run metadata</h3></div>${runDetails(model)}</section>
        </aside>
      </div>
      <div class="footer-note">Measured values come from the evidence artifact. “Unavailable” means the runner did not record that field; it is not a success signal.</div>
    </div>
  `;
  main.focus({ preventScroll: true });
}

async function loadRun(runId) {
  setRunStatus('Loading evidence…');
  try {
    const model = await api(`/api/runs/${encodeURIComponent(runId)}`);
    renderModel(model);
    setRunStatus(`Loaded ${model.outcome}`);
  } catch (error) {
    setRunStatus(error.message, { error: true });
  }
}

async function submitRun(event) {
  event.preventDefault();
  const scenario = scenarioSelect.value;
  if (!scenario) {
    setRunStatus('Choose a scenario first.', { error: true });
    return;
  }
  const mode = selectedMode();
  const body = { scenario, mode };
  if (mode === 'shrink') body.maxAttempts = Number(maxAttempts.value);
  runButton.disabled = true;
  setRunStatus(mode === 'shrink' ? 'Running baseline and verified reductions…' : 'Starting paired replay…');
  try {
    const model = await api('/api/runs', { method: 'POST', body: JSON.stringify(body) });
    state.selectedScenario = scenario;
    renderModel(model);
    await refreshRuns();
    setRunStatus(`${model.outcome} evidence loaded.`);
  } catch (error) {
    setRunStatus(error.message, { error: true });
  } finally {
    runButton.disabled = false;
  }
}

async function replayMinimized(runId) {
  const button = document.querySelector(`[data-replay-run="${CSS.escape(runId)}"]`);
  if (button) button.disabled = true;
  setRunStatus('Replaying the exported minimized scenario through the real fixtures…');
  try {
    const model = await api(`/api/runs/${encodeURIComponent(runId)}/replay`, { method: 'POST', body: '{}' });
    renderModel(model);
    setRunStatus(`Replay returned ${model.outcome}.`);
  } catch (error) {
    setRunStatus(error.message, { error: true });
    if (button) button.disabled = false;
  }
}

async function copyPayload(name, button) {
  const value = state.copyPayloads.get(name);
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch (error) {
    setRunStatus('Clipboard permission was unavailable; select the displayed content manually.', { error: true });
  }
}

document.addEventListener('click', (event) => {
  const stepButton = event.target.closest('[data-step-id]');
  if (stepButton && state.model) {
    state.selectedStep = stepButton.dataset.stepId;
    renderModel(state.model);
    return;
  }
  const runLink = event.target.closest('[data-run-id]');
  if (runLink) {
    loadRun(runLink.dataset.runId);
    return;
  }
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    copyPayload(copyButton.dataset.copy, copyButton);
    return;
  }
  const replayButton = event.target.closest('[data-replay-run]');
  if (replayButton) replayMinimized(replayButton.dataset.replayRun);
});

scenarioSelect.addEventListener('change', () => {
  state.selectedScenario = scenarioSelect.value;
  renderScenarioDetail();
});
runForm.addEventListener('change', updateModeControls);
runForm.addEventListener('submit', submitRun);
$('#refresh-runs').addEventListener('click', refreshRuns);

updateModeControls();
renderScenarioDetail();
loadScenarios();
refreshRuns();
