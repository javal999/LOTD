// LOTD admin Edge Function (v3) — the ONLY write path.
//
// Holds the two secrets the browser must never see: the admin passcode and the
// service_role key. The site calls this with { action, passcode, payload }; the function
// checks the passcode (constant-time, with a per-IP lockout), then writes with the
// service_role client (which bypasses RLS). Every write re-validates server-side — the
// DB CHECK constraints and FKs are the last line of defence behind it.
//
// Env: ADMIN_PASSCODE (secret), ALLOWED_ORIGIN (comma-separated site origins).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PASSCODE = Deno.env.get('ADMIN_PASSCODE') ?? '';
// Empty => allow any origin (local dev only). In prod this is set to the site origin(s).
const ALLOWED = (Deno.env.get('ALLOWED_ORIGIN') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Per-IP brute-force lockout: 5 wrong passcodes -> 60s cooldown. In-memory per instance,
// which is plenty for a friend-group app.
// ponytail: a table-backed limiter only if this ever proves insufficient.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const fails = new Map<string, { n: number; until: number }>();

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const h: Record<string, string> = {
    // The browser sends apikey + authorization (the deployed function sits behind Kong and
    // wants the anon JWT), which makes this a preflighted request. All three must be
    // allowed or the preflight fails and every write dies with "Failed to fetch".
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  // No ALLOWED_ORIGIN configured => permissive (local dev). Otherwise echo only a match,
  // so a browser on any other origin is blocked by CORS.
  if (ALLOWED.length === 0) h['Access-Control-Allow-Origin'] = '*';
  else if (ALLOWED.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

// Constant-time compare. Hashing first gives fixed-length inputs, so a length difference
// can't leak through an early return.
async function passcodeMatches(given: unknown): Promise<boolean> {
  if (!PASSCODE || typeof given !== 'string') return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(PASSCODE)),
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
const utcToday = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const ch = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...ch, 'content-type': 'application/json' } });
  const ok = (data: unknown = null) => json({ ok: true, data });
  const bad = (error: string, status = 400) => json({ ok: false, error }, status);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: ch });
  if (req.method !== 'POST') return bad('POST only', 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && rec.until > now) return bad('too many attempts, try again shortly', 429);

  let body: any;
  try { body = await req.json(); } catch { return bad('bad request'); }
  const { action, passcode, payload = {} } = body ?? {};

  if (!(await passcodeMatches(passcode))) {
    const n = (rec?.n ?? 0) + 1;
    fails.set(ip, { n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
    console.log(JSON.stringify({ at: 'admin', action, ip, ok: false, error: 'wrong passcode' }));
    return bad('wrong passcode', 401);
  }
  fails.delete(ip); // a correct passcode clears the counter

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const log = (okFlag: boolean, extra: unknown = {}) =>
    console.log(JSON.stringify({ at: 'admin', action, ip, ok: okFlag, ts: new Date().toISOString(), ...(extra as object) }));

  try {
    switch (action) {
      // ---- leaderboards ----
      case 'create_leaderboard': {
        const name = String(payload.name ?? '').trim();
        if (!name) return bad('a leaderboard name is required');
        const { data, error } = await db.from('leaderboards').insert({ name }).select().single();
        if (error) return bad(error.message);
        log(true, { leaderboard_id: data.id });
        return ok(data);
      }
      case 'rename_leaderboard': {
        const { leaderboard_id } = payload;
        const name = String(payload.name ?? '').trim();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!name) return bad('a leaderboard name is required');
        const { data, error } = await db.from('leaderboards').update({ name }).eq('id', leaderboard_id).select().single();
        if (error) return bad(error.message);
        if (!data) return bad('leaderboard not found', 404);
        log(true, { leaderboard_id });
        return ok(data);
      }
      case 'delete_leaderboard': {
        const { leaderboard_id } = payload;
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        const { error } = await db.from('leaderboards').delete().eq('id', leaderboard_id);
        if (error) return bad(error.message);
        log(true, { leaderboard_id });
        return ok({ leaderboard_id }); // DB cascades its players and games
      }

      // ---- players ----
      case 'add_player': {
        const { leaderboard_id } = payload;
        const name = String(payload.name ?? '').trim();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!name) return bad('a player name is required');
        const { data, error } = await db.from('players').insert({ leaderboard_id, name }).select().single();
        if (error) return bad(error.message); // unique(leaderboard_id,name) violation lands here
        log(true, { leaderboard_id });
        return ok(data);
      }
      case 'delete_player': {
        const { player_id } = payload;
        if (!isId(player_id)) return bad('player_id is required');
        // The server decides archive-vs-delete, not the client.
        const { count, error: e1 } = await db.from('games')
          .select('id', { count: 'exact', head: true })
          .or(`p1.eq.${player_id},p2.eq.${player_id},p3.eq.${player_id},p4.eq.${player_id}`);
        if (e1) return bad(e1.message);
        if ((count ?? 0) > 0) {
          const { error } = await db.from('players').update({ archived: true }).eq('id', player_id);
          if (error) return bad(error.message);
          log(true, { player_id, archived: true });
          return ok({ player_id, archived: true, deleted: false });
        }
        const { error } = await db.from('players').delete().eq('id', player_id);
        if (error) return bad(error.message);
        log(true, { player_id, deleted: true });
        return ok({ player_id, archived: false, deleted: true });
      }
      case 'restore_player': {
        const { player_id } = payload;
        if (!isId(player_id)) return bad('player_id is required');
        const { data, error } = await db.from('players').update({ archived: false }).eq('id', player_id).select().single();
        if (error) return bad(error.message);
        if (!data) return bad('player not found', 404);
        log(true, { player_id });
        return ok({ player_id, archived: data.archived });
      }

      // ---- games ----
      case 'log_game': {
        const { leaderboard_id, game_date, p1, p2, p3, p4, loser } = payload;
        // Only the client knows its local date, so it supplies "today"; we never accept a
        // game dated after it. The DB CHECK is a loose backstop for gross errors.
        const today = isIsoDate(payload.today) ? payload.today : utcToday();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!isIsoDate(game_date)) return bad('game_date must be YYYY-MM-DD');
        if (game_date > today) return bad("a game can't be dated in the future");
        const ps = [p1, p2, p3, p4];
        if (!ps.every(isId)) return bad('four players are required');
        if (new Set(ps).size !== 4) return bad('the 4 players must be distinct');
        if (!ps.includes(loser)) return bad('the loser must be one of the 4 players');

        const { data: rows, error: e1 } = await db.from('players')
          .select('id, leaderboard_id, archived').in('id', ps);
        if (e1) return bad(e1.message);
        if (!rows || rows.length !== 4) return bad('unknown player');
        if (rows.some((r) => r.leaderboard_id !== leaderboard_id)) return bad('all 4 players must belong to this leaderboard');
        if (rows.some((r) => r.archived)) return bad('an archived player cannot be added to a new game');

        const { data, error } = await db.from('games')
          .insert({ leaderboard_id, game_date, p1, p2, p3, p4, loser }).select().single();
        if (error) return bad(error.message);
        log(true, { leaderboard_id, game_id: data.id });
        return ok(data);
      }
      case 'undo_last': {
        const { leaderboard_id } = payload;
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        const { data: last, error: e1 } = await db.from('games').select('id')
          .eq('leaderboard_id', leaderboard_id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1).maybeSingle();
        if (e1) return bad(e1.message);
        if (!last) return ok(null);
        const { error } = await db.from('games').delete().eq('id', last.id);
        if (error) return bad(error.message);
        log(true, { leaderboard_id, game_id: last.id });
        return ok(last);
      }
      case 'edit_loser': {
        const { game_id, loser } = payload;
        if (!isId(game_id)) return bad('game_id is required');
        const { data: g, error: e1 } = await db.from('games').select('p1,p2,p3,p4').eq('id', game_id).maybeSingle();
        if (e1) return bad(e1.message);
        if (!g) return bad('game not found', 404);
        if (![g.p1, g.p2, g.p3, g.p4].includes(loser)) return bad('the loser must be one of the 4 players');
        const { error } = await db.from('games').update({ loser }).eq('id', game_id);
        if (error) return bad(error.message);
        log(true, { game_id });
        return ok({ game_id, loser });
      }
      case 'delete_game': {
        const { game_id } = payload;
        if (!isId(game_id)) return bad('game_id is required');
        const { error } = await db.from('games').delete().eq('id', game_id);
        if (error) return bad(error.message);
        log(true, { game_id });
        return ok({ game_id });
      }

      default:
        return bad('unknown action');
    }
  } catch (e) {
    log(false, { error: (e as Error).message });
    return bad((e as Error).message);
  }
});
