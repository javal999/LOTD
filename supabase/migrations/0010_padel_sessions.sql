-- v4 Phase B — Americano sessions. A "session" is one padel night: a fixed roster, a court count,
-- and a round target. The pairing schedule is a deterministic function of (roster order, courts,
-- rounds), so the client re-derives it on load and nothing about the pairings is stored here — only
-- the three inputs. Each padel round logged during the night carries session_id, so a session's
-- live standings and end-of-night summary are simply the games that point at it.

create table padel_sessions (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  game_date      date   not null default current_date,
  roster         bigint[] not null check (cardinality(roster) >= 4),
  courts         int    not null default 1 check (courts between 1 and 6),
  rounds         int    not null check (rounds between 1 and 60),
  created_at     timestamptz not null default now(),
  -- Composite-FK target so a round can only ever link to a session on its own board.
  constraint padel_sessions_id_board_uq unique (id, leaderboard_id)
);

create index padel_sessions_board_idx on padel_sessions (leaderboard_id, game_date);

-- Tie a logged padel round to its session. Nullable — a one-off round (the plain log flow) has none.
-- The composite FK forces the session onto the game's own board; ON DELETE SET NULL keeps the round
-- if its session is ever removed (the game and its points still count on the all-time board). Since
-- leaderboard_id is never null, MATCH SIMPLE enforces the FK exactly when session_id is set.
alter table sports_games add column session_id bigint;
alter table sports_games add constraint sg_session_board
  foreign key (session_id, leaderboard_id) references padel_sessions (id, leaderboard_id) on delete set null;

-- Only a padel round may belong to a session.
alter table sports_games add constraint session_only_padel
  check (session_id is null or sport = 'padel');

create index sports_games_session_idx on sports_games (session_id);

-- RLS + grants mirror the other tables: anyone with the anon key may read; writes go through the
-- Edge Function (service_role) only.
alter table padel_sessions enable row level security;
create policy padel_sessions_public_read on padel_sessions for select to anon, authenticated using (true);
grant select on padel_sessions to anon, authenticated;
grant all    on padel_sessions to service_role;
