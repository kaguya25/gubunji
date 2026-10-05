import { openDB, type DBSchema } from 'idb';
import { Capture, CaptureSchema, fingerprint, Observation } from './core';
interface Queue {
  id: string;
  scope: string;
  attempts: number;
  nextAt: number;
  error: string;
  blocked: boolean;
}
interface Schema extends DBSchema {
  observations: {
    key: [string, string];
    value: Observation;
    indexes: { scope: string; fingerprint: [string, string] };
  };
  outbox: { key: [string, string]; value: Queue; indexes: { scope: string } };
  meta: { key: string; value: unknown };
}
let database: ReturnType<typeof openDB<Schema>> | null = null;
export const db = () =>
  (database ??= openDB<Schema>('gubunji-data-v1', 1, {
    upgrade(db) {
      const o = db.createObjectStore('observations', { keyPath: ['scope', 'id'] });
      o.createIndex('scope', 'scope');
      o.createIndex('fingerprint', ['scope', 'fingerprint'], { unique: true });
      db.createObjectStore('outbox', { keyPath: ['scope', 'id'] }).createIndex('scope', 'scope');
      db.createObjectStore('meta');
    },
  }));
export async function saveCapture(scope: string, input: Capture, enqueue = true) {
  const payload = CaptureSchema.parse(input),
    hash = await fingerprint(payload),
    database = await db();
  const tx = database.transaction(['observations', 'outbox'], 'readwrite');
  const old = await tx.objectStore('observations').index('fingerprint').get([scope, hash]);
  if (old) {
    await tx.done;
    return old.id;
  }
  const id = crypto.randomUUID();
  await tx.objectStore('observations').add({ id, scope, fingerprint: hash, payload });
  if (enqueue && !payload.demo)
    await tx
      .objectStore('outbox')
      .add({ id, scope, attempts: 0, nextAt: 0, error: '', blocked: false });
  await tx.done;
  return id;
}
export async function observations(scope: string) {
  return (await db()).getAllFromIndex('observations', 'scope', scope);
}
export async function queue(scope: string) {
  return (await db()).getAllFromIndex('outbox', 'scope', scope);
}
export async function meta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}
export async function setMeta(key: string, value: unknown) {
  return (await db()).put('meta', value, key);
}
export async function acknowledge(scope: string, id: string, seq: number) {
  const database = await db(),
    tx = database.transaction(['observations', 'outbox'], 'readwrite');
  const o = await tx.objectStore('observations').get([scope, id]);
  if (o) {
    o.seq = seq;
    await tx.objectStore('observations').put(o);
  }
  await tx.objectStore('outbox').delete([scope, id]);
  await tx.done;
}
export async function applyRemote(
  scope: string,
  rows: { operation_id: string; payload: unknown; sequence: number }[],
  cursor: number,
) {
  // Validation completes before opening the IDB transaction.
  const validated = await Promise.all(
    rows.map(async (row) => {
      const payload = CaptureSchema.parse(row.payload);
      return {
        id: row.operation_id,
        scope,
        payload,
        fingerprint: await fingerprint(payload),
        seq: row.sequence,
      };
    }),
  );
  const database = await db(),
    tx = database.transaction(['observations', 'outbox', 'meta'], 'readwrite');
  for (const row of validated) {
    const old = await tx
      .objectStore('observations')
      .index('fingerprint')
      .get([scope, row.fingerprint]);
    if (!old || old.id === row.id) await tx.objectStore('observations').put(row);
    // ACK only the operation actually returned by the server.
    await tx.objectStore('outbox').delete([scope, row.id]);
  }
  await tx.objectStore('meta').put(cursor, `cursor:${scope}`);
  await tx.done;
}
export async function fail(scope: string, id: string, error: string, permanent: boolean) {
  const database = await db(),
    q = await database.get('outbox', [scope, id]);
  if (!q) return;
  q.attempts++;
  q.error = error.slice(0, 180);
  q.blocked = permanent;
  q.nextAt = Date.now() + Math.min(3600000, 5000 * 2 ** Math.min(q.attempts, 10));
  await database.put('outbox', q);
}
export async function retry(scope: string) {
  const database = await db(),
    rows = await queue(scope),
    tx = database.transaction('outbox', 'readwrite');
  for (const q of rows) await tx.store.put({ ...q, blocked: false, nextAt: 0 });
  await tx.done;
}
