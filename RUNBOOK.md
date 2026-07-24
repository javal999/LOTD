# LOTD runbook

Short answers to "something needs doing/fixing". Project ref: `ptpijvdsyrlpqwctkzbp`.

## Rotate the admin passcode
Do this if the passcode leaks, or anyone who shouldn't have it does.
```bash
supabase secrets set ADMIN_PASSCODE='a-new-passcode' --project-ref ptpijvdsyrlpqwctkzbp
```
Takes effect within a few seconds — no redeploy, no frontend change. Anyone already unlocked in a
tab keeps the old code in `sessionStorage`, so their next write fails and they re-unlock. Nothing
else to clean up: the passcode is never stored in the database or the repo.

## Export a leaderboard backup
Unlock → **Export**. Downloads `LOTD-<board>-<date>.json` with the roster, every game (date, four
players, loser) and the current standings. The standings can be rebuilt from the games alone —
that's what `js/export.test.mjs` proves. Do this before anything destructive.

## Roll back the frontend
The database is untouched by a frontend rollback.
```bash
vercel ls lotd                      # find the previous good deployment
vercel promote <deployment-url>     # or: Vercel dashboard -> Deployments -> ... -> Promote
```
Or `git revert <bad-commit> && git push` — Vercel redeploys from `master` automatically.

## Rename a leaderboard
Unlock → **Rename**. Safe and instant; nothing else references the name.

## Delete a leaderboard
Unlock → **Delete** → confirm. **Irreversible**: the database cascades and its players and games
go with it. Export first. The confirm dialog tells you exactly how many players and games you're
about to destroy.

## A player is leaving / was added by mistake
Unlock → **Players** → **Delete**. The server decides, not you:
- they have games → **archived** (results stay in the standings, they're not offered for new games)
- they have no games → hard-deleted
Archived players can be **Restored** any time. A player with games can never be hard-deleted — the
foreign key refuses it.

## Fix a wrong result
Unlock → **Recent games** → **Edit** (change the loser) or **Delete** (with confirm). Right after
logging, the toast's **Undo** removes the last game. All of it re-checks the 4-players/1-loser rule.

## The site says "Couldn't load the standings"
Supabase is unreachable or the project is paused. Check
<https://supabase.com/dashboard/project/ptpijvdsyrlpqwctkzbp>. The page keeps showing a Reload
button; no data is lost. Reads are public, so this is never a passcode problem.

## Change the schema
Add a new file under `supabase/migrations/`, then:
```bash
supabase db push --linked
```
Migrations are forward-only here. Test locally first: `supabase start && supabase db reset`.

## Redeploy the write path
```bash
supabase functions deploy admin --project-ref ptpijvdsyrlpqwctkzbp --use-api
```
`--use-api` bundles remotely — local Docker bundling fails under Colima on this machine.

## Local development
```bash
supabase start                      # local stack (analytics disabled — Colima can't run vector)
supabase db reset                   # apply migrations + seed
# the edge runtime can't run under Colima, so serve the function with raw Deno:
eval "$(supabase status -o env)"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  ADMIN_PASSCODE=lotd-local-pass ALLOWED_ORIGIN=http://localhost:8138 \
  deno run -A supabase/functions/admin/index.ts &
python3 -m http.server 8138         # open http://localhost:8138 — config.js auto-targets local
```
Tests: `node --test js/*.test.mjs` and `deno test -A supabase/functions/admin/admin.test.ts`.

## Ship v4 (racquet sports — table tennis + padel)
Additive and backward-compatible: the card game is untouched, so each step is safe on its own and the
live site keeps working between them. Do them in order.
```bash
# 1. Apply the new migrations (sports_games, standings views, board-isolation FKs, partnerships)
supabase db push --linked        # applies 0003–0006
# 2. Deploy the Edge Function (adds log_sports_game + undo/edit/delete; card actions unchanged)
supabase functions deploy admin --project-ref ptpijvdsyrlpqwctkzbp --use-api
# 3. Deploy the frontend (activates the Racquet button + sport standings)
vercel deploy --prod --yes
```
Verify on the live site: the **🏓 🎾 Racquet** button appears, logging a table tennis game stamps the
loser, and the sport standings show. `ADMIN_PASSCODE` is already set, so logging works immediately.
Rollback: `git revert` the frontend commit + redeploy; the added tables/views are inert if unused.
