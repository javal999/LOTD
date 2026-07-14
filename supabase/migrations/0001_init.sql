-- LOTD schema (Epic 1). The 4-players/1-loser invariant is enforced structurally:
-- four NOT NULL player columns make "not 4 players" unrepresentable; one loser
-- column makes "2 losers" unrepresentable; CHECKs reject a repeated player or a
-- loser who wasn't at the table -- on both insert and update. RLS makes the public
-- anon key read-only; every write goes through the admin Edge Function using the
-- service_role key (which bypasses RLS). GP/L are tallied in the browser -- no view.

create table if not exists players (
  id   bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists seasons (
  id         bigint generated always as identity primary key,
  name       text not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one active season at a time (partial unique index on the "true" rows).
create unique index if not exists one_active_season on seasons (is_active) where is_active;

create table if not exists games (
  id        bigint generated always as identity primary key,
  season_id bigint not null references seasons(id),
  p1        bigint not null references players(id),
  p2        bigint not null references players(id),
  p3        bigint not null references players(id),
  p4        bigint not null references players(id),
  loser     bigint not null references players(id),
  played_at timestamptz not null default now(),
  constraint players_distinct check (
    p1 <> p2 and p1 <> p3 and p1 <> p4 and p2 <> p3 and p2 <> p4 and p3 <> p4
  ),
  constraint loser_at_table check (loser in (p1, p2, p3, p4))
);

create index if not exists games_season_played_idx on games (season_id, played_at);

-- Row-level security: anyone with the anon key may SELECT; nobody may write with it.
-- The Edge Function's service_role key bypasses RLS, so writes still work there.
alter table players enable row level security;
alter table seasons enable row level security;
alter table games   enable row level security;

create policy "public read players" on players for select using (true);
create policy "public read seasons" on seasons for select using (true);
create policy "public read games"   on games   for select using (true);
-- No insert/update/delete policies for anon => those operations are denied by default.

-- Table privileges. RLS gates *rows*; these grants gate *table access*, and both are
-- needed. anon/authenticated get SELECT only -> with the read policies above they can
-- read, and with no write grant AND no write policy they cannot write. service_role
-- (used by the admin Edge Function) bypasses RLS and gets full access for writes.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.players, public.seasons, public.games to anon, authenticated;
grant all    on public.players, public.seasons, public.games to service_role;
