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
