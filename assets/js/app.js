/* Main application: navigation, search, prompts, settings, palette and home. */

import {
  $, $$, store, toast, openModal, closeModal, confirmDialog, escapeHtml, icon,
  copyText, downloadFile, formatKickerDate, formatDateCN, relativeTime, dateKey,
  debounce, initCoreUI, isModalOpen, uid,
} from './core.js';
import {
  initBackground, getBackgroundSummary, clearBackgroundStore,
} from './background.js';
import {
  initChat, getApiConfig, saveApiConfig, testApiConnection, startNewChat, openThread,
  getThreads, getTodayChatCount, providerLabel,
} from './chat.js';
import { initTools } from './tools.js';

/* ---------- constants ---------- */
const ENGINES = [
  { id: 'bing', name: '必应', short: 'B', color: '#7f9bb1', url: 'https://www.bing.com/search?q=' },
  { id: 'baidu', name: '百度', short: '百', color: '#8e9aa7', url: 'https://www.baidu.com/s?wd=' },
  { id: 'google', name: 'Google', short: 'G', color: '#a5b0ba', url: 'https://www.google.com/search?q=' },
  { id: 'ddg', name: 'DuckDuckGo', short: 'D', color: '#bd989c', url: 'https://duckduckgo.com/?q=' },
  { id: 'github', name: 'GitHub', short: 'GH', color: '#898d92', url: 'https://github.com/search?q=', suffix: '&type=repositories' },
];

const CATEGORIES = ['全部', '写作', '效率', '代码', '翻译', '思考'];
const CATEGORY_PERSONA = { 写作: 'writer', 效率: 'general', 代码: 'coder', 翻译: 'translator', 思考: 'thinker' };
const CATEGORY_COLOR = {
  写作: 'var(--q1)', 效率: 'var(--q4)', 代码: 'var(--q2)', 翻译: 'var(--q3)', 思考: 'var(--q2)',
};

const PERSONA_META = {
  general: { label: '通用助手', char: '通', accent: 'accent-q1' },
  writer: { label: '写作编辑', char: '写', accent: 'accent-q2' },
  translator: { label: '翻译专家', char: '译', accent: 'accent-q3' },
  coder: { label: '代码顾问', char: '码', accent: 'accent-q4' },
  thinker: { label: '思考伙伴', char: '思', accent: 'accent-q1' },
};

const DEFAULT_PROMPTS = [
  {
    id: 'builtin-polish',
    title: '文章润色',
    category: '写作',
    content: '请以一位克制、敏锐的编辑视角，润色下面这段文字。保留原意与作者语气，删除空话和重复，让句子更有节奏。改完后列出 3 处关键修改及理由。\n\n原文：\n',
  },
  {
    id: 'builtin-summary',
    title: '长文摘要',
    category: '效率',
    content: '请把下面的长文压缩成三层信息：\n1）一句话结论；\n2）五条关键要点；\n3）值得进一步追问的三个问题。\n不要遗漏数字与时间，不要加入原文没有的信息。\n\n原文：\n',
  },
  {
    id: 'builtin-meeting',
    title: '会议纪要',
    category: '效率',
    content: '请把下面的会议记录整理成清晰的纪要：议题、结论、待办（负责人 / 截止时间）、待确认事项。没有提到的信息标注「未提及」，不要自行补全。\n\n记录：\n',
  },
  {
    id: 'builtin-code-review',
    title: '代码审查',
    category: '代码',
    content: '请以资深工程师的视角审查下面的代码，聚焦正确性、边界条件、可读性与性能。按严重程度排序，给出可直接采用的修改建议与示例代码。\n\n代码：\n',
  },
  {
    id: 'builtin-debug',
    title: '报错诊断',
    category: '代码',
    content: '我正在排查一个报错。请根据下面的报错信息与相关代码，先给出最可能的根因排序，再给出逐步验证方法和修复方案。\n\n报错：\n\n代码：\n',
  },
  {
    id: 'builtin-translate',
    title: '中英互译',
    category: '翻译',
    content: '请把下面内容翻译成中文（如果原文是中文则翻译成英文）。保留语气、术语和格式，不要擅自增删。对存在歧义的地方给出简短说明。\n\n原文：\n',
  },
  {
    id: 'builtin-feynman',
    title: '费曼解释',
    category: '思考',
    content: '请用费曼学习法解释「」：先用一句话说清它是什么，再用一个生活类比，最后指出一个常见误解。假设读者完全不懂这个领域。',
  },
  {
    id: 'builtin-counter',
    title: '反方视角',
    category: '思考',
    content: '针对下面的观点，请给出最有力的反方论证：找出隐含假设、可能的反例与代价，最后说明在什么条件下原观点仍然成立。\n\n观点：\n',
  },
  {
    id: 'builtin-xiaohongshu',
    title: '小红书文案',
    category: '写作',
    content: '把下面的产品信息改写成一条小红书笔记：标题有信息量但不夸张，正文口语化、分段落，给出 3 个具体使用场景，结尾自然提问。避免营销黑话。\n\n产品信息：\n',
  },
  {
    id: 'builtin-weekly',
    title: '周报整理',
    category: '效率',
    content: '把这些零散的工作记录整理成一份周报：本周完成、关键进展、问题与风险、下周计划。语气客观简洁，能量化就量化。\n\n记录：\n',
  },
];

