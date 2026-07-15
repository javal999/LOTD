-- v3 (PRD v3 / TRD 2026-001): leaderboards replace seasons.
--
-- Destructive by design: v2 shipped with 0 games logged, so there is no history worth
-- carrying. We drop the v2 model rather than bend it into the new shape.
--
-- Model: a leaderboard is the top-level tracker. Players and games belong to exactly one
-- leaderboard (CASCADE). A game is structurally 4 distinct players + 1 loser who was at
-- the table, on a date that can't be in the future. Players who have games can never be
-- hard-deleted (FK RESTRICT) -- the app archives them instead.

drop view  if exists v_standings;
drop table if exists games;
drop table if exists players;
drop table if exists seasons;   -- v2 model, replaced by leaderboards

create table leaderboards (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table players (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  name           text not null,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (leaderboard_id, name)
);

create table games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  game_date      date not null default current_date,
  -- RESTRICT: a player with games cannot be hard-deleted; the admin archives instead.
  p1    bigint not null references players(id) on delete restrict,
  p2    bigint not null references players(id) on delete restrict,
  p3    bigint not null references players(id) on delete restrict,
  p4    bigint not null references players(id) on delete restrict,
  loser bigint not null references players(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint players_distinct check (
    p1 <> p2 and p1 <> p3 and p1 <> p4 and p2 <> p3 and p2 <> p4 and p3 <> p4
  ),
  constraint loser_at_table check (loser in (p1, p2, p3, p4)),
  -- Loose guard only: timezone slack. The Edge Function enforces "not after the
  -- admin's local today" strictly, because only the client knows its local date.
  constraint game_date_not_future check (game_date <= current_date + 1)
);

create index games_leaderboard_date_idx on games (leaderboard_id, game_date);
create index games_leaderboard_created_idx on games (leaderboard_id, created_at);
create index players_leaderboard_idx on players (leaderboard_id);

-- Per-player aggregate, scoped by leaderboard. gp/losses only -- loss rate, rank, and
-- the 5-game threshold are computed in JS so they stay unit-testable without a database.
-- security_invoker: the view runs as the querying role, so RLS on the base tables applies.
create view v_standings with (security_invoker = true) as
select
  p.leaderboard_id,
  p.id       as player_id,
  p.name,
  p.archived,
  count(g.id)::int                                  as gp,
  count(g.id) filter (where g.loser = p.id)::int    as losses
from players p
left join games g
  on g.leaderboard_id = p.leaderboard_id
 and p.id in (g.p1, g.p2, g.p3, g.p4)
group by p.leaderboard_id, p.id, p.name, p.archived;

-- RLS: anyone with the anon key may read; nobody may write with it. All writes go through
-- the admin Edge Function using the service_role key, which bypasses RLS.
alter table leaderboards enable row level security;
alter table players      enable row level security;
alter table games        enable row level security;

create policy "public read leaderboards" on leaderboards for select using (true);
create policy "public read players"      on players      for select using (true);
create policy "public read games"        on games        for select using (true);
-- No insert/update/delete policies for anon => denied by default.

-- Table privileges. RLS gates rows; these gate table access -- both are required.
grant usage  on schema public to anon, authenticated, service_role;
grant select on public.leaderboards, public.players, public.games, public.v_standings
  to anon, authenticated;
grant all    on public.leaderboards, public.players, public.games to service_role;
grant select on public.v_standings to service_role;
