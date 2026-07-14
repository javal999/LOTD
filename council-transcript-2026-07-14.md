# Council transcript: Card game standings tracker PRD

**Date:** 2026-07-14
**Counciled:** the PRD for a 4-player card game standings tracker

---

## Original question

Levi asked the council to pressure-test the PRD to make sure it is a flawless requirement before any build, with these locked constraints: strictly 4 players, exactly 1 loser per game, single admin inputs all results, no per-user login/accounts. Mid-review Levi added: it should be a web app whose data is recorded and stays consistent even when opened across devices.

## Framed question given to advisors

"Pressure-test this PRD for a card game standings tracker to make sure it is a flawless requirement before any build. Locked constraints (decided, do not challenge, judge whether the PRD handles them): strictly 4 players per game; exactly 1 loser and 3 non-losers per game; exactly 1 admin inputs all results on a single device, no login/accounts/web app/sync; small fixed recreational group, no money; standings show games played, wins, losses, rank, sortable by most games won and by smallest loss rate. Treat the PRD's variable-table-size and sync/accounts items as removed. Find gaps, ambiguities, contradictions, missing edge cases, or wrong priorities."

Note: the "single device / no web app" framing was current when advisors ran. Levi then changed it to a cross-device web app, which converts the council's top finding (no backup on one device) from a flaw into a resolved requirement.

---

## Advisor responses

### The Contrarian
The single sharpest flaw: the PRD treats a decided constraint as an open, blocking question. Section 11 lists "Single device vs. sync" as blocking, Section 12 says it's the gating dependency. That decision is locked. Delete it. Worse, the "no cloud, single device" constraint manufactures a data-loss risk the PRD never mitigates: weeks of standings and archived seasons live on one device with no P0 backup, CSV export is buried in P1, one lost phone erases everything. Export/backup belongs in P0. This is the actual fatal flaw. Section 7.5 lets the host change the roster but no acceptance criterion re-asserts the invariant: editing must still force exactly 4 players and 1 loser; you can edit a game into an illegal state. In lowest-loss-rate mode, provisional players get no rank, so half the required sort modes leaves some people rankless. "Most wins" is near-degenerate: with W = GP − L and a ~25% loss rate, wins track games-played by construction. Open Question #4 defines the group's core word "win"; resolve it before build.

### The First Principles Thinker
You have documented the model beautifully and answered the wrong question. In a 4-player, 1-loser game there are no winners. The only atomic fact the app records is a loss event (7.2). "Wins" (W = GP − L) is a derived, redundant column carrying zero information beyond GP and L. The group asked for "wins"; you gave them arithmetic. It is the core primitive, and it is a fiction. The honest label is "games survived." Is dual-sort the real need? It only produces two different orderings when attendance differs. Your locked constraint is a small fixed group who mostly all show up; when GP is equal, "most wins" descending and "lowest loss rate" ascending are the same list. Dual-sort is a symptom: you do not know how variable attendance is, and that single fact decides whether you need one ranking or two. The actual job: a roast machine; the emotional payload is the loser. Raw losses and loss rate answer "who is the biggest loser" and "who is genuinely good" cleanly. Contradiction: the most-wins tiebreak (Section 8 row 4) breaks ties by "fewer games played," importing skill logic into the activity ranking. One axis per sort, or drop the second sort.

### The Expansionist
The PRD is engineered like a spreadsheet and priced like one. It captures a timestamp, full roster, and loser per game (7.2), a richer event log than the standings table (7.3) ever spends. That surplus data is the product's real upside, and it is buried in P1. Three near-zero-cost payoffs: (1) "Loser of the night" is one GROUP BY timestamp away, an instant recurring ritual and screenshot bait, stickier than any rank column. (2) Rivalries: head-to-head needs no new inputs; the problem statement literally names "weak rivalry" as the pain, then exiles the cure to P1. (3) Streaks and heat turn a static table into a live story: "Ade has not lost in 6." Then compound it for free: Season awards at reset, auto-generate a "Season wrapped" card (champion, biggest goat, longest streak, fiercest rivalry) from archived data, zero new schema. What the PRD undersells: it frames success as logging speed; the actual moat is memory and bragging rights. Promote at least Session/Loser-of-the-night and Head-to-head into P0.

### The Outsider
The "wins" problem is real and worse than section 11's open question admits. Three people "win" every single game, so "wins" never means "beat someone", it means "showed up and was not the loser." Worse, since W = GP − L, the W and L columns are mathematically redundant: three columns that are really two. Cut W, or label it "games not lost." "Loss rate" as the default "who is best" view inverts normal standings intuition: rank 1 holds the lowest number in the sorted column; every scoreboard a newcomer has seen puts the biggest number on top. Expect confusion. The 25% luck line is well-reasoned but invisible to a stranger: the table merely styles sub-25% players with no legend. Terminology drifts: section 6 says "provisional," sections 2 and 7.4 say "not enough games yet." Pick one. Contradiction: 7.2 says "default 4," implying changeable; non-goal 3 and P1 say v1 is locked at 4. "Season" is never defined: no duration, no reset trigger. And Appendix A's Eka, who never lost yet ranks last in most-wins mode, will look broken to anyone who does not already grasp the model.

