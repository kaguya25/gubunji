import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as store from './store';
export type Settings = {
  url: string;
  key: string;
  profile: string;
  enabled: boolean;
  scope: string;
};
export const defaults: Settings = {
  url: '',
  key: '',
  profile: 'main',
  enabled: true,
  scope: 'local',
};
let client: SupabaseClient | null = null,
  clientUrl = '',
  inFlight: Promise<void> | null = null;
let tail: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => {});
  return result;
}
export async function settings() {
  return { ...defaults, ...(await store.meta<Settings>('settings')) };
}
export function validateConnection(url: string, key: string) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    !/^([a-z0-9-]+)\.supabase\.co$/.test(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('https://プロジェクトID.supabase.co のURLを入力してください');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    throw new Error('sb_publishable_ で始まる公開キーを使ってください');
  return u.origin;
}
export async function getClient() {
  const s = await settings();
  if (!s.url || !s.key) return null;
  const identity = s.url + '|' + s.key;
  if (client && identity === clientUrl) return client;
  clientUrl = identity;
  client = createClient(s.url, s.key, {
    auth: {
      storage: {
        getItem: async (k) => (await store.meta<string>(`auth:${k}`)) ?? null,
        setItem: async (k, v) => {
          await store.setMeta(`auth:${k}`, v);
        },
        removeItem: async (k) => {
          await (await store.db()).delete('meta', `auth:${k}`);
        },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}
export async function setConnection(url: string, key: string, profile: string) {
  return exclusive(async () => {
    const origin = validateConnection(url, key);
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(profile))
      throw new Error('プロフィールは英数字・_・- の50文字以内にしてください');
    const previous = await settings();
    if (previous.scope !== 'local' && (previous.url !== origin || previous.profile !== profile))
      throw new Error('接続先を変える前にログアウトしてください');
    await store.setMeta('settings', { ...previous, url: origin, key, profile });
    client = null;
  });
}
export async function signIn(email: string, password: string, signup = false) {
  return exclusive(async () => {
    const c = await getClient();
    if (!c) throw new Error('接続先を保存してください');
    const result = signup
      ? await c.auth.signUp({ email, password })
      : await c.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (result.data.session) {
      const s = await settings();
      await store.setMeta('settings', {
        ...s,
        scope: `${s.url}|${result.data.session.user.id}|${s.profile}`,
      });
    }
    return result.data.session
      ? 'ログインしました'
      : '確認メールを開いた後、この画面からログインしてください';
  });
}
export async function signOut() {
  return exclusive(async () => {
    const c = await getClient();
    if (c) {
      const { error } = await c.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    const s = await settings();
    await store.setMeta('settings', { ...s, scope: 'local' });
  });
}
async function runSync() {
  const s = await settings(),
    c = await getClient();
  if (!c || s.scope === 'local') return;
  const { data, error: sessionError } = await c.auth.getSession();
  if (sessionError) throw sessionError;
  if (!data.session) throw new Error('ログインが必要です。未送信データは保持しています');
  // Verify the active bucket matches the current user, project, and profile.
  if (s.scope !== `${s.url}|${data.session.user.id}|${s.profile}`)
    throw new Error('保存先とログインユーザーが一致しません');
  if (!data.session.expires_at || data.session.expires_at * 1000 < Date.now() + 60000) {
    const { error } = await c.auth.refreshSession();
    if (error) throw error;
  }
  for (const q of (await store.queue(s.scope))
    .filter((q) => !q.blocked && q.nextAt <= Date.now())
    .slice(0, 100)) {
    const o = await (await store.db()).get('observations', [s.scope, q.id]);
    if (!o) continue;
    const { data, error } = await c.rpc('gbf_append_observation', {
      p_profile: s.profile,
      p_operation: o.id,
      p_payload: o.payload,
    });
    if (error) {
      await store.fail(s.scope, q.id, error.message, /^(22|23|42|P0001)/.test(error.code));
      if (error.code === 'PGRST301') break;
      continue;
    }
    if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 1)
      throw new Error('DBの保存応答が不正です');
    await store.acknowledge(s.scope, o.id, data);
  }
  let cursor = (await store.meta<number>(`cursor:${s.scope}`)) ?? 0;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await c
      .from('gbf_observations')
      .select('operation_id,payload,sequence')
      .eq('profile_id', s.profile)
      .gt('sequence', cursor)
      .order('sequence')
      .limit(200);
    if (error) throw error;
    if (!data?.length) break;
    cursor = data[data.length - 1].sequence;
    await store.applyRemote(s.scope, data, cursor);
    if (data.length < 200) break;
  }
  await store.setMeta(`sync:${s.scope}`, { at: new Date().toISOString(), error: '' });
}
export function sync() {
  if (inFlight) return inFlight;
  inFlight = exclusive(runSync)
    .catch(async (e) => {
      const s = await settings();
      await store.setMeta(`sync:${s.scope}`, { at: '', error: e.message });
      throw e;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
