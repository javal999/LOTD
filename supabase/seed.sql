-- v3 seed: one leaderboard with four placeholder players. Rename/replace them in the
-- app's player management UI. Idempotent (safe to re-run).
insert into leaderboards (name) values ('Leaderboard 1')
  on conflict (name) do nothing;

insert into players (leaderboard_id, name)
select l.id, v.name
from leaderboards l
cross join (values ('Player1'), ('Player2'), ('Player3'), ('Player4')) as v(name)
where l.name = 'Leaderboard 1'
on conflict (leaderboard_id, name) do nothing;
