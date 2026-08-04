-- Daily Reveal — a board hides its standings until a set hour (device-local), then flips open. The
-- hour is per-board so different groups can reveal at different times; 17 = 5pm by default. 0 opts a
-- board out of hiding (always revealed). The gate itself is enforced in the client (a soft curtain);
-- this column is just the configured hour.

alter table leaderboards
  add column reveal_hour int not null default 17 check (reveal_hour between 0 and 23);
