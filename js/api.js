// Data access. Reads go straight to Supabase REST with the public anon key (RLS makes it
// read-only). Every write goes through the admin Edge Function, which holds the passcode
// and the service_role key — the browser never has either.
//
// No dependency: plain fetch is enough for a handful of tables.
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_FN, USE_MOCK } from './config.js';

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// ---- demo / mock backend (?mock=1) ----
// A complete in-memory stand-in for Supabase so the whole app — reads AND writes — is
// playable with no server and no passcode. Resets on reload. Standings are computed the
// same way the v_standings view would (gp = games played, losses = games lost).
const mock = (() => {
  if (!USE_MOCK) return null;
  const s = {
    boards: [{ id: 1, name: 'Geng Kartu' }],
    players: [
      { id: 1, leaderboard_id: 1, name: 'Levi', archived: false },
      { id: 2, leaderboard_id: 1, name: 'Budi', archived: false },
      { id: 3, leaderboard_id: 1, name: 'Sari', archived: false },
      { id: 4, leaderboard_id: 1, name: 'Andi', archived: false },
      { id: 5, leaderboard_id: 1, name: 'Tegar', archived: false },
    ],
    games: [],
    seqP: 6, seqG: 1, seqB: 2,
  };
  // A little seeded history so the standings aren't empty on first load.
  const seed = (game_date, p, loser) => s.games.push(
    { id: s.seqG++, leaderboard_id: 1, game_date, p1: p[0], p2: p[1], p3: p[2], p4: p[3], loser, created_at: `${game_date}T12:00:00Z` });
  seed('2026-07-11', [1, 2, 3, 4], 1); // Levi
  seed('2026-07-12', [1, 2, 3, 5], 1); // Levi
  seed('2026-07-13', [2, 3, 4, 5], 5); // Tegar
  seed('2026-07-13', [1, 3, 4, 5], 4); // Andi (Levi played, didn't lose)
  seed('2026-07-14', [1, 2, 4, 5], 1); // Levi — streak starts
  seed('2026-07-15', [1, 2, 3, 5], 1); // Levi
  seed('2026-07-16', [1, 2, 3, 4], 1); // Levi (newest) → 🔥 streak of 3

  const board = (id) => s.boards.find((b) => b.id === id);
  const player = (id) => s.players.find((p) => p.id === id);
  const gamesOf = (id) => s.games.filter((g) => g.leaderboard_id === id);
  const inGame = (g, id) => [g.p1, g.p2, g.p3, g.p4].includes(id);
  const standings = (id) => s.players.filter((p) => p.leaderboard_id === id).map((p) => {
    const played = gamesOf(id).filter((g) => inGame(g, p.id));
    return { player_id: p.id, name: p.name, archived: p.archived,
      gp: played.length, losses: played.filter((g) => g.loser === p.id).length };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    listLeaderboards: () => s.boards.map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)),
    loadBoard: (id) => ({
      standings: standings(id),
      games: gamesOf(id).slice().sort((a, b) =>
        (a.game_date < b.game_date ? 1 : a.game_date > b.game_date ? -1 : (a.created_at < b.created_at ? 1 : -1))),
      players: s.players.filter((p) => p.leaderboard_id === id)
        .map((p) => ({ id: p.id, name: p.name, archived: p.archived })).sort((a, b) => a.name.localeCompare(b.name)),
    }),
    createLeaderboard: (name) => { const b = { id: s.seqB++, name }; s.boards.push(b); return b; },
    renameLeaderboard: (id, name) => { const b = board(id); if (b) b.name = name; return b; },
    deleteLeaderboard: (id) => {
      s.boards = s.boards.filter((b) => b.id !== id);
      s.players = s.players.filter((p) => p.leaderboard_id !== id);
      s.games = s.games.filter((g) => g.leaderboard_id !== id);
      return { leaderboard_id: id };
    },
    addPlayer: (leaderboard_id, name) => {
      if (s.players.some((p) => p.leaderboard_id === leaderboard_id && p.name.toLowerCase() === name.toLowerCase()))
        throw new Error('that player already exists');
      const p = { id: s.seqP++, leaderboard_id, name, archived: false }; s.players.push(p); return p;
    },
    deletePlayer: (id) => {
      if (s.games.some((g) => inGame(g, id))) { const p = player(id); if (p) p.archived = true; return { player_id: id, archived: true, deleted: false }; }
      s.players = s.players.filter((p) => p.id !== id); return { player_id: id, archived: false, deleted: true };
    },
    restorePlayer: (id) => { const p = player(id); if (p) p.archived = false; return { player_id: id, archived: false }; },
    logGame: ({ leaderboard_id, game_date, players, loser }) => {
      const g = { id: s.seqG++, leaderboard_id, game_date, p1: players[0], p2: players[1], p3: players[2], p4: players[3], loser, created_at: new Date().toISOString() };
      s.games.push(g); return g;
    },
    undoLast: (id) => {
      const last = gamesOf(id).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (!last) return null; s.games = s.games.filter((g) => g.id !== last.id); return { id: last.id };
    },
    editLoser: (game_id, loser) => { const g = s.games.find((x) => x.id === game_id); if (g) g.loser = loser; return { game_id, loser }; },
    deleteGame: (game_id) => { s.games = s.games.filter((g) => g.id !== game_id); return { game_id }; },
  };
})();

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`Couldn't reach the server (${res.status})`);
  return res.json();
}