const ENTRY_CONFIG = {
  chat: {
    persona: 'general',
    prefill: '',
  },
  write: {
    persona: 'writer',
    prefill: '请帮我写一段关于「」的文字。\n\n用途 / 读者：\n语气：\n必须包含：\n',
  },
  translate: {
    persona: 'translator',
    prefill: '请把下面这段文字翻译成英文，保留原意与语气：\n\n',
  },
  code: {
    persona: 'coder',
    prefill: '我在开发中遇到一个问题：\n\n相关代码 / 报错：\n\n我希望：\n',
  },
};

const QUOTES = [
  '“让每一次提问，都更接近答案。”',
  '“把问题说清楚，答案就已经出现了一半。”',
  '“写作是思考的显影。”',
  '“慢一点，反而更快。”',
  '“在噪声里，保留自己的判断。”',
  '“工具退后一步，想法向前一步。”',
  '“所谓灵感，多半是准备遇到了耐心。”',
];

const VIEW_TITLES = {
  home: 'AI 工作台',
  chat: '对话',
  prompts: '提示词库',
  tools: '工具箱',
  background: '背景与氛围',
  settings: '设置',
};

const THEME_BG = { minimal: '#f7f7f4', paper: '#f4f0e7', dark: '#19191b' };

/* ---------- state ---------- */
const state = {
  view: '',
  engine: 'bing',
  theme: 'minimal',
  lastLightTheme: 'minimal',
  promptFilter: '全部',
  promptSearch: '',
  customPrompts: [],
  settingsProvider: 'public',
  paletteOpen: false,
  paletteItems: [],
  paletteIndex: 0,
  palettePrevOverflow: '',
  quoteIndex: 0,
};

/* ---------- prompts ---------- */
function loadCustomPrompts() {
  const raw = store.get('mori.prompts.custom', []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.content === 'string')
    .map((p) => ({
      id: p.id,
      title: p.title.slice(0, 60),
      category: CATEGORIES.includes(p.category) && p.category !== '全部' ? p.category : '写作',
      content: p.content.slice(0, 12000),
      custom: true,
      createdAt: Number(p.createdAt) || Date.now(),
    }))
    .slice(0, 100);
}

function saveCustomPrompts() {
  store.set('mori.prompts.custom', state.customPrompts);
}

function allPrompts() {
  return [...DEFAULT_PROMPTS.map((p) => ({ ...p, custom: false })), ...state.customPrompts];
}

function promptById(id) {
  return allPrompts().find((p) => p.id === id) || null;
}

