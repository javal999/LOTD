// Standings + spotlight math — pure, no DB, no deps. Runs in the browser and `node --test`.
// Source of truth: PRD v3 §2 / §7.5 / §14.4 + BUILD-PLAN E2.
//
// Input rows come from the v_standings view: { name, gp, losses, archived }.
// ponytail: stub first so the tests go red before the real logic lands.

export const MIN_GAMES_FOR_RATE = 5;   // below this a player is "provisional" (PRD 7.5)
export const LUCK_BASELINE = 0.25;     // cards: 4 players, 1 loser → 25% by chance (PRD §2)
export const LUCK_BASELINE_SPORT = 0.5; // racquet: 2 sides → 50% by chance (PRD v4 §4.2)

// This is a *loser* board: rank 1 is the biggest loser, so the table agrees with the
// spotlight above it. (PRD v3 specified lowest-first; Levi reversed it 2026-07-15 so the
// top of the table matches the highlighted loser.)
export const MODES = {
  MOST_NOT_LOST: 'most_not_lost',
  HIGHEST_LOSS_RATE: 'highest_loss_rate',
};

// Derive the display stats a standings row implies. `luckBaseline` is the by-chance loss rate for
// the game type (cards 0.25, racquet 0.5), so "beats luck" means the same thing in every format.
function decorate(row, luckBaseline = LUCK_BASELINE) {
  const { player_id, name, gp, losses, archived } = row;
  const loss_rate = gp > 0 ? losses / gp : null;   // null, not 0 — guards divide-by-zero
  return {
    player_id,
    name,
    gp,
    losses,
    archived: Boolean(archived),
    games_not_lost: gp - losses,
    loss_rate,
    provisional: gp < MIN_GAMES_FOR_RATE,          // too small a sample to rank on rate
    beats_luck: loss_rate !== null && loss_rate < luckBaseline, // strictly under the chance rate
  };
}

// Both chains end in name, so order is deterministic regardless of sort stability.
function byMostNotLost(a, b) {
  return b.games_not_lost - a.games_not_lost   // more clean games first
      || a.loss_rate - b.loss_rate             // then lower loss rate
      || b.gp - a.gp                            // then bigger sample
      || a.name.localeCompare(b.name);         // then A→Z
}

function byHighestLossRate(a, b) {
  return b.loss_rate - a.loss_rate             // biggest loser first
      || b.gp - a.gp                            // then bigger sample (more proof of it)
      || a.games_not_lost - b.games_not_lost    // then fewer clean games
      || a.name.localeCompare(b.name);         // then A→Z
}

// rows -> { ranked: [...,rank], unranked: [...] }
// most_not_lost ranks anyone who has played; lowest_loss_rate ranks only non-provisional
// players (a 2-game run shouldn't crown or shame anyone). Archived players still count —
// their games happened — and carry the flag through for the UI to mark.
export function computeStandings(rows, mode, luckBaseline = LUCK_BASELINE) {
  const all = rows.map((r) => decorate(r, luckBaseline));
  const isEligible = mode === MODES.HIGHEST_LOSS_RATE
    ? (p) => p.gp >= MIN_GAMES_FOR_RATE
    : (p) => p.gp >= 1;
  const cmp = mode === MODES.HIGHEST_LOSS_RATE ? byHighestLossRate : byMostNotLost;
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

// v_sport_standings rows for ONE sport { player_id, name, archived, games, losses } ->
// { ranked, unranked }, biggest loser first, on the 2-side (50%) luck baseline. A racquet game
// has exactly 2 sides, so "beats luck" is under 50%. Reuses the card ranking, just re-based.
export function computeSportStandings(rows) {
  const mapped = rows.map((r) => ({
    player_id: r.player_id, name: r.name, archived: r.archived,
    gp: r.games, losses: r.losses,
  }));
  return computeStandings(mapped, MODES.HIGHEST_LOSS_RATE, LUCK_BASELINE_SPORT);
}

// v_daily_losses rows for ONE date { name, losses } -> the name(s) with the most losses that day,
// across every game type ([] if none). This is the combined "Loser of the Day".
export function biggestLoserToday(rows) {
  const max = rows.reduce((m, r) => Math.max(m, r.losses ?? 0), 0);
  if (max <= 0) return [];
  return rows.filter((r) => r.losses === max).map((r) => r.name).sort(alpha);
}

// Padel Americano leaderboard, LOTD-flavoured: rank by FEWEST average points per round (biggest
// loser first). Tie-break: worst point difference, then more rounds, then name. rows come from
// v_padel_standings { player_id, name, archived, rounds, points_for, points_against }. Provisional
// below MIN_GAMES_FOR_RATE rounds (a couple of rounds shouldn't crown anyone).
// `minRounds` is the sample floor to be ranked (default MIN_GAMES_FOR_RATE for the all-time board).
// A single Americano night is a complete unit, so its live/summary standings pass minRounds = 1 —
// everyone who played at least one round is ranked.
export function computePadelStandings(rows, minRounds = MIN_GAMES_FOR_RATE) {
  const all = rows.map((r) => ({
    ...r,
    avg: r.rounds > 0 ? r.points_for / r.rounds : null,   // avg points per round; lower = worse
    point_diff: r.points_for - r.points_against,          // total point difference; lower = worse
    provisional: r.rounds < MIN_GAMES_FOR_RATE,
  }));
  const cmp = (a, b) =>
    (a.avg - b.avg)                    // fewest average points first
    || (a.point_diff - b.point_diff)  // then worst point difference (the "score" tie-break)
    || (b.rounds - a.rounds)          // then more rounds played (more proof)
    || a.name.localeCompare(b.name);
  const eligible = (p) => p.rounds >= minRounds;
  const ranked = all.filter(eligible).sort(cmp).map((p, i) => ({ ...p, rank: i + 1 }));
  const unranked = all.filter((p) => !eligible(p));
  return { ranked, unranked };
}

// sports_games rows + players + date -> { names, points } of the player(s) with the FEWEST padel
// points that day (among those who actually played padel that day). The padel "Loser of the Day".
export function fewestPointsPadelToday(sportsGames, players, dateStr) {
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const pts = new Map();
  for (const g of sportsGames) {
    if (g.sport !== 'padel' || g.game_date !== dateStr) continue;
    for (const [id, f] of [[g.a1, g.score_a], [g.a2, g.score_a], [g.b1, g.score_b], [g.b2, g.score_b]]) {
      if (id == null) continue;
      pts.set(id, (pts.get(id) ?? 0) + f);
    }
  }
  if (pts.size === 0) return { names: [], points: 0 };
  const min = Math.min(...pts.values());
  const names = [...pts.entries()].filter(([, v]) => v === min).map(([id]) => nameById.get(id) ?? '?').sort(alpha);
  return { names, points: min };
}

// games (newest-first, as loadBoard returns them) + a player id -> the player's *current*
// losing streak: how many of their most-recent consecutive games they lost. Games they
// didn't play are skipped; the streak ends at the first game they played but didn't lose.
// "Lagi apes" — someone who keeps losing every time they sit down.
export function losingStreak(games, playerId) {
  let streak = 0;
  for (const g of games) {
    if (![g.p1, g.p2, g.p3, g.p4].includes(playerId)) continue;
    if (g.loser === playerId) streak += 1;
    else break;
  }
  return streak;
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
