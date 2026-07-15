import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, rebuildStandings } from './export.mjs';

// Appendix A over 10 games: Player1 l1, Player2 l4, Player3 l3, Player4 l2. Player5 never played.
const PLAYERS = [
  { id: 1, name: 'Player1', archived: false },
  { id: 2, name: 'Player2', archived: false },
  { id: 3, name: 'Player3', archived: true },
  { id: 4, name: 'Player4', archived: false },
  { id: 5, name: 'Player5', archived: false },
];
const LOSERS = [2, 2, 2, 2, 3, 3, 3, 4, 4, 1];
const GAMES = LOSERS.map((loser, i) => ({
  id: i + 1, game_date: `2026-07-${String(13 + (i % 3)).padStart(2, '0')}`,
  p1: 1, p2: 2, p3: 3, p4: 4, loser,
}));
const STANDINGS = [
  { name: 'Player1', gp: 10, losses: 1, archived: false },
  { name: 'Player2', gp: 10, losses: 4, archived: false },
  { name: 'Player3', gp: 10, losses: 3, archived: true },
  { name: 'Player4', gp: 10, losses: 2, archived: false },
  { name: 'Player5', gp: 0, losses: 0, archived: false },
];
const BOARD = { id: 7, name: 'Poker night' };
const DATA = { players: PLAYERS, games: GAMES, standings: STANDINGS };

test('export carries the leaderboard, roster, standings and every game', () => {
  const out = buildExport(BOARD, DATA, '2026-07-15T10:00:00Z');
  assert.equal(out.app, 'LOTD');
  assert.equal(out.version, 3);
  assert.equal(out.exported_at, '2026-07-15T10:00:00Z');
  assert.deepEqual(out.leaderboard, { id: 7, name: 'Poker night' });
  assert.equal(out.players.length, 5);
  assert.equal(out.games.length, 10);
  assert.equal(out.standings.length, 5);
});

test('every exported game keeps its date, four players and loser', () => {
  const out = buildExport(BOARD, DATA, 'x');
  for (const g of out.games) {
    assert.match(g.game_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(g.players.length, 4);
    assert.equal(new Set(g.players).size, 4);
    assert.ok(g.players.includes(g.loser), 'loser must be one of the four');
  }
});

test('archived flag survives the round trip', () => {
  const out = buildExport(BOARD, DATA, 'x');
  assert.equal(out.players.find((p) => p.name === 'Player3').archived, true);
});

// The point of the whole feature: the file is a real backup.
test('standings can be rebuilt from the exported games alone', () => {
  const out = buildExport(BOARD, DATA, 'x');
  assert.deepEqual(rebuildStandings(out), out.standings);
});

test('rebuild handles a leaderboard with no games (everyone at 0)', () => {
  const out = buildExport(BOARD, { players: PLAYERS, games: [], standings: [] }, 'x');
  assert.deepEqual(rebuildStandings(out).map((r) => r.gp), [0, 0, 0, 0, 0]);
});
