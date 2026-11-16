import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
// Import works regardless of whether the repository declares an ES-module package.
const source = await readFile(new URL('../post/publisher.js', import.meta.url), 'utf8');
const { createPublisher, inspectImage, cleanBrowserImage } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const TOKEN = 'github_pat_' + 'testOnlyNotACredential'.repeat(3);
const UUID = '7bd648ab-a109-4bcc-8cd1-bfde560d252d';
const ID = 'post-' + BigInt('0x' + UUID.replaceAll('-', '')).toString();
const BASE = '/repos/annimch04/public-writing';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9sAAAAASUVORK5CYII=', 'base64'));
const payload = extra => ({ client_id: UUID, title: 'A note', body: 'A line of text.', images: [], ...extra });
const contentHash = value => createHash('sha256').update(JSON.stringify({ title: value.title || '', body: value.body, images: value.images.map(image => ({ path: image.path, alt: image.alt })) })).digest('hex');
const record = extra => {
  const value = { id: ID, authoring: 'fieldlight-composer', published_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', body: 'Original', images: [], ...extra };
  return { ...value, content_hash: extra?.content_hash || contentHash(value) };
};

class Repository {
  constructor(initial = []) {
    this.calls = []; this.blobs = new Map(); this.versions = new Map(); this.pendingTrees = new Map();
    this.head = 'initial'; this.serial = 0; this.mutation = null; this.failRef = false; this.live = [];
    const files = new Map(initial.map(([path, value]) => [path, this.addBlob(Buffer.from(JSON.stringify(value)))]));
    this.versions.set(this.head, { files, parent: null });
  }
  addBlob(bytes) { const sha = 'blob' + (++this.serial); this.blobs.set(sha, Buffer.from(bytes)); return sha; }
  files() { return this.versions.get(this.head).files; }
  post() { const sha = this.files().get(`stream/posts/${ID}.json`); return sha && JSON.parse(this.blobs.get(sha)); }
  advance(update = {}) {
    const files = new Map(this.files());
    for (const [path, content] of Object.entries(update)) files.set(path, this.addBlob(Buffer.from(JSON.stringify(content))));
    const head = 'external' + (++this.serial); this.versions.set(head, { files, parent: this.head }); this.head = head;
  }
  response(status, data) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }
  fetch = async (url, options = {}) => {
    const parsed = new URL(url), path = decodeURIComponent(parsed.pathname), method = options.method || 'GET';
    this.calls.push({ url, path, method, options });
    if (parsed.origin === 'https://fieldlight.com') {
      assert.equal(options.headers?.Authorization, undefined); return this.response(200, { items: this.live });
    }
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    if (path === '/user') return this.response(200, { login: this.user || 'annimch04' });
    if (path === BASE + '/contents/stream') return this.response(200, []);
    if (path === BASE + '/git/ref/heads/main') return this.response(200, { object: { sha: this.head } });
    if (path.startsWith(BASE + '/git/commits/') && method === 'GET') {
      const commit = path.slice((BASE + '/git/commits/').length);
      return this.response(200, { tree: { sha: commit + ':tree:' } });
    }
    if (path.startsWith(BASE + '/git/trees/') && method === 'GET') {
      const reference = path.slice((BASE + '/git/trees/').length), [head, directory] = reference.split(':tree:');
      const files = this.versions.get(head).files, entries = new Map(), prefix = directory ? directory + '/' : '';
      for (const [filename, sha] of files) {
        if (!filename.startsWith(prefix)) continue;
        const remainder = filename.slice(prefix.length), first = remainder.split('/')[0];
        if (remainder.includes('/')) entries.set(first, { path: first, type: 'tree', mode: '040000', sha: head + ':tree:' + prefix + first });
        else entries.set(first, { path: first, type: 'blob', mode: '100644', sha, size: this.blobs.get(sha).length });
      }
      return this.response(200, { tree: [...entries.values()], truncated: false });
    }
    if (path.startsWith(BASE + '/git/blobs/') && method === 'GET') {
      const blob = this.blobs.get(path.slice((BASE + '/git/blobs/').length));
      return this.response(200, { content: blob.toString('base64'), encoding: 'base64', size: blob.length });
    }
    const data = options.body && JSON.parse(options.body);
    if (path === BASE + '/git/blobs' && method === 'POST') return this.response(201, { sha: this.addBlob(Buffer.from(data.content, data.encoding)) });
    if (path === BASE + '/git/trees' && method === 'POST') {
      const files = new Map(this.versions.get(data.base_tree.split(':tree:')[0]).files);
      for (const item of data.tree) { assert.equal(item.type, 'blob'); assert.equal(item.mode, '100644'); files.set(item.path, item.sha); }
      const sha = 'tree' + (++this.serial); this.pendingTrees.set(sha, files); return this.response(201, { sha });
    }
    if (path === BASE + '/git/commits' && method === 'POST') {
      assert.equal(data.author, undefined); assert.equal(data.committer, undefined);
      assert.ok(['Add Fieldlight stream post', 'Update Fieldlight stream post'].includes(data.message));
      const sha = 'commit' + (++this.serial); this.versions.set(sha, { files: this.pendingTrees.get(data.tree), parent: data.parents[0] }); return this.response(201, { sha });
    }
    if (path === BASE + '/git/refs/heads/main' && method === 'PATCH') {
      assert.equal(data.force, false);
      if (this.mutation) { const callback = this.mutation; this.mutation = null; callback(this); }
      if (this.failRef || this.versions.get(data.sha).parent !== this.head) return this.response(422, {});
      this.head = data.sha; if (this.loseRefResponse) { this.loseRefResponse = false; throw new Error('Connection lost after save'); } return this.response(200, { object: { sha: this.head } });
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
}
function setup(initial = []) {
  const repo = new Repository(initial);
  const publisher = createPublisher({ fetch: repo.fetch, crypto: webcrypto, now: () => '2026-11-16T12:00:00Z', cleanImage: async bytes => ({ bytes, extension: 'png' }) });
  return { repo, publisher };
}
const connect = publisher => publisher.signIn(TOKEN);
const writes = repo => repo.calls.filter(call => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.method));

test('authentication is owner-only, fine-grained and memory-only', async () => {
  const { repo, publisher } = setup();
  assert.deepEqual(await publisher.getSession(), { authenticated: false });
  await assert.rejects(publisher.publish(payload()), /Connect/);
  await assert.rejects(publisher.signIn('ghp_aClassicToken'), /fine-grained/);
  repo.user = 'someone-else'; await assert.rejects(connect(publisher), /annimch04/);
  repo.user = 'annimch04'; assert.deepEqual(await connect(publisher), { authenticated: true, login: 'annimch04' });
  assert.equal(writes(repo).length, 0);
  assert.equal((await setup().publisher.getSession()).authenticated, false);
  assert.deepEqual(await publisher.logOut(), { authenticated: false });
  await assert.rejects(publisher.listPosts(), /Connect/);
});

test('a source post is committed atomically; retry preserves ID/date and makes no extra writes', async () => {
  const { repo, publisher } = setup(); await connect(publisher);
  const first = await publisher.publish(payload());
  assert.equal(first.status, 'saved'); assert.equal(first.post.id, ID); assert.equal(first.post.authoring, 'fieldlight-composer');
  assert.equal(first.post.url, `https://fieldlight.com/stream/posts/${ID}/`);
  assert.equal(first.post.source_url, `https://github.com/annimch04/public-writing/blob/main/stream/posts/${ID}.json`);
  assert.equal(repo.post().body, 'A line of text.');
  const count = writes(repo).length, second = await publisher.publish(payload());
  assert.deepEqual(first, second); assert.equal(writes(repo).length, count);
  const list = await publisher.listPosts(); assert.equal(list.posts.length, 1); assert.equal(list.posts[0].id, ID);
  await assert.rejects(publisher.publish(payload({ body: 'Different retry' })), /already saved/);
});

test('editing preserves original date and rejects stale or missing base hashes', async () => {
  const prior = record(), { repo, publisher } = setup([[`stream/posts/${ID}.json`, prior]]); await connect(publisher);
  await assert.rejects(publisher.publish(payload({ id: ID })), /changed since/);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: 'b'.repeat(64) })), /changed since/);
  assert.equal(writes(repo).length, 0);
  const result = await publisher.publish(payload({ id: ID, base_hash: prior.content_hash }));
  assert.equal(result.post.published_at, prior.published_at); assert.equal(result.post.updated_at, '2026-11-16T12:00:00Z');
});

