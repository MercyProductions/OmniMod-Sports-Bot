import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateKey, localParts } from '../src/time.js';

test('midnight uses hour zero instead of hour 24', () => {
  const date = new Date('2099-01-02T00:00:00.000Z');
  assert.equal(localParts(date, 'UTC').hour, 0);
  assert.equal(localDateKey(date, 'UTC'), '2099-01-02');
});
