// LOTD admin Edge Function (Epic 3) — the ONLY write path.
//
// It holds the two secrets the browser must never see: the admin passcode and the
// service_role key. The public site calls this with { action, passcode, payload };
// the function checks the passcode (with a per-IP brute-force lockout), then writes
// with the service_role client (which bypasses RLS). Every write re-validates the
// 4-players/1-loser invariant server-side — the DB CHECK constraints are the last
// line of defence behind it.
//
// Secrets (set with `supabase secrets set`): ADMIN_PASSCODE. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*", // TODO: tighten to the deployed site origin in prod
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-IP brute-force lockout: 5 wrong passcodes -> 60s cooldown. In-memory per
// instance, which is plenty for a friend-group app.
// ponytail: a table-backed limiter only if this ever proves insufficient.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const fails = new Map<string, { n: number; until: number }>();

// Same invariant as the client's validateGame — the write layer must not trust input.
function validateGame(players: unknown, loser: unknown): string | null {
  if (!Array.isArray(players) || players.length !== 4) return "a game needs exactly 4 players";
  if (new Set(players).size !== 4) return "the 4 players must be distinct";
  if (!players.includes(loser)) return "the loser must be one of the 4 players";
  return null;
}

async function activeSeasonId(db: ReturnType<typeof createClient>): Promise<number> {
  const { data, error } = await db.from("seasons").select("id").eq("is_active", true).single();
  if (error || !data) throw new Error("no active season");
  return data.id as number;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && rec.until > now) return json({ ok: false, error: "too many attempts, try again shortly" }, 429);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const { action, passcode, payload = {} } = body ?? {};

  // Passcode gate (constant work regardless of correctness is not critical here).
  if (!PASSCODE || passcode !== PASSCODE) {
    const n = (rec?.n ?? 0) + 1;
    fails.set(ip, { n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
    return json({ ok: false, error: "wrong passcode" }, 401);
  }
  fails.delete(ip); // a correct passcode clears the counter
  console.log(JSON.stringify({ at: "admin", action, ip })); // audit trail (also in Supabase function logs)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    switch (action) {
      case "log_game": {
        const { players, loser } = payload;
        const err = validateGame(players, loser);
        if (err) return json({ ok: false, error: err }, 400);
        const season_id = await activeSeasonId(db);
        const [p1, p2, p3, p4] = players;
        const { data, error } = await db.from("games")
          .insert({ season_id, p1, p2, p3, p4, loser }).select().single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, data });
      }
      case "undo_last": {
        const season_id = await activeSeasonId(db);
        const { data: last } = await db.from("games").select("id")
          .eq("season_id", season_id).order("played_at", { ascending: false }).limit(1).maybeSingle();
        if (!last) return json({ ok: true, data: null });
        const { error } = await db.from("games").delete().eq("id", last.id);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, data: last });
      }
      case "edit_loser": {
        const { game_id, loser } = payload;
        const { data: g } = await db.from("games").select("p1,p2,p3,p4").eq("id", game_id).maybeSingle();
        if (!g) return json({ ok: false, error: "game not found" }, 404);
        if (![g.p1, g.p2, g.p3, g.p4].includes(loser))
          return json({ ok: false, error: "the loser must be one of the 4 players" }, 400);
        const { error } = await db.from("games").update({ loser }).eq("id", game_id);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true });
      }
      case "delete_game": {
        const { game_id } = payload;
        const { error } = await db.from("games").delete().eq("id", game_id);
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true });
      }
      case "start_season": {
        const { name } = payload;
        await db.from("seasons").update({ is_active: false }).eq("is_active", true);
        const { data, error } = await db.from("seasons")
          .insert({ name: (name ?? "").trim() || "New season", is_active: true }).select().single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, data });
      }
      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
});
