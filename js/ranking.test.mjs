import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStandings, biggestLoserAllTime, biggestLoserForDate, MODES,
} from './ranking.mjs';

// Hand-computed from PRD v3 Appendix A + BUILD-PLAN E2 vectors. Expected values come
// from the spec, NOT from running the implementation.
const APPENDIX_A = [
  { name: 'Ade',   gp: 10, losses: 1, archived: false },
  { name: 'Bima',  gp: 10, losses: 4, archived: false },
  { name: 'Citra', gp: 10, losses: 3, archived: false },
  { name: 'Dewi',  gp: 10, losses: 2, archived: false },
];
const EKA = { name: 'Eka', gp: 2, losses: 0, archived: false };

const names = (list) => list.map((p) => p.name);

// ---------- computeStandings ----------

test('most_not_lost: equal GP → Ade, Dewi, Citra, Bima', () => {
  const { ranked, unranked } = computeStandings(APPENDIX_A, MODES.MOST_NOT_LOST);
  assert.deepEqual(names(ranked), ['Ade', 'Dewi', 'Citra', 'Bima']);
  assert.deepEqual(ranked.map((p) => p.games_not_lost), [9, 8, 7, 6]);
  assert.equal(unranked.length, 0);
});

test('lowest_loss_rate: equal GP → Ade, Dewi, Citra, Bima', () => {
  const { ranked, unranked } = computeStandings(APPENDIX_A, MODES.LOWEST_LOSS_RATE);
  assert.deepEqual(names(ranked), ['Ade', 'Dewi', 'Citra', 'Bima']);
  assert.deepEqual(ranked.map((p) => p.loss_rate), [0.1, 0.2, 0.3, 0.4]);
  assert.equal(unranked.length, 0);
});

test('ranks are the contiguous sequence 1..n', () => {
  const { ranked } = computeStandings(APPENDIX_A, MODES.LOWEST_LOSS_RATE);
  assert.deepEqual(ranked.map((p) => p.rank), [1, 2, 3, 4]);
});

test('Eka (gp 2): ranked last in most_not_lost, unranked (provisional) in lowest_loss_rate', () => {
  const roster = [...APPENDIX_A, EKA];
  const gnl = computeStandings(roster, MODES.MOST_NOT_LOST);
  assert.equal(names(gnl.ranked).at(-1), 'Eka');   // games_not_lost = 2 → last, but ranked
  assert.equal(gnl.unranked.length, 0);

  const lr = computeStandings(roster, MODES.LOWEST_LOSS_RATE);
  assert.deepEqual(names(lr.ranked), ['Ade', 'Dewi', 'Citra', 'Bima']);
  assert.deepEqual(names(lr.unranked), ['Eka']);
  assert.equal(lr.unranked[0].provisional, true);
});

test('gp=0 player: unranked in both modes, loss_rate null, no divide-by-zero', () => {
  const roster = [{ name: 'Idle', gp: 0, losses: 0, archived: false }];
  for (const mode of Object.values(MODES)) {
    const { ranked, unranked } = computeStandings(roster, mode);
    assert.equal(ranked.length, 0, `mode ${mode} should not rank a 0-game player`);
    assert.deepEqual(names(unranked), ['Idle']);
    assert.equal(unranked[0].loss_rate, null);
  }
});

test('provisional flag is gp < 5', () => {
  const roster = [
    { name: 'Four', gp: 4, losses: 1, archived: false },
    { name: 'Five', gp: 5, losses: 1, archived: false },
  ];
  const { ranked, unranked } = computeStandings(roster, MODES.LOWEST_LOSS_RATE);
  assert.deepEqual(names(ranked), ['Five']);
  assert.deepEqual(names(unranked), ['Four']);
});

test('most_not_lost tie on games_not_lost → lower loss rate wins', () => {
  const roster = [
    { name: 'P', gp: 10, losses: 2, archived: false }, // gnl 8, lr .20
    { name: 'Q', gp: 12, losses: 4, archived: false }, // gnl 8, lr .333
  ];
  assert.deepEqual(names(computeStandings(roster, MODES.MOST_NOT_LOST).ranked), ['P', 'Q']);
});

