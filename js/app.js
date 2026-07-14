import * as api from './api.js';
import { tally, biggestLoser, validateGame } from './tally.mjs';
import { rank, computeStats, MODES, MIN_GAMES_FOR_RATE, LUCK_BASELINE } from './ranking.mjs';

let mode = MODES.LOSS_RATE;
let loadError = null;

// Refresh data (supabase) then re-render. Mock's load() is a no-op, so this is cheap there.
async function reload() {
  try { await api.load(); loadError = null; } catch (e) { loadError = e.message; }
  render();
}

const CROWN = '<svg class="crown" viewBox="0 0 24 24"><path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';

const pct = (r) => `${Math.round(r * 100)}%`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'es'}`;
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const nameOf = (roster, id) => roster.find((p) => p.id === id)?.name ?? '?';

// ---- Standings rendering ----
function rowHTML(p, ranked) {
  const crown = ranked && p.rank === 1 ? CROWN : '';
  const medal = ranked ? `<div class="medallion">${crown}${p.rank}</div>` : '<div class="medallion">–</div>';
  const meta = `${p.gp} games · <span class="loss">${plural(p.l, 'loss')}</span> · ${p.gamesNotLost} not lost`;
  let right;
  if (!ranked) {
    right = `<div class="stat"><span class="need">${MIN_GAMES_FOR_RATE - p.gp} more to rank</span></div>`;
  } else if (mode === MODES.LOSS_RATE) {
    const beats = p.beatsLuck ? `<span class="beats">${CHECK} beats luck</span>` : '';
    right = `<div class="stat"><div class="val">${pct(p.lossRate)}</div><div class="lbl">loss rate</div>${beats}</div>`;
  } else {
    right = `<div class="stat"><div class="val">${p.gamesNotLost}</div><div class="lbl">not lost</div></div>`;
  }
  return `<li class="row${ranked && p.rank === 1 ? ' rank-1' : ''}">${medal}
    <div class="who"><div class="name">${p.name}</div><div class="meta">${meta}</div></div>${right}</li>`;
}

function standingsHTML(ranked) {
  if (mode !== MODES.LOSS_RATE) return ranked.map((p) => rowHTML(p, true)).join('');
  let out = '', linePlaced = false;
  for (const p of ranked) {
    if (!linePlaced && p.lossRate >= LUCK_BASELINE) {
      out += `<div class="luck-line"><span>${pct(LUCK_BASELINE)} · pure chance</span></div>`;
      linePlaced = true;
    }
    out += rowHTML(p, true);
  }
  return out;
}

// Admin toolbar shown when unlocked (in both the populated and empty states).
function adminBar(unlocked, archives) {
  if (!unlocked) return '';
  const past = archives.length
    ? '<button class="linkbtn" id="past"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 8v11h12V8"/><path d="M9 12h6"/></svg>Past seasons</button>'
    : '';
  return `<div class="admin-row">
    <button class="linkbtn" id="history"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Recent games</button>
    <button class="linkbtn" id="export"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>Export</button>
    <button class="linkbtn" id="newseason"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>New season</button>
    ${past}
  </div>`;
}

function render() {
  const app = document.getElementById('app');
  if (loadError) {
    app.innerHTML = `<div class="error"><h2>Couldn't reach the server</h2><p>${loadError}</p></div>`;
    document.body.classList.remove('unlocked');
    return;
  }
  const { roster, games, season, today, unlocked, archives } = api.state();
  const players = tally(games, roster);
  const enough = players.filter((p) => p.gp >= MIN_GAMES_FOR_RATE).length;
  if (mode === MODES.LOSS_RATE && enough < 2) mode = MODES.GAMES_NOT_LOST;

  const { ranked, unranked } = rank(players, mode);
  const loser = biggestLoser(games, roster, today);
  document.getElementById('season').textContent = season;
  document.body.classList.toggle('unlocked', unlocked);

  const lockBtn = document.getElementById('lock');
  lockBtn.innerHTML = unlocked ? `${UNLOCK} Lock` : `${LOCK} Unlock`;
  lockBtn.setAttribute('aria-label', unlocked ? 'Lock editing' : 'Unlock to log games');

  if (players.every((p) => p.gp === 0)) {
    app.innerHTML = `${adminBar(unlocked, archives)}<div class="empty"><h2>No games yet</h2><p>${unlocked ? 'Tap Log game to record your first result.' : 'Unlock and log your first game to start the season.'}</p></div>${unlocked ? '<button class="logbar" id="logbtn">Log game</button>' : ''}`;
    wireDynamic();
    return;
  }

  const tonight = loser
    ? `<section class="tonight"><span class="tag">Today</span><span>Biggest loser: <strong>${loser.name}</strong> · ${plural(loser.losses, 'loss')}</span></section>`
    : '';
  const unrankedHTML = unranked.length
    ? `<section class="unranked"><h2>Not enough games yet</h2><ul class="standings">${unranked.map((p) => rowHTML(computeStats(p), false)).join('')}</ul></section>`
    : '';

  app.innerHTML = `
    ${tonight}
    ${adminBar(unlocked, archives)}
    <div class="sort" role="group" aria-label="Ranking mode">
      <button data-mode="${MODES.LOSS_RATE}" aria-pressed="${mode === MODES.LOSS_RATE}">Loss rate</button>
      <button data-mode="${MODES.GAMES_NOT_LOST}" aria-pressed="${mode === MODES.GAMES_NOT_LOST}">Games not lost</button>
    </div>
    <ol class="standings">${standingsHTML(ranked)}</ol>
    ${unrankedHTML}
    <p class="legend"><b>A win is any game you didn't lose.</b> With 4 players and 1 loser, pure chance is a
    ${pct(LUCK_BASELINE)} loss rate — below that line you're beating luck. Loss rate is the skill measure;
    games not lost rewards showing up.</p>
    ${unlocked ? '<button class="logbar" id="logbtn">Log game</button>' : ''}`;

  app.querySelectorAll('.sort button').forEach((b) =>
    b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  wireDynamic();
}

