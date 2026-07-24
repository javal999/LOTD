-- Padel Americano: the round length is chosen per board and adjustable, and padel gets an
-- individual points leaderboard. A padel round's two scores must sum to the board's target
-- (snapshotted onto each game so changing the board later never invalidates old rounds).

-- Board's round length (padel boards only; other boards leave it null).
alter table leaderboards
  add column points_target int check (points_target is null or points_target between 6 and 99);

-- Snapshotted onto each padel game. Non-padel games leave it null.
alter table sports_games
  add column points_target int check (points_target is null or points_target between 6 and 99),
  add constraint points_target_only_padel check (points_target is null or sport = 'padel');

-- Padel score now validates against the game's own target (was hard-coded 21). Requires the
-- target to be present for padel rows. TT/badminton branches unchanged.
alter table sports_games drop constraint valid_score;
alter table sports_games add constraint valid_score check (
  case
    when sport = 'padel' then points_target is not null and score_a + score_b = points_target
    when sport in ('bd_singles','bd_doubles') then
         (greatest(score_a,score_b) = 21 and least(score_a,score_b) <= 19)
      or (greatest(score_a,score_b) > 21 and greatest(score_a,score_b) <= 30 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
      or (greatest(score_a,score_b) = 30 and least(score_a,score_b) = 29)
    else  -- table tennis: first to 11, win by 2
         (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
      or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
  end
);

-- Individual padel standings: each player's points for/against and rounds across padel games.
-- One row per (player, game) side; the frontend ranks (fewest average points = biggest loser,
-- tie-break by point difference). Raw aggregates only, so the ranking rule stays a frontend choice.
create view v_padel_standings with (security_invoker = true) as
with sides as (
  select leaderboard_id, a1 as player_id, score_a as pf, score_b as pa from sports_games where sport = 'padel'
  union all select leaderboard_id, a2, score_a, score_b from sports_games where sport = 'padel' and a2 is not null
  union all select leaderboard_id, b1, score_b, score_a from sports_games where sport = 'padel'
  union all select leaderboard_id, b2, score_b, score_a from sports_games where sport = 'padel' and b2 is not null
)
select s.leaderboard_id, s.player_id, p.name, p.archived,
       count(*)::int     as rounds,
       sum(s.pf)::int    as points_for,
       sum(s.pa)::int    as points_against
from sides s
join players p on p.id = s.player_id
group by s.leaderboard_id, s.player_id, p.name, p.archived;

grant select on v_padel_standings to anon, authenticated;
