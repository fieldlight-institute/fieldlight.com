const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const DB_NAME = 'fieldlight-publishing-desk';
const DB_VERSION = 1;

export function newDraft(uuid = () => crypto.randomUUID(), now = new Date().toISOString()) {
  return { local_id: uuid(), client_id: uuid(), title: '', body: '', images: [], created_at: now, updated_at: now, published: false };
}

export function hasContent(draft) {
  return Boolean(draft.title.trim() || draft.body.trim() || draft.images.length);
}

export function draftFromPost(post, uuid = () => crypto.randomUUID(), now = new Date().toISOString()) {
  return {
    ...newDraft(uuid, now), post_id: post.id, title: post.title || '', body: post.body || '',
    images: (post.images || []).map(image => ({ path: image.path, alt: image.alt || '', url: image.url || `/${image.path.replace(/^\//, '')}` })),
    published_at: post.published_at, url: post.url, base_hash: post.content_hash, published: true,
  };
}

export async function publishPayload(draft) {
  const images = await Promise.all(draft.images.map(async image => {
    if (!image.blob) return { path: image.path, alt: image.alt || '' };
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    let binary = '';
    for (let start = 0; start < bytes.length; start += 32768) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    }
    return { data: btoa(binary), alt: image.alt || '', mimeType: image.mimeType || image.blob.type, filename: image.filename || 'photo' };
  }));
  return { ...(draft.post_id ? { id: draft.post_id } : {}), ...(draft.base_hash ? { base_hash: draft.base_hash } : {}), client_id: draft.client_id, title: draft.title.trim(), body: draft.body, images };
}

export function openDraftStore(indexedDBFactory = indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'local_id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Draft storage is busy in another window.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      const transaction = (mode, operation) => new Promise((done, fail) => {
        const tx = db.transaction('drafts', mode);
        let result;
        const req = operation(tx.objectStore('drafts'));
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => done(result);
        tx.onerror = () => fail(tx.error || req.error);
        tx.onabort = () => fail(tx.error || new Error('Draft could not be saved.'));
      });
      resolve({
        list: async () => (await transaction('readonly', store => store.getAll())).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        put: draft => transaction('readwrite', store => store.put(draft)),
        remove: id => transaction('readwrite', store => store.delete(id)),
      });
    };
  });
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function photoMime(file) {
  if (file.type) return file.type.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif' })[file.name.split('.').pop().toLowerCase()] || '';
}

