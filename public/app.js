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


}
