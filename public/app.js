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

}
