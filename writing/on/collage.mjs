// Brief, source-led marginal motion. No tracking or saved reader data.
export function runFrame(elapsed, width, rabbitWidth) {
  const time = Math.max(0, Number(elapsed) || 0);
  const distance = Math.max(0, width - rabbitWidth);
  const duration = Math.max(1400, Math.min(2800, distance / .2));
  const progress = Math.min(1, time / duration);
  const frame = progress === 1 ? 7 : Math.floor(time / 80) % 8;
  return {x: distance * progress, frame, column: frame % 4, row: Math.floor(frame / 4), done: progress === 1};
}

export function startCollage(doc, win) {
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduce.matches;
  let frameRequest = 0;
  let elapsed = 0;
  let lastTime;
  let visible = false;
  let ready = false;
  let done = false;
  const toggle = doc.querySelector('.motion-toggle');
  const passage = doc.querySelector('.rabbit-passage');
  const rabbit = doc.querySelector('.rabbit-runner');
  const coda = doc.querySelector('.paper-fragment');

  function stopRun() {
    win.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastTime = undefined;
  }
  function paint() {
    const position = runFrame(done ? Infinity : elapsed, passage.clientWidth, rabbit.offsetWidth);
    rabbit.style.transform = 'translateX(' + position.x + 'px)';
    rabbit.style.backgroundPosition = (position.column / 3 * 100) + '% ' + (position.row * 100) + '%';
    done = position.done;
  }
  function tick(time) {
    frameRequest = 0;
    if (paused || !visible || doc.hidden) { lastTime = undefined; return; }
    if (lastTime !== undefined) elapsed += time - lastTime;
    lastTime = time;
    paint();
    if (!done) frameRequest = win.requestAnimationFrame(tick);
  }
  function maybeRun() {
    if (!ready || !visible || paused || done || doc.hidden || frameRequest) return;
    passage.classList.add('sprite-active');
    paint();
    frameRequest = win.requestAnimationFrame(tick);
  }
  function applyMotion() {
    doc.documentElement.classList.toggle('motion-paused', paused);
    doc.body.classList.toggle('motion-enabled', !paused);
    doc.body.classList.toggle('motion-paused', paused);
    toggle.textContent = paused ? 'Motion off' : 'Pause motion';
    toggle.setAttribute('aria-pressed', String(paused));
    if (paused) { stopRun(); coda.classList.remove('touched'); }
    else maybeRun();
  }
  toggle.hidden = false;
  toggle.addEventListener('click', () => { paused = !paused; applyMotion(); });
  reduce.addEventListener('change', event => { paused = event.matches; applyMotion(); });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopRun(); else maybeRun(); });
  win.addEventListener('resize', () => { if (ready) paint(); }, {passive:true});

  const sprite = new win.Image();
  sprite.onload = () => {
    // Fractional source-cell dimensions are safe: CSS uses proportional positions.
    rabbit.style.aspectRatio = String((sprite.naturalWidth / 4) / (sprite.naturalHeight / 2));
    rabbit.style.backgroundImage = 'url("' + sprite.src + '")';
    ready = true;
    maybeRun();
  };
  // Keep the original engraving visible if the animation asset is unavailable.
  sprite.src = rabbit.dataset.sprite;

  if ('IntersectionObserver' in win) {
    const rabbitObserver = new win.IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .65;
      if (visible) maybeRun(); else stopRun();
    }, {threshold:.65});
    rabbitObserver.observe(passage);
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
          if (link.getAttribute('href') === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    }, {rootMargin:'-8% 0px -65% 0px', threshold:0});
    doc.querySelectorAll('main .section').forEach(el => sectionObserver.observe(el));
  }

  function showPressure(event) {
    if (paused || (event.pointerType === 'touch' && !event.buttons)) return;
    const bounds = coda.getBoundingClientRect();
    coda.style.setProperty('--touch-x', (event.clientX - bounds.left) + 'px');
    coda.style.setProperty('--touch-y', (event.clientY - bounds.top) + 'px');
    coda.classList.add('touched');
  }
  coda.addEventListener('pointermove', showPressure, {passive:true});
  coda.addEventListener('pointerdown', showPressure, {passive:true});
  coda.addEventListener('pointerleave', () => coda.classList.remove('touched'));
  coda.addEventListener('pointerup', () => coda.classList.remove('touched'));
  applyMotion();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startCollage(document, window);