function promptCardHtml(prompt) {
  const color = CATEGORY_COLOR[prompt.category] || 'var(--q1)';
  return `
    <article class="p-card" style="--cat:${color}">
      <div class="p-head">
        <span class="p-cat">${escapeHtml(prompt.category)}</span>
        ${prompt.custom ? '<span class="p-custom">自定义</span>' : ''}
      </div>
      <div class="p-title">${escapeHtml(prompt.title)}</div>
      <div class="p-text">${escapeHtml(prompt.content)}</div>
      <div class="p-foot">
        <button class="p-use" type="button" data-use-prompt="${escapeHtml(prompt.id)}">
          ${icon('arrow-up-right')}使用
        </button>
        <div class="p-actions">
          <button class="p-icon-btn" type="button" data-copy-prompt="${escapeHtml(prompt.id)}" title="复制提示词" aria-label="复制提示词">${icon('copy')}</button>
          ${prompt.custom ? `<button class="p-icon-btn danger" type="button" data-delete-prompt="${escapeHtml(prompt.id)}" title="删除提示词" aria-label="删除提示词">${icon('trash')}</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderHomePrompts() {
  const container = $('#home-prompts');
  if (!container) return;
  const preferredIds = ['builtin-polish', 'builtin-code-review', 'builtin-feynman', 'builtin-translate'];
  const picked = [];
  preferredIds.forEach((id) => {
    const p = promptById(id);
    if (p && !picked.some((x) => x.id === id)) picked.push(p);
  });
  allPrompts().forEach((p) => {
    if (picked.length < 4 && !picked.some((x) => x.id === p.id)) picked.push(p);
  });
  container.innerHTML = picked.slice(0, 4).map(promptCardHtml).join('');
}

function filteredPrompts() {
  const query = state.promptSearch.trim().toLowerCase();
  return allPrompts().filter((p) => {
    if (state.promptFilter !== '全部' && p.category !== state.promptFilter) return false;
    if (!query) return true;
    return `${p.title} ${p.category} ${p.content}`.toLowerCase().includes(query);
  });
}

function renderPromptFilters() {
  const wrap = $('#prompt-filters');
  if (!wrap) return;
  const all = allPrompts();
  wrap.innerHTML = CATEGORIES.map((cat) => {
    const count = cat === '全部' ? all.length : all.filter((p) => p.category === cat).length;
    return `<button class="filter-chip${state.promptFilter === cat ? ' active' : ''}" type="button" data-prompt-filter="${cat}" aria-pressed="${state.promptFilter === cat}">${cat}<span class="fc-count">${count}</span></button>`;
  }).join('');
}

function renderPromptLibrary() {
  renderPromptFilters();
  const container = $('#prompt-library');
  const empty = $('#prompt-empty');
  if (!container) return;
  const filtered = filteredPrompts();
  container.innerHTML = filtered.map(promptCardHtml).join('');
  empty?.classList.toggle('hidden', filtered.length > 0);
  const search = $('#prompt-search');
  if (search && search.value !== state.promptSearch) search.value = state.promptSearch;
  const footer = $('#prompt-footer-count');
  if (footer) {
    footer.textContent = `共 ${allPrompts().length} 条 · 内置 ${DEFAULT_PROMPTS.length} 条 · 自定义 ${state.customPrompts.length} 条`;
  }
}

function openPromptModal() {
  const options = CATEGORIES.filter((c) => c !== '全部')
    .map((c) => `<option value="${c}">${c}</option>`).join('');
  const modal = openModal({
    title: '新增提示词',
    kicker: 'NEW PROMPT',
    body: `
      <div class="field">
        <span class="field-label">标题</span>
        <input type="text" id="prompt-form-title" maxlength="40" placeholder="例如：产品发布说明润色" autocomplete="off">
      </div>
      <div class="field">
        <span class="field-label">分类</span>
        <select id="prompt-form-category">${options}</select>
      </div>
      <div class="field">
        <span class="field-label">提示词内容 <em>可以留出 [待填写] 让每次使用时再补充</em></span>
        <textarea id="prompt-form-content" rows="7" maxlength="12000" placeholder="写下你反复使用的那段问法…"></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" type="button" data-close-modal>取消</button>
      <button class="btn btn-primary" type="button" data-save-prompt>保存提示词</button>
    `,
  });
  if (!modal) return;
  const titleInput = $('#prompt-form-title', modal.bodyEl);
  const categoryInput = $('#prompt-form-category', modal.bodyEl);
  const contentInput = $('#prompt-form-content', modal.bodyEl);

  const save = () => {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    if (!title) {
      toast('给这段提示词起一个标题吧', 'error');
      titleInput.focus();
      return;
    }
    if (!content) {
      toast('提示词内容还不能为空', 'error');
      contentInput.focus();
      return;
    }
    const prompt = {
      id: uid('custom'),
      title: title.slice(0, 40),
      category: CATEGORIES.includes(categoryInput.value) && categoryInput.value !== '全部' ? categoryInput.value : '写作',
      content: content.slice(0, 12000),
      custom: true,
      createdAt: Date.now(),
    };
    state.customPrompts.unshift(prompt);
    saveCustomPrompts();
    closeModal();
    state.promptFilter = '全部';
    state.promptSearch = '';
    renderPromptLibrary();
    renderHomePrompts();
    refreshStats();
    toast('提示词已保存到本机');
  };

  modal.footEl.querySelector('[data-save-prompt]')?.addEventListener('click', save);
  contentInput?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
}

async function deletePrompt(id) {
  const prompt = state.customPrompts.find((p) => p.id === id);
  if (!prompt) return;
  const ok = await confirmDialog({
    title: '删除这条提示词？',
    message: `「${prompt.title}」将从本机移除，无法恢复。`,
    confirmText: '删除',
    danger: true,
    kicker: 'DELETE PROMPT',
  });
  if (!ok) return;
  state.customPrompts = state.customPrompts.filter((p) => p.id !== id);
  saveCustomPrompts();
  renderPromptLibrary();
  renderHomePrompts();
  refreshStats();
  toast('提示词已删除');
}

function usePrompt(id) {
  const prompt = promptById(id);
  if (!prompt) return;
  navigate('chat');
  setTimeout(() => {
    startNewChat({
      persona: CATEGORY_PERSONA[prompt.category] || 'general',
      prefill: prompt.content,
      focus: true,
    });
  }, 40);
}

/* ---------- search ---------- */
function getEngine() {
  return ENGINES.find((e) => e.id === state.engine) || ENGINES[0];
}

function renderEngineMenu() {
  const menu = $('#engine-menu');
  if (!menu) return;
  menu.innerHTML = ENGINES.map((engine) => `
    <button class="engine-option${engine.id === state.engine ? ' active' : ''}" type="button" role="option" data-engine="${engine.id}" aria-selected="${engine.id === state.engine}">
      <span class="engine-icon" style="background:${engine.color}">${engine.short}</span>
      <span>${engine.name}</span>
      <svg class="eo-check"><use href="#i-check"></use></svg>
    </button>
  `).join('');
}

function closeEngineMenu() {
  const menu = $('#engine-menu');
  const btn = $('#engine-btn');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}

function toggleEngineMenu(force) {
  const menu = $('#engine-menu');
  const btn = $('#engine-btn');
  if (!menu) return;
  const willOpen = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !willOpen;
  btn?.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    menu.querySelector('.engine-option.active')?.focus({ preventScroll: true });
  }
}

function setEngine(id, { announce = false } = {}) {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) return;
  state.engine = engine.id;
  store.set('mori.search.engine', engine.id);

  const iconEl = $('#engine-icon');
  const nameEl = $('#engine-name');
  if (iconEl) { iconEl.textContent = engine.short; iconEl.style.background = engine.color; }
  if (nameEl) nameEl.textContent = engine.name;
  $$('#engine-menu .engine-option').forEach((option) => {
    const active = option.dataset.engine === engine.id;
    option.classList.toggle('active', active);
    option.setAttribute('aria-selected', String(active));
  });
  const settingsSelect = $('#settings-engine');
  if (settingsSelect) settingsSelect.value = engine.id;
  if (announce) toast(`搜索引擎已切换为「${engine.name}」`);
}

function getSearchHistory() {
  const raw = store.get('mori.search.history', []);
  return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').slice(0, 6) : [];
}

