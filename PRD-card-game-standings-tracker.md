# PRD: Card game standings tracker

> **⚠️ Partly superseded (2026-07-21).** This describes v3 — the fixed 4-player/1-loser card game,
> which is still live and unchanged. Table tennis and padel are added by
> [PRD-v4-multi-format-games.md](PRD-v4-multi-format-games.md) as a *separate flat table beside* the
> card game (no migration, cards untouched). Build racquet features against v4, not this.

**Owner:** Product (acting senior PM)
**Status:** Draft v3 (council-reviewed + feature additions)
**Date:** 2026-07-14
**Deliverable type:** Requirements document (Markdown)

> v2 changes from v1: locked to strictly 4 players; switched to a hosted web app with shared data that stays consistent across devices; single admin writes, everyone else reads; promoted data persistence and export to P0; relabeled "wins"; fixed the sort tiebreak; defined "season"; added a data-integrity and social-risk section. These changes come from a 5-advisor council review (see the council report and transcript).
>
> v3 changes from v2 (see section 14 at the end): added multiple leaderboards, which replace the "season" concept; promoted in-UI player add/delete (with archive-on-delete) to P0; added dated game logging that defaults to today and blocks future dates; and added an all-time and daily "biggest loser" spotlight above the table, absorbing v2's "loser of the night". Sections 14.1 and 14.2 change the data model, so TRD-2026-001 and the build plan need matching updates (noted at the end of section 14).

---

## TL;DR

A hosted web page that tracks a fixed group of friends playing a 4-player card game where exactly 1 person loses each game. One admin logs every result. The same page, opened on any phone or laptop, always shows the current standings because the data lives in one shared store, not on a single device. The standings show games played, losses, "games not lost," and loss rate, and can be ranked two ways: most games not lost, and lowest loss rate. Logging a finished game takes under 10 seconds and 3 taps.

Two things the council flagged that this version fixes. First, the app only ever records a loss, so "wins" is really "games you did not lose." The table says that plainly. Second, the data has to survive a lost phone, so a shared store and an export are P0, not nice-to-haves.

---

## 1. Problem statement

A group of friends plays a 4-player card game regularly. Each game has exactly 1 loser and 3 non-losers. There is no record of results, so nobody knows who is actually ahead over weeks of play, arguments about "who loses the most" and "who is actually good" have no data behind them, and last week's results are already forgotten. The group wants a running scoreboard that one person updates in seconds and that anyone can open on their own device to see where they stand.

Who has this problem: a small fixed group of roughly 4 to 8 friends who play the same game repeatedly and care about bragging rights, not money. Cost of not solving it: no memory of results, weak rivalry, and inconsistent logging because a notes app or spreadsheet is too slow to update mid-session and awkward to share.

---

## 2. Scoring model

This is the core of the product, so it is defined before features.

**One game =** exactly 4 players at a table, exactly 1 marked as the loser. The other 3 are non-losers. This is a hard invariant. No game is ever stored with a player count other than 4 or a loser count other than 1.

Per-player stats, all derived from the game log:

| Stat | Definition | Notes |
|---|---|---|
| Games played (GP) | Games the player was one of the 4 | |
| Losses (L) | Games the player was the marked loser | The only fact the app records directly |
| Games not lost | GP − L | Shown instead of "wins" so nobody thinks it means "beat someone" |
| Loss rate | L ÷ GP, as a % | The skill signal. Lower is better |

**On the word "wins."** The group asked to see "wins." In a 4-player, 1-loser game, 3 people are non-losers every single game, so a "win" only means "you were not the loser," not "you beat someone." The table labels this column **Games not lost** and shows a one-line legend saying "a win is any game you did not lose." Because Games not lost = GP − L, it carries no information beyond GP and L. It stays because the group wants a positive number to look at, but loss rate is the real measure.

**Luck baseline.** In a 4-player game with 1 loser, pure chance gives each player a 25% loss rate. A loss rate under 25% is the honest bar for "better than luck." The standings mark this line and show a legend so a first-time viewer understands why 25% matters.

**Two ranking modes** (the admin or any viewer can toggle):

