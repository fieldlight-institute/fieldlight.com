/* Fieldlight's browser-only publishing adapter. Credentials remain in memory. */
const API = 'https://api.github.com';
const OWNER = 'annimch04';
const REPO = `${OWNER}/public-writing`;
const PREFIX = `/repos/${REPO}`;
const SITE = 'https://fieldlight.com';
const AUTHORING = 'fieldlight-composer';
const POST_ID = /^post-[1-9][0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 80000000;
const MAX_IMAGES = 8;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const encoder = new TextEncoder();

class PublisherError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'PublisherError'; this.status = status; }
}
const fail = message => { throw new PublisherError(message); };
const byteString = bytes => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return value;
};
const toBase64 = bytes => btoa(byteString(bytes));
function fromBase64(value, maximum = MAX_BYTES) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maximum / 3) * 4 ||
      value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('A photograph could not be read. Select it again.');
  let decoded;
  try { decoded = atob(value); } catch { fail('A photograph could not be read. Select it again.'); }
  if (decoded.length > maximum) fail('Each photograph must be 15 MB or smaller.');
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
const jsonBytes = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
function publicPost(record) { return { ...record, url: `${SITE}/stream/posts/${record.id}/` }; }
function validRecord(record, id) {
  if (!record || record.id !== id || !POST_ID.test(id) || typeof record.body !== 'string' ||
      (record.title !== undefined && typeof record.title !== 'string') || !Array.isArray(record.images) ||
      record.images.some(image => !image || typeof image.path !== 'string' || typeof image.alt !== 'string') || typeof record.published_at !== 'string' ||
      Number.isNaN(Date.parse(record.published_at))) fail('The saved post could not be read.');
  return record;
}

/** Inspect dimensions and animation before asking a browser to decode pixels. */
export function inspectImage(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) fail('Each photograph must be 15 MB or smaller.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, count) => String.fromCharCode(...bytes.subarray(at, at + count));
  const enough = (at, count) => { if (at < 0 || at + count > bytes.length) fail('This photograph is incomplete or unreadable.'); };
  let width, height, mime, extension;
  if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg'; extension = 'jpg';
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i++] !== 255) fail('This JPEG photograph could not be read.');
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      enough(i, 2); const size = view.getUint16(i); if (size < 2) fail('This JPEG photograph could not be read.');
      enough(i, size);
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        enough(i, 7); height = view.getUint16(i + 3); width = view.getUint16(i + 5); break;
      }
      i += size;
    }
    if (!width || !height) fail('This JPEG photograph could not be read.');
  } else if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    enough(0, 33); if (ascii(12, 4) !== 'IHDR') fail('This PNG photograph could not be read.');
    mime = 'image/png'; extension = 'png'; width = view.getUint32(16); height = view.getUint32(20);
    for (let i = 8; i + 12 <= bytes.length;) {
      const size = view.getUint32(i); enough(i, size + 12);
      if (ascii(i + 4, 4) === 'acTL') fail('Animated images are not supported. Choose a still photograph.');
      i += size + 12;
    }
  } else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
    enough(0, 13); mime = 'image/gif'; extension = 'png'; width = view.getUint16(6, true); height = view.getUint16(8, true);
    let i = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0), frames = 0;
    const blocks = () => { while (true) { enough(i, 1); const size = bytes[i++]; if (!size) return; enough(i, size); i += size; } };
    while (i < bytes.length) {
      const block = bytes[i++];
      if (block === 59) break;
      if (block === 33) { enough(i++, 1); blocks(); }
      else if (block === 44) {
        enough(i, 9);
        if (view.getUint16(i + 4, true) * view.getUint16(i + 6, true) > MAX_PIXELS) fail('Photographs must be at most 80 megapixels. Resize this photograph first.');
        if (++frames > 1) fail('Animated images are not supported. Choose a still photograph.');
        const packed = bytes[i + 8]; i += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
        enough(i++, 1); blocks();
      } else fail('This GIF photograph could not be read.');
    }
    if (!frames) fail('This GIF photograph could not be read.');
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    mime = 'image/webp'; extension = 'png';
    for (let i = 12; i + 8 <= bytes.length;) {
      const kind = ascii(i, 4), size = view.getUint32(i + 4, true), at = i + 8; enough(at, size);
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && bytes[at] & 2)) fail('Animated images are not supported. Choose a still photograph.');
      if (kind === 'VP8X') { enough(at, 10); width = 1 + bytes[at + 4] + (bytes[at + 5] << 8) + (bytes[at + 6] << 16); height = 1 + bytes[at + 7] + (bytes[at + 8] << 8) + (bytes[at + 9] << 16); }
      else if (kind === 'VP8 ' && !width) { enough(at, 10); width = view.getUint16(at + 6, true) & 16383; height = view.getUint16(at + 8, true) & 16383; }
      else if (kind === 'VP8L' && !width) { enough(at, 5); width = 1 + bytes[at + 1] + ((bytes[at + 2] & 63) << 8); height = 1 + (bytes[at + 2] >> 6) + (bytes[at + 3] << 2) + ((bytes[at + 4] & 15) << 10); }
      i = at + size + (size % 2);
    }
    if (!width || !height) fail('This WebP photograph could not be read.');
  } else if (ascii(4, 4) === 'ftyp') {
    enough(8, 8);
    const boxSize = view.getUint32(0); enough(0, boxSize);
    const brands = [];
    for (let i = 8; i + 4 <= boxSize; i += 4) if (i !== 12) brands.push(ascii(i, 4));
    if (brands.some(brand => ['hevc', 'hevx', 'msf1'].includes(brand))) fail('Image sequences are not supported. Choose a still photograph.');
    if (!brands.some(brand => ['heic', 'heix', 'mif1'].includes(brand))) fail('Choose a JPEG, PNG, WebP, still GIF, or HEIC photograph.');
    mime = 'image/heic'; extension = 'jpg';
  } else fail('Choose a JPEG, PNG, WebP, still GIF, or HEIC photograph.');
  if ((width !== undefined && (!width || !height)) || width * height > MAX_PIXELS) fail('Photographs must be at most 80 megapixels. Resize this photograph first.');
  return { width, height, mime, extension };
}