### The Executor
Simplest thing that works: a single HTML file with localStorage, or a Google Sheet with one row per game (timestamp, P1-P4, loser) and a pivot for standings. Everything in Section 2 is derivable from that one row. Genuinely needed P0: 7.2 (log a game), 7.3 (standings), 7.4 (two sorts), undo-last from 7.5. Gold-plating dressed as P0: 7.1 archive-player + rename-with-history; 7.5 full retroactive edit of any past game; 7.6 season reset with read-only archives; 7.4 host-adjustable threshold (hardcode 5). Where a builder stalls: (1) storage is unspecified, Section 12 says the data model is "gated" but never names where bytes live; (2) backup is absent and this is the real flaw: single device with no P0 export means one dead phone erases everything, CSV export is buried in P1, promote export/backup to P0; (3) tiebreaks are fine. Monday morning: build one HTML file, hardcoded 4 names, tap-loser + save to storage, computed standings with a sort toggle. That vertical slice tests Goal 1 (10 sec / 3 taps) tonight.

---

## Peer review (anonymization mapping: A = First Principles, B = Executor, C = Contrarian, D = Expansionist, E = Outsider)

**Reviewer 1:** Strongest: C, the widest set of verifiable high-severity defects, only one to catch that 7.5 lets the host edit a game into an illegal state. Biggest blind spot: D, gold-plates delight onto a product that can lose everything overnight. All five missed: logging discipline, every standing depends on one admin logging every game indefinitely, and a few skipped nights silently corrupt rankings with no audit trail.

**Reviewer 2:** Strongest: C, sharpest process catch (a decided constraint filed as an open blocker), plus the unique illegal-state edit hole. Biggest blind spot: D, scope expansion against a radically minimal brief while ignoring data loss. All five missed: the cheapest resolver for the "what is a win / two sorts" dispute is to ask the four players; and the social risk that a permanent "biggest loser" board can sour the game.

**Reviewer 3:** Strongest: C, reframes the core error and adds the concrete roster-edit correctness bug; B a close, more buildable second, both rightly promote export/backup to P0. Biggest blind spot: D, builds a moat of memory on a datastore with zero backup. All five missed: they accepted "exactly 1 loser per game" as unbreakable and did not stress-test ties, abandoned games, or nights when 3 or 5 show up; and the single-admin single point of failure.

**Reviewer 4:** Strongest: B, names the fatal flaw (no backup) and converts it to an executable Monday build with real P0-vs-gold-plating triage; C the sharpest meta-catch. Biggest blind spot: D, enriching data it cannot guarantee persists. All five missed: whether the log ever gets created, logging friction and the single-admin bus factor, and tamperability of one unaudited device as the sole record.

**Reviewer 5:** Strongest: B, converts critique into a build and names the fatal gap C confirms. Biggest blind spot: D, promotes new features onto an unsafe foundation. All five missed: who operates it and the single-admin failure mode; also nobody defined what happens with fewer or more than 4 players, and whether players trust one person's unaudited device.

---

## Chairman verdict

### Where the council agrees
1. "Wins" is a derived, redundant column (games not lost = GP − L) and, in a 1-loser game, does not mean "beat someone." Relabel it honestly and add a one-line legend. Stop treating the definition as an open question. (First Principles, Outsider, Contrarian.)
2. Data persistence and backup were the top flaw. On one device with no export, a dead phone erases everything. Promote persistence and export to P0. (Contrarian, Executor, 3 reviewers.) Levi's new cross-device web-app requirement resolves this directly.
3. Keep the build small. Rename-with-history, full retroactive edit, adjustable threshold, and archived-season machinery are gold-plating for a 4-friend scoreboard. (Executor.)
4. Fix the concrete correctness bug: a roster or loser edit must still enforce exactly 4 players and 1 loser, or the admin can save an illegal record. (Contrarian.)

### Where the council clashes
- Scope. The Expansionist wants delight features (loser of the night, head-to-head, streaks) promoted to P0 because the real job is bragging rights and memory. The Executor and 3 reviewers call that building the second floor before the ground floor, since persistence was not even solved. Resolution: fix persistence and the "wins" relabel first, then add one cheap ritual (loser of the night) because it is a single grouping and directly serves the stated "weak rivalry" pain. Defer the rest to P1.
- Do you need two sorts at all? First Principles shows both rankings collapse to the same order when everyone plays equally, so a fixed group that always shows up needs only one. Others accept dual sort because Levi asked for it. Resolution: keep both because it was requested, but state the collapse plainly and fix the contradictory tiebreak. Settle it by asking the four players how often the lineup changes.

### Blind spots the council caught (peer review)
1. The whole ledger depends on one admin logging every game, forever. Skipped or misremembered games distort loss rate silently, with no audit trail. This is a bigger threat than storage and needs a habit-level mitigation, not a feature.
2. A permanent "biggest loser" board among friends can sour the game it celebrates. Default to the skill view and frame the positive number first.
3. The cheapest way to resolve the "what is a win / how many sorts" debate is to ask the four players, which no advisor proposed.

### The recommendation
Ship a hosted web app with a shared backend so data persists and stays consistent across devices. This is now a hard requirement and it also fixes the number-one flaw. Single admin writes via a passcode-gated edit mode; everyone else opens the same URL and sees a live read-only standings. Keep P0 tight: log a game (enforcing 4 players and 1 loser on both create and edit), live standings with both sorts and a legend, undo-last, persistent shared storage, and export. Relabel "wins" as "games not lost." Add exactly one delight hook, "loser of the night," because it is nearly free and serves the rivalry goal. Defer head-to-head, streaks, and season awards to P1.

### The one thing to do first
Lock the data model and hosting: one shared URL, one backend table of game rows (timestamp, 4 player slots, loser), admin writes gated by a passcode, everyone else read-only. Everything in the standings is derived from that table. Prove it persists across two devices before building any UI polish.
