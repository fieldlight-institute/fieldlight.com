import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {sealConnection, unsealConnection, withRememberedConnection} from '../post/connection.js';

test('remembered credentials require the unlock password and reject modified ciphertext', async () => {
  const token = 'test-only-key-not-a-real-credential';
  const record = await sealConnection(token, 'test-only-unlock-passphrase', webcrypto);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.equal(await unsealConnection(record, 'test-only-unlock-passphrase', webcrypto), token);
  await assert.rejects(unsealConnection(record, 'wrong-password', webcrypto), /could not unlock/);
  const damaged = structuredClone(record); new Uint8Array(damaged.encrypted)[0] ^= 1;
  await assert.rejects(unsealConnection(damaged, 'test-only-unlock-passphrase', webcrypto), /could not unlock/);
});

test('connection is remembered only on explicit choice, locks, and can be forgotten', async () => {
  let current = null, saved;
  const adapter = {
    async getSession() { return {authenticated: Boolean(current)}; },
    async signIn(token) { current = token; return {authenticated: true}; },
    async logOut() { current = null; },
  };
  const store = {async get() {return saved;}, async put(value) {saved = value;}, async remove() {saved = undefined;}};
  const connection = withRememberedConnection(adapter, {store, cryptoImpl: webcrypto});
  await connection.signIn('test-key'); assert.equal(saved, undefined);
  await connection.signIn('test-key', {remember: true, passphrase: 'test-only-unlock-passphrase'});
  await connection.logOut(); assert.equal((await connection.getSession()).locked, true);
  assert.equal((await connection.unlock('test-only-unlock-passphrase')).authenticated, true);
  await connection.forgetConnection(); assert.equal(saved, undefined); assert.equal(current, null);
});

test('forget invalidates an unlock already signing in and removes the saved key', async () => {
  let current, saved = await sealConnection('test-key', 'test-only-unlock-passphrase', webcrypto);
  let started, finish;
  const signingIn = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const adapter = {
    async getSession() {return {authenticated: Boolean(current)};},
    async signIn(token) {started(); await gate; current = token; return {authenticated: true};},
    async logOut() {current = null;},
  };
  const store = {async get() {return saved;}, async put(value) {saved = value;}, async remove() {saved = undefined;}};
  const connection = withRememberedConnection(adapter, {store, cryptoImpl: webcrypto});
  const pending = connection.unlock('test-only-unlock-passphrase');
  const rejected = assert.rejects(pending, /connection changed/);
  await signingIn;
  const forgotten = connection.forgetConnection();
  finish(); await rejected; await forgotten;
  assert.equal(current, null); assert.equal(saved, undefined);
  assert.deepEqual(await connection.getSession(), {authenticated: false, locked: false, remembered: false});
});
