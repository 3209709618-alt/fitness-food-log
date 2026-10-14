import { STORAGE_KEY, MEALS, NUTRIENTS, EMPTY, localDate, validDate, estimateTargets, validateTargets, validateFood, nutritionValue, scaleFood, summarize, validateState, parseBackup, writeState } from './domain.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  food: '<path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M18 3c-4 3-4 9 0 9V3Zm0 9v9"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  leaf: '<path d="M20 3c-9-1-17 3-16 10 1 8 15 10 16-10ZM5 20l9-11"/>',
  book: '<path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  breakfast: '<path d="M3 17h18M6 21h12M7 13a5 5 0 0 1 10 0M12 2v3M3 6l2 2m16-2-2 2"/>',
  lunch: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  dinner: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  snack: '<path d="M5 10h13v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-7ZM18 11h1a3 3 0 1 1 0 6h-1M8 3v3m4-4v4m4-3v3"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.food}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const labels = { kcal: '热量', protein: '蛋白质', carbs: '碳水', fat: '脂肪' };
const fmt = (n, digits = 1) => n === null ? '未知' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(n);
const intakeText = (total, digits = 1) => total.incomplete ? total.value > 0 ? `≥ ${fmt(total.value, digits)}` : '未知' : fmt(total.value, digits);
const nutrientText = food => NUTRIENTS.map(k => `${labels[k]} ${fmt(food.per100g[k])}${food.per100g[k] === null ? '' : k === 'kcal' ? ' kcal' : ' g'}`).join(' · ');
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const staticHosting = location.hostname.endsWith('.github.io');
const foodTabs = staticHosting ? ['local', 'custom'] : ['local', 'usda', 'custom'];
if (staticHosting) $('#tab-usda').hidden = true;
const usdaTerms = new Map([['熟米饭','rice cooked'],['米饭','rice cooked'],['白米饭','rice white cooked'],['糙米饭','rice brown cooked'],['鸡胸肉','chicken breast'],['熟鸡胸肉','chicken breast cooked'],['鸡蛋','egg whole'],['熟鸡蛋','egg whole cooked'],['豆腐','tofu'],['燕麦','oats'],['三文鱼','salmon'],['西兰花','broccoli'],['红薯','sweet potato'],['土豆','potato'],['牛奶','milk'],['希腊酸奶','greek yogurt']]);
let state = EMPTY(), catalog = [], date = localDate(), storageBlocked = false, corruptRaw = null, selectedFood = null, editingId = null, draftProfile = null, settingsDirty = false, queryAbort = null, toastTimer;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { corruptRaw = raw; state = parseBackup(raw); corruptRaw = null; }
} catch (e) {
  storageBlocked = true;
  const notice = $('#storage-warning');
  notice.hidden = false;
  notice.innerHTML = `${esc('无法读取已保存的数据。为避免覆盖，已暂停保存。' + e.message)} <button class="text-button" data-action="recover-raw" type="button">导出原始数据</button><button class="text-button danger" data-action="reset-storage" type="button">重置本地数据</button>`;
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3300);
}
function errorAt(selector, message = '') { $(selector).textContent = message; $(selector).hidden = !message; }
function commit(next) {
  if (storageBlocked) throw new Error('请先处理顶部的数据读取问题。');
  try { writeState(localStorage, next); } catch (e) {
    if (e.name === 'QuotaExceededError') throw new Error('浏览器存储空间不足。请先导出备份；本次改动未保存。');
    if (e.name === 'SecurityError') throw new Error('浏览器不允许保存数据。本次改动未保存，请检查隐私设置。');
    throw e;
  }
  state = next; render();
}
function allFoods() { return [...new Map([...catalog, ...state.foods].map(f => [f.id, f])).values()]; }
function findFood(id) { return allFoods().find(f => f.id === id); }
function entriesOn(day = date) { return state.entries.filter(e => e.date === day); }
function view(name, focus = true) {
  if (!['journal', 'foods', 'settings'].includes(name)) name = 'journal';
  $$('.view').forEach(el => { el.hidden = el.id !== `view-${name}`; });
  $$('.sidebar [data-view]').forEach(el => el.dataset.view === name ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'));
  history.replaceState(null, '', `#${name}`);
  if (focus) { window.scrollTo({ top: 0 }); $('#main').focus({ preventScroll: true }); }
  if (name === 'settings') fillSettings();
}
function setDate(value) { if (!validDate(value)) { toast('请选择有效日期。'); $('#selected-date').value = date; return; } date = value; render(); }
function shiftDay(offset) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + offset); setDate(localDate(d)); }

