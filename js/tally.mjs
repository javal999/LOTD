// Aggregate a games log into per-player {gp, l}. Replaces the v_standings DB view
// (ponytail: the frontend already loads the full log for export + loser-of-night,
// so tallying here means one tested source of truth instead of a DB view to maintain).
// A game is { players: [id,id,id,id], loser: id }. The 4p/1-loser invariant is
// enforced at write time (DB CHECK constraints); this trusts that and just counts.

export function tally(games, roster) {
  const byId = new Map(roster.map((p) => [p.id, { id: p.id, name: p.name, gp: 0, l: 0 }]));
  for (const g of games) {
    for (const pid of g.players) {
      const p = byId.get(pid);
      if (!p) throw new Error(`game references unknown player ${pid}`);
      p.gp++;
    }
    byId.get(g.loser).l++; // loser is always one of players (CHECK constraint), so present
  }
  return [...byId.values()];
}

// Biggest loser among games on a given day (loser-of-the-night). Returns
// { name, losses } or null if no games that day. `day` is a YYYY-MM-DD string.
export function biggestLoser(games, roster, day) {
  const nameById = new Map(roster.map((p) => [p.id, p.name]));
  const losses = new Map();
  for (const g of games) {
    if (!g.played_at?.startsWith(day)) continue;
    losses.set(g.loser, (losses.get(g.loser) ?? 0) + 1);
  }
  let top = null;
  for (const [id, n] of losses) {
    if (!top || n > top.losses) top = { name: nameById.get(id), losses: n };
  }
  return top;
}

// The hard invariant: a game is exactly 4 distinct players with exactly 1 loser
// who is one of them. Client-side guard (defense in depth; the DB CHECK constraints
// and the Edge Function re-validate server-side — never trust the client alone).
export function validateGame(players, loser) {
  if (!Array.isArray(players) || players.length !== 4) return { ok: false, error: 'a game needs exactly 4 players' };
  if (new Set(players).size !== 4) return { ok: false, error: 'the 4 players must be distinct' };
  if (!players.includes(loser)) return { ok: false, error: 'the loser must be one of the 4 players' };
  return { ok: true };
}
