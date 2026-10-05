import { Capture, parseCount } from './core';
export const defaultAdapter = {
  resultRoot: '.prt-result, .prt-result-multi, #result',
  list: '.prt-item-list',
  item: '[data-key]',
  name: '[data-item-name], .txt-item-name',
  count: '.prt-article-count',
  quest: '.txt-quest-name, .prt-quest-name, .txt-enemy-name',
  total: '',
  turns: '',
  actor: '',
  actorName: '',
  actorTotal: '',
  actorNormal: '',
  actorAbility: '',
  actorOugi: '',
  actorOther: '',
  verified: false,
  implicitOne: false,
};
export type Adapter = typeof defaultAdapter;
const text = (el: Element | null) => el?.textContent?.trim().slice(0, 300) ?? '';
export function displayed(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}
export function resultRoot(document: Document, a: Adapter) {
  return (
    [...document.querySelectorAll(a.resultRoot)].find(displayed) ??
    [...document.querySelectorAll(a.list)].find(displayed)?.parentElement ??
    null
  );
}
export function routeInfo(hash: string) {
  const multi = hash.match(/^#result_multi\/(?:detail\/)?(\d+)(?:\/|$)/);
  const coop = hash.match(/^#coopraid\/record\/detail\/(\d+)(?:\/|$)/);
  if (multi || coop) return { kind: coop ? 'coop' : 'multi', id: (multi ?? coop)![1] };
  if (/^#result(?:\/|$)/.test(hash)) return { kind: 'solo', id: null };
  return null;
}
export function validateAdapter(a: Adapter, document: Document) {
  for (const key of ['resultRoot', 'list', 'item', 'name', 'count', 'quest'] as const)
    if (!a[key]?.trim()) throw new Error(`${key} のセレクターを入力してください`);
  for (const [key, value] of Object.entries(a))
    if (typeof value === 'string' && value) {
      if (value.length > 300) throw new Error(`${key} のセレクターが長すぎます`);
      try {
        document.querySelector(value);
      } catch {
        throw new Error(`${key} のセレクターが不正です`);
      }
    }
}
export function capture(
  document: Document,
  hash: string,
  host: string,
  viewKey: string,
  a: Adapter = defaultAdapter,
): Capture | null {
  const route = routeInfo(hash);
  if (!route) return null;
  validateAdapter(a, document);
  const root = resultRoot(document, a);
  if (!root) return null;
  const lists = [...root.querySelectorAll(a.list)].filter(displayed);
  if (root.matches(a.list)) lists.unshift(root);
  const issues = new Set<string>();
  if (!a.verified) issues.add('画面の読み取り設定が未検証です');
  if (!route.id) issues.add('戦闘ID未取得・重複の可能性があります');
  const drops: Capture['drops'] = [];
  lists.forEach((list, section) => {
    for (const item of list.querySelectorAll(a.item)) {
      if (!displayed(item)) continue;
      if (item.parentElement?.closest(a.item) && list.contains(item.parentElement.closest(a.item)))
        continue;
      const img = item.querySelector('img');
      const rawKey = item.getAttribute('data-key') ?? '';
      // Article's kind/id are kept as-is until an actual adapter has been verified.
      const kind = item.getAttribute('data-item-kind');
      const id = item.getAttribute('data-item-id');
      const key = kind && id ? `${kind}:${id}` : rawKey;
      const label = item.querySelector(a.name);
      const name =
        label?.getAttribute('data-item-name') ||
        text(label) ||
        img?.getAttribute('alt') ||
        item.getAttribute('title') ||
        `アイテム ${key || '未識別'}`;
      const count = item.querySelector(a.count);
      const quantity =
        parseCount(text(count)) ?? (a.verified && a.implicitOne && !count ? 1 : null);
      if (!key) issues.add('識別できないアイテムがあります');
      if (quantity == null) issues.add('数量未取得のアイテムがあります');
      drops.push({ key, name: name.slice(0, 300), quantity, section: `list:${section}` });
    }
  });
  const value = (selector: string) =>
    selector ? parseCount(text(root.querySelector(selector))) : null;
  const actors: Capture['damage']['actors'] = [];
  if (a.actor)
    for (const [slot, el] of [...root.querySelectorAll(a.actor)].filter(displayed).entries()) {
      const v = (selector: string) =>
        selector ? parseCount(text(el.querySelector(selector))) : null;
      const unit = el.getAttribute('data-character-id') ?? el.getAttribute('data-unit-id');
      const name = a.actorName ? text(el.querySelector(a.actorName)) : `スロット ${slot + 1}`;
      actors.push({
        key: unit ? `unit:${unit}` : `slot:${slot}`,
        name,
        total: v(a.actorTotal),
        normal: v(a.actorNormal),
        ability: v(a.actorAbility),
        ougi: v(a.actorOugi),
        other: v(a.actorOther),
      });
      if (!unit) issues.add('キャラID未取得・スロット順で記録しています');
    }
  if (!lists.length && !actors.length && value(a.total) == null) return null;
  const complete =
    a.verified &&
    lists.length > 0 &&
    drops.length > 0 &&
    drops.every((d) => d.key && d.quantity != null);
  return {
    schemaVersion: 1,
    captureKey: viewKey,
    battleKey: route.id ? `${host}:${route.kind}:${route.id}` : null,
    identity: route.id ? (a.verified ? 'verified' : 'candidate') : 'weak',
    quest: text(root.querySelector(a.quest)) || 'クエスト名未取得',
    route: `#${route.kind}${route.id ? '/' + route.id : ''}`,
    capturedAt: new Date().toISOString(),
    adapter: 'dom-v1',
    drops,
    dropState: complete ? 'complete' : 'partial',
    damage: { total: value(a.total), turns: value(a.turns), actors },
    issues: [...issues],
    demo: false,
  };
}
export function diagnostics(document: Document, hash: string, a: Adapter) {
  validateAdapter(a, document);
  const root = resultRoot(document, a);
  // Never export page HTML, cookies, chat text, URLs with tokens, or player names.
  return {
    schemaVersion: 1,
    adapter: a,
    routeKind: routeInfo(hash)?.kind ?? 'unsupported',
    rootFound: !!root,
    listCount: root?.querySelectorAll(a.list).length ?? 0,
    items: [...(root?.querySelectorAll(`${a.list} ${a.item}`) ?? [])].slice(0, 50).map((el) => ({
      key: el.getAttribute('data-key'),
      kind: el.getAttribute('data-item-kind'),
      id: el.getAttribute('data-item-id'),
      quantity: text(el.querySelector(a.count)),
      itemLabel: el.querySelector('img')?.getAttribute('alt')?.slice(0, 150) ?? '',
    })),
    actorCount: a.actor ? (root?.querySelectorAll(a.actor).length ?? 0) : 0,
  };
}
