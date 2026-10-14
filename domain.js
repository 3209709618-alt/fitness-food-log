export const STORAGE_KEY = 'shiheng:v1';
export const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'];
export const ACTIVITIES = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
export const GOALS = { cut: 0.9, maintain: 1, bulk: 1.1 };
export const EMPTY = () => ({ version: 1, profile: null, targets: null, foods: [], entries: [] });

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && localDate(d) === value;
}
const numberIn = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fail = (message) => { throw new Error(message); };

export function validateProfile(p) {
  if (!p || !numberIn(p.age, 18, 100) || !Number.isInteger(p.age) || !numberIn(p.height, 100, 250) || !numberIn(p.weight, 30, 300)
    || !['male', 'female', 'unspecified'].includes(p.sex) || !Object.hasOwn(ACTIVITIES, p.activity) || !Object.hasOwn(GOALS, p.goal)) fail('身体资料不完整或超出本工具的估算范围。');
  return p;
}
export function estimateTargets(profile) {
  const p = validateProfile(profile);
  const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
  const factor = ACTIVITIES[p.activity] * GOALS[p.goal];
  const low = (base - 161) * factor;
  const high = (base + 5) * factor;
  const kcal = Math.round(p.sex === 'male' ? high : p.sex === 'female' ? low : (low + high) / 2);
  const protein = Math.round(1.6 * p.weight);
  const fat = Math.round(kcal * 0.3 / 9);
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (kcal <= 0 || carbs < 0) fail('此资料组合不适合自动分配营养目标，请手动设置。');
  return { targets: { kcal, protein, carbs, fat }, range: p.sex === 'unspecified' ? [Math.round(low), Math.round(high)] : null };
}
export function validateTargets(t) {
  if (!t || !numberIn(t.kcal, 1, 20000) || !['protein', 'carbs', 'fat'].every(k => numberIn(t[k], 0, 2000))) fail('请填写有效的每日热量与营养素目标。');
  return t;
}
export function validateFood(food) {
  if (!food || !text(food.id, 120) || !text(food.name) || !text(food.state, 120) || !food.per100g
    || !NUTRIENTS.every(k => food.per100g[k] === null || numberIn(food.per100g[k], 0, k === 'kcal' ? 1000 : 100))) fail('食物的名称、状态或每 100 克营养值无效。');
  if (!NUTRIENTS.some(k => food.per100g[k] !== null)) fail('请至少填写一项已知营养值。');
  const s = food.source;
  if (!s || !text(s.name) || !text(s.license, 200) || !text(s.version, 200) || !text(s.id, 120) || typeof s.url !== 'string') fail('食物缺少完整来源信息。');
  if (s.url && (!/^https:\/\//i.test(s.url) || s.url.length > 1000)) fail('来源链接必须是 HTTPS 链接。');
  return food;
}
export const nutritionValue = value => value === '' ? null : Number(value);
export function scaleFood(food, grams) {
  if (!numberIn(grams, 0.1, 10000)) fail('份量应为 0.1–10000 克。');
  return Object.fromEntries(NUTRIENTS.map(k => [k, food.per100g[k] === null ? null : food.per100g[k] * grams / 100]));
}
export function summarize(entries) {
  const result = Object.fromEntries(NUTRIENTS.map(k => [k, { value: 0, incomplete: false }]));
  for (const entry of entries) {
    const amount = scaleFood(entry.food, entry.grams);
    for (const k of NUTRIENTS) {
      if (amount[k] === null) result[k].incomplete = true;
      else result[k].value += amount[k];
    }
  }
  return result;
}
export function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.foods) || !Array.isArray(state.entries)) fail('不是支持的食衡 V1 备份文件。');
  if (state.profile !== null) validateProfile(state.profile);
  if (state.targets !== null) validateTargets(state.targets);
  if (state.foods.length > 10000 || state.entries.length > 100000) fail('备份中的记录数量过多。');
  const foodIds = new Set(), entryIds = new Set();
  for (const food of state.foods) {
    validateFood(food);
    if (foodIds.has(food.id)) fail('备份含重复的食物编号。');
    foodIds.add(food.id);
  }
  for (const e of state.entries) {
    if (!e || !text(e.id, 120) || entryIds.has(e.id) || !validDate(e.date) || !Object.hasOwn(MEALS, e.meal) || !numberIn(e.grams, 0.1, 10000)) fail('备份含无效或重复的饮食记录。');
    validateFood(e.food);
    entryIds.add(e.id);
  }
  return state;
}
export function parseBackup(raw) {
  if (typeof raw !== 'string' || raw.length > 10000000) fail('备份文件过大，最大支持 10 MB。');
  try { return validateState(JSON.parse(raw)); }
  catch (e) { if (e instanceof SyntaxError) fail('文件不是有效的 JSON，原记录未改变。'); throw e; }
}
export function writeState(storage, state) {
  validateState(state);
  // Validate and persist first: a failed write must not replace the working state.
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

export function normalizeUsdaFood(raw) {
  if (!raw || !Number.isSafeInteger(raw.fdcId) || !text(raw.description) || !Array.isArray(raw.foodNutrients)) return null;
  const get = (ids, unit) => {
    for (const id of ids) {
      const n = raw.foodNutrients.find(n => n.nutrientId === id && String(n.unitName).toLowerCase() === unit && numberIn(n.value, 0, id === 1008 || id >= 2047 ? 1000 : 100));
      if (n) return n.value;
    }
    return null;
  };
  const food = {
    id: `usda:${raw.fdcId}`, name: raw.description, state: '以原文描述的食物状态为准',
    per100g: { kcal: get([1008, 2048, 2047], 'kcal'), protein: get([1003], 'g'), carbs: get([1005], 'g'), fat: get([1004], 'g') },
    source: { name: 'USDA FoodData Central', id: String(raw.fdcId), url: `https://fdc.nal.usda.gov/food-details/${raw.fdcId}/nutrients`, license: '请遵循 USDA 对应数据集条款；本项目未在线核验', version: `${raw.dataType || '未注明类别'} · ${raw.publicationDate || '未注明日期'}` }
  };
  try { return validateFood(food); } catch { return null; }
}
