# Development plan — Daily Reveal + WhatsApp share

**Status:** Proposal for review (nothing built yet) · **Date:** 2026-07-28

The all-time loss-rate table is always on, so whoever's worst wears the badge every time they open the
app — and the fun drained out. This turns the day's result into a **scheduled reveal**: standings are
hidden behind a locked teaser until **5pm** (device-local, per-board), then flip open. A one-tap **Share**
button pushes a result card straight to the WhatsApp group. The admin can peek early with a private
password.

**Decisions locked with Levi (2026-07-28):**
- **Logging stays open to everyone** — the public confess word (`pecundang`) is unchanged; members log all
  day exactly as today. `goyangdumang77` is a **separate, private** admin password used *only* to view
  results before 5pm. It is never shipped in the client.
- **The gate hides everything** — both the all-time table and today's result — until reveal. Before then you
  see a locked teaser; logging still works.
- **Blast = one-tap share to WhatsApp.** Fully-automatic zero-tap posting to a WhatsApp *group* is not
  possible via any sanctioned API, so the reveal shows a **Share** button that opens WhatsApp with the card
  ready; you pick the group and send.

**Assumptions (flag if wrong):**
- Reveal time is **device-local**, default **17:00**, stored per-board (changeable in board settings, no
  redeploy). Fine for a single-timezone group (WIB).
- Before reveal: teaser shows the day's game count only — e.g. "🔒 4 games played today · results at 5pm".
- No games that day → reveal/blast says "No games today".
- The blast card headlines **today's biggest loser** (the daily LOTD), not the all-time ranking.

---

## 1. The two passwords (minimal, additive — existing auth untouched)

| Word | Who has it | What it does | Where it lives |
|---|---|---|---|
| `pecundang` (unchanged) | everyone | Log games + manage (exactly as today) | Hardcoded in client (public by design) + server `ADMIN_PASSCODE` |
| `goyangdumang77` (**new**) | Levi only | **Unlock early viewing** before 5pm | Server env `ADMIN_VIEW_PASSCODE` only — **never** in the client bundle |

The existing write path is **not changed at all** — members log and manage with the public word as today.
The private word is a pure add-on that gates one thing: seeing results before the reveal time. It cannot be
hardcoded client-side (that would make it public), so it is verified by the Edge Function.

> Out of scope (noted, not built): locking destructive actions (delete board/player) behind the private
> word. That's a separate hardening we can do later; today's model already lets anyone with the public word
> manage, and this plan doesn't regress that.

## 2. Reveal gate — a client-side soft curtain

`revealed = (now.getHours() >= board.reveal_hour) || viewEarlyUnlocked`

- **Not revealed:** render a **locked card** in place of the spotlights + tables:
  `🔒 Hasil disembunyikan · N game hari ini · buka jam ${reveal_hour}:00`, plus a small
  "Lihat sekarang (admin)" link. The log buttons stay exactly where they are — logging is unaffected.
- **Revealed:** render normally (spotlights + all tables), plus the **Share** button (§4).

This is an **honor-system hide**: the standings rows are still readable by anyone holding the anon key
(RLS makes all reads public — by design). For a friend group nobody is going to hit the REST API at 4pm to
peek, so a client-side curtain is the right call; it is explicitly *not* a cryptographic gate. (Levi already
signed off on the soft-curtain approach.)

## 3. Early-view unlock (admin only)

On the locked card, "Lihat sekarang (admin)" opens a small password sheet:
1. Admin types `goyangdumang77`.
2. Client calls new Edge Function action `verify_view` → returns `{ ok: true }` iff it matches
   `ADMIN_VIEW_PASSCODE` (constant-time compare, same per-IP lockout as the write path).
3. On success, client sets `sessionStorage['lotd.viewEarly'] = '1'` and re-renders → results shown.
   Wrong word → the sheet shows an error and nothing reveals.

The flag is per-tab and clears when the tab closes — a fresh visit is locked again until 5pm.

## 4. The 5pm blast — one-tap WhatsApp share

A **Share** button appears once revealed (and in the post-log flow — see below).

- **Card image:** generated client-side on a `<canvas>` (no dependency), in the pecundang-stamp aesthetic —
  board name, date, "PECUNDANG HARI INI", the loser name(s), their loss count, and a random roast line.
  Exported via `canvas.toBlob()` → a PNG `File`.
- **Share:** `navigator.share({ files: [png], text: caption, title: 'LOTD' })`, guarded by
  `navigator.canShare?.({ files: [png] })`. On a phone this opens the share sheet → pick WhatsApp → pick the
  group → send (one tap + pick). Caption e.g.
  `🃏 LOTD · 28 Jul — Pecundang hari ini: *Levi* (3 kekalahan) 😈`.
- **Fallback** (desktop / no Web Share): download the PNG and copy the caption, with a hint to drop it in the
  group manually.

Optional nicety: also surface Share right after a game is logged (the pecundang stamp already shows) so the
scorekeeper can blast the moment without waiting — decide during build.

## 5. Data model

```sql
alter table leaderboards
  add column reveal_hour int not null default 17 check (reveal_hour between 0 and 23);
```
One column. `17` = 5pm. No new tables.

