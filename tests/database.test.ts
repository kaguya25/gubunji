import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { demoCaptures } from '../src/demo';
it('Postgres migration enforces owner isolation, immutable history and idempotent ingestion', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      `create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; grant usage on schema public,auth to authenticated; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid'; grant execute on function auth.uid() to authenticated; insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`,
    );
    await pg.exec(await readFile('supabase/migrations/20261005110611_initial_gbf_log.sql', 'utf8'));
    const payload = JSON.stringify({ ...demoCaptures()[0], demo: false }),
      op = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await pg.exec(
      `set role authenticated; set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';`,
    );
    const first = await pg.query<{ seq: number }>(
      'select public.gbf_append_observation($1,$2,$3::jsonb) as seq',
      ['main', op, payload],
    );
    expect(Number(first.rows[0].seq)).toBe(1);
    const retry = await pg.query<{ seq: number }>(
      'select public.gbf_append_observation($1,$2,$3::jsonb) as seq',
      ['main', op, payload],
    );
    expect(Number(retry.rows[0].seq)).toBe(1);
    await expect(
      pg.query('select public.gbf_append_observation($1,$2,$3::jsonb)', [
        'main',
        op,
        JSON.stringify({ ...JSON.parse(payload), quest: 'changed' }),
      ]),
    ).rejects.toThrow('different content');
    await expect(pg.exec(`update public.gbf_observations set sequence=99`)).rejects.toThrow(
      'permission denied',
    );
    await pg.exec(`set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';`);
    expect((await pg.query('select * from public.gbf_observations')).rows).toHaveLength(0);
    await expect(
      pg.query(
        'insert into public.gbf_observations(owner_id,profile_id,operation_id,payload) values($1,$2,$3,$4::jsonb)',
        [
          '11111111-1111-4111-8111-111111111111',
          'main',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          payload,
        ],
      ),
    ).rejects.toThrow();
    await pg.query('select public.gbf_append_observation($1,$2,$3::jsonb)', ['main', op, payload]);
    expect((await pg.query('select * from public.gbf_observations')).rows).toHaveLength(1);
    await pg.exec('reset role;set role anon;');
    await expect(pg.exec('select * from public.gbf_observations')).rejects.toThrow(
      'permission denied',
    );
  } finally {
    await pg.close();
  }
}, 30000);
