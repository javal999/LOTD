-- v4.0 — racquet sports (table tennis + padel) as a flat table beside the UNTOUCHED card game.
--
-- One game = one row: 2 sides of 1–2 players, a score, and a sport. Because it is one flat row,
-- CHECK constraints enforce every rule (valid score, no draw, distinct players, consistent side
-- shape) — the same structural guarantee that has kept the card standings perfect. No trigger, no
-- migration of existing data. The loser is derived at read time (the lower-scoring side); both
-- players on it take a loss.
--
-- Nothing in this file touches `games`, `players` data, `leaderboards`, or the card standings —
-- except one additive UNIQUE on players, required only as the target of the board-isolation FK.

-- Composite-FK target: lets sports_games require a player to belong to the game's own board.
alter table players add constraint players_id_board_uq unique (id, leaderboard_id);

create table sports_games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  sport          text   not null check (sport in ('tt_singles','tt_doubles','padel')),
  game_date      date   not null default current_date,
  -- Side A / Side B. a2,b2 null ⇒ singles; set ⇒ doubles. The lower-scoring side lost.
  a1  bigint not null,
  a2  bigint,
  b1  bigint not null,
  b2  bigint,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  created_at timestamptz not null default now(),

  -- No draws: TT wins by 2; padel's 21 is odd. A decisive score always has a lower side.
  constraint decisive check (score_a <> score_b),

  -- Both partners present, or neither (singles ⇔ both null).
  constraint side_shape check ((a2 is null) = (b2 is null)),
  -- Singles only for tt_singles; doubles for tt_doubles and padel.
  constraint shape_matches_sport check (
    (sport = 'tt_singles' and a2 is null) or
    (sport in ('tt_doubles','padel') and a2 is not null)
  ),

  -- Every named player distinct (nulls ignored). Covers all 6 pairs among a1,a2,b1,b2.
  constraint distinct_players check (
        a1 <> b1
    and (a2 is null or (a2 <> a1 and a2 <> b1 and (b2 is null or a2 <> b2)))
    and (b2 is null or (b2 <> a1 and b2 <> b1))
  ),

  -- Score legal for the sport. TT: first to 11, win by 2. Padel: two scores summing to 21.
  constraint valid_score check (
    case when sport = 'padel'
         then score_a + score_b = 21
         else (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
           or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
    end
  ),

  -- Loose timezone backstop, mirroring the card table; the Edge Function enforces "today" strictly.
  constraint game_date_not_future check (game_date <= current_date + 1),

  -- Board isolation: a game's players must belong to the game's own board (MATCH SIMPLE skips nulls).
  constraint sg_a1_board foreign key (a1, leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  constraint sg_a2_board foreign key (a2, leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  constraint sg_b1_board foreign key (b1, leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  constraint sg_b2_board foreign key (b2, leaderboard_id) references players (id, leaderboard_id) on delete restrict
);

create index sports_games_board_date_idx on sports_games (leaderboard_id, game_date);

-- RLS + grants mirror the card tables: anyone with the anon key may read; writes go through the
-- Edge Function (service_role) only.
alter table sports_games enable row level security;
create policy sports_games_public_read on sports_games for select to anon, authenticated using (true);
grant select on sports_games to anon, authenticated;
grant all    on sports_games to service_role;