export async function startComposer(publisher) {
  const $ = id => document.getElementById(id);
  const state = { draft: newDraft(), store: null, drafts: [], posts: [], connected: false, authenticated: false, locked: false, busy: false, saving: false, saveTimer: null, saveQueue: Promise.resolve(), previewUrls: [], storageError: false, checks: new Map() };
  const nodes = {
    title: $('post-title'), body: $('post-body'), form: $('composer-form'), publish: $('publish-button'),
    photos: $('photo-list'), files: $('photo-files'), draftStatus: $('draft-status'), message: $('publish-message'),
  };

  const message = (text = '', error = false) => {
    nodes.message.replaceChildren();
    nodes.message.textContent = text;
    nodes.message.dataset.error = String(error);
  };

  const draftStatus = (text, error = false) => {
    nodes.draftStatus.textContent = text;
    nodes.draftStatus.dataset.error = String(error);
  };

  const updateButtons = () => {
    nodes.publish.disabled = state.busy || !state.authenticated || state.draft.published || state.draft.source_saved || !(state.draft.body.trim() || state.draft.images.length);
    nodes.publish.replaceChildren(document.createTextNode(state.busy ? 'Publishing…' : state.draft.post_id ? 'Publish changes' : 'Publish'));
    if (!state.busy) {
      const arrow = document.createElement('span');
      arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); nodes.publish.append(arrow);
    }
    $('new-post').hidden = !hasContent(state.draft) && !state.draft.post_id;
    $('editing-label').textContent = state.draft.post_id ? 'Editing a post' : 'New post';
    $('add-photos').disabled = state.busy || state.draft.images.length >= MAX_PHOTOS;
  };

  const setBusy = busy => {
    state.busy = busy;
    document.body.dataset.busy = String(busy);
    for (const element of nodes.form.elements) element.disabled = busy;
    for (const id of ['new-post', 'drafts-toggle', 'posts-toggle', 'logout-button', 'posts-refresh']) $(id).disabled = busy;
    for (const button of document.querySelectorAll('.post-list-row button')) button.disabled = busy || button.dataset.readonly === 'true';
    updateButtons();
  };

  const renderConnection = () => {
    $('connection').dataset.state = state.authenticated ? 'authenticated' : state.connected ? 'signed-out' : 'disconnected';
    $('connection-text').textContent = state.authenticated ? 'Ready to publish' : state.connected ? state.locked ? 'Publishing is locked.' : 'Sign in to publish.' : 'Publishing connection not connected.';
    $('login-toggle').hidden = !state.connected || state.authenticated;
    $('login-toggle').textContent = state.locked ? 'Unlock' : 'Sign in';
    $('credential-label').textContent = state.locked ? 'Unlock password' : 'GitHub publishing key';
    $('signin-button').textContent = state.locked ? 'Unlock' : 'Sign in';
    $('password').name = state.locked ? 'unlock-password' : 'publishing-key';
    $('remember-options').hidden = state.locked;
    $('key-help').hidden = state.locked;
    $('forget-connection').hidden = !state.locked;
    $('connection-retry').hidden = state.connected;
    $('logout-button').hidden = !state.authenticated;
    if (state.authenticated || !state.connected) $('login-form').hidden = true;
    updateButtons();
  };

  const makeListRow = (record, onSelect, detail, link) => {
    const row = document.createElement('div'); row.className = 'post-list-row';
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = record.title || record.body.trim().replace(/\s+/g, ' ').slice(0, 90) || (record.images?.length ? 'Photograph' : 'Untitled draft');
    const date = document.createElement('small'); date.textContent = detail; button.append(date);
    button.disabled = state.busy || !onSelect;
    button.dataset.readonly = String(!onSelect);
    if (onSelect) button.addEventListener('click', onSelect);
    row.append(button);
    const url = safeUrl(link);
    if (url) {
      const anchor = document.createElement('a'); anchor.href = url; anchor.textContent = 'Read ↗'; anchor.target = '_blank'; anchor.rel = 'noopener'; row.append(anchor);
    }
    return row;
  };

  const formatDate = timestamp => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  };

  const refreshDrafts = async () => {
    if (state.store) state.drafts = await state.store.list();
    $('draft-count').textContent = state.drafts.length ? String(state.drafts.length) : '';
    $('drafts-list').replaceChildren();
    for (const draft of state.drafts) {
      const detail = `${draft.source_saved ? 'Publishing · ' : draft.post_id ? 'Unpublished changes · ' : ''}${formatDate(draft.updated_at)}`;
      $('drafts-list').append(makeListRow(draft, async () => {
        if (state.busy) return;
        await flushDraft();
        const current = state.drafts.find(item => item.local_id === draft.local_id);
        loadDraft(structuredClone(current || draft));
        togglePanel('drafts', false);
      }, detail));
    }
    if (!state.drafts.length) {
      const empty = document.createElement('p'); empty.className = 'post-list-empty'; empty.textContent = 'No saved drafts yet.'; $('drafts-list').append(empty);
    }
  };

  const flushDraft = () => {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.store || state.draft.published) return state.saveQueue;
    const snapshot = structuredClone(state.draft);
    state.saving = true;
    state.saveQueue = state.saveQueue.catch(() => {}).then(async () => {
      try {
        if (hasContent(snapshot) || snapshot.post_id) await state.store.put(snapshot);
        else await state.store.remove(snapshot.local_id);
        state.storageError = false;
        if (state.draft.local_id === snapshot.local_id && state.draft.updated_at === snapshot.updated_at) {
          draftStatus(snapshot.source_saved ? '' : hasContent(snapshot) || snapshot.post_id ? 'Draft saved on this device.' : 'Drafts stay on this device.');
        }
        await refreshDrafts();
      } catch {
        state.storageError = true;
        draftStatus('Draft could not be saved on this device. Keep this page open.', true);
      } finally { state.saving = false; }
    });
    return state.saveQueue;
  };

  const changed = () => {
    if (state.draft.source_saved) state.draft.client_id = crypto.randomUUID();
    state.draft.source_saved = false;
    state.draft.title = nodes.title.value;
    state.draft.body = nodes.body.value;
    state.draft.published = false;
    state.draft.updated_at = new Date().toISOString();
    message();
    updateButtons();
    if (state.store) {
      draftStatus('Saving draft…');
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(flushDraft, 450);
    }
  };

  const renderPhotos = () => {
    for (const url of state.previewUrls) URL.revokeObjectURL(url);
    state.previewUrls = [];
    nodes.photos.replaceChildren();
    state.draft.images.forEach((photo, index) => {
      const card = document.createElement('figure'); card.className = 'photo-card';
      const preview = document.createElement('div'); preview.className = 'photo-preview';
      const fallback = document.createElement('span'); fallback.className = 'photo-fallback'; fallback.textContent = photo.filename || 'Photograph';
      let url;
      if (photo.blob) { url = URL.createObjectURL(photo.blob); state.previewUrls.push(url); }
      else url = safeUrl(photo.url || (photo.path ? `/${photo.path.replace(/^\//, '')}` : null));
      if (url) {
        const image = document.createElement('img'); image.src = url; image.alt = photo.alt || ''; image.decoding = 'async';
        image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
        preview.append(image); fallback.hidden = true;
      }
      preview.append(fallback);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'photo-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
      remove.addEventListener('click', () => { state.draft.images.splice(index, 1); changed(); renderPhotos(); });
      const label = document.createElement('label'); label.htmlFor = `photo-description-${index}`; label.textContent = 'Photo description';
      const input = document.createElement('textarea'); input.id = label.htmlFor; input.rows = 2; input.maxLength = 2000; input.value = photo.alt || ''; input.placeholder = 'Describe this photo…';
      input.addEventListener('input', () => { photo.alt = input.value; const image = preview.querySelector('img'); if (image) image.alt = input.value; changed(); });
      card.append(preview, remove, label, input); nodes.photos.append(card);
    });
  };

  const loadDraft = draft => {
    state.draft = draft;
    nodes.title.value = draft.title;
    nodes.body.value = draft.body;
    renderPhotos(); updateButtons(); message();
    draftStatus(draft.published ? 'Published.' : draft.source_saved ? '' : hasContent(draft) || draft.post_id ? 'Draft saved on this device.' : 'Drafts stay on this device.');
    if (draft.source_saved) message('Saved. Publishing…');
    if (state.storageError) draftStatus('Draft could not be saved on this device. Keep this page open.', true);
  };

  const togglePanel = (name, open) => {
    const panel = $(`${name}-panel`);
    const shouldOpen = open ?? panel.hidden;
    panel.hidden = !shouldOpen;
    $(`${name}-toggle`).setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
      const other = name === 'posts' ? 'drafts' : 'posts';
      $(`${other}-panel`).hidden = true;
      $(`${other}-toggle`).setAttribute('aria-expanded', 'false');
    }
  };

  const checkSession = async () => {
    $('connection-text').textContent = 'Connecting…';
    $('connection-retry').disabled = true;
    try {
      if (!publisher) publisher = await loadPublisher();
      const result = await publisher.getSession();
      state.connected = true;
      state.authenticated = Boolean(result.authenticated);
      state.locked = Boolean(result.locked);
    } catch { state.connected = false; state.authenticated = false; }
    finally { $('connection-retry').disabled = false; renderConnection(); }
  };

  const refreshPosts = async () => {
    $('posts-message').textContent = state.authenticated ? 'Loading posts…' : 'Sign in to see your posts.';
    if (!state.authenticated || !publisher) { $('posts-list').replaceChildren(); return; }
    $('posts-refresh').disabled = true;
    try {
      const result = await publisher.listPosts();
      state.posts = result.posts || result;
      $('posts-list').replaceChildren();
      for (const post of state.posts) {
        $('posts-list').append(makeListRow(post, post.authoring === 'fieldlight-composer' ? async () => {
          if (state.busy) return;
          await flushDraft();
          const existing = state.drafts.find(draft => draft.post_id === post.id);
          loadDraft(existing ? structuredClone(existing) : draftFromPost(post));
          togglePanel('posts', false);
          nodes.body.focus();
        } : null, formatDate(post.published_at || post.updated_at), post.url));
      }
      $('posts-message').textContent = state.posts.length ? '' : 'No published posts yet.';
    } catch (error) {
      $('posts-message').textContent = error.message || 'Posts could not be loaded. Try again.';
    } finally { $('posts-refresh').disabled = false; }
  };

  const showPublished = post => {
    message('Published.');
    const url = safeUrl(post.url);
    if (url) {
      const link = document.createElement('a'); link.href = url; link.textContent = 'Read your post ↗';
      link.target = '_blank'; link.rel = 'noopener'; nodes.message.append(link);
    }
    draftStatus('');
  };

  const finishPublication = async (localId, post) => {
    const active = state.draft.local_id === localId;
    const draft = active ? state.draft : state.drafts.find(item => item.local_id === localId);
    if (!draft || draft.pending_post?.content_hash !== post.content_hash) return;
    delete draft.pending_post;
    if (draft.source_saved) {
      draft.source_saved = false;
      draft.published = true;
      draft.client_id = crypto.randomUUID();
      if (active) { showPublished(post); updateButtons(); }
      if (state.store) state.saveQueue = state.saveQueue.catch(() => {}).then(() => state.store.remove(localId));
    } else {
      if (active) message('Previous version published.');
      const snapshot = structuredClone(draft);
      if (state.store) state.saveQueue = state.saveQueue.catch(() => {}).then(() => state.store.put(snapshot));
    }
    try { await state.saveQueue; await refreshDrafts(); }
    catch { if (active) message('Published. This device could not update its saved draft.'); }
  };

  const checkPublication = draft => {
    if (!publisher?.checkLive || !draft.pending_post) return;
    const localId = draft.local_id;
    const post = structuredClone(draft.pending_post);
    const previous = state.checks.get(localId);
    if (previous?.post.content_hash === post.content_hash) return;
    if (previous) clearTimeout(previous.timer);
    const check = { post, started: Date.now(), timer: null };
    state.checks.set(localId, check);
    const poll = async () => {
      if (state.checks.get(localId) !== check) return;
      let live = false;
      try { live = await publisher.checkLive(post); } catch { /* Keep the saved version available for a later check. */ }
      if (state.checks.get(localId) !== check) return;
      if (live) {
        state.checks.delete(localId);
        await finishPublication(localId, post);
      } else if (Date.now() - check.started < 20 * 60 * 1000) {
        check.timer = setTimeout(poll, 20000);
      } else {
        state.checks.delete(localId);
        if (state.draft.local_id === localId && state.draft.source_saved) {
          message('Saved. Still publishing.');
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Check again';
          retry.addEventListener('click', () => { message('Saved. Publishing…'); checkPublication(state.draft); });
          nodes.message.append(retry);
        }
      }
    };
    void poll();
  };

  nodes.title.addEventListener('input', changed);
  nodes.body.addEventListener('input', changed);
  $('add-photos').addEventListener('click', () => nodes.files.click());
  nodes.files.addEventListener('change', async () => {
    const files = [...nodes.files.files]; nodes.files.value = '';
    if (state.draft.images.length + files.length > MAX_PHOTOS) { message(`Choose up to ${MAX_PHOTOS} photos per post.`, true); return; }
    const accepted = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']);
    for (const file of files) {
      if (!accepted.has(photoMime(file))) { message(`${file.name}: choose a JPEG, PNG, WebP, HEIC, HEIF, or still GIF photo.`, true); return; }
      if (file.size > MAX_PHOTO_BYTES) { message(`${file.name} is too large. Choose a photo under 15 MB.`, true); return; }
    }
    for (const file of files) state.draft.images.push({ blob: file, filename: file.name, mimeType: photoMime(file), alt: '' });
    changed(); renderPhotos(); await flushDraft();
  });

  $('new-post').addEventListener('click', async () => {
    if (state.busy) return;
    await flushDraft(); loadDraft(newDraft());
    togglePanel('drafts', false); togglePanel('posts', false); nodes.body.focus();
  });
  $('drafts-toggle').addEventListener('click', async () => { await flushDraft(); await refreshDrafts(); togglePanel('drafts'); });
  $('posts-toggle').addEventListener('click', async () => { togglePanel('posts'); if (!$('posts-panel').hidden) await refreshPosts(); });
  $('posts-refresh').addEventListener('click', refreshPosts);
  $('connection-retry').addEventListener('click', checkSession);
  $('login-toggle').addEventListener('click', () => { $('login-form').hidden = !$('login-form').hidden; if (!$('login-form').hidden) $('password').focus(); });
  $('remember-connection').addEventListener('change', () => {
    $('remember-secret').hidden = !$('remember-connection').checked;
    $('connection-passphrase').required = $('remember-connection').checked;
    if ($('remember-connection').checked) $('connection-passphrase').focus();
    else $('connection-passphrase').value = '';
  });
  let authBusy = false;
  const setAuthBusy = value => {
    authBusy = value;
    for (const id of ['signin-button', 'forget-connection', 'logout-button', 'login-toggle']) $(id).disabled = value;
  };
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!publisher || authBusy) return;
    const input = $('password');
    setAuthBusy(true); $('login-message').textContent = state.locked ? 'Unlocking…' : 'Signing in…';
    try {
      const result = state.locked ? await publisher.unlock(input.value) : await publisher.signIn(input.value, { remember: $('remember-connection').checked, passphrase: $('connection-passphrase').value });
      if (!result.authenticated) throw new Error('Sign-in was not completed.');
      state.authenticated = true; state.connected = true; state.locked = false;
      $('login-message').textContent = ''; renderConnection();
      if (!$('posts-panel').hidden) await refreshPosts();
    } catch (error) { $('login-message').textContent = error.message || 'Sign-in failed. Try again.'; }
    finally { input.value = ''; $('connection-passphrase').value = ''; setAuthBusy(false); }
  });
  $('forget-connection').addEventListener('click', async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try { await publisher.forgetConnection(); $('password').value = ''; $('login-message').textContent = ''; await checkSession(); }
    catch (error) { $('login-message').textContent = error.message || 'Could not forget this device. Try again.'; }
    finally { setAuthBusy(false); }
  });
  $('logout-button').addEventListener('click', async () => {
    if (!publisher || authBusy) return;
    setAuthBusy(true);
    try {
      await publisher.logOut(); state.authenticated = false; state.posts = []; $('posts-list').replaceChildren();
      $('posts-message').textContent = 'Sign in to see your posts.';
      $('remember-connection').checked = false; $('remember-secret').hidden = true; $('connection-passphrase').required = false;
      await checkSession();
    } catch { message('Could not sign out. Try again.', true); }
    finally { setAuthBusy(false); }
  });

  nodes.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy || !state.authenticated || state.draft.published || state.draft.source_saved || !(state.draft.body.trim() || state.draft.images.length)) return;
    setBusy(true); message('Publishing…');
    await flushDraft();
    try {
      const payload = await publishPayload(state.draft);
      const result = await publisher.publish(payload);
      if (result.status !== 'saved' || !result.post?.id || !result.post.content_hash) throw new Error('Saving has not been confirmed. Try again.');
      // Retain the local draft and its photos until this exact version is visible in the public feed.
      state.draft.post_id = result.post.id;
      state.draft.base_hash = result.post.content_hash;
      state.draft.url = result.post.url;
      state.draft.pending_post = result.post;
      state.draft.source_saved = true;
      await flushDraft();
      message('Saved. Publishing…');
      draftStatus('');
      checkPublication(state.draft);
    } catch (error) {
      message(error.message || 'Could not confirm saving. Try again.', true);
      await checkSession();
    } finally { setBusy(false); }
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushDraft(); });
  window.addEventListener('pagehide', event => { void flushDraft(); if (!event.persisted) for (const url of state.previewUrls) URL.revokeObjectURL(url); });
  window.addEventListener('online', () => { if (!state.connected) void checkSession(); });
  window.addEventListener('beforeunload', event => {
    if (state.saveTimer || state.saving || (state.storageError && hasContent(state.draft) && !state.draft.published)) { event.preventDefault(); event.returnValue = ''; }
  });

  try {
    state.store = await openDraftStore();
    await refreshDrafts();
    if (state.drafts.length) loadDraft(structuredClone(state.drafts[0]));
    else updateButtons();
    for (const draft of state.drafts) checkPublication(draft);
  } catch {
    state.storageError = true;
    draftStatus('Draft could not be saved on this device. Keep this page open.', true);
  }
  setBusy(false);
  await checkSession();
}

async function loadPublisher() {
  if (window.top !== window.self) throw new Error('Open the publishing desk directly to connect.');
  const [module, connection] = await Promise.all([import('./publisher.js'), import('./connection.js')]);
  return connection.withRememberedConnection(module.createPublisher());
}

if (typeof document !== 'undefined' && document.body.classList.contains('composer-page')) {
  let publisher = window.fieldlightPublisher;
  if (!publisher) {
    try {
      publisher = await loadPublisher();
    }
    catch { /* The editor and local drafts remain available without a publishing connection. */ }
  }
  void startComposer(publisher);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/post/sw.js', { scope: '/post/' }).catch(() => {});
}
