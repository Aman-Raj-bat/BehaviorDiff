const sequence = document.querySelector('[data-demo-sequence]');

if (sequence && sequence.dataset.demoController !== 'active') {
  sequence.dataset.demoController = 'active';

  const phaseNames = ['compare', 'mismatch', 'path', 'reduce', 'replay'];
  const phaseDurations = {
    compare: 4200,
    mismatch: 3900,
    path: 3900,
    reduce: 4300,
    replay: 4300,
  };
  const activeTargets = {
    compare: new Set(['compare']),
    mismatch: new Set(['mismatch', 'finding']),
    path: new Set(['pointer']),
    reduce: new Set(['reduction']),
    replay: new Set(['replay']),
  };
  const phases = [...sequence.querySelectorAll('[data-phase]')];
  const targets = [...sequence.querySelectorAll('[data-demo-target]')];
  const cursor = sequence.querySelector('.preview-cursor');
  const cursorImage = cursor?.querySelector('.preview-cursor-image');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  let currentPhase = 0;
  let timer;
  let cursorFrame;
  let clickFrame;
  let clickTimer;
  let cursorReady = false;

  function clearSequenceTimers() {
    window.clearTimeout(timer);
    window.clearTimeout(clickTimer);
    window.cancelAnimationFrame(cursorFrame);
    window.cancelAnimationFrame(clickFrame);
    timer = undefined;
    clickTimer = undefined;
    cursorFrame = undefined;
    clickFrame = undefined;
  }

  function cursorTarget(phaseName) {
    const targetName = phaseName === 'compare'
      ? 'compare'
      : phaseName === 'mismatch'
        ? 'mismatch'
        : phaseName === 'path'
          ? 'pointer'
          : phaseName;
    return sequence.querySelector(`[data-demo-target="${targetName}"]`);
  }

  function moveCursor(phaseName) {
    if (!cursor || !cursorReady || reducedMotion || document.hidden) return;
    window.cancelAnimationFrame(cursorFrame);
    cursorFrame = window.requestAnimationFrame(() => {
      const target = cursorTarget(phaseName);
      if (!target) return;
      const sequenceRect = sequence.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const cursorWidth = cursor.offsetWidth || 44;
      const cursorHeight = cursor.offsetHeight || 58;
      const targetX = targetRect.left - sequenceRect.left + targetRect.width * .54 - cursorWidth * .16;
      const targetY = targetRect.top - sequenceRect.top + targetRect.height * .52 - cursorHeight * .16;
      const maxX = Math.max(8, sequence.clientWidth - cursorWidth - 8);
      const maxY = Math.max(8, sequence.clientHeight - cursorHeight - 8);
      const clampedX = Math.max(8, Math.min(maxX, targetX));
      const clampedY = Math.max(8, Math.min(maxY, targetY));
      sequence.style.setProperty('--cursor-x', `${clampedX}px`);
      sequence.style.setProperty('--cursor-y', `${clampedY}px`);
      sequence.style.setProperty('--cursor-accent', phaseName === 'mismatch' || phaseName === 'path' ? 'var(--vermilion)' : 'var(--lime)');
      cursor.dataset.cursorTarget = phaseName;
    });
  }

  function clickCursor(phaseName) {
    if (!cursor || !cursorReady || reducedMotion || document.hidden || phaseName === 'compare') return;
    window.clearTimeout(clickTimer);
    window.cancelAnimationFrame(clickFrame);
    cursor.classList.remove('is-clicking');
    clickFrame = window.requestAnimationFrame(() => cursor.classList.add('is-clicking'));
    clickTimer = window.setTimeout(() => cursor.classList.remove('is-clicking'), 680);
  }

  function showPhase(index) {
    currentPhase = (index + phaseNames.length) % phaseNames.length;
    const phaseName = phaseNames[currentPhase];
    const targetsForPhase = activeTargets[phaseName];
    sequence.dataset.demoPhase = phaseName;
    phases.forEach((phase) => phase.classList.toggle('is-active', phase.dataset.phase === phaseName));
    targets.forEach((target) => target.classList.toggle('is-active', targetsForPhase.has(target.dataset.demoTarget)));
    moveCursor(phaseName);
    clickCursor(phaseName);
  }

  function scheduleNextPhase() {
    if (reducedMotion || document.hidden) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      showPhase(currentPhase + 1);
      scheduleNextPhase();
    }, phaseDurations[phaseNames[currentPhase]]);
  }

  function startSequence() {
    clearSequenceTimers();
    showPhase(currentPhase);
    scheduleNextPhase();
  }

  function setCursorReady() {
    if (!cursor || !cursorImage || cursorImage.naturalWidth === 0) return;
    cursorReady = true;
    cursor.hidden = false;
    cursor.dataset.assetState = 'loaded';
    moveCursor(phaseNames[currentPhase]);
  }

  function setCursorUnavailable() {
    if (!cursor) return;
    cursorReady = false;
    cursor.hidden = true;
    cursor.dataset.assetState = 'unavailable';
  }

  async function loadCursorAsset() {
    const source = cursor?.dataset.cursorSrc;
    if (!cursorImage || !source) {
      setCursorUnavailable();
      return;
    }
    try {
      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) {
        setCursorUnavailable();
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      cursorImage.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
      cursorImage.src = objectUrl;
    } catch {
      setCursorUnavailable();
    }
  }

  if (cursorImage) {
    cursorImage.addEventListener('load', setCursorReady, { once: true });
    cursorImage.addEventListener('error', setCursorUnavailable, { once: true });
  }
  loadCursorAsset();

  startSequence();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearSequenceTimers();
      return;
    }
    startSequence();
  });

  const refreshCursor = () => moveCursor(phaseNames[currentPhase]);
  window.addEventListener('resize', refreshCursor, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(refreshCursor);
    resizeObserver.observe(sequence);
  }

  const onMotionPreferenceChange = (event) => {
    reducedMotion = event.matches;
    clearSequenceTimers();
    cursor?.classList.remove('is-clicking');
    if (reducedMotion) {
      showPhase(0);
      return;
    }
    startSequence();
  };
  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', onMotionPreferenceChange);
  }
}