test('lowest_loss_rate tie on loss rate → bigger sample wins', () => {
  const roster = [
    { name: 'R', gp: 10, losses: 2, archived: false }, // lr .20
    { name: 'S', gp: 20, losses: 4, archived: false }, // lr .20, more gp
  ];
  assert.deepEqual(names(computeStandings(roster, MODES.LOWEST_LOSS_RATE).ranked), ['S', 'R']);
});

test('final tiebreak is name A→Z (both modes)', () => {
  const roster = [
    { name: 'Zed', gp: 5, losses: 1, archived: false },
    { name: 'Abe', gp: 5, losses: 1, archived: false },
  ];
  assert.deepEqual(names(computeStandings(roster, MODES.MOST_NOT_LOST).ranked), ['Abe', 'Zed']);
  assert.deepEqual(names(computeStandings(roster, MODES.LOWEST_LOSS_RATE).ranked), ['Abe', 'Zed']);
});

test('archived players are still ranked, with the flag carried through', () => {
  const roster = [
    { name: 'Gone', gp: 10, losses: 1, archived: true },
    { name: 'Here', gp: 10, losses: 5, archived: false },
  ];
  const { ranked } = computeStandings(roster, MODES.LOWEST_LOSS_RATE);
  assert.deepEqual(names(ranked), ['Gone', 'Here']); // their games happened; still counted
  assert.equal(ranked[0].archived, true);
  assert.equal(ranked[1].archived, false);
});

test('computeStandings does not mutate its input', () => {
  const roster = [{ name: 'X', gp: 5, losses: 1, archived: false }];
  const snapshot = JSON.stringify(roster);
  computeStandings(roster, MODES.LOWEST_LOSS_RATE);
  assert.equal(JSON.stringify(roster), snapshot);
});

// ---------- biggestLoserAllTime ----------

test('biggestLoserAllTime: single winner is the most losses', () => {
  assert.deepEqual(biggestLoserAllTime(APPENDIX_A), ['Bima']); // 4 losses
});

test('biggestLoserAllTime: ties return every tied name', () => {
  const roster = [
    { name: 'Ade', gp: 10, losses: 4, archived: false },
    { name: 'Bima', gp: 10, losses: 4, archived: false },
    { name: 'Citra', gp: 10, losses: 1, archived: false },
  ];
  assert.deepEqual(biggestLoserAllTime(roster), ['Ade', 'Bima']);
});

test('biggestLoserAllTime: no games → empty array', () => {
  assert.deepEqual(biggestLoserAllTime([{ name: 'A', gp: 0, losses: 0, archived: false }]), []);
  assert.deepEqual(biggestLoserAllTime([]), []);
});

// ---------- biggestLoserForDate ----------

const PLAYERS = [{ id: 1, name: 'Ade' }, { id: 2, name: 'Bima' }, { id: 3, name: 'Citra' }];
const GAMES = [
  { game_date: '2026-07-15', loser: 2 },
  { game_date: '2026-07-15', loser: 2 },
  { game_date: '2026-07-15', loser: 1 },
  { game_date: '2026-07-14', loser: 3 },
];

test('biggestLoserForDate: picks the day\'s most-losses player', () => {
  assert.deepEqual(biggestLoserForDate(GAMES, PLAYERS, '2026-07-15'), ['Bima']); // 2 vs Ade 1
});

test('biggestLoserForDate: only counts that date (backdated games stay on their own day)', () => {
  assert.deepEqual(biggestLoserForDate(GAMES, PLAYERS, '2026-07-14'), ['Citra']);
});

test('biggestLoserForDate: a day with no games → empty array', () => {
  assert.deepEqual(biggestLoserForDate(GAMES, PLAYERS, '2099-01-01'), []);
  assert.deepEqual(biggestLoserForDate([], PLAYERS, '2026-07-15'), []);
});

test('biggestLoserForDate: ties return every tied name', () => {
  const games = [...GAMES, { game_date: '2026-07-15', loser: 1 }]; // Ade 2, Bima 2
  assert.deepEqual(biggestLoserForDate(games, PLAYERS, '2026-07-15'), ['Ade', 'Bima']);
});