// ---- reads ----

export const listLeaderboards = () =>
  USE_MOCK ? mock.listLeaderboards() : get('leaderboards?select=id,name&order=name');

// Everything the UI needs for one leaderboard, in one round trip.
export async function loadBoard(leaderboardId) {
  const id = Number(leaderboardId);
  if (USE_MOCK) return mock.loadBoard(id);
  const [standings, games, players] = await Promise.all([
    get(`v_standings?select=player_id,name,gp,losses,archived&leaderboard_id=eq.${id}&order=name`),
    get(`games?select=id,game_date,p1,p2,p3,p4,loser,created_at&leaderboard_id=eq.${id}&order=game_date.desc,created_at.desc`),
    get(`players?select=id,name,archived&leaderboard_id=eq.${id}&order=name`),
  ]);
  return { standings, games, players };
}

// ---- admin session ----
// The passcode lives in sessionStorage only: never in the database, never in localStorage,
// gone when the tab closes. It is proven by the server on the first write, not here.

const KEY = 'lotd.passcode';
export const isUnlocked = () => Boolean(sessionStorage.getItem(KEY));
export const unlock = (passcode) => { sessionStorage.setItem(KEY, passcode); };
export const lock = () => { sessionStorage.removeItem(KEY); };

// ---- writes (all through the Edge Function) ----

// `passcode` overrides the stored one for a single call — the confess-log flow proves the
// shared word ("pecundang") inline without touching the admin session in sessionStorage.
async function call(action, payload = {}, passcode) {
  const res = await fetch(ADMIN_FN, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ action, passcode: passcode ?? sessionStorage.getItem(KEY) ?? '', payload }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out.data;
}

export const createLeaderboard = (name) =>
  USE_MOCK ? mock.createLeaderboard(name) : call('create_leaderboard', { name });
export const renameLeaderboard = (leaderboard_id, name) =>
  USE_MOCK ? mock.renameLeaderboard(leaderboard_id, name) : call('rename_leaderboard', { leaderboard_id, name });
export const deleteLeaderboard = (leaderboard_id) =>
  USE_MOCK ? mock.deleteLeaderboard(leaderboard_id) : call('delete_leaderboard', { leaderboard_id });

export const addPlayer = (leaderboard_id, name) =>
  USE_MOCK ? mock.addPlayer(leaderboard_id, name) : call('add_player', { leaderboard_id, name });
export const deletePlayer = (player_id) =>
  USE_MOCK ? mock.deletePlayer(player_id) : call('delete_player', { player_id });
export const restorePlayer = (player_id) =>
  USE_MOCK ? mock.restorePlayer(player_id) : call('restore_player', { player_id });

// `today` is the device's local date — only the client knows it, and the server refuses
// any game_date after it. `secret` is the shared confess-word, proven inline on this write.
export const logGame = ({ leaderboard_id, game_date, players, loser, secret }) =>
  USE_MOCK ? mock.logGame({ leaderboard_id, game_date, players, loser })
    : call('log_game', {
      leaderboard_id, game_date, today: localToday(),
      p1: players[0], p2: players[1], p3: players[2], p4: players[3], loser,
    }, secret);
export const undoLast = (leaderboard_id, secret) =>
  USE_MOCK ? mock.undoLast(leaderboard_id) : call('undo_last', { leaderboard_id }, secret);
export const editLoser = (game_id, loser) =>
  USE_MOCK ? mock.editLoser(game_id, loser) : call('edit_loser', { game_id, loser });
export const deleteGame = (game_id) =>
  USE_MOCK ? mock.deleteGame(game_id) : call('delete_game', { game_id });

// Local calendar date as YYYY-MM-DD (not UTC — a game logged at 1am belongs to that day
// for the person logging it).
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
