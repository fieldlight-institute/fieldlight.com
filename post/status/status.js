'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const post = params.get('post') || '';
  const version = params.get('version') || '';
  const valid = /^post-[1-9][0-9]*$/.test(post) && /^[a-f0-9]{64}$/.test(version);
  const title = document.getElementById('status-title');
  const message = document.getElementById('status-message');
  const stamp = document.getElementById('status-time');
  const button = document.getElementById('check-again');
  const read = document.getElementById('read-post');
  const source = document.getElementById('source-post');
  let timer, attempts = 0, busy = false, live = false;
  if (!valid) {
    title.textContent = 'Open your post’s status link.';
    message.textContent = 'The publishing confirmation on GitHub includes a link for your specific post.';
    button.hidden = true;
    return;
  }
  const number = post.slice(5);
  source.href = `https://github.com/annimch04/public-writing/issues/${number}`;
  source.hidden = false;
  read.href = `/stream/posts/${post}/`;
  async function check() {
    if (busy || live) return;
    busy = true;
    button.disabled = true;
    clearTimeout(timer);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/stream/feed.json?status=${Date.now()}`, {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Feed unavailable');
      const feed = await response.json();
      if (!Array.isArray(feed.items)) throw new Error('Feed unavailable');
      const item = feed.items.find(entry => entry.url === `https://fieldlight.com/stream/posts/${post}/`);
      live = Boolean(item && item._fieldlight_content_hash === version);
      if (live) {
        title.textContent = 'Your post is live.';
        message.textContent = 'Published on Fieldlight and included in the Everything feed.';
        read.hidden = false;
        document.getElementById('status-detail').textContent = 'This version is confirmed in the public feed. Your readers’ apps will pick it up when they next refresh.';
        button.hidden = true;
      } else {
        title.textContent = item ? 'Waiting for this update.' : 'Waiting for publication.';
        message.textContent = item ? 'Another version is live. This particular update has not reached the feed yet.' : 'This version has not reached the public feed yet. Your source record and publishing status are linked below.';
        read.hidden = !item;
      }
      stamp.textContent = `Last checked ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
    } catch (_) {
      title.textContent = 'Couldn’t check just now.';
      message.textContent = 'The live feed could not be reached. Your saved post is not changed; try again shortly.';
    } finally {
      clearTimeout(timeout);
      busy = false;
      button.disabled = false;
      attempts++;
      if (!live && attempts < 60) timer = setTimeout(check, 20000);
    }
  }
  button.addEventListener('click', () => { attempts = 0; check(); });
  check();
})();