test('issue-origin posts remain read-only', async () => {
  const { repo, publisher } = setup([[`stream/posts/${ID}.json`, record({ authoring: undefined })]]); await connect(publisher);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: 'a'.repeat(64) })), /earlier publishing form/);
  assert.equal(writes(repo).length, 0);
});

test('photos and JSON enter the same commit; original filename and MIME are untrusted', async () => {
  const { repo, publisher } = setup(); await connect(publisher);
  const result = await publisher.publish(payload({ images: [{ data: Buffer.from(PNG).toString('base64'), filename: '../../secret', mimeType: 'image/svg+xml', alt: 'A small photograph' }] }));
  assert.match(result.post.images[0].path, new RegExp(`^stream/media/${ID}/[a-f0-9]{24}\\.png$`));
  const treeWrite = writes(repo).find(call => call.path === BASE + '/git/trees');
  assert.equal(JSON.parse(treeWrite.options.body).tree.length, 2);
  assert.equal(repo.files().size, 2);
});

test('existing image paths are verified against record and actual Git tree', async () => {
  const path = `stream/media/${ID}/${'a'.repeat(24)}.png`, prior = record({ images: [{ path, alt: 'Original photo' }] });
  const { repo, publisher } = setup([[`stream/posts/${ID}.json`, prior]]); await connect(publisher);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: prior.content_hash, images: [{ path, alt: 'Updated' }] })), /missing or unreadable/);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: prior.content_hash, images: [{ path: '../secret', alt: 'Updated' }] })), /does not belong/);
  assert.equal(writes(repo).length, 0);
});

