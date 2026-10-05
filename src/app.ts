import {
  type Battle,
  type Observation,
  csv,
  damageAnalysis,
  dropSummary,
  parseBackup,
  project,
} from './core';
import { defaultAdapter, validateAdapter, type Adapter } from './capture';
import * as store from './store';
import { defaults } from './sync';
import { demoCaptures } from './demo';
const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const isPopup = document.body.classList.contains('popup');
const root = document.querySelector<HTMLDivElement>('#app')!;
let page = 'overview',
  demo = false,
  query = '',
  questFilter = '',
  selected = '',
  notice = '',
  records: Battle[] = [],
  obs: Observation[] = [];
let status: any = { settings: defaults, pending: [], sync: null, lastCapture: null };
const escape = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const num = (n: number | null | undefined) => (n == null ? '未取得' : n.toLocaleString('ja-JP'));
const date = (s: string) =>
  new Date(s).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const button = (action: string, label: string, cls = '') =>
  `<button data-action="${action}" class="${cls}">${label}</button>`;
async function send(type: string, payload?: unknown) {
  if (!isExtension) {
    if (type === 'STATUS')
      return {
        settings: { ...defaults, ...((await store.meta('settings')) as object) },
        pending: await store.queue('local'),
        sync: null,
        lastCapture: await store.meta('lastCapture:local'),
      };
    throw new Error('この操作はChrome拡張で利用できます');
  }
  const r = await chrome.runtime.sendMessage({ type, payload });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
async function load() {
  status = await send('STATUS');
  obs = demo ? await store.observations('demo') : await store.observations(status.settings.scope);
  records = project(obs);
  render();
}
function questBattles() {
  return records.filter((b) => !questFilter || b.quest === questFilter);
}
function filtered() {
  return questBattles().filter(
    (b) => b.quest.includes(query) || b.drops.some((d) => d.name.includes(query)),
  );
}
function pending(b: Battle) {
  return status.pending.some((q: any) => b.observationIds.includes(q.id));
}
function badge(b: Battle) {
  return `<span class="badge ${b.issues.length ? 'amber' : 'green'}">${b.issues.length ? '要確認' : b.dropState === 'complete' ? '取得済み' : '一部取得'}</span>`;
}
function list(rows: Battle[]) {
  if (!rows.length)
    return `<div class="empty"><div class="empty-icon">◇</div><h2>最初のリザルトを待っています</h2><p>Chromeでグラブルのリザルトを開くと、読み取れた内容をここに記録します。</p><p>キャラ別火力は、ダメージログの読み取り設定を済ませてから詳細画面を開いてください。</p>${button('demo', 'サンプルで画面を試す', 'primary')}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>日時 / クエスト</th><th>ドロップ</th><th>総ダメージ</th><th>読み取り</th><th>保存</th></tr></thead><tbody>${rows.map((b) => `<tr data-record="${escape(b.key)}" tabindex="0"><td><span class="muted">${date(b.capturedAt)}</span><strong>${escape(b.quest)}</strong></td><td>${b.drops.length}種 <span class="muted">/ ${num(b.drops.reduce((n, d) => n + (d.quantity ?? 0), 0))}個${b.drops.some((d) => d.quantity == null) ? ' + 未取得' : ''}</span></td><td class="number">${num(b.damage.total)}</td><td>${badge(b)}</td><td><span class="muted">${demo ? 'サンプル' : pending(b) ? '端末保存・未送信' : status.settings.scope === 'local' ? '端末保存' : '共通保存'}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function overview() {
  const summary = dropSummary(filtered()),
    damage = filtered().filter((b) => b.damage.total != null);
  return `<div class="hero"><div><p class="eyebrow">YOUR BATTLE NOTE</p><h1>周回の成果を、ひと目で。</h1><p>ドロップも、キャラの火力も。開いたリザルトから記録します。</p></div><div class="orbit" aria-hidden="true"><i>✦</i><span>GBF</span></div></div>
  <div class="stats"><article><span>記録した戦闘</span><b>${filtered().length}<small>戦</small></b><p>この保存先の履歴</p></article><article><span>ドロップ集計の対象</span><b>${summary.runs}<small>戦</small></b><p>${summary.excluded}戦は取得状況の確認待ち</p></article><article><span>平均総ダメージ</span><b class="damage-stat">${damage.length ? num(Math.round(damage.reduce((n, b) => n + b.damage.total!, 0) / damage.length)) : '—'}</b><p>${damage.length}戦の記録 / 条件は未統一</p></article><article><span>未送信の記録</span><b>${demo ? '—' : status.pending.length}<small>件</small></b><p>${status.settings.scope === 'local' ? 'Supabaseログイン後に移行可能' : 'オンライン時に自動送信'}</p></article></div>
  <section><div class="section-head"><div><h2>最近のバトル</h2><p>行をクリックしてドロップと火力を確認</p></div>${button('records', '履歴をすべて見る →', 'plain')}</div>${list(filtered().slice(0, 8))}</section>`;
}
function drops() {
  if (!questFilter && new Set(records.map((b) => b.quest)).size > 1)
    return '<h1>ドロップ集計</h1><section class="empty"><h2>集計するクエストを選んでください</h2><p>上のクエスト選択で、同じクエストの記録を集計できます。</p></section>';
  const summary = dropSummary(questBattles());
  const items = summary.items.filter((d) => d.name.includes(query));
  return `<h1>ドロップ集計</h1><p class="lead">取得が確認できた ${summary.runs} 戦が対象。要確認の ${summary.excluded} 戦は含めません。アイテム検索は獲得率の分母を変更しません。</p><section>${items.length ? `<table><thead><tr><th>アイテム</th><th>合計</th><th>獲得した戦闘</th><th>獲得率</th></tr></thead><tbody>${items.map((d) => `<tr><td><strong>${escape(d.name)}</strong><span class="muted">${escape(d.key)}</span></td><td>${num(d.quantity)}個</td><td>${d.hits} / ${summary.runs}戦</td><td>${((d.rate ?? 0) * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><h2>表示できるアイテムがありません</h2><p>検索条件と記録の取得状況を確認してください。</p></div>'}</section>`;
}
function damageDetail(b: Battle) {
  const d = damageAnalysis(b);
  return `<div class="section-head"><div><h2>キャラ別ダメージ</h2><p>総ダメージ ${num(b.damage.total)} / ${num(b.damage.turns)}ターン</p></div></div>${d.invalid ? '<p class="warning">キャラ合計が総ダメージを超えています。構成比は表示しません。</p>' : ''}
  ${d.actors.length ? `<div class="actors">${d.actors.map((a) => `<article><div class="actor-top"><strong>${escape(a.name)}</strong><b>${num(a.total)}</b><span>${a.share == null ? '—' : (a.share * 100).toFixed(1) + '%'}</span></div><div class="bar"><i style="width:${a.share == null ? 0 : Math.min(100, a.share * 100)}%"></i></div><div class="actor-types"><span>通常 ${num(a.normal)}</span><span>アビ ${num(a.ability)}</span><span>奥義 ${num(a.ougi)}</span><span>その他 ${num(a.other)}</span><span>1ターン ${a.perTurn == null ? '未取得' : num(Math.round(a.perTurn))}</span></div></article>`).join('')}</div><p class="muted">召喚・チェイン等の未割り当て: ${num(d.residual)}。未取得の内訳は0に置き換えません。</p>` : '<div class="empty small"><h2>キャラ別ダメージは未取得です</h2><p>ゲームでダメージログを開き、設定のセレクターを実際の表示に合わせてください。</p></div>'}`;
}
function detail() {
  const b = records.find((b) => b.key === selected);
  if (!b) return list(filtered());
  return `${button('records', '← 履歴に戻る', 'plain')}<h1>${escape(b.quest)}</h1><p class="lead">${date(b.capturedAt)} ・ ${badge(b)} ・ ${escape(b.key)}</p>${b.issues.length ? `<div class="warning">${b.issues.map(escape).join('<br>')}</div>` : ''}<section><h2>ドロップ</h2><div class="drop-grid">${b.drops.map((d) => `<article><span class="item-icon">◆</span><div><strong>${escape(d.name)}</strong><span class="muted">${escape(d.key)}</span></div><b>×${num(d.quantity)}</b></article>`).join('') || '<p>ドロップ未取得</p>'}</div></section><section>${damageDetail(b)}</section>`;
}
function firepower() {
  const rows = filtered().filter((b) => b.damage.actors.length);
  return `<h1>キャラの火力</h1><p class="lead">バトルごとに総ダメージ・構成比・内訳を確認できます。</p>${
    rows.length
      ? rows
          .slice(0, 20)
          .map(
            (b) =>
              `<section><div class="section-head"><div><h2>${escape(b.quest)}</h2><p>${date(b.capturedAt)}</p></div></div>${damageDetail(b)}</section>`,
          )
          .join('')
      : '<section class="empty"><h2>キャラの記録を待っています</h2><p>ゲームのダメージログを開くと、設定に一致する表示を記録します。</p></section>'
  }`;
}
function settingsPage() {
  const s = status.settings;
  return `<h1>設定と保存先</h1><p class="lead">ゲームのアカウントとは別の、記録用ログインです。</p><div class="settings-grid"><section><h2>Supabase</h2><form id="connection"><label>Project URL<input name="url" type="url" value="${escape(s.url)}" placeholder="https://project.supabase.co" required></label><label>Publishable key<input name="key" value="${escape(s.key)}" placeholder="sb_publishable_…" required></label><label>プロフィール<input name="profile" value="${escape(s.profile)}" required></label><p class="muted">同じログインとプロフィールで履歴を共有。秘密キーは入力しないでください。</p><button class="primary">接続先を保存</button></form><hr>${s.scope === 'local' ? `<form id="login"><label>メール<input type="email" name="email" autocomplete="username" required></label><label>パスワード<input type="password" name="password" autocomplete="current-password" minlength="6" required></label><div class="actions"><button class="primary" name="intent" value="LOGIN">ログイン</button><button name="intent" value="SIGNUP">新規登録</button></div></form>` : `<p class="success">ログイン済み ・ ${escape(s.profile)}</p><div class="actions">${button('logout', 'ログアウト')}${button('upload', '未ログイン中の記録をこの保存先へ移行')}</div>`}</section><section><h2>記録とバックアップ</h2><p>状態: <b>${s.enabled ? '自動記録 ON' : '一時停止中'}</b></p><div class="actions">${button('toggle', s.enabled ? '自動記録を一時停止' : '自動記録を再開')}${button('sync', '今すぐ同期')}</div><hr><p>読み取り設定を調整するため、結果画面のアイテム属性だけを確認します。</p>${button('diagnose', '開いているゲーム画面を診断')}<hr><div class="actions">${button('csv', 'CSV出力')}${button('backup', 'JSONバックアップ')}<label class="file-button">JSONを端末へ復元<input id="import" type="file" accept=".json,application/json"></label></div><p class="muted">復元先は「未ログインの端末保存」です。クラウド移行はログイン後に実行します。</p></section></div><section><h2>画面の読み取り設定</h2><p>初期のドロップ設定は参考記事に基づく候補です。キャラ別火力のセレクターは実画面に合わせて設定します。</p><form id="adapter"><label>セレクター設定（JSON）<textarea name="adapter" rows="14" spellcheck="false" id="adapter-json"></textarea></label><p class="muted">verified は、アイテム・数量・戦闘IDを実画面で確認してから true にしてください。implicitOne は数量表示がない時に1個とする確認済みルールです。</p><button>読み取り設定を保存</button></form></section>`;
}
function render() {
  if (isPopup) {
    root.innerHTML = `<div class="popup-inner"><div class="brand"><span class="brand-mark">✦</span><b>ぐぶんじ</b><span class="badge green">${status.settings.enabled ? '記録 ON' : '停止中'}</span></div><p>${status.lastCapture ? '最後の記録: ' + escape(status.lastCapture.quest) : 'リザルトを開くと自動記録します'}</p><p class="muted">端末の戦闘 ${records.length}戦 / 未送信 ${status.pending.length}件</p>${button('open', '履歴と火力を見る', 'primary')}${button('diagnose', 'この画面を診断', 'plain')}<div class="notice" role="status">${escape(notice || (!demo && (status.sync?.error || status.pending.find((q: any) => q.error)?.error)) || '')}</div></div>`;
    return;
  }
  const labels = [
    ['overview', '⌂', '概要'],
    ['records', '▤', 'バトル履歴'],
    ['drops', '◇', 'ドロップ集計'],
    ['firepower', '↗', 'キャラの火力'],
    ['settings', '⚙', '設定と保存先'],
  ];
  root.innerHTML = `<aside><div class="brand"><span class="brand-mark">✦</span><div><b>ぐぶんじ</b><small>BATTLE & DROP LOG</small></div></div><p class="nav-label">WORKSPACE</p><nav>${labels.map(([id, icon, label]) => `<button data-page="${id}" class="${page === id || (page === 'detail' && id === 'records') ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('')}</nav><div class="side-note"><span class="status-dot"></span> ${status.settings.enabled ? 'リザルトを自動記録' : '自動記録は停止中'}<p>PC向けプレビュー v0.1</p><p>${demo ? 'サンプル表示中' : status.settings.scope === 'local' ? '端末に保存中' : 'Supabaseに同期'}</p></div></aside><div class="workspace"><header><div class="breadcrumb">ぐぶんじ <span>/</span> ${labels.find((l) => l[0] === page)?.[2] ?? 'バトル詳細'}</div><div class="actions">${button(demo ? 'actual' : 'demo', demo ? '自分の記録に戻る' : 'サンプルを見る', 'plain')}${button('sync', '↻ 同期', 'quiet')}<span class="badge ${status.settings.scope === 'local' ? 'amber' : 'green'}">${status.settings.scope === 'local' ? '端末保存' : 'Supabase'}</span></div></header><main>${demo ? '<div class="demo-banner">サンプル表示 ・ 架空のデータです。クラウドには送信しません。</div>' : ''}${!isExtension ? '<div class="preview-banner">ブラウザープレビューです。自動取得とログインはChrome拡張で利用できます。</div>' : ''}<div class="notice" role="status">${escape(notice)}</div>${page !== 'settings' && page !== 'detail' ? `<div class="search"><select id="quest-filter" aria-label="クエストを選択"><option value="">すべてのクエスト</option>${[...new Set(records.map((b) => b.quest))].map((q) => `<option value="${escape(q)}" ${q === questFilter ? 'selected' : ''}>${escape(q)}</option>`).join('')}</select><input id="search" placeholder="クエストやアイテムを検索" value="${escape(query)}" aria-label="クエストやアイテムを検索"></div>` : ''}${page === 'overview' ? overview() : page === 'records' ? `<h1>バトル履歴</h1><p class="lead">読み取りと保存の状態を確認できます。</p><section>${list(filtered())}</section>` : page === 'drops' ? drops() : page === 'firepower' ? firepower() : page === 'detail' ? detail() : settingsPage()}<footer>ぐぶんじ · 開いた画面の表示情報を記録 · 未取得と0を区別します</footer></main></div>`;
  if (page === 'settings')
    void store.meta<Adapter>('adapter').then((a) => {
      const el = document.querySelector<HTMLTextAreaElement>('#adapter-json');
      if (el) el.value = JSON.stringify(a ?? defaultAdapter, null, 2);
    });
}
function download(name: string, content: string, type: string) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
async function reloadTabs() {
  if (!isExtension) return;
  for (const tab of await chrome.tabs.query({
    url: ['https://game.granbluefantasy.jp/*', 'https://gbf.game.mbga.jp/*'],
  }))
    if (tab.id) void chrome.tabs.sendMessage(tab.id, { type: 'RELOAD' }).catch(() => {});
}
async function action(a: string) {
  if (a === 'demo') {
    for (const c of demoCaptures()) await store.saveCapture('demo', c, false);
    demo = true;
    page = 'overview';
  }
  if (a === 'actual') {
    demo = false;
  }
  if (a === 'records') page = 'records';
  if (a === 'open') await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  if (a === 'sync') {
    await send('SYNC');
    const next = await send('STATUS');
    notice = next.pending.length
      ? `同期を実行しました。${next.pending.length}件が未送信です`
      : '共通保存先との同期が完了しました';
  }
  if (a === 'logout') {
    await send('LOGOUT');
    notice = 'ログアウトしました。記録は保存先ごとに保持しています';
  }
  if (a === 'upload') {
    await send('UPLOAD_LOCAL');
    notice = '未ログイン中の記録を移行しました。同期状態を確認してください';
  }
  if (a === 'toggle') {
    await store.setMeta('settings', { ...status.settings, enabled: !status.settings.enabled });
    await reloadTabs();
  }
  if (a === 'csv') download('gubunji.csv', csv(filtered()), 'text/csv;charset=utf-8');
  if (a === 'backup')
    download(
      'gubunji-backup.json',
      JSON.stringify({ schemaVersion: 1, captures: obs.map((o) => o.payload) }, null, 2),
      'application/json',
    );
  if (a === 'diagnose') {
    if (!isExtension) throw new Error('Chrome拡張でゲームのリザルトを開いてから診断してください');
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs.find(
      (t) => t.url && /^https:\/\/(game\.granbluefantasy\.jp|gbf\.game\.mbga\.jp)\//.test(t.url),
    );
    if (!tab?.id) throw new Error('ゲームのタブを選択して拡張のメニューから診断してください');
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
    if (!r.ok) throw new Error(r.error);
    download('gubunji-diagnostics.json', JSON.stringify(r.data, null, 2), 'application/json');
    notice = '診断を出力しました';
  }
  await load();
}
root.addEventListener('click', (e) => {
  const target = (e.target as Element).closest<HTMLElement>(
    '[data-page],[data-action],[data-record]',
  );
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page;
    notice = '';
    render();
  } else if (target.dataset.record) {
    selected = target.dataset.record;
    page = 'detail';
    render();
  } else
    void action(target.dataset.action!).catch((e) => {
      notice = e.message;
      render();
    });
});
root.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter' && (e.target as HTMLElement).dataset.record)
    (e.target as HTMLElement).click();
});
root.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).id === 'search') {
    const input = e.target as HTMLInputElement,
      pos = input.selectionStart;
    query = input.value;
    render();
    const next = document.querySelector<HTMLInputElement>('#search');
    next?.focus();
    next?.setSelectionRange(pos, pos);
  }
});
root.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement,
    data = new FormData(form);
  void (async () => {
    if (form.id === 'connection') {
      if (!isExtension) throw new Error('Chrome拡張で接続先を保存してください');
      const url = new URL(String(data.get('url')));
      if (url.protocol !== 'https:' || !/^([a-z0-9-]+)\.supabase\.co$/.test(url.hostname))
        throw new Error('SupabaseのProject URLを入力してください');
      const allowed = await chrome.permissions.request({ origins: [url.origin + '/*'] });
      if (!allowed) throw new Error('保存先への接続権限が必要です');
      await send('CONNECTION', {
        url: url.origin,
        key: String(data.get('key')),
        profile: String(data.get('profile')),
      });
      notice = '接続先を保存しました';
    }
    if (form.id === 'login') {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      const r = await send(submitter?.value || 'LOGIN', {
        email: String(data.get('email')),
        password: String(data.get('password')),
      });
      notice = r.message;
    }
    if (form.id === 'adapter') {
      const parsed = JSON.parse(String(data.get('adapter')));
      const a = { ...defaultAdapter, ...parsed };
      if (
        Object.keys(parsed).some((k) => !(k in defaultAdapter)) ||
        Object.entries(a).some(([k, v]) => typeof v !== typeof defaultAdapter[k as keyof Adapter])
      )
        throw new Error('設定のキーまたは型が不正です');
      validateAdapter(a, document);
      await store.setMeta('adapter', a);
      await reloadTabs();
      notice = '読み取り設定を保存しました';
    }
    await load();
  })().catch((err) => {
    notice = err.message;
    render();
  });
});
root.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).id === 'quest-filter') {
    questFilter = (e.target as HTMLSelectElement).value;
    render();
    return;
  }
  if ((e.target as HTMLElement).id !== 'import') return;
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void (async () => {
    if (file.size > 20000000) throw new Error('JSONは20MB以内にしてください');
    const captures = parseBackup(JSON.parse(await file.text()));
    for (const c of captures) await store.saveCapture(c.demo ? 'demo' : 'local', c, !c.demo);
    notice = `${captures.length}件を端末に復元しました`;
    await load();
  })().catch((err) => {
    notice = err.message;
    render();
  });
});
void load().catch((e) => {
  root.textContent = '記録を開けませんでした: ' + e.message;
});
