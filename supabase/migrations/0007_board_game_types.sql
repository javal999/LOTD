-- Each leaderboard declares which games it's for, so a card board doesn't show a racquet button
-- and a padel board doesn't show the card flow. Racquet is opt-in: existing boards default to
-- CARDS ONLY (the classic game), and you add table tennis / padel when creating a new board (or
-- via Board settings). So the current Seven P3 stays a pure card board — no racquet button.
alter table leaderboards
  add column game_types text[] not null default array['cards']::text[];

alter table leaderboards
  add constraint leaderboards_game_types_valid check (
    cardinality(game_types) >= 1   -- cardinality is 0 for an empty array (array_length is NULL)
    and game_types <@ array['cards','tt_singles','tt_doubles','padel']::text[]
  );