1. **Most games not lost** — sort by (GP − L) descending. Answers "who has the most clean games." Rewards showing up and not losing. A regular who plays 40 games outranks a strong player who played 10, by design.
2. **Highest loss rate** — sort by loss rate **descending**, among players who meet a minimum games threshold (fixed at 5 for v1). Answers "who loses most often per game." Normalizes for how often someone plays. Descending (changed 2026-07-15, was ascending) so rank 1 is the biggest loser — the same person the spotlight crowns. A board called Loser of the Day shouldn't put the best player on top.

**Important honesty note for the group.** These two rankings produce the same order whenever everyone has played the same number of games. They only diverge when attendance differs. If this group always plays with the same 4 people every night, one ranking is enough and the toggle is mostly cosmetic. The toggle earns its place only if attendance varies. This is called out so the group can decide whether they actually need both (see Open Questions).

**Rank column.** The standings show a position number (1, 2, 3, 4) for the active sort. This is each person's position that the group asked for. Players below the 5-game threshold are shown in a "not enough games yet" group and are not given a loss-rate rank (they still show all their raw numbers).

---

## 3. Goals

1. Log a finished game in under 10 seconds and at most 3 taps (the 4 players are pre-set, tap the loser, save).
2. Standings always reflect every logged game with GP, L, games not lost, loss rate, and rank, with no manual math.
3. Anyone in the group can open one shared URL on their own device and see the current standings, no login.
4. Data survives a lost or wiped device: it lives in a shared store and can be exported at any time.
5. A mis-logged game can be fixed in under 15 seconds without ever producing an illegal record (still 4 players, still 1 loser).
6. 90% of games the group plays get logged the same night.

## 4. Non-goals

1. **No money, betting, or payout tracking.** Bragging rights only. Stakes bring settlement logic this version will not handle.
2. **No per-hand or in-game scoring.** The unit is a finished game with 1 loser, not points inside a game.
3. **No player counts other than 4.** The model is fixed at 4 players, 1 loser. Other counts are not supported, not now and not as a setting.
4. **No per-user accounts or profiles.** There is no personal login. One admin writes; everyone else reads the same shared page. Access is controlled by a shared link plus an admin passcode, nothing more.
5. **No social feed, chat, or notifications.** The group already sits at the same table, so the product stays a plain scoreboard with no messaging layer.

---

## 5. Users and personas

- **The admin (scorekeeper).** The one person who logs every result and fixes mistakes. Writes are gated behind a passcode so only they can change data. Needs logging fast enough that it does not interrupt play.
- **The viewer (everyone else).** Any friend who opens the shared URL to check standings on their own phone. Read-only. Can switch the sort and see their rank, streak, and history, but cannot edit.
- **The occasional player.** Plays some nights, creating the small-sample problem. Placed in "not enough games yet" until they reach 5 games so a 2-game run does not crown or shame them.

---

## 6. User stories

Grouped by persona, ordered by priority.

**Admin**

- As the admin, I want to enter a passcode once to unlock editing, so only I can change results and viewers cannot.
- As the admin, I want to log a finished game by confirming the 4 players and tapping the 1 loser, so recording a result does not interrupt the next deal.
- As the admin, I want to undo the game I just logged in 1 tap, so a wrong tap is easy to reverse.
- As the admin, I want any edit or undo to be rejected if it would leave a game with a player count other than 4 or a loser count other than 1, so the data can never become illegal.
- As the admin, I want to export all data to a file, so a lost device never means lost history.
- As the admin, I want to start a new season, so the standings can reset while the old season stays viewable.

**Viewer**

- As a viewer, I want to open one link on my phone and see the current standings, so I do not need an account or the admin's device.
- As a viewer, I want the standings to reflect the latest logged game when I open or refresh the page, so I am never looking at stale numbers.
- As a viewer, I want to switch between "most games not lost" and "lowest loss rate," so I can see both the most active and the most skilled.
- As a viewer, I want to see the 25% luck line explained, so I know whether a loss rate beats chance.
- As a viewer, I want to see who lost the most tonight, so the session has a clear result.

**Occasional player**

- As an occasional player, I want to be shown in "not enough games yet" until I have 5 games, so I am judged fairly on a real sample.

---

## 7. Requirements

### P0 (must have, cannot ship without)

**7.1 Shared persistent storage across devices**
- All game data lives in one shared store (a hosted backend), not in a single browser.
- Opening the shared URL on any device shows the same current data.
- When a viewer opens or refreshes the page, they see the latest saved state.
- Writes come only from the admin (passcode-gated). Viewers never write.

