-- Prove the standings views aggregate correctly across cards + racquet.
-- Run AFTER 0003 + 0004. Self-verifying; leaves no data behind.
--
-- Scenario on a fresh board (P1..P4):
--   Cards:  game1 loser=P1, game2 loser=P2   (each of P1..P4 plays 2 card games)
--   TT:     P1 11-7 P2                         (P2 loses)
--   Padel:  A(P1,P2) 13-8 B(P3,P4)             (P3 & P4 lose)
--
-- Expected v_sport_standings (games/losses):
--   cards:  P1 2/1  P2 2/1  P3 2/0  P4 2/0
--   tt:     P1 1/0  P2 1/1  (P3,P4 absent)
--   padel:  P1 1/0  P2 1/0  P3 1/1  P4 1/1
-- Expected v_daily_losses today: P1=1, P2=2 (card+TT), P3=1, P4=1  → Loser of the Day = P2.

\set ON_ERROR_STOP on

create temp table results (label text, expected text, got text, ok boolean) on commit preserve rows;

create function pg_temp.chk(p_label text, p_actual text, p_expected text) returns void as $$
begin
  insert into results values (p_label, p_expected, coalesce(p_actual,'(none)'),
                              coalesce(p_actual,'(none)') = p_expected);
end;
$$ language plpgsql;

do $$
declare la bigint; p1 bigint; p2 bigint; p3 bigint; p4 bigint;
begin
  insert into leaderboards(name) values ('SpikeViews') returning id into la;
  insert into players(leaderboard_id,name) values (la,'P1') returning id into p1;
  insert into players(leaderboard_id,name) values (la,'P2') returning id into p2;
  insert into players(leaderboard_id,name) values (la,'P3') returning id into p3;
  insert into players(leaderboard_id,name) values (la,'P4') returning id into p4;

  insert into games(leaderboard_id,p1,p2,p3,p4,loser) values (la,p1,p2,p3,p4,p1);
  insert into games(leaderboard_id,p1,p2,p3,p4,loser) values (la,p1,p2,p3,p4,p2);
  insert into sports_games(leaderboard_id,sport,a1,b1,score_a,score_b)       values (la,'tt_singles',p1,p2,11,7);
  insert into sports_games(leaderboard_id,sport,a1,a2,b1,b2,score_a,score_b) values (la,'padel',p1,p2,p3,p4,13,8);

  -- per-sport standings
  perform pg_temp.chk('cards P1', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='cards' and player_id=p1), '2/1');
  perform pg_temp.chk('cards P2', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='cards' and player_id=p2), '2/1');
  perform pg_temp.chk('cards P3', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='cards' and player_id=p3), '2/0');
  perform pg_temp.chk('tt P1',    (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='tt_singles' and player_id=p1), '1/0');
  perform pg_temp.chk('tt P2',    (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='tt_singles' and player_id=p2), '1/1');
  perform pg_temp.chk('tt P3 absent', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='tt_singles' and player_id=p3), '(none)');
  perform pg_temp.chk('padel P1', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='padel' and player_id=p1), '1/0');
  perform pg_temp.chk('padel P2', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='padel' and player_id=p2), '1/0');
  perform pg_temp.chk('padel P3', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='padel' and player_id=p3), '1/1');
  perform pg_temp.chk('padel P4', (select games||'/'||losses from v_sport_standings where leaderboard_id=la and sport='padel' and player_id=p4), '1/1');

  -- daily losses (today)
  perform pg_temp.chk('daily P1', (select losses::text from v_daily_losses where leaderboard_id=la and game_date=current_date and player_id=p1), '1');
  perform pg_temp.chk('daily P2 (card+TT)', (select losses::text from v_daily_losses where leaderboard_id=la and game_date=current_date and player_id=p2), '2');
  perform pg_temp.chk('daily P3', (select losses::text from v_daily_losses where leaderboard_id=la and game_date=current_date and player_id=p3), '1');
  perform pg_temp.chk('Loser of the Day is P2',
    (select player_id::text from v_daily_losses where leaderboard_id=la and game_date=current_date order by losses desc, player_id limit 1),
    p2::text);
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, label, expected, got
from results order by ok, label;

-- cleanup (sports_games + games reference players via RESTRICT → delete them first)
delete from sports_games where leaderboard_id in (select id from leaderboards where name like 'SpikeViews%');
delete from games         where leaderboard_id in (select id from leaderboards where name like 'SpikeViews%');
delete from players       where leaderboard_id in (select id from leaderboards where name like 'SpikeViews%');
delete from leaderboards  where name like 'SpikeViews%';

do $$
declare npass int; nfail int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into npass, nfail from results;
  raise notice '──────────────────────────────────────────';
  raise notice '  standings views: % passed, % failed (of %)', npass, nfail, npass + nfail;
  raise notice '──────────────────────────────────────────';
  if nfail > 0 then raise exception '% view assertion(s) FAILED', nfail; end if;
end $$;
