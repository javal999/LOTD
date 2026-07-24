-- Spike / regression: prove every CHECK on sports_games rejects exactly what it should.
-- Run AFTER applying 0003_sports_games.sql. Self-verifying: prints a table + a PASS/FAIL summary,
-- and RAISEs (non-zero exit) if any case is wrong. Leaves no data behind.
--
--   docker exec -i supabase_db_LOTD psql -U postgres -d postgres -f - < supabase/tests/sports_games_checks.sql

\set ON_ERROR_STOP on

create temp table results (label text, expected text, got text, ok boolean) on commit preserve rows;

-- Try one insert; record whether the DB accepted it vs what we expected. Never aborts the run.
create function pg_temp.expect(p_label text, p_accept boolean, p_stmt text) returns void as $$
declare accepted boolean;
begin
  begin
    execute p_stmt;
    accepted := true;
  exception when others then
    accepted := false;   -- any constraint violation counts as a reject
  end;
  insert into results values (
    p_label,
    case when p_accept  then 'accept' else 'reject' end,
    case when accepted  then 'accept' else 'reject' end,
    accepted = p_accept
  );
end;
$$ language plpgsql;

do $$
declare
  la bigint; lb bigint;
  p1 bigint; p2 bigint; p3 bigint; p4 bigint; pb bigint;
  -- template: (leaderboard, sport, a1, a2, b1, b2, score_a, score_b)
  ins text := 'insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b) values';
