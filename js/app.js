import * as api from './api.js';
import { tally, biggestLoser, validateGame } from './tally.mjs';
import { rank, computeStats, MODES, MIN_GAMES_FOR_RATE, LUCK_BASELINE } from './ranking.mjs';

let mode = MODES.LOSS_RATE;

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

function render() {
  const { roster, games, season, today, unlocked } = api.state();
  const players = tally(games, roster);
  const enough = players.filter((p) => p.gp >= MIN_GAMES_FOR_RATE).length;
  if (mode === MODES.LOSS_RATE && enough < 2) mode = MODES.GAMES_NOT_LOST;

  const { ranked, unranked } = rank(players, mode);
  const loser = biggestLoser(games, roster, today);
  const app = document.getElementById('app');
  document.getElementById('season').textContent = season;
  document.body.classList.toggle('unlocked', unlocked);

  const lockBtn = document.getElementById('lock');
  lockBtn.innerHTML = unlocked ? `${UNLOCK} Lock` : `${LOCK} Unlock`;
  lockBtn.setAttribute('aria-label', unlocked ? 'Lock editing' : 'Unlock to log games');

  if (players.every((p) => p.gp === 0)) {
    app.innerHTML = `<div class="empty"><h2>No games yet</h2><p>${unlocked ? 'Tap Log game to record your first result.' : 'Unlock and log your first game to start the season.'}</p></div>`;
    if (unlocked) app.insertAdjacentHTML('beforeend', `<button class="logbar" id="logbtn">Log game</button>`);
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
  save.addEventListener('click', () => {
    try {
      const game = api.logGame({ players: selected, loser });
      close(); render(); showToast(game);
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
  toast.querySelector('#undo').addEventListener('click', () => {
    api.undoLast(); toast.remove(); render();
  });
  toastTimer = setTimeout(() => toast.remove(), 5000);
}

document.getElementById('lock').addEventListener('click', () => {
  if (api.isUnlocked()) { api.lock(); render(); } else openPasscode();
});

render();
