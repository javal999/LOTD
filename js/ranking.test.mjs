import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, rank, MODES } from './ranking.mjs';

// Hand-computed from PRD Appendix A. Expected values are NOT derived from the
// implementation — they come from the spec (gnl = gp-l, lossRate = l/gp).
const APPENDIX_A = [
  { name: 'Ade', gp: 10, l: 1 },
  { name: 'Bima', gp: 10, l: 4 },
  { name: 'Citra', gp: 10, l: 3 },
  { name: 'Dewi', gp: 10, l: 2 },
];

const names = (list) => list.map((p) => p.name);

test('computeStats: gamesNotLost = gp - l', () => {
  assert.equal(computeStats({ name: 'Ade', gp: 10, l: 1 }).gamesNotLost, 9);
  assert.equal(computeStats({ name: 'Bima', gp: 10, l: 4 }).gamesNotLost, 6);
});

test('computeStats: lossRate = l/gp', () => {
  assert.equal(computeStats({ name: 'Dewi', gp: 10, l: 2 }).lossRate, 0.2);
  assert.equal(computeStats({ name: 'Bima', gp: 10, l: 4 }).lossRate, 0.4);
});

test('computeStats: 0 games → lossRate null, no div-by-zero (edge case #1/#2)', () => {
  const s = computeStats({ name: 'Ghost', gp: 0, l: 0 });
  assert.equal(s.lossRate, null);
  assert.equal(s.gamesNotLost, 0);
});

test('computeStats: beatsLuck is strictly below 25% (PRD §2 "under 25%")', () => {
  assert.equal(computeStats({ name: 'A', gp: 10, l: 2 }).beatsLuck, true);   // 20%
  assert.equal(computeStats({ name: 'B', gp: 4, l: 1 }).beatsLuck, false);   // exactly 25%
  assert.equal(computeStats({ name: 'C', gp: 10, l: 3 }).beatsLuck, false);  // 30%
  assert.equal(computeStats({ name: 'D', gp: 0, l: 0 }).beatsLuck, false);   // no games
});

test('Appendix A: equal games → both sorts give Ade, Dewi, Citra, Bima', () => {
  const gnl = rank(APPENDIX_A, MODES.GAMES_NOT_LOST);
  const lr = rank(APPENDIX_A, MODES.LOSS_RATE);
  assert.deepEqual(names(gnl.ranked), ['Ade', 'Dewi', 'Citra', 'Bima']);
  assert.deepEqual(names(lr.ranked), ['Ade', 'Dewi', 'Citra', 'Bima']);
  assert.equal(gnl.unranked.length, 0);
  assert.equal(lr.unranked.length, 0);
});

test('rank assigns 1..n positions in sorted order', () => {
  const { ranked } = rank(APPENDIX_A, MODES.LOSS_RATE);
  assert.deepEqual(ranked.map((p) => p.rank), [1, 2, 3, 4]);
});

test('Appendix A + Eka(2 games): ranked last in games-not-lost, unranked in loss-rate', () => {
  const roster = [...APPENDIX_A, { name: 'Eka', gp: 2, l: 0 }];
  const gnl = rank(roster, MODES.GAMES_NOT_LOST);
  const lr = rank(roster, MODES.LOSS_RATE);
  assert.equal(names(gnl.ranked).at(-1), 'Eka');           // gnl=2, ranks last but IS ranked
  assert.equal(gnl.unranked.length, 0);
  assert.deepEqual(names(lr.ranked), ['Ade', 'Dewi', 'Citra', 'Bima']); // Eka excluded
  assert.deepEqual(names(lr.unranked), ['Eka']);           // < 5 games
});

test('games-not-lost tie broken by lower loss rate (edge case #4)', () => {
  const roster = [
    { name: 'P', gp: 10, l: 2 }, // gnl 8, lr .20
    { name: 'Q', gp: 12, l: 4 }, // gnl 8, lr .333
  ];
  assert.deepEqual(names(rank(roster, MODES.GAMES_NOT_LOST).ranked), ['P', 'Q']);
});

