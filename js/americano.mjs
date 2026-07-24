// Americano schedule generator — pure, no DB, runs in the browser and `node --test`.
//
// Given who's here tonight and how many courts, produce a suggested rotation of rounds. Each round
// is a set of 2v2 matches (one per court) plus sit-outs, chosen so that — as far as the roster
// allows — everyone partners everyone once, sit-outs are shared evenly, and you don't keep facing
// the same people. It's only a suggestion: you log the rounds you actually play (PRD v4 Phase B / B1).
//
// The schedule is a deterministic function of (roster order, courts, rounds), so the client can
// regenerate it on reload from just those three stored fields — no need to persist the pairings.

// Matches that fit each round: one per court, but never more than the players allow (4 per match).
export function matchesPerRound(n, courts) {
  return Math.max(0, Math.min(courts, Math.floor(n / 4)));
}

// Rounds for a full partner rotation (everyone partners everyone once) at this court count. Each
// round plays 2 partnerships per match, so it's the total pairs over that. Callers may override.
export function suggestedRounds(n, courts) {
  const m = matchesPerRound(n, courts);
  if (m === 0) return 0;
  return Math.ceil((n * (n - 1) / 2) / (2 * m));
}

const pkey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// Minimum-cost perfect matching of an even-length id list: pair everyone up so the summed pair cost
// is lowest. Exact by recursion (fix the first id, try each partner) — fine for the tiny lists here
// (≤12 ids ⇒ ≤10395 matchings). Deterministic: ties resolve to the earlier partner. Returns null
// for an odd list. `cost(a,b)` is any non-negative pair cost.
function bestMatching(ids, cost) {
  if (ids.length === 0) return { pairs: [], total: 0 };
  if (ids.length % 2 === 1) return null;
  const [first, ...rest] = ids;
  let best = null;
  for (let k = 0; k < rest.length; k++) {
    const mate = rest[k];
    const sub = bestMatching(rest.filter((_, i) => i !== k), cost);
    const total = cost(first, mate) + sub.total;
    if (best === null || total < best.total) best = { pairs: [[first, mate], ...sub.pairs], total };
  }
  return best;
}

// Greedy min-cost matching fallback for large rounds (>12 playing, i.e. 4+ courts): repeatedly take
// the cheapest available pair. Not always optimal, but such rosters are far beyond a padel night.
function greedyMatching(ids, cost) {
  const rest = [...ids];
  const pairs = [];
  while (rest.length >= 2) {
    let bi = 0, bj = 1, bc = Infinity;
    for (let i = 0; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const c = cost(rest[i], rest[j]);
        if (c < bc) { bc = c; bi = i; bj = j; }
      }
    }
    pairs.push([rest[bi], rest[bj]]);
    rest.splice(bj, 1); rest.splice(bi, 1);
  }
  return { pairs };
}

const match = (ids, cost) => (ids.length <= 12 ? bestMatching(ids, cost) : greedyMatching(ids, cost));

// roster (player ids, in a fixed order) + courts + rounds -> a schedule:
//   { rounds: [{ round, matches:[{a:[id,id], b:[id,id]}], sitOut:[id,...] }], matchesPerRound, sitOutPerRound }
// Each round: pick who sits (fewest past sit-outs first, then most games played — they've earned a
// rest), then pair the players into partnerships preferring never-partnered pairs, then pair those
// partnerships into matches preferring never-faced opponents. Returns { rounds:[] } if <4 players.
export function generateSchedule(roster, courts = 1, rounds = null) {
  const n = roster.length;
  const m = matchesPerRound(n, courts);
  if (m === 0) return { rounds: [], matchesPerRound: 0, sitOutPerRound: 0, totalRounds: 0 };
  const sitPerRound = n - m * 4;
  const R = rounds ?? suggestedRounds(n, courts);

  const games = new Map(roster.map((id) => [id, 0]));   // games played so far
  const sits = new Map(roster.map((id) => [id, 0]));    // times sat out so far
  const partner = new Map();                            // pkey -> times partnered
  const oppo = new Map();                               // pkey -> times opposed
  const cnt = (map, a, b) => map.get(pkey(a, b)) ?? 0;
  const bump = (map, a, b) => map.set(pkey(a, b), cnt(map, a, b) + 1);

  const out = [];
  for (let r = 0; r < R; r++) {
    // Sitters: share sit-outs evenly (fewest sits first), break ties toward whoever has played most.
    const sitters = [...roster]
      .sort((a, b) => (sits.get(a) - sits.get(b)) || (games.get(b) - games.get(a)) || (a - b))
      .slice(0, sitPerRound);
    const sitting = new Set(sitters);
    const playing = roster.filter((id) => !sitting.has(id));

    // Partnerships: prefer pairs who've never partnered; among equals, the fresher (fewer games) pair.
    const partnerships = match(playing, (a, b) => cnt(partner, a, b) * 1000 + games.get(a) + games.get(b)).pairs;

    // Matches: pair partnerships so opponents are as fresh as possible. Index the partnerships and
    // match on those indices, scoring by how often the two sides' players have already faced off.
    const idx = partnerships.map((_, i) => i);
    const faceCost = (i, j) => {
      const [x1, x2] = partnerships[i], [y1, y2] = partnerships[j];
      return cnt(oppo, x1, y1) + cnt(oppo, x1, y2) + cnt(oppo, x2, y1) + cnt(oppo, x2, y2);
    };
    const pairedIdx = match(idx, faceCost).pairs;
    const matches = pairedIdx.map(([i, j]) => ({ a: partnerships[i], b: partnerships[j] }));

    // Commit the round into the running counters.
    for (const mt of matches) {
      bump(partner, mt.a[0], mt.a[1]);
      bump(partner, mt.b[0], mt.b[1]);
      for (const x of mt.a) for (const y of mt.b) bump(oppo, x, y);
      for (const id of [...mt.a, ...mt.b]) games.set(id, games.get(id) + 1);
    }
    for (const id of sitters) sits.set(id, sits.get(id) + 1);
    out.push({ round: r + 1, matches, sitOut: sitters });
  }

  return { rounds: out, matchesPerRound: m, sitOutPerRound: sitPerRound, totalRounds: out.length };
}
