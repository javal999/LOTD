import * as api from './api.js';
import { buildExport } from './export.mjs';
import {
  computeStandings, computeSportStandings, computePadelStandings, biggestLoserAllTime,
  biggestLoserToday, fewestPointsPadelToday, losingStreak,
  MODES, LUCK_BASELINE, LUCK_BASELINE_SPORT, MIN_GAMES_FOR_RATE,
} from './ranking.mjs';
import { generateSchedule, suggestedRounds, matchesPerRound } from './americano.mjs';

// Sport metadata: label, icon, players-per-side, and the round-length hint for padel.
const SPORTS = {
  tt_singles: { label: 'Table tennis · singles', icon: '🏓', perSide: 1, total: null },
  tt_doubles: { label: 'Table tennis · doubles', icon: '🏓', perSide: 2, total: null },
  bd_singles: { label: 'Badminton · singles',    icon: '🏸', perSide: 1, total: null },
  bd_doubles: { label: 'Badminton · doubles',    icon: '🏸', perSide: 2, total: null },
  padel:      { label: 'Padel · Americano',      icon: '🎾', perSide: 2, total: 21 },
};
const SPORT_ORDER = ['tt_singles', 'tt_doubles', 'bd_singles', 'bd_doubles', 'padel'];

// Client-side score check mirroring the server + DB. Returns null if valid, else a short reason.
// `padelTarget` is this board's points-per-round (default 21); ignored for non-padel sports.
function sportScoreError(sport, a, b, padelTarget = 21) {
  if (a === '' || b === '' || a == null || b == null) return 'enter both scores';
  a = Number(a); b = Number(b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'whole numbers only';
  if (a === b) return 'someone has to win';
  if (sport === 'padel') return a + b === padelTarget ? null : `must total ${padelTarget} (now ${a + b})`;
  if (sport === 'bd_singles' || sport === 'bd_doubles') {   // badminton: first to 21, win by 2, cap 30
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi === 21 && lo <= 19) return null;
    if (hi > 21 && hi <= 30 && hi - lo === 2) return null;
    if (hi === 30 && lo === 29) return null;
    if (hi < 21) return 'first to 21';
    if (hi > 30) return 'caps at 30';
    return 'win by 2 (or 30–29)';
  }
  const hi = Math.max(a, b), lo = Math.min(a, b);   // table tennis: first to 11, win by 2
  if (hi === 11 && lo <= 9) return null;
  if (hi > 11 && hi - lo === 2) return null;
  if (hi < 11) return 'first to 11';
  if (hi === 11 && lo === 10) return 'win by 2 from 10–10';
  return 'not a valid score';
}

// ---- state ----
const LAST_BOARD = 'lotd.lastBoard';
let boards = [];      // [{id, name}]
let boardId = null;
let data = null;      // { standings, games, players }
let mode = MODES.HIGHEST_LOSS_RATE;  // default to the skill view — worst first, like the spotlight
let error = null;
let revealTimer = null;              // one-shot timer that flips a hidden board open at its reveal hour

// The confess-word. Typing "<name> pecundang" in the log box both names the loser and
// proves the shared secret to the server, so no separate unlock is needed to log a game.
// On the live backend, set ADMIN_PASSCODE to this exact word (`supabase secrets set`).
const LOSER_WORD = 'pecundang';

// ---- helpers ----
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const pct = (r) => `${Math.round(r * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg class="ic" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';

const ALL_GAME_TYPES = ['cards', 'tt_singles', 'tt_doubles', 'padel'];
const boardName = () => boards.find((b) => b.id === boardId)?.name ?? '';
const boardTypes = () => boards.find((b) => b.id === boardId)?.game_types ?? ALL_GAME_TYPES;
const hasType = (t) => boardTypes().includes(t);
const hasAnyRacquet = () => SPORT_ORDER.some((s) => hasType(s));
// This board's Americano points-per-round (default 21 if never set).
const boardPoints = () => boards.find((b) => b.id === boardId)?.points_target ?? 21;
// Daily Reveal: the hour (0–23) this board flips its standings open. `?? 17`, never `|| 17` (0 is valid).
const boardRevealHour = () => boards.find((b) => b.id === boardId)?.reveal_hour ?? 17;
// The admin proved the private view password this tab → may peek before the reveal hour (all boards).
const VIEW_KEY = 'lotd.viewEarly';
const viewedEarly = () => sessionStorage.getItem(VIEW_KEY) === '1';
const isRevealed = () => new Date().getHours() >= boardRevealHour() || viewedEarly();
// A padel-only board uses the Americano points leaderboard, not the loss-rate tables. A legacy
// multi-type board (e.g. the mock demo) keeps the loss-rate tables for every sport it plays.
const isPadelBoard = () => { const t = boardTypes(); return t.length === 1 && t[0] === 'padel'; };

// Game-type picker shared by New + Edit board. Three user-facing choices; table tennis maps to both
// singles and doubles. `selected` is the granular list. Read back with readGameTypes().
const GT_GROUPS = [
  { key: 'cards', label: '🃏 Card game', types: ['cards'] },
  { key: 'tt', label: '🏓 Table tennis', types: ['tt_singles', 'tt_doubles'] },
  { key: 'badminton', label: '🏸 Badminton', types: ['bd_singles', 'bd_doubles'] },
  { key: 'padel', label: '🎾 Padel', types: ['padel'] },
];
function gameTypePickerHTML(selected) {
  // One game per board: a single-choice radio. `selected` is the granular list; find its group.
  const chosen = GT_GROUPS.find((g) => g.types.every((t) => selected.includes(t)))?.key ?? 'cards';
  return `<p class="field-label">What do you play here?</p><div class="gt-picker" id="gt">${GT_GROUPS.map((g) =>
    `<label class="gt-opt${g.key === chosen ? ' on' : ''}"><input type="radio" name="gt" value="${g.key}"${g.key === chosen ? ' checked' : ''}><span>${g.label}</span></label>`).join('')}</div>`;
}
function readGameTypes(box) {
  const sel = box.querySelector('#gt input[name="gt"]:checked');
  return GT_GROUPS.find((g) => g.key === sel?.value)?.types ?? ['cards'];
}
// Points-per-round field, only meaningful for padel (Americano). Shown when padel is the choice.
function pointsFieldHTML(points, selectedTypes) {
  const show = selectedTypes.includes('padel');
  return `<div class="pt-wrap" id="ptwrap"${show ? '' : ' hidden'}>
    <p class="field-label">Points per round · Americano</p>
    <input class="field" id="pt" type="number" inputmode="numeric" min="6" max="99" value="${points ?? 21}">
    <p class="sheet-sub">Every round's two scores add up to this — e.g. 21. Set it once, per board.</p></div>`;
}
// The chosen points target, or null when the board isn't padel (so non-padel boards store no target).
function readPoints(box) {
  if (box.querySelector('#gt input[name="gt"]:checked')?.value !== 'padel') return null;
  const v = Number(box.querySelector('#pt')?.value);
  return Number.isInteger(v) && v >= 6 && v <= 99 ? v : 21;
}
// Highlight the chosen row and reveal the points field only for padel. A radio always has exactly
// one selected, so Create stays enabled.
function wireGamePicker(box, goBtn) {
  const ptwrap = box.querySelector('#ptwrap');
  const sync = () => {
    box.querySelectorAll('.gt-opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked));
    if (ptwrap) ptwrap.hidden = box.querySelector('#gt input[name="gt"]:checked')?.value !== 'padel';
    goBtn.disabled = false;
  };
  box.querySelectorAll('#gt input[name="gt"]').forEach((r) => r.addEventListener('change', sync));
  sync();
}

const nameOf = (id) => data?.players.find((p) => p.id === id)?.name ?? '?';
const activePlayers = () => (data?.players ?? []).filter((p) => !p.archived);
const archivedPlayers = () => (data?.players ?? []).filter((p) => p.archived);

// ---- data ----
async function loadBoard() { data = boardId ? await api.loadBoard(boardId) : null; }

// Full reload. To avoid a two-hop wait (fetch the board list, THEN the board's data), we fire the
// remembered board's data in parallel with the list — on the common path (a returning user opening
// the same board as last time) the table lands in one round-trip. If the remembered id turns out to
// be gone, the optimistic result is discarded and we fetch the real board (the wasted request ran in
// parallel, so it cost no extra wall-time).
async function refresh() {
  const remembered = Number(localStorage.getItem(LAST_BOARD)) || null;
  try {
    const boardsP = api.listLeaderboards();
    const optimisticP = remembered ? api.loadBoard(remembered).catch(() => null) : null;

    boards = await boardsP;
    boardId = boards.some((b) => b.id === remembered) ? remembered : (boards[0]?.id ?? null);

    if (boardId && boardId === remembered && optimisticP) {
      data = await optimisticP;                                 // optimistic hit — no second round-trip
      if (data === null) data = await api.loadBoard(boardId);   // the parallel load errored; fetch it now
    } else {
      data = boardId ? await api.loadBoard(boardId) : null;     // no/stale remembered id → fetch the real one
    }
    error = null;
  } catch (e) { error = e.message; }
  render();
}
async function switchBoard(id) {
  boardId = Number(id);
  localStorage.setItem(LAST_BOARD, String(boardId));
  try { await loadBoard(); error = null; } catch (e) { error = e.message; }
  render();
}

// Run a write. On failure, surface the server's message and change nothing. A bad passcode
// re-locks, so the admin isn't left thinking they're unlocked.
async function attempt(errEl, fn) {
  try { await fn(); return true; }
  catch (e) {
    if (errEl) errEl.textContent = e.message;
    if (/passcode/i.test(e.message)) { api.lock(); render(); }
    return false;
  }
}

// ---- sheets ----
function openSheet(box) {
  const overlay = el('<div class="overlay"></div>');
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc2); };
  function esc2(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', esc2);
  return close;
}

