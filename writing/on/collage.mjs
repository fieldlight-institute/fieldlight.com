// Reader-controlled marginal motion. No requests, tracking, or saved reader data.
export const frameFor = value => Math.min(8, Math.max(1, Math.round(Number(value) || 1)));
export function rabbitPosition(value, width, rabbitWidth, animated = true) {
  const frame = frameFor(value);
  const fraction = (frame - 1) / 7;
  return {
    frame,
    x: Math.max(0, width - rabbitWidth) * fraction,
    y: animated ? -(Math.sin(fraction * Math.PI * 2) ** 2) * 17 : 0,
    angle: animated ? Math.cos(fraction * Math.PI * 2) * -3 : 0,
  };
}

export function startCollage(doc, win) {
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduce.matches;
  let holdTimer;
  const toggle = doc.querySelector('.motion-toggle');
  const input = doc.querySelector('#flip-page');
  const rabbit = doc.querySelector('.rabbit');
  const track = doc.querySelector('.rabbit-track');
  const previous = doc.querySelector('.flip-back');
  const next = doc.querySelector('.flip-next');
  const controls = doc.querySelector('.flip-controls');
  const coda = doc.querySelector('.paper-fragment');
  const folios = [...doc.querySelectorAll('.folio-numbers span')];

  function drawFrame() {
    const frame = frameFor(input.value);
    const position = rabbitPosition(frame, track.clientWidth, rabbit.offsetWidth, !paused);
    rabbit.style.transform = `translate(${position.x}px, ${position.y}px) rotate(${position.angle}deg)`;
    input.value = String(frame);
    input.setAttribute('aria-valuetext', `Page ${frame} of 8`);
    previous.disabled = frame === 1;
    next.disabled = frame === 8;
    folios.forEach((folio, index) => folio.classList.toggle('current', index + 1 === frame));
  }
  function stopHold() {
    win.clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  function step(direction) {
    input.value = String(frameFor(Number(input.value) + direction));
    drawFrame();
  }
  function heldStep(direction) {
    step(direction);
    if ((direction > 0 && Number(input.value) < 8) || (direction < 0 && Number(input.value) > 1)) {
      holdTimer = win.setTimeout(() => heldStep(direction), 145);
    }
  }
  function applyMotion() {
    doc.documentElement.classList.toggle('motion-paused', paused);
    doc.body.classList.toggle('motion-enabled', !paused);
    doc.body.classList.toggle('motion-paused', paused);
    toggle.textContent = paused ? 'Motion off' : 'Pause motion';
    toggle.setAttribute('aria-pressed', String(paused));
    if (paused) { stopHold(); coda.classList.remove('touched'); }
    drawFrame();
  }
  toggle.hidden = false;
  controls.hidden = false;
  input.addEventListener('input', drawFrame);
  toggle.addEventListener('click', () => { paused = !paused; applyMotion(); });
  reduce.addEventListener('change', event => { paused = event.matches; applyMotion(); });

  for (const [button, direction] of [[previous, -1], [next, 1]]) {
    button.addEventListener('click', event => {
      if (event.detail === 0 || !button.dataset.pointerHandled) step(direction);
      delete button.dataset.pointerHandled;
    });
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || button.disabled) return;
      button.dataset.pointerHandled = 'true';
      stopHold();
      step(direction);
      if (!paused) holdTimer = win.setTimeout(() => heldStep(direction), 350);
    });
    button.addEventListener('pointerleave', stopHold);
  }
  win.addEventListener('pointerup', stopHold);
  win.addEventListener('pointercancel', stopHold);
  win.addEventListener('blur', stopHold);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopHold(); });
  win.addEventListener('resize', drawFrame, {passive:true});

  if ('IntersectionObserver' in win) {
    const refrainObserver = new win.IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('arrived');
          refrainObserver.unobserve(entry.target);
        }
      });
    }, {threshold:.6});
    doc.querySelectorAll('.refrain').forEach(el => refrainObserver.observe(el));
    const sectionObserver = new win.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        doc.querySelectorAll('.contents a').forEach(link => {
          if (link.getAttribute('href') === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    }, {rootMargin:'-8% 0px -65% 0px', threshold:0});
    doc.querySelectorAll('main .section').forEach(el => sectionObserver.observe(el));
  }

  function showPressure(event) {
    if (paused || (event.pointerType === 'touch' && !event.buttons)) return;
    const bounds = coda.getBoundingClientRect();
    coda.style.setProperty('--touch-x', `${event.clientX - bounds.left}px`);
    coda.style.setProperty('--touch-y', `${event.clientY - bounds.top}px`);
    coda.classList.add('touched');
  }
  coda.addEventListener('pointermove', showPressure, {passive:true});
  coda.addEventListener('pointerdown', showPressure, {passive:true});
  coda.addEventListener('pointerleave', () => coda.classList.remove('touched'));
  coda.addEventListener('pointerup', () => coda.classList.remove('touched'));
  applyMotion();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startCollage(document, window);