test('invalid content causes no remote mutations', async () => {
  const { repo, publisher } = setup(); await connect(publisher);
  for (const value of [payload({ body: 'x'.repeat(10001) }), payload({ title: 'a\nb' }), payload({ body: '', images: [] }), payload({ images: new Array(9).fill({}) }), payload({ images: [{ alt: '', data: 'a===' }] }), payload({ client_id: '../oops' })]) await assert.rejects(publisher.publish(value));
  assert.equal(writes(repo).length, 0);
});

test('concurrent unrelated source changes are retained on bounded retry', async () => {
  const { repo, publisher } = setup(); await connect(publisher);
  repo.mutation = store => store.advance({ 'unrelated.json': { preserved: true } });
  await publisher.publish(payload());
  assert.ok(repo.files().has('unrelated.json')); assert.ok(repo.post());
  assert.equal(writes(repo).filter(call => call.method === 'PATCH').length, 2);
});

test('concurrent changes to the same post are never overwritten', async () => {
  const original = record(), { repo, publisher } = setup([[`stream/posts/${ID}.json`, original]]); await connect(publisher);
  repo.mutation = store => store.advance({ [`stream/posts/${ID}.json`]: record({ body: 'Other device', content_hash: 'b'.repeat(64) }) });
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: original.content_hash })), /another device/);
  assert.equal(repo.post().body, 'Other device');
});

test('failed reference publication leaves canonical source unchanged and never claims saved', async () => {
  const { repo, publisher } = setup(); await connect(publisher); repo.failRef = true;
  await assert.rejects(publisher.publish(payload()));
  assert.equal(repo.head, 'initial'); assert.equal(repo.post(), undefined);
  assert.equal(writes(repo).filter(call => call.method === 'PATCH').length, 3);
});

test('live state requires matching permalink and exact content hash without transmitting the token', async () => {
  const { repo, publisher } = setup(); await connect(publisher); const { post } = await publisher.publish(payload());
  assert.equal(await publisher.checkLive(post), false);
  repo.live = [{ url: post.url, _fieldlight_content_hash: 'b'.repeat(64) }]; assert.equal(await publisher.checkLive(post), false);
  repo.live = [{ url: post.url, _fieldlight_content_hash: post.content_hash }]; assert.equal(await publisher.checkLive(post), true);
  assert.equal(await publisher.checkLive({ id: '../secret', content_hash: post.content_hash }), false);
});

