import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, matchesPerRound, suggestedRounds } from './americano.mjs';

const pkey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const roster = (n) => Array.from({ length: n }, (_, i) => i + 1);

// Every invariant a valid round must satisfy, checked across a whole schedule.
function invariants(sched, n, courts) {
  const m = matchesPerRound(n, courts);
  const sitPerRound = n - m * 4;
  for (const rnd of sched.rounds) {
    assert.equal(rnd.matches.length, m, 'matches per round');
    assert.equal(rnd.sitOut.length, sitPerRound, 'sit-outs per round');
    const seen = new Set();
    for (const mt of rnd.matches) {
      for (const id of [...mt.a, ...mt.b]) {
        assert.ok(!seen.has(id), `player ${id} appears twice in round ${rnd.round}`);
        seen.add(id);
      }
      assert.equal(mt.a.length, 2); assert.equal(mt.b.length, 2);
    }
    for (const id of rnd.sitOut) assert.ok(!seen.has(id), 'a sitter also played');
    assert.equal(seen.size + rnd.sitOut.length, n, 'everyone accounted for');
  }
}

// Spread of sit-outs across players must be even (differ by at most 1).
function sitBalance(sched, n) {
  const sits = new Map(roster(n).map((id) => [id, 0]));
  for (const rnd of sched.rounds) for (const id of rnd.sitOut) sits.set(id, sits.get(id) + 1);
  const vals = [...sits.values()];
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, `sit-outs unbalanced: ${vals}`);
}

test('matchesPerRound + suggestedRounds', () => {
  assert.equal(matchesPerRound(4, 1), 1);
  assert.equal(matchesPerRound(8, 2), 2);
  assert.equal(matchesPerRound(6, 2), 1);   // only 6 players → one court's worth
  assert.equal(matchesPerRound(3, 1), 0);   // too few
  assert.equal(suggestedRounds(4, 1), 3);   // C(4,2)=6 pairs / 2 per round
  assert.equal(suggestedRounds(8, 2), 7);   // C(8,2)=28 / 4 per round
});

test('under 4 players yields no schedule', () => {
  const s = generateSchedule(roster(3), 1);
  assert.deepEqual(s.rounds, []);
  assert.equal(s.matchesPerRound, 0);
});

test('4 players, 1 court: everyone partners everyone exactly once over 3 rounds', () => {
  const s = generateSchedule(roster(4), 1);
  assert.equal(s.totalRounds, 3);
  invariants(s, 4, 1);
  const partners = new Set();
  for (const rnd of s.rounds) for (const mt of rnd.matches) {
    partners.add(pkey(...mt.a)); partners.add(pkey(...mt.b));
  }
  assert.equal(partners.size, 6, 'all 6 pairs partnered');   // C(4,2) with no repeats
});

test('8 players, 2 courts: 7 full rounds, no sit-outs, all pairs partnered once', () => {
  const s = generateSchedule(roster(8), 2);
  assert.equal(s.totalRounds, 7);
  assert.equal(s.sitOutPerRound, 0);
  invariants(s, 8, 2);
  const partners = [];
  for (const rnd of s.rounds) for (const mt of rnd.matches) { partners.push(pkey(...mt.a), pkey(...mt.b)); }
  assert.equal(partners.length, 28);
  assert.equal(new Set(partners).size, 28, 'no repeated partnerships');   // clean 1-factorization
});

test('5 players, 1 court: 5 rounds, each player sits exactly once, invariants hold', () => {
  const s = generateSchedule(roster(5), 1);
  assert.equal(s.totalRounds, 5);
  assert.equal(s.sitOutPerRound, 1);
  invariants(s, 5, 1);
  sitBalance(s, 5);
});

test('6 players, 1 court: 2 sit-outs a round, evenly shared, no double-booking', () => {
  const s = generateSchedule(roster(6), 1);
  assert.equal(s.sitOutPerRound, 2);
  invariants(s, 6, 1);
  sitBalance(s, 6);
});

test('deterministic: same inputs give the same schedule', () => {
  const a = JSON.stringify(generateSchedule(roster(7), 1));
  const b = JSON.stringify(generateSchedule(roster(7), 1));
  assert.equal(a, b);
});

test('explicit round count is honoured', () => {
  const s = generateSchedule(roster(8), 2, 3);
  assert.equal(s.totalRounds, 3);
  invariants(s, 8, 2);
});
