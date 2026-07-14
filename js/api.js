// Data-access seam with two interchangeable backends, chosen by config.BACKEND:
//   'mock'     -> in-memory demo data (no backend needed)
//   'supabase' -> live reads via the anon key (RLS read-only) + writes via the admin
//                 Edge Function (holds the passcode + service_role key server-side)
// Callers use the same async-friendly interface either way; `await` handles both the
// sync mock returns and the async supabase promises.
//
// SECURITY: the mock's unlock accepts any passcode locally (demo only). In supabase mode
// the real gate is the Edge Function — the browser never holds a write secret.
import { SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND } from './config.js';
import { validateGame } from './tally.mjs';

// ---------------------------------------------------------------------------
// mock backend (in-memory)
// ---------------------------------------------------------------------------
const ROSTER = [
  { id: 1, name: 'Ade' }, { id: 2, name: 'Bima' }, { id: 3, name: 'Citra' },
  { id: 4, name: 'Dewi' }, { id: 5, name: 'Eka' }, { id: 6, name: 'Fajar' },
];
const TODAY = '2026-07-14';
let mNextId = 1;
const G = (players, loser, day) => ({ id: mNextId++, players, loser, played_at: `2026-07-${day}T21:00:00Z` });
let mGames = [
  G([1,2,3,4],2,'12'), G([1,2,3,4],3,'12'), G([1,2,3,4],2,'12'), G([1,2,3,6],6,'12'), G([1,2,4,6],2,'12'),
  G([1,3,4,6],3,'13'), G([2,3,4,6],4,'13'), G([1,2,3,4],2,'13'), G([1,2,3,4],3,'13'), G([1,2,4,5],5,'13'),
  G([1,3,4,5],4,'13'), G([2,3,4,5],2,'13'),
  G([1,2,3,4],4,'14'), G([1,2,3,4],2,'14'), G([1,2,3,6],3,'14'), G([1,2,4,6],2,'14'),
  G([1,3,4,6],3,'14'), G([2,3,4,6],2,'14'), G([1,2,3,4],1,'14'), G([1,2,3,4],3,'14'),
];
let mUnlocked = false;
let mSeason = 'Season 1';
let mArchives = [];

const mock = {
  load() {},
  state() {
    return {
      roster: ROSTER, games: mGames.slice(), season: mSeason, today: TODAY, unlocked: mUnlocked,
      archives: mArchives.map((a) => ({ season: a.season, games: a.games.slice() })),
    };
  },
  isUnlocked() { return mUnlocked; },
  unlock(passcode) { mUnlocked = Boolean(passcode); return mUnlocked; },
  lock() { mUnlocked = false; },
  logGame({ players, loser }) {
    if (!mUnlocked) throw new Error('unlock first');
    const v = validateGame(players, loser);
    if (!v.ok) throw new Error(v.error);
    const played_at = `${TODAY}T${String(21 + (mGames.length % 3)).padStart(2, '0')}:${String(mGames.length % 60).padStart(2, '0')}:00Z`;
    const game = { id: mNextId++, players: players.slice(), loser, played_at };
    mGames.push(game);
    return game;
  },
  undoLast() { if (!mUnlocked) throw new Error('unlock first'); return mGames.pop() ?? null; },
  editLoser(id, loser) {
    if (!mUnlocked) throw new Error('unlock first');
    const game = mGames.find((g) => g.id === id);
    if (!game) throw new Error('game not found');
    const v = validateGame(game.players, loser);
    if (!v.ok) throw new Error(v.error);
    game.loser = loser;
    return game;
  },
  deleteGame(id) {
    if (!mUnlocked) throw new Error('unlock first');
    const i = mGames.findIndex((g) => g.id === id);
    if (i === -1) throw new Error('game not found');
    return mGames.splice(i, 1)[0];
  },
  startSeason(name) {
    if (!mUnlocked) throw new Error('unlock first');
    mArchives.push({ season: mSeason, games: mGames.slice() });
    mGames = [];
    mSeason = name?.trim() || `Season ${mArchives.length + 1}`;
    return { season: mSeason, archived: mArchives.at(-1).season };
  },
  exportData() {
    return {
      app: 'LOTD', version: 1, season: mSeason, roster: ROSTER,
      games: mGames.slice(),
      archives: mArchives.map((a) => ({ season: a.season, games: a.games.slice() })),
    };
  },
};

// ---------------------------------------------------------------------------
// supabase backend (plain fetch — no dependency)
// ---------------------------------------------------------------------------
const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
let sCache = { roster: [], games: [], season: 'Season 1', activeId: null, archives: [] };
let sPasscode = '';
let sUnlocked = false;

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`read failed (${res.status})`);
  return res.json();
}
async function sbFn(action, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ action, passcode: sPasscode, payload }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(out.error || `write failed (${res.status})`);
  return out.data;
}

const supa = {
  async load() {
    const [seasons, players, rows] = await Promise.all([
      sbGet('seasons?select=*&order=id'),
      sbGet('players?select=*&order=id'),
      sbGet('games?select=*&order=played_at'),
    ]);
    const games = rows.map((g) => ({
      id: g.id, season_id: g.season_id, players: [g.p1, g.p2, g.p3, g.p4], loser: g.loser, played_at: g.played_at,
    }));
    const active = seasons.find((s) => s.is_active) ?? seasons.at(-1) ?? { id: null, name: 'Season 1' };
    const forSeason = (id) => games.filter((g) => g.season_id === id);
    sCache = {
      roster: players.map((p) => ({ id: p.id, name: p.name })),
      season: active.name,
      activeId: active.id,
      games: forSeason(active.id),
      archives: seasons.filter((s) => !s.is_active).map((s) => ({ season: s.name, games: forSeason(s.id) })),
    };
  },
  state() {
    return {
      roster: sCache.roster, games: sCache.games, season: sCache.season,
      today: new Date().toISOString().slice(0, 10), unlocked: sUnlocked, archives: sCache.archives,
    };
  },
  isUnlocked() { return sUnlocked; },
  unlock(passcode) { sPasscode = passcode ?? ''; sUnlocked = Boolean(sPasscode); return sUnlocked; }, // real check is on first write
  lock() { sUnlocked = false; sPasscode = ''; },
  logGame({ players, loser }) {
    const v = validateGame(players, loser);
    if (!v.ok) throw new Error(v.error);
    return sbFn('log_game', { players, loser });
  },
  undoLast() { return sbFn('undo_last', {}); },
  editLoser(id, loser) { return sbFn('edit_loser', { game_id: id, loser }); },
  deleteGame(id) { return sbFn('delete_game', { game_id: id }); },
  startSeason(name) { return sbFn('start_season', { name }); },
  exportData() {
    return {
      app: 'LOTD', version: 1, season: sCache.season, roster: sCache.roster,
      games: sCache.games, archives: sCache.archives,
    };
  },
};

// ---------------------------------------------------------------------------
// dispatcher — one interface, chosen backend
// ---------------------------------------------------------------------------
const impl = BACKEND === 'supabase' ? supa : mock;

export const load = () => impl.load();
export const state = () => impl.state();
export const isUnlocked = () => impl.isUnlocked();
export const unlock = (passcode) => impl.unlock(passcode);
export const lock = () => impl.lock();
export const logGame = (payload) => impl.logGame(payload);
export const undoLast = () => impl.undoLast();
export const editLoser = (id, loser) => impl.editLoser(id, loser);
export const deleteGame = (id) => impl.deleteGame(id);
export const startSeason = (name) => impl.startSeason(name);
export const exportData = () => impl.exportData();