function renderSearchHistory() {
  const wrap = $('#search-history');
  const chips = $('#history-chips');
  if (!wrap || !chips) return;
  const history = getSearchHistory();
  wrap.hidden = history.length === 0;
  chips.innerHTML = history.map((query) =>
    `<button class="history-chip" type="button" data-history="${escapeHtml(query)}" title="填入搜索框">${escapeHtml(query)}</button>`
  ).join('');
}

function addSearchHistory(query) {
  const q = query.trim();
  if (!q) return;
  const history = getSearchHistory().filter((item) => item !== q);
  history.unshift(q);
  store.set('mori.search.history', history.slice(0, 6));
  renderSearchHistory();
}

function performSearch(query) {
  const q = String(query || '').trim();
  if (!q) {
    $('#search-input')?.focus();
    return;
  }
  addSearchHistory(q);
  const engine = getEngine();
  const url = `${engine.url}${encodeURIComponent(q)}${engine.suffix || ''}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function askAI(query) {
  const q = String(query || '').trim();
  navigate('chat');
  if (q) {
    addSearchHistory(q);
    setTimeout(() => startNewChat({ persona: 'general', prefill: q, send: true }), 50);
  } else {
    setTimeout(() => startNewChat({ persona: 'general', focus: true }), 50);
  }
}

function focusSearch() {
  if (state.view !== 'home') navigate('home');
  const input = $('#search-input');
  if (input) {
    setTimeout(() => {
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  }
}

function initSearch() {
  const savedEngine = store.get('mori.search.engine', 'bing');
  state.engine = ENGINES.some((e) => e.id === savedEngine) ? savedEngine : 'bing';
  renderEngineMenu();
  setEngine(state.engine);
  renderSearchHistory();

  $('#engine-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEngineMenu();
  });

  $('#engine-menu')?.addEventListener('click', (e) => {
    const option = e.target.closest('[data-engine]');
    if (!option) return;
    setEngine(option.dataset.engine, { announce: true });
    closeEngineMenu();
    $('#search-input')?.focus();
  });

  $('#engine-menu')?.addEventListener('keydown', (e) => {
    const options = $$('.engine-option', e.currentTarget);
    const current = document.activeElement;
    const index = options.indexOf(current);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? (index + 1) % options.length
        : (index - 1 + options.length) % options.length;
      options[next]?.focus();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEngineMenu();
      $('#engine-btn')?.focus();
    }
  });

  $('#search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    performSearch($('#search-input')?.value || '');
  });

  $('#search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      askAI(e.currentTarget.value);
    }
  });

  $('#ask-ai-btn')?.addEventListener('click', () => askAI($('#search-input')?.value || ''));

  $('#history-clear')?.addEventListener('click', () => {
    store.remove('mori.search.history');
    renderSearchHistory();
    toast('搜索记录已清除');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#engine')) closeEngineMenu();
  });
}

/* ---------- theme ---------- */
function applyTheme(theme, { persist = true } = {}) {
  const next = THEME_BG[theme] ? theme : 'minimal';
  state.theme = next;
  if (next !== 'dark') state.lastLightTheme = next;
  document.body.dataset.theme = next;
  document.documentElement.style.background = THEME_BG[next];
  if (persist) {
    store.set('mori.theme', next);
    store.set('mori.theme.light', state.lastLightTheme);
  }
  $$('.theme-dot').forEach((dot) => {
    const active = dot.dataset.theme === next;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-pressed', String(active));
  });
  $$('#theme-segmented button').forEach((btn) => {
    const active = btn.dataset.theme === next;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BG[next]);
}

function initTheme() {
  const saved = store.get('mori.theme', 'minimal');
  const lastLight = store.get('mori.theme.light', 'minimal');
  state.lastLightTheme = THEME_BG[lastLight] && lastLight !== 'dark' ? lastLight : 'minimal';
  applyTheme(THEME_BG[saved] ? saved : 'minimal');

  $('#theme-toggle')?.addEventListener('click', () => {
    const next = state.theme === 'dark' ? state.lastLightTheme : 'dark';
    applyTheme(next);
    toast(next === 'dark' ? '已切换到墨夜主题' : '已切换回浅色主题');
  });

  $$('.theme-dot').forEach((dot) => {
    dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
  });

  $('#theme-segmented')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (btn) applyTheme(btn.dataset.theme);
  });
}

/* ---------- preferences / reduce motion ---------- */
function applyReduceMotion(value) {
  document.body.classList.toggle('reduce-motion', Boolean(value));
  const checkbox = $('#reduce-motion');
  if (checkbox) checkbox.checked = Boolean(value);
  store.set('mori.reduceMotion', Boolean(value));
}

/* ---------- navigation ---------- */
function currentView() {
  return VIEW_TITLES[state.view] ? state.view : 'home';
}

function navigate(view, { updateHash = true, scroll = true } = {}) {
  const next = VIEW_TITLES[view] ? view : 'home';
  const changed = state.view !== next;
  state.view = next;

  $$('.view').forEach((section) => {
    section.classList.toggle('hidden', section.id !== `view-${next}`);
  });
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.view === next;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  document.title = `墨屿 · ${VIEW_TITLES[next]}`;
  if (updateHash) {
    try {
      history.replaceState(null, '', `#${next}`);
    } catch { /* file protocol */ }
  }

  if (next === 'home') {
    renderHomePrompts();
    renderRecent();
    refreshStats();
  }
  if (next === 'prompts') {
    renderPromptLibrary();
  }
  if (next === 'settings') {
    populateSettings();
    renderDataStats();
  }
  if (next === 'chat') {
    refreshStats();
    const box = $('#messages');
    if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  closeEngineMenu();
  if (changed && scroll) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function newChat(options = {}) {
  if (state.view !== 'chat') navigate('chat');
  const persona = options.persona || $('#persona-select')?.value || 'general';
  startNewChat({ persona, prefill: options.prefill || '', send: Boolean(options.send), focus: true });
}

/* ---------- home / stats ---------- */
function refreshStats() {
  const threads = getThreads();
  const prompts = allPrompts();
  const bg = getBackgroundSummary();
  const setText = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };

  setText('#nav-chat-count', String(threads.length));
  setText('#nav-prompt-count', String(prompts.length));
  setText('#stat-chats', String(getTodayChatCount()));
  setText('#stat-prompts', String(prompts.length));
  setText('#stat-bg', bg.shortName);
  setText('#data-chats', String(threads.length));
  setText('#data-prompts', String(prompts.length));
  setText('#data-bgs', String(bg.count));
  setText('#prompt-footer-count', `共 ${prompts.length} 条 · 内置 ${DEFAULT_PROMPTS.length} 条 · 自定义 ${state.customPrompts.length} 条`);
  updateModelHint();
}