function render() {
  $('#selected-date').value = date;
  errorAt('#weight-error');
  const today = date === localDate(), entries = entriesOn(), total = summarize(entries);
  $('#nutrition-title').textContent = today ? '今日营养' : '当日营养';
  $('#entry-count').textContent = `${entries.length} 条记录`;
  const weightEntry = (state.weightEntries || []).find(entry => entry.date === date);
  $('#weight-status').textContent = weightEntry ? `已记录 ${fmt(weightEntry.kg)} kg` : '这一天还未记录';
  $('#weight-kg').value = weightEntry?.kg ?? '';
  $('#delete-weight').hidden = !weightEntry;
  $('#total-kcal').textContent = intakeText(total.kcal, 0);
  const goal = state.targets?.kcal;
  $('#energy-progress').value = goal ? Math.min(100, total.kcal.value / goal * 100) : 0;
  $('#energy-progress').setAttribute('aria-valuetext', goal ? `已知摄入 ${fmt(total.kcal.value)}，目标 ${goal} 千卡` : '尚未设置热量目标');
  $('#energy-target').innerHTML = goal ? `目标 ${fmt(goal, 0)} <span>kcal</span><br><span>参考当前每日目标</span>` : '尚未设置目标<br><span>找到适合你的节奏</span>';
  $('#energy-message').textContent = total.kcal.incomplete ? '部分食物热量未知，当前总量不完整。' : goal ? (total.kcal.value > goal ? `高于目标 ${fmt(total.kcal.value - goal, 0)} kcal，按自己的节奏调整。` : `距离目标还有 ${fmt(goal - total.kcal.value, 0)} kcal。`) : entries.length ? '已记录本次摄入。设置目标后可查看完成进度。' : '从今天的第一餐开始。';
  $('#macros').innerHTML = ['protein', 'carbs', 'fat'].map(k => {
    const target = state.targets?.[k], t = total[k];
    return `<div class="macro ${k}"><div class="macro-label"><span class="dot"></span>${labels[k]}</div><div class="macro-value">${intakeText(t)}<span> / ${target == null ? '—' : fmt(target)} g</span></div><progress max="100" value="${target > 0 ? Math.min(100, t.value / target * 100) : 0}" aria-label="${labels[k]}目标进度" aria-valuetext="${t.incomplete ? '数据不完整；下限 ' : '已知 '}${fmt(t.value)} 克；${target == null ? '未设目标' : `目标 ${target} 克`}"></progress>${t.incomplete ? '<small>部分数值未知</small>' : ''}</div>`;
  }).join('');
  const mealHints = { breakfast: '给今天一个好开始。', lunch: '为下午补充一点能量。', dinner: '认真对待一天的最后一餐。', snack: '水果、酸奶，或训练后的补给。' };
  $('#meals').innerHTML = Object.entries(MEALS).map(([key, title]) => {
    const items = entries.filter(e => e.meal === key), sum = summarize(items).kcal;
    return `<section class="meal" aria-label="${title}"><div class="meal-heading"><span class="meal-symbol">${icon(key)}</span><div><h3>${title}</h3><p>${items.length ? `${intakeText(sum, 0)} kcal · ${items.length} 项食物` : '还未记录'}</p></div><button class="text-button" type="button" data-action="add" data-meal="${key}" aria-label="添加${title}">${icon('plus')} 添加</button></div>${items.length ? `<ul class="meal-items">${items.map(e => {
      const kcal = scaleFood(e.food, e.grams).kcal;
      return `<li><button type="button" class="entry-row" data-edit="${esc(e.id)}" aria-label="编辑 ${esc(e.food.name)}"><span><strong>${esc(e.food.name)}</strong><small>${fmt(e.grams)} g · ${esc(e.food.state)}</small></span><span class="entry-energy">${kcal === null ? '热量未知' : `${fmt(kcal, 0)} kcal`}</span></button></li>`;
    }).join('')}</ul>` : `<p class="meal-empty">${mealHints[key]}</p>`}</section>`;
  }).join('');
  let days = [], count = 0;
  for (let offset = -6; offset <= 0; offset++) {
    const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + offset);
    const day = localDate(d), hasFood = entriesOn(day).length > 0, weight = (state.weightEntries || []).find(entry => entry.date === day)?.kg;
    if (weight !== undefined) count++;
    days.push(`<button type="button" class="week-day${hasFood || weight !== undefined ? ' has-entry' : ''}" aria-pressed="${day === date}" aria-label="${day}${hasFood ? '，有餐食记录' : ''}${weight !== undefined ? `，体重 ${fmt(weight)} 千克` : ''}${!hasFood && weight === undefined ? '，无记录' : ''}" data-date="${day}"><small>${'日一二三四五六'[d.getDay()]}</small><span>${d.getDate()}</span><small class="week-weight">${weight === undefined ? '—' : fmt(weight)}</small><span class="day-dot"></span></button>`);
  }
  $('#week-strip').innerHTML = days.join('');
  $('#week-note').textContent = count ? `近 7 天已记录 ${count} 天体重；选择日期可查看或修改。` : '记录体重后，可在这里查看近 7 天。';
  const frequency = new Map();
  for (const e of state.entries) frequency.set(e.food.id, (frequency.get(e.food.id) || 0) + 1);
  $('#frequent-foods').innerHTML = allFoods().sort((a,b) => (frequency.get(b.id) || 0) - (frequency.get(a.id) || 0)).slice(0,3).map(f => `<button class="quick-food" type="button" data-use-food="${esc(f.id)}"><span>${esc(f.name)}</span>${icon('plus')}</button>`).join('');
  renderLibrary(); renderLocal();
}
function renderLibrary() {
  const q = $('#library-query').value.trim().toLowerCase();
  const foods = allFoods().filter(f => `${f.name} ${f.state} ${f.source.name}`.toLowerCase().includes(q));
  $('#library-list').innerHTML = foods.length ? foods.map(f => `<article class="food-library-row"><div><h3>${esc(f.name)}</h3><p>${esc(f.state)} · ${esc(f.source.name)}</p><p>每 100 g：${esc(nutrientText(f))}</p></div><button class="text-button" type="button" data-use-food="${esc(f.id)}">查看 / 记录</button>${state.foods.some(s => s.id === f.id) ? `<button class="text-button danger" type="button" data-remove-food="${esc(f.id)}" aria-label="移除 ${esc(f.name)}">移除</button>` : ''}</article>`).join('') : `<div class="empty-state"><h3>${q ? '还没有匹配的食物' : '从你常吃的一样食物开始。'}</h3><p>${q ? '换个名称试试，或添加自定义食物。' : '按包装标签填写一次，之后每餐都能直接使用。'}</p><button class="secondary" type="button" data-action="create-food">添加我的第一样食物</button></div>`;
}
function foodResults(foods, attr) {
  return foods.map(f => `<button class="food-result" type="button" ${attr}="${esc(f.id)}"><strong>${esc(f.name)}</strong><small>${esc(f.state)} · 每 100 g：${esc(nutrientText(f))}</small><small>${esc(f.source.name)} · ${esc(f.source.version)}</small></button>`).join('');
}
function renderLocal() {
  const q = $('#local-query').value.trim().toLowerCase();
  const foods = allFoods().filter(f => `${f.name} ${f.state}`.toLowerCase().includes(q));
  $('#local-results').innerHTML = foodResults(foods, 'data-pick-food') || `<p class="empty-copy">没有匹配的本地食物。可以切换到「自定义」，按食品标签填写${staticHosting ? '。' : '；或主动查询 USDA。'}</p>`;
}
function switchTab(tab) {
  ['local', 'usda', 'custom'].forEach(name => {
    $(`#pane-${name}`).hidden = name !== tab;
    $(`#tab-${name}`).setAttribute('aria-selected', String(name === tab));
    $(`#tab-${name}`).tabIndex = name === tab ? 0 : -1;
  });
}
function openEntry(meal = 'breakfast', food = null, entry = null, custom = false) {
  selectedFood = null; editingId = entry?.id || null;
  $('#entry-form').reset(); $('#custom-form').reset(); $('#local-query').value = '';
  ['#entry-error', '#custom-error'].forEach(s => errorAt(s));
  $('#entry-meal').value = entry?.meal || meal;
  $('#entry-date').value = entry?.date || date;
  $('#entry-grams').value = entry?.grams || 100;
  $('#delete-entry').hidden = !entry;
  $('#save-entry').textContent = entry ? '保存修改' : '记录这一餐';
  $('#save-entry').disabled = true;
  $('#dialog-title').textContent = entry ? '编辑这一餐' : custom ? '添加自定义食物' : '记录这一餐';
  $('#food-picker').hidden = false; $('#food-selection').hidden = true;
  switchTab(custom ? 'custom' : 'local'); renderLocal(); previewPortion();
  if (food || entry) selectFood(food || entry.food);
  $('#food-dialog').showModal();
  if (selectedFood) $('#entry-grams').focus();
  else if (custom) $('#custom-form [name=name]').focus();
  else $('#local-query').focus();
}
function selectFood(food) {
  selectedFood = food; $('#food-picker').hidden = true; $('#food-selection').hidden = false;
  $('#selection-name').textContent = food.name;
  $('#selection-state').textContent = food.state;
  const s = food.source;
  $('#selection-source').innerHTML = `来源：${esc(s.name)}<br>版本：${esc(s.version)} · 编号：${esc(s.id)}<br>许可 / 标注：${esc(s.license)}${s.url ? `<br><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">查看原始数据 ↗</a>` : ''}`;
  $('#selection-nutrients').textContent = `每 100 g：${nutrientText(food)}`;
  $('#save-entry').disabled = false;
  previewPortion(); $('#entry-grams').focus();
}
function previewPortion() {
  if (!selectedFood) { $('#portion-preview').textContent = '选好食物后，这里会显示本次摄入。'; return; }
  try {
    const n = scaleFood(selectedFood, Number($('#entry-grams').value));
    $('#portion-preview').textContent = `本次摄入：${NUTRIENTS.map(k => `${labels[k]} ${fmt(n[k])}${n[k] === null ? '' : k === 'kcal' ? ' kcal' : ' g'}`).join(' · ')}`;
  } catch { $('#portion-preview').textContent = '请填写 0.1–10000 克的有效份量。'; }
}
function fillSettings() {
  $('#profile-form').reset();
  if (state.profile) for (const [key, value] of Object.entries(state.profile)) $('#profile-form').elements[key].value = value;
  for (const k of NUTRIENTS) $('#targets-form').elements[k].value = state.targets?.[k] ?? '';
  draftProfile = null; settingsDirty = false;
  $('#settings-conflict').hidden = true; $('#save-targets').disabled = false;
}
function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.view) { view(button.dataset.view); if (button.dataset.scroll) $(`#${button.dataset.scroll}`).scrollIntoView({ block: 'start' }); }
    if (button.dataset.date) setDate(button.dataset.date);
    if (button.dataset.action === 'add') openEntry(button.dataset.meal || 'breakfast');
    if (button.dataset.action === 'create-food') openEntry('breakfast', null, null, true);
    if (button.dataset.action === 'reload-settings') { fillSettings(); toast('已载入最新保存的目标'); }
    if (button.dataset.useFood) openEntry('breakfast', findFood(button.dataset.useFood));
    if (button.dataset.pickFood) selectFood(findFood(button.dataset.pickFood));
    if (button.dataset.edit) { const e = state.entries.find(e => e.id === button.dataset.edit); if (e) openEntry(e.meal, null, e); }
    if (button.dataset.tab) switchTab(button.dataset.tab);
    if (button.dataset.query) { $('#usda-query').value = button.dataset.query; $('#usda-query').focus(); }
    if (button.dataset.removeFood && confirm('从食物库移除此食物？已经保存的餐食记录会保留原始营养数值。')) {
      commit({ ...state, foods: state.foods.filter(f => f.id !== button.dataset.removeFood) }); toast('已从食物库移除');
    }
    if (button.dataset.action === 'recover-raw') {
      if (corruptRaw) download(corruptRaw, 'shiheng-original-data.json'); else toast('浏览器未允许读取原始数据，请先检查隐私设置。');
    }
    if (button.dataset.action === 'reset-storage' && confirm('重置会删除本网站当前浏览器里的所有数据。确定已保留需要的原始备份？')) {
      writeState(localStorage, EMPTY()); storageBlocked = false; corruptRaw = null; state = EMPTY(); $('#storage-warning').hidden = true; render(); fillSettings();
    }
  } catch(e) { toast(e.message); }
});
$('#weight-form').addEventListener('submit', e => {
  e.preventDefault(); errorAt('#weight-error');
  try {
    const kg = Number($('#weight-kg').value);
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) throw new Error('体重需在 30–300 kg 之间。');
    const weightEntries = [...(state.weightEntries || []).filter(entry => entry.date !== date), { date, kg }].sort((a, b) => a.date.localeCompare(b.date));
    commit({ ...state, weightEntries }); toast('体重已保存');
  } catch (err) { errorAt('#weight-error', err.message); }
});
$('#delete-weight').addEventListener('click', () => {
  try { commit({ ...state, weightEntries: (state.weightEntries || []).filter(entry => entry.date !== date) }); toast('体重记录已删除'); }
  catch (err) { errorAt('#weight-error', err.message); }
});
$('#selected-date').addEventListener('change', e => setDate(e.target.value));
$('#prev-day').addEventListener('click', () => shiftDay(-1));
$('#next-day').addEventListener('click', () => shiftDay(1));
$('#today').addEventListener('click', () => setDate(localDate()));
$('#library-query').addEventListener('input', renderLibrary);
$('#local-query').addEventListener('input', renderLocal);
$('#entry-grams').addEventListener('input', previewPortion);
$('#close-dialog').addEventListener('click', () => $('#food-dialog').close());
$('#food-dialog').addEventListener('close', () => queryAbort?.abort());
$('#change-food').addEventListener('click', () => { selectedFood = null; $('#food-picker').hidden = false; $('#food-selection').hidden = true; $('#save-entry').disabled = true; previewPortion(); $('#food-picker [role="tabpanel"]:not([hidden]) input')?.focus(); });
$('.tabs').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const current = foodTabs.indexOf(document.activeElement.dataset.tab);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? foodTabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : foodTabs.length - 1)) % foodTabs.length;
  switchTab(foodTabs[next]); $(`#tab-${foodTabs[next]}`).focus();
});
$('#custom-form').addEventListener('submit', e => {
  e.preventDefault(); errorAt('#custom-error');
  try {
    const form = e.currentTarget, id = `custom:${uid()}`;
    const food = validateFood({ id, name: form.elements.name.value.trim(), state: form.elements.state.value, per100g: Object.fromEntries(NUTRIENTS.map(k => [k, nutritionValue(form.elements[k].value)])), source: { name: form.elements.source.value.trim(), id, url: '', license: '用户自填 · 未经机构核验', version: localDate() } });
    commit({ ...state, foods: [...state.foods, food] }); selectFood(food); toast('食物已保存在本机，可继续填写份量');
  } catch(err) { errorAt('#custom-error', err.message); }
});
$('#entry-form').addEventListener('submit', e => {
  e.preventDefault(); errorAt('#entry-error');
  try {
    if (!selectedFood) throw new Error('请先选择食物。');
    const entry = { id: editingId || uid(), date: $('#entry-date').value, meal: $('#entry-meal').value, grams: Number($('#entry-grams').value), food: structuredClone(selectedFood) };
    if (editingId && !state.entries.some(e => e.id === editingId)) throw new Error('这条记录已在其他窗口移除，请关闭后重新添加。');
    const entries = editingId ? state.entries.map(e => e.id === editingId ? entry : e) : [...state.entries, entry];
    const foods = state.foods.some(f => f.id === selectedFood.id) || catalog.some(f => f.id === selectedFood.id) ? state.foods : [...state.foods, structuredClone(selectedFood)];
    commit({ ...state, entries, foods }); setDate(entry.date); $('#food-dialog').close(); view('journal');
    $('.nutrition').classList.remove('saved-flash'); requestAnimationFrame(() => $('.nutrition').classList.add('saved-flash')); toast(editingId ? '记录已更新' : '这一餐，记好了');
  } catch(err) { errorAt('#entry-error', err.message); }
});
$('#delete-entry').addEventListener('click', () => {
  if (!editingId || !confirm('确定删除这条餐食记录？')) return;
  try { commit({ ...state, entries: state.entries.filter(e => e.id !== editingId) }); $('#food-dialog').close(); toast('记录已删除'); } catch(e) { errorAt('#entry-error', e.message); }
});
$('#profile-form').addEventListener('submit', e => {
  e.preventDefault(); errorAt('#profile-error');
  try {
    const data = Object.fromEntries(new FormData(e.currentTarget));
    for (const k of ['age', 'weight', 'height']) data[k] = Number(data[k]);
    const { targets, range } = estimateTargets(data);
    for (const k of NUTRIENTS) $('#targets-form').elements[k].value = targets[k];
    draftProfile = data; settingsDirty = true;
    $('#estimate-result').textContent = `${range ? `热量参考区间 ${range[0]}–${range[1]} kcal，已取中点。` : `估算热量 ${targets.kcal} kcal。`}可以修改目标，点击「保存目标」后生效。`;
  } catch(err) { errorAt('#profile-error', err.message); }
});
for (const form of ['#profile-form', '#targets-form']) $(form).addEventListener('input', () => { settingsDirty = true; });
$('#targets-form').addEventListener('submit', e => {
  e.preventDefault(); errorAt('#targets-error');
  try {
    if (!$('#settings-conflict').hidden) throw new Error('目标已在其他窗口更新，请先重新载入。');
    const targets = validateTargets(Object.fromEntries(NUTRIENTS.map(k => [k, Number(e.currentTarget.elements[k].value)])));
    commit({ ...state, targets, profile: draftProfile || state.profile }); fillSettings(); toast('每日目标已保存');
  } catch(err) { errorAt('#targets-error', err.message); }
});
let remoteFoods = [];
$('#usda-form').addEventListener('submit', async e => {
  e.preventDefault(); const q = $('#usda-query').value.trim(); if (!q) return;
  queryAbort?.abort(); const controller = new AbortController(); queryAbort = controller;
  const button = $('#usda-form button'); button.disabled = true; button.textContent = '查询中…';
  $('#usda-results').textContent = '正在查询 USDA…'; remoteFoods = [];
  try {
    const term = usdaTerms.get(q) || q;
    const response = await fetch(`/api/foods?q=${encodeURIComponent(term)}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '查询失败，请稍后重试。');
    remoteFoods = data.foods.map(validateFood);
    $('#usda-results').innerHTML = foodResults(remoteFoods, 'data-remote-food') || '<p class="empty-copy">未找到结果。试试英文名称，并注明 raw（生）或 cooked（熟）。</p>';
  } catch(err) { if (err.name !== 'AbortError') $('#usda-results').textContent = err.message || '连接失败，请使用本地食物。'; }
  finally { if (queryAbort === controller) { button.disabled = false; button.textContent = '搜索'; } }
});
$('#usda-results').addEventListener('click', e => { const b = e.target.closest('[data-remote-food]'); if (b) { const f = remoteFoods.find(f => f.id === b.dataset.remoteFood); if (f) selectFood(f); } });
$('#export-backup').addEventListener('click', () => {
  if (storageBlocked) { toast('请先导出顶部提示中的原始数据。'); return; }
  download(JSON.stringify(state, null, 2), `shiheng-backup-${localDate()}.json`); $('#backup-status').textContent = '已发起备份下载，请确认文件已保存。';
});
$('#import-backup').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 10000000) throw new Error('文件超过 10 MB，请选择较小的备份。');
    const next = parseBackup(await file.text());
    if (!confirm(`备份含 ${next.entries.length} 条餐食记录、${next.weightEntries.length} 天体重、${next.foods.length} 项食物。恢复将替换当前全部资料、目标和记录。建议先导出当前备份。确定恢复？`)) { $('#backup-status').textContent = '已取消恢复，当前数据未改变。'; return; }
    commit(next); fillSettings(); $('#backup-status').textContent = '备份已恢复。'; toast('备份已恢复');
  } catch(err) { $('#backup-status').textContent = `${err.message} 当前数据未改变。`; }
  finally { e.target.value = ''; }
});
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || storageBlocked) return;
  try {
    state = e.newValue ? parseBackup(e.newValue) : EMPTY(); render();
    if (!$('#view-settings').hidden) {
      if (settingsDirty) { $('#settings-conflict').hidden = false; $('#save-targets').disabled = true; }
      else fillSettings();
    }
    toast('已同步此浏览器其他窗口的更新');
  } catch { toast('其他窗口的数据无效，当前记录未改变。'); }
});
window.addEventListener('hashchange', () => view(location.hash.slice(1)));
render(); view(location.hash.slice(1), false);
try {
  const response = await fetch('data/foods.json'); if (!response.ok) throw new Error('catalog');
  const data = await response.json(); catalog = data.foods.map(validateFood);
  $('#catalog-note').textContent = catalog.length ? `已收录 ${catalog.length} 项有来源的本地食物，另有 ${state.foods.length} 项自行保存的食物。` : '权威食品数据包尚未导入。可先按食品标签创建自己的食物库；不会用未经核实的数字填充。'; render();
} catch { $('#catalog-note').textContent = '本地食品数据包暂不可用，已保存和自定义的食物仍可使用。'; }