function openPasscode() {
  const box = el(`<div class="sheet"><h2>Unlock to manage</h2>
    <p class="sheet-sub">Enter the admin passcode. Only the scorekeeper changes results — it's checked by the server and kept for this tab only.</p>
    <input class="field" type="password" id="pc" placeholder="Passcode" autocomplete="off">
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="go">Unlock</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#pc');
  const submit = () => { if (input.value) { api.unlock(input.value); close(); render(); } else input.focus(); };
  box.querySelector('#go').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

function openNewBoard() {
  const box = el(`<div class="sheet"><h2>New leaderboard</h2>
    <p class="sheet-sub">Each leaderboard has its own players and games.</p>
    <input class="field" id="n" placeholder="e.g. Padel Jumat" autocomplete="off">
    ${gameTypePickerHTML(['cards'])}
    ${pointsFieldHTML(21, ['cards'])}
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="go">Create</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#n'), go = box.querySelector('#go');
  wireGamePicker(box, go);
  go.addEventListener('click', async () => {
    if (!input.value.trim()) return input.focus();
    const types = readGameTypes(box);
    if (!types.length) return;
    const created = await attempt(box.querySelector('#err'), async () => {
      const b = await api.createLeaderboard(input.value.trim(), types, readPoints(box));
      localStorage.setItem(LAST_BOARD, String(b.id));
    });
    if (created) { close(); await refresh(); }
  });
  input.focus();
}

function openRenameBoard() {
  const box = el(`<div class="sheet"><h2>Board settings</h2>
    <p class="field-label">Name</p>
    <input class="field" id="n" value="${esc(boardName())}" autocomplete="off">
    ${gameTypePickerHTML(boardTypes())}
    ${pointsFieldHTML(boardPoints(), boardTypes())}
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="go">Save</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#n'), go = box.querySelector('#go');
  wireGamePicker(box, go);
  go.addEventListener('click', async () => {
    if (!input.value.trim()) return input.focus();
    const types = readGameTypes(box);
    if (!types.length) return;
    const okd = await attempt(box.querySelector('#err'), () => api.renameLeaderboard(boardId, input.value.trim(), types, readPoints(box)));
    if (okd) { close(); await refresh(); }
  });
  input.focus(); input.select();
}

function openDeleteBoard() {
  const n = data?.games?.length ?? 0;
  const box = el(`<div class="sheet"><h2>Delete “${esc(boardName())}”?</h2>
    <p class="sheet-sub">This permanently deletes its <b>${(data?.players?.length ?? 0)} players</b> and
    <b>${n} game${n === 1 ? '' : 's'}</b>. It can't be undone — export first if you want a backup.</p>
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Keep</button>
    <button class="btn-danger" id="go">Delete forever</button></div></div>`);
  const close = openSheet(box);
  box.querySelector('#go').addEventListener('click', async () => {
    const okd = await attempt(box.querySelector('#err'), () => api.deleteLeaderboard(boardId));
    if (okd) { localStorage.removeItem(LAST_BOARD); boardId = null; close(); await refresh(); }
  });
}

function openPlayers() {
  const box = el(`<div class="sheet"><h2>Players</h2>
    <p class="sheet-sub">Deleting a player who has games archives them instead — their results stay in the standings.</p>
    <div class="chips" style="gap:8px">
      <input class="field" id="n" placeholder="Add a player" autocomplete="off" style="flex:1;margin:0;min-width:0">
      <button class="mini-btn go" id="add" style="height:48px">Add</button>
    </div>
    <p class="sheet-error" id="err"></p>
    <div class="rows" id="rows"></div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Done</button></div></div>`);
  const close = openSheet(box);
  const err = box.querySelector('#err');
  const rows = box.querySelector('#rows');

  function draw() {
    const act = activePlayers(), arc = archivedPlayers();
    rows.innerHTML = `
      <p class="field-label">Active (${act.length})</p>
      ${act.length ? act.map((p) => `<div class="row-item"><div class="row-main"><div class="row-title">${esc(p.name)}</div></div>
        <div class="row-actions"><button class="mini-btn danger" data-del="${p.id}">Delete</button></div></div>`).join('')
        : '<p class="row-empty">None yet.</p>'}
      ${arc.length ? `<p class="field-label">Archived (${arc.length})</p>` + arc.map((p) => `<div class="row-item"><div class="row-main">
        <div class="row-title">${esc(p.name)}</div><div class="row-sub">kept in standings, not selectable</div></div>
        <div class="row-actions"><button class="mini-btn go" data-restore="${p.id}">Restore</button></div></div>`).join('') : ''}`;
  }

  box.querySelector('#add').addEventListener('click', async () => {
    const input = box.querySelector('#n');
    if (!input.value.trim()) return input.focus();
    const okd = await attempt(err, () => api.addPlayer(boardId, input.value.trim()));
    if (okd) { input.value = ''; err.textContent = ''; await refresh(); draw(); }
  });
  rows.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    err.textContent = '';
    if (t.dataset.del) {
      const okd = await attempt(err, async () => {
        const r = await api.deletePlayer(Number(t.dataset.del));
        err.textContent = r.archived ? 'They had games, so they were archived (results kept).' : '';
      });
      if (okd) { await refresh(); draw(); }
    } else if (t.dataset.restore) {
      const okd = await attempt(err, () => api.restorePlayer(Number(t.dataset.restore)));
      if (okd) { await refresh(); draw(); }
    }
  });
  draw();
}

// Log a game by confession: type "<name> pecundang" to name the loser, then pick the 3
// others who played. The loser is auto-included as the 4th player — they were obviously in
// the game they lost. No unlock needed: the confess-word itself is the secret.
function openLog() {
  const act = activePlayers();
  const today = api.localToday();
  ensureAudio();  // prime audio on this user gesture so the loser jingle can play on save

  if (act.length < 4) {
    const box = el(`<div class="sheet"><h2>Log a game</h2>
      <p class="warn">This leaderboard has ${act.length} active player${act.length === 1 ? '' : 's'}.
      A game needs exactly 4 — add more players first.</p>
      <div class="sheet-actions"><button class="btn-ghost" data-close>Close</button></div></div>`);
    openSheet(box);
    return;
  }

  let loser = null;   // player id, parsed from the confess box
  let others = [];    // up to 3 other player ids who played

  const box = el(`<div class="sheet sheet-log">
    <h2 class="pec-title">Siapa pecundangnya?</h2>
    <input class="field pec-input" id="pec" placeholder="${esc(act[0].name)} ${LOSER_WORD}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <p class="sheet-sub pec-sub" id="hint">Ketik <b>nama + ${LOSER_WORD}</b> — yang kalah ketebak otomatis.</p>
    <div id="rest" hidden>
      <div class="loser-card" id="losercard"></div>
      <p class="pick-label">Yang ikut main <span class="pick-count" id="pickcount">pilih 3</span></p>
      <div class="chips chips-lg" id="chips"></div>
      <button type="button" class="date-toggle" id="datetoggle">🗓️ <span id="datelabel">Hari ini</span> · <u>ubah tanggal</u></button>
      <div class="date-wrap" id="datewrap" hidden>
        <input class="field" type="date" id="d" value="${today}" max="${today}">
      </div>
    </div>
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions">
      <button class="btn-ghost" data-close>Batal</button>
      <button class="btn-primary" id="save" disabled>Simpan</button>
    </div></div>`);
  const close = openSheet(box);
  const pec = box.querySelector('#pec'), hint = box.querySelector('#hint');
  const rest = box.querySelector('#rest'), losercard = box.querySelector('#losercard');
  const chips = box.querySelector('#chips'), save = box.querySelector('#save');
  const dateEl = box.querySelector('#d'), err = box.querySelector('#err');
  const pickcount = box.querySelector('#pickcount');
  const datetoggle = box.querySelector('#datetoggle'), datewrap = box.querySelector('#datewrap'), datelabel = box.querySelector('#datelabel');

  // "Budi Santoso pecundang" -> the active player named "Budi Santoso" (case-insensitive),
  // or null. The last word must be the confess-word; everything before it is the name.
  const parseLoser = (val) => {
    const parts = val.trim().split(/\s+/);
    if (parts.length < 2 || parts[parts.length - 1].toLowerCase() !== LOSER_WORD) return null;
    const name = parts.slice(0, -1).join(' ').toLowerCase();
    return act.find((p) => p.name.toLowerCase() === name) ?? null;
  };

  function drawChips() {
    chips.innerHTML = act.filter((p) => p.id !== loser).map((p) => {
      const on = others.includes(p.id);
      const full = others.length >= 3 && !on;
      return `<button class="chip${on ? ' on' : ''}" data-id="${p.id}" aria-pressed="${on}"${full ? ' disabled' : ''}>${esc(p.name)}</button>`;
    }).join('');
    const done = others.length === 3;
    pickcount.textContent = done ? 'siap ✓' : `${others.length}/3`;
    pickcount.classList.toggle('done', done);
  }
  const sync = () => { save.disabled = !(loser && others.length === 3 && dateEl.value && dateEl.value <= today); };

  pec.addEventListener('input', () => {
    err.textContent = '';
    const p = parseLoser(pec.value);
    if (p) {
      loser = p.id; others = others.filter((id) => id !== p.id);
      rest.hidden = false;
      losercard.innerHTML = `<span class="lc-emoji">😈</span>
        <span class="lc-col"><span class="lc-name">${esc(p.name)}</span><span class="lc-text">jadi pecundang</span></span>`;
      hint.innerHTML = 'Salah ketik? Ganti aja namanya di atas.';
      drawChips();
    } else {
      loser = null; rest.hidden = true;
      hint.innerHTML = `Ketik <b>nama + ${LOSER_WORD}</b> — yang kalah ketebak otomatis.`;
    }
    sync();
  });
  chips.addEventListener('click', (e) => {
    const id = Number(e.target.closest('.chip')?.dataset.id); if (!id) return;
    if (others.includes(id)) others = others.filter((x) => x !== id);
    else if (others.length < 3) others.push(id);
    drawChips(); sync();
  });
  datetoggle.addEventListener('click', () => { datewrap.hidden = !datewrap.hidden; if (!datewrap.hidden) dateEl.focus(); });
  dateEl.addEventListener('change', () => { datelabel.textContent = dateEl.value === today ? 'Hari ini' : dateEl.value; sync(); });
  save.addEventListener('click', async () => {
    const name = nameOf(loser);
    const players = [loser, ...others];
    const okd = await attempt(err, () =>
      api.logGame({ leaderboard_id: boardId, game_date: dateEl.value, players, loser, secret: LOSER_WORD }));
    if (okd) {
      close(); await refresh();
      showPecundang(name, async () => {
        if (await attempt(null, () => api.undoLast(boardId, LOSER_WORD))) await refresh();
      });
    }
  });
  pec.focus();
}

// Roster memory: the players + A/B split from the last racquet round, per board+sport. Prefilled on
// reopen so an 8-round padel night isn't 8 rounds of re-picking the same four people — the guard
// against silent partial logging (PRD v4 §12 / R7).
let lastSport = 'tt_singles';
const rosterMem = {};   // `${boardId}:${sport}` -> { a:[ids], b:[ids] }

// Log a table tennis or padel game: pick a sport, assign players to Side A / Side B, type the score.
// The lower score loses; both players on the losing side are stamped. No unlock — the confess-word
// is the secret, same as a card log.
function openLogSport() {
  const act = activePlayers();
  ensureAudio();
  if (act.length < 2) {
    const box = el(`<div class="sheet"><h2>Racquet game</h2>
      <p class="warn">Need at least 2 active players — add more first.</p>
      <div class="sheet-actions"><button class="btn-ghost" data-close>Close</button></div></div>`);
    openSheet(box);
    return;
  }
  const today = api.localToday();
  const padelTotal = boardPoints();                   // this board's Americano points-per-round
  const totalFor = (s) => (s === 'padel' ? padelTotal : SPORTS[s].total);
  const sports = SPORT_ORDER.filter(hasType);         // only what this board plays
  const canPlay = (s) => act.length >= SPORTS[s].perSide * 2;
  let sport = (hasType(lastSport) && canPlay(lastSport)) ? lastSport
    : (sports.find(canPlay) ?? sports[0] ?? 'tt_singles');
  let a = [], b = [];
  const memKey = () => `${boardId}:${sport}`;
  const restore = () => {
    const m = rosterMem[memKey()];
    const ok = (id) => act.some((p) => p.id === id);
    a = (m?.a ?? []).filter(ok).slice(0, SPORTS[sport].perSide);
    b = (m?.b ?? []).filter(ok).slice(0, SPORTS[sport].perSide);
  };
  restore();

  const box = el(`<div class="sheet sheet-log">
    <h2 class="pec-title">Log a racquet game</h2>
    <div class="log-types" id="types"></div>
    <div class="teams">
      <div class="team"><p class="team-label">Side A</p><div class="team-slots" id="slotsA"></div></div>
      <div class="vs">vs</div>
      <div class="team"><p class="team-label">Side B</p><div class="team-slots" id="slotsB"></div></div>
    </div>
    <p class="pick-label" id="picklabel"></p>
    <div class="chips chips-lg" id="pool"></div>
    <div class="score-row">
      <input class="field score" id="sa" type="number" inputmode="numeric" min="0" placeholder="A">
      <span class="score-dash">–</span>
      <input class="field score" id="sb" type="number" inputmode="numeric" min="0" placeholder="B">
    </div>
    <p class="sheet-sub scorehint" id="scorehint"></p>
    <button type="button" class="date-toggle" id="datetoggle">🗓️ <span id="datelabel">Hari ini</span> · <u>ubah tanggal</u></button>
    <div class="date-wrap" id="datewrap" hidden><input class="field" type="date" id="d" value="${today}" max="${today}"></div>
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions">
      <button class="btn-ghost" data-close>Batal</button>
      <button class="btn-primary" id="save" disabled>Simpan</button>
    </div></div>`);
  const close = openSheet(box);
  const q = (id) => box.querySelector(id);
  const typesEl = q('#types'), slotsA = q('#slotsA'), slotsB = q('#slotsB'), pool = q('#pool');
  const picklabel = q('#picklabel'), saEl = q('#sa'), sbEl = q('#sb'), scorehint = q('#scorehint');
  const save = q('#save'), err = q('#err'), dateEl = q('#d');
  const datetoggle = q('#datetoggle'), datewrap = q('#datewrap'), datelabel = q('#datelabel');
  const assigned = () => [...a, ...b];

  function drawTypes() {
    const short = { tt_singles: 'Singles', tt_doubles: 'Doubles', bd_singles: 'Singles', bd_doubles: 'Doubles', padel: 'Padel' };
    // Only this board's sports; hide the picker entirely when there's just one.
    typesEl.innerHTML = sports.length < 2 ? '' : sports.map((s) =>
      `<button class="ltype${s === sport ? ' on' : ''}" data-s="${s}"${canPlay(s) ? '' : ' disabled'}>${SPORTS[s].icon} ${short[s]}</button>`).join('');
  }
  function slots(ids, side) {
    const per = SPORTS[sport].perSide;
    let html = ids.map((id) => `<button class="chip on" data-remove="${side}:${id}">${esc(nameOf(id))} ✕</button>`).join('');
    for (let i = ids.length; i < per; i++) html += '<span class="slot-empty">—</span>';
    return html;
  }
  function drawTeams() {
    const per = SPORTS[sport].perSide;
    const asg = assigned();   // compute once — was rebuilt per player inside the pool filter below
    slotsA.innerHTML = slots(a, 'a');
    slotsB.innerHTML = slots(b, 'b');
    const need = per * 2 - asg.length;
    picklabel.textContent = need > 0 ? `Tap ${need} more player${need === 1 ? '' : 's'}` : 'Ready — enter the score';
    const full = asg.length >= per * 2;
    pool.innerHTML = act.filter((p) => !asg.includes(p.id)).map((p) =>
      `<button class="chip" data-add="${p.id}"${full ? ' disabled' : ''}>${esc(p.name)}</button>`).join('');
  }
  function sync() {
    const per = SPORTS[sport].perSide;
    const full = a.length === per && b.length === per;
    const serr = full ? sportScoreError(sport, saEl.value, sbEl.value, padelTotal) : null;
    const total = totalFor(sport);
    if (total != null && full && (saEl.value !== '' || sbEl.value !== '')) {
      const sum = (Number(saEl.value) || 0) + (Number(sbEl.value) || 0);
      scorehint.textContent = `${sum} / ${total}${serr && sum === total ? ' · ' + serr : sum === total ? ' ✓' : ''}`;
    } else {
      scorehint.textContent = full ? (serr ?? 'looks good ✓') : '';
    }
    scorehint.classList.toggle('bad', !!(full && serr));
    save.disabled = !(full && !serr && dateEl.value && dateEl.value <= today);
  }

  typesEl.addEventListener('click', (e) => {
    const t = e.target.closest('.ltype'); if (!t || t.disabled) return;
    sport = t.dataset.s; lastSport = sport; restore(); drawTypes(); drawTeams(); sync();
  });
  pool.addEventListener('click', (e) => {
    const id = Number(e.target.closest('[data-add]')?.dataset.add); if (!id) return;
    const per = SPORTS[sport].perSide;
    if (a.length < per) a.push(id); else if (b.length < per) b.push(id);
    drawTeams(); sync();
  });
  box.querySelector('.teams').addEventListener('click', (e) => {
    const r = e.target.closest('[data-remove]'); if (!r) return;
    const [side, id] = r.dataset.remove.split(':'); const pid = Number(id);
    if (side === 'a') a = a.filter((x) => x !== pid); else b = b.filter((x) => x !== pid);
    drawTeams(); sync();
  });
  [saEl, sbEl].forEach((i) => i.addEventListener('input', () => { err.textContent = ''; sync(); }));
  datetoggle.addEventListener('click', () => { datewrap.hidden = !datewrap.hidden; if (!datewrap.hidden) dateEl.focus(); });
  dateEl.addEventListener('change', () => { datelabel.textContent = dateEl.value === today ? 'Hari ini' : dateEl.value; sync(); });

  save.addEventListener('click', async () => {
    const score_a = Number(saEl.value), score_b = Number(sbEl.value);
    const name = (score_a < score_b ? a : b).map(nameOf).join(' & ');
    const okd = await attempt(err, () => api.logSportsGame({
      leaderboard_id: boardId, sport, game_date: dateEl.value, a, b, score_a, score_b, secret: LOSER_WORD,
    }));
    if (okd) {
      rosterMem[memKey()] = { a: [...a], b: [...b] };
      close(); await refresh();
      showPecundang(name, async () => {
        if (await attempt(null, () => api.undoLastSports(boardId, LOSER_WORD))) await refresh();
      });
    }
  });

  drawTypes(); drawTeams(); sync();
}

// ---- Americano sessions (Phase B) ----
// A session is one padel night: a fixed roster, court count, and round target. The pairing schedule
// is a deterministic function of those three (americano.mjs), so the runner regenerates it on open —
// nothing about the pairings is stored, only the inputs.

const latestSession = () => (data?.padelSessions ?? [])[0];
const sessionGames = (sid) => (data?.sportsGames ?? []).filter((g) => g.session_id === sid && g.sport === 'padel');

// v_padel_standings-shaped rows built from raw padel games — for one session's live standings.
function padelRowsFromGames(games) {
  const acc = new Map();
  for (const g of games) {
    if (g.sport !== 'padel') continue;
    for (const [pid, pf, pa] of [[g.a1, g.score_a, g.score_b], [g.a2, g.score_a, g.score_b], [g.b1, g.score_b, g.score_a], [g.b2, g.score_b, g.score_a]]) {
      if (pid == null) continue;
      const r = acc.get(pid) ?? { player_id: pid, name: nameOf(pid), archived: false, rounds: 0, points_for: 0, points_against: 0 };
      r.rounds += 1; r.points_for += pf; r.points_against += pa;
      acc.set(pid, r);
    }
  }
  return [...acc.values()];
}

// Start Americano: pick who's here, how many courts, how many rounds; generate the night's pairings.
// Roster is kept in name order so the schedule is stable across reloads.
function openStartAmericano() {
  const act = activePlayers();
  const today = api.localToday();
  ensureAudio();
  if (act.length < 4) {
    const box = el(`<div class="sheet"><h2>Start Americano</h2>
      <p class="warn">An Americano needs at least 4 active players — add more first.</p>
      <div class="sheet-actions"><button class="btn-ghost" data-close>Close</button></div></div>`);
    openSheet(box);
    return;
  }
  const chosen = new Set(act.map((p) => p.id));   // everyone in by default
  let roundsEdited = false;

  const box = el(`<div class="sheet sheet-log">
    <h2 class="pec-title">Start Americano</h2>
    <p class="pick-label">Siapa yang main? <span class="pick-count" id="rcount"></span></p>
    <div class="chips chips-lg" id="roster"></div>
    <div class="amer-opts">
      <label class="amer-opt">Courts<input class="field" id="courts" type="number" inputmode="numeric" min="1" max="6" value="1"></label>
      <label class="amer-opt">Rounds<input class="field" id="rounds" type="number" inputmode="numeric" min="1" max="60"></label>
    </div>
    <p class="sheet-sub amer-info" id="info"></p>
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions">
      <button class="btn-ghost" data-close>Batal</button>
      <button class="btn-primary" id="go">Generate schedule</button>
    </div></div>`);
  const close = openSheet(box);
  const rosterEl = box.querySelector('#roster'), rcount = box.querySelector('#rcount');
  const courtsEl = box.querySelector('#courts'), roundsEl = box.querySelector('#rounds');
  const info = box.querySelector('#info'), err = box.querySelector('#err'), go = box.querySelector('#go');

  const rosterIds = () => act.filter((p) => chosen.has(p.id)).map((p) => p.id);   // name order
  const readCourts = () => Math.max(1, Math.min(6, Number(courtsEl.value) || 1));
  const readRounds = (n, c) => Math.max(1, Math.min(60, Number(roundsEl.value) || suggestedRounds(n, c) || 1));

  function sync() {
    const n = rosterIds().length, c = readCourts();
    const suggested = suggestedRounds(n, c);
    if (!roundsEdited) roundsEl.value = suggested || '';
    const r = readRounds(n, c);
    const m = matchesPerRound(n, c), sit = m > 0 ? n - m * 4 : 0;
    rcount.textContent = `${n} main`;
    info.textContent = n < 4 ? 'Pick at least 4 players.'
      : `${m} match${m === 1 ? '' : 'es'} a round · ${sit} sitting out each round · ${r} rounds`;
    go.disabled = n < 4;
  }
  function drawRoster() {
    rosterEl.innerHTML = act.map((p) =>
      `<button class="chip${chosen.has(p.id) ? ' on' : ''}" data-id="${p.id}" aria-pressed="${chosen.has(p.id)}">${esc(p.name)}</button>`).join('');
  }
  rosterEl.addEventListener('click', (e) => {
    const id = Number(e.target.closest('.chip')?.dataset.id); if (!id) return;
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    drawRoster(); sync();
  });
  courtsEl.addEventListener('input', sync);
  roundsEl.addEventListener('input', () => { roundsEdited = true; sync(); });

  go.addEventListener('click', async () => {
    const roster = rosterIds();
    if (roster.length < 4) return;
    const c = readCourts(), r = readRounds(roster.length, c);
    await attempt(err, async () => {
      const sess = await api.createPadelSession({
        leaderboard_id: boardId, game_date: today, roster, courts: c, rounds: r, secret: LOSER_WORD,
      });
      close(); await refresh();
      openSessionRunner(sess);
    });
  });
  drawRoster(); sync();
}

// The round-runner: shows the generated pairings round by round, logs each match's score into the
// session, and keeps a live "tonight" leaderboard. You log the rounds you actually play — unfinished
// rounds just stay blank (PRD v4 B1). Standings come from the logged games, never the schedule map.
function openSessionRunner(session) {
  const sched = generateSchedule(session.roster, session.courts, session.rounds);
  const target = boardPoints();
  const pairName = (ids) => ids.map(nameOf).map(esc).join(' · ');

  const box = el(`<div class="sheet sheet-runner">
    <h2 class="pec-title">Americano · ${esc(session.game_date)}</h2>
    <div id="summary"></div>
    <p class="sheet-error" id="err"></p>
    <div class="runner-body" id="body"></div>
    <div class="sheet-actions"><button class="btn-primary" data-close>Selesai</button></div>
  </div>`);
  const close = openSheet(box);
  const summary = box.querySelector('#summary'), body = box.querySelector('#body'), err = box.querySelector('#err');

  // Map logged session games onto schedule slots (by player composition, either orientation) so a
  // played match shows its score with a ✓. An imperfect map can never move the numbers — those come
  // straight from the games.
  function mapGames(sgames) {
    const used = new Set(), map = new Map();
    const setOf = (arr) => new Set(arr.filter((x) => x != null));
    const eq = (s1, s2) => s1.size === s2.size && [...s1].every((x) => s2.has(x));
    sched.rounds.forEach((rnd, ri) => rnd.matches.forEach((mt, mi) => {
      const aSet = new Set(mt.a), bSet = new Set(mt.b);
      const g = sgames.find((x) => {
        if (used.has(x.id)) return false;
        const xa = setOf([x.a1, x.a2]), xb = setOf([x.b1, x.b2]);
        return (eq(xa, aSet) && eq(xb, bSet)) || (eq(xa, bSet) && eq(xb, aSet));
      });
      if (g) { used.add(g.id); map.set(`${ri}:${mi}`, g); }
    }));
    return map;
  }

  function draw() {
    const sgames = sessionGames(session.id);
    const map = mapGames(sgames);
    const total = sched.rounds.reduce((n, r) => n + r.matches.length, 0);
    const { ranked } = computePadelStandings(padelRowsFromGames(sgames), 1);   // rank from round 1
    const loser = ranked[0];

    summary.innerHTML = `<p class="runner-progress">${map.size} / ${total} matches logged</p>
      ${loser ? `<div class="runner-loser"><span class="spot-label">Pecundang malam ini</span>
        <b>${esc(loser.name)}</b><em>${loser.avg.toFixed(1)} pts/round</em></div>` : ''}
      ${ranked.length ? `<ol class="runner-standings">${ranked.map((p) =>
        `<li><span class="rs-rank">${p.rank}</span><span class="rs-name">${esc(p.name)}</span>
          <span class="rs-avg">${p.avg.toFixed(1)}</span><span class="rs-diff">${p.point_diff > 0 ? '+' : ''}${p.point_diff}</span></li>`).join('')}</ol>` : ''}`;

    body.innerHTML = sched.rounds.map((rnd, ri) => {
      const rows = rnd.matches.map((mt, mi) => {
        const g = map.get(`${ri}:${mi}`);
        const aN = pairName(mt.a), bN = pairName(mt.b);
        if (g) {
          const aIsA = mt.a.includes(g.a1);
          const sa = aIsA ? g.score_a : g.score_b, sb = aIsA ? g.score_b : g.score_a;
          const win = sa > sb;
          return `<div class="rmatch done">
            <div class="rteam${win ? ' won' : ''}">${aN}</div>
            <div class="rscore"><b>${sa}</b><span class="score-dash">–</span><b>${sb}</b> <span class="beats">${CHECK}</span></div>
            <div class="rteam${!win ? ' won' : ''}">${bN}</div></div>`;
        }
        return `<div class="rmatch">
          <div class="rteam">${aN}</div>
          <div class="rscore"><input class="field score" data-sa type="number" inputmode="numeric" min="0" placeholder="–">
            <span class="score-dash">–</span>
            <input class="field score" data-sb type="number" inputmode="numeric" min="0" placeholder="–"></div>
          <div class="rteam">${bN}</div>
          <button class="mini-btn go rlog" data-a="${mt.a.join(',')}" data-b="${mt.b.join(',')}">Log</button></div>`;
      }).join('');
      const sit = rnd.sitOut.length ? `<p class="rsit">Duduk dulu: ${rnd.sitOut.map(nameOf).map(esc).join(', ')}</p>` : '';
      return `<section class="rround"><h3>Round ${rnd.round}</h3>${rows}${sit}</section>`;
    }).join('');
  }

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.rlog'); if (!btn) return;
    err.textContent = '';
    const wrap = btn.closest('.rmatch');
    const sa = wrap.querySelector('[data-sa]').value, sb = wrap.querySelector('[data-sb]').value;
    const serr = sportScoreError('padel', sa, sb, target);
    if (serr) { err.textContent = serr; return; }
    const a = btn.dataset.a.split(',').map(Number), b = btn.dataset.b.split(',').map(Number);
    const okd = await attempt(err, () => api.logSportsGame({
      leaderboard_id: boardId, sport: 'padel', game_date: session.game_date,
      a, b, score_a: Number(sa), score_b: Number(sb), session_id: session.id, secret: LOSER_WORD,
    }));
    if (okd) { await refresh(); draw(); }
  });

  draw();
}

function openGames() {
  let editing = null, confirming = null;   // keyed 'card:5' / 'sport:3'
  const box = el(`<div class="sheet"><h2>Recent games</h2>
    <p class="sheet-sub">Fix a result or delete a game. Newest first.</p>
    <p class="sheet-error" id="err"></p>
    <div class="rows" id="rows"></div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Done</button></div></div>`);
  const close = openSheet(box);
  const rows = box.querySelector('#rows'), err = box.querySelector('#err');

  const merged = () => [
    ...(data?.games ?? []).map((g) => ({ type: 'card', g })),
    ...(data?.sportsGames ?? []).map((g) => ({ type: 'sport', g })),
  ].sort((x, y) => (x.g.created_at < y.g.created_at ? 1 : x.g.created_at > y.g.created_at ? -1 : 0));

  function confirmRow(title, key) {
    return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(title)}</div>
      <div class="row-sub">Delete this game?</div></div>
      <div class="row-actions"><button class="mini-btn danger" data-yes="${key}">Delete</button>
      <button class="mini-btn" data-no="${key}">Keep</button></div></div>`;
  }

  function cardRow(g) {
    const key = `card:${g.id}`, who = `🃏 ${[g.p1, g.p2, g.p3, g.p4].map(nameOf).join(' · ')}`;
    if (editing === key) {
      const opts = [g.p1, g.p2, g.p3, g.p4].map((id) =>
        `<button class="chip${g.loser === id ? ' on' : ''}" data-newloser="${g.id}:${id}">${esc(nameOf(id))}</button>`).join('');
      return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(who)}</div>
        <div class="chips" style="margin-top:6px">${opts}</div></div></div>`;
    }
    if (confirming === key) return confirmRow(who, key);
    return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(who)}</div>
      <div class="row-sub"><span class="loss">${esc(nameOf(g.loser))}</span> lost · ${g.game_date}</div></div>
      <div class="row-actions"><button class="mini-btn" data-edit="${key}">Edit</button>
      <button class="mini-btn" data-del="${key}">Delete</button></div></div>`;
  }

  function sportRow(g) {
    const key = `sport:${g.id}`, meta = SPORTS[g.sport] ?? { icon: '🎾' };
    const aN = [g.a1, g.a2].filter(Boolean).map(nameOf).join('·');
    const bN = [g.b1, g.b2].filter(Boolean).map(nameOf).join('·');
    const title = `${meta.icon} ${aN} ${g.score_a}–${g.score_b} ${bN}`;
    const loserN = (g.score_a < g.score_b ? [g.a1, g.a2] : [g.b1, g.b2]).filter(Boolean).map(nameOf).join(' & ');
    if (editing === key) {
      return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(title)}</div>
        <div class="score-row" style="margin-top:6px">
          <input class="field score" data-sa type="number" value="${g.score_a}" min="0">
          <span class="score-dash">–</span>
          <input class="field score" data-sb type="number" value="${g.score_b}" min="0">
          <button class="mini-btn go" data-savescore="${g.id}:${g.sport}">Save</button></div></div></div>`;
    }
    if (confirming === key) return confirmRow(title, key);
    return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(title)}</div>
      <div class="row-sub"><span class="loss">${esc(loserN)}</span> lost · ${g.game_date}</div></div>
      <div class="row-actions"><button class="mini-btn" data-edit="${key}">Edit</button>
      <button class="mini-btn" data-del="${key}">Delete</button></div></div>`;
  }

  function draw() {
    const list = merged();
    rows.innerHTML = list.length
      ? list.map((it) => (it.type === 'card' ? cardRow(it.g) : sportRow(it.g))).join('')
      : '<p class="row-empty">No games yet.</p>';
  }

  rows.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset; err.textContent = '';
    if (d.edit) { editing = d.edit; confirming = null; draw(); }
    else if (d.newloser) {
      const [gid, lid] = d.newloser.split(':').map(Number);
      if (await attempt(err, () => api.editLoser(gid, lid))) { editing = null; await refresh(); draw(); }
    }
    else if (d.savescore) {
      const [gid, sport] = d.savescore.split(':');
      const wrap = t.closest('.score-row');
      const sa = wrap.querySelector('[data-sa]').value, sb = wrap.querySelector('[data-sb]').value;
      const g = (data?.sportsGames ?? []).find((x) => x.id === Number(gid));
      const serr = sportScoreError(sport, sa, sb, g?.points_target ?? boardPoints());
      if (serr) { err.textContent = serr; return; }
      if (await attempt(err, () => api.editSportsScore(Number(gid), Number(sa), Number(sb)))) { editing = null; await refresh(); draw(); }
    }
    else if (d.del) { confirming = d.del; editing = null; draw(); }
    else if (d.yes) {
      const [type, id] = d.yes.split(':');
      const fn = type === 'card' ? () => api.deleteGame(Number(id)) : () => api.deleteSportsGame(Number(id));
      if (await attempt(err, fn)) { confirming = null; await refresh(); draw(); }
    }
    else if (d.no) { confirming = null; draw(); }
  });
  draw();
}

