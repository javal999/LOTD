-- Regression: prove padel_sessions constraints + the sports_games.session_id composite FK behave.
-- Run AFTER 0010. Self-verifying (PASS/FAIL table + a gate that RAISEs on any wrong case). No leftovers.
--
--   docker exec -i supabase_db_LOTD psql -U postgres -d postgres -f - < supabase/tests/padel_sessions_checks.sql

\set ON_ERROR_STOP on

create temp table results (label text, expected text, got text, ok boolean) on commit preserve rows;

create function pg_temp.expect(p_label text, p_accept boolean, p_stmt text) returns void as $$
declare accepted boolean;
begin
  begin execute p_stmt; accepted := true;
  exception when others then accepted := false;
  end;
  insert into results values (p_label,
    case when p_accept then 'accept' else 'reject' end,
    case when accepted then 'accept' else 'reject' end,
    accepted = p_accept);
end;
$$ language plpgsql;

do $$
declare
  la bigint; lb bigint;
  p1 bigint; p2 bigint; p3 bigint; p4 bigint;
  sess_a bigint; sess_b bigint;
begin
  insert into leaderboards(name, game_types, points_target) values ('SpikeA', array['padel'], 21) returning id into la;
  insert into leaderboards(name, game_types, points_target) values ('SpikeB', array['padel'], 21) returning id into lb;
  insert into players(leaderboard_id,name) values (la,'A1') returning id into p1;
  insert into players(leaderboard_id,name) values (la,'A2') returning id into p2;
  insert into players(leaderboard_id,name) values (la,'A3') returning id into p3;
  insert into players(leaderboard_id,name) values (la,'A4') returning id into p4;

  -- ── padel_sessions constraints ────────────────────────────────────────
  perform pg_temp.expect('session: 4-player roster ok', true,
    format('insert into padel_sessions(leaderboard_id,roster,courts,rounds) values(%s,array[%s,%s,%s,%s],1,3)', la, p1, p2, p3, p4));
  perform pg_temp.expect('session: roster under 4 rejected', false,
    format('insert into padel_sessions(leaderboard_id,roster,courts,rounds) values(%s,array[%s,%s,%s],1,3)', la, p1, p2, p3));
  perform pg_temp.expect('session: courts 0 rejected', false,
    format('insert into padel_sessions(leaderboard_id,roster,courts,rounds) values(%s,array[%s,%s,%s,%s],0,3)', la, p1, p2, p3, p4));
  perform pg_temp.expect('session: courts 7 rejected', false,
    format('insert into padel_sessions(leaderboard_id,roster,courts,rounds) values(%s,array[%s,%s,%s,%s],7,3)', la, p1, p2, p3, p4));
  perform pg_temp.expect('session: rounds 0 rejected', false,
    format('insert into padel_sessions(leaderboard_id,roster,courts,rounds) values(%s,array[%s,%s,%s,%s],1,0)', la, p1, p2, p3, p4));

  -- Two real sessions to link against.
  insert into padel_sessions(leaderboard_id,roster,courts,rounds) values (la, array[p1,p2,p3,p4],1,3) returning id into sess_a;
  insert into padel_sessions(leaderboard_id,roster,courts,rounds) values (lb, array[p1,p2,p3,p4],1,3) returning id into sess_b;

  -- ── sports_games.session_id composite FK ──────────────────────────────
  perform pg_temp.expect('round links to same-board session', true,
    format('insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b,points_target,session_id) values(%s,''padel'',%s,%s,%s,%s,13,8,21,%s)', la, p1, p2, p3, p4, sess_a));
  perform pg_temp.expect('round links to other-board session rejected', false,
    format('insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b,points_target,session_id) values(%s,''padel'',%s,%s,%s,%s,13,8,21,%s)', la, p1, p2, p3, p4, sess_b));
  perform pg_temp.expect('round links to non-existent session rejected', false,
    format('insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b,points_target,session_id) values(%s,''padel'',%s,%s,%s,%s,13,8,21,999999)', la, p1, p2, p3, p4));
  perform pg_temp.expect('one-off round with null session ok', true,
    format('insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b,points_target) values(%s,''padel'',%s,%s,%s,%s,13,8,21)', la, p1, p2, p3, p4));

  -- session_only_padel: a TT round must not carry a session id.
  perform pg_temp.expect('tt round with a session id rejected', false,
    format('insert into sports_games(leaderboard_id,sport,a1,b1,score_a,score_b,session_id) values(%s,''tt_singles'',%s,%s,11,7,%s)', la, p1, p2, sess_a));
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, label, expected, got
from results order by ok, label;

-- Clean up (sports_games → padel_sessions → players → leaderboards) before the gate.
delete from sports_games  where leaderboard_id in (select id from leaderboards where name like 'Spike%');
delete from padel_sessions where leaderboard_id in (select id from leaderboards where name like 'Spike%');
delete from players       where leaderboard_id in (select id from leaderboards where name like 'Spike%');
delete from leaderboards  where name like 'Spike%';

do $$
declare npass int; nfail int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into npass, nfail from results;
  raise notice '──────────────────────────────────────────';
  raise notice '  padel_sessions checks: % passed, % failed (of %)', npass, nfail, npass + nfail;
  raise notice '──────────────────────────────────────────';
  if nfail > 0 then raise exception '% session-constraint test(s) FAILED', nfail; end if;
end $$;
