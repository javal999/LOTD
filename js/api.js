// Data access. Reads go straight to Supabase REST with the public anon key (RLS makes it
// read-only). Every write goes through the admin Edge Function, which holds the passcode
// and the service_role key — the browser never has either.
//
// No dependency: plain fetch is enough for a handful of tables.
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_FN } from './config.js';

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`Couldn't reach the server (${res.status})`);
  return res.json();
}

// ---- reads ----

export const listLeaderboards = () => get('leaderboards?select=id,name&order=name');

// Everything the UI needs for one leaderboard, in one round trip.
export async function loadBoard(leaderboardId) {
  const id = Number(leaderboardId);
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

async function call(action, payload = {}) {
  const res = await fetch(ADMIN_FN, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ action, passcode: sessionStorage.getItem(KEY) ?? '', payload }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out.data;
}

export const createLeaderboard = (name) => call('create_leaderboard', { name });
export const renameLeaderboard = (leaderboard_id, name) => call('rename_leaderboard', { leaderboard_id, name });
export const deleteLeaderboard = (leaderboard_id) => call('delete_leaderboard', { leaderboard_id });

export const addPlayer = (leaderboard_id, name) => call('add_player', { leaderboard_id, name });
export const deletePlayer = (player_id) => call('delete_player', { player_id });
export const restorePlayer = (player_id) => call('restore_player', { player_id });

// `today` is the device's local date — only the client knows it, and the server refuses
// any game_date after it.
export const logGame = ({ leaderboard_id, game_date, players, loser }) =>
  call('log_game', {
    leaderboard_id, game_date, today: localToday(),
    p1: players[0], p2: players[1], p3: players[2], p4: players[3], loser,
  });
export const undoLast = (leaderboard_id) => call('undo_last', { leaderboard_id });
export const editLoser = (game_id, loser) => call('edit_loser', { game_id, loser });
export const deleteGame = (game_id) => call('delete_game', { game_id });

// Local calendar date as YYYY-MM-DD (not UTC — a game logged at 1am belongs to that day
// for the person logging it).
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
