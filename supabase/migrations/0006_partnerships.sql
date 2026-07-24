-- Partnership stats from doubles racquet games — the roast an event app can't build:
-- "you've never won a round with Sebas". Each doubles game has two pairs (side A, side B); a pair
-- "lost together" when their side had the lower score. Pairs are keyed low-id/high-id so (X,Y) and
-- (Y,X) are the same partnership. Singles are ignored (no partner).
create view v_partnerships with (security_invoker = true) as
with pairs as (
  select leaderboard_id, least(a1, a2) as player_a, greatest(a1, a2) as player_b,
         (score_a < score_b) as lost
  from sports_games where a2 is not null
  union all
  select leaderboard_id, least(b1, b2), greatest(b1, b2),
         (score_b < score_a)
  from sports_games where b2 is not null
)
select leaderboard_id, player_a, player_b,
       count(*)::int                        as games_together,
       count(*) filter (where lost)::int    as losses_together
from pairs
group by leaderboard_id, player_a, player_b;

grant select on v_partnerships to anon, authenticated;