test('image inspection rejects oversized originals, SVG and animation', () => {
  assert.equal(inspectImage(PNG).width, 1);
  const big = new Uint8Array(PNG); new DataView(big.buffer).setUint32(16, 10000); new DataView(big.buffer).setUint32(20, 10000);
  assert.throws(() => inspectImage(big), /80 megapixels/);
  assert.throws(() => inspectImage(encoderForTest('<svg/>')), /Choose a JPEG/);
  // Two 1x1 GIF image descriptors, with valid short LZW blocks.
  const gif = new Uint8Array([71,73,70,56,57,97,1,0,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
  assert.throws(() => inspectImage(gif), /Animated/);
  const apng = new Uint8Array([...PNG.slice(0, 33), 0,0,0,0,97,99,84,76,0,0,0,0, ...PNG.slice(33)]);
  assert.throws(() => inspectImage(apng), /Animated/);
});
const encoderForTest = value => new TextEncoder().encode(value);

test('photo preparation exports only freshly drawn canvas pixels, never original metadata', async () => {
  const oldBitmap = globalThis.createImageBitmap, oldDocument = globalThis.document;
  let drawn = false, closed = false;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() { closed = true; } });
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { getContext() { return { drawImage() { drawn = true; } }; }, toBlob(callback, mime) { assert.equal(drawn, true); assert.equal(mime, 'image/png'); callback(new Blob([PNG], { type: mime })); } };
  } };
  try { const cleaned = await cleanBrowserImage(PNG); assert.deepEqual(cleaned.bytes, PNG); assert.equal(closed, true); }
  finally { globalThis.createImageBitmap = oldBitmap; globalThis.document = oldDocument; }
});


test('an ambiguous reference response is recovered by reading the exact saved hash', async () => {
  const { repo, publisher } = setup(); await connect(publisher); repo.loseRefResponse = true;
  const result = await publisher.publish(payload());
  assert.equal(result.status, 'saved'); assert.equal(repo.post().content_hash, result.post.content_hash);
  assert.equal(writes(repo).filter(call => call.method === 'PATCH').length, 1);
});

test('an existing verified image can be retained without uploading it again', async () => {
  const path = `stream/media/${ID}/${createHash('sha256').update(PNG).digest('hex').slice(0, 24)}.png`, prior = record({ images: [{ path, alt: 'Original photo' }] });
  const { repo, publisher } = setup([[`stream/posts/${ID}.json`, prior]]);
  repo.files().set(path, repo.addBlob(PNG)); await connect(publisher);
  const result = await publisher.publish(payload({ id: ID, base_hash: prior.content_hash, images: [{ path, alt: 'Updated description' }] }));
  assert.equal(result.post.images[0].path, path);
  assert.equal(writes(repo).filter(call => call.path === BASE + '/git/blobs').length, 1);
});


test('manual text edits with a stale stored hash cannot pass an edit precondition', async () => {
  const original = record(), changed = { ...original, body: 'Changed outside the composer' };
  const { repo, publisher } = setup([[`stream/posts/${ID}.json`, changed]]); await connect(publisher);
  const { posts } = await publisher.listPosts();
  assert.equal(posts[0].content_hash, contentHash(changed)); assert.notEqual(posts[0].content_hash, original.content_hash);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: original.content_hash })), /changed since/);
  assert.equal(writes(repo).length, 0); assert.equal(repo.post().body, changed.body);
});

test('a retry cannot claim an externally modified record matches the old version', async () => {
  const { repo, publisher } = setup(); await connect(publisher); const first = await publisher.publish(payload());
  repo.advance({ [`stream/posts/${ID}.json`]: { ...repo.post(), body: 'External edit', content_hash: first.post.content_hash } });
  const count = writes(repo).length;
  await assert.rejects(publisher.publish(payload()), /already saved/);
  assert.equal(writes(repo).length, count);
});

test('manual image replacement under a content-addressed name is rejected', async () => {
  const path = `stream/media/${ID}/${createHash('sha256').update(PNG).digest('hex').slice(0, 24)}.png`;
  const prior = record({ images: [{ path, alt: 'Original' }] });
  const { repo, publisher } = setup([[`stream/posts/${ID}.json`, prior]]);
  repo.files().set(path, repo.addBlob(Buffer.from('Different photograph'))); await connect(publisher);
  await assert.rejects(publisher.publish(payload({ id: ID, base_hash: prior.content_hash, images: prior.images })), /changed outside/);
  assert.equal(writes(repo).length, 0);
});

test('canonical hash normalizes image object key order and agrees with the generator fixture', async () => {
  const value = record({ title: 'Café 🌿', body: 'First\n\nSecond “line”', images: [{ alt: 'Light & shade', path: 'stream/media/post-123/abcdef.png', ignored: true }], content_hash: 'stale' });
  const { publisher } = setup([[`stream/posts/${ID}.json`, value]]); await connect(publisher);
  assert.equal((await publisher.listPosts()).posts[0].content_hash, '666126a1e8e6a66c0020f3af8f81630a8e9f5dc1d08fb8a0839418b98d5b32b6');
});
