import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import * as store from '../src/store';
import { demoCaptures } from '../src/demo';
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
import { defaults, validateConnection, setConnection, signIn, signOut, sync } from '../src/sync';
it('allows publishable keys only and rejects credential-bearing/foreign URLs', () => {
  expect(validateConnection('https://example.supabase.co', 'sb_publishable_test')).toBe(
    'https://example.supabase.co',
  );
  for (const url of [
    'http://example.supabase.co',
    'https://evil.example',
    'https://user:pass@example.supabase.co',
    'https://example.supabase.co/?secret=x',
  ])
    expect(() => validateConnection(url, 'sb_publishable_test')).toThrow();
  expect(() => validateConnection('https://example.supabase.co', 'sb_secret_bad')).toThrow();
});
it('acknowledges real responses, retains failures, avoids unnecessary refresh and serializes logout', async () => {
  const session = { user: { id: 'user-a' }, expires_at: Math.round(Date.now() / 1000) + 3600 };
  const events: string[] = [];
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      refreshSession: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => {
        events.push('logout');
        return { error: null };
      }),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  };
  mocks.createClient.mockReturnValue(client);
  await store.setMeta('settings', defaults);
  await setConnection('https://example.supabase.co', 'sb_publishable_test', 'main');
  await signIn('test@example.com', 'password');
  const scope = 'https://example.supabase.co|user-a|main';
  const id = await store.saveCapture(scope, { ...demoCaptures()[0], demo: false });
  const query: any = {
    select: () => query,
    eq: () => query,
    gt: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  client.from.mockReturnValue(query);
  client.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: '503', message: 'network temporarily failed' },
  });
  await sync();
  expect(await store.queue(scope)).toHaveLength(1);
  expect(client.auth.refreshSession).not.toHaveBeenCalled();
  await store.retry(scope);
  let release: (result: unknown) => void = () => {};
  client.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
        events.push('rpc');
      }),
  );
  const sending = sync();
  await vi.waitFor(() => expect(events).toContain('rpc'));
  const loggingOut = signOut();
  expect(client.auth.signOut).not.toHaveBeenCalled();
  release({ data: 1, error: null });
  await sending;
  await loggingOut;
  expect(events).toEqual(['rpc', 'logout']);
  expect(await store.queue(scope)).toHaveLength(0);
  expect((await store.observations(scope))[0].id).toBe(id);
  expect(await store.meta<{ scope: string }>('settings')).toMatchObject({ scope: 'local' });
});
