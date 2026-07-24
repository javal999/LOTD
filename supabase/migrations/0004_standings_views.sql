-- v4.0 — read-only standings views. These never modify data; the card `games` table and its own
-- `v_standings` are untouched. Cards are folded in as sport='cards' so one view drives every
-- per-sport table, and the daily "Loser of the Day" sums losses across cards + racquet.
--
-- Loss rate itself (and the provisional threshold, and "beats luck") stays in the frontend
-- (ranking.mjs), exactly as for cards today — the views expose raw games/losses only, with the
-- per-sport luck baseline derivable from `sport`. This keeps the card ranking byte-identical.

-- 1) One row per (racquet game, player), tagging whether that player LOST (lower-scoring side).
--    a2/b2 are null in singles and simply drop out. `decisive` guarantees a strict lower side.
create view v_sport_participation with (security_invoker = true) as
select
  g.id            as game_id,
  g.leaderboard_id,
  g.sport,
  g.game_date,
  part.player_id,
  case when part.side = 'A' then g.score_a < g.score_b
       else                       g.score_b < g.score_a end as lost
from sports_games g
cross join lateral (values
    (g.a1, 'A'), (g.a2, 'A'), (g.b1, 'B'), (g.b2, 'B')
) as part(player_id, side)
where part.player_id is not null;

-- 2) Per-player, per-sport standings. Cards come straight from v_standings (so the card numbers are
--    identical by construction); each racquet sport aggregates participation. Racquet standings list
--    only players who actually played that sport (a 0-game player is absent — no divide-by-zero);
--    cards keep the full roster, including 0-game players, exactly as v_standings does today.
create view v_sport_standings with (security_invoker = true) as
  select leaderboard_id, 'cards'::text as sport, player_id, name, archived,
         gp as games, losses
  from v_standings
union all
  select sp.leaderboard_id, sp.sport, sp.player_id, p.name, p.archived,
         count(*)::int                          as games,
         count(*) filter (where sp.lost)::int   as losses
  from v_sport_participation sp
  join players p on p.id = sp.player_id
  group by sp.leaderboard_id, sp.sport, sp.player_id, p.name, p.archived;

-- 3) Losses per player per day, across cards AND racquet — the "Loser of the Day" source.
--    The frontend filters to a date and takes the max (ties → all tied names).
create view v_daily_losses with (security_invoker = true) as
with card_losses as (
  select leaderboard_id, game_date, loser as player_id, count(*)::int as losses
  from games
  group by leaderboard_id, game_date, loser
),
sport_losses as (
  select leaderboard_id, game_date, player_id, count(*)::int as losses
  from v_sport_participation
  where lost
  group by leaderboard_id, game_date, player_id
),
combined as (
  select * from card_losses
  union all
  select * from sport_losses
)
select c.leaderboard_id, c.game_date, c.player_id, p.name, sum(c.losses)::int as losses
from combined c
join players p on p.id = c.player_id
group by c.leaderboard_id, c.game_date, c.player_id, p.name;

grant select on v_sport_participation, v_sport_standings, v_daily_losses to anon, authenticated;