// A random cheeky roast to twist the knife. {name} is filled with the loser's name.
const ROASTS = [
  'Konsisten juga jadi pecundang 😹',
  'Yah, {name} lagi 🤣',
  'Skill issue, {name} 💀',
  'Emang jodohnya sama kekalahan 💔',
  'Trofi pecundang buat {name} 🏆',
  'Nangis boleh, kalah tetep kalah 😭',
  'Gg {name}, gg 🫡',
  'Lagi apes apa emang gitu? 🤔',
  'Legend baru: {name} sang pecundang ⭐',
  'Sabar ya {name}, rezeki gak kemana (menang iya) 😌',
];
const roastFor = (name) => ROASTS[Math.floor(Math.random() * ROASTS.length)].replaceAll('{name}', name);

// ---- mocking "you lose" jingle (synthesized, no audio file) ----
// One shared AudioContext, primed on a user gesture (the Log button) so the browser lets
// it play. ensureAudio() is safe to call repeatedly.
let audioCtx;
function ensureAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio — fine */ }
}

// The classic sad trombone: "womp · womp · womp · wommmp" — three descending notes then a
// fourth that sags down. Sawtooth through a lowpass = brassy; a slow LFO adds the wobble.
function playLoserSound() {
  try {
    ensureAudio();
    if (!audioCtx) return;
    const ctx = audioCtx, t0 = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.7;
    lp.connect(ctx.destination);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5; lfoGain.gain.value = 6; lfo.connect(lfoGain);
    lfo.start(t0); lfo.stop(t0 + 2.2);
    const notes = [
      [311.13, 0.00, 0.26, null],   // Eb4
      [293.66, 0.28, 0.26, null],   // D4
      [277.18, 0.56, 0.26, null],   // Db4
      [261.63, 0.84, 0.90, 174.61], // C4 sagging down to F3 — the "wommmp"
    ];
    for (const [f, t, d, bend] of notes) {
      const s = t0 + t, e = s + d;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, s);
      if (bend) osc.frequency.exponentialRampToValueAtTime(bend, e);
      lfoGain.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.28, s + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, e);
      osc.connect(g); g.connect(lp);
      osc.start(s); osc.stop(e + 0.03);
    }
  } catch { /* no audio — fine */ }
}

