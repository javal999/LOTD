# Council review — PRD v4 (multi-format games)

**Date:** 2026-07-21 · **Subject:** [PRD-v4-multi-format-games.md](PRD-v4-multi-format-games.md)
**Method:** 5 independent advisors → anonymised peer review → chairman synthesis
**Verdict:** ⛔ **Do not build v4 as specced.** 4 of 5 advisors against; the dissenter was named the
biggest blind spot by 2 of 3 reviewers.

---

## Facts established during review

| Fact | Value | Why it matters |
|---|---|---|
| Games on prod | **67** | The migration I called "the whole ballgame" moves 67 rows. Export + rebuild is a viable alternative to a clever migration. |
| Players on prod | 11 | — |
| Cross-board FK gap **reachable through the app?** | **No** | `log_game` (index.ts:183) validates board membership and is the only insert path. It is a *missing backstop*, not live corruption. **The earlier framing overstated this.** |
| Deferred trigger viable as specced? | **No** | See finding #1. |
| Code pinned to the 4-column shape | app.js 596 · admin 235 · tests 246 | Rewrite surface is real but bounded (~13 `p1..p4` references). |

---

## Finding 1 — the integrity mitigation cannot work as written ⚠️

**The PRD's entire answer to "we lose the CHECK guarantee" is a deferred constraint trigger.**
Two reviewers independently verified this fails:

`supabase/functions/admin/index.ts` writes via sequential `db.from(...).insert(...)`. supabase-js
issues **one PostgREST request per insert, each its own transaction**. A `DEFERRABLE` constraint
trigger therefore fires at the COMMIT of the *first* statement — and rejects a game row that has no
sides yet. The guarantee never gets a chance to be true.

**To get it, the whole write must move into a single Postgres function (RPC).** And not one function:
`undo_last`, `edit_loser`, and `delete_game` all become multi-table too — **four RPCs, not one.**

This is the hardest work in v4 and the PRD does not mention it, budget it, or phase it. R12 and the
risk table both name "deferred trigger" as the mitigation.

> **Impact:** the PRD's central engineering claim — "we trade a structural guarantee for an enforced
> one" — is currently false. As written, we'd trade a guarantee that works for a trigger that cannot
> fire.

---

## Finding 2 — point share is length-independent but **not variance-independent**

Three advisors attacked the central metric independently, from three directions:

- **Statistically:** in TT singles your share is 100% yours; in padel 2v2 with rotating partners it is
  half someone else's, so it **regresses toward 0.50**. Over a season the extremes of the board are
  TT players at both ends and padel-heavy players piled in the middle. **The "biggest loser" becomes
  whoever plays singles most, not whoever is worst.** EC-44 dismisses this as "skills differ"; the
  defect is structural, not skill.
- **Product-wise:** point share ranks the *best* player. It quietly converts a loser-shaming app into
  a performance ladder — a different product with different social dynamics.
- **Comprehension-wise:** "0.611" requires being told that 0.5 is average. It replaces *"Budi lost 14
  times,"* which needed no explanation. **Trading a punchline for a statistic.**

---

## Finding 3 — the joke has no arbitration rule

The product is *one name per day, publicly shamed*. On a day with cards **and** padel **and** table
tennis, **who gets stamped PECUNDANG?** The PRD's §7.3 says "most games lost today" — but in
Americano everyone loses roughly half of 8–11 rounds, while in cards exactly one person loses per
game. The stamp lands on **whoever attended most**: attendance, not failure.

Nobody wrote the rule. Without it, v4 ships three scoreboards and zero pecundang.

Related: in table tennis there is a winner, not a loser — is losing 11–9 trombone-worthy? At padel
13–8, is the pecundang nobody, or both players on the 8 side? Unspecified.

---

## Finding 4 — over-engineered: two shapes, not N

There aren't N game shapes. There are **two**: "2 sides with scores" (TT + padel) and "4 players, 1
loser" (cards). `game → sides → participants` is infrastructure for a third shape nobody has named.

**The 66 edge cases are not domain complexity — most are manufactured by the abstraction.**
`first_to` validation, deferred triggers, composite FKs, property tests: none were problems until the
schema was.

And "the standings have never been wrong" is *why the roast has authority*. The CHECK constraint is a
product feature, not a technical detail.

---

## Where the council clashed

**One advisor (Expansionist) said build bigger** — point share as a moat, multi-tenancy, a WhatsApp
recap card, annual "Wrapped", partnership data as P0.

**Two of three reviewers named it the biggest blind spot:** it reads a broken metric as a moat and
argues growth loops for 11 friends standing in the same room, with zero engagement with execution
reality (one PM, evenings).

**But one idea survives and is genuinely good:** `v_partnerships` — *"you have never won a round with
Sebas"* — is one SQL view and it is the highest-density roast material in the system. **Roasting is
the product.** Promote it; discard the rest of that branch.

**A dissent that was falsified:** one advisor claimed the Edge Function "cannot run locally", making
the write path a 3× cycle-time bottleneck. A reviewer checked [RUNBOOK.md](RUNBOOK.md):66–73 —
`supabase start` + raw `deno run` is documented and working. Only `edge_runtime` and Docker bundling
fail under Colima. That advisor over-cut on a false premise.

---

## The recommendation

**Do not build v4 as specced.** Build this instead, in order:

1. **Composite FK backstop** — ~10 lines against *today's* schema, no v4 required. It's a backstop,
   not a live fire, so it doesn't need to jump the queue — but it's cheap and independent.
2. **Loss Index as a view on the existing schema.** Zero migration. This is the genuinely good idea
   in the PRD and it needs none of the rest of it.
3. **Table tennis as a second rigid table** with its own CHECK constraints and its own board
   (~40–60 lines). Keep the guarantee that makes the standings trustworthy.
4. **`v_partnerships`** — one view, maximum joke-per-line.
5. **Do not unify. Do not migrate the history.** Revisit the general model at sport *four*, not
   sport two.

**Do not** build: point share as the ranking metric (until Finding 2 is answered), `game_types`,
the board-creation form, presets, per-sport breakdown, partner *suggestion*.

**On the 67 games:** the migration is far less scary than framed — but that cuts *against* a
migration-first plan, not for it. With 67 rows, "export, rebuild, re-import" beats a clever
migration, and it makes keeping two rigid tables even cheaper.

---

## The one thing to do first

**Write down, in one sentence, who gets stamped PECUNDANG on a day when the group plays cards *and*
padel.**

If that sentence is easy, one board is right and the metric follows from it. If it's hard — and
Finding 3 suggests it is — then one board was never the goal, two boards are correct, and most of
PRD v4 dissolves. It's a ten-minute decision that determines whether weeks of evenings are worth
spending.

---

## Appendix — advisor positions

| Advisor | Position | Core argument |
|---|---|---|
| **Contrarian** | ⛔ Against | Point share not variance-independent; trigger can't fire; roast rewards attendance |
| **First Principles** | ⛔ Against | Two shapes not N; the CHECK constraint *is* the product; ship Loss Index as a view |
| **Expansionist** | ✅ For, bigger | Point share is a moat; partnerships P0; WhatsApp recap; Wrapped |
| **Outsider** | ⛔ Against | Can't picture the screen; punchline traded for a statistic; 66 rules vs a drunk guy |
| **Executor** | ⛔ Against | Ship the FK now; trigger spike night 2; second table beats generalising |

*Peer review used 3 reviewers rather than 5; the three produced non-redundant reviews including two
independent repo-verified corrections, so additional reviewers would mostly have repeated them.*
