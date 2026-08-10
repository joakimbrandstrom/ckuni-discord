import assert from 'node:assert/strict';
import test from 'node:test';
import { optionalNonEmpty } from '../src/env.js';

test('blank optional env values are treated as unset', () => {
  assert.equal(optionalNonEmpty.parse(''), undefined);
  assert.equal(optionalNonEmpty.parse('   '), undefined);
});

test('configured optional env values are preserved and trimmed', () => {
  assert.equal(optionalNonEmpty.parse('  configured  '), 'configured');
});
