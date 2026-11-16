import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Keep these tests usable without changing this static site's module settings.
const source = await readFile(new URL('../post/composer.js', import.meta.url), 'utf8');
const { newDraft, hasContent, draftFromPost, publishPayload } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const NOW = '2026-11-16T12:00:00.000Z';
const uuids = () => {
  let serial = 0;
  return () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
};
const makeDraft = () => newDraft(uuids(), NOW);
const post = () => ({
  id: 'post-123', title: 'Morning', body: 'A thought.', authoring: 'fieldlight-composer',
  published_at: '2026-11-15T12:00:00.000Z', updated_at: NOW, content_hash: 'a'.repeat(64),
  images: [{ path: 'stream/media/post-123/light.jpg', alt: 'Sunlight across the floor' }],
  url: 'https://fieldlight.com/stream/posts/post-123/',
});

test('new drafts have separate local and retry identities and no publication state', () => {
  const uuid = uuids();
  const first = newDraft(uuid, NOW);
  const second = newDraft(uuid, NOW);
  assert.notEqual(first.local_id, first.client_id);
  assert.notEqual(first.client_id, second.client_id);
  assert.equal(first.published, false);
  assert.equal(first.created_at, NOW);
  assert.equal(hasContent(first), false);
  assert.equal(hasContent({ ...first, title: '  ', body: '\n\t' }), false);
  assert.equal(hasContent({ ...first, title: 'An unfinished title' }), true);
  assert.equal(hasContent({ ...first, images: [{ alt: 'A photo' }] }), true);
});

test('structured-clone draft recovery preserves original photo bytes and the exact retry payload', async () => {
  const draft = makeDraft();
  draft.title = '  Morning light  ';
  draft.body = 'A quiet morning.\nA second line.';
  draft.images.push({
    blob: new Blob([new Uint8Array([0, 255, 42, 128])], { type: 'image/png' }),
    filename: 'morning.png', mimeType: 'image/png', alt: 'Light on a windowsill',
  });
  const recovered = structuredClone(draft);
  const initial = await publishPayload(draft);
  const retry = await publishPayload(recovered);
  assert.deepEqual(retry, initial);
  assert.equal(retry.client_id, draft.client_id);
  assert.equal(retry.title, 'Morning light');
  assert.equal(retry.body, draft.body);
  assert.deepEqual(retry.images, [{
    data: 'AP8qgA==', alt: 'Light on a windowsill', mimeType: 'image/png', filename: 'morning.png',
  }]);
  assert.equal('id' in retry, false);
});

test('photo serialization preserves bytes across chunk boundaries', async () => {
  const bytes = Uint8Array.from({ length: 100003 }, (_, index) => index % 256);
  const draft = makeDraft();
  draft.images = [{ blob: new Blob([bytes], { type: 'image/jpeg' }), filename: 'large.jpg', alt: 'A landscape' }];
  const payload = await publishPayload(draft);
  assert.deepEqual(Buffer.from(payload.images[0].data, 'base64'), Buffer.from(bytes));
  assert.equal(payload.images[0].mimeType, 'image/jpeg');
  assert.equal(payload.images[0].filename, 'large.jpg');
});

test('editing a published post preserves its identity and conflict hash without mutating the source record', async () => {
  const record = post();
  const draft = draftFromPost(record, uuids(), NOW);
  assert.equal(draft.published, true);
  assert.equal(draft.published_at, record.published_at);
  assert.equal(draft.images[0].url, '/stream/media/post-123/light.jpg');
  draft.title = 'Morning, revised';
  draft.body = 'A revised thought.';
  draft.images[0].alt = 'Sunlight and long shadows';
  const payload = await publishPayload(draft);
  assert.equal(payload.id, record.id);
  assert.equal(payload.base_hash, record.content_hash);
  assert.equal(payload.body, 'A revised thought.');
  assert.deepEqual(payload.images, [{ path: record.images[0].path, alt: 'Sunlight and long shadows' }]);
  assert.equal(record.body, 'A thought.');
  assert.equal(record.images[0].alt, 'Sunlight across the floor');
});

test('mixed existing and new photographs keep their order and descriptions', async () => {
  const draft = draftFromPost(post(), uuids(), NOW);
  draft.images.push({ blob: new Blob(['second'], { type: 'image/png' }), filename: 'second.png', alt: 'Second photograph' });
  const payload = await publishPayload(draft);
  assert.deepEqual(payload.images[0], { path: 'stream/media/post-123/light.jpg', alt: 'Sunlight across the floor' });
  assert.equal(payload.images[1].data, Buffer.from('second').toString('base64'));
  assert.equal(payload.images[1].alt, 'Second photograph');
  assert.equal('data' in payload.images[0], false);
  assert.equal('path' in payload.images[1], false);
});

test('source-saved draft recovery retains pending confirmation without claiming publication', async () => {
  const draft = makeDraft();
  draft.body = 'Waiting for the website.';
  draft.post_id = post().id;
  draft.base_hash = post().content_hash;
  draft.source_saved = true;
  draft.pending_post = post();
  const recovered = structuredClone(draft);
  assert.equal(recovered.published, false);
  assert.equal(recovered.source_saved, true);
  assert.equal(recovered.pending_post.content_hash, draft.pending_post.content_hash);
  assert.equal(recovered.client_id, draft.client_id);
  assert.deepEqual(await publishPayload(recovered), await publishPayload(draft));
});

test('publishing sends only authoring fields, never local draft or connection state', async () => {
  const draft = makeDraft();
  draft.body = 'Public words.';
  draft.pending_post = post();
  draft.source_saved = true;
  draft.preview_url = 'blob:local-only';
  draft.connection = { token: 'test-only-not-a-real-credential' };
  const payload = await publishPayload(draft);
  assert.deepEqual(Object.keys(payload).sort(), ['body', 'client_id', 'images', 'title']);
  assert.equal(JSON.stringify(payload).includes('test-only-not-a-real-credential'), false);
  assert.equal(JSON.stringify(payload).includes('blob:local-only'), false);
});
