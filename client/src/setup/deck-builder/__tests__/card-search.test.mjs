import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSearchQuery, resolveSearchPlan } from '../core/card-search.mjs';

// ---------------------------------------------------------------------------
// normalizeSearchQuery
// ---------------------------------------------------------------------------

test('normalizeSearchQuery: plain name passes through unchanged', () => {
  assert.equal(normalizeSearchQuery('Pikachu'), 'Pikachu');
});

// E4
test('normalizeSearchQuery: standalone E4 → 4', () => {
  assert.equal(normalizeSearchQuery('E4'), '4');
  assert.equal(normalizeSearchQuery('e4'), '4');
});

test('normalizeSearchQuery: name E4 suffix → name 4', () => {
  assert.equal(normalizeSearchQuery('Infernape E4'), 'Infernape 4');
});

test('normalizeSearchQuery: name E4 LV.X → name 4', () => {
  assert.equal(normalizeSearchQuery('Infernape E4 LV.X'), 'Infernape 4');
  assert.equal(normalizeSearchQuery('Infernape E4 LV. X'), 'Infernape 4');
});

// LV.X normalisation (spacing)
test('normalizeSearchQuery: LV.X → LV. X (space added)', () => {
  assert.equal(normalizeSearchQuery('Torterra LV.X'), 'Torterra LV. X');
});

test('normalizeSearchQuery: LV. X already correct passes through', () => {
  assert.equal(normalizeSearchQuery('Torterra LV. X'), 'Torterra LV. X');
});

test('normalizeSearchQuery: standalone LV.X → LV. X', () => {
  assert.equal(normalizeSearchQuery('LV.X'), 'LV. X');
});

// Prism star
test('normalizeSearchQuery: standalone "prism star" → ◇', () => {
  assert.equal(normalizeSearchQuery('prism star'), '◇');
  assert.equal(normalizeSearchQuery('Prism Star'), '◇');
});

test('normalizeSearchQuery: standalone ◇ passes through', () => {
  assert.equal(normalizeSearchQuery('◇'), '◇');
});

test('normalizeSearchQuery: standalone {*} → ◇', () => {
  assert.equal(normalizeSearchQuery('{*}'), '◇');
});

test('normalizeSearchQuery: name prism star suffix → name ◇', () => {
  assert.equal(normalizeSearchQuery('Mewtwo prism star'), 'Mewtwo ◇');
});

test('normalizeSearchQuery: name {*} suffix → name ◇', () => {
  assert.equal(normalizeSearchQuery('Mewtwo {*}'), 'Mewtwo ◇');
});

// Gold star
test('normalizeSearchQuery: standalone "gold star" → Star', () => {
  assert.equal(normalizeSearchQuery('gold star'), 'Star');
  assert.equal(normalizeSearchQuery('Gold Star'), 'Star');
});

test('normalizeSearchQuery: standalone * → Star', () => {
  assert.equal(normalizeSearchQuery('*'), 'Star');
});

test('normalizeSearchQuery: standalone ☆ → Star', () => {
  assert.equal(normalizeSearchQuery('☆'), 'Star');
});

test('normalizeSearchQuery: name gold star suffix → name Star', () => {
  assert.equal(normalizeSearchQuery('Pikachu gold star'), 'Pikachu Star');
});

test('normalizeSearchQuery: name * suffix → name Star', () => {
  assert.equal(normalizeSearchQuery('Pikachu *'), 'Pikachu Star');
});

test('normalizeSearchQuery: name ☆ suffix → name Star', () => {
  assert.equal(normalizeSearchQuery('Pikachu ☆'), 'Pikachu Star');
});

// Delta species
test('normalizeSearchQuery: standalone "delta" → δ', () => {
  assert.equal(normalizeSearchQuery('delta'), 'δ');
  assert.equal(normalizeSearchQuery('Delta'), 'δ');
  assert.equal(normalizeSearchQuery('DELTA'), 'δ');
});

test('normalizeSearchQuery: standalone δ passes through', () => {
  assert.equal(normalizeSearchQuery('δ'), 'δ');
});

test('normalizeSearchQuery: name delta suffix → name δ', () => {
  assert.equal(normalizeSearchQuery('Charizard delta'), 'Charizard δ');
  assert.equal(normalizeSearchQuery('Pikachu Delta'), 'Pikachu δ');
});

// ---------------------------------------------------------------------------
// resolveSearchPlan
// ---------------------------------------------------------------------------

test('resolveSearchPlan: plain name → single name query', () => {
  assert.deepEqual(resolveSearchPlan('Pikachu'), { type: 'name', queries: ['Pikachu'] });
});

test('resolveSearchPlan: LV. X suffix → stage plan', () => {
  assert.deepEqual(resolveSearchPlan('Torterra LV. X'), {
    type: 'stage',
    stage: 'LEVEL-UP',
    baseName: 'Torterra',
  });
});

test('resolveSearchPlan: standalone LV. X → stage plan with empty baseName', () => {
  assert.deepEqual(resolveSearchPlan('LV. X'), {
    type: 'stage',
    stage: 'LEVEL-UP',
    baseName: '',
  });
});

test('resolveSearchPlan: space-EX → dual query including hyphen-EX', () => {
  const plan = resolveSearchPlan('Charizard EX');
  assert.equal(plan.type, 'name');
  assert.ok(plan.queries.includes('Charizard EX'));
  assert.ok(plan.queries.includes('Charizard-EX'));
});

test('resolveSearchPlan: hyphen-EX → dual query including space-EX', () => {
  const plan = resolveSearchPlan('Charizard-EX');
  assert.equal(plan.type, 'name');
  assert.ok(plan.queries.includes('Charizard-EX'));
  assert.ok(plan.queries.includes('Charizard EX'));
});

test('resolveSearchPlan: space-GX → dual query including hyphen-GX', () => {
  const plan = resolveSearchPlan('Charizard GX');
  assert.equal(plan.type, 'name');
  assert.ok(plan.queries.includes('Charizard GX'));
  assert.ok(plan.queries.includes('Charizard-GX'));
});

test('resolveSearchPlan: hyphen-GX → dual query including space-GX', () => {
  const plan = resolveSearchPlan('Charizard-GX');
  assert.equal(plan.type, 'name');
  assert.ok(plan.queries.includes('Charizard-GX'));
  assert.ok(plan.queries.includes('Charizard GX'));
});
