import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from './api.js';

// The write seam is a trust boundary — test it directly (no DOM needed).
test('writes are refused until unlocked', () => {
  api.lock();
  assert.throws(() => api.logGame({ players: [1, 2, 3, 4], loser: 2 }), /unlock/);
  assert.throws(() => api.undoLast(), /unlock/);
});

test('logGame re-validates the 4p/1-loser invariant even when unlocked', () => {
  api.unlock('any');
  assert.throws(() => api.logGame({ players: [1, 2, 3, 3], loser: 3 }), /distinct/);
  assert.throws(() => api.logGame({ players: [1, 2, 3, 4], loser: 9 }), /loser/);
});

test('logGame appends a valid game and undoLast reverts it exactly', () => {
  api.unlock('any');
  const before = api.state().games.length;
  const logged = api.logGame({ players: [1, 2, 3, 4], loser: 4 });
  assert.equal(api.state().games.length, before + 1);
  assert.equal(logged.loser, 4);

  const removed = api.undoLast();
  assert.equal(removed.loser, 4);
  assert.equal(api.state().games.length, before); // back to square one
});

test('editLoser changes the loser and rejects one who was not at the table', () => {
  api.unlock('any');
  const g = api.logGame({ players: [1, 2, 3, 4], loser: 2 });
  assert.equal(api.editLoser(g.id, 3).loser, 3);
  assert.equal(api.state().games.find((x) => x.id === g.id).loser, 3);
  assert.throws(() => api.editLoser(g.id, 9), /loser/); // 9 not in the game
  api.deleteGame(g.id);
});

test('deleteGame removes exactly that game', () => {
  api.unlock('any');
  const before = api.state().games.length;
  const g = api.logGame({ players: [1, 2, 3, 4], loser: 1 });
  assert.equal(api.state().games.length, before + 1);
  assert.equal(api.deleteGame(g.id).id, g.id);
  assert.equal(api.state().games.length, before);
  assert.throws(() => api.deleteGame(g.id), /not found/); // already gone
});

test('editLoser and deleteGame require unlock', () => {
  api.unlock('any');
  const g = api.logGame({ players: [1, 2, 3, 4], loser: 2 });
  api.lock();
  assert.throws(() => api.editLoser(g.id, 3), /unlock/);
  assert.throws(() => api.deleteGame(g.id), /unlock/);
  api.unlock('any'); api.deleteGame(g.id);
});
