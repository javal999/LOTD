// Data-access seam. MOCK (in-memory) for local preview; swap the bodies for Supabase
// reads + Edge Function writes at wiring (Epic 3 / M5) — callers don't change.
//
// SECURITY: unlock() here accepts any non-empty passcode LOCALLY so the flow is
// demoable without a backend. The real passcode check is server-side in the admin
// Edge Function (the browser must never hold the write secret or gate its own writes).
// Do not ship this mock unlock.  ponytail: one seam to replace, clearly marked.
import { validateGame } from './tally.mjs';

const roster = [
  { id: 1, name: 'Ade' }, { id: 2, name: 'Bima' }, { id: 3, name: 'Citra' },
  { id: 4, name: 'Dewi' }, { id: 5, name: 'Eka' }, { id: 6, name: 'Fajar' },
];
const TODAY = '2026-07-14';
let nextId = 1;
const G = (players, loser, day) => ({ id: nextId++, players, loser, played_at: `2026-07-${day}T21:00:00Z` });
let games = [
  G([1,2,3,4],2,'12'), G([1,2,3,4],3,'12'), G([1,2,3,4],2,'12'), G([1,2,3,6],6,'12'), G([1,2,4,6],2,'12'),
  G([1,3,4,6],3,'13'), G([2,3,4,6],4,'13'), G([1,2,3,4],2,'13'), G([1,2,3,4],3,'13'), G([1,2,4,5],5,'13'),
  G([1,3,4,5],4,'13'), G([2,3,4,5],2,'13'),
  G([1,2,3,4],4,'14'), G([1,2,3,4],2,'14'), G([1,2,3,6],3,'14'), G([1,2,4,6],2,'14'),
  G([1,3,4,6],3,'14'), G([2,3,4,6],2,'14'), G([1,2,3,4],1,'14'), G([1,2,3,4],3,'14'),
];
let unlocked = false;

export const TODAY_ISO = TODAY;
export function state() { return { roster, games: games.slice(), season: 'Season 1', today: TODAY, unlocked }; }
export function isUnlocked() { return unlocked; }
export function unlock(passcode) { unlocked = Boolean(passcode); return unlocked; } // real check is server-side
export function lock() { unlocked = false; }

// Log a finished game. Re-validates the invariant even though the UI guards it —
// the write layer is a trust boundary and must not assume clean input.
export function logGame({ players, loser }) {
  if (!unlocked) throw new Error('unlock first');
  const v = validateGame(players, loser);
  if (!v.ok) throw new Error(v.error);
  const played_at = `${TODAY}T${String(21 + (games.length % 3)).padStart(2, '0')}:${String(games.length % 60).padStart(2, '0')}:00Z`;
  const game = { id: nextId++, players: players.slice(), loser, played_at };
  games.push(game);
  return game;
}

// Undo the most recently logged game. Returns the removed game, or null if none.
export function undoLast() {
  if (!unlocked) throw new Error('unlock first');
  return games.pop() ?? null;
}

// Change who lost in a past game. Re-validates the invariant (the new loser must be
// one of that game's four players) so an edit can never produce an illegal record (PRD 7.6).
export function editLoser(id, loser) {
  if (!unlocked) throw new Error('unlock first');
  const game = games.find((g) => g.id === id);
  if (!game) throw new Error('game not found');
  const v = validateGame(game.players, loser);
  if (!v.ok) throw new Error(v.error);
  game.loser = loser;
  return game;
}

// Delete a past game by id. Returns the removed game, or throws if the id is unknown.
export function deleteGame(id) {
  if (!unlocked) throw new Error('unlock first');
  const i = games.findIndex((g) => g.id === id);
  if (i === -1) throw new Error('game not found');
  return games.splice(i, 1)[0];
}