function wireDynamic() {
  document.getElementById('logbtn')?.addEventListener('click', openLog);
  document.getElementById('history')?.addEventListener('click', openHistory);
  document.getElementById('export')?.addEventListener('click', doExport);
  document.getElementById('newseason')?.addEventListener('click', openSeason);
  document.getElementById('past')?.addEventListener('click', openPast);
}

// ---- Overlay + sheet plumbing ----
function openSheet(box) {
  const overlay = el('<div class="overlay"></div>');
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  function esc(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', esc);
  return close;
}

// ---- Passcode unlock ----
function openPasscode() {
  const box = el(`<div class="sheet"><h2>Unlock to log</h2>
    <p class="sheet-sub">Enter the admin passcode. Only the scorekeeper changes results.</p>
    <input class="field" type="password" inputmode="numeric" id="pc" placeholder="Passcode" autocomplete="off">
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="do-unlock">Unlock</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#pc');
  const submit = () => { if (api.unlock(input.value)) { close(); render(); } else input.focus(); };
  box.querySelector('#do-unlock').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

// ---- Log a game: pick 4 players (default core 4), tap the loser, save ----
function openLog() {
  const { roster } = api.state();
  let selected = roster.slice(0, 4).map((p) => p.id); // 3-tap common case: 4 preset
  let loser = null;

  const box = el(`<div class="sheet"><h2>Log a game</h2>
    <p class="sheet-sub" id="log-hint"></p>
    <div class="chips" id="chips"></div>
    <div class="loser-grid" id="grid"></div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="save" disabled>Save game</button></div></div>`);
  const close = openSheet(box);
  const chips = box.querySelector('#chips');
  const grid = box.querySelector('#grid');
  const save = box.querySelector('#save');
  const hint = box.querySelector('#log-hint');

  function draw() {
    hint.textContent = selected.length === 4
      ? 'Tap the one player who lost.'
      : `Pick ${4 - selected.length} more player${selected.length === 3 ? '' : 's'}.`;
    chips.innerHTML = roster.map((p) =>
      `<button class="chip${selected.includes(p.id) ? ' on' : ''}" data-id="${p.id}" aria-pressed="${selected.includes(p.id)}">${p.name}</button>`).join('');
    grid.innerHTML = selected.length === 4
      ? selected.map((id) =>
          `<button class="tile${loser === id ? ' sel' : ''}" data-loser="${id}" aria-pressed="${loser === id}">
            <span class="tname">${nameOf(roster, id)}</span><span class="tlost">${loser === id ? 'lost' : ''}</span></button>`).join('')
      : '';
    const v = selected.length === 4 && loser != null && validateGame(selected, loser).ok;
    save.disabled = !v;
  }

  chips.addEventListener('click', (e) => {
    const id = Number(e.target.closest('.chip')?.dataset.id);
    if (!id) return;
    if (selected.includes(id)) { selected = selected.filter((x) => x !== id); if (loser === id) loser = null; }
    else if (selected.length < 4) selected.push(id);
    draw();
  });
  grid.addEventListener('click', (e) => {
    const id = Number(e.target.closest('.tile')?.dataset.loser);
    if (id) { loser = id; draw(); }
  });
  save.addEventListener('click', async () => {
    try {
      const game = await api.logGame({ players: selected, loser });
      close(); await reload(); showToast(game);
    } catch (err) { hint.textContent = err.message; }
  });
  draw();
}

// ---- Undo toast ----
let toastTimer;
function showToast(game) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const { roster } = api.state();
  const toast = el(`<div class="toast" role="status" aria-live="polite">
    <span><strong>${nameOf(roster, game.loser)}</strong> lost this one</span>
    <button class="toast-undo" id="undo">Undo</button></div>`);
  document.body.appendChild(toast);
  toast.querySelector('#undo').addEventListener('click', async () => {
    try { await api.undoLast(); toast.remove(); await reload(); } catch (e) { alert(e.message); }
  });
  toastTimer = setTimeout(() => toast.remove(), 5000);
}

// ---- Recent games: fix a past game's loser or delete it (PRD 7.6) ----
function openHistory() {
  let editingId = null, confirmingId = null;
  const box = el(`<div class="sheet"><h2>Recent games</h2>
    <p class="sheet-sub">Fix the loser or delete a game. Newest first.</p>
    <div class="glog" id="glog"></div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Done</button></div></div>`);
  openSheet(box);
  const list = box.querySelector('#glog');
  const day = (iso) => iso.slice(5, 10).replace('-', '/');

  function draw() {
    const { roster, games } = api.state();
    if (!games.length) { list.innerHTML = '<p class="glog-empty">No games yet.</p>'; return; }
    list.innerHTML = games.slice().reverse().map((g) => {
      const players = g.players.map((id) => nameOf(roster, id)).join(' · ');
      if (editingId === g.id) {
        const choices = g.players.map((id) =>
          `<button class="chip${g.loser === id ? ' on' : ''}" data-newloser="${g.id}:${id}">${nameOf(roster, id)}</button>`).join('');
        return `<div class="glog-row"><div class="glog-main"><div class="glog-players">${players}</div>
          <div class="glog-choices">Who lost? ${choices}</div></div></div>`;
      }
      if (confirmingId === g.id) {
        return `<div class="glog-row"><div class="glog-main"><div class="glog-players">${players}</div>
          <div class="glog-loser">Delete this game?</div></div>
          <div class="glog-actions"><button class="danger" data-confirmdel="${g.id}">Delete</button>
          <button data-cancel="${g.id}">Keep</button></div></div>`;
      }
      return `<div class="glog-row"><div class="glog-main"><div class="glog-players">${players}</div>
        <div class="glog-loser"><span class="loss">${nameOf(roster, g.loser)}</span> lost · ${day(g.played_at)}</div></div>
        <div class="glog-actions"><button data-edit="${g.id}">Edit</button><button data-del="${g.id}">Delete</button></div></div>`;
    }).join('');
  }

  list.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    try {
      if (d.edit) { editingId = Number(d.edit); confirmingId = null; draw(); }
      else if (d.newloser) { const [gid, lid] = d.newloser.split(':').map(Number); await api.editLoser(gid, lid); editingId = null; await reload(); draw(); }
      else if (d.del) { confirmingId = Number(d.del); editingId = null; draw(); }
      else if (d.confirmdel) { await api.deleteGame(Number(d.confirmdel)); confirmingId = null; await reload(); draw(); }
      else if (d.cancel) { confirmingId = null; draw(); }
    } catch (err) { alert(err.message); }
  });
  draw();
}

// ---- Export a complete backup (JSON, rebuildable) ----
function doExport() {
  const data = api.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LOTD-${data.season.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---- Start a new season: archive current + reset (with confirm) ----
function openSeason() {
  const { season, archives } = api.state();
  const box = el(`<div class="sheet"><h2>Start a new season</h2>
    <p class="sheet-sub">This archives <b>${season}</b> (still viewable and in your export) and resets everyone to zero.</p>
    <input class="field" id="sname" placeholder="Season name" value="Season ${archives.length + 2}" autocomplete="off">
    <div class="sheet-actions"><button class="btn-ghost" data-close>Cancel</button>
    <button class="btn-primary" id="do-season">Start season</button></div></div>`);
  const close = openSheet(box);
  const input = box.querySelector('#sname');
  box.querySelector('#do-season').addEventListener('click', async () => {
    try { await api.startSeason(input.value); close(); await reload(); } catch (e) { alert(e.message); }
  });
  input.focus(); input.select();
}

// ---- View archived seasons, read-only ----
function openPast() {
  const { roster, archives } = api.state();
  const body = archives.slice().reverse().map((a) => {
    const { ranked } = rank(tally(a.games, roster), MODES.LOSS_RATE);
    const rows = ranked.map((p) =>
      `<li class="past-row"><span class="past-rank">${p.rank}</span><span class="past-name">${p.name}</span><span class="past-val">${pct(p.lossRate)}</span></li>`).join('')
      || '<li class="past-row"><span class="past-name">No games</span></li>';
    return `<div class="past-season"><h3>${a.season} · ${a.games.length} games</h3><ol class="past-list">${rows}</ol></div>`;
  }).join('');
  const box = el(`<div class="sheet"><h2>Past seasons</h2>
    <p class="sheet-sub">Final standings by loss rate, read-only.</p>
    <div class="past-wrap">${body}</div>
    <div class="sheet-actions"><button class="btn-ghost" data-close>Done</button></div></div>`);
  openSheet(box);
}

document.getElementById('lock').addEventListener('click', () => {
  if (api.isUnlocked()) { api.lock(); render(); } else openPasscode();
});

reload();
