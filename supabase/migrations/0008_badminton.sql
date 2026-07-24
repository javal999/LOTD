-- Badminton reuses the racquet table — it's table tennis's scoring shape (first to a target, win by
-- 2) with target 21 and a cap at 30 (at 29–29 the next point wins 30–29). Adds bd_singles/bd_doubles.
-- Three CHECKs widen to include it; everything else (sides, scores, standings, log flow) is reused.

-- the board can now be a badminton board too
alter table leaderboards drop constraint leaderboards_game_types_valid;
alter table leaderboards add constraint leaderboards_game_types_valid check (
  cardinality(game_types) >= 1
  and game_types <@ array['cards','tt_singles','tt_doubles','padel','bd_singles','bd_doubles']::text[]
);

alter table sports_games drop constraint sports_games_sport_check;
alter table sports_games add constraint sports_games_sport_check
  check (sport in ('tt_singles','tt_doubles','padel','bd_singles','bd_doubles'));

alter table sports_games drop constraint shape_matches_sport;
alter table sports_games add constraint shape_matches_sport check (
  (sport in ('tt_singles','bd_singles') and a2 is null) or
  (sport in ('tt_doubles','padel','bd_doubles') and a2 is not null)
);

alter table sports_games drop constraint valid_score;
alter table sports_games add constraint valid_score check (
  case
    when sport = 'padel' then score_a + score_b = 21
    when sport in ('bd_singles','bd_doubles') then
      -- 21, win by 2, capped at 30 (30–29 is a legal 1-point win)
         (greatest(score_a,score_b) = 21 and least(score_a,score_b) <= 19)
      or (greatest(score_a,score_b) > 21 and greatest(score_a,score_b) <= 30 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
      or (greatest(score_a,score_b) = 30 and least(score_a,score_b) = 29)
    else  -- table tennis: first to 11, win by 2, no cap
         (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
      or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
  end
);
