(() => {
  const selector = '[data-particle-click]';
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pressedTimers = new WeakMap();

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function particleColor(button, index) {
    if (button.dataset.particleTone === 'dark') {
      return index === 0 ? '#5d7620' : '#20272b';
    }
    return index === 0 ? '#f1d6a3' : '#fffaf0';
  }

  function emitParticles(button) {
    if (!(button instanceof HTMLElement)
      || button.matches(':disabled')
      || button.getAttribute('aria-disabled') === 'true'
      || motionPreference.matches) return;

    const previousTimer = pressedTimers.get(button);
    if (previousTimer) window.clearTimeout(previousTimer);

    const layer = document.createElement('span');
    layer.className = 'particle-click-layer';
    layer.setAttribute('aria-hidden', 'true');
    const particleCount = 8;

    for (let index = 0; index < particleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / particleCount + randomBetween(-0.2, 0.2);
      const distance = randomBetween(20, 38);
      const lift = randomBetween(5, 13);
      const particle = document.createElement('i');
      particle.className = 'particle-click-particle';
      particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
      particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance - lift}px`);
      particle.style.setProperty('--particle-color', particleColor(button, index));
      particle.style.setProperty('--particle-size', `${randomBetween(2.5, 4.5)}px`);
      particle.style.setProperty('--particle-duration', `${randomBetween(0.42, 0.64)}s`);
      particle.addEventListener('animationend', () => particle.remove(), { once: true });
      layer.appendChild(particle);
    }

    button.appendChild(layer);
    button.classList.add('is-particle-pressed');
    const pressedTimer = window.setTimeout(() => {
      button.classList.remove('is-particle-pressed');
      pressedTimers.delete(button);
    }, 180);
    pressedTimers.set(button, pressedTimer);
    window.setTimeout(() => layer.remove(), 820);
  }

  function particleTarget(event) {
    return event.target instanceof Element ? event.target.closest(selector) : null;
  }

  document.addEventListener('pointerdown', (event) => {
    const button = particleTarget(event);
    if (button) emitParticles(button);
  });

  document.addEventListener('keydown', (event) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const button = particleTarget(event);
    if (button) emitParticles(button);
  });
})();