*Acceptance criteria*
- Given the admin logs a game on their phone, when a viewer opens the URL on a different phone and refreshes, then they see that game reflected in the standings.
- Given a viewer has the page open, when they attempt any edit action, then the app blocks it because they are not in admin mode.

**7.2 Admin access (passcode, no accounts)**
- Editing is locked until the admin enters a shared passcode.
- The passcode unlocks logging, undo, edit, export, and season reset.
- No usernames, no per-user accounts, no email.

*Acceptance criteria*
- Given the passcode is not entered, when anyone opens the page, then it is read-only.
- Given the correct passcode is entered, then logging and editing controls appear.

**7.3 Log a game**
- The 4 group players are pre-selected by default.
- Mark exactly 1 as the loser.
- Save writes 1 loss to the loser and 1 game played to all 4, with an automatic timestamp.
- Saving is blocked if the loser is not marked, or if more than 1 loser is marked.

*Acceptance criteria*
- Given the 4 players are set, when the admin taps 1 loser and saves, then the loser's L and GP increase by 1 and the other 3 players' GP increase by 1.
- Given no loser is marked, when the admin taps save, then the app blocks it and prompts to mark the loser.
- Given 2 losers are marked, when the admin taps save, then the app blocks it.

**7.4 Standings table**
- One row per player: rank, name, GP, L, games not lost, loss rate (%).
- A one-line legend defines "a win is any game you did not lose" and explains the 25% luck line.
- Recompute instantly after every logged, edited, or deleted game.
- Players under 25% loss rate are marked as beating luck, with the legend explaining the mark.

*Acceptance criteria*
- Given a game is logged, when anyone views the standings, then every affected row reflects the new numbers with no manual math.
- Given a stranger opens the page, then the legend makes clear why lower loss rate ranks higher and what 25% means.

**7.5 Dual ranking with a fixed small-sample guard**
- Toggle between "Most games not lost" (descending, rank 1 = most clean games, marked gold) and "Highest loss rate" (descending, rank 1 = biggest loser, marked clay). The two views deliberately disagree about what rank 1 means, so the rank colour states which one you're looking at.
- In loss-rate mode, only players with at least 5 games are ranked; others sit in "not enough games yet" with their raw numbers shown but no rank.
- Tiebreaks (applied consistently, no cross-contamination between the two axes):
  - Most-games-not-lost mode ties: break by lower loss rate, then more games played, then name A to Z.
  - Lowest-loss-rate mode ties: break by more games played (bigger sample), then more games not lost, then name A to Z.

*Acceptance criteria*
- Given a player has 3 games, when viewing lowest-loss-rate mode, then they appear in "not enough games yet," not at position 1.
- Given two players tie on games not lost, then the one with the lower loss rate ranks higher.

**7.6 Fix mistakes without creating illegal records**
- Undo the most recently logged game in 1 action.
- Edit any past game (change who lost).
- Delete any past game with a confirm step.
- Every edit is validated against the invariant: a saved game always has exactly 4 players and exactly 1 loser. An edit that would break this is rejected.
- All stats and ranks recompute after any change.

*Acceptance criteria*
- Given the admin logged the wrong loser, when they undo or edit the loser, then all affected totals adjust correctly.
- Given the admin edits a game so that 0 losers or 2 losers are marked, when they save, then the app rejects it and keeps the last valid state.

**7.7 Export and backup**
- Export the full game log and current standings to a file (CSV or JSON) at any time.
- The export is a complete backup: the standings can be rebuilt from it.

*Acceptance criteria*
- Given any point in a season, when the admin exports, then the file contains every game with its timestamp, 4 players, and loser.

**7.8 Season definition and reset**
- A season is a named period of play that the admin starts and ends manually. There is no fixed duration.
- Starting a new season archives the current standings (read-only) and resets counts to 0.
- Reset asks for confirmation and archives rather than deletes, so it is recoverable.

*Acceptance criteria*
- Given the admin starts a new season, when anyone views standings, then all players show 0 games and last season is viewable read-only.

**7.9 Loser of the night**
- For the current session (games sharing the same calendar day, or a manually started session), show who lost the most games.
- This is one grouping over data already stored. No new inputs.

