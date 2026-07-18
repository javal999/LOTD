import * as api from './api.js';
import { buildExport } from './export.mjs';
import {
  computeStandings, biggestLoserAllTime, biggestLoserForDate, losingStreak,
  MODES, LUCK_BASELINE, MIN_GAMES_FOR_RATE,
} from './ranking.mjs';

// ---- state ----
const LAST_BOARD = 'lotd.lastBoard';
let boards = [];      // [{id, name}]
let boardId = null;
let data = null;      // { standings, games, players }
let mode = MODES.HIGHEST_LOSS_RATE;  // default to the skill view — worst first, like the spotlight
let error = null;

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

const boardName = () => boards.find((b) => b.id === boardId)?.name ?? '';
const nameOf = (id) => data?.players.find((p) => p.id === id)?.name ?? '?';
const activePlayers = () => (data?.players ?? []).filter((p) => !p.archived);
const archivedPlayers = () => (data?.players ?? []).filter((p) => p.archived);

// ---- data ----
async function loadBoards() {
  boards = await api.listLeaderboards();
  const remembered = Number(localStorage.getItem(LAST_BOARD));
  boardId = boards.some((b) => b.id === remembered) ? remembered : (boards[0]?.id ?? null);
}
async function loadBoard() { data = boardId ? await api.loadBoard(boardId) : null; }

async function refresh() {
  try { await loadBoards(); await loadBoard(); error = null; }
  catch (e) { error = e.message; }
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
    <input class="field" type="password" inputmode="numeric" id="pc" placeholder="Passcode" autocomplete="off">
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
    <input class="field" id="n" placeholder="e.g. Poker night" autocomplete="off">
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="go">Create</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#n');
  box.querySelector('#go').addEventListener('click', async () => {
    if (!input.value.trim()) return input.focus();
    const created = await attempt(box.querySelector('#err'), async () => {
      const b = await api.createLeaderboard(input.value.trim());
      localStorage.setItem(LAST_BOARD, String(b.id));
    });
    if (created) { close(); await refresh(); }
  });
  input.focus();
}

function openRenameBoard() {
  const box = el(`<div class="sheet"><h2>Rename leaderboard</h2>
    <input class="field" id="n" value="${esc(boardName())}" autocomplete="off">
    <p class="sheet-error" id="err"></p>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="go">Save</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#n');
  box.querySelector('#go').addEventListener('click', async () => {
    if (!input.value.trim()) return input.focus();
    const okd = await attempt(box.querySelector('#err'), () => api.renameLeaderboard(boardId, input.value.trim()));
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

function openGames() {
  let editing = null, confirming = null;
  const box = el(`<div class="sheet"><h2>Recent games</h2>
    <p class="sheet-sub">Fix the loser or delete a game. Newest first.</p>
    <p class="sheet-error" id="err"></p>
    <div class="rows" id="rows"></div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Done</button></div></div>`);
  const close = openSheet(box);
  const rows = box.querySelector('#rows'), err = box.querySelector('#err');

  function draw() {
    const games = data?.games ?? [];
    if (!games.length) { rows.innerHTML = '<p class="row-empty">No games yet.</p>'; return; }
    rows.innerHTML = games.map((g) => {
      const who = [g.p1, g.p2, g.p3, g.p4].map(nameOf).join(' · ');
      if (editing === g.id) {
        const opts = [g.p1, g.p2, g.p3, g.p4].map((id) =>
          `<button class="chip${g.loser === id ? ' on' : ''}" data-new="${g.id}:${id}">${esc(nameOf(id))}</button>`).join('');
        return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(who)}</div>
          <div class="chips" style="margin-top:6px">${opts}</div></div></div>`;
      }
      if (confirming === g.id) {
        return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(who)}</div>
          <div class="row-sub">Delete this game?</div></div>
          <div class="row-actions"><button class="mini-btn danger" data-yes="${g.id}">Delete</button>
          <button class="mini-btn" data-no="${g.id}">Keep</button></div></div>`;
      }
      return `<div class="row-item"><div class="row-main"><div class="row-title">${esc(who)}</div>
        <div class="row-sub"><span class="loss">${esc(nameOf(g.loser))}</span> lost · ${g.game_date}</div></div>
        <div class="row-actions"><button class="mini-btn" data-edit="${g.id}">Edit</button>
        <button class="mini-btn" data-del="${g.id}">Delete</button></div></div>`;
    }).join('');
  }

  rows.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset; err.textContent = '';
    if (d.edit) { editing = Number(d.edit); confirming = null; draw(); }
    else if (d.new) {
      const [gid, lid] = d.new.split(':').map(Number);
      if (await attempt(err, () => api.editLoser(gid, lid))) { editing = null; await refresh(); draw(); }
    }
    else if (d.del) { confirming = Number(d.del); editing = null; draw(); }
    else if (d.yes) { if (await attempt(err, () => api.deleteGame(Number(d.yes)))) { confirming = null; await refresh(); draw(); } }
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

function spotlightHTML() {
  const rows = data?.standings ?? [];
  const games = data?.games ?? [];
  const players = data?.players ?? [];
  const today = api.localToday();

  const allNames = biggestLoserAllTime(rows);
  const allMax = rows.reduce((m, r) => Math.max(m, r.losses ?? 0), 0);
  const todayNames = biggestLoserForDate(games, players, today);
  const todayMax = todayNames.length
    ? games.filter((g) => g.game_date === today && nameOf(g.loser) === todayNames[0]).length : 0;

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
      games.length ? 'No games logged today' : 'No data yet', ' today')}
  </div>`;
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
       <button class="mini-btn" id="b-rename">Rename</button>
       <button class="mini-btn danger" id="b-del">Delete</button>` : '';

  const { ranked, unranked } = computeStandings(data?.standings ?? [], mode);
  const noPlayers = (data?.standings?.length ?? 0) === 0;
  const act = activePlayers().length;
  document.body.classList.toggle('has-logbar', !noPlayers);  // reserve room for the fixed Log button

  app.innerHTML = `
    ${unlocked ? `<div class="admin-row">
      <button class="linkbtn" id="a-players"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M18 20a6 6 0 0 0-2-4.5"/></svg>Players</button>
      <button class="linkbtn" id="a-games"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Recent games</button>
      <button class="linkbtn" id="a-export"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>Export</button>
    </div>` : ''}
    ${spotlightHTML()}
    ${noPlayers ? `<div class="empty small"><h2>No players yet</h2>
      <p>${unlocked ? 'Add players, then log your first game.' : 'Unlock to add players.'}</p></div>`
      : tableHTML(ranked, unranked)}
    ${!noPlayers ? `<button class="logbar" id="logbtn"${act < 4 ? ' disabled title="Butuh 4 pemain aktif dulu"' : ''}>Log game</button>` : ''}`;

  app.querySelectorAll('.sort button').forEach((b) =>
    b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  document.getElementById('b-new')?.addEventListener('click', openNewBoard);
  document.getElementById('b-rename')?.addEventListener('click', openRenameBoard);
  document.getElementById('b-del')?.addEventListener('click', openDeleteBoard);
  document.getElementById('a-players')?.addEventListener('click', openPlayers);
  document.getElementById('a-games')?.addEventListener('click', openGames);
  document.getElementById('a-export')?.addEventListener('click', doExport);
  document.getElementById('logbtn')?.addEventListener('click', openLog);
}

// ---- wire ----
document.getElementById('board').addEventListener('change', (e) => switchBoard(e.target.value));
document.getElementById('lock').addEventListener('click', () => {
  if (api.isUnlocked()) { api.lock(); render(); } else openPasscode();
});

refresh();
