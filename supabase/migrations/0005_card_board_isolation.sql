-- Close the board-leak on the CARD games table. Verified 2026-07-21 that a card game could contain
-- a player from another board, and v_standings then silently dropped that player. sports_games was
-- born closed (0003); this brings the card table to the same guarantee via composite FKs.
--
-- players already has unique(id, leaderboard_id) from 0003. Existing card games all have same-board
-- players (the Edge Function has always enforced it), so these constraints validate cleanly.

alter table games
  add constraint games_p1_board    foreign key (p1,    leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  add constraint games_p2_board    foreign key (p2,    leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  add constraint games_p3_board    foreign key (p3,    leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  add constraint games_p4_board    foreign key (p4,    leaderboard_id) references players (id, leaderboard_id) on delete restrict,
  add constraint games_loser_board foreign key (loser, leaderboard_id) references players (id, leaderboard_id) on delete restrict;
