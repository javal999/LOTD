-- v4 — Table-tennis Americano. A twin of padel: 2v2 doubles, each round played to a fixed
-- points_target and split, with the same session / rotation / individual-points machinery. It's
-- mechanically identical to padel, but kept as its own sport value so exports and data stay honest
-- (it IS table tennis, played Americano-style). "Americano sports" below = padel + tt_americano.

-- 1) New sport value.
alter table sports_games drop constraint sports_games_sport_check;
alter table sports_games add constraint sports_games_sport_check
  check (sport in ('tt_singles','tt_doubles','padel','bd_singles','bd_doubles','tt_americano'));

-- 2) Doubles shape (two players per side), like padel / tt_doubles.
alter table sports_games drop constraint shape_matches_sport;
alter table sports_games add constraint shape_matches_sport check (
  (sport in ('tt_singles','bd_singles') and a2 is null) or
  (sport in ('tt_doubles','padel','bd_doubles','tt_americano') and a2 is not null)
);

-- 3) Fixed-total scoring: the two scores must sum to the board's points_target, like padel.
alter table sports_games drop constraint valid_score;
alter table sports_games add constraint valid_score check (
  case
    when sport in ('padel','tt_americano') then points_target is not null and score_a + score_b = points_target
    when sport in ('bd_singles','bd_doubles') then
         (greatest(score_a,score_b) = 21 and least(score_a,score_b) <= 19)
      or (greatest(score_a,score_b) > 21 and greatest(score_a,score_b) <= 30 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
      or (greatest(score_a,score_b) = 30 and least(score_a,score_b) = 29)
    else  -- table tennis (classic): first to 11, win by 2
         (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
      or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
  end
);

-- 4) points_target belongs to the Americano sports only.
alter table sports_games drop constraint points_target_only_padel;
alter table sports_games add constraint points_target_americano_only
  check (points_target is null or sport in ('padel','tt_americano'));

-- 5) A session round may be padel or tt_americano.
alter table sports_games drop constraint session_only_padel;
alter table sports_games add constraint session_only_americano
  check (session_id is null or sport in ('padel','tt_americano'));

-- 6) Allow the new game type on a board.
alter table leaderboards drop constraint leaderboards_game_types_valid;
alter table leaderboards add constraint leaderboards_game_types_valid check (
  cardinality(game_types) >= 1
  and game_types <@ array['cards','tt_singles','tt_doubles','padel','bd_singles','bd_doubles','tt_americano']
);

-- 7) The individual-points view now covers every Americano sport. Name kept (v_padel_standings) so the
--    client select and the rest of the app are untouched — it's the "Americano points" view.
create or replace view v_padel_standings with (security_invoker = true) as
with sides as (
  select leaderboard_id, a1 as player_id, score_a as pf, score_b as pa from sports_games where sport in ('padel','tt_americano')
  union all select leaderboard_id, a2, score_a, score_b from sports_games where sport in ('padel','tt_americano') and a2 is not null
  union all select leaderboard_id, b1, score_b, score_a from sports_games where sport in ('padel','tt_americano')
  union all select leaderboard_id, b2, score_b, score_a from sports_games where sport in ('padel','tt_americano') and b2 is not null
)
select s.leaderboard_id, s.player_id, p.name, p.archived,
       count(*)::int     as rounds,
       sum(s.pf)::int    as points_for,
       sum(s.pa)::int    as points_against
from sides s
join players p on p.id = s.player_id
group by s.leaderboard_id, s.player_id, p.name, p.archived;