*Acceptance criteria*
- Given 5 games were logged tonight and Bima lost 3 of them, when anyone opens the page, then "tonight's biggest loser: Bima (3)" is shown.

### P1 (should have, fast follow)

- **Head-to-head:** when two specific players are both at the table, who loses more. Uses roster plus loser, no new inputs. Directly addresses the "weak rivalry" pain in section 1.
- **Recent form:** a "last 10 games" loss rate next to the all-time one, so a hot or cold streak is visible.
- **Current streak:** games since a player last lost.
- **Season awards / "season wrapped":** at reset, auto-generate a card with the season's champion (lowest loss rate), biggest loser (most losses), longest streak, and fiercest rivalry, all from archived data.
- **Real-time refresh:** viewers see updates without a manual refresh (live sync rather than refresh-on-open).

### P2 (future, design so we do not block it)

- Player management beyond the fixed 4 (add or retire players with history kept). Kept out of v1 because the group is fixed.
- Handicap or rating (Elo-style) that weights results by opponent strength.
- Multi-loser or team game modes (needs a new scoring model).
- Avatars per player.

---

## 8. Edge cases and how the spec handles them

| # | Edge case | Handling |
|---|---|---|
| 1 | Player with 0 games | Loss rate shows a dash, not 0%. Player is unranked until they have games (and 5 for loss-rate mode). |
| 2 | Division by zero (L ÷ GP, GP = 0) | Guarded by the 0-games rule; never computed. |
| 3 | Tiny sample crowns a newcomer | Fixed 5-game threshold in loss-rate mode; below it, player is "not enough games yet" and unranked. |
| 4 | Tie in "most games not lost" | Break by lower loss rate, then more games played, then name A to Z. |
| 5 | Tie in "lowest loss rate" | Break by more games played, then more games not lost, then name A to Z. |
| 6 | Wrong loser tapped | Undo last game, or edit the game's loser. |
| 7 | Edit would create an illegal game (not 4 players or not 1 loser) | Rejected on save; last valid state kept (7.6). |
| 8 | Two devices open at once | Only the admin (passcode) can write. Viewers are read-only, so there is no write conflict. Last admin write wins. |
| 9 | Admin logs on device A, views on device B | Both read the same shared store; refresh shows the latest (7.1). |
| 10 | Abandoned or void game (no clear loser) | Do not save it. Nothing is stored without exactly 1 loser. |
| 11 | Fewer or more than 4 show up | Not supported. The group plays 4-player games only; a night with a different count is simply not logged. Flagged as a real-world risk in section 11. |
| 12 | Same person at two tables the same night | Out of scope: the group plays one 4-player table. If it happens, log each game separately. |
| 13 | Season reset by mistake | Confirmation step; archives rather than deletes, so it is recoverable. |
| 14 | Device lost or browser wiped | Data is in the shared store, not the device. Export gives an extra offline backup (7.7). |
| 15 | Everyone has fewer than 5 games early in a season | Loss-rate ranking may be empty. Default to "most games not lost" until at least 2 players cross 5 games, then offer loss-rate mode. |
| 16 | Passcode shared or leaked | Low stakes (a friend scoreboard). Admin can change the passcode. Export is the recovery path if someone edits maliciously. |

---

## 9. Data integrity and social risk

Two risks the council raised that are not features but decide whether this works.

**Logging discipline is the real dependency.** Every number depends on one admin logging every game, in the moment, indefinitely. A few skipped or misremembered games quietly distort loss rate more than they distort raw counts. Mitigations: keep logging to 3 taps so it is easy to do at the table, show "loser of the night" so the group notices when a game was not logged, and let the admin edit later. There is no automated reconciliation in v1. If the admin is absent, that night is simply not recorded, and the group accepts that.

**A permanent loser board can sour the game.** The tool exists to make rivalry fun, but a fixed "biggest loser" ranking among friends can sting. Two choices reduce this: default the standings to the skill view (lowest loss rate) rather than raw losses, and frame the loss column as "games not lost" so the positive number is what people see first. If the group finds it mean-spirited, an option to hide raw loss counts and show only loss rate is a cheap P1 addition.

---

## 10. Success metrics

**Leading indicators (days to weeks)**

