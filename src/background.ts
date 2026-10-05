import { z } from 'zod';
import { CaptureSchema } from './core';
import { defaultAdapter } from './capture';
import * as store from './store';
import * as cloud from './sync';
const gameHosts = new Set(['game.granbluefantasy.jp', 'gbf.game.mbga.jp']);
const extensionOrigin = chrome.runtime.getURL('');
async function handle(msg: unknown, sender: chrome.runtime.MessageSender) {
  const m = z.object({ type: z.string(), payload: z.unknown().optional() }).parse(msg);
  const own = sender.url?.startsWith(extensionOrigin);
  if (m.type === 'CAPTURE') {
    if (!sender.url || !gameHosts.has(new URL(sender.url).hostname))
      throw new Error('許可されていない取得元です');
    const s = await cloud.settings();
    if (!s.enabled) return { paused: true };
    const capture = CaptureSchema.parse(m.payload);
    if (capture.demo) throw new Error('デモデータはゲームから記録できません');
    const id = await store.saveCapture(s.scope, capture);
    await store.setMeta(`lastCapture:${s.scope}`, {
      at: capture.capturedAt,
      scope: s.scope,
      quest: capture.quest,
      issues: capture.issues,
    });
    void cloud.sync().catch(() => {});
    return { id };
  }
  if (m.type === 'CONFIG')
    return {
      enabled: (await cloud.settings()).enabled,
      adapter: (await store.meta('adapter')) ?? defaultAdapter,
    };
  if (!own) throw new Error('拡張画面から操作してください');
  if (m.type === 'SYNC') {
    const s = await cloud.settings();
    if (s.scope === 'local') throw new Error('Supabaseへの接続とログインを済ませてください');
    await store.retry(s.scope);
    await cloud.sync();
    return { pending: (await store.queue(s.scope)).length };
  }
  if (m.type === 'CONNECTION') {
    const p = z.object({ url: z.string(), key: z.string(), profile: z.string() }).parse(m.payload);
    await cloud.setConnection(p.url, p.key, p.profile);
    return {};
  }
  if (m.type === 'LOGIN' || m.type === 'SIGNUP') {
    const p = z
      .object({ email: z.string().email(), password: z.string().min(6).max(200) })
      .parse(m.payload);
    return { message: await cloud.signIn(p.email, p.password, m.type === 'SIGNUP') };
  }
  if (m.type === 'LOGOUT') {
    await cloud.signOut();
    return {};
  }
  if (m.type === 'UPLOAD_LOCAL') {
    const s = await cloud.settings();
    if (s.scope === 'local') throw new Error('ログインしてください');
    for (const o of await store.observations('local')) await store.saveCapture(s.scope, o.payload);
    void cloud.sync().catch(() => {});
    return {};
  }
  if (m.type === 'STATUS') {
    const s = await cloud.settings();
    return {
      settings: s,
      lastCapture: await store.meta(`lastCapture:${s.scope}`),
      sync: await store.meta(`sync:${s.scope}`),
      pending: await store.queue(s.scope),
    };
  }
  throw new Error('操作を認識できません');
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: e.message }),
  );
  return true;
});
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  chrome.alarms.create('sync', { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  void cloud.sync().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') void cloud.sync().catch(() => {});
});