// The reveal: a rubber-stamp "PECUNDANG" slams over the screen with the loser's name, a
// random roast, a mocking jingle, and a stuttering buzz. Tap (or wait) to dismiss.
function showPecundang(name, onUndo) {
  document.querySelector('.pecundang')?.remove();
  const o = el(`<div class="pecundang" role="alertdialog" aria-label="${esc(name)} pecundang">
    <div class="stamp"><span class="stamp-name">${esc(name)}</span><span class="stamp-word">PECUNDANG</span></div>
    <p class="pec-roast">${esc(roastFor(name))}</p>
    <button class="pec-undo" id="pundo">salah? undo</button></div>`);
  document.body.appendChild(o);
  playLoserSound();
  // buzz in time with the trombone: three short taunts then a long one
  try { navigator.vibrate?.([60, 90, 60, 90, 60, 120, 320]); } catch { /* no haptics — fine */ }
  let timer;
  const close = () => { clearTimeout(timer); o.remove(); };
  o.addEventListener('click', (e) => { if (e.target.id !== 'pundo') close(); });
  o.querySelector('#pundo').addEventListener('click', async (e) => { e.stopPropagation(); close(); await onUndo?.(); });
  timer = setTimeout(close, 4200);
}

// ---- export ----
// A complete, rebuildable backup of this leaderboard: every game with its date, four
// players and loser, plus the roster and the current standings.
// ponytail: JSON only — it already rebuilds everything a CSV could.
function doExport() {
  const payload = buildExport({ id: boardId, name: boardName() }, data ?? {}, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LOTD-${boardName().replace(/[^\w-]+/g, '-')}-${api.localToday()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---- render ----
const joinNames = (names) => names.join(' & ');
const lossWord = (n) => `${n} loss${n === 1 ? '' : 'es'}`;

// All-time losses per player across every game type (cards + racquet) — a combined headline,
// not the ranking (the per-sport tables rank fairly on loss rate). Raw count is fine for the joke.
function combinedAllTime() {
  const m = new Map();
  for (const r of data?.standings ?? []) m.set(r.player_id, { name: r.name, losses: r.losses });
  for (const r of data?.sportStandings ?? []) {
    const cur = m.get(r.player_id) ?? { name: r.name, losses: 0 };
    cur.losses += r.losses;
    m.set(r.player_id, cur);
  }
  return [...m.values()];
}

function spotlightHTML() {
  const daily = data?.dailyLosses ?? [];       // combined losses today, from v_daily_losses
  const allRows = combinedAllTime();

  const allNames = biggestLoserAllTime(allRows);
  const allMax = allRows.reduce((m, r) => Math.max(m, r.losses ?? 0), 0);
  const todayNames = biggestLoserToday(daily);
  const todayMax = daily.reduce((m, r) => Math.max(m, r.losses ?? 0), 0);
  const anyGames = (data?.games?.length ?? 0) + (data?.sportsGames?.length ?? 0) > 0;

  const card = (cls, label, names, max, emptyMsg, suffix) => `
    <div class="spot ${cls}">
      <p class="spot-label">${label}</p>
      ${names.length
        ? `<p class="spot-name">${esc(joinNames(names))}</p>
           <p class="spot-meta">${lossWord(max)}${suffix}${names.length > 1 ? ' · tied' : ''}</p>`
        : `<p class="spot-name none">${emptyMsg}</p>`}
    </div>`;

  return `<div class="spotlights">
    ${card('crown', 'All-time biggest loser', allNames, allMax, 'No data yet', '')}
    ${card('', 'Today’s biggest loser', todayNames, todayMax,
      anyGames ? 'No games logged today' : 'No data yet', ' today')}
  </div>`;
}

// Compact per-sport standings: one table per sport that has games, ranked biggest-loser-first on
// the 50% baseline. Returns '' when the board has no racquet games (so a card-only board is
// unchanged). Each sport's rank-1 is the clay "biggest loser" of that sport.
function sportTablesHTML() {
  const all = data?.sportStandings ?? [];
  if (!all.length) return '';
  const bySport = {};
  for (const r of all) (bySport[r.sport] ??= []).push(r);
  // Padel is never a loss-rate table — it has its own Americano points table (padelTableHTML).
  return SPORT_ORDER.filter((s) => s !== 'padel' && hasType(s) && bySport[s]?.length).map((sport) => {
    const { ranked, unranked } = computeSportStandings(bySport[sport]);
    const meta = SPORTS[sport];
    const row = (p, isRanked) => {
      const archived = p.archived ? ' <span class="pill-archived">archived</span>' : '';
      const rate = p.loss_rate === null ? '<span class="muted">–</span>'
        : `${pct(p.loss_rate)}${p.beats_luck ? ` <span class="beats">${CHECK}<span class="sr-only">beats luck</span></span>` : ''}`;
      const cls = isRanked && p.rank === 1 ? ' class="lead-loser"' : (isRanked ? '' : ' class="quiet-row"');
      return `<tr${cls}><td class="rank">${isRanked ? p.rank : '<span class="muted">–</span>'}</td>
        <td class="who">${esc(p.name)}${archived}</td>
        <td class="num">${p.gp}</td><td class="num loss">${p.losses}</td><td class="num rate">${rate}</td></tr>`;
    };
    return `<section class="sport-block">
      <h3 class="sport-head">${meta.icon} ${esc(meta.label)}</h3>
      <table class="standings">
        <thead><tr><th class="rank">#</th><th>Player</th><th class="num">GP</th><th class="num">L</th>
          <th class="num">Loss rate</th></tr></thead>
        <tbody>
          ${ranked.map((p) => row(p, true)).join('')}
          ${unranked.length ? `<tr class="group-row"><td colspan="5">Not enough games yet · needs ${MIN_GAMES_FOR_RATE}</td></tr>` : ''}
          ${unranked.map((p) => row(p, false)).join('')}
        </tbody>
      </table>
    </section>`;
  }).join('');
}

// Padel Americano spotlight: the biggest loser is whoever averages the FEWEST points per round
// all-time, and today's loser is whoever scored the fewest padel points today. Points follow the
// player, not the partnership — that's the whole point of Americano.
function padelSpotlightHTML() {
  const { ranked } = computePadelStandings(data?.padelStandings ?? []);
  const worst = ranked[0];   // rank 1 = fewest average points = biggest loser
  const today = fewestPointsPadelToday(data?.sportsGames ?? [], data?.players ?? [], api.localToday());
  const anyPadel = (data?.sportsGames ?? []).some((g) => g.sport === 'padel');

  const card = (cls, label, main, meta, empty) => `
    <div class="spot ${cls}">
      <p class="spot-label">${label}</p>
      ${main ? `<p class="spot-name">${esc(main)}</p><p class="spot-meta">${meta}</p>`
             : `<p class="spot-name none">${empty}</p>`}
    </div>`;

  return `<div class="spotlights">
    ${card('crown', 'All-time biggest loser', worst?.name,
      worst ? `${worst.avg.toFixed(1)} pts/round · avg` : '', 'Not enough rounds yet')}
    ${card('', 'Today’s biggest loser', today.names.length ? joinNames(today.names) : '',
      `${today.points} pts today${today.names.length > 1 ? ' · tied' : ''}`,
      anyPadel ? 'No padel today' : 'No data yet')}
  </div>`;
}

// The Americano points table: one row per player, ranked by fewest average points per round
// (biggest loser on top), ties broken by point difference. Replaces the loss-rate table on a
// padel-only board.
function padelTableHTML() {
  const rows = data?.padelStandings ?? [];
  if (!rows.length) return `<div class="empty small"><h2>No rounds yet</h2>
    <p>Log a padel round — the leaderboard ranks players by their average points.</p></div>`;
  const { ranked, unranked } = computePadelStandings(rows);
  const row = (p, isRanked) => {
    const archived = p.archived ? ' <span class="pill-archived">archived</span>' : '';
    const diff = p.point_diff > 0 ? `+${p.point_diff}` : `${p.point_diff}`;
    const cls = isRanked && p.rank === 1 ? ' class="lead-loser"' : (isRanked ? '' : ' class="quiet-row"');
    return `<tr${cls}><td class="rank">${isRanked ? p.rank : '<span class="muted">–</span>'}</td>
      <td class="who">${esc(p.name)}${archived}</td>
      <td class="num">${p.rounds}</td><td class="num">${p.points_for}</td>
      <td class="num">${diff}</td><td class="num rate">${p.avg != null ? p.avg.toFixed(1) : '–'}</td></tr>`;
  };
  return `<section class="sport-block">
    <h3 class="sport-head">${SPORTS.padel.icon} ${esc(SPORTS.padel.label)}</h3>
    <table class="standings">
      <thead><tr><th class="rank">#</th><th>Player</th><th class="num">R</th>
        <th class="num">Pts</th><th class="num">+/−</th><th class="num">Avg</th></tr></thead>
      <tbody>
        ${ranked.map((p) => row(p, true)).join('')}
        ${unranked.length ? `<tr class="group-row"><td colspan="6">Not enough rounds yet · needs ${MIN_GAMES_FOR_RATE}</td></tr>` : ''}
        ${unranked.map((p) => row(p, false)).join('')}
      </tbody>
    </table>
    <p class="legend"><b>Fewest average points is the biggest loser.</b> Every point you win counts
    to you, whoever your partner is — Americano-style. Ties break on total point difference (+/−).</p>
  </section>`;
}

// A resumable card for the board's most recent Americano night. Tapping reopens the round-runner so
// you can keep logging (or just read the night's standings). Only shown on a padel board with a session.
function padelSessionBanner() {
  const sess = latestSession();
  if (!sess) return '';
  const sched = generateSchedule(sess.roster, sess.courts, sess.rounds);
  const total = sched.rounds.reduce((n, r) => n + r.matches.length, 0);
  const done = sessionGames(sess.id).length;
  const complete = done >= total;
  return `<button class="amer-banner${complete ? ' complete' : ''}" id="resume-amer">
    <span class="amer-b-title">🎾 Americano · ${esc(sess.game_date)}</span>
    <span class="amer-b-sub">${done}/${total} matches logged · ${complete ? 'tap to review' : 'tap to resume'}</span></button>`;
}

function rowsHTML(list, ranked) {
  return list.map((p) => {
    const archived = p.archived ? ' <span class="pill-archived">archived</span>' : '';
    // 🔥 on anyone currently on a losing streak of 2+ — "lagi apes".
    const streak = losingStreak(data?.games ?? [], p.player_id);
    const flame = streak >= 2 ? ` <span class="flame" title="Lagi apes — kalah ${streak}× beruntun">🔥${streak}</span>` : '';
    const rate = p.loss_rate === null ? '<span class="muted">–</span>'
      : `${pct(p.loss_rate)}${p.beats_luck ? ` <span class="beats">${CHECK}<span class="sr-only">beats luck</span></span>` : ''}`;
    // No per-row "N more to rank": the divider states the threshold once, which keeps the
    // name column wide enough that names don't wrap on a phone.
    const need = '';
    // #1 means opposite things per mode — biggest loser (clay) vs most clean games (gold).
    // Colouring it by meaning stops the top row reading as "champion" on a loser board.
    const top = ranked && p.rank === 1;
    const cls = [
      top ? (mode === MODES.HIGHEST_LOSS_RATE ? 'lead-loser' : 'lead') : '',
      ranked ? '' : 'quiet-row',
    ].filter(Boolean).join(' ');
    return `<tr${cls ? ` class="${cls}"` : ''}>
      <td class="rank">${ranked ? p.rank : '<span class="muted">–</span>'}</td>
      <td class="who">${esc(p.name)}${flame}${archived}${need}</td>
      <td class="num">${p.gp}</td><td class="num loss">${p.losses}</td>
      <td class="num">${p.games_not_lost}</td><td class="num rate">${rate}</td>
    </tr>`;
  }).join('');
}

function tableHTML(ranked, unranked) {
  // Both modes now put the worst player on top, so the sorted column is always descending.
  const sortedBy = (m) => (mode === m ? 'descending' : 'none');
  return `
    <div class="sort" role="group" aria-label="Ranking mode">
      <button data-mode="${MODES.HIGHEST_LOSS_RATE}" aria-pressed="${mode === MODES.HIGHEST_LOSS_RATE}">Highest loss rate</button>
      <button data-mode="${MODES.MOST_NOT_LOST}" aria-pressed="${mode === MODES.MOST_NOT_LOST}">Most games not lost</button>
    </div>
    <table class="standings">
      <thead><tr>
        <th class="rank">#</th><th>Player</th><th class="num">GP</th><th class="num">L</th>
        <th class="num" aria-sort="${sortedBy(MODES.MOST_NOT_LOST)}">Not lost</th>
        <th class="num" aria-sort="${sortedBy(MODES.HIGHEST_LOSS_RATE)}">Loss rate</th>
      </tr></thead>
      <tbody>
        ${rowsHTML(ranked, true)}
        ${unranked.length ? `<tr class="group-row"><td colspan="6">Not enough games yet · needs ${MIN_GAMES_FOR_RATE} games</td></tr>` : ''}
        ${rowsHTML(unranked, false)}
      </tbody>
    </table>
    <p class="legend"><b>A win is any game you did not lose.</b> ${pct(LUCK_BASELINE)} is the loss rate of
    pure chance in a 4-player game — lower is better, and anyone under it is beating luck.</p>`;
}

function render() {
  const app = document.getElementById('app');
  const bar = document.getElementById('board-bar');
  const unlocked = api.isUnlocked();
  document.body.classList.toggle('unlocked', unlocked);

  const lockBtn = document.getElementById('lock');
  lockBtn.innerHTML = unlocked ? `${UNLOCK} Lock` : `${LOCK} Unlock`;
  lockBtn.setAttribute('aria-label', unlocked ? 'Lock editing' : 'Unlock to log games');

  if (error) {
    bar.hidden = true;
    app.innerHTML = `<div class="banner error"><p><b>Couldn't load the standings.</b> ${esc(error)}</p>
      <button class="btn" id="reload">Reload</button></div>`;
    document.getElementById('reload').addEventListener('click', refresh);
    return;
  }

  if (!boards.length) {
    bar.hidden = true;
    app.innerHTML = `<div class="empty"><h2>No leaderboards yet</h2>
      <p>${unlocked ? 'Create one to start tracking a game.' : 'Unlock and create one to start tracking a game.'}</p>
      ${unlocked ? '<p style="margin-top:14px"><button class="btn" id="new-empty">New leaderboard</button></p>' : ''}</div>`;
    document.getElementById('new-empty')?.addEventListener('click', openNewBoard);
    return;
  }

  bar.hidden = false;
  document.getElementById('board').innerHTML =
    boards.map((b) => `<option value="${b.id}"${b.id === boardId ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
  document.getElementById('board-admin').innerHTML = unlocked
    ? `<button class="mini-btn" id="b-new">New</button>
       <button class="mini-btn" id="b-rename">Edit</button>
       <button class="mini-btn danger" id="b-del">Delete</button>` : '';

  const padelBoard = isPadelBoard();
  const { ranked, unranked } = computeStandings(data?.standings ?? [], mode);
  const noPlayers = (data?.players?.length ?? 0) === 0;
  const cardHasGames = (data?.games?.length ?? 0) > 0;
  const act = activePlayers().length;
  // Show the card table only on a board that plays cards — and not as an empty shell when the board
  // also does racquet games but no cards have been logged yet.
  const showCardTable = hasType('cards') && (cardHasGames || !hasAnyRacquet());
  const cardBtn = hasType('cards')
    ? `<button class="logbar" id="logbtn"${act < 4 ? ' disabled title="Butuh 4 pemain aktif"' : ''}>Log game</button>` : '';
  const racquetSport = SPORT_ORDER.find(hasType);   // this board's racquet sport (single-type boards)
  // A padel board leads with Start Americano (the session flow) and keeps a quiet single-round log;
  // other racquet boards just have their one Log game button.
  let sportBtn = '';
  if (padelBoard) {
    const dis = act < 4 ? ' disabled title="Butuh 4 pemain aktif"' : '';
    sportBtn = `<button class="logbar" id="start-amer"${dis}>🎾 Start Americano</button>`
      + `<button class="logbar ghost" id="logsport"${act < 2 ? ' disabled title="Butuh 2 pemain"' : ''}>＋ Log round</button>`;
  } else if (hasAnyRacquet()) {
    sportBtn = `<button class="logbar sport" id="logsport"${act < 2 ? ' disabled title="Butuh 2 pemain"' : ''}>${SPORTS[racquetSport]?.icon ?? '🏓'} Log game</button>`;
  }
  document.body.classList.toggle('has-logbar', !noPlayers);  // reserve room for the fixed Log buttons

  // Daily Reveal gate: with players present but before the reveal hour (and not an admin peek), swap
  // the spotlights + tables for a locked card. Logging still works throughout.
  const revealed = isRevealed();
  const spotlights = padelBoard ? padelSpotlightHTML() : spotlightHTML();
  const tables = padelBoard
    ? `${padelSessionBanner()}${padelTableHTML()}`
    : `${showCardTable ? tableHTML(ranked, unranked) : ''}${sportTablesHTML()}${hasType('padel') ? padelTableHTML() : ''}`;
  const content = noPlayers
    ? `<div class="empty small"><h2>No players yet</h2>
        <p>${unlocked ? 'Add players, then log your first game.' : 'Unlock to add players.'}</p></div>`
    : revealed ? `${spotlights}${shareBarHTML()}${tables}` : lockedCardHTML();

  // Auto-flip at the reveal hour so a passive tab opens without a manual refresh (one-shot, re-armed
  // each render). Only when hidden by time — a peeked or already-open board needs no timer.
  clearTimeout(revealTimer);
  if (!noPlayers && !revealed) {
    const at = new Date(); at.setHours(boardRevealHour(), 0, 1, 0);
    const ms = at.getTime() - Date.now();
    if (ms > 0) revealTimer = setTimeout(render, ms);
  }

  app.innerHTML = `
    ${unlocked ? `<div class="admin-row">
      <button class="linkbtn" id="a-players"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M18 20a6 6 0 0 0-2-4.5"/></svg>Players</button>
      <button class="linkbtn" id="a-games"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Recent games</button>
      <button class="linkbtn" id="a-export"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>Export</button>
    </div>` : ''}
    ${content}
    ${!noPlayers && (cardBtn || sportBtn) ? `<div class="logbar-wrap">${cardBtn}${sportBtn}</div>` : ''}`;

  document.getElementById('view-early')?.addEventListener('click', openViewUnlock);
  document.getElementById('share-result')?.addEventListener('click', shareResult);
  app.querySelectorAll('.sort button').forEach((b) =>
    b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  document.getElementById('b-new')?.addEventListener('click', openNewBoard);
  document.getElementById('b-rename')?.addEventListener('click', openRenameBoard);
  document.getElementById('b-del')?.addEventListener('click', openDeleteBoard);
  document.getElementById('a-players')?.addEventListener('click', openPlayers);
  document.getElementById('a-games')?.addEventListener('click', openGames);
  document.getElementById('a-export')?.addEventListener('click', doExport);
  document.getElementById('logbtn')?.addEventListener('click', openLog);
  document.getElementById('logsport')?.addEventListener('click', openLogSport);
  document.getElementById('start-amer')?.addEventListener('click', openStartAmericano);
  document.getElementById('resume-amer')?.addEventListener('click', () => { const s = latestSession(); if (s) openSessionRunner(s); });
}

// ---- wire ----
document.getElementById('board').addEventListener('change', (e) => switchBoard(e.target.value));
document.getElementById('lock').addEventListener('click', () => {
  if (api.isUnlocked()) { api.lock(); render(); } else openPasscode();
});

refresh();
