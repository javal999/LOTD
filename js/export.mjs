// Build the export payload for one leaderboard. Pure (no DOM, no Date) so the real
// acceptance — "the standings can be rebuilt from this file alone" — is unit-testable.
// The Blob/anchor download in app.js is just glue around this.
export function buildExport(board, { players = [], games = [], standings = [] }, exportedAt) {
  return {
    app: 'LOTD',
    version: 3,
    exported_at: exportedAt,
    leaderboard: { id: board.id, name: board.name },
    players: players.map((p) => ({ id: p.id, name: p.name, archived: Boolean(p.archived) })),
    games: games.map((g) => ({
      id: g.id,
      game_date: g.game_date,
      players: [g.p1, g.p2, g.p3, g.p4],
      loser: g.loser,
    })),
    standings: standings.map((s) => ({
      name: s.name, gp: s.gp, losses: s.losses, archived: Boolean(s.archived),
    })),
  };
}

// Recompute per-player {gp, losses} from an export's games alone. This is what proves the
// file is a real backup: feed it nothing but the games and get the standings back.
export function rebuildStandings(payload) {
  const gp = new Map(), losses = new Map();
  for (const p of payload.players) { gp.set(p.id, 0); losses.set(p.id, 0); }
  for (const g of payload.games) {
    for (const id of g.players) gp.set(id, (gp.get(id) ?? 0) + 1);
    losses.set(g.loser, (losses.get(g.loser) ?? 0) + 1);
  }
  return payload.players.map((p) => ({
    name: p.name, gp: gp.get(p.id) ?? 0, losses: losses.get(p.id) ?? 0, archived: p.archived,
  }));
}