test('loss-rate tie broken by more games played (edge case #5)', () => {
  const roster = [
    { name: 'R', gp: 10, l: 2 }, // lr .20
    { name: 'S', gp: 20, l: 4 }, // lr .20, bigger sample
  ];
  assert.deepEqual(names(rank(roster, MODES.LOSS_RATE).ranked), ['S', 'R']);
});

test('final tiebreak is name A→Z', () => {
  const roster = [
    { name: 'Zed', gp: 5, l: 1 },
    { name: 'Abe', gp: 5, l: 1 },
  ];
  assert.deepEqual(names(rank(roster, MODES.LOSS_RATE).ranked), ['Abe', 'Zed']);
});

test('loss-rate mode: <5 games unranked; games-not-lost mode: still ranked if gp>=1', () => {
  const roster = [{ name: 'New', gp: 3, l: 0 }];
  assert.deepEqual(names(rank(roster, MODES.LOSS_RATE).unranked), ['New']);
  assert.equal(rank(roster, MODES.LOSS_RATE).ranked.length, 0);
  assert.deepEqual(names(rank(roster, MODES.GAMES_NOT_LOST).ranked), ['New']);
});

test('0-games players are unranked in both modes', () => {
  const roster = [{ name: 'Idle', gp: 0, l: 0 }];
  assert.equal(rank(roster, MODES.GAMES_NOT_LOST).ranked.length, 0);
  assert.deepEqual(names(rank(roster, MODES.GAMES_NOT_LOST).unranked), ['Idle']);
  assert.equal(rank(roster, MODES.LOSS_RATE).ranked.length, 0);
});

test('rank does not mutate its input', () => {
  const roster = [{ name: 'X', gp: 5, l: 1 }];
  const snapshot = JSON.stringify(roster);
  rank(roster, MODES.LOSS_RATE);
  assert.equal(JSON.stringify(roster), snapshot);
});

// Property tests over 200 random rosters — deterministic (seeded LCG, no Math.random).
// These fail if ranking ever drops/duplicates a player, misnumbers ranks, or sorts wrong.
function* rosters(seed = 1) {
  let s = seed;
  const rnd = (n) => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s % n);
  for (let i = 0; i < 200; i++) {
    const roster = [];
    const size = 1 + rnd(8);
    for (let j = 0; j < size; j++) {
      const gp = rnd(30); // includes 0-game players
      roster.push({ name: `P${i}_${j}`, gp, l: gp === 0 ? 0 : rnd(gp + 1) });
    }
    yield roster;
  }
}

for (const mode of Object.values(MODES)) {
  test(`property [${mode}]: every player is ranked xor unranked, exactly once`, () => {
    for (const roster of rosters()) {
      const { ranked, unranked } = rank(roster, mode);
      assert.equal(ranked.length + unranked.length, roster.length);
      const seen = new Set([...ranked, ...unranked].map((p) => p.name));
      assert.equal(seen.size, roster.length);
    }
  });

  test(`property [${mode}]: ranks are the contiguous sequence 1..n`, () => {
    for (const roster of rosters()) {
      const { ranked } = rank(roster, mode);
      assert.deepEqual(ranked.map((p) => p.rank), ranked.map((_, i) => i + 1));
    }
  });
}

test('property [loss-rate]: ranked list is non-decreasing by loss rate', () => {
  for (const roster of rosters()) {
    const { ranked } = rank(roster, MODES.LOSS_RATE);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i].lossRate >= ranked[i - 1].lossRate);
    }
  }
});

test('property [games-not-lost]: ranked list is non-increasing by games not lost', () => {
  for (const roster of rosters()) {
    const { ranked } = rank(roster, MODES.GAMES_NOT_LOST);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i].gamesNotLost <= ranked[i - 1].gamesNotLost);
    }
  }
});