## 6. Edge Function

- New env `ADMIN_VIEW_PASSCODE` (set via `supabase secrets set`).
- New action `verify_view`: `passcodeMatches(payload_or_passcode, ADMIN_VIEW_PASSCODE)` → `{ ok, data:{ canView:true } }` or 401. Runs through the same IP lockout. **No DB access, no writes** — pure check.
- `create_leaderboard` / `rename_leaderboard`: accept an optional `reveal_hour` (validated 0–23), same shape
  as the existing `points_target` handling.

## 7. Client changes

- `js/api.js`: `verifyViewPasscode(pw)` → `call('verify_view', {}, pw)`; thread `reveal_hour` through
  create/rename + `listLeaderboards` select; mock support (mock always "reveals", or honors a fake hour).
- `js/app.js`:
  - `boardRevealHour()` helper; `isRevealed()` = past hour OR `sessionStorage` viewEarly flag.
  - `render()`: when not revealed, swap the spotlights + tables for the locked card; keep the log bar.
  - `openViewUnlock()` sheet (the admin peek).
  - `shareResultHTML()` + `drawResultCard()` (canvas) + `shareResult()` (Web Share).
  - Board settings sheet: add a "Results reveal time" hour field (0–23, default 17).
- `js/config.js`: unchanged (the private word is never here).

## 8. Edge cases (end-to-end)

**Reveal timing**
- **`reveal_hour = 0`** → always revealed (a board that opts out of hiding). Careful in code: gate on
  `hour >= reveal_hour`, and treat `reveal_hour` with `?? 17` (never `|| 17`, which would swallow 0).
- **Crossing 5pm with the app open:** render reads `new Date().getHours()` at render time, so a passive tab
  won't flip on its own. We schedule a one-shot timer to re-render at today's `reveal_hour:00` when the
  board is hidden-by-time, so it reveals live without a manual refresh. Cleared/reset each render (no
  stacking); not scheduled when already revealed or early-viewed.
- **Timezone:** device-local. A group split across zones each sees their own 5pm. Fine for WIB.

**What shows when**
- **No players yet:** show the normal "add players" empty state, **not** the locked card — you must be able
  to manage a fresh board. The gate only replaces the *standings* view, and only once players exist.
- **No games today, revealed:** spotlights show "No games today" (existing); the **Share button is hidden**
  (nothing to blast).
- **Logging while hidden:** unaffected — pick players, enter scores, no standings needed. The post-log
  pecundang stamp still shows *that game's* loser, which the logger just typed, so it leaks nothing about
  the aggregate standings.
- **Admin management vs early-view are independent:** unlocking management (public word) shows the
  New/Edit/Players toolbar but does **not** reveal standings early. Only the private word (via `verify_view`)
  reveals early. Both states can be on at once.
- **Americano runner stays live (decision):** the reveal gate covers the board's resting view + the session
  resume banner's summary. An *actively opened* Americano runner keeps its live "tonight" standings — it's a
  deliberately-opened scorekeeping surface and the live leaderboard is its whole point. (Flagged for Levi: if
  you'd rather padel nights stay hidden until 5pm too, it's a small follow-up.)

**Blast / share**
- **Ties today:** card + caption list all tied names ("Levi & Budi").
- **Web Share unavailable** (desktop / unsupported): fall back to downloading the PNG and copying the caption.
- **User cancels the share sheet:** `navigator.share` rejects with `AbortError` — caught and ignored.
- **Long names on the card:** clamp font size / truncate so the card never overflows.
- **Backdated games:** a game logged today but dated yesterday counts under yesterday; the reveal + blast are
  keyed on `game_date == today`, matching the existing "Today's biggest loser".

**Security / auth**
- **`verify_view` is its own auth realm** — it checks `ADMIN_VIEW_PASSCODE`, *not* the write passcode, so it
  runs as an early branch before the write-passcode gate (else the private word would 401 against the public
  one). It shares the per-IP lockout to stop brute-forcing.
- **Fail-closed:** if `ADMIN_VIEW_PASSCODE` is unset on the server, `verify_view` always 401s — early view is
  simply unavailable, never silently open.
- **Still a soft curtain:** standings remain anon-readable via the raw REST API. Accepted — friend-group
  scope, not a vault.

## 9. Out of scope (explicitly not building)

- Season / weekly reset (Levi said no).
- Fully-automatic WhatsApp group posting / Telegram / Discord auto-post.
- Server-side (RLS) enforcement of the hide — it stays a client curtain.

## 10. Operational / deploy (Levi runs)

1. `supabase secrets set ADMIN_VIEW_PASSCODE=goyangdumang77`
2. `supabase db push --linked` (the `reveal_hour` migration)
3. `supabase functions deploy admin --use-api`
4. `vercel deploy --prod`

## 11. Suggested build order

1. Migration (`reveal_hour`) + fixture.
2. Edge Function (`verify_view` + `reveal_hour` on create/rename) + Deno test.
3. Client reveal gate + locked card + early-view unlock.
4. Share card (canvas) + Web Share button.
5. Browser E2E under `?mock=1`; commit; hand over deploy commands.
