# Council review #2 — PRD v4 (revised / lean)

**Date:** 2026-07-21 · **Subject:** [PRD-v4-multi-format-games.md](PRD-v4-multi-format-games.md) (the rewrite)
**Method:** Feynman pass + 5 advisors → synthesis
**Verdict:** ✅ **Architecture validated.** ⚠️ **The metric is still wrong** — drop the Loss Index.

---

## What all five validated

The **schema** is right and nobody attacked it: one flat `sports_games` table beside the untouched
card table, CHECK constraints keeping the structural guarantee, **no migration**, no deferred trigger.
The first draft's two fatal findings (trigger can't fire, migration risk) are genuinely gone. Cutting
sessions-as-general-machinery, schedule generation, and skill ratings was called "disciplined."

Keep the architecture. The problems are all above it.

---

## Finding 1 — the Loss Index should go (3 advisors, 3 lenses, converging) ⚠️

- **Math (Contrarian):** cards have baseline 0.25 → a maximal card loser hits index **4.0**. Racquet
  baseline 0.5 → a maximal padel loser caps at **2.0**. So the top of the PECUNDANG board is
  *structurally reserved for card players*, and the more the group plays the sports this is being
  built for, the closer everyone drifts to the 0.5-centred middle and the **less** of a loser they
  look. That directly contradicts Goal 3 ("honest across game types").
- **Product (First Principles):** "'Budi lost 14 times' is the punchline; 1.34 is a spreadsheet."
  Note the tell — the **daily stamp already uses raw count** because that's obviously the joke, then
  the all-time board switches to a participation-normalised ratio. Two primitives for one app.
- **Comprehension (Outsider):** "Loss Index is the wall. Nobody at a party does that math. They'll
  see 1.34 and ask what it means, and you'll explain it every time."

**The deeper truth underneath all three:** you cannot have a number that is *both* cross-sport-fair
*and* legible to a party audience. Normalisation buys fairness at the cost of legibility. For a joke
app, legibility wins.

**Resolution:** stop forcing a cross-sport rank. Rank **within each sport** by the simple metric the
group already understands (loss rate, exactly like cards today), and keep the **daily "Loser of the
Day" as raw count across everything** — which nobody expects to be "fair," it's just *who lost most
today*. "One place for the rivalry" survives (all sports in one app, one daily loser); the impossible
"one fair cross-sport number" is dropped.

This also deletes the **point-share tiebreak**, which the Outsider showed is meaningless anyway:
points don't share a scale across cards (none), TT (to 11), and padel (to 21).

---

## Finding 2 — the completeness flaw (the sharpest *new* catch) ⚠️

CHECK constraints guarantee every **row** is valid. They guarantee nothing about **completeness** —
and that's what actually kept the standings perfect.

> A card session is **indivisible**: one game, one loser, logged as a unit or not at all. A padel
> Americano night is **divisible** into 8+ rounds. For the first time the board depends on a human
> logging *every* unit, mid-sweat, ~25 s each, with no session to hold the roster. **They won't.**
> You'll get rounds 1, 2, and 5. Partial logging throws no constraint error — the DB can't see an
> omission — and produces a *confidently wrong* loser.

The thing that has never been wrong breaks not from a bug but from an omission no CHECK can catch.

**Fix:** roster memory is not P2, it's the difference between used and abandoned. Minimum: "remember
tonight's players" so an 8-round night doesn't re-pick 4 people eight times. Better: log the **night**
(a padel session = one entry with a fixed roster and N round-scores).

---

## Finding 3 — a build-sequencing bug (Executor)

**Padel is inherently doubles** (needs the split-teams UI deferred to v4.2), but v4.1 is "TT singles
+ padel." As written, **v4.1 can't ship.** Fix: move padel to v4.2, or pull the pick-4-and-split
flow into v4.1.

**And the right Monday step:** write the `sports_games` DDL with all CHECKs, `supabase start`, and
throw a SQL fixture of ~20 valid/invalid INSERTs at it — asserting which reject. Zero edge runtime
needed; the fiddly correctness (null-handling `distinct_players`, per-sport score validity) is pure
Postgres and runs locally. Don't debug null-handling through a UI you haven't built.

---

## Finding 4 — don't over-cut the roasts (Expansionist)

The plan keeps the plumbing and defers the payload. `v_partnerships` ("you've never won a round with
Sebas since March") and head-to-head are **not stats — they're joke generators**, and they're the one
thing an event/scheduling app physically cannot build. Roasting is the product; at least one belongs
earlier than P1. A **losing-streak counter** ("3 days running") is nearly free, history-native roast
fuel. *(The growth-loop / WhatsApp-share / multi-tenant ambition is noted but out of scope for 11
friends — the first council flagged that same advisor as over-reaching.)*

---

## Recommendation

Keep the schema exactly as specced. Change three things:

1. **Drop the Loss Index and the point-share tiebreak.** Rank each sport by its own **loss rate**
   (today's card logic, per game type); daily "Loser of the Day" stays **raw count** across all. The
   all-time spotlight becomes per-sport ("biggest card loser", "biggest padel loser") — funnier and
   legible.
2. **Move roster memory into v4.1/4.2** (min: remember tonight's players). Without it, padel nights
   get partially logged and the loser is silently wrong.
3. **Fix the sequencing:** padel ships with doubles, and the first build step is a SQL-fixture test
   of the CHECK constraints.

Net effect: even simpler than the current lean PRD, and it removes the last "spreadsheet" from a joke
app.

## The one thing to decide

**How is the all-time biggest loser ranked across three sports?** (This is Finding 1.) Everything
else is mechanical. Recommendation: per-sport loss rate + a combined daily raw count — *not* a unified
index.
