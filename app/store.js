// IndexedDB persistence: append-only ledger + pages/boards/books + user collections.
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function openStore(name = 'book-of-babel') {
  const db = await new Promise((res, rej) => {
    const o = indexedDB.open(name, 1);
    o.onupgradeneeded = () => {
      const d = o.result;
      d.createObjectStore('meta', { keyPath: 'k' });
      const p = d.createObjectStore('pages', { keyPath: 'idx' }); p.createIndex('seed', 'seed'); p.createIndex('hash', 'hash'); p.createIndex('book', 'bookIdx'); p.createIndex('startSeq', 'startSeq');
      d.createObjectStore('sigs', { keyPath: 'idx' });
      d.createObjectStore('books', { keyPath: 'idx' });
      const b = d.createObjectStore('boards', { keyPath: 'idx' }); b.createIndex('hash', 'hash'); b.createIndex('seed', 'seed'); b.createIndex('startSeq', 'startSeq');
      d.createObjectStore('ledger', { keyPath: 'n' }).createIndex('seqEnd', 'seqEnd');
      d.createObjectStore('user', { keyPath: 'id' });
    };
    o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
  });
  const tx = (stores, mode = 'readonly') => db.transaction(stores, mode);
  return {
    db,
    get: (s, k) => req(tx(s).objectStore(s).get(k)),
    all: (s) => req(tx(s).objectStore(s).getAll()),
    count: (s) => req(tx(s).objectStore(s).count()),
    put: (s, v) => req(tx(s, 'readwrite').objectStore(s).put(v)),
    del: (s, k) => req(tx(s, 'readwrite').objectStore(s).delete(k)),
    byIndex: (s, i, k) => req(tx(s).objectStore(s).index(i).getAll(k)),
    range: (s, lo, hi, limit = 1000, dir = 'next') => new Promise((res, rej) => { // by primary key
      const out = [], r = tx(s).objectStore(s).openCursor(IDBKeyRange.bound(lo, hi), dir);
      r.onsuccess = () => { const c = r.result; if (c && out.length < limit) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = () => rej(r.error);
    }),
    last: (s, n = 20) => new Promise((res, rej) => {
      const out = [], r = tx(s).objectStore(s).openCursor(null, 'prev');
      r.onsuccess = () => { const c = r.result; if (c && out.length < n) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = () => rej(r.error);
    }),
    ledgerFor: (from, to) => new Promise((res, rej) => { // entries overlapping [from,to] via seqEnd index
      const out = [], r = tx('ledger').objectStore('ledger').index('seqEnd').openCursor(IDBKeyRange.lowerBound(from));
      r.onsuccess = () => { const c = r.result; if (c && c.value.seqStart <= to) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = () => rej(r.error);
    }),
    commit(writes) { // writes: [[store, value], ...] atomically
      return new Promise((res, rej) => {
        const names = [...new Set(writes.map((w) => w[0]))], t = tx(names, 'readwrite');
        for (const [s, v] of writes) t.objectStore(s).put(v);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
  };
}
export async function floorRecord(store, storeName, indexName, key) { // greatest record with index value <= key
  return new Promise((res, rej) => {
    const r = store.db.transaction(storeName).objectStore(storeName).index(indexName).openCursor(IDBKeyRange.upperBound(key), 'prev');
    r.onsuccess = () => res(r.result ? r.result.value : null); r.onerror = () => rej(r.error);
  });
}
