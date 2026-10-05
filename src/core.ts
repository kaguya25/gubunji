import { z } from 'zod';

const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(300);
const nullable = number.nullable();
export const DropSchema = z.object({ key: text, name: text, quantity: nullable, section: text });
export const ActorSchema = z.object({
  key: text,
  name: text,
  total: nullable,
  normal: nullable,
  ability: nullable,
  ougi: nullable,
  other: nullable,
});
export const CaptureSchema = z
  .object({
    schemaVersion: z.literal(1),
    captureKey: text,
    battleKey: text.nullable(),
    identity: z.enum(['candidate', 'weak', 'verified']),
    quest: text,
    route: text,
    capturedAt: z.string().datetime(),
    adapter: text,
    drops: z.array(DropSchema).max(500),
    dropState: z.enum(['partial', 'complete']),
    damage: z.object({ total: nullable, turns: nullable, actors: z.array(ActorSchema).max(20) }),
    issues: z.array(text).max(50),
    demo: z.boolean(),
  })
  .strict();
export type Capture = z.infer<typeof CaptureSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type Observation = {
  id: string;
  scope: string;
  fingerprint: string;
  payload: Capture;
  seq?: number;
};
export type Battle = {
  key: string;
  quest: string;
  capturedAt: string;
  drops: Capture['drops'];
  dropState: Capture['dropState'];
  identity: Capture['identity'];
  damage: Capture['damage'];
  issues: string[];
  observationIds: string[];
  demo: boolean;
};

export function parseCount(value: string | null | undefined): number | null {
  if (!value) return null;
  const s = value
    .normalize('NFKC')
    .trim()
    .replace(/^[x×]\s*/i, '')
    .replaceAll(',', '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function fingerprint(capture: Capture) {
  const { capturedAt: _, ...body } = capture;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(body)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}

function mergeNumber(old: number | null, next: number | null, issues: Set<string>, label: string) {
  if (old != null && next != null && old !== next) issues.add(`${label}が一致しません`);
  return old ?? next;
}
export function project(observations: Observation[]): Battle[] {
  const records = new Map<string, Battle>();
  for (const o of [...observations].sort(
    (a, b) => a.payload.capturedAt.localeCompare(b.payload.capturedAt) || a.id.localeCompare(b.id),
  )) {
    const c = o.payload;
    const key = c.battleKey ?? c.captureKey;
    const b = records.get(key);
    if (!b) {
      records.set(key, {
        key,
        quest: c.quest,
        capturedAt: c.capturedAt,
        drops: c.drops,
        dropState: c.dropState,
        identity: c.identity,
        damage: structuredClone(c.damage),
        issues: [...c.issues],
        observationIds: [o.id],
        demo: c.demo,
      });
      continue;
    }
    const issues = new Set([...b.issues, ...c.issues]);
    if (b.quest === 'クエスト名未取得' && c.quest !== 'クエスト名未取得') b.quest = c.quest;
    // A result and its detail are snapshots, never additive reward events.
    if (b.drops.length && c.drops.length && stable(b.drops) !== stable(c.drops)) {
      if (b.dropState === 'complete' && c.dropState === 'complete')
        issues.add('ドロップの表示が一致しません');
      else if (c.dropState === 'complete' || c.drops.length > b.drops.length) b.drops = c.drops;
    } else if (!b.drops.length) b.drops = c.drops;
    if (c.dropState === 'complete') b.dropState = 'complete';
    if (c.identity === 'verified') b.identity = 'verified';
    b.damage.total = mergeNumber(b.damage.total, c.damage.total, issues, '総ダメージ');
    b.damage.turns = mergeNumber(b.damage.turns, c.damage.turns, issues, 'ターン数');
    for (const actor of c.damage.actors) {
      const a = b.damage.actors.find((a) => a.key === actor.key);
      if (!a) {
        b.damage.actors.push({ ...actor });
        continue;
      }
      for (const field of ['total', 'normal', 'ability', 'ougi', 'other'] as const)
        a[field] = mergeNumber(a[field], actor[field], issues, `${a.name}の${field}`);
    }
    b.issues = [...issues];
    b.observationIds.push(o.id);
  }
  return [...records.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}
export function damageAnalysis(b: Battle) {
  const known = b.damage.actors.filter((a) => a.total != null);
  const sum = known.reduce((n, a) => n + a.total!, 0);
  const total = b.damage.total;
  const invalid = total != null && sum > total;
  return {
    invalid,
    residual: total == null || invalid ? null : total - sum,
    actors: b.damage.actors.map((a) => ({
      ...a,
      share: !invalid && total != null && total > 0 && a.total != null ? a.total / total : null,
      perTurn:
        b.damage.turns != null && b.damage.turns > 0 && a.total != null
          ? a.total / b.damage.turns
          : null,
    })),
  };
}
export function dropSummary(battles: Battle[]) {
  const eligible = battles.filter(
    (b) =>
      b.dropState === 'complete' &&
      b.identity === 'verified' &&
      !b.issues.length &&
      b.drops.every((d) => d.quantity != null && !!d.key),
  );
  const rows = new Map<string, { name: string; quantity: number; hits: number }>();
  for (const b of eligible) {
    const seen = new Set<string>();
    for (const d of b.drops) {
      const row = rows.get(d.key) ?? { name: d.name, quantity: 0, hits: 0 };
      row.quantity += d.quantity!;
      if (!seen.has(d.key) && d.quantity! > 0) {
        row.hits++;
        seen.add(d.key);
      }
      rows.set(d.key, row);
    }
  }
  return {
    runs: eligible.length,
    excluded: battles.length - eligible.length,
    items: [...rows]
      .map(([key, r]) => ({ key, ...r, rate: eligible.length ? r.hits / eligible.length : null }))
      .sort((a, b) => b.quantity - a.quantity),
  };
}
const cell = (s: unknown) =>
  '"' +
  String(s ?? '')
    .replace(/^[=+\-@\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
export function csv(battles: Battle[]) {
  const rows: unknown[][] = [
    [
      '日時',
      'クエスト',
      '戦闘キー',
      'アイテム',
      '数量',
      '取得状態',
      '総ダメージ',
      'ターン数',
      '確認事項',
    ],
  ];
  for (const b of battles)
    for (const d of b.drops.length ? b.drops : [{ name: '', quantity: null }])
      rows.push([
        b.capturedAt,
        b.quest,
        b.key,
        d.name,
        d.quantity,
        b.dropState,
        b.damage.total,
        b.damage.turns,
        b.issues.join(' / '),
      ]);
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function parseBackup(input: unknown): Capture[] {
  return z
    .object({ schemaVersion: z.literal(1), captures: z.array(CaptureSchema).max(100000) })
    .strict()
    .parse(input).captures;
}
