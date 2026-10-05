import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { demoCaptures } from '../src/demo';
import * as store from '../src/store';
describe('durable observations and outbox', () => {
  it('deduplicates a retransmitted snapshot in the same bucket', async () => {
    const c = { ...demoCaptures()[0], demo: false };
    const first = await store.saveCapture('a', c);
    const second = await store.saveCapture('a', { ...c, capturedAt: '2026-10-05T12:00:00.000Z' });
    expect(first).toBe(second);
    expect(await store.queue('a')).toHaveLength(1);
    expect(await store.observations('a')).toHaveLength(1);
  });
  it('partitions accounts and demo never enters the outbox', async () => {
    const c = { ...demoCaptures()[1], demo: false };
    await store.saveCapture('b', c);
    await store.saveCapture('demo', demoCaptures()[2]);
    expect(await store.observations('b')).toHaveLength(1);
    expect(await store.queue('demo')).toHaveLength(0);
    expect(await store.observations('c')).toHaveLength(0);
  });
  it('keeps failed sends and acknowledges only committed operations', async () => {
    const id = await store.saveCapture('retry', { ...demoCaptures()[3], demo: false });
    await store.fail('retry', id, 'network', false);
    expect((await store.queue('retry'))[0].attempts).toBe(1);
    await store.acknowledge('retry', id, 1);
    expect(await store.queue('retry')).toHaveLength(0);
    expect((await store.observations('retry'))[0].seq).toBe(1);
  });
  it('applies remote rows and cursor atomically; malformed payload does not advance cursor', async () => {
    await store.applyRemote(
      'remote',
      [{ operation_id: 'remote-1', payload: demoCaptures()[4], sequence: 1 }],
      1,
    );
    expect(await store.meta('cursor:remote')).toBe(1);
    await expect(
      store.applyRemote(
        'remote',
        [{ operation_id: 'bad', payload: { bad: true }, sequence: 2 }],
        2,
      ),
    ).rejects.toThrow();
    expect(await store.meta('cursor:remote')).toBe(1);
  });
  it('blocks permanent errors until explicit retry', async () => {
    const id = await store.saveCapture('blocked', { ...demoCaptures()[5], demo: false });
    await store.fail('blocked', id, 'bad schema', true);
    expect((await store.queue('blocked'))[0].blocked).toBe(true);
    await store.retry('blocked');
    expect((await store.queue('blocked'))[0].blocked).toBe(false);
  });
  it('keeps the same remote operation id isolated across users', async () => {
    await store.applyRemote(
      'user-one',
      [{ operation_id: 'same-id', payload: { ...demoCaptures()[0], quest: 'one' }, sequence: 1 }],
      1,
    );
    await store.applyRemote(
      'user-two',
      [{ operation_id: 'same-id', payload: { ...demoCaptures()[0], quest: 'two' }, sequence: 1 }],
      1,
    );
    expect((await store.observations('user-one'))[0].payload.quest).toBe('one');
    expect((await store.observations('user-two'))[0].payload.quest).toBe('two');
  });
});
