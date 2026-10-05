import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { capture, defaultAdapter, diagnostics, routeInfo } from '../src/capture';
import { demoCaptures } from '../src/demo';
import {
  parseCount,
  project,
  damageAnalysis,
  dropSummary,
  csv,
  parseBackup,
  fingerprint,
} from '../src/core';
const observe = (c = demoCaptures()[0], id = 'one') => ({
  id,
  scope: 'test',
  payload: c,
  fingerprint: id,
});
describe('display parser', () => {
  it('handles counts without inventing missing values', () => {
    expect(parseCount('×１,２３４')).toBe(1234);
    for (const s of ['', '1.5', '12万', 'x?', '-1', '9007199254740992'])
      expect(parseCount(s)).toBeNull();
    expect(parseCount('0')).toBe(0);
  });
  it('maps initial/detail to the same raid and keeps solo identity weak', () => {
    expect(routeInfo('#result_multi/123')).toEqual(routeInfo('#result_multi/detail/123/1'));
    expect(routeInfo('#result')).toEqual({ kind: 'solo', id: null });
    expect(routeInfo('#quest')).toBeNull();
  });
  it('reads only result items, with explicit counts', () => {
    const w = new Window();
    w.document.body.innerHTML =
      '<div class="prt-result"><h2 class="txt-quest-name">テスト</h2><div class="prt-item-list"><div data-key="10_20"><img alt="素材"><span class="prt-article-count">×2</span></div><div data-key="10_21"><img alt="証"></div></div></div><p>秘密のチャット</p>';
    const c = capture(
      w.document as unknown as Document,
      '#result_multi/123',
      'game.granbluefantasy.jp',
      'view',
    )!;
    expect(c.drops.map((d) => d.quantity)).toEqual([2, null]);
    expect(c.dropState).toBe('partial');
    expect(c.identity).toBe('candidate');
    expect(
      JSON.stringify(
        diagnostics(w.document as unknown as Document, '#result_multi/123', defaultAdapter),
      ),
    ).not.toContain('秘密');
    const v = capture(
      w.document as unknown as Document,
      '#result_multi/123',
      'game.granbluefantasy.jp',
      'view',
      { ...defaultAdapter, verified: true, implicitOne: true },
    )!;
    expect(v.drops[1].quantity).toBe(1);
    expect(v.dropState).toBe('complete');
  });
  it('ignores unsupported/blank screens and rejects invalid selector', () => {
    const w = new Window();
    expect(capture(w.document as unknown as Document, '#result', 'host', 'id')).toBeNull();
    expect(() =>
      capture(w.document as unknown as Document, '#result', 'host', 'id', {
        ...defaultAdapter,
        item: '[',
      }),
    ).toThrow();
  });
  it('does not claim an empty list proves zero drops', () => {
    const w = new Window();
    w.document.body.innerHTML = '<div class="prt-result"><div class="prt-item-list"></div></div>';
    expect(
      capture(w.document as unknown as Document, '#result_multi/123', 'host', 'id', {
        ...defaultAdapter,
        verified: true,
      })!.dropState,
    ).toBe('partial');
  });
});
describe('projections and exports', () => {
  it('does not add two snapshots of the same rewards', () => {
    const c = demoCaptures()[0];
    const b = project([
      observe(c),
      observe({ ...c, captureKey: 'other', route: '#detail' }, 'two'),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].drops[0].quantity).toBe(3);
    expect(b[0].observationIds).toHaveLength(2);
  });
  it('keeps identical drops from different weak battles separate', () => {
    const c = demoCaptures()[0];
    expect(
      project([
        observe({ ...c, battleKey: null, captureKey: 'a' }),
        observe({ ...c, battleKey: null, captureKey: 'b' }, 'two'),
      ]),
    ).toHaveLength(2);
  });
  it('preserves known values and flags conflicts', () => {
    const c = demoCaptures()[0],
      newer = {
        ...c,
        capturedAt: '2026-10-05T11:00:00.000Z',
        damage: { total: null, turns: null, actors: [] },
      };
    const b = project([observe(c), observe(newer, 'two')])[0];
    expect(b.damage.total).toBe(c.damage.total);
    const conflicting = { ...newer, damage: { ...newer.damage, total: 1 } };
    expect(project([observe(c), observe(conflicting, 'two')])[0].issues).toContain(
      '総ダメージが一致しません',
    );
  });
  it('uses own total for shares and leaves residual unassigned', () => {
    const b = project([observe()])[0],
      d = damageAnalysis(b);
    expect(d.residual).toBe(7000000);
    expect(d.actors[0].share).toBeCloseTo(48000000 / 180000000);
    b.damage.total = 1;
    expect(damageAnalysis(b).invalid).toBe(true);
    expect(damageAnalysis(b).actors[0].share).toBeNull();
    b.damage.turns = 0;
    expect(damageAnalysis(b).actors[0].perTurn).toBeNull();
  });
  it('excludes partial records and unknown quantities from drop rates', () => {
    const c = demoCaptures()[0],
      b = project([
        observe(),
        observe({ ...c, battleKey: 'partial', dropState: 'partial' }, 'two'),
        observe(
          { ...c, battleKey: 'unknown', drops: [{ ...c.drops[0], quantity: null }] },
          'three',
        ),
      ]);
    expect(dropSummary(b).runs).toBe(1);
    expect(dropSummary(b).excluded).toBe(2);
  });
  it('protects spreadsheet formulas and quotes embedded cells', () => {
    const c = demoCaptures()[0],
      b = project([observe({ ...c, quest: '=CMD()', drops: [{ ...c.drops[0], name: 'a,"b' }] })]);
    expect(csv(b)).toContain('"\'=CMD()"');
    expect(csv(b)).toContain('"a,""b"');
  });
  it('validates backups before restoring', () => {
    expect(parseBackup({ schemaVersion: 1, captures: demoCaptures() })).toHaveLength(8);
    expect(() => parseBackup({ schemaVersion: 99, captures: [] })).toThrow();
    expect(() =>
      parseBackup({
        schemaVersion: 1,
        captures: [{ ...demoCaptures()[0], damage: { total: -1 } }],
      }),
    ).toThrow();
  });
  it('fingerprint ignores observation time but retains battle identity', async () => {
    const c = demoCaptures()[0];
    expect(await fingerprint(c)).toBe(
      await fingerprint({ ...c, capturedAt: '2026-10-05T12:00:00.000Z' }),
    );
    expect(await fingerprint(c)).not.toBe(await fingerprint({ ...c, battleKey: 'different' }));
  });
});
