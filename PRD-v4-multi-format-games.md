# PRD v4 (revised) — Add racquet sports without touching the card game

**Status:** Draft for review · **Author:** Levi (with Claude) · **Date:** 2026-07-21
**Supersedes:** the first v4 draft (game-types / point-share). **Extends:** [PRD v3](PRD-card-game-standings-tracker.md).
**Reviewed by:** [council #1](COUNCIL-2026-07-21-prd-v4.md) (rejected the first draft) and
[council #2](COUNCIL-2026-07-21-prd-v4-rev2.md) (validated this architecture, dropped the Loss Index).

---

## TL;DR

The group plays cards, table tennis, and padel. LOTD only understands cards. v4 adds the two sports
**by adding one new table beside the card table — not by rewriting anything.**

Everything reduces to one idea the app already lives by: **a game has a losing side, and everyone on
it gets stamped PECUNDANG.** Cards pick the loser directly; a racquet game derives the loser from the
score. Either way it's a loss, and every standing ranks by losses — the same primitive as the stamp.

**Decisions locked with Levi (and stress-tested by two council rounds):**

| Decision | Choice |
|---|---|
| How sports are added | **One flat `sports_games` table** beside the untouched card table |
| Migration | **None** — the 67 card games are not touched |
| Structural guarantee | **Kept** — a racquet game is one flat row, so CHECK constraints still enforce it |
| Loser of a racquet game | **The lower-scoring side; both players on it are stamped** |
| All-time ranking | **Each sport by its own loss rate** (today's card logic) — no cross-sport index |
| Daily "Loser of the Day" | **Most games lost today, raw count, across all three** (the punchline) |
| Pairings | **Just record** — no schedule generation |

**Why no unified cross-sport number.** A card game gives everyone a 25% chance of losing; a racquet
game 50%. Any single number that ranks cards against padel is either unfair (raw loss rate makes every
padel player look worse) or illegible (a normalised "Loss Index" your friends have to be taught).
Council #2 killed the index on all three counts. So we don't force the comparison: **rank within each
sport, where loss rate is both fair and legible, and let the daily stamp be the one thing that spans
everything** — because nobody expects "who lost most today" to be fair. It's a joke.

**LOTD stays LOTD.** Every game still answers one question: *who lost?* — and it's always the same
kind of number.

---

## 1. Problem statement

The group plays three things; the scoreboard understands one.

- A table tennis 1v1 can't be logged — the app requires exactly 4 players.
- There's no concept of a side, so doubles and padel are unrecordable.
- Scores have nowhere to go: an 11–0 thrashing and an 11–9 nailbiter look identical.

**Cost:** the table tennis and padel rivalries live in WhatsApp threads and forget themselves. LOTD's
value is that it *remembers* — who's been losing since March. The joke is the product, and right now
two-thirds of the group's games aren't in on it.

---

## 2. Goals & non-goals

### Goals
1. **Log a table tennis singles game in under 10 seconds** — pick two players, type two scores, save.
2. **Table tennis (singles + doubles) and padel on the same app as cards**, one shared roster, one
   daily loser.
3. **Ranking stays legible and loss-based** — the same kind of number the group already reads.
4. **Zero regression, zero risk to card history** — the card table, its constraints, and its 3-tap
   flow are literally unchanged.
5. **A padel night gets fully logged** — logging is fast enough, with roster memory, that people
   don't give up after round 3 (see §7.2 and the completeness risk in §12).

### Non-goals
1. **Not a tournament organiser** — no Americano schedule generation, no auto-pairing. (7 players on
   1 court = 11 rounds for a full rotation; a generated schedule dies halfway. A *partner suggestion*
   is P1; a schedule is not.)
2. **No skill ratings (Elo/Glicko).** This tracks losing, not skill.
3. **No cross-sport unified ranking** (see TL;DR). Deliberately dropped.
4. **No live/in-progress scoring**; **no match-level record** (best of 3/5) — one game is the unit.
5. **No variable card player-count (2–8) in this release.** Independent of the sports goal; deferred.
6. **No per-player accounts.** Open-write model stays.

---

## 3. The model: two tables, one rivalry

A **leaderboard** (e.g. `Seven P3`) has **players**. Those players play **card games** (today's
table) and **racquet games** (a new table). Standings read from both.

```
leaderboard ─┬─ players ──┬─ card games      [games — UNCHANGED]
             │            └─ racquet games   [sports_games — NEW]
             ├─ per-sport standings  = loss rate within each game type
             └─ Loser of the Day     = raw losses today, across both tables
```

- **Players are shared.** The same Levi plays cards and padel as one player row — that's what makes
  it "one place for the rivalry."
- **The two game tables never mix physically.** Cards keep `p1..p4 + loser` and "pick who lost."
  Racquet games are a different shape with a different mechanic (derive the loser from the score).
- **Nothing about cards changes** — not the table, its CHECKs, the Edge Function's card actions, nor
  the 3-tap flow. The only shared surface is a read-only standings view.

### Why a flat racquet table (and why it matters)

A racquet game is **2 sides of 1–2 players with a score** — one flat row:

```
a1, a2(nullable), b1, b2(nullable), score_a, score_b, sport
```

Because it's one row, the trick that has kept card standings perfect — **CHECK constraints** —
enforces every rule: valid score, no draw, distinct players, consistent side shape. **We keep the
structural guarantee.** The deferred trigger the first draft needed (and that council #1 proved
couldn't fire, because writes are separate transactions) never exists here.

---

## 4. Scoring & ranking

### 4.1 The loser of a racquet game
The side with the **lower score** lost. **Everyone on the losing side is stamped and takes one loss**
(both players, in doubles). Singles = one loser. Cards = the one chosen loser. Same currency: a loss.

Scores are still stored — they decide the loser, they catch typos (§5), and they give roast flavour
("lost 21–3, brutal") — but they do **not** rank. There is no point-share metric.

### 4.2 All-time ranking: loss rate, within each sport
Each game type has its own standing, ranked exactly as the card game is today:

```
loss_rate = losses / games_played          (within one game type)
```

- **Cards:** unchanged from v3. Baseline luck 25%; "beats luck" = under 25%.
- **Table tennis / padel:** baseline luck **50%** (two sides); "beats luck" = under 50%.

Loss rate is fair *within* a sport (everyone shares the same baseline) and instantly legible ("67%").
The provisional threshold (min games to rank) applies per sport. Tiebreak chain, per sport: loss rate
→ more games → fewer wins → name A→Z (v3's ordering).

The all-time spotlight becomes **per-sport**: biggest card loser, biggest TT loser, biggest padel
loser. Someone topping two at once is its own punchline.

### 4.3 The daily stamp — "Loser of the Day"
**Most games lost today**, raw count, cards + racquet together. This is the one number that spans all
three sports, and it's meant to be blunt, not fair — you lost the most, you get the trombone. Ties
render `A & B · tied` (v3 behaviour).

> One honest wrinkle: a padel night is ~8 rounds, a card sitting ~2 games, so on a mixed day the
> higher-volume sport contributes more raw losses. That's accepted — more games played is more chances
> to lose, and the daily stamp has never pretended to be normalised.

---

## 5. Score validation

A racquet row is rejected unless the score is legal for its `sport`. Both rules are pure CHECK
constraints on the row.

### Table tennis (`tt_singles`, `tt_doubles`) — first to 11, win by 2
```
w = max(a,b), l = min(a,b)
valid iff  a <> b  and  ( (w == 11 and l <= 9)  or  (w > 11 and w - l == 2) )
```

| Score | Verdict | Why |
|---|---|---|
| `11–0` … `11–9` | ✅ | clean win |
| `12–10`, `15–13`, `23–21` | ✅ | deuce, margin 2 |
| `11–10` | ❌ | must win by 2 |
| `12–9`, `13–10` | ❌ | game already ended at 11–9 / 12–10 |
| `12–11` | ❌ | margin 1 |
| `10–8` | ❌ | nobody reached 11 |

### Padel Americano — a 21-point round
```
valid iff  a + b == 21  and  a <> b     (a<>b is automatic: 21 is odd)
```

| Score | Verdict | Why |
|---|---|---|
| `13–8`, `21–0`, `11–10` | ✅ | sums to 21 |
| `13–7` | ❌ | sums to 20 |
| `14–8` | ❌ | sums to 22 |

### The test that proves the design
**`11–10` is valid padel and invalid table tennis** — same numbers, opposite verdicts, decided by the
row's own `sport`. One flat table, one CHECK, both right. The sharpest single unit test in v4.

---

## 6. Data model

```sql
-- NOTHING changes on: leaderboards, players, games (cards), and the card standings.

create table sports_games (
  id             bigint generated always as identity primary key,
  leaderboard_id bigint not null references leaderboards(id) on delete cascade,
  sport          text   not null check (sport in ('tt_singles','tt_doubles','padel')),
  game_date      date   not null default current_date,
  a1  bigint not null references players(id) on delete restrict,
  a2  bigint          references players(id) on delete restrict,   -- null = singles
  b1  bigint not null references players(id) on delete restrict,
  b2  bigint          references players(id) on delete restrict,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  created_at timestamptz not null default now(),

  constraint decisive check (score_a <> score_b),                  -- no draws
  constraint side_shape check ((a2 is null) = (b2 is null)),        -- singles ⇔ both null
  constraint shape_matches_sport check (
    (sport = 'tt_singles' and a2 is null) or
    (sport in ('tt_doubles','padel') and a2 is not null)
  ),
  constraint distinct_players check (                               -- nulls ignored
        a1 <> b1
    and (a2 is null or (a2 <> a1 and a2 <> b1 and (b2 is null or a2 <> b2)))
    and (b2 is null or (b2 <> a1 and b2 <> b1))
  ),
  constraint valid_score check (
    case when sport = 'padel'
         then score_a + score_b = 21
         else (greatest(score_a,score_b) = 11 and least(score_a,score_b) <= 9)
           or (greatest(score_a,score_b) > 11 and greatest(score_a,score_b) - least(score_a,score_b) = 2)
    end
  ),
  constraint game_date_not_future check (game_date <= current_date + 1)
);

create index sports_games_board_date_idx on sports_games (leaderboard_id, game_date);
-- RLS + grants mirror the card tables: anon read-only; writes via the Edge Function only.
```

**Standings views** (read-only; the card data is never modified):
- `v_sport_standings(leaderboard_id, sport, player_id, name, games, losses, loss_rate)` — per player
  *per sport*, losses counted on the lower-scoring side. Cards appear here too as `sport='cards'`
  reusing the existing `v_standings` logic, so one view drives every per-sport table.
- `v_daily_losses(leaderboard_id, game_date, player_id, losses)` — raw losses that day across cards +
  racquet, for the "Loser of the Day" card.

No `loss_index`, no `point_share`. The whole scoring surface is "count losses, divide by games,
per sport."

**Board-isolation backstop:** add `unique (id, leaderboard_id)` on players and composite FKs
`(aN, leaderboard_id) → players(id, leaderboard_id)` on `sports_games` (and the same on the card
`games` table) so a game can only contain players from its own board. Verified 2026-07-21 that today's
schema lacks this; ~10 lines, belongs here.

---

## 7. Step-by-step: how to use it

### 7.1 Log a table tennis singles game (the 10-second path)
1. **Log game → Table tennis (singles)** *(remembers your last choice)*.
2. Tap the two players.
3. Type `11` and `7`. The lower score's player is the loser — highlighted automatically. No "who
   won?" question.
4. **Simpan** → PECUNDANG stamp on the loser, 4-second undo.

### 7.2 Log a padel round (with roster memory — see §12)
1. **Log game → Padel.**
2. The 4 players from your **last round tonight are pre-selected** — tap to swap anyone in/out. (First
   round: tap the 4 on court.) Anyone not selected simply isn't in the round.
3. **Split** into Side A / Side B (tap to move a name); the split is remembered too, so a fixed-pairs
   night is one tap per round.
4. Type `13` – `8`. A live hint reads **`21 / 21 ✓`**; a miscount is caught before saving.
5. **Simpan** → both players on the `8` side stamped, each takes a loss. The sheet reopens ready for
   the next round.

*Roster memory is what makes an 8-round Americano night loggable without giving up halfway — the
difference between a complete record and a silently wrong one.*

### 7.3 Log a card game
Unchanged. 4 players → confess `<name> pecundang` → save. Same 3 taps as today.

### 7.4 Fix a mistake
Unlock → **Recent games** (labelled `🏓 Levi 11–7 Rafi` · `🎾 A: Levi·Rafi 13–8 Nadhif·Sebas` ·
`🃏 …`) → Edit / Delete. Standings recompute. Racquet edits re-run the score CHECK.

---

## 8. Requirements

### P0
| # | Requirement | Acceptance |
|---|---|---|
| R1 | `sports_games` table with all §6 CHECKs | Every row of §5's tables is a **DB-level** test (SQL fixture); malformed rows rejected by the DB, not just the app |
| R2 | Cards untouched | Card table DDL, CHECKs, Edge Function card actions, and tap-count byte-identical to v3 |
| R3 | New Edge Function action logs TT singles/doubles + padel | Padel 13–8 stamps both losers; TT 11–7 stamps one |
| R4 | Loser derived from the lower score; both doubles losers counted | `sports_games` stores no "winner"; the lower side loses |
| R5 | Each sport ranked by its own loss rate | Cards ranking is byte-identical to v3; TT/padel use the same formula with a 50% baseline |
| R6 | Daily loser = most games lost today, across both tables | A day with one card loss and one padel loss counts both |
| R7 | Roster memory for racquet logging | After round 1, the next round pre-selects the same players and split |
| R8 | Composite-FK board isolation | A cross-board racquet insert fails (today it silently succeeds) |
| R9 | `11–10` valid as padel, invalid as TT | Single CHECK keyed on `sport`; both directions unit-tested |
| R10 | Padel ships with the doubles UI | Sequencing: padel is 2v2, so it lands with team-split, not in a singles-only phase |

### P1
| # | Requirement |
|---|---|
| R11 | `v_partnerships` — who's partnered whom, win/loss together → "you've never won a round with Sebas" (the roast an event app can't build) |
| R12 | Losing-streak counter extended to sports ("3 days running") — the app already shows card streaks |
| R13 | Head-to-head singles records (`Levi beats Rafi 7–3`) |
| R14 | Standing filter / per-sport spotlights on one screen |
| R15 | Export includes racquet games; standings rebuildable from export alone |

### P2
| # | Requirement |
|---|---|
| R16 | Variable card player-count (2–8) |
| R17 | Partner suggestion (Tier 1, from `v_partnerships`) |
| R18 | Configurable TT target (21) / padel total |
| R19 | "Log the whole night" as one padel-session entry (heavier alternative to roster memory) |

---

## 9. Edge cases

### Scores
| # | Case | Behaviour |
|---|---|---|
| EC-1 | TT `11–10` | Rejected — win by 2 |
| EC-2 | TT `12–9` / `13–10` | Rejected — game already ended |
| EC-3 | TT `15–13`, `23–21` | Valid — deuce |
| EC-4 | Padel `13–7` (sums 20) | Rejected — live hint shows `20/21` |
| EC-5 | Padel `11–10` | Valid — sums to 21 (contrast EC-1) |
| EC-6 | Equal scores any sport | Rejected — `decisive` CHECK; racquet has no draws |
| EC-7 | Score typed loser-first (`7–11`) | Fine — loser is the lower side regardless of column |
| EC-8 | Absurd `99–97` (valid TT) | Accepted but UI flags "unusually long" — surface typos, don't police |

### Sides & players
| # | Case | Behaviour |
|---|---|---|
| EC-9 | Same player on both sides | Rejected — `distinct_players` CHECK |
| EC-10 | Singles with a partner set, or doubles missing one | Rejected — `side_shape` / `shape_matches_sport` |
| EC-11 | Player from another board | Rejected — composite FK (R8) |
| EC-12 | Archived player in a new game | Rejected (mirror the card rule in the Edge Function) |
| EC-13 | Archived player in a past game | Kept and counted |
| EC-14 | Player deleted who has racquet games | Archived, never hard-deleted (FK `RESTRICT`) |
| EC-15 | Same human plays cards and padel | One shared player row; appears in both per-sport standings and the daily count |

### Ranking & completeness
| # | Case | Behaviour |
|---|---|---|
| EC-16 | Per-sport loss rate below the provisional threshold | Listed, unranked in that sport (v3 behaviour) |
| EC-17 | Player with 0 games in a sport | Absent from that sport's standing; no divide-by-zero |
| EC-18 | Doubles: one strong player, weak partner | Both take the loss — you lose as a pair. Known; `v_partnerships` (R11) exposes it as a feature |
| EC-19 | Someone plays only singles, another only doubles | Both rank in the TT standing on the same 50% baseline; who they partnered doesn't change their loss rate |
| EC-20 | **Padel night partially logged** (rounds 1,2,5 only) | **No error — the DB can't see a missing round.** Mitigated by roster memory (R7) making full logging cheap; called out as the top residual risk (§12) |
| EC-21 | Mixed-day daily count favours the higher-volume sport | Accepted (§4.3) — more games is more chances to lose |

### Integrity & time
| # | Case | Behaviour |
|---|---|---|
| EC-22 | Future-dated game | Rejected (client supplies local `today`) |
| EC-23 | Backdated game | Allowed; lands on its own day |
| EC-24 | Hand-crafted malformed racquet insert | Rejected by CHECKs — structural, not just app-level |
| EC-25 | Two people logging at once | Independent rows; no lost updates |
| EC-26 | Export/import round-trip | Standings rebuild from cards + racquet exports alone |

---

## 10. Phasing

| Phase | Scope | Risk |
|---|---|---|
| **v4.0** | `sports_games` table + all CHECKs, proven by a **SQL fixture test** first; composite-FK backstop; the per-sport + daily standings views. **No card write changes.** | Low — additive; cards untouched; correctness is pure Postgres, testable locally |
| **v4.1** | Log flow for **TT singles**; per-sport TT standing; combined daily count | Low — simplest UI, no team split |
| **v4.2** | **Doubles UI + padel** (they ship together — padel is 2v2) + **roster memory**; recent-games edit for racquet | Low |
| **v4.3** | `v_partnerships`, sports streaks, head-to-head, per-sport spotlights | Low |

No phase migrates data. No phase touches the card write path. Any phase can ship alone. **Build order
within v4.0:** DDL + CHECKs + SQL fixture *before* any Edge Function or UI — the fiddly correctness
(null-handling `distinct_players`, per-sport score validity) is pure SQL and must be proven in
isolation.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Padel night partially logged → wrong loser** | **Medium (top residual)** | Roster memory (R7) makes full logging cheap; consider "log the night" (R19) if it still bites. No CHECK can catch an omission — this is the one thing to watch |
| Card standings regress | Low (was High) | Cards literally untouched; only shared surface is a read-only view |
| Lost structural guarantee | None (was High) | Flat rows + CHECKs — same guarantee as cards |
| Migration corrupts history | None (was High) | There is no migration |
| Metric confuses players | Low (was High) | Dropped the Loss Index; loss rate ("67%") is the number they already read |
| `distinct_players` null-handling CHECK is subtle | Medium | SQL fixture test covers every null pattern before any UI exists |
| Open-write griefing, bigger surface | Low-Med | Rate limit stays; consider a games/day cap |
| Feature bloat | Medium | §2 non-goals; P2 is design-only |

---

## 12. Open questions

All prior blockers resolved (loss-based ranking, per-sport loss rate, cards untouched, doubles = both
stamped, padel 21, no schedule generation, no cross-sport index). Remaining, none blocking:

| # | Question | Default |
|---|---|---|
| Q1 | Ever play TT to 21? | 11; target is per-sport if needed |
| Q2 | Cap on games/day per IP? | None for now |
| Q3 | Is roster memory enough, or do you want full "log the night" (R19)? | Roster memory first; revisit if nights still go unlogged |

---

## Appendix A — worked examples (test vectors)

**A1. TT singles** — Levi 11 – 7 Rafi → Rafi loses (lower score). Both get `TT games +1`; Rafi
`TT losses +1`.

**A2. TT doubles** — A(Levi,Rafi) 11 – 9 B(Nadhif,Sebas) → **both** Nadhif & Sebas take a TT loss;
Levi & Rafi none. All four get `TT games +1`.

**A3. Padel** — A(Levi,Rafi) 13 – 8 B(Nadhif,Sebas) → both of B take a padel loss. Anyone sitting
out: nothing recorded.

**A4. `11–10` two ways** — as padel: valid (sums 21), the `10` side loses. As TT: rejected (margin 1).
Same numbers, opposite outcomes — the load-bearing unit test.

**A5. Per-sport loss rate** — Nadhif: cards 12/18 lost → **67%** (card board, baseline 25%); padel
6/14 lost → **43%** (padel board, baseline 50%, *beating luck*). Two standings, two legible numbers,
no index to explain.

**A6. Daily loser** — today Levi lost 3 padel rounds + 1 card game = **4**; Nadhif lost 2 card games.
Levi is Loser of the Day at 4. (If Nadhif had also lost 4, the card shows `Levi & Nadhif · tied`.)

**A7. Card standing unchanged** — a card-only player, 20 games, 8 losses → **40%** loss rate, exactly
as v3 renders today. The card board is byte-for-byte the same.
