// Standings + spotlight math — pure, no DB, no deps. Runs in the browser and `node --test`.
// Source of truth: PRD v3 §2 / §7.5 / §14.4 + BUILD-PLAN E2.
//
// Input rows come from the v_standings view: { name, gp, losses, archived }.
// ponytail: stub first so the tests go red before the real logic lands.

export const MIN_GAMES_FOR_RATE = 5;   // below this a player is "provisional" (PRD 7.5)
export const LUCK_BASELINE = 0.25;     // 4 players, 1 loser → 25% by chance (PRD §2)

export const MODES = {
  MOST_NOT_LOST: 'most_not_lost',
  LOWEST_LOSS_RATE: 'lowest_loss_rate',
};

// Derive the display stats a v_standings row implies.
function decorate(row) {
  const { name, gp, losses, archived } = row;
  const loss_rate = gp > 0 ? losses / gp : null;   // null, not 0 — guards divide-by-zero
  return {
    name,
    gp,
    losses,
    archived: Boolean(archived),
    games_not_lost: gp - losses,
    loss_rate,
    provisional: gp < MIN_GAMES_FOR_RATE,          // too small a sample to rank on rate
    beats_luck: loss_rate !== null && loss_rate < LUCK_BASELINE, // strictly under 25%
  };
}

// Both chains end in name, so order is deterministic regardless of sort stability.
function byMostNotLost(a, b) {
  return b.games_not_lost - a.games_not_lost   // more clean games first
      || a.loss_rate - b.loss_rate             // then lower loss rate
      || b.gp - a.gp                            // then bigger sample
      || a.name.localeCompare(b.name);         // then A→Z
}

function byLowestLossRate(a, b) {
  return a.loss_rate - b.loss_rate             // hardest to beat first
      || b.gp - a.gp                            // then bigger sample
      || b.games_not_lost - a.games_not_lost    // then more clean games
      || a.name.localeCompare(b.name);         // then A→Z
}

// rows -> { ranked: [...,rank], unranked: [...] }
// most_not_lost ranks anyone who has played; lowest_loss_rate ranks only non-provisional
// players (a 2-game run shouldn't crown or shame anyone). Archived players still count —
// their games happened — and carry the flag through for the UI to mark.
export function computeStandings(rows, mode) {
  const all = rows.map(decorate);
  const isEligible = mode === MODES.LOWEST_LOSS_RATE
    ? (p) => p.gp >= MIN_GAMES_FOR_RATE
    : (p) => p.gp >= 1;
  const cmp = mode === MODES.LOWEST_LOSS_RATE ? byLowestLossRate : byMostNotLost;
  const ranked = all.filter(isEligible).sort(cmp).map((p, i) => ({ ...p, rank: i + 1 }));
  const unranked = all.filter((p) => !isEligible(p));
  return { ranked, unranked };
}

const alpha = (a, b) => a.localeCompare(b);

// rows -> array of name(s) with the most losses overall ([] if no games).
// Every game has exactly one loser, so max losses === 0 means nothing has been logged.
export function biggestLoserAllTime(rows) {
  const max = rows.reduce((m, r) => Math.max(m, r.losses ?? 0), 0);
  if (max <= 0) return [];
  return rows.filter((r) => r.losses === max).map((r) => r.name).sort(alpha);
}

// games/players/dateStr -> array of name(s) with the most losses on that date ([] if none).
// Only games dated exactly dateStr count, so a backdated game lands on its own day.
export function biggestLoserForDate(games, players, dateStr) {
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const losses = new Map();
  for (const g of games) {
    if (g.game_date !== dateStr) continue;
    losses.set(g.loser, (losses.get(g.loser) ?? 0) + 1);
  }
  const max = Math.max(0, ...losses.values());
  if (max <= 0) return [];
  return [...losses.entries()]
    .filter(([, n]) => n === max)
    .map(([id]) => nameById.get(id) ?? '?')
    .sort(alpha);
}