/** Fresh canvas output contains pixels, without original EXIF, GPS or comments. */
export async function cleanBrowserImage(bytes) {
  const info = inspectImage(bytes), blob = new Blob([bytes], { type: info.mime });
  let decoded, objectUrl, timer;
  try {
    const decode = typeof createImageBitmap === 'function'
      ? createImageBitmap(blob, { imageOrientation: 'from-image' })
      : new Promise((resolve, reject) => {
        const image = new Image(); objectUrl = URL.createObjectURL(blob);
        image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl;
      });
    decoded = await Promise.race([decode, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 30000); })]);
    const width = decoded.naturalWidth || decoded.width, height = decoded.naturalHeight || decoded.height;
    if (!width || !height || width * height > MAX_PIXELS) fail('Photographs must be at most 80 megapixels. Resize this photograph first.');
    const scale = Math.min(1, 4096 / width, 4096 / height), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d'); if (!context) fail('This browser could not prepare the photograph.');
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const mime = info.extension === 'jpg' ? 'image/jpeg' : 'image/png';
    const result = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));
    if (!result || result.size > MAX_BYTES) fail('The prepared photograph is too large. Resize it before publishing.');
    return { bytes: new Uint8Array(await result.arrayBuffer()), extension: info.extension };
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    fail(info.mime === 'image/heic' ? 'This browser cannot open that HEIC photograph. Export it as JPEG in Photos and choose the JPEG.' : 'This browser could not open the photograph. Choose a JPEG or PNG version.');
  } finally {
    clearTimeout(timer); decoded?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function createPublisher(options = {}) {
  const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
  const cryptoApi = options.crypto || globalThis.crypto;
  const cleanImage = options.cleanImage || cleanBrowserImage;
  const now = options.now || (() => new Date().toISOString());
  let credential = null, login = null, publishing = false;
  const digest = async bytes => [...new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const session = () => ({ authenticated: Boolean(credential), ...(login ? { login } : {}) });

  async function api(path, { method = 'GET', data, token = credential, missing = false } = {}) {
    if (!token) fail('Connect your GitHub publishing key first.');
    if (path !== '/user' && !path.startsWith(PREFIX + '/')) fail('Unexpected publishing destination.');
    let response;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 60000);
    try {
      response = await fetcher(API + path, { method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: abort.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}) });
    } catch { throw new PublisherError('GitHub could not be reached. Your draft is still saved; reconnect and retry.'); }
    finally { clearTimeout(timer); }
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 401) { credential = null; login = null; }
      const message = response.status === 401 ? 'Your publishing key has expired or was revoked. Connect a new key.' :
        response.status === 403 ? 'GitHub declined this request. Check that your key allows Contents: read and write for public-writing, or wait if GitHub has limited requests.' :
        response.status === 409 || response.status === 422 ? 'The saved post changed while publishing. Refresh your posts before trying again.' :
        response.status === 429 ? 'GitHub is receiving too many requests. Your draft is saved; wait a minute before retrying.' : 'GitHub could not save this request. Your draft remains available; please retry.';
      throw new PublisherError(message, response.status);
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { fail('GitHub returned an unreadable response. Your draft remains saved.'); }
  }

  async function snapshot() {
    const ref = await api(`${PREFIX}/git/ref/heads/main`);
    const commit = await api(`${PREFIX}/git/commits/${encodeURIComponent(ref.object.sha)}`);
    return { head: ref.object.sha, tree: commit.tree.sha };
  }
  async function tree(sha) {
    const result = await api(`${PREFIX}/git/trees/${encodeURIComponent(sha)}`);
    if (result.truncated || !Array.isArray(result.tree)) fail('The repository listing is incomplete. Publishing stopped to protect your existing posts.');
    return result.tree;
  }
  async function entryAt(root, parts) {
    let sha = root;
    for (let i = 0; i < parts.length; i++) {
      const entry = (await tree(sha)).find(item => item.path === parts[i]);
      if (!entry) return null;
      if (i === parts.length - 1) return entry;
      if (entry.type !== 'tree') fail('The saved post folder could not be read.');
      sha = entry.sha;
    }
    return null;
  }
  async function readBlob(entry) {
    if (entry.type !== 'blob' || entry.mode !== '100644' || (entry.size && entry.size > 128000)) fail('The saved post record has an unexpected format.');
    const blob = await api(`${PREFIX}/git/blobs/${encodeURIComponent(entry.sha)}`);
    if (blob.encoding !== 'base64' || blob.size > 128000) fail('The saved post record has an unexpected format.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(blob.content.replace(/\s/g, ''), 128000))); }
    catch { fail('The saved post record could not be read.'); }
  }
  const contentDigest = record => digest(encoder.encode(JSON.stringify({
    title: record.title || '', body: record.body,
    images: record.images.map(image => ({ path: image.path, alt: image.alt })),
  })));
  async function normalizeRecord(record, id) {
    validRecord(record, id);
    // Issue-origin hashes refer to the original issue Markdown. Composer hashes
    // are always derived from the actual record, never a possibly stale field.
    return record.authoring === AUTHORING ? { ...record, content_hash: await contentDigest(record) } : record;
  }
  async function readPost(root, id) {
    const entry = await entryAt(root, ['stream', 'posts', `${id}.json`]);
    return entry ? { record: await normalizeRecord(await readBlob(entry), id), sha: entry.sha } : null;
  }
  async function verifyMedia(root, path) {
    const entry = await entryAt(root, path.split('/'));
    if (!entry || entry.type !== 'blob' || entry.mode !== '100644' || entry.size > MAX_BYTES) fail('An existing photograph is missing or unreadable.');
    const blob = await api(`${PREFIX}/git/blobs/${encodeURIComponent(entry.sha)}`);
    if (blob.encoding !== 'base64' || blob.size > MAX_BYTES) fail('An existing photograph is missing or unreadable.');
    const bytes = fromBase64(blob.content.replace(/\s/g, ''), MAX_BYTES);
    if (!path.endsWith('/' + (await digest(bytes)).slice(0, 24) + '.' + path.split('.').pop())) fail('An existing photograph changed outside the composer. Select it again before publishing.');
  }
  const saved = record => ({ status: 'saved', post: publicPost(record) });

  return {
    async getSession() { return session(); },
    async signIn(token) {
      if (typeof token !== 'string' || !/^github_pat_[A-Za-z0-9_]{20,500}$/.test(token.trim())) fail('Use a fine-grained GitHub publishing key beginning with github_pat_.');
      token = token.trim();
      const user = await api('/user', { token });
      if (user.login !== OWNER) fail('Connect the annimch04 account to publish on Fieldlight.');
      // Reading the fixed repository verifies access without changing anything.
      const repo = await api(`${PREFIX}/contents/stream`, { token, missing: true });
      if (repo !== null && !Array.isArray(repo)) fail('The canonical source folder could not be read.');
      credential = token; login = user.login; return session();
    },
    async logOut() { credential = null; login = null; return session(); },
    async listPosts() {
      const current = await snapshot();
      const folder = await entryAt(current.tree, ['stream', 'posts']);
      if (!folder) return { posts: [] };
      if (folder.type !== 'tree') fail('The saved post folder could not be read.');
      const entries = (await tree(folder.sha)).filter(entry => /^post-[1-9][0-9]*\.json$/.test(entry.path));
      const posts = [];
      // Limit parallel requests for large archives and GitHub's secondary limits.
      for (let i = 0; i < entries.length; i += 4) {
        posts.push(...await Promise.all(entries.slice(i, i + 4).map(async entry => publicPost(await normalizeRecord(await readBlob(entry), entry.path.slice(0, -5))))));
      }
      posts.sort((a, b) => b.published_at.localeCompare(a.published_at));
      return { posts };
    },
    async publish(payload) {
      if (publishing) fail('A post is already being saved. Wait for it to finish.');
      if (!credential) fail('Connect your GitHub publishing key first.');
      publishing = true;
      try {
        if (!payload || typeof payload !== 'object' || !UUID.test(payload.client_id || '')) fail('The draft identifier is missing. Save a new draft and retry.');
        const id = payload.id || `post-${BigInt('0x' + payload.client_id.replaceAll('-', '')).toString()}`;
        if (!POST_ID.test(id)) fail('The post identifier is invalid.');
        const title = typeof payload.title === 'string' ? payload.title.trim() : '', body = typeof payload.body === 'string' ? payload.body.replace(/\r\n/g, '\n').trim() : '';
        if (title.length > 180 || /[\r\n]/.test(title) || CONTROL.test(title)) fail('Use a one-line title of no more than 180 characters.');
        if (body.length > 10000 || CONTROL.test(body)) fail('Keep the post under 10,000 characters and remove control characters.');
        if (!Array.isArray(payload.images) || payload.images.length > MAX_IMAGES) fail('Choose no more than eight photographs.');
        if (!body && !payload.images.length) fail('Add text or at least one photograph.');
        let current = await snapshot(), prior = await readPost(current.tree, id);
        if (payload.id && !prior) fail('The post you are editing no longer exists. Your draft is preserved.');
        if (prior && prior.record.authoring !== AUTHORING) fail('This post was created through the earlier publishing form. Edit its original GitHub post instead.');
        const initialSha = prior?.sha || null, images = [], uploads = new Map();
        const existing = new Set((prior?.record.images || []).map(image => image.path));
        for (const image of payload.images) {
          if (!image || typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 500 || CONTROL.test(image.alt)) fail('Add a description of up to 500 characters for each photograph.');
          const alt = image.alt.trim();
          if (Object.hasOwn(image, 'path')) {
            if (Object.hasOwn(image, 'data') || typeof image.path !== 'string' || !new RegExp(`^stream/media/${id}/[a-f0-9]{24}\\.(jpg|png)$`).test(image.path) || !existing.has(image.path)) fail('An existing photograph does not belong to this post.');
            await verifyMedia(current.tree, image.path);
            images.push({ path: image.path, alt });
          } else {
            const raw = fromBase64(image.data); inspectImage(raw);
            const cleaned = await cleanImage(raw);
            if (!(cleaned.bytes instanceof Uint8Array) || !['jpg', 'png'].includes(cleaned.extension) || !cleaned.bytes.length || cleaned.bytes.length > MAX_BYTES) fail('The photograph could not be prepared for publication.');
            const name = (await digest(cleaned.bytes)).slice(0, 24) + '.' + cleaned.extension;
            const path = `stream/media/${id}/${name}`; uploads.set(path, cleaned.bytes); images.push({ path, alt });
          }
        }
        const contentHash = await contentDigest({ title, body, images });
        if (prior?.record.content_hash === contentHash) {
          for (const path of uploads.keys()) await verifyMedia(current.tree, path);
          return saved(prior.record);
        }
        if (!payload.id && prior) fail('This draft was already saved with different content. Open the saved post to edit it.');
        if (prior && (!payload.base_hash || payload.base_hash !== prior.record.content_hash)) fail('This post changed since you opened it. Refresh saved posts before publishing your changes. Your draft is preserved.');
        const stamp = now();
        if (Number.isNaN(Date.parse(stamp))) fail('The publication date could not be read.');
        const record = { id, authoring: AUTHORING, published_at: prior?.record.published_at || stamp,
          updated_at: prior && Date.parse(stamp) < Date.parse(prior.record.updated_at || prior.record.published_at) ? prior.record.updated_at || prior.record.published_at : stamp,
          ...(title ? { title } : {}), body, images,
          source_url: `https://github.com/${REPO}/blob/main/stream/posts/${id}.json`, content_hash: contentHash };
        // No remote write occurs until all text, images, ownership and conflicts pass.
        const blobs = [];
        for (const [path, bytes] of uploads) {
          const blob = await api(`${PREFIX}/git/blobs`, { method: 'POST', data: { encoding: 'base64', content: toBase64(bytes) } });
          blobs.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const sourceBlob = await api(`${PREFIX}/git/blobs`, { method: 'POST', data: { encoding: 'base64', content: toBase64(jsonBytes(record)) } });
        blobs.push({ path: `stream/posts/${id}.json`, mode: '100644', type: 'blob', sha: sourceBlob.sha });
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) {
            current = await snapshot(); const latest = await readPost(current.tree, id);
            if (latest?.record.content_hash === contentHash) {
              for (const image of latest.record.images) await verifyMedia(current.tree, image.path);
              return saved(latest.record);
            }
            if ((latest?.sha || null) !== initialSha) fail('This post changed on another device. Refresh saved posts before trying again. Your draft is preserved.');
            for (const image of images) if (!uploads.has(image.path)) await verifyMedia(current.tree, image.path);
          }
          const nextTree = await api(`${PREFIX}/git/trees`, { method: 'POST', data: { base_tree: current.tree, tree: blobs } });
          const commit = await api(`${PREFIX}/git/commits`, { method: 'POST', data: { message: payload.id ? 'Update Fieldlight stream post' : 'Add Fieldlight stream post', tree: nextTree.sha, parents: [current.head] } });
          try {
            await api(`${PREFIX}/git/refs/heads/main`, { method: 'PATCH', data: { sha: commit.sha, force: false } });
            return saved(record);
          } catch (error) {
            // The ref may have advanced even when its response was lost. Read the
            // canonical record before reporting failure; never manufacture a new ID.
            if (!error.status || error.status >= 500) {
              try {
                const observed = await snapshot(), latest = await readPost(observed.tree, id);
                if (latest?.record.content_hash === contentHash) {
                  for (const image of latest.record.images) await verifyMedia(observed.tree, image.path);
                  return saved(latest.record);
                }
              } catch { /* Keep the original error and local draft when unconfirmed. */ }
            }
            if (![409, 422].includes(error.status) || attempt === 2) throw error;
          }
        }
      } finally { publishing = false; }
    },
    async checkLive(post) {
      if (!post || !POST_ID.test(post.id || '') || !/^[a-f0-9]{64}$/.test(post.content_hash || '')) return false;
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
      try {
        const response = await fetcher(`${SITE}/stream/feed.json?verify=${encodeURIComponent(now())}`, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal });
        if (!response.ok) return false;
        const feed = await response.json();
        return Array.isArray(feed.items) && feed.items.some(item => item.url === `${SITE}/stream/posts/${post.id}/` && item._fieldlight_content_hash === post.content_hash);
      } catch { return false; } finally { clearTimeout(timer); }
    },
  };
}
