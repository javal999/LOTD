// Ranking library — pure, no DB, no deps. Runs in the browser and in `node --test`.
// Source of truth: PRD §2 (scoring) + §7.5 (dual ranking, thresholds, tiebreaks).
// ponytail: stub first so tests go red before the real logic lands.

export const MIN_GAMES_FOR_RATE = 5;   // loss-rate mode threshold (PRD 7.5)
export const LUCK_BASELINE = 0.25;     // 4 players, 1 loser → 25% by chance (PRD §2)

export const MODES = {
  GAMES_NOT_LOST: 'most-games-not-lost',
  LOSS_RATE: 'lowest-loss-rate',
};

// derive per-player stats from raw {name, gp, l}
export function computeStats(player) {
  const { name, gp, l } = player;
  const lossRate = gp > 0 ? l / gp : null;           // null, not 0, guards div-by-zero (edge #1/#2)
  return {
    name,
    gp,
    l,
    gamesNotLost: gp - l,
    lossRate,
    beatsLuck: lossRate !== null && lossRate < LUCK_BASELINE, // strictly under 25%
  };
}

// Full tiebreak chains end in name, so order is deterministic regardless of sort stability.
function byGamesNotLost(a, b) {
  return b.gamesNotLost - a.gamesNotLost   // more clean games first
      || a.lossRate - b.lossRate           // then lower loss rate
      || b.gp - a.gp                        // then bigger sample
      || a.name.localeCompare(b.name);     // then A→Z
}

function byLossRate(a, b) {
  return a.lossRate - b.lossRate           // hardest to beat first
      || b.gp - a.gp                        // then bigger sample
      || b.gamesNotLost - a.gamesNotLost    // then more clean games
      || a.name.localeCompare(b.name);     // then A→Z
}

// rank a roster for the active mode → { ranked: [...,rank], unranked: [...] }
export function rank(players, mode) {
  const stats = players.map(computeStats);
  const minGames = mode === MODES.LOSS_RATE ? MIN_GAMES_FOR_RATE : 1;
  const cmp = mode === MODES.LOSS_RATE ? byLossRate : byGamesNotLost;
  const eligible = stats.filter((p) => p.gp >= minGames);
  const ranked = eligible.sort(cmp).map((p, i) => ({ ...p, rank: i + 1 }));
  const unranked = stats.filter((p) => p.gp < minGames);
  return { ranked, unranked };
}
