-- Seed the fixed group and the first season. Idempotent (safe to re-run).
insert into players (name) values ('Ade'), ('Bima'), ('Citra'), ('Dewi')
  on conflict (name) do nothing;

-- Add occasional players the same way, e.g.:
--   insert into players (name) values ('Eka'), ('Fajar') on conflict (name) do nothing;

insert into seasons (name, is_active)
select 'Season 1', true
where not exists (select 1 from seasons where is_active);