- **Time to log a game:** median under 10 seconds, open to saved.
- **Taps to log:** 3 or fewer for the common case.
- **Same-night logging rate:** 90% of games played get logged that night.
- **Cross-device views:** at least 2 distinct devices open the standings in a typical week (proves the shared page is used, not just the admin's).
- **Correction rate:** games edited or deleted after logging stay under 10%.

**Lagging indicators (weeks to months)**

- **Group retention:** the group logs at least 1 game in 8 of any 10 play sessions.
- **Sort usage:** the ranking toggle is used at least once per session, which also tells you whether both sorts earn their place.
- **Data durability:** 0 incidents of lost history over a season (the whole reason for shared storage and export).

**Reading them together:** if time-to-log is good but same-night logging is low, the gap is habit, not the flow. If correction rate is high, the loser-tap step needs a clearer confirm. If sort usage is near zero, the group probably needs only one ranking (see the honesty note in section 2).

---

## 11. Step by step: how the group uses it

**First-time setup (admin, about 2 minutes)**
1. Open the app, set the 4 player names and a passcode.
2. Share the URL with the group. They open it read-only, no signup.

**Logging a game (admin, under 10 seconds)**
1. Unlock with the passcode (once per session).
2. Tap "Log game." The 4 players are pre-set.
3. Tap the 1 player who lost.
4. Tap save. The last game shows so it can be undone if wrong.

**Checking standings (anyone, any device)**
1. Open the shared URL.
2. See rank, GP, L, games not lost, and loss rate, with the legend.
3. Toggle "most games not lost" or "lowest loss rate."
4. See "loser of the night" for today.

**Fixing a mistake (admin)**
1. Right after saving: tap "Undo" on the last game.
2. Later: open the game log, pick the game, change the loser or delete it. Any change that would break "4 players, 1 loser" is rejected.

**Backing up (admin)**
1. Tap "Export" any time to download the full log. Keep it as an offline backup.

**Ending a season (admin)**
1. Tap "Start new season," confirm. Current standings archive read-only; counts reset to 0.

---

## 12. Open questions

- **Do you actually need both sorts?** They give the same order when everyone plays equally (section 2). If attendance is usually even, ship one ranking (lowest loss rate) and drop the toggle. Cheapest way to settle it: ask the 4 players how often the lineup changes. (Owner: Levi + the group. Non-blocking; both sorts are specced, easy to cut.)
- **Hosting choice.** A shared store needs a hosted backend. Options: a managed backend such as Supabase or Firebase (fastest to a working shared URL), or a small self-hosted store. (Owner: Levi + whoever builds it. Blocking for the build, not for the requirement.)
- **Passcode model.** One shared admin passcode is the simplest control with no accounts. Confirm that is enough, or whether even viewers should need the link only. (Owner: Levi. Non-blocking.)
- **Default landing sort.** Proposal: lowest loss rate as the default skill view, switch to most-games-not-lost on demand. (Owner: Levi. Non-blocking.)

---

## 13. Timeline and phasing

- **Phase 1 (P0):** shared persistent storage, admin passcode, log a game, standings with both sorts and the legend, undo, invariant-safe edit, export, season reset, loser of the night. This is the shippable core.
- **Phase 2 (P1):** head-to-head, recent form, streaks, season awards, real-time refresh, optional hide-raw-losses.
- **Phase 3 (P2):** player management, ratings, other game modes.

No hard external deadline. The one dependency that gates the build (not the requirement) is the hosting choice in section 12, since it sets where the shared data lives.

---

## Appendix A: Worked example

Four players, 10 games. L = losses. Losses sum to 10, one per game.

| Player | GP | L | Games not lost | Loss rate |
|---|---|---|---|---|
| Ade | 10 | 1 | 9 | 10% |
| Bima | 10 | 4 | 6 | 40% |
| Citra | 10 | 3 | 7 | 30% |
| Dewi | 10 | 2 | 8 | 20% |

Everyone played 10, so both sorts give the same order: Ade, Dewi, Citra, Bima. This is the case from section 2 where the two rankings collapse into one.

Now add Eka, who played 2 games and lost 0. In "most games not lost" mode Eka has 2 and ranks last, which looks odd until you remember he only played twice. In "lowest loss rate" mode, Eka is "not enough games yet" (under 5 games) and sits below the ranked four rather than topping them on a 0% rate. The legend and the "not enough games yet" grouping are what stop a stranger from reading this as a bug.

---

## 14. v3 additions (2026-07-14): leaderboards, player management, dated logging, loser spotlight

Four features from Levi's review, detailed here. Two of them (14.1 multiple leaderboards, 14.2 in-UI player management) change the data model, so they also change TRD-2026-001 and the build plan. See "Impact on the TRD and build plan" at the end. Where a v3 item conflicts with v2, v3 wins and the superseded item is named.

### 14.1 Multiple leaderboards (replaces seasons)

Problem: the group plays more than one game, or wants a clean slate, and "start a new season" is a weak way to say that. A leaderboard is the top-level tracker, and there can be several.

Decision from review: each leaderboard has its own players, games, and standings. Creating a new leaderboard replaces the season reset. The v2 "season" concept (7.8) is removed.

User stories:
- As the admin, I want to create a named leaderboard, so each game or group has its own standings.
- As the admin, I want to switch the active leaderboard, so I log and view the right one.
- As a viewer, I want to pick which leaderboard I am looking at, so I see the standings I care about.
- As the admin, I want to rename or delete a leaderboard, so I can fix a typo or clear one I no longer use.

Requirements (P0):
- Create a leaderboard with a name, unique across leaderboards.
- Every player, game, standing, and loser spotlight is scoped to one leaderboard.
- Switch the selected leaderboard; the whole view recomputes for it.
- Rename a leaderboard.
- Delete a leaderboard behind a confirm, with a reminder to export first. Deleting removes that leaderboard's players and games.
- This replaces v2 7.8: there is no season. To reset, create a new leaderboard.

Acceptance criteria:
- Given the admin creates "Poker" and logs games there, when they view "Remi", then those games do not appear under "Remi".
- Given two leaderboards exist, when anyone switches, then the table, both loser spotlights, and ranks recompute for the selected leaderboard.
- Given the admin deletes a leaderboard and confirms, then it and its data are gone and the view falls back to another leaderboard.

Edge cases:
- First run, no leaderboard yet: the app prompts the admin to create the first one before anything else.
- Default on open: the last leaderboard viewed on this device, else the first created.
- Same player name in two leaderboards: allowed, they are separate records (players belong to a leaderboard).
- Deleting the only leaderboard: allowed, then the app returns to the create-first-leaderboard state.

### 14.2 Add and delete players in the UI (promoted from P2 to P0)

Problem: v2 fixed the roster at 4 seeded names. Groups change, and the admin should manage players without touching the database.

User stories:
- As the admin, I want to add a player to the current leaderboard, so a new friend is tracked.
- As the admin, I want to remove a player, so someone who left stops cluttering the roster.
- As the admin, I want past results kept when I remove someone who already played, so history stays honest.

Requirements (P0):
- Add a player with a name, unique within the leaderboard.
- Delete a player with zero games: removed outright.
- Delete a player who has games: archived, not hard-deleted. Archived players stay in the standings with an "archived" mark (their games happened) and are not offered when logging a new game.
- Logging needs at least 4 active (non-archived) players. If the leaderboard has exactly 4 active players, they are pre-selected when logging; if more than 4, the admin picks the 4 who played, then the loser. Every game is still exactly 4 players and 1 loser.
- Restore an archived player (P1).

Acceptance criteria:
- Given the admin adds "Eka", then Eka appears in the roster and the log picker.
- Given the admin deletes a player with no games, then the player is gone.
- Given the admin deletes a player who has games, then the player is archived, still shown in standings marked archived, and not selectable for a new game.
- Given a leaderboard has 5 active players, when the admin logs a game, then they must select exactly 4 before marking the loser.
- Given fewer than 4 active players, then logging is disabled with a message to add players.

Edge cases:
- Duplicate name within a leaderboard: blocked at add time.
- Archiving drops active players below 4: logging is disabled until a player is added or restored.
- Deleting a player mid-standings: standings recompute; archived players keep their rows.

### 14.3 Dated game logging: default today, no future dates

Problem: games get logged late, and the day a game counts toward matters for the daily loser. v2 used only the automatic timestamp.

User stories:
- As the admin, I want the game date to default to today, so the common case is one fewer decision.
- As the admin, I want to backdate a game I forgot to log, so history is accurate.
- As the admin, I want future dates blocked, so a mis-tap cannot create a game that has not happened.

Requirements (P0):
- The log form has a date field defaulting to today, the admin's local date.
- The admin can pick any date up to and including today.
- Future dates are not selectable.
- The chosen date decides which day the game counts toward for the daily loser spotlight and any day grouping.

Acceptance criteria:
- Given the admin opens the log form, then the date is today by default.
- Given the admin tries to pick tomorrow, then the date control does not allow it.
- Given the admin logs a game dated yesterday, then it counts toward yesterday, not today, in the daily loser spotlight.

Edge cases:
- The day boundary is the admin's local midnight. "Today" means the admin's local date.
- Backdating recomputes historical standings and the affected day's loser.
- The date resets to today each time the form opens; it does not stick to the last used date.

### 14.4 Loser spotlight: all-time and daily biggest loser

Problem: the emotional point of a 1-loser game is the loser, and v2 buried this in a small "loser of the night" line. Make it the headline.

Decision from review: two spotlight cards sit above the standings table, one name each, rendered much larger than the table rows. This supersedes and absorbs v2 7.9 (loser of the night).

- All-time biggest loser: the player with the most losses in this leaderboard (absolute loss count, the "goat").
- Today's biggest loser: the player with the most losses among games dated today.

User stories:
- As a viewer, I want to see the all-time biggest loser in big letters, so the running joke is front and center.
- As a viewer, I want to see today's biggest loser, so tonight has a clear result.

Requirements (P0):
- Show two cards above the leaderboard: "All-time biggest loser" and "Today's biggest loser".
- Each shows a single name by default, rendered visibly larger than the standings rows.
- Ties show all tied names.
- The main standings table stays sortable by games not lost and by loss rate (the skill view). The spotlight is the "who loses most" view; the table is the "who is good" view.

Acceptance criteria:
- Given Bima has the most losses all-time in this leaderboard, then the all-time card shows "Bima" in large type.
- Given two players tie for most losses today, then today's card shows both names.
- Given no games are dated today, then today's card shows a short empty message, for example "No games logged today".
- Given the leaderboard has no games at all, then both cards show a "no data yet" state.
- The spotlight names are clearly larger than the table's name column, a visible size difference, not a subtle one.

Edge cases:
- Ties on the all-time card: list every tied name.
- A backdated game changes the correct day's card, not today's.
- An archived player can still be the all-time biggest loser if their losses are the highest; their history counts. Mark them archived on the card.

### 14.5 Changes to earlier sections

- v2 7.8 (season and reset): removed. Leaderboards (14.1) replace it. Any earlier mention of "season" now means "leaderboard".
- v2 7.9 (loser of the night): absorbed into 14.4 as the prominent daily spotlight.
- v2 personas: the admin now manages players and leaderboards in the UI. v2 P2 "player management" is promoted to P0.
- v2 7.3 log flow: when a leaderboard has more than 4 active players, the admin selects the 4 who played before marking the loser. Still exactly 4 players and 1 loser per game.

### 14.6 Success metrics additions

- Leaderboards in use: at least 1 created and logged against (proves 14.1 fits the group).
- Spotlight is the draw: the standings page is opened when no game is being logged. Proxy target: page views per week exceed games logged per week, which would show the loser spotlight, not just logging, brings people back.

### 14.7 Open questions (v3)

- [OPEN — Can one game belong to more than one leaderboard, or always exactly one? Proposal: exactly one — Levi — before build]
- [OPEN — Should archived players be hidden from standings entirely, or shown with an "archived" mark? Spec assumes shown with a mark — Levi — before build]
- RESOLVED (2026-07-14, Levi): all-time biggest loser is by total (accumulative) losses. Ties show every tied name, joined in the card (e.g. "Bima & Citra"); this is a display detail, no extra logic.

### 14.8 Impact on the TRD and build plan

These change TRD-2026-001 and the build plan. In short: add a `leaderboards` table as the top container; give `players` a `leaderboard_id` and an `archived` flag with unique(name, leaderboard_id); give `games` a `leaderboard_id` and a `game_date` the admin sets, rejected if in the future; drop the `seasons` table and the single-active-season rule; scope `v_standings` and both loser spotlights by `leaderboard_id`; add Edge Function actions for create, rename, and delete leaderboard, and add, delete, and restore player; and generalize the log flow to pick 4 of N active players. I can update both docs to match on request.
