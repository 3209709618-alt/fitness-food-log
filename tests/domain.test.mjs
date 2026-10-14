import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, STORAGE_KEY, estimateTargets, summarize, scaleFood, parseBackup, writeState, normalizeUsdaFood, validateState, validateFood, nutritionValue, validDate } from '../domain.js';

const profile = { age: 30, sex: 'female', height: 165, weight: 60, activity: 'moderate', goal: 'maintain' };
const food = { id: 'custom:one', name: '豆腐', state: '熟重', per100g: { kcal: 130, protein: 12, carbs: 3, fat: 8 }, source: { name: '包装标签', id: 'custom:one', url: '', license: '用户自填 · 未经机构核验', version: '2026-10-14' } };

test('Mifflin–St Jeor estimates and derives editable macro targets', () => {
  const result = estimateTargets(profile);
  assert.equal(result.targets.kcal, 2046);
  assert.equal(result.targets.protein, 96);
  assert.equal(result.targets.fat, 68);
  assert.ok(result.targets.carbs > 0);
  const unknown = estimateTargets({ ...profile, sex: 'unspecified' });
  assert.ok(unknown.range[0] < unknown.range[1]);
  assert.equal(unknown.targets.kcal, Math.round((unknown.range[0] + unknown.range[1]) / 2));
  assert.throws(() => estimateTargets({ ...profile, age: 17 }), /估算范围/);
});

test('portion scaling and daily totals preserve unknown nutrients', () => {
  assert.deepEqual(scaleFood(food, 150), { kcal: 195, protein: 18, carbs: 4.5, fat: 12 });
  const unknownFood = { ...food, per100g: { ...food.per100g, carbs: null } };
  const totals = summarize([{ food: unknownFood, grams: 200 }]);
  assert.equal(totals.kcal.value, 260);
  assert.equal(totals.carbs.value, 0);
  assert.equal(totals.carbs.incomplete, true);
  assert.equal(totals.protein.incomplete, false);
});

test('blank custom nutrients stay unknown while an explicit zero stays zero', () => {
  assert.equal(nutritionValue(''), null);
  assert.equal(nutritionValue('0'), 0);
  const partial = { ...food, per100g: { kcal: 0, protein: nutritionValue('12'), carbs: null, fat: null } };
  assert.equal(scaleFood(partial, 100).kcal, 0);
  assert.equal(scaleFood(partial, 100).carbs, null);
  assert.throws(() => validateFood({ ...partial, per100g: { kcal: null, protein: null, carbs: null, fat: null } }), /至少填写/);
});

test('backup rejects invalid shape before replacing current data', () => {
  const state = EMPTY(); state.foods.push(food); state.entries.push({ id: 'e1', date: '2026-10-14', meal: 'lunch', grams: 150, food });
  const roundTrip = parseBackup(JSON.stringify(state));
  assert.equal(roundTrip.entries.length, 1);
  const storage = { value: JSON.stringify(state), setItem(k, v) { assert.equal(k, STORAGE_KEY); this.value = v; } };
  assert.throws(() => writeState(storage, { version: 2, foods: [], entries: [] }));
  const preserved = storage.value;
  assert.throws(() => parseBackup('{bad json'), /JSON/);
  assert.equal(storage.value, preserved);
});

test('USDA search results retain source identifiers and unknown values', () => {
  const result = normalizeUsdaFood({ fdcId: 1234, description: 'Egg, whole, raw', dataType: 'SR Legacy', publicationDate: '2024-04-01', foodNutrients: [
    { nutrientId: 1008, unitName: 'KCAL', value: 143 }, { nutrientId: 1003, unitName: 'G', value: 12.6 }, { nutrientId: 1004, unitName: 'G', value: 9.5 }
  ] });
  assert.equal(result.id, 'usda:1234');
  assert.equal(result.per100g.carbs, null);
  assert.match(result.source.url, /1234/);
  assert.equal(normalizeUsdaFood({ fdcId: 1234, description: 'Egg', foodNutrients: [] }), null);
});

test('backup validation rejects impossible dates, duplicates and unsafe source URLs', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  const state = { ...EMPTY(), foods: [food], entries: [{ id: 'one', date: '2026-10-14', meal: 'lunch', grams: 100, food }] };
  assert.throws(() => validateState({ ...state, entries: [...state.entries, ...state.entries] }), /重复/);
  assert.throws(() => validateState({ ...state, entries: [{ ...state.entries[0], grams: -1 }] }), /无效/);
  assert.throws(() => validateState({ ...state, foods: [{ ...food, source: { ...food.source, url: 'javascript:alert(1)' } }] }), /HTTPS/);
  assert.throws(() => parseBackup(JSON.stringify({ ...state, foods: [food, food] })), /重复/);
});

test('failed storage writes preserve previous data', () => {
  const before = JSON.stringify(EMPTY());
  const storage = { value: before, setItem() { throw new Error('QuotaExceeded'); } };
  assert.throws(() => writeState(storage, { ...EMPTY(), foods: [food] }), /QuotaExceeded/);
  assert.equal(storage.value, before);
});

test('goal modes use the selected adjustment; invalid estimates fail explicitly', () => {
  const base = (10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 161) * 1.55;
  assert.equal(estimateTargets({ ...profile, goal: 'cut' }).targets.kcal, Math.round(base * 0.9));
  assert.equal(estimateTargets({ ...profile, goal: 'bulk' }).targets.kcal, Math.round(base * 1.1));
  assert.throws(() => estimateTargets({ ...profile, weight: NaN }));
});
