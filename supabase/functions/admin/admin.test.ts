// Integration tests for the admin Edge Function (BUILD-PLAN E3).
// Run the function locally against the local Supabase stack, then:
//   deno test -A supabase/functions/admin/admin.test.ts
// Self-contained: creates its own leaderboard and cleans up, so it needs no DB reset.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const FN = Deno.env.get('FN_URL') ?? 'http://localhost:8000';
const PASS = Deno.env.get('ADMIN_PASSCODE') ?? 'lotd-local-pass';
const REST = Deno.env.get('REST_URL') ?? 'http://127.0.0.1:54321/rest/v1';
// Local stack's demo anon key (public, identical on every machine).
const ANON = Deno.env.get('ANON_KEY') ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

type Res = { status: number; body: any };
async function call(action: string, payload: unknown = {}, passcode = PASS): Promise<Res> {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, passcode, payload }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const TOMORROW = iso(new Date(Date.now() + 86400000));

// Regression: the browser sends apikey + authorization, which makes every write a
// preflighted request. If the preflight doesn't allow those headers, the browser kills the
// request ("Failed to fetch") long before any of the tests below would notice — they're
// server-to-server and never trigger a preflight.
Deno.test('CORS preflight allows the headers a browser actually sends', async () => {
  const res = await fetch(FN, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:8138',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, apikey, content-type',
    },
  });
  await res.body?.cancel();
  const allow = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  for (const h of ['authorization', 'apikey', 'content-type']) {
    assert(allow.includes(h), `preflight must allow "${h}" — got "${allow}"`);
  }
  assert(res.headers.get('access-control-allow-origin'), 'preflight must allow the site origin');
});

// The whole security model in one test: the key we ship to every browser can read
// everything and write nothing. If this ever goes green->red, the app is wide open.
Deno.test('security: the public anon key is read-only', async (t) => {
  const h = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };
  const denied = (s: number) => s === 401 || s === 403;

  await t.step('anon can READ v_standings', async () => {
    const res = await fetch(`${REST}/v_standings?select=name`, { headers: h });
    await res.body?.cancel();
    assertEquals(res.status, 200);
  });
  await t.step('anon INSERT into games is rejected', async () => {
    const res = await fetch(`${REST}/games`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ leaderboard_id: 1, p1: 1, p2: 2, p3: 3, p4: 4, loser: 2 }),
    });
    await res.body?.cancel();
    assert(denied(res.status), `anon INSERT must be denied, got ${res.status}`);
  });
  await t.step('anon INSERT into leaderboards is rejected', async () => {
    const res = await fetch(`${REST}/leaderboards`, {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'pwned' }),
    });
    await res.body?.cancel();
    assert(denied(res.status), `anon INSERT must be denied, got ${res.status}`);
  });
  await t.step('anon DELETE of players is rejected', async () => {
    const res = await fetch(`${REST}/players?id=eq.1`, { method: 'DELETE', headers: h });
    await res.body?.cancel();
    assert(denied(res.status), `anon DELETE must be denied, got ${res.status}`);
  });
});

// Requires ALLOWED_ORIGIN to be set (as it is in prod). An unknown origin must not get an
// Access-Control-Allow-Origin header back, so a browser elsewhere can't call the function.
Deno.test('security: CORS is locked to the configured origin', async () => {
  const res = await fetch(FN, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  });
  await res.body?.cancel();
  assertEquals(res.headers.get('access-control-allow-origin'), null,
    'an unknown origin must not be echoed back');
});

