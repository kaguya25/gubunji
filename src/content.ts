import {
  capture,
  diagnostics,
  defaultAdapter,
  routeInfo,
  resultRoot,
  type Adapter,
} from './capture';
import { fingerprint } from './core';
let adapter: Adapter = defaultAdapter,
  enabled = true,
  route = location.hash,
  viewKey = crypto.randomUUID(),
  last = '',
  timer: ReturnType<typeof setTimeout> | undefined;
let observer: MutationObserver | null = null,
  probe: MutationObserver | null = null;
async function read() {
  if (!enabled || !routeInfo(location.hash)) return;
  try {
    const result = capture(document, location.hash, location.hostname, viewKey, adapter);
    if (!result) return;
    const hash = await fingerprint(result);
    if (hash === last) return;
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE', payload: result });
    if (!response.ok) throw new Error(response.error);
    last = hash;
  } catch (e) {
    console.warn(
      '[gubunji] 読み取りを保存できませんでした',
      e instanceof Error ? e.message : 'unknown',
    );
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void read(), 400);
}
function observe() {
  observer?.disconnect();
  probe?.disconnect();
  if (!enabled || !routeInfo(location.hash)) return;
  const root = resultRoot(document, adapter);
  if (root) {
    observer = new MutationObserver(() => {
      if (!root.isConnected || resultRoot(document, adapter) !== root) observe();
      else schedule();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-key',
        'data-item-id',
        'data-item-kind',
        'class',
        'style',
        'hidden',
        'aria-hidden',
      ],
    });
    schedule();
  }
  // Only watch child insertion while locating/replacing the result region. No body text scan.
  probe = new MutationObserver(() => {
    const next = resultRoot(document, adapter);
    if (next && next !== root) observe();
  });
  probe.observe(document.body, { childList: true, subtree: true });
}
async function reload() {
  const response = await chrome.runtime.sendMessage({ type: 'CONFIG' });
  if (!response.ok) return;
  adapter = { ...defaultAdapter, ...response.data.adapter };
  enabled = response.data.enabled;
  last = '';
  observe();
}
function navigate() {
  if (route !== location.hash) {
    route = location.hash;
    viewKey = crypto.randomUUID();
    last = '';
    observe();
  }
}
addEventListener('hashchange', navigate);
addEventListener('popstate', navigate);
addEventListener('pageshow', () => void reload());
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void reload();
});
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m.type === 'DIAGNOSE') {
    try {
      reply({ ok: true, data: diagnostics(document, location.hash, adapter) });
    } catch (e) {
      reply({ ok: false, error: (e as Error).message });
    }
    return;
  }
  if (m.type === 'RELOAD') void reload();
});
void reload();
