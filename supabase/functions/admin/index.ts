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
const isScore = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const utcToday = () => new Date().toISOString().slice(0, 10);

const SPORTS = ['tt_singles', 'tt_doubles', 'padel', 'bd_singles', 'bd_doubles'] as const;
const GAME_TYPES = ['cards', 'tt_singles', 'tt_doubles', 'padel', 'bd_singles', 'bd_doubles'];

// Keep only known game types (deduped). null => let the DB default (all) stand.
function cleanGameTypes(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const gt = [...new Set(v.filter((t) => GAME_TYPES.includes(t)))];
  return gt.length ? gt : null;
}
// A padel round length (6–99) or null to leave the column unset.
function cleanPoints(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 6 && (v as number) <= 99 ? (v as number) : null;
}

// Friendly score check mirroring the DB CHECK, so the user sees a sentence, not a constraint
// name. The `valid_score` / `decisive` constraints are still the last line of defence.
// `padelTarget` is the board's round length (defaults to 21).
function scoreError(sport: string, a: number, b: number, padelTarget = 21): string | null {
  if (a === b) return 'a game must have a winner — no draws';
  if (sport === 'padel') {
    return a + b === padelTarget ? null : `a padel round must total ${padelTarget} points — ${a}–${b} adds to ${a + b}`;
  }
  if (sport === 'bd_singles' || sport === 'bd_doubles') {   // badminton: first to 21, win by 2, cap 30
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi === 21 && lo <= 19) return null;
    if (hi > 21 && hi <= 30 && hi - lo === 2) return null;
    if (hi === 30 && lo === 29) return null;
    if (hi < 21) return 'someone has to reach 21';
    if (hi > 30) return 'badminton caps at 30';
    return `${a}–${b} isn't a valid badminton score — win by 2 (or 30–29 at the cap)`;
  }
  const hi = Math.max(a, b), lo = Math.min(a, b);      // table tennis: first to 11, win by 2
  if (hi === 11 && lo <= 9) return null;
  if (hi > 11 && hi - lo === 2) return null;
  if (hi < 11) return 'someone has to reach 11';
  if (hi === 11 && lo === 10) return "11–10 isn't possible — from 10–10 you play on until someone leads by 2";
  return `${a}–${b} isn't a valid table tennis score`;
}

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
    console.log(JSON.stringify({ at: 'admin', action, ip, ok: false, ts: new Date().toISOString(), error: 'wrong passcode' }));
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
        const gt = cleanGameTypes(payload.game_types);
        const pt = cleanPoints(payload.points_target);
        const row: Record<string, unknown> = { name };
        if (gt) row.game_types = gt;
        if (pt) row.points_target = pt;
        const { data, error } = await db.from('leaderboards').insert(row).select().single();
        if (error) return bad(error.message);
        log(true, { leaderboard_id: data.id });
        return ok(data);
      }
      case 'rename_leaderboard': {
        const { leaderboard_id } = payload;
        const name = String(payload.name ?? '').trim();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!name) return bad('a leaderboard name is required');
        const patch: Record<string, unknown> = { name };
        const gt = cleanGameTypes(payload.game_types);
        if (gt) patch.game_types = gt;
        const pt = cleanPoints(payload.points_target);
        if (pt) patch.points_target = pt;
        const { data, error } = await db.from('leaderboards').update(patch).eq('id', leaderboard_id).select().single();
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
        // The server decides archive-vs-delete, not the client. Archive if the player appears in
        // ANY game — cards or racquet — so results stay in the standings and the ON DELETE RESTRICT
        // FKs never fire with an ugly error.
        const [cards, sports] = await Promise.all([
          db.from('games').select('id', { count: 'exact', head: true })
            .or(`p1.eq.${player_id},p2.eq.${player_id},p3.eq.${player_id},p4.eq.${player_id}`),
          db.from('sports_games').select('id', { count: 'exact', head: true })
            .or(`a1.eq.${player_id},a2.eq.${player_id},b1.eq.${player_id},b2.eq.${player_id}`),
        ]);
        if (cards.error) return bad(cards.error.message);
        if (sports.error) return bad(sports.error.message);
        if ((cards.count ?? 0) + (sports.count ?? 0) > 0) {
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

      // ---- racquet games (table tennis + padel) ----
      case 'log_sports_game': {
        const { leaderboard_id, sport, game_date, score_a, score_b } = payload;
        const today = isIsoDate(payload.today) ? payload.today : utcToday();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!SPORTS.includes(sport)) return bad('unknown sport');
        if (!isIsoDate(game_date)) return bad('game_date must be YYYY-MM-DD');
        if (game_date > today) return bad("a game can't be dated in the future");
        if (!isScore(score_a) || !isScore(score_b)) return bad('scores must be whole numbers');

        // Side shape: singles = one per side (a2/b2 absent); doubles/padel = two per side.
        const singles = sport === 'tt_singles' || sport === 'bd_singles';
        const a2 = singles ? null : payload.a2;
        const b2 = singles ? null : payload.b2;
        if (singles && (payload.a2 != null || payload.b2 != null)) return bad('singles has one player per side');
        if (!singles && !(isId(a2) && isId(b2))) return bad('doubles needs two players per side');

        const named = [payload.a1, payload.b1, ...(singles ? [] : [a2, b2])];
        if (!named.every(isId)) return bad(singles ? 'two players are required' : 'four players are required');
        if (new Set(named).size !== named.length) return bad('a player can only be in a game once');

        // Padel rounds must total the board's configured target (default 21); it's snapshotted on
        // the game so a later board change never invalidates old rounds.
        let padelTarget: number | null = null;
        if (sport === 'padel') {
          const { data: board } = await db.from('leaderboards').select('points_target').eq('id', leaderboard_id).maybeSingle();
          padelTarget = board?.points_target ?? 21;
        }
        const serr = scoreError(sport, score_a, score_b, padelTarget ?? 21);
        if (serr) return bad(serr);

        const { data: rows, error: e1 } = await db.from('players')
          .select('id, leaderboard_id, archived').in('id', named);
        if (e1) return bad(e1.message);
        if (!rows || rows.length !== named.length) return bad('unknown player');
        if (rows.some((r) => r.leaderboard_id !== leaderboard_id)) return bad('all players must belong to this leaderboard');
        if (rows.some((r) => r.archived)) return bad('an archived player cannot be added to a new game');

        // Optional Americano session link. A round may only join a padel session on its own board,
        // and every player must be in that session's roster. The composite FK is the final backstop.
        const session_id = payload.session_id ?? null;
        if (session_id !== null) {
          if (!isId(session_id)) return bad('session_id must be a valid id');
          if (sport !== 'padel') return bad('only a padel round can belong to a session');
          const { data: sess, error: es } = await db.from('padel_sessions')
            .select('leaderboard_id, roster').eq('id', session_id).maybeSingle();
          if (es) return bad(es.message);
          if (!sess) return bad('session not found', 404);
          if (sess.leaderboard_id !== leaderboard_id) return bad('that session belongs to another board');
          const inRoster = new Set(sess.roster as number[]);
          if (!named.every((id) => inRoster.has(id as number))) return bad('all players must be in the session roster');
        }

        const { data, error } = await db.from('sports_games')
          .insert({ leaderboard_id, sport, game_date, a1: payload.a1, a2, b1: payload.b1, b2, score_a, score_b, points_target: padelTarget, session_id })
          .select().single();
        if (error) return bad(error.message); // DB CHECKs / composite FK are the final backstop
        log(true, { leaderboard_id, sports_game_id: data.id, session_id });
        return ok(data);
      }
      case 'undo_last_sports': {
        const { leaderboard_id } = payload;
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        const { data: last, error: e1 } = await db.from('sports_games').select('id')
          .eq('leaderboard_id', leaderboard_id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1).maybeSingle();
        if (e1) return bad(e1.message);
        if (!last) return ok(null);
        const { error } = await db.from('sports_games').delete().eq('id', last.id);
        if (error) return bad(error.message);
        log(true, { leaderboard_id, sports_game_id: last.id });
        return ok(last);
      }
      case 'edit_sports_score': {
        const { sports_game_id, score_a, score_b } = payload;
        if (!isId(sports_game_id)) return bad('sports_game_id is required');
        if (!isScore(score_a) || !isScore(score_b)) return bad('scores must be whole numbers');
        const { data: g, error: e1 } = await db.from('sports_games').select('sport, points_target').eq('id', sports_game_id).maybeSingle();
        if (e1) return bad(e1.message);
        if (!g) return bad('game not found', 404);
        const serr = scoreError(g.sport, score_a, score_b, g.points_target ?? 21);  // padel: the game's own target
        if (serr) return bad(serr);
        const { error } = await db.from('sports_games').update({ score_a, score_b }).eq('id', sports_game_id);
        if (error) return bad(error.message);
        log(true, { sports_game_id });
        return ok({ sports_game_id, score_a, score_b });
      }
      case 'delete_sports_game': {
        const { sports_game_id } = payload;
        if (!isId(sports_game_id)) return bad('sports_game_id is required');
        const { error } = await db.from('sports_games').delete().eq('id', sports_game_id);
        if (error) return bad(error.message);
        log(true, { sports_game_id });
        return ok({ sports_game_id });
      }

      // ---- Americano sessions ----
      case 'create_padel_session': {
        const { leaderboard_id, game_date, roster, courts, rounds } = payload;
        const today = isIsoDate(payload.today) ? payload.today : utcToday();
        if (!isId(leaderboard_id)) return bad('leaderboard_id is required');
        if (!isIsoDate(game_date)) return bad('game_date must be YYYY-MM-DD');
        if (game_date > today) return bad("a session can't be dated in the future");
        if (!Array.isArray(roster) || !roster.every(isId)) return bad('roster must be player ids');
        if (new Set(roster).size !== roster.length) return bad('a player can only be in the roster once');
        if (roster.length < 4) return bad('an Americano needs at least 4 players');
        if (!Number.isInteger(courts) || courts < 1 || courts > 6) return bad('courts must be 1–6');
        if (!Number.isInteger(rounds) || rounds < 1 || rounds > 60) return bad('rounds must be 1–60');

        // The board must actually play padel.
        const { data: board, error: eb } = await db.from('leaderboards')
          .select('game_types').eq('id', leaderboard_id).maybeSingle();
        if (eb) return bad(eb.message);
        if (!board) return bad('leaderboard not found', 404);
        if (!(board.game_types ?? []).includes('padel')) return bad('this board does not play padel');

        // Every roster player must belong to this board and be active.
        const { data: rows, error: e1 } = await db.from('players')
          .select('id, leaderboard_id, archived').in('id', roster);
        if (e1) return bad(e1.message);
        if (!rows || rows.length !== roster.length) return bad('unknown player in roster');
        if (rows.some((r) => r.leaderboard_id !== leaderboard_id)) return bad('all players must belong to this board');
        if (rows.some((r) => r.archived)) return bad('an archived player cannot be in a session');

        const { data, error } = await db.from('padel_sessions')
          .insert({ leaderboard_id, game_date, roster, courts, rounds }).select().single();
        if (error) return bad(error.message);
        log(true, { leaderboard_id, session_id: data.id });
        return ok(data);
      }

      default:
        return bad('unknown action');
    }
  } catch (e) {
    log(false, { error: (e as Error).message });
    return bad((e as Error).message);
  }
});
