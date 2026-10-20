const sequence = document.querySelector('[data-demo-sequence]');

if (sequence && !sequence.dataset.demoController) {
  sequence.dataset.demoController = 'active';
  const phaseNames = ['compare', 'mismatch', 'path', 'reduce', 'replay'];
  const phases = [...sequence.querySelectorAll('[data-phase]')];
  const targets = [...sequence.querySelectorAll('[data-demo-target]')];
  const cursor = sequence.querySelector('.preview-cursor');
  const cursorReady = Boolean(cursor?.querySelector('img'));
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  let currentPhase = 0;
  let timer;
  let cursorFrame;
  let clickFrame;
  let clickTimer;

  function clearSequenceTimers() {
    window.clearInterval(timer);
    window.clearTimeout(clickTimer);
    window.cancelAnimationFrame(cursorFrame);
    window.cancelAnimationFrame(clickFrame);
    timer = undefined;
    clickFrame = undefined;
    clickTimer = undefined;
    cursorFrame = undefined;
  }

  function cursorTarget(phaseName) {
    const targetName = phaseName === 'compare' ? 'finding' : phaseName === 'mismatch' ? 'mismatch' : phaseName === 'path' ? 'pointer' : phaseName;
    return sequence.querySelector(`[data-demo-target="${targetName}"]`);
  }

  function moveCursor(phaseName) {
    if (!cursor || !cursorReady || reducedMotion || window.innerWidth <= 600) return;
    window.cancelAnimationFrame(cursorFrame);
    cursorFrame = window.requestAnimationFrame(() => {
      const target = cursorTarget(phaseName);
      if (!target) return;
      const sequenceRect = sequence.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const cursorWidth = cursor.offsetWidth || 30;
      const cursorHeight = cursor.offsetHeight || 40;
      const targetX = targetRect.left - sequenceRect.left + targetRect.width * .52 - 3;
      const targetY = targetRect.top - sequenceRect.top + targetRect.height * .5 - 3;
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
    if (!cursor || !cursorReady || reducedMotion || window.innerWidth <= 600 || phaseName === 'compare') return;
    window.clearTimeout(clickTimer);
    cursor.classList.remove('is-clicking');
    clickFrame = window.requestAnimationFrame(() => cursor.classList.add('is-clicking'));
    clickTimer = window.setTimeout(() => cursor.classList.remove('is-clicking'), 620);
  }

  function showPhase(index) {
    currentPhase = index % phaseNames.length;
    const phaseName = phaseNames[currentPhase];
    sequence.dataset.demoPhase = phaseName;
    phases.forEach((phase) => phase.classList.toggle('is-active', phase.dataset.phase === phaseName));
    targets.forEach((target) => {
      const targetPhase = target.dataset.demoTarget;
      target.classList.toggle('is-active', targetPhase === phaseName || (phaseName === 'compare' && targetPhase === 'finding'));
    });
    moveCursor(phaseName);
    clickCursor(phaseName);
  }

  function startSequence() {
    clearSequenceTimers();
    if (reducedMotion || document.hidden) return;
    timer = window.setInterval(() => showPhase(currentPhase + 1), 3200);
  }

  startSequence();
  showPhase(0);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearSequenceTimers();
      return;
    }
    startSequence();
    showPhase(currentPhase);
  });
  const refreshCursor = () => moveCursor(phaseNames[currentPhase]);
  window.addEventListener('resize', refreshCursor, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(refreshCursor);
    resizeObserver.observe(sequence);
  }
  const onMotionPreferenceChange = (event) => {
    reducedMotion = event.matches;
    if (reducedMotion) {
      clearSequenceTimers();
      cursor?.classList.remove('is-clicking');
      return;
    }
    startSequence();
    showPhase(currentPhase);
  };
  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', onMotionPreferenceChange);
  }
}