const haloElement = document.querySelector('#behavior-halo');
const haloMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let haloEffect;
let haloRetryTimer;
let haloAttempts = 0;

function markHaloFallback(reason) {
  if (!haloElement) return;
  haloElement.dataset.state = reason;
  haloElement.classList.add('is-static');
}

function destroyHalo() {
  window.clearTimeout(haloRetryTimer);
  haloRetryTimer = undefined;
  haloAttempts = 0;
  if (!haloEffect) return;
  haloEffect.destroy?.();
  haloEffect = undefined;
}

function initializeHalo() {
  if (!haloElement || haloEffect || haloMotionPreference.matches) {
    if (haloMotionPreference.matches) markHaloFallback('reduced-motion');
    return;
  }

  const threeReady = Boolean(window.THREE);
  const vantaReady = Boolean(window.VANTA?.HALO);
  if (!threeReady || !vantaReady) {
    haloAttempts += 1;
    if (haloAttempts < 20) {
      haloRetryTimer = window.setTimeout(initializeHalo, 150);
    } else {
      markHaloFallback('dependency-unavailable');
    }
    return;
  }

  try {
    haloEffect = window.VANTA.HALO({
      el: haloElement,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      backgroundColor: 0x101316,
      baseColor: 0x5967c8,
      color2: 0x4f9fb7,
      size: 1.62,
      amplitudeFactor: 0.86,
      ringFactor: 1.05,
      rotationFactor: 0.85,
      speed: 0.78,
      xOffset: 0.12,
      yOffset: 0.08,
    });
    haloElement.dataset.state = 'ready';
    haloElement.classList.remove('is-static');
  } catch {
    markHaloFallback('initialization-failed');
  }
}

haloMotionPreference.addEventListener?.('change', (event) => {
  if (event.matches) {
    destroyHalo();
    markHaloFallback('reduced-motion');
  } else {
    haloElement?.classList.remove('is-static');
    initializeHalo();
  }
});

window.addEventListener('pagehide', destroyHalo);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) initializeHalo();
});

initializeHalo();