Deno.test('admin function v3', async (t) => {
  let lb = 0, other = 0;
  const p: number[] = [];        // 5 players in `lb`
  let outsider = 0;              // a player in `other`
  let gameId = 0;

  await t.step('wrong passcode -> 401, no write', async () => {
    const r = await call('create_leaderboard', { name: 'nope' }, 'WRONG');
    assertEquals(r.status, 401);
    assertEquals(r.body.ok, false);
  });

  await t.step('create_leaderboard -> ok', async () => {
    const r = await call('create_leaderboard', { name: `Test ${Date.now()}` });
    assertEquals(r.status, 200);
    assertEquals(r.body.ok, true);
    lb = r.body.data.id;
  });

  await t.step('create_leaderboard duplicate name -> 400', async () => {
    const name = `Dup ${Date.now()}`;
    assertEquals((await call('create_leaderboard', { name })).status, 200);
    assertEquals((await call('create_leaderboard', { name })).status, 400);
  });

  await t.step('add_player x5 -> ok', async () => {
    for (const name of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      const r = await call('add_player', { leaderboard_id: lb, name });
      assertEquals(r.status, 200);
      p.push(r.body.data.id);
    }
    assertEquals(p.length, 5);
  });

  await t.step('add_player duplicate name in same leaderboard -> 400', async () => {
    assertEquals((await call('add_player', { leaderboard_id: lb, name: 'P1' })).status, 400);
  });

  await t.step('log_game happy path -> ok', async () => {
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser: p[1],
    });
    assertEquals(r.status, 200);
    assertEquals(r.body.ok, true);
    assertEquals(r.body.data.loser, p[1]);
    gameId = r.body.data.id;
  });

  await t.step('log_game future date -> 400', async () => {
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TOMORROW, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser: p[0],
    });
    assertEquals(r.status, 400);
    assertEquals(r.body.ok, false);
  });

  await t.step('log_game duplicate player -> 400', async () => {
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[0], p3: p[2], p4: p[3], loser: p[0],
    });
    assertEquals(r.status, 400);
  });

  await t.step('log_game loser not at the table -> 400', async () => {
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser: p[4],
    });
    assertEquals(r.status, 400);
  });

  await t.step('log_game with a player from another leaderboard -> 400', async () => {
    const r1 = await call('create_leaderboard', { name: `Other ${Date.now()}` });
    other = r1.body.data.id;
    const r2 = await call('add_player', { leaderboard_id: other, name: 'Outsider' });
    outsider = r2.body.data.id;
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: outsider, loser: p[0],
    });
    assertEquals(r.status, 400);
  });

  await t.step('edit_loser to a non-participant -> 400', async () => {
    assertEquals((await call('edit_loser', { game_id: gameId, loser: p[4] })).status, 400);
  });

  await t.step('edit_loser to a participant -> ok', async () => {
    const r = await call('edit_loser', { game_id: gameId, loser: p[2] });
    assertEquals(r.status, 200);
    assertEquals(r.body.ok, true);
  });

  await t.step('delete_player WITH games -> archived, not deleted', async () => {
    const r = await call('delete_player', { player_id: p[0] });
    assertEquals(r.status, 200);
    assertEquals(r.body.data.archived, true);
    assertEquals(r.body.data.deleted, false);
  });

  await t.step('log_game with an archived player -> 400', async () => {
    const r = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser: p[1],
    });
    assertEquals(r.status, 400);
  });

  await t.step('restore_player -> ok', async () => {
    const r = await call('restore_player', { player_id: p[0] });
    assertEquals(r.status, 200);
    assertEquals(r.body.data.archived, false);
  });

  await t.step('delete_player with NO games -> hard-deleted', async () => {
    const r = await call('delete_player', { player_id: p[4] });
    assertEquals(r.status, 200);
    assertEquals(r.body.data.deleted, true);
    assertEquals(r.body.data.archived, false);
  });

  await t.step('rename_leaderboard -> ok', async () => {
    const r = await call('rename_leaderboard', { leaderboard_id: lb, name: `Renamed ${Date.now()}` });
    assertEquals(r.status, 200);
  });

  await t.step('undo_last removes the most recent game in that leaderboard', async () => {
    const a = await call('log_game', {
      leaderboard_id: lb, game_date: TODAY, today: TODAY,
      p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser: p[3],
    });
    assertEquals(a.status, 200);
    const u = await call('undo_last', { leaderboard_id: lb });
    assertEquals(u.status, 200);
    assertEquals(u.body.data.id, a.body.data.id);
  });

  await t.step('delete_game -> ok', async () => {
    assertEquals((await call('delete_game', { game_id: gameId })).status, 200);
  });

  await t.step('unknown action -> 400', async () => {
    assertEquals((await call('nope')).status, 400);
  });

  await t.step('cleanup: delete_leaderboard cascades', async () => {
    assertEquals((await call('delete_leaderboard', { leaderboard_id: lb })).status, 200);
    assertEquals((await call('delete_leaderboard', { leaderboard_id: other })).status, 200);
  });
});
