import { type Capture } from './core';
export function demoCaptures(): Capture[] {
  return Array.from({ length: 8 }, (_, i) => ({
    schemaVersion: 1,
    captureKey: `demo-${i}`,
    battleKey: `demo:multi:${i}`,
    identity: 'verified',
    quest: 'つよばは（サンプル）',
    route: '#multi/demo',
    capturedAt: new Date(Date.UTC(2026, 9, 5, 10, 30 - i * 3)).toISOString(),
    adapter: 'demo-v1',
    drops: [
      { key: 'sample:1', name: '栄光の証（サンプル）', quantity: 3 + (i % 2), section: 'list:0' },
      { key: 'sample:2', name: 'バハムートの角（サンプル）', quantity: 1, section: 'list:0' },
      ...(i === 3
        ? [{ key: 'sample:3', name: 'ヒヒイロカネ（サンプル）', quantity: 1, section: 'list:1' }]
        : []),
    ],
    dropState: 'complete',
    damage: {
      total: 180000000 + i * 4000000,
      turns: 6,
      actors: [
        {
          key: 'sample:mc',
          name: '主人公（サンプル）',
          total: 48000000 + i * 1000000,
          normal: 20000000,
          ability: 18000000,
          ougi: 10000000,
          other: null,
        },
        {
          key: 'sample:1',
          name: 'キャラA（サンプル）',
          total: 65000000 + i * 1000000,
          normal: 30000000,
          ability: 25000000,
          ougi: 10000000,
          other: null,
        },
        {
          key: 'sample:2',
          name: 'キャラB（サンプル）',
          total: 39000000 + i * 1000000,
          normal: 15000000,
          ability: 10000000,
          ougi: 14000000,
          other: null,
        },
        {
          key: 'sample:3',
          name: 'キャラC（サンプル）',
          total: 21000000 + i * 1000000,
          normal: 10000000,
          ability: 11000000,
          ougi: 0,
          other: null,
        },
      ],
    },
    issues: [],
    demo: true,
  }));
}