function updateModelHint() {
  const el = $('#desk-model');
  if (!el) return;
  const cfg = getApiConfig();
  if (cfg.provider === 'custom') {
    el.textContent = cfg.model.trim() ? '自定义接口' : '待配置接口';
  } else {
    el.textContent = providerLabel();
  }
}

function renderDataStats() {
  const bg = getBackgroundSummary();
  const setText = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
  setText('#data-chats', String(getThreads().length));
  setText('#data-prompts', String(allPrompts().length));
  setText('#data-bgs', String(bg.count));
}

function renderRecent() {
  const wrap = $('#recent-list');
  if (!wrap) return;
  const threads = getThreads().slice(0, 5);
  if (!threads.length) {
    wrap.innerHTML = `
      <div class="recent-empty">
        ${icon('chat')}
        <p>还没有对话。<br>从一个问题开始，答案会慢慢长出来。</p>
        <button type="button" data-new-chat>开始新对话</button>
      </div>
    `;
    return;
  }
  wrap.innerHTML = threads.map((thread) => {
    const meta = PERSONA_META[thread.persona] || PERSONA_META.general;
    const last = thread.messages[thread.messages.length - 1];
    const preview = last ? last.content.replace(/\s+/g, ' ').slice(0, 38) : '空对话';
    return `
      <button class="recent-item" type="button" data-recent-thread="${escapeHtml(thread.id)}" title="${escapeHtml(thread.title)}">
        <span class="recent-avatar ${meta.accent}">${meta.char}</span>
        <span class="recent-body">
          <strong>${escapeHtml(thread.title)}</strong>
          <small>${escapeHtml(meta.label)} · ${escapeHtml(preview)}</small>
        </span>
        <span class="recent-time">${escapeHtml(relativeTime(thread.updatedAt))}</span>
      </button>
    `;
  }).join('');
}

