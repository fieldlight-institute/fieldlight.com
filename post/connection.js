// A remembered publishing key is encrypted on this device. Its unlock password
// and the decrypted GitHub key are never persisted or sent to Fieldlight.
const DATABASE = 'fieldlight-publishing-connection';
const ITERATIONS = 600000;

function browserStore() {
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('connection');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close the other Fieldlight connection window and try again.'));
    request.onsuccess = () => resolve(request.result);
  });
  const operation = async (mode, action) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('connection', mode);
        const request = action(tx.objectStore('connection'));
        let result;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || request.error);
        tx.onabort = () => reject(tx.error || new Error('Connection could not be saved.'));
      });
    } finally { db.close(); }
  };
  return {
    get: () => operation('readonly', store => store.get('key')),
    put: value => operation('readwrite', store => store.put(value, 'key')),
    remove: () => operation('readwrite', store => store.delete('key')),
  };
}

async function derive(passphrase, salt, cryptoImpl) {
  const material = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return cryptoImpl.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS}, material,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}

export async function sealConnection(token, passphrase, cryptoImpl = crypto) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Choose an unlock password of at least 12 characters.');
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt, cryptoImpl);
  const encrypted = await cryptoImpl.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(token));
  return {version: 1, salt, iv, encrypted};
}

export async function unsealConnection(record, passphrase, cryptoImpl = crypto) {
  try {
    if (record?.version !== 1 || record.salt?.byteLength !== 16 || record.iv?.byteLength !== 12
        || record.encrypted?.byteLength > 4096 || !record.encrypted?.byteLength) throw new Error('Invalid connection');
    const key = await derive(passphrase, record.salt, cryptoImpl);
    const plaintext = await cryptoImpl.subtle.decrypt({name: 'AES-GCM', iv: record.iv}, key, record.encrypted);
    return new TextDecoder().decode(plaintext);
  } catch { throw new Error('That password could not unlock this connection. Try again, or forget it and reconnect.'); }
}

export function withRememberedConnection(adapter, {store = browserStore(), cryptoImpl = crypto} = {}) {
  let remembered = false, generation = 0, queue = Promise.resolve();
  const enqueue = action => {
    const result = queue.catch(() => {}).then(action);
    queue = result.catch(() => {});
    return result;
  };
  const valid = async ticket => {
    if (ticket !== generation) {
      await adapter.logOut();
      throw new Error('The connection changed. Sign in again when ready.');
    }
  };
  return {
    ...adapter,
    getSession() {
      return enqueue(async () => {
        const session = await adapter.getSession();
        try { remembered = Boolean(await store.get()); } catch { remembered = false; }
        return {...session, locked: remembered && !session.authenticated, remembered};
      });
    },
    signIn(token, options = {}) {
      const ticket = ++generation;
      return enqueue(async () => {
        await valid(ticket);
        const encrypted = options.remember ? await sealConnection(token, options.passphrase, cryptoImpl) : null;
        await valid(ticket);
        const result = await adapter.signIn(token);
        await valid(ticket);
        if (!result.authenticated) return result;
        if (encrypted) {
          try { await store.put(encrypted); remembered = true; }
          catch {
            await adapter.logOut();
            throw new Error('This device could not remember the connection. Reconnect without Remember this device.');
          }
          await valid(ticket);
        }
        return {...result, locked: false, remembered};
      });
    },
    unlock(passphrase) {
      const ticket = ++generation;
      return enqueue(async () => {
        await valid(ticket);
        const record = await store.get();
        if (!record) throw new Error('This device has no saved connection. Connect with a publishing key.');
        const token = await unsealConnection(record, passphrase, cryptoImpl);
        await valid(ticket);
        const session = await adapter.signIn(token);
        await valid(ticket);
        remembered = true;
        return {...session, locked: false, remembered};
      });
    },
    logOut() {
      ++generation;
      return enqueue(async () => {
        await adapter.logOut();
        return {authenticated: false, locked: remembered, remembered};
      });
    },
    forgetConnection() {
      ++generation;
      return enqueue(async () => {
        await adapter.logOut();
        await store.remove();
        remembered = false;
        return {authenticated: false, locked: false, remembered: false};
      });
    },
  };
}
