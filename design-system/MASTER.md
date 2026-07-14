# Design System — Card Standings Tracker (MASTER)

Source of truth for the frontend. Every screen inherits these tokens; style from
`var(--…)`, never hardcoded hex. Reconciles: design-directions `consumer-loyalty`
(Fraunces + Plus Jakarta Sans, warm) + ui-ux-pro-max structural guidance
(flat/touch-first, tabular figures, a11y). Register: **product mode** (a tool used
mid-game), not a marketing page.

## Brief (anti-slop step 1)
- **Product:** shared scoreboard for a fixed group's 4-player, 1-loser card game.
- **Audience/context:** 4–8 friends, on phones, at the table, glance-and-go.
- **One adjective:** **convivial** — warm, social, a little celebratory, still crisp.
  Directly serves the PRD worry that a "loser board" can sour the game.
- **Density:** data-light (≤8 players). Generous spacing, big numerals, no dense grid.

## The one job (per screen)
- **Standings (home):** read the table at a glance. Focal = ranked list + *your* row + the skill number (loss rate).
- **Log game (admin):** tap the 1 loser in ≤3 taps. Focal = the 2×2 player tiles.

## Hierarchy
1. Standings list (rank medallion, name, the active-sort number)
2. Sort toggle (games-not-lost ↔ lowest loss rate) + 25% luck-line context
3. Loser-of-the-night chip
4. Admin controls (log/undo/edit/export/season) — subordinate, passcode-gated

## Type
- **Display / headers / hero numerals:** Fraunces (500–600). Warm, premium, ownable.
- **Body / UI / data columns:** Plus Jakarta Sans (400 body, 500 labels, 600–700 emphasis). **Always `font-variant-numeric: tabular-nums`** on any number.
- Scale (px): 12 caption · 14 small · 16 body · 20 h3 · 24 h2 · 32 data-lg · 44 display.
- Line-height 1.5 body; ~1.15 on display/numerals.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## Color tokens
Warm paper + felt green + antique gold + terracotta. **No blue/purple** (AI-default tell).

```css
:root {
  --paper:#F6F2EA; --surface:#FFFFFF; --surface-2:#F0EBE0;
  --ink:#1B1917; --ink-2:#6E665A;
  --felt:#16704A; --felt-ink:#FFFFFF;   /* brand green: active, "beats luck" */
  --gold:#9A6F1E; --gold-bg:#F3E6C4;     /* leader / celebratory (text-safe gold) */
  --clay:#A8442B;                         /* losses / danger — warm, not harsh */
  --line:#E7E0D2; --ring:#16704A;
  --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-pill:999px;
  --shadow-card:0 1px 2px rgba(27,25,23,.04), 0 10px 28px rgba(27,25,23,.06);
  --space:8px; /* scale: 4 8 12 16 24 32 48 */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:#151310; --surface:#1E1B16; --surface-2:#26221B;
    --ink:#F1ECE1; --ink-2:#A79C89;
    --felt:#46B183; --felt-ink:#0E1A13;
    --gold:#E0BE6E; --gold-bg:#3A2F16;
    --clay:#E07B58;
    --line:#322C24; --ring:#46B183;
    --shadow-card:0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.35);
  }
}
```
Verify AA (4.5:1 text, 3:1 large/UI) in both themes before ship. Gold is used as a
badge/large accent, not body text.

## Signature elements (what makes it recognizable)
- **Coin rank medallion** — circular rank badge; #1 = gold fill, others = neutral felt ring. Tabular numeral inside.
- **Felt cards** — surfaces with a hairline top highlight; soft single-elevation shadow only.
- **Fraunces hero numeral** — the active-sort number rendered large in Fraunces; columns stay Jakarta tabular.
- **"Tonight" chip** — the loser-of-the-night, framed lightly (a wink, not a pillory).

## Components
- **Standings row:** medallion · name (Jakarta 600) · GP · L (clay) · games-not-lost · loss-rate% (bold). Active-sort column emphasized. `<table>` with `aria-sort`.
- **Sort toggle:** segmented control, 2 options, current = felt fill + `aria-pressed`.
- **Legend / luck line:** one line — "A win is any game you didn't lose." + a 25% marker explained. Below-luck rows get a subtle felt tint + a text/icon marker (never color alone).
- **"Not enough games yet":** grouped below ranked players (5-game threshold), raw numbers shown, no rank.
- **Log-game loser grid:** 2×2 player tiles, tap-to-select 1, press scale 0.97, selected = clay ring + label. Save disabled until exactly 1 selected. ≥44px targets, 8px gaps.
- **Admin bar / passcode sheet:** bottom sheet for passcode (type=password, no autocomplete-store); unlocked state reveals Log/Undo/Edit/Export/Season.
- **Undo toast:** after save, "Logged — Xs" with Undo; aria-live polite; auto-dismiss ~5s.

## States (design all, not just happy path)
- **Empty:** no games → "No games yet. Log your first one." (admin CTA / viewer note).
- **Loading:** skeleton rows, not a spinner.
- **Error:** Supabase unreachable → banner, keep last good data, retry.
- **Single/low sample:** loss-rate mode may be empty early → default to games-not-lost until ≥2 players cross 5 games.
- **Read-only (viewer):** no edit controls; a quiet "Unlock to log" affordance.

## Motion (respect prefers-reduced-motion)
- Press: scale 0.97, 120ms. Enter: 150–200ms ease-out. Toggle: crossfade. No decorative motion; animate ≤2 elements per view.

## Non-negotiables (checklist inherited into build)
- SVG icons only (Lucide), never emoji. One icon set, consistent stroke.
- Tabular numerals on all data. Touch targets ≥44px, 8px spacing.
- Focus rings visible. Color never the sole signal. Both themes tested.
- No AI-slop tells: no blue/purple gradient, no glassmorphism, no shadow-as-decoration, no even 3-card hero, no emoji icons, no hedge copy.
