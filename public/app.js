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
const topbarScenarioSelect = $('#topbar-scenario-select');
const scenarioDetail = $('#scenario-detail');
const runForm = $('#run-form');
const runButton = $('#run-button');
const runStatus = $('#run-status');
const maxAttempts = $('#max-attempts');
const topbarContext = $('#topbar-context');
const emptyState = $('#empty-state');
const runView = $('#run-view');
const emptyRunButton = $('#empty-run-button');
const emptyMode = $('#empty-mode');

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

function getAuthToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token') || urlParams.get('auth_token');
  if (tokenFromUrl) {
    try { sessionStorage.setItem('behaviordiff_token', tokenFromUrl); } catch {}
    return tokenFromUrl;
  }
  try {
    return sessionStorage.getItem('behaviordiff_token');
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  const token = getAuthToken();
  if (token && !headers['authorization']) {
    headers['authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(path, {
    headers,
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window.prompt === 'function') {
      const promptToken = window.prompt('Authentication required: Enter your workbench authorization token:');
      if (promptToken) {
        try { sessionStorage.setItem('behaviordiff_token', promptToken.trim()); } catch {}
        headers['authorization'] = `Bearer ${promptToken.trim()}`;
        const retryResponse = await fetch(path, { headers, ...options });
        const retryBody = await retryResponse.json().catch(() => ({}));
        if (!retryResponse.ok) throw new Error(retryBody.error ?? `Request failed with HTTP ${retryResponse.status}`);
        return retryBody;
      }
    }
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  return body;
}

function setRunStatus(message, { error = false } = {}) {
  runStatus.textContent = message;
  runStatus.classList.toggle('error', error);
}

function setTopbarContext(model = null) {
  if (!topbarContext) return;
  if (!model) {
    const selected = state.scenarios.find((item) => item.id === scenarioSelect.value);
    topbarContext.innerHTML = `<span>CASE / READY</span><strong>${selected ? escapeHtml(selected.id) : 'NO SPECIMEN LOADED'}</strong>`;
    return;
  }
  const reference = model.services?.reference?.fixture ?? 'reference unavailable';
  const candidate = model.services?.candidate?.fixture ?? 'candidate unavailable';
  topbarContext.innerHTML = `<span>${escapeHtml(model.outcome)} / ${escapeHtml(model.runId ?? 'UNNUMBERED')}</span><strong>${escapeHtml(reference)} → ${escapeHtml(candidate)}</strong>`;
}

function selectedMode() {
  return new FormData(runForm).get('mode') ?? 'run';
}

function updateModeControls() {
  const shrinking = selectedMode() === 'shrink';
  maxAttempts.disabled = !shrinking;
  if (emptyMode) emptyMode.textContent = shrinking ? 'Shrink / verified reduction trace' : 'Compare / paired response run';
}

function renderScenarioOptions() {
  const options = ['<option value="">Choose a scenario…</option>', ...state.scenarios.map((scenario) => `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.id)}</option>`)].join('');
  scenarioSelect.innerHTML = options;
  topbarScenarioSelect.innerHTML = options.replace('Choose a scenario…', 'Select case…');
  if (state.selectedScenario) {
    scenarioSelect.value = state.selectedScenario;
    topbarScenarioSelect.value = state.selectedScenario;
  }
  renderScenarioDetail();
}

function renderScenarioDetail() {
  const scenario = state.scenarios.find((item) => item.id === scenarioSelect.value);
  if (!scenario) {
    scenarioDetail.innerHTML = '<span>Select a checked-in scenario.</span>';
    setTopbarContext();
    return;
  }
  scenarioDetail.innerHTML = [
    `<strong>${escapeHtml(scenario.name)}</strong>`,
    `<span>${escapeHtml(scenario.reference)} → ${escapeHtml(scenario.candidate)}</span>`,
    `<span>${scenario.stepCount} original steps</span>`,
  ].join('');
  if (!state.model) setTopbarContext();
}

function renderRecentRuns() {
  const container = $('#recent-runs');
  if (state.runs.length === 0) {
    container.innerHTML = '<span class="muted">No completed runs yet.</span>';
    return;
  }
  container.innerHTML = state.runs.slice(0, 8).map((run) => `
    <button class="recent-run" type="button" data-run-id="${escapeHtml(run.runId)}">
      <span class="recent-run-top"><span class="run-index">${String(state.runs.indexOf(run) + 1).padStart(2, '0')}</span><span class="run-pill ${outcomeClass(run.outcome)}">${escapeHtml(run.outcome)}</span></span>
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
    <div class="service-card ${role === 'reference' ? 'reference-service' : 'candidate-service'}">
      <div class="service-card-heading"><span class="service-swatch" aria-hidden="true"></span><span class="service-name">${fieldValue(service?.fixture)}</span><span class="service-role">${role}</span></div>
      <div class="service-meta"><span>${readiness}</span><span>reset: ${service?.reset === true ? 'yes' : service?.reset === false ? 'no' : '—'}</span><span>pid: ${fieldValue(service?.pid)}</span></div>
      <div class="service-url">${fieldValue(service?.baseUrl)}</div>
    </div>
  `;
}

function metric(label, value, sub = '', extraClass = '') {
  return `<div class="metric-card ${extraClass}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${value}</strong>${sub ? `<span class="metric-sub">${sub}</span>` : ''}</div>`;
}

function countValue(value) {
  return value === null || value === undefined ? '<span class="unavailable">—</span>' : escapeHtml(value);
}

function stepStatus(step) {
  if (!step) return 'inconclusive';
  if (step.comparison?.differences?.length) return 'mismatch';
  if (step.reference?.error || step.candidate?.error) return 'inconclusive';
  return 'verified';
}

function stepMethod(step) {
  return step?.request?.method ?? step?.requestTemplate?.method ?? step?.reference?.request?.method ?? '—';
}

function evidenceRail(model) {
  const originalSteps = model.reduction?.originalScenario?.steps ?? model.scenarios.original?.steps ?? model.steps ?? [];
  const finalIds = new Set((model.scenarios.minimized?.steps ?? model.steps ?? []).map((step) => step.id));
  const recorded = new Map((model.steps ?? []).map((step) => [step.id, step]));
  if (originalSteps.length === 0) {
    return `<section class="rail-panel evidence-rail"><div class="rail-panel-heading"><span class="section-index">TRACE</span><h3>Evidence rail</h3></div><div class="notice compact">No scenario steps were recorded.</div></section>`;
  }
  return `
    <section class="rail-panel evidence-rail" aria-label="Scenario evidence rail">
      <div class="rail-panel-heading"><span class="section-index">TRACE</span><h3>Evidence rail</h3><span class="rail-count">${originalSteps.length} steps</span></div>
      <p class="rail-panel-note">Same logical scenario, two executable paths.</p>
      <ol class="evidence-steps">
        ${originalSteps.map((template, index) => {
          const step = recorded.get(template.id);
          const removed = model.reduction && !finalIds.has(template.id);
          const status = removed ? 'removed' : stepStatus(step);
          const selected = state.selectedStep === template.id;
          return `<li class="evidence-step ${status} ${selected ? 'selected' : ''}">
            ${step ? `<button type="button" data-step-id="${escapeHtml(template.id)}" aria-label="Inspect step ${escapeHtml(template.id)}" aria-current="${selected ? 'step' : 'false'}">` : '<div>'}
              <span class="evidence-step-index">${String(index + 1).padStart(2, '0')}</span>
              <span class="evidence-step-body"><strong>${escapeHtml(template.id ?? 'Unnamed step')}</strong><small><b>${escapeHtml(stepMethod(template))}</b> ${escapeHtml(template.request?.path ?? step?.reference?.request?.path ?? 'path unavailable')}</small></span>
              <span class="evidence-step-signal" aria-label="${status}">${status === 'mismatch' ? 'Δ' : status === 'verified' ? '✓' : status === 'removed' ? '×' : '?'}</span>
            ${step ? '</button>' : '</div>'}
            ${index < originalSteps.length - 1 ? '<span class="evidence-connector" aria-hidden="true"></span>' : ''}
          </li>`;
        }).join('')}
      </ol>
      <div class="rail-legend"><span><i class="legend-dot verified"></i> verified</span><span><i class="legend-dot mismatch"></i> mismatch</span><span><i class="legend-dot removed"></i> removed</span></div>
    </section>
  `;
}

function inlineValue(value) {
  if (value === undefined) return '<span class="unavailable">Unavailable</span>';
  if (value && typeof value === 'object' && value.$missing === true) return '<span class="unavailable">&lt;missing&gt;</span>';
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
}

function mismatchSpecimen(model) {
  const mismatch = model.mismatch;
  const step = mismatch ? model.steps?.find((item) => item.id === mismatch.stepId) : null;
  const difference = step?.comparison?.differences?.find((item) => item.pointer === mismatch.pointer) ?? step?.comparison?.differences?.[0];
  const stateClass = model.outcome === 'PASS' ? 'verified-specimen' : model.outcome === 'INCONCLUSIVE' ? 'warning-specimen' : 'mismatch-specimen';
  if (!mismatch || !difference) {
    return `<section class="specimen ${stateClass}">
      <div class="specimen-topline"><span class="specimen-kicker">FINDING / ${model.outcome === 'PASS' ? 'CLEAR' : 'UNAVAILABLE'}</span><span class="specimen-step">${escapeHtml(model.outcome)}</span></div>
      <h3>${model.outcome === 'PASS' ? 'No business mismatch recorded.' : 'The target could not be isolated.'}</h3>
      <p>${model.reason ? `${escapeHtml(model.reason.code ?? 'Run reason')}: ${escapeHtml(model.reason.message ?? 'Evidence is incomplete.')}` : 'No unignored difference is present in the recorded evidence.'}</p>
    </section>`;
  }
  return `<section class="specimen ${stateClass}" aria-label="Exact mismatch specimen">
    <div class="specimen-topline"><span class="specimen-kicker">FINDING / ${escapeHtml(mismatch.classification)}</span><span class="specimen-step">step · ${escapeHtml(mismatch.stepId)}</span></div>
    <h3>One field. Two behaviors.</h3>
    <div class="specimen-reading">
      <div class="specimen-row reference-row"><span>REFERENCE</span>${inlineValue(difference.reference)}</div>
      <span class="specimen-arrow" aria-hidden="true">→</span>
      <div class="specimen-row candidate-row"><span>CANDIDATE</span>${inlineValue(difference.candidate)}</div>
    </div>
    <div class="specimen-path"><span>JSON POINTER</span><code>${escapeHtml(mismatch.pointer)}</code></div>
    <div class="specimen-caption">The values above are copied from the recorded response bodies. No estimate or summary substituted.</div>
  </section>`;
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

function jsonTree(value, pointer, depth, differences, ignoredDifferences, label = '', side = 'reference') {
  const marker = differences.has(pointer) ? `diff-node ${side}-diff` : ignoredDifferences.has(pointer) ? 'ignored-node' : '';
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
    html += jsonTree(child, childPointer(pointer, key), depth + 1, differences, ignoredDifferences, childLabel, side);
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
    <div class="response-pane ${side === 'reference' ? 'reference-pane' : 'candidate-pane'}">
      <div class="response-pane-header"><div class="response-title"><span class="response-swatch" aria-hidden="true"></span><strong>${side === 'reference' ? 'REFERENCE' : 'CANDIDATE'}</strong><small>${side === 'reference' ? 'expected behavior' : 'behavior under test'}</small></div><span class="status-code ${statusClass}">${status === undefined ? 'HTTP —' : `HTTP ${escapeHtml(status)}`}</span></div>
      ${request ? `<div class="response-meta"><span>${escapeHtml(request.method ?? 'METHOD —')}</span><span>${escapeHtml(request.path ?? 'Path unavailable')}</span></div>` : ''}
      <div class="response-meta">${responseMetadata(response)}</div>
      <div class="response-body">${response ? `<div class="json-tree">${jsonTree(body, '', 0, differences, ignoredDifferences, '', side)}</div>` : data?.error ? `<div class="unavailable">${escapeHtml(data.error.code ?? 'Replay error')}: ${escapeHtml(data.error.message ?? 'Details unavailable')}</div>` : '<div class="unavailable">Response unavailable</div>'}</div>
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
    return `<section class="section"><div class="section-title"><h3>Reference vs candidate</h3></div><div class="notice">No paired response steps were recorded. This run is ${escapeHtml(model.outcome)}; response bodies are unavailable.</div></section>`;
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
    <section class="section comparison-section">
      <div class="section-title"><div><span class="section-index">Compare / first view</span><h3>Reference vs candidate</h3></div><p>Recorded bodies, not re-created summaries</p></div>
      <div class="step-tabs" role="tablist" aria-label="Recorded scenario steps">${steps.map((item, index) => `<button type="button" role="tab" aria-selected="${item.id === selected}" class="step-tab ${item.id === selected ? 'selected' : ''} ${item.comparison?.differences?.length ? 'has-diff' : ''}" data-step-id="${escapeHtml(item.id)}"><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(item.id)}</button>`).join('')}</div>
      <div class="comparison-head"><div><span class="comparison-kicker">SELECTED STEP</span><strong>${escapeHtml(step.id ?? 'Step unavailable')}</strong></div><span>expected HTTP ${step.expectedStatus === undefined ? '—' : escapeHtml(step.expectedStatus)}</span></div>
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
  const kind = attempt.result === 'ACCEPTED'
    ? 'accepted'
    : attempt.reason === 'INCONCLUSIVE_REPLAY'
      ? 'uncertain'
      : attempt.reason === 'MISMATCH_SIGNATURE_CHANGED' ? 'changed' : 'rejected';
  return `<span class="attempt-result ${kind}"><i aria-hidden="true"></i>${escapeHtml(attempt.result)}</span>`;
}

function attemptTable(attempts, available) {
  if (!available) return '<div class="notice">Reduction attempt records are unavailable in this evidence.</div>';
  if (attempts.length === 0) return '<div class="notice">No reduction attempts were recorded. The baseline may have consumed the full budget.</div>';
  return `<div class="reduction-trace" role="list" aria-label="Actual reduction attempts">${attempts.map((attempt) => {
    const accepted = attempt.result === 'ACCEPTED';
    const uncertain = attempt.reason === 'INCONCLUSIVE_REPLAY';
    const changed = attempt.reason === 'MISMATCH_SIGNATURE_CHANGED';
    const tone = accepted ? 'accepted' : uncertain ? 'uncertain' : changed ? 'changed' : 'rejected';
    const operation = display(attempt.operation, 'Operation unavailable');
    const location = display(attempt.location, 'location unavailable');
    const candidateSteps = attempt.candidateStepCount === null ? '—' : escapeHtml(attempt.candidateStepCount);
    const replay = attempt.replayed === null ? 'not recorded' : attempt.replayed ? 'real replay' : 'validation only';
    return `<article class="trace-row ${tone}" role="listitem">
      <div class="trace-marker"><span>${attempt.attempt === null ? '—' : escapeHtml(attempt.attempt)}</span></div>
      <div class="trace-content">
        <div class="trace-head"><strong>${operation}</strong>${attemptResult(attempt)}</div>
        <div class="trace-detail"><code>${location}</code><span>${candidateSteps} steps</span><span>${replay}</span></div>
        <div class="trace-reason">${display(attempt.reason, 'Reason unavailable')}${attempt.metadata?.error ? `<span class="trace-error">${escapeHtml(attempt.metadata.error)}</span>` : ''}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function reductionOverview(reduction, original, minimized) {
  const originalSteps = Array.isArray(original?.steps) ? original.steps : [];
  const minimizedSteps = Array.isArray(minimized?.steps) ? minimized.steps : [];
  const minimizedIds = new Set(minimizedSteps.map((step) => step.id));
  const retained = originalSteps.filter((step) => minimizedIds.has(step.id));
  const removed = originalSteps.filter((step) => !minimizedIds.has(step.id));
  const originalCount = reduction.originalStepCount;
  const finalCount = reduction.finalStepCount;
  const fill = Number.isInteger(originalCount) && originalCount > 0 && Number.isInteger(finalCount)
    ? Math.max(0, Math.min(100, (finalCount / originalCount) * 100))
    : null;
  const signature = reduction.finalMismatchSignature ?? reduction.originalMismatchSignature;
  const stepList = (steps, emptyLabel) => steps.length > 0
    ? steps.map((step) => `<code>${escapeHtml(step.id ?? 'Unnamed step')}</code>`).join('')
    : `<span class="unavailable">${emptyLabel}</span>`;
  return `
    <div class="reduction-overview" aria-label="Evidence-backed reduction summary">
      <div class="reduction-counts">
        <div class="reduction-count original-count"><span>ORIGINAL</span><strong>${countValue(originalCount)}</strong><small>source sequence</small></div>
        <div class="reduction-arrow" aria-hidden="true">→</div>
        <div class="reduction-count final-count"><span>MINIMIZED</span><strong>${countValue(finalCount)}</strong><small>verified best</small></div>
      </div>
      <div class="reduction-bar" aria-label="${originalCount === null || finalCount === null ? 'Reduction size unavailable' : `${finalCount} of ${originalCount} steps retained`}" ${fill === null ? '' : `style="--reduction-fill: ${fill}%"`}><span></span></div>
      <div class="reduction-step-lists">
        <div><span>RETAINED / ${retained.length}</span><div>${stepList(retained, 'No retained steps recorded')}</div></div>
        <div><span>REMOVED / ${removed.length}</span><div>${stepList(removed, 'No removed steps recorded')}</div></div>
      </div>
      <div class="reduction-signature"><span>TARGET MISMATCH SIGNATURE</span><code>${signature ? `${escapeHtml(signature.stepId)} · ${escapeHtml(signature.pointer)} · ${escapeHtml(signature.classification)}` : 'Unavailable'}</code></div>
    </div>
  `;
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
    <section id="reduction-evidence" class="section reduction-section">
      <div class="section-title"><div><span class="section-index">Reduction trace</span><h3>${countValue(reduction.originalStepCount)} steps → ${countValue(reduction.finalStepCount)}</h3></div><p>Every decision below is copied from reduction evidence</p></div>
      <div class="shrink-summary">
        ${shrinkChip('Status', display(reduction.status))}
        ${shrinkChip('Original steps', countValue(reduction.originalStepCount))}
        ${shrinkChip('Final steps', countValue(reduction.finalStepCount))}
        ${shrinkChip('Attempts used', reduction.attemptsUsed === null || reduction.maxAttempts === null ? '<span class="unavailable">—</span>' : `${escapeHtml(reduction.attemptsUsed)} / ${escapeHtml(reduction.maxAttempts)}`)}
        ${shrinkChip('Attempt limit', countValue(reduction.maxAttempts))}
        ${shrinkChip('Actual replays', countValue(reduction.actualReplays))}
        ${shrinkChip('Accepted operations', countValue(reduction.acceptedOperations))}
        ${shrinkChip('Rejected operations', reduction.attemptsAvailable ? countValue(reduction.attempts.filter((attempt) => attempt.result === 'REJECTED').length) : '<span class="unavailable">—</span>')}
      </div>
      ${reductionOverview(reduction, original, minimized)}
      <div class="reduction-callout"><span class="callout-mark">↘</span><p>${minimal}</p></div>
      <div class="scenario-columns">
        <div class="scenario-panel original-scenario"><div class="scenario-panel-heading"><span class="paper-tab">SOURCE</span><h4>Original scenario <small>${original?.steps?.length ?? '—'} steps</small></h4></div><pre>${pretty(original)}</pre></div>
        <div class="scenario-panel minimized-scenario"><div class="scenario-panel-heading"><span class="paper-tab">VERIFIED</span><h4>Minimized scenario <small>${minimized?.steps?.length ?? '—'} steps</small></h4></div><pre>${pretty(minimized)}</pre></div>
      </div>
      <div class="trace-heading"><div><span class="section-index">ATTEMPT LOG</span><h4>Reduction attempts</h4></div><p>Accepted only after target replay</p></div>
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
    ? `<button class="secondary-button" type="button" data-replay-run="${escapeHtml(model.runId)}"><span aria-hidden="true">↻</span> ${model.reduction ? 'Replay minimized scenario' : 'Replay recorded scenario'}</button>`
    : '';
  const scenarioLabel = model.reduction ? 'Minimized scenario JSON' : 'Recorded scenario JSON';
  return `
    <section id="replay-evidence" class="section replay-section">
      <div class="section-title"><div><span class="section-index">Replay proof</span><h3>Scenario and replay evidence</h3></div><p>Portable artifacts from this run</p></div>
      <div class="heading-actions replay-actions">${replayAction}</div>
      <div class="scenario-columns">
        <div class="scenario-panel evidence-paper">
           <div class="command-head"><strong>${scenarioLabel}</strong><button class="copy-button" type="button" data-copy="scenario">Copy <span aria-hidden="true">↗</span></button></div>
          <pre>${scenarioJson ? escapeHtml(scenarioJson) : '<span class="unavailable">Unavailable</span>'}</pre>
        </div>
        <div class="scenario-panel evidence-paper">
          <div class="command-head"><strong>Target mismatch</strong><button class="copy-button" type="button" data-copy="mismatch" ${mismatchJson ? '' : 'disabled'}>Copy <span aria-hidden="true">↗</span></button></div>
          <pre>${mismatchJson ? escapeHtml(mismatchJson) : '<span class="unavailable">Unavailable</span>'}</pre>
        </div>
      </div>
      <div class="command-block replay-command">
        <div class="command-head"><strong>Recorded replay command</strong><button class="copy-button" type="button" data-copy="command" ${model.copyPayloads?.replayCommand ? '' : 'disabled'}>Copy <span aria-hidden="true">↗</span></button></div>
        <pre>${model.copyPayloads?.replayCommand ? escapeHtml(model.copyPayloads.replayCommand) : '<span class="unavailable">Unavailable</span>'}</pre>
      </div>
      ${model.artifacts ? `<div class="artifact-links"><span>ARTIFACTS</span><a href="${escapeHtml(model.artifacts.evidence)}" target="_blank" rel="noreferrer">evidence.json ↗</a><a href="${escapeHtml(model.artifacts.minimizedScenario)}" target="_blank" rel="noreferrer">scenario.replay.json ↗</a>${model.artifacts.originalScenario ? `<a href="${escapeHtml(model.artifacts.originalScenario)}" target="_blank" rel="noreferrer">scenario.original.json ↗</a>` : ''}</div>` : '<div class="footer-note">Artifact paths unavailable.</div>'}
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
    <div><dt>Input scenario SHA-256</dt><dd>${display(model.scenario.sha256)}</dd></div>
    <div><dt>Replay scenario SHA-256</dt><dd>${display(model.replay?.sha256)}</dd></div>
    <div><dt>Exit code</dt><dd>${model.exitCode === null ? '<span class="unavailable">Unavailable</span>' : escapeHtml(model.exitCode)}</dd></div>
  </dl>`;
}

function investigationProgress(model) {
  const hasResponses = (model.steps ?? []).length > 0;
  const hasMismatch = Boolean(model.mismatch);
  const reduction = model.reduction;
  const reductionComplete = reduction && ['COMPLETED', 'LIMIT_REACHED'].includes(reduction.status);
  const reductionDetail = reduction
    ? `${countValue(reduction.finalStepCount)} of ${countValue(reduction.originalStepCount)} steps · ${escapeHtml(reduction.status ?? 'status unavailable')}`
    : 'Not requested for this run';
  const replayedModel = model.runId?.includes('/') === true;
  const replayDetail = replayedModel
    ? `Independent replay returned ${escapeHtml(model.outcome)}`
    : hasResponses
      ? `${escapeHtml(model.counts.actualReplays === null ? 'paired response evidence recorded' : `${model.counts.actualReplays} real replays recorded`)}`
      : 'No paired response evidence';
  const steps = [
    {
      number: '01',
      label: 'Regression detected',
      detail: model.outcome === 'REGRESSION' ? 'Business difference recorded' : model.outcome === 'PASS' ? 'No unignored difference' : 'Evidence is incomplete',
      state: model.outcome === 'INCONCLUSIVE' ? 'warning' : 'complete',
    },
    {
      number: '02',
      label: 'Mismatch isolated',
      detail: hasMismatch ? `${escapeHtml(model.mismatch.stepId)} · ${escapeHtml(model.mismatch.pointer)}` : model.outcome === 'PASS' ? 'No mismatch signature' : 'Target unavailable',
      state: hasMismatch ? 'complete' : model.outcome === 'PASS' ? 'complete' : 'warning',
    },
    {
      number: '03',
      label: 'Scenario minimized',
      detail: reductionDetail,
      state: reductionComplete ? 'complete' : reduction ? 'warning' : 'muted',
    },
    {
      number: '04',
      label: 'Replay',
      detail: replayDetail,
      state: hasResponses && model.outcome !== 'INCONCLUSIVE' ? 'complete' : 'warning',
    },
    {
      number: '05',
      label: 'Verify',
      detail: model.outcome === 'PASS' ? 'No unignored differences' : hasMismatch && model.outcome === 'REGRESSION' ? 'Target signature retained' : 'Evidence incomplete',
      state: model.outcome === 'INCONCLUSIVE' ? 'warning' : hasMismatch || model.outcome === 'PASS' ? 'complete' : 'muted',
    },
  ];
  return `<nav class="investigation-progress" aria-label="Investigation progression">
    <div class="progress-heading"><span class="section-index">Investigation path</span><span>${escapeHtml(model.outcome)}</span></div>
    <ol>${steps.map((step) => `<li class="progress-step ${step.state}">
      <span class="progress-number">${step.number}</span>
      <span class="progress-copy"><strong>${step.label}</strong><small>${step.detail}</small></span>
    </li>`).join('')}</ol>
  </nav>`;
}

function renderModel(model) {
  const sameRun = state.model?.runId && state.model.runId === model.runId;
  state.model = model;
  state.selectedStep = sameRun && model.steps?.some((step) => step.id === state.selectedStep)
    ? state.selectedStep
    : model.mismatch?.stepId ?? model.steps?.[0]?.id ?? null;
  setTopbarContext(model);
  const outcome = outcomeClass(model.outcome);
  const serviceReference = model.services?.reference;
  const serviceCandidate = model.services?.candidate;
  const stepCountLabel = model.reduction
    ? `${countValue(model.counts.originalStepCount)} → ${countValue(model.counts.minimizedStepCount)}`
    : countValue(model.counts.minimizedStepCount);
  const stepCountSub = model.reduction ? 'original → minimized' : 'recorded scenario steps';
  const replaySub = model.counts.actualReplays === null ? 'not recorded' : 'real HTTP evaluations';
  runView.innerHTML = `
    <div class="run-view">
      <div class="run-heading">
        <div class="case-heading">
          <div class="case-overline"><span class="section-index">CASE / ${escapeHtml(model.runId ?? 'UNNUMBERED')}</span><span class="case-rule"></span><span>${model.reduction ? 'REDUCTION STUDY' : 'PAIRED REPLAY'}</span></div>
          ${outcomeBadge(model.outcome)}
          <h2>${display(model.scenario.name, 'Unnamed scenario')}</h2>
          <p class="run-subtitle"><span class="service-inline reference-inline">${display(serviceReference?.fixture)}</span><span>reference</span><span class="route-arrow">→</span><span class="service-inline candidate-inline">${display(serviceCandidate?.fixture)}</span><span>candidate</span></p>
        </div>
        <div class="heading-actions"><span class="execution-readout"><i class="readout-led ${outcome}"></i>${model.outcome === 'REGRESSION' ? 'BUSINESS DIFFERENCE RECORDED' : model.outcome === 'PASS' ? 'NO UNIGNORED DIFFERENCES' : 'EVIDENCE INCOMPLETE'}</span><span class="run-id">${display(model.runId)}</span></div>
      </div>

      <div class="metric-grid">
        ${metric('Outcome', `<span class="${outcome}">${escapeHtml(model.outcome)}</span>`, `exit ${model.exitCode === null ? '—' : escapeHtml(model.exitCode)}`)}
        ${metric(model.reduction ? 'Steps' : 'Scenario steps', stepCountLabel, stepCountSub)}
        ${metric('Actual replays', countValue(model.counts.actualReplays), replaySub)}
        ${metric('Mismatch target', model.mismatch ? `<code>${display(model.mismatch.pointer)}</code>` : '<span class="unavailable">Unavailable</span>', model.mismatch ? display(model.mismatch.stepId) : 'no mismatch signature', 'target')}
      </div>

      ${model.reason ? `<div class="notice"><strong>${escapeHtml(model.reason.code ?? 'Run reason')}</strong> — ${escapeHtml(model.reason.message ?? 'The evidence did not include a detail message.')}</div>` : ''}

      ${investigationProgress(model)}

      <section class="primary-layout" aria-label="Primary comparison workspace">
        <div class="primary-canvas">
          <div class="workspace-kicker"><span class="section-index">Primary investigation</span><span>Finding first · response proof below</span></div>
          ${mismatchSpecimen(model)}
          ${responseComparison(model)}
        </div>
        <aside class="supporting-column primary-support">
          <section class="signature-card" aria-label="Stable mismatch signature">
            <span class="section-index">Target / stable</span>
            <h3>Mismatch signature</h3>
            ${targetCard(model)}
          </section>
          <section class="rail-panel service-panel"><div class="rail-panel-heading"><span class="section-index">Pair</span><h3>Execution pair</h3></div><div class="service-stack">${serviceCard(serviceReference, 'reference')}${serviceCard(serviceCandidate, 'candidate')}</div></section>
          <section class="rail-panel metadata-panel"><div class="rail-panel-heading"><span class="section-index">Record</span><h3>Run metadata</h3></div>${runDetails(model)}</section>
        </aside>
      </section>

      <section class="secondary-workspace" aria-label="Secondary investigation evidence">
        <div class="secondary-heading">
          <div><span class="section-index">Secondary investigation</span><h3>Reduction and replay evidence</h3></div>
          <nav class="evidence-nav" aria-label="Investigation evidence sections">${model.reduction ? '<a href="#reduction-evidence">Reduction trace</a>' : ''}<a href="#replay-evidence">Replay evidence</a></nav>
        </div>
        <div class="secondary-grid">
          <div class="secondary-main">${shrinkInvestigation(model)}${scenarioReplay(model)}</div>
          <aside class="supporting-column">${evidenceRail(model)}</aside>
        </div>
      </section>
      <div class="footer-note">Measured values come from the evidence artifact. “Unavailable” means the runner did not record that field; it is not a success signal.</div>
    </div>
  `;
  emptyState.hidden = true;
  runView.hidden = false;
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
  runForm.setAttribute('aria-busy', 'true');
  runButton.setAttribute('aria-busy', 'true');
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
    runForm.removeAttribute('aria-busy');
    runButton.removeAttribute('aria-busy');
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

function selectScenario(value) {
  state.selectedScenario = value;
  scenarioSelect.value = value;
  topbarScenarioSelect.value = value;
  renderScenarioDetail();
  setTopbarContext();
}

scenarioSelect.addEventListener('change', () => selectScenario(scenarioSelect.value));
topbarScenarioSelect.addEventListener('change', () => selectScenario(topbarScenarioSelect.value));
runForm.addEventListener('change', updateModeControls);
runForm.addEventListener('submit', submitRun);
emptyRunButton?.addEventListener('click', () => {
  scenarioSelect.focus({ preventScroll: true });
  if (scenarioSelect.value) runForm.requestSubmit();
});
runForm.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!runButton.disabled) runForm.requestSubmit();
  }
});
$('#refresh-runs').addEventListener('click', refreshRuns);

updateModeControls();
renderScenarioDetail();
loadScenarios();
refreshRuns();

const fogElement = document.querySelector('#evidence-fog');
const fogMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let fogEffect;
let fogRetryTimer;
let fogAttempts = 0;

function markFogFallback(reason) {
  if (!fogElement) return;
  fogElement.dataset.state = reason;
  fogElement.classList.add('is-static');
}

function destroyFog() {
  window.clearTimeout(fogRetryTimer);
  fogRetryTimer = undefined;
  fogAttempts = 0;
  if (!fogEffect) return;
  fogEffect.destroy?.();
  fogEffect = undefined;
}

function initializeFog() {
  if (!fogElement || fogEffect || fogMotionPreference.matches) {
    if (fogMotionPreference.matches) markFogFallback('reduced-motion');
    return;
  }

  const threeReady = Boolean(window.THREE?.WebGLRenderer);
  const vantaReady = Boolean(window.VANTA?.FOG);
  if (!threeReady || !vantaReady) {
    fogAttempts += 1;
    if (fogAttempts < 20) {
      fogRetryTimer = window.setTimeout(initializeFog, 150);
    } else {
      markFogFallback('dependency-unavailable');
    }
    return;
  }

  let candidateEffect;
  try {
    candidateEffect = window.VANTA.FOG({
      el: fogElement,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      highlightColor: 0x8aa8c1,
      midtoneColor: 0x566981,
      lowlightColor: 0x252f40,
      baseColor: 0x101316,
      blurFactor: 0.58,
      zoom: 0.74,
      speed: 0.9,
      scale: 1.4,
      scaleMobile: 1.8,
    });
    if (!candidateEffect?.getCanvasElement?.()) throw new Error('Vanta FOG canvas was unavailable');
    fogEffect = candidateEffect;
    fogElement.dataset.state = 'ready';
    fogElement.classList.remove('is-static');
  } catch {
    candidateEffect?.destroy?.();
    markFogFallback('initialization-failed');
  }
}

fogMotionPreference.addEventListener?.('change', (event) => {
  if (event.matches) {
    destroyFog();
    markFogFallback('reduced-motion');
  } else {
    fogElement?.classList.remove('is-static');
    initializeFog();
  }
});

window.addEventListener('pagehide', destroyFog);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) initializeFog();
});

initializeFog();
