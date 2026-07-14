import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, biggestLoser, validateGame } from './tally.mjs';

const ROSTER = [
  { id: 1, name: 'Ade' },
  { id: 2, name: 'Bima' },
  { id: 3, name: 'Citra' },
  { id: 4, name: 'Dewi' },
];

// 10 games, all four play every game; losers: Ade×1, Bima×4, Citra×3, Dewi×2
// → reproduces PRD Appendix A.
const LOSERS = [2, 2, 2, 2, 3, 3, 3, 4, 4, 1];
const GAMES = LOSERS.map((loser, i) => ({
  players: [1, 2, 3, 4],
  loser,
  played_at: `2026-07-${String(10 + (i % 3)).padStart(2, '0')}T21:00:00Z`,
}));

test('tally reproduces Appendix A gp/l', () => {
  const byName = Object.fromEntries(tally(GAMES, ROSTER).map((p) => [p.name, p]));
  assert.deepEqual(byName.Ade, { id: 1, name: 'Ade', gp: 10, l: 1 });
  assert.deepEqual(byName.Bima, { id: 2, name: 'Bima', gp: 10, l: 4 });
  assert.deepEqual(byName.Citra, { id: 3, name: 'Citra', gp: 10, l: 3 });
  assert.deepEqual(byName.Dewi, { id: 4, name: 'Dewi', gp: 10, l: 2 });
});

test('tally includes never-played roster members at 0/0', () => {
  const withEka = [...ROSTER, { id: 5, name: 'Eka' }];
  const eka = tally(GAMES, withEka).find((p) => p.name === 'Eka');
  assert.deepEqual(eka, { id: 5, name: 'Eka', gp: 0, l: 0 });
});

test('tally throws on a game referencing an unknown player', () => {
  assert.throws(() => tally([{ players: [1, 2, 3, 99], loser: 1 }], ROSTER), /unknown player 99/);
});

test('invariant: losses sum to #games, games-played sum to 4×#games', () => {
  const rows = tally(GAMES, ROSTER);
  assert.equal(rows.reduce((s, p) => s + p.l, 0), GAMES.length);
  assert.equal(rows.reduce((s, p) => s + p.gp, 0), 4 * GAMES.length);
});

test('biggestLoser picks the day\'s top loser', () => {
  // day 2026-07-10 holds games at indices 0,3,6,9 → losers 2,2,3,1 → Bima ×2
  assert.deepEqual(biggestLoser(GAMES, ROSTER, '2026-07-10'), { name: 'Bima', losses: 2 });
});

test('biggestLoser returns null on a day with no games', () => {
  assert.equal(biggestLoser(GAMES, ROSTER, '2099-01-01'), null);
});

test('validateGame accepts exactly 4 distinct players with the loser among them', () => {
  assert.deepEqual(validateGame([1, 2, 3, 4], 3), { ok: true });
});

test('validateGame rejects the wrong player count (invariant: exactly 4)', () => {
  assert.equal(validateGame([1, 2, 3], 3).ok, false);
  assert.equal(validateGame([1, 2, 3, 4, 5], 3).ok, false);
});

test('validateGame rejects duplicate players', () => {
  assert.equal(validateGame([1, 2, 3, 3], 3).ok, false);
});

test('validateGame rejects a loser who was not at the table', () => {
  assert.equal(validateGame([1, 2, 3, 4], 9).ok, false);
});
