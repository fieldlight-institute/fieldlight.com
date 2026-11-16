/* Links work without JavaScript; enhance the two generated views in place. */
(() => {
  const links = [...document.querySelectorAll('[data-stream-filter]')];
  if (!links.length) return;
  const count = document.querySelector('.stream-count');
  const setView = (view) => {
    const publications = view === 'publications';
    document.body.dataset.streamView = publications ? 'publications' : 'everything';
    document.querySelectorAll('[data-kind="post"]').forEach(post => { post.hidden = publications; });
    links.forEach(link => {
      if (link.dataset.streamFilter === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (count) count.querySelector('span').textContent = publications ? count.dataset.publicationsCount : count.dataset.everythingCount;
    document.title = 'Fieldlight — ' + (publications ? 'Publications' : 'Everything');
  };
  const locationView = () => location.pathname === '/stream/publications/' || new URLSearchParams(location.search).get('view') === 'publications' ? 'publications' : 'everything';
  links.forEach(link => link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, '', link.href);
    setView(link.dataset.streamFilter);
  }));
  addEventListener('popstate', () => setView(locationView()));
  setView(locationView());
})();