begin
  insert into leaderboards(name) values ('SpikeA') returning id into la;
  insert into leaderboards(name) values ('SpikeB') returning id into lb;
  insert into players(leaderboard_id,name) values (la,'A1') returning id into p1;
  insert into players(leaderboard_id,name) values (la,'A2') returning id into p2;
  insert into players(leaderboard_id,name) values (la,'A3') returning id into p3;
  insert into players(leaderboard_id,name) values (la,'A4') returning id into p4;
  insert into players(leaderboard_id,name) values (lb,'B1') returning id into pb;

  -- ── Table tennis: first to 11, win by 2 ───────────────────────────────
  perform pg_temp.expect('tt 11-7 clean win',        true,  format('%s(%s,''tt_singles'',%s,null,%s,null,11,7)',  ins, la, p1, p2));
  perform pg_temp.expect('tt 11-9 clean win',        true,  format('%s(%s,''tt_singles'',%s,null,%s,null,11,9)',  ins, la, p1, p2));
  perform pg_temp.expect('tt 7-11 loser typed first',true,  format('%s(%s,''tt_singles'',%s,null,%s,null,7,11)',  ins, la, p1, p2));
  perform pg_temp.expect('tt 12-10 deuce',           true,  format('%s(%s,''tt_singles'',%s,null,%s,null,12,10)', ins, la, p1, p2));
  perform pg_temp.expect('tt 15-13 deuce',           true,  format('%s(%s,''tt_singles'',%s,null,%s,null,15,13)', ins, la, p1, p2));
  perform pg_temp.expect('tt 23-21 deuce',           true,  format('%s(%s,''tt_singles'',%s,null,%s,null,23,21)', ins, la, p1, p2));
  perform pg_temp.expect('tt 11-10 must win by 2',   false, format('%s(%s,''tt_singles'',%s,null,%s,null,11,10)', ins, la, p1, p2));
  perform pg_temp.expect('tt 12-9 game already over',false, format('%s(%s,''tt_singles'',%s,null,%s,null,12,9)',  ins, la, p1, p2));
  perform pg_temp.expect('tt 13-10 game already over',false,format('%s(%s,''tt_singles'',%s,null,%s,null,13,10)', ins, la, p1, p2));
  perform pg_temp.expect('tt 12-11 margin 1',        false, format('%s(%s,''tt_singles'',%s,null,%s,null,12,11)', ins, la, p1, p2));
  perform pg_temp.expect('tt 10-8 nobody reached 11',false, format('%s(%s,''tt_singles'',%s,null,%s,null,10,8)',  ins, la, p1, p2));
  perform pg_temp.expect('tt 11-11 tie',             false, format('%s(%s,''tt_singles'',%s,null,%s,null,11,11)', ins, la, p1, p2));

  -- ── Padel: two scores summing to 21 ───────────────────────────────────
  perform pg_temp.expect('padel 13-8 sums 21',       true,  format('%s(%s,''padel'',%s,%s,%s,%s,13,8)', ins, la, p1, p2, p3, p4));
  perform pg_temp.expect('padel 11-10 sums 21',      true,  format('%s(%s,''padel'',%s,%s,%s,%s,11,10)',ins, la, p1, p2, p3, p4));  -- INVALID as TT
  perform pg_temp.expect('padel 21-0 sums 21',       true,  format('%s(%s,''padel'',%s,%s,%s,%s,21,0)', ins, la, p1, p2, p3, p4));
  perform pg_temp.expect('padel 13-7 sums 20',       false, format('%s(%s,''padel'',%s,%s,%s,%s,13,7)', ins, la, p1, p2, p3, p4));
  perform pg_temp.expect('padel 14-8 sums 22',       false, format('%s(%s,''padel'',%s,%s,%s,%s,14,8)', ins, la, p1, p2, p3, p4));

  -- ── Side shape ────────────────────────────────────────────────────────
  perform pg_temp.expect('tt_singles with a partner',false, format('%s(%s,''tt_singles'',%s,%s,%s,null,11,7)', ins, la, p1, p2, p3));
  perform pg_temp.expect('tt_doubles missing partner',false,format('%s(%s,''tt_doubles'',%s,null,%s,null,11,7)',ins, la, p1, p3));
  perform pg_temp.expect('tt_doubles full valid',    true,  format('%s(%s,''tt_doubles'',%s,%s,%s,%s,11,7)', ins, la, p1, p2, p3, p4));
  perform pg_temp.expect('half-set sides (a2 set,b2 null)',false,format('%s(%s,''padel'',%s,%s,%s,null,13,8)', ins, la, p1, p2, p3));

  -- ── Distinct players ──────────────────────────────────────────────────
  perform pg_temp.expect('same player both sides',   false, format('%s(%s,''tt_singles'',%s,null,%s,null,11,7)', ins, la, p1, p1));
  perform pg_temp.expect('duplicate on one side',    false, format('%s(%s,''tt_doubles'',%s,%s,%s,%s,11,7)', ins, la, p1, p1, p3, p4));
  perform pg_temp.expect('partner equals an opponent',false,format('%s(%s,''padel'',%s,%s,%s,%s,13,8)', ins, la, p1, p2, p3, p2));

  -- ── Score/sport sanity ────────────────────────────────────────────────
  perform pg_temp.expect('negative score',           false, format('%s(%s,''tt_singles'',%s,null,%s,null,11,-1)', ins, la, p1, p2));
  perform pg_temp.expect('unknown sport',            false, format('%s(%s,''squash'',%s,null,%s,null,11,7)', ins, la, p1, p2));
  perform pg_temp.expect('future-dated game',        false,
    format('insert into sports_games(leaderboard_id,sport,a1,b1,score_a,score_b,game_date) values(%s,''tt_singles'',%s,%s,11,7,current_date+5)', la, p1, p2));

  -- ── Board isolation (composite FK) ────────────────────────────────────
  perform pg_temp.expect('opponent from another board', false, format('%s(%s,''tt_singles'',%s,null,%s,null,11,7)', ins, la, p1, pb));
  perform pg_temp.expect('cross-board padel partner',   false, format('%s(%s,''padel'',%s,%s,%s,%s,13,8)', ins, la, p1, p2, p3, pb));
end $$;

-- Report, failures first.
select case when ok then 'PASS' else 'FAIL' end as result, label, expected, got
from results order by ok, label;

-- Clean up test data (order: sports_games → players → leaderboards, because of RESTRICT FKs),
-- BEFORE the pass/fail gate so a failure never leaves rows behind.
delete from sports_games where leaderboard_id in (select id from leaderboards where name like 'Spike%');
delete from players        where leaderboard_id in (select id from leaderboards where name like 'Spike%');
delete from leaderboards   where name like 'Spike%';

do $$
declare npass int; nfail int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into npass, nfail from results;
  raise notice '──────────────────────────────────────────';
  raise notice '  sports_games CHECKs: % passed, % failed (of %)', npass, nfail, npass + nfail;
  raise notice '──────────────────────────────────────────';
  if nfail > 0 then
    raise exception '% CHECK-constraint test(s) FAILED', nfail;
  end if;
end $$;