function initDateLabels() {
  const now = new Date();
  const todayLabel = $('#today-label');
  if (todayLabel) todayLabel.textContent = formatKickerDate(now.getTime());
  const deskDate = $('#desk-date');
  if (deskDate) deskDate.textContent = formatDateCN(now.getTime());
  const sideDate = $('#side-date');
  if (sideDate) sideDate.textContent = `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const greeting = $('#greeting');
  if (greeting) {
    const hour = now.getHours();
    let text = '早安，把问题交给模型，把判断留给自己。';
    if (hour >= 5 && hour < 11) text = '早安，把问题交给模型，把判断留给自己。';
    else if (hour >= 11 && hour < 14) text = '午安，留一点安静给还在生长的想法。';
    else if (hour >= 14 && hour < 18) text = '下午好，把散落的念头收拢成一行字。';
    else if (hour >= 18 && hour < 23) text = '晚上好，慢下来，和自己的想法待一会儿。';
    else text = '夜深了，如果还在思考，让它先落成一行字。';
    greeting.textContent = text;
  }
  const quoteEl = $('#desk-quote');
  if (quoteEl) {
    const dayIndex = Math.floor(now.getTime() / 86400000) % QUOTES.length;
    state.quoteIndex = dayIndex;
    quoteEl.textContent = QUOTES[dayIndex];
  }
}

function cycleQuote() {
  const quoteEl = $('#desk-quote');
  if (!quoteEl) return;
  let next = state.quoteIndex;
  while (next === state.quoteIndex && QUOTES.length > 1) {
    next = Math.floor(Math.random() * QUOTES.length);
  }
  state.quoteIndex = next;
  quoteEl.style.opacity = '0';
  setTimeout(() => {
    quoteEl.textContent = QUOTES[next];
    quoteEl.style.opacity = '1';
  }, 140);
}

function initHome() {
  $('#desk-shuffle')?.addEventListener('click', cycleQuote);
  $('#surprise-btn')?.addEventListener('click', () => {
    const pool = allPrompts().filter((p) => p.id.startsWith('builtin-'));
    const prompt = pool[Math.floor(Math.random() * pool.length)] || DEFAULT_PROMPTS[0];
    navigate('chat');
    setTimeout(() => startNewChat({ persona: CATEGORY_PERSONA[prompt.category] || 'general', prefill: prompt.content, focus: true }), 50);
  });
}

/* ---------- settings ---------- */
function updateProviderUI() {
  $$('.provider-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.provider === state.settingsProvider);
  });
  const isCustom = state.settingsProvider === 'custom';
  $('#public-fields')?.classList.toggle('hidden', isCustom);
  $('#custom-fields')?.classList.toggle('hidden', !isCustom);
}

function setApiStatus(message, cls = '') {
  const el = $('#api-status');
  if (!el) return;
  el.textContent = message;
  el.className = `api-status ${cls}`.trim();
}

function collectApiForm() {
  return {
    provider: state.settingsProvider,
    endpoint: $('#api-endpoint')?.value.trim() || '',
    apiKey: $('#api-key')?.value || '',
    model: $('#api-model')?.value.trim() || '',
    headers: $('#api-headers')?.value.trim() || '',
    temperature: Number($('#temp-range')?.value || 0.7),
  };
}

function validateApiForm(values) {
  if (values.provider === 'custom') {
    if (!values.endpoint) throw new Error('请填写自定义接口地址');
    let url;
    try {
      url = new URL(values.endpoint);
    } catch {
      throw new Error('接口地址格式不正确，需要完整的 https:// 地址');
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error('接口地址需要以 http:// 或 https:// 开头');
    if (!values.model) throw new Error('请填写模型名称');
  }
  if (values.headers) {
    let parsed;
    try {
      parsed = JSON.parse(values.headers);
    } catch {
      throw new Error('附加请求头不是合法的 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('附加请求头需要是一个 JSON 对象');
    }
  }
}

function populateSettings() {
  const cfg = getApiConfig();
  state.settingsProvider = cfg.provider;
  updateProviderUI();
  const endpoint = $('#api-endpoint');
  const key = $('#api-key');
  const model = $('#api-model');
  const headers = $('#api-headers');
  const temp = $('#temp-range');
  if (endpoint) endpoint.value = cfg.endpoint;
  if (key) { key.value = cfg.apiKey; key.type = 'password'; }
  if (model) model.value = cfg.model;
  if (headers) headers.value = cfg.headers;
  if (temp) temp.value = String(cfg.temperature);
  const tempVal = $('#temp-val');
  if (tempVal) tempVal.textContent = String(cfg.temperature);
  const toggle = $('#toggle-key use');
  if (toggle) toggle.setAttribute('href', '#i-eye');

  const engineSelect = $('#settings-engine');
  if (engineSelect) engineSelect.value = state.engine;
  const motion = $('#reduce-motion');
  if (motion) motion.checked = document.body.classList.contains('reduce-motion');
  $$('#theme-segmented button').forEach((btn) => btn.classList.toggle('active', btn.dataset.theme === state.theme));
  renderDataStats();
  setApiStatus('');
}

function exportData() {
  const cfg = getApiConfig();
  const safeConfig = {
    provider: cfg.provider,
    endpoint: cfg.endpoint,
    model: cfg.model,
    temperature: cfg.temperature,
  };
  const payload = {
    app: '墨屿 · AI 工作台',
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences: {
      theme: state.theme,
      searchEngine: state.engine,
      reduceMotion: document.body.classList.contains('reduce-motion'),
    },
    searchHistory: getSearchHistory(),
    prompts: {
      builtin: DEFAULT_PROMPTS,
      custom: state.customPrompts,
    },
    threads: getThreads(),
    model: safeConfig,
    background: { ...getBackgroundSummary(), note: '背景图片文件不包含在导出内容中' },
  };
  downloadFile(`mori-workbench-${dateKey()}.json`, JSON.stringify(payload, null, 2));
  toast('本地数据已导出');
}

async function clearAllData() {
  const ok = await confirmDialog({
    title: '清空所有本地数据？',
    message: '对话、提示词、背景图、模型设置与偏好都会被删除，且无法恢复。',
    confirmText: '全部清空',
    danger: true,
    kicker: 'RESET EVERYTHING',
  });
  if (!ok) return;
  store.keys().filter((key) => key.startsWith('mori.')).forEach((key) => store.remove(key));
  try {
    await clearBackgroundStore();
  } catch (err) {
    console.warn(err);
  }
  location.reload();
}

function initSettings() {
  const engineSelect = $('#settings-engine');
  if (engineSelect && !engineSelect.options.length) {
    engineSelect.innerHTML = ENGINES.map((engine) => `<option value="${engine.id}">${engine.name}</option>`).join('');
    engineSelect.value = state.engine;
  }
  $$('.provider-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.settingsProvider = card.dataset.provider === 'custom' ? 'custom' : 'public';
      updateProviderUI();
      setApiStatus('');
    });
  });

  $('#toggle-key')?.addEventListener('click', () => {
    const input = $('#api-key');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const use = $('#toggle-key use');
    if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  });

  $('#temp-range')?.addEventListener('input', (e) => {
    const val = $('#temp-val');
    if (val) val.textContent = Number(e.target.value).toFixed(1);
  });

  $('#save-api')?.addEventListener('click', () => {
    const values = collectApiForm();
    try {
      validateApiForm(values);
    } catch (err) {
      setApiStatus(err.message, 'err');
      toast(err.message, 'error');
      return;
    }
    saveApiConfig(values);
    setApiStatus('已保存到本机', 'ok');
    toast('模型设置已保存');
    refreshStats();
  });

  $('#test-api')?.addEventListener('click', async () => {
    const btn = $('#test-api');
    const values = collectApiForm();
    try {
      validateApiForm(values);
    } catch (err) {
      setApiStatus(err.message, 'err');
      toast(err.message, 'error');
      return;
    }
    if (btn) { btn.disabled = true; }
    setApiStatus('正在连接模型…', 'busy');
    try {
      const reply = await testApiConnection(values);
      setApiStatus(`连接成功 · ${reply || '模型已响应'}`, 'ok');
      toast('模型连接成功');
    } catch (err) {
      setApiStatus(err.message || '连接失败', 'err');
      toast('连接失败，请检查设置', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#settings-engine')?.addEventListener('change', (e) => setEngine(e.target.value, { announce: true }));
  $('#reduce-motion')?.addEventListener('change', (e) => applyReduceMotion(e.target.checked));
  $('#export-data')?.addEventListener('click', exportData);
  $('#clear-data')?.addEventListener('click', clearAllData);
}

/* ---------- command palette ---------- */
function paletteCommands(query) {
  const q = query.trim();
  const items = [];
  const add = (group, item) => items.push({ group, ...item });

  if (q) {
    add('搜索', {
      icon: 'search',
      title: `用 ${getEngine().name} 搜索「${q}」`,
      hint: 'Enter',
      action: () => performSearch(q),
    });
    add('搜索', {
      icon: 'sparkles',
      title: `把「${q}」交给 AI`,
      hint: '对话',
      action: () => askAI(q),
    });
  }

  add('动作', {
    icon: 'plus',
    title: '新建对话',
    hint: 'Chat',
    action: () => newChat(),
  });
  add('动作', {
    icon: state.theme === 'dark' ? 'sun' : 'moon',
    title: state.theme === 'dark' ? '切换到浅色主题' : '切换到墨夜主题',
    hint: 'Theme',
    action: () => applyTheme(state.theme === 'dark' ? state.lastLightTheme : 'dark'),
  });

  const navItems = [
    ['home', '总览', 'grid'],
    ['chat', '对话', 'chat'],
    ['prompts', '提示词库', 'book'],
    ['tools', '工具箱', 'tools'],
    ['background', '背景与氛围', 'image'],
    ['settings', '设置', 'settings'],
  ];
  navItems.forEach(([view, title, iconName]) => {
    if (q && !title.includes(q) && !VIEW_TITLES[view].includes(q)) return;
    add('前往', {
      icon: iconName,
      title,
      hint: 'Go',
      action: () => navigate(view),
    });
  });

  const promptMatches = q
    ? allPrompts().filter((p) => `${p.title} ${p.category} ${p.content}`.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
    : [];
  promptMatches.forEach((p) => {
    add('提示词', {
      icon: 'book',
      title: p.title,
      hint: p.category,
      action: () => usePrompt(p.id),
    });
  });

  if (!q) {
    // Keep the default palette short and calm; prompts appear once you type.
    return items.slice(0, 10);
  }
  return items.slice(0, 18);
}

function renderPalette(query) {
  const list = $('#palette-list');
  if (!list) return;
  state.paletteItems = paletteCommands(query);
  if (!state.paletteItems.length) {
    list.innerHTML = '<div class="palette-empty">没有匹配的命令，按 Enter 直接搜索。</div>';
    state.paletteIndex = 0;
    return;
  }
  state.paletteIndex = Math.min(state.paletteIndex, state.paletteItems.length - 1);
  let lastGroup = '';
  list.innerHTML = state.paletteItems.map((item, index) => {
    let groupHtml = '';
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      groupHtml = `<div class="palette-group">${escapeHtml(item.group)}</div>`;
    }
    return `${groupHtml}<button class="palette-item${index === state.paletteIndex ? ' selected' : ''}" type="button" data-palette-index="${index}">
      ${icon(item.icon)}
      <span class="pi-title">${escapeHtml(item.title)}</span>
      <span class="pi-hint">${escapeHtml(item.hint || '')}</span>
    </button>`;
  }).join('');
  updatePaletteSelection();
}

function updatePaletteSelection() {
  const list = $('#palette-list');
  if (!list) return;
  $$('.palette-item', list).forEach((item) => {
    item.classList.toggle('selected', Number(item.dataset.paletteIndex) === state.paletteIndex);
  });
  const selected = list.querySelector('.palette-item.selected');
  selected?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  if (isModalOpen()) return;
  closeEngineMenu();
  const palette = $('#palette');
  const input = $('#palette-input');
  if (!palette || !input) return;
  state.paletteOpen = true;
  state.paletteIndex = 0;
  state.palettePrevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  palette.hidden = false;
  input.value = '';
  renderPalette('');
  setTimeout(() => input.focus(), 20);
}

function closePalette() {
  const palette = $('#palette');
  if (!palette || palette.hidden) return;
  palette.hidden = true;
  state.paletteOpen = false;
  document.body.style.overflow = state.palettePrevOverflow;
}

function togglePalette() {
  if (state.paletteOpen) closePalette();
  else openPalette();
}

function runPaletteItem(index) {
  const item = state.paletteItems[index];
  if (!item) return;
  closePalette();
  setTimeout(() => item.action(), 20);
}

function initPalette() {
  const palette = $('#palette');
  const input = $('#palette-input');
  if (!palette || !input) return;

  $$('.cmd-trigger').forEach((btn) => btn.addEventListener('click', openPalette));

  palette.addEventListener('click', (e) => {
    if (e.target.closest('[data-palette-close]')) {
      closePalette();
      return;
    }
    const item = e.target.closest('[data-palette-index]');
    if (item) runPaletteItem(Number(item.dataset.paletteIndex));
  });

  input.addEventListener('input', () => {
    state.paletteIndex = 0;
    renderPalette(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.paletteItems.length) return;
      state.paletteIndex = e.key === 'ArrowDown'
        ? (state.paletteIndex + 1) % state.paletteItems.length
        : (state.paletteIndex - 1 + state.paletteItems.length) % state.paletteItems.length;
      updatePaletteSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.paletteItems.length) {
        runPaletteItem(state.paletteIndex);
      } else {
        const q = input.value.trim();
        closePalette();
        if (q) setTimeout(() => performSearch(q), 20);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });
}

/* ---------- keyboard ---------- */
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const typing = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      if (isModalOpen()) return;
      e.preventDefault();
      togglePalette();
      return;
    }

    if (e.key === 'Escape') {
      if (state.paletteOpen) {
        e.preventDefault();
        closePalette();
        return;
      }
      closeEngineMenu();
      return;
    }

    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !isModalOpen()) {
      e.preventDefault();
      focusSearch();
    }
  });
}

/* ---------- events ---------- */
function bindCrossEvents() {
  window.addEventListener('mori:bg-changed', () => {
    refreshStats();
    renderDataStats();
  });
  window.addEventListener('mori:chat-updated', () => {
    refreshStats();
    renderRecent();
    renderDataStats();
  });
  window.addEventListener('mori:api-changed', () => {
    refreshStats();
  });
  window.addEventListener('mori:navigate', (e) => {
    if (e.detail?.view) navigate(e.detail.view);
  });
}

function bindGlobalClicks() {
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-view]');
    if (navBtn) {
      e.preventDefault();
      navigate(navBtn.dataset.view);
      return;
    }

    const newChatBtn = e.target.closest('[data-new-chat]');
    if (newChatBtn) {
      e.preventDefault();
      newChat();
      return;
    }

    const entry = e.target.closest('[data-entry]');
    if (entry) {
      const config = ENTRY_CONFIG[entry.dataset.entry] || ENTRY_CONFIG.chat;
      navigate('chat');
      setTimeout(() => {
        startNewChat({ persona: config.persona, prefill: config.prefill, focus: true });
      }, 40);
      return;
    }

    const recent = e.target.closest('[data-recent-thread]');
    if (recent) {
      navigate('chat');
      setTimeout(() => openThread(recent.dataset.recentThread), 30);
      return;
    }

    const hot = e.target.closest('[data-query]');
    if (hot) {
      const input = $('#search-input');
      if (input) {
        input.value = hot.dataset.query;
        input.focus();
      }
      return;
    }

    const history = e.target.closest('[data-history]');
    if (history) {
      const input = $('#search-input');
      if (input) {
        input.value = history.dataset.history;
        input.focus();
      }
      return;
    }

    const useBtn = e.target.closest('[data-use-prompt]');
    if (useBtn) {
      usePrompt(useBtn.dataset.usePrompt);
      return;
    }

    const copyBtn = e.target.closest('[data-copy-prompt]');
    if (copyBtn) {
      const prompt = promptById(copyBtn.dataset.copyPrompt);
      if (prompt) {
        copyText(prompt.content).then((ok) => toast(ok ? '提示词已复制' : '复制失败', ok ? 'ok' : 'error'));
      }
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-prompt]');
    if (deleteBtn) {
      deletePrompt(deleteBtn.dataset.deletePrompt);
    }
  });
}

function bindPromptEvents() {
  $('#add-prompt-btn')?.addEventListener('click', openPromptModal);
  $('#empty-add-prompt')?.addEventListener('click', openPromptModal);

  const rerender = debounce(() => renderPromptLibrary(), 80);
  $('#prompt-search')?.addEventListener('input', (e) => {
    state.promptSearch = e.target.value;
    rerender();
  });

  $('#prompt-filters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-prompt-filter]');
    if (!chip) return;
    state.promptFilter = chip.dataset.promptFilter;
    renderPromptLibrary();
  });
}

/* ---------- boot ---------- */
function initRouter() {
  const hashView = location.hash.replace(/^#/, '');
  const initial = VIEW_TITLES[hashView] ? hashView : 'home';
  navigate(initial, { updateHash: true, scroll: false });
  window.addEventListener('hashchange', () => {
    const view = location.hash.replace(/^#/, '');
    if (VIEW_TITLES[view] && view !== state.view) {
      navigate(view, { updateHash: false });
    }
  });
}

function boot() {
  initCoreUI();
  bindCrossEvents();
  bindGlobalClicks();
  bindPromptEvents();

  state.customPrompts = loadCustomPrompts();
  const reduceMotion = Boolean(store.get('mori.reduceMotion', false));
  applyReduceMotion(reduceMotion);

  initTheme();
  initChat();
  initBackground();
  initTools();
  initSearch();
  initDateLabels();
  initHome();
  initSettings();
  initPalette();
  initKeyboard();
  initRouter();

  renderHomePrompts();
  renderRecent();
  refreshStats();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      initDateLabels();
      refreshStats();
    }
  });

  console.info('%c墨屿 AI 工作台', 'color:#8fa5b8;font-weight:600', '已就绪 · 数据只保存在本机');
}

boot();
