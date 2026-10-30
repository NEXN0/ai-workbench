/* Chat: OpenAI-compatible streaming chat with local threads and personas. */

import {
  $, $$, store, toast, openModal, confirmDialog, renderMarkdown, escapeHtml,
  relativeTime, formatClock, isToday, uid, autoGrow, icon, copyText,
} from './core.js';

const CONFIG_KEY = 'mori.api';
const THREADS_KEY = 'mori.threads';
const ACTIVE_KEY = 'mori.chat.active';
const PUBLIC_ENDPOINT = 'https://text.pollinations.ai/openai';
const MAX_THREADS = 50;
const MAX_MESSAGES = 120;

const DEFAULT_CONFIG = {
  provider: 'public',
  endpoint: '',
  apiKey: '',
  model: '',
  headers: '',
  temperature: 0.7,
};

const PERSONAS = {
  general: {
    label: '通用助手',
    system: '你是「墨屿」AI 工作台里的通用助手。用简洁、具体、有判断力的中文回答；先给结论，再给必要的解释。不确定的地方直说不确定，不要编造事实或来源。',
  },
  writer: {
    label: '写作编辑',
    system: '你是一位克制、敏感的写作编辑。你擅长把含混的表达改得准确、有节奏，保留作者原本的语气，而不是把文字改成空洞的套话。修改时说明你做了哪些关键取舍。',
  },
  translator: {
    label: '翻译专家',
    system: '你是一位专业的中英翻译。你会在准确传达意思的基础上保留原文的语气、节奏与文化语境。默认先给出译文；只有用户需要时，再补充术语说明或备选译法。',
  },
  coder: {
    label: '代码顾问',
    system: '你是一位经验丰富的软件工程师。回答时优先给出可运行、可验证的代码，解释关键决策、边界条件与潜在风险。遇到报错时先定位根因，再给修复方案。',
  },
  thinker: {
    label: '思考伙伴',
    system: '你是一位善于追问的思考伙伴。不要急着附和；帮助用户澄清问题、发现被忽略的前提，并提供不同角度的判断。必要时用具体的反例推动思考。',
  },
};

const state = {
  config: { ...DEFAULT_CONFIG },
  threads: [],
  activeId: null,
  streaming: false,
  abortController: null,
  bound: false,
};

/* ---------- config ---------- */
function clampTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(1.5, Math.max(0, n));
}

function normalizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  cfg.provider = cfg.provider === 'custom' ? 'custom' : 'public';
  cfg.endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint : '';
  cfg.apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
  cfg.model = typeof cfg.model === 'string' ? cfg.model : '';
  cfg.headers = typeof cfg.headers === 'string' ? cfg.headers : '';
  cfg.temperature = clampTemperature(cfg.temperature);
  return cfg;
}

function loadConfig() {
  state.config = normalizeConfig(store.get(CONFIG_KEY, {}));
}

export function getApiConfig() {
  return { ...state.config };
}

export function saveApiConfig(next) {
  state.config = normalizeConfig({ ...state.config, ...(next || {}) });
  store.set(CONFIG_KEY, state.config);
  updateChatHeader();
  window.dispatchEvent(new CustomEvent('mori:api-changed', {
    detail: {
      provider: state.config.provider,
      label: providerLabel(),
      model: modelLabel(),
    },
  }));
  return getApiConfig();
}

export function providerLabel() {
  return state.config.provider === 'custom' ? '自定义接口' : '公益体验通道';
}

export function modelLabel() {
  if (state.config.provider === 'public') return 'openai';
  return state.config.model.trim() || '未设置模型';
}

function parseHeaders(raw) {
  if (!raw || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('附加请求头不是合法的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('附加请求头需要是一个 JSON 对象');
  }
  const headers = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[String(key)] = String(value);
    }
  });
  return headers;
}

function normalizeEndpoint(endpoint) {
  let url = endpoint.trim();
  if (!url) return '';
  if (/^https?:\/\/[^/]+\/v1\/?$/i.test(url)) {
    url = url.replace(/\/$/, '') + '/chat/completions';
  }
  return url;
}

function resolveRequest(configOverride = null) {
  const cfg = configOverride ? normalizeConfig({ ...state.config, ...configOverride }) : state.config;
  if (cfg.provider === 'public') {
    return {
      url: PUBLIC_ENDPOINT,
      model: 'openai',
      apiKey: '',
      headers: {},
      temperature: cfg.temperature,
      provider: 'public',
    };
  }
  const url = normalizeEndpoint(cfg.endpoint);
  if (!url) throw new Error('请先在设置里填写自定义接口地址');
  if (!/^https?:\/\//i.test(url)) throw new Error('接口地址需要以 http:// 或 https:// 开头');
  if (!cfg.model.trim()) throw new Error('请先在设置里填写模型名称');
  return {
    url,
    model: cfg.model.trim(),
    apiKey: cfg.apiKey.trim(),
    headers: parseHeaders(cfg.headers),
    temperature: cfg.temperature,
    provider: 'custom',
  };
}

function buildHeaders(request) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' };
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;
  Object.assign(headers, request.headers || {});
  return headers;
}

function systemPrompt(personaId) {
  const persona = PERSONAS[personaId] || PERSONAS.general;
  const today = new Date();
  const dateLine = `今天是 ${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日。`;
  return `${persona.system}\n${dateLine}`;
}

/* ---------- threads ---------- */
function loadThreads() {
  const raw = store.get(THREADS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.id === 'string' && Array.isArray(t.messages))
    .map((t) => ({
      id: t.id,
      title: String(t.title || '未命名对话').slice(0, 60),
      persona: PERSONAS[t.persona] ? t.persona : 'general',
      createdAt: Number(t.createdAt) || Date.now(),
      updatedAt: Number(t.updatedAt) || Number(t.createdAt) || Date.now(),
      messages: t.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content, ts: Number(m.ts) || Date.now() })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);
}

function saveThreads() {
  if (threadsOverLimit()) {
    state.threads = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
  }
  let ok = store.set(THREADS_KEY, state.threads);
  if (ok) return;
  // Local storage is full: drop the oldest non-active conversations, one by one.
  const oldestFirst = [...state.threads].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const thread of oldestFirst) {
    if (state.threads.length <= 1) break;
    if (thread.id === state.activeId) continue;
    state.threads = state.threads.filter((t) => t.id !== thread.id);
    ok = store.set(THREADS_KEY, state.threads);
    if (ok) break;
  }
  if (ok) toast('本地空间不足，已清理较早的对话记录', 'error');
  else toast('本地存储空间不足，这段对话可能未能完整保存', 'error');
}

function threadsOverLimit() {
  return state.threads.length > MAX_THREADS;
}

function activeThread() {
  return state.threads.find((t) => t.id === state.activeId) || null;
}

function touchThread(thread) {
  thread.updatedAt = Date.now();
  state.threads = [thread, ...state.threads.filter((t) => t.id !== thread.id)].slice(0, MAX_THREADS);
}

function createThread(firstText) {
  const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 30) + (firstText.trim().length > 30 ? '…' : '');
  const now = Date.now();
  const persona = $('#persona-select')?.value || 'general';
  const thread = {
    id: uid('chat'),
    title: title || '新对话',
    persona: PERSONAS[persona] ? persona : 'general',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  state.threads.unshift(thread);
  state.activeId = thread.id;
  store.set(ACTIVE_KEY, thread.id);
  return thread;
}

function setActive(id) {
  state.activeId = id;
  if (id) store.set(ACTIVE_KEY, id);
  else store.remove(ACTIVE_KEY);
}

function emitThreadsChanged() {
  window.dispatchEvent(new CustomEvent('mori:chat-updated'));
}

export function getThreads() {
  return [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTodayChatCount() {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let count = 0;
  state.threads.forEach((thread) => {
    const hasToday = thread.messages.some((m) => {
      const d = new Date(m.ts);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return k === key;
    });
    if (hasToday) count++;
  });
  return count;
}

/* ---------- UI helpers ---------- */
function updateChatHeader() {
  const pill = $('#chat-provider-pill');
  const modelEl = $('#chat-model-name');
  if (pill) {
    const label = state.config.provider === 'custom' && (!state.config.endpoint.trim() || !state.config.model.trim())
      ? '待配置接口'
      : providerLabel();
    pill.innerHTML = `<span class="live-dot"></span><span>${escapeHtml(label)}</span>`;
    pill.title = '对话内容会发送至该模型服务';
  }
  if (modelEl) modelEl.textContent = modelLabel();
}

function updateSendState() {
  const input = $('#chat-input');
  const btn = $('#send-btn');
  if (!input || !btn) return;
  if (state.streaming) {
    btn.disabled = false;
    btn.classList.add('is-streaming');
    btn.setAttribute('aria-label', '停止生成');
  } else {
    btn.classList.remove('is-streaming');
    btn.setAttribute('aria-label', '发送消息');
    btn.disabled = !input.value.trim();
  }
}

function updateCharCount() {
  const input = $('#chat-input');
  const counter = $('#char-count');
  if (!input || !counter) return;
  counter.textContent = `${input.value.length} / 8000`;
}

function setStreaming(value) {
  state.streaming = value;
  const hint = $('#composer-hint');
  if (hint) hint.textContent = value ? '正在生成 · 点击右侧按钮停止' : 'Enter 发送 · Shift + Enter 换行';
  updateSendState();
}

function scrollBottom(force = false) {
  const box = $('#messages');
  if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (force || near) {
    box.scrollTop = box.scrollHeight;
  }
}

function renderThreadList() {
  const list = $('#thread-list');
  const countEl = $('#thread-count');
  if (!list) return;
  const sorted = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  if (countEl) countEl.textContent = String(sorted.length);
  const threadsEl = list.closest('.threads');
  threadsEl?.classList.toggle('is-empty', sorted.length === 0);
  if (!sorted.length) {
    list.innerHTML = '<div class="threads-empty">还没有会话记录<br>从一个问题开始吧</div>';
    return;
  }
  list.innerHTML = sorted.map((thread) => {
    const isActive = thread.id === state.activeId;
    const preview = thread.messages[thread.messages.length - 1]?.content?.replace(/\s+/g, ' ').slice(0, 28) || '空对话';
    return `
      <div class="thread-wrap${isActive ? ' active' : ''}">
        <button class="thread-item${isActive ? ' active' : ''}" type="button" data-thread-id="${escapeHtml(thread.id)}">
          <strong>${escapeHtml(thread.title)}</strong>
          <small>${escapeHtml(PERSONAS[thread.persona]?.label || '通用助手')} · ${escapeHtml(relativeTime(thread.updatedAt))}</small>
        </button>
        <button class="thread-del" type="button" data-thread-del="${escapeHtml(thread.id)}" title="删除会话" aria-label="删除会话 ${escapeHtml(thread.title)}">${icon('trash')}</button>
      </div>
    `;
  }).join('');
}

function messageActions(index, role) {
  return `<div class="msg-actions">
    <button class="msg-action" type="button" data-copy-index="${index}" title="复制这条消息">${icon('copy')}复制</button>
  </div>`;
}

function buildMessageElement(message, index) {
  const isUser = message.role === 'user';
  const el = document.createElement('div');
  el.className = `msg ${isUser ? 'msg-user' : 'msg-assistant'}`;
  el.dataset.index = String(index);
  el.innerHTML = `
    <div class="msg-avatar">${isUser ? '你' : '墨'}</div>
    <div class="msg-main">
      <div class="msg-meta">
        <span class="msg-role">${isUser ? '你' : '墨屿'}</span>
        <time>${escapeHtml(formatClock(message.ts))}</time>
      </div>
      <div class="msg-content${isUser ? '' : ' md'}"></div>
      ${messageActions(index, message.role)}
    </div>
  `;
  const contentEl = el.querySelector('.msg-content');
  if (isUser) contentEl.textContent = message.content;
  else contentEl.innerHTML = renderMarkdown(message.content);
  return el;
}

function renderMessages({ keepScroll = false } = {}) {
  const box = $('#messages');
  const empty = $('#chat-empty');
  if (!box) return;
  $$('.msg', box).forEach((el) => el.remove());
  const thread = activeThread();
  if (!thread || !thread.messages.length) {
    empty?.classList.remove('hidden');
    if ($('#persona-select') && !thread) {
      // keep the selector as the user's chosen default
    }
    if (!keepScroll) scrollBottom(true);
    return;
  }
  empty?.classList.add('hidden');
  thread.messages.forEach((message, index) => {
    box.appendChild(buildMessageElement(message, index));
  });
  if (!keepScroll) {
    requestAnimationFrame(() => scrollBottom(true));
  }
}

/* ---------- streaming request ---------- */
function createAssistantShell() {
  const box = $('#messages');
  const empty = $('#chat-empty');
  empty?.classList.add('hidden');
  const el = document.createElement('div');
  el.className = 'msg msg-assistant streaming';
  el.innerHTML = `
    <div class="msg-avatar">墨</div>
    <div class="msg-main">
      <div class="msg-meta"><span class="msg-role">墨屿</span><time>${escapeHtml(formatClock(Date.now()))}</time></div>
      <div class="msg-content md"><div class="thinking"><span></span><span></span><span></span></div></div>
      <div class="msg-actions"></div>
    </div>
  `;
  box.appendChild(el);
  scrollBottom(true);
  return el;
}

function contentToText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).join('');
  }
  return '';
}

function extractDelta(json) {
  const choice = json?.choices?.[0];
  if (!choice) return '';
  const deltaContent = contentToText(choice.delta?.content);
  if (deltaContent) return deltaContent;
  const messageContent = contentToText(choice.message?.content);
  if (messageContent) return messageContent;
  if (typeof choice.text === 'string') return choice.text;
  return '';
}

function extractError(json) {
  const error = json?.error;
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.type || '接口返回了未知错误';
}

async function errorFromResponse(response) {
  let detail = '';
  try {
    const raw = await response.text();
    try {
      const json = JSON.parse(raw);
      detail = extractError(json) || json?.message || raw;
    } catch {
      detail = raw;
    }
  } catch { /* ignore */ }
  detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 260);
  const base = `请求失败（HTTP ${response.status}）`;
  return new Error(detail ? `${base}：${detail}` : base);
}

function friendlyNetworkError(err) {
  const raw = err?.message || String(err);
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(raw)) {
    return '网络请求失败。可能是接口地址不可达、网络受限，或接口未允许跨域（CORS）。请检查设置后重试。';
  }
  return raw;
}

function parseSSEData(data) {
  const trimmed = data.trim();
  if (!trimmed || trimmed === '[DONE]') return { done: trimmed === '[DONE]' };
  try {
    const json = JSON.parse(trimmed);
    const apiError = extractError(json);
    if (apiError) return { error: apiError };
    return { delta: extractDelta(json) };
  } catch {
    return {};
  }
}

async function runCompletion({ messages, personaId, signal, onDelta }) {
  let request;
  try {
    request = resolveRequest();
  } catch (err) {
    const error = new Error(err.message);
    error.needsSettings = true;
    throw error;
  }

  const body = {
    model: request.model,
    messages: [{ role: 'system', content: systemPrompt(personaId) }, ...messages],
    stream: true,
    temperature: request.temperature,
  };

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: buildHeaders(request),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(friendlyNetworkError(err));
  }

  if (!response.ok) throw await errorFromResponse(response);

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || !response.body) {
    const json = await response.json();
    const apiError = extractError(json);
    if (apiError) throw new Error(apiError);
    const text = extractDelta(json);
    if (text) onDelta(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let sawDone = false;
  let streamError = '';

  const handleData = (data) => {
    const parsed = parseSSEData(data);
    if (parsed.done) { sawDone = true; return; }
    if (parsed.error) { streamError = parsed.error; return; }
    if (parsed.delta) {
      content += parsed.delta;
      onDelta(parsed.delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) handleData(line.slice(5));
    }
    if (sawDone) break;
  }
  if (buffer.trim().startsWith('data:')) handleData(buffer.trim().slice(5));
  if (streamError && !content) throw new Error(streamError);
  if (!content) throw new Error('接口没有返回内容，请稍后重试或检查模型设置。');
  return content;
}

/* ---------- sending ---------- */
function appendUserMessage(thread, content) {
  const message = { role: 'user', content, ts: Date.now() };
  thread.messages.push(message);
  if (thread.messages.length > MAX_MESSAGES) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES);
  touchThread(thread);
  const box = $('#messages');
  const empty = $('#chat-empty');
  empty?.classList.add('hidden');
  box.appendChild(buildMessageElement(message, thread.messages.length - 1));
  scrollBottom(true);
}

async function sendMessage(rawText) {
  const text = String(rawText || '').trim();
  if (!text || state.streaming) return;

  // Validate the provider before adding the message to a thread.
  try {
    resolveRequest();
  } catch (err) {
    toast(err.message || '请先配置模型接口', 'error');
    window.dispatchEvent(new CustomEvent('mori:navigate', { detail: { view: 'settings' } }));
    return;
  }

  const input = $('#chat-input');
  let thread = activeThread();
  if (!thread) {
    thread = createThread(text);
    $('#persona-select').value = thread.persona;
  }

  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  updateCharCount();
  setStreaming(true);
  appendUserMessage(thread, text);
  saveThreads();
  renderThreadList();
  emitThreadsChanged();

  const assistantEl = createAssistantShell();
  const contentEl = assistantEl.querySelector('.msg-content');
  const actionsEl = assistantEl.querySelector('.msg-actions');
  let content = '';
  let hasContent = false;
  let scheduled = false;

  const paint = () => {
    scheduled = false;
    contentEl.innerHTML = renderMarkdown(content);
    scrollBottom();
  };
  const schedulePaint = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(paint, 70);
  };

  const onDelta = (delta) => {
    content += delta;
    if (!hasContent) {
      hasContent = true;
      assistantEl.classList.remove('thinking');
      contentEl.innerHTML = '';
    }
    schedulePaint();
  };

  const messages = thread.messages.slice(-20, -1).map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: text });

  state.abortController = new AbortController();

  try {
    const finalText = await runCompletion({
      messages,
      personaId: thread.persona,
      signal: state.abortController.signal,
      onDelta,
    });
    if (!content) content = finalText || '';
    contentEl.innerHTML = renderMarkdown(content);
    assistantEl.classList.remove('streaming');
    const assistantMessage = { role: 'assistant', content, ts: Date.now() };
    thread.messages.push(assistantMessage);
    if (thread.messages.length > MAX_MESSAGES) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES);
    touchThread(thread);
    saveThreads();
    assistantEl.dataset.index = String(thread.messages.length - 1);
    actionsEl.innerHTML = `<button class="msg-action" type="button" data-copy-index="${thread.messages.length - 1}" title="复制这条消息">${icon('copy')}复制</button>`;
    renderThreadList();
    emitThreadsChanged();
    scrollBottom();
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (content.trim()) {
        paint();
        assistantEl.classList.remove('streaming');
        const assistantMessage = { role: 'assistant', content, ts: Date.now() };
        thread.messages.push(assistantMessage);
        touchThread(thread);
        saveThreads();
        assistantEl.dataset.index = String(thread.messages.length - 1);
        actionsEl.innerHTML = `<button class="msg-action" type="button" data-copy-index="${thread.messages.length - 1}" title="复制这条消息">${icon('copy')}复制</button>`;
        renderThreadList();
        emitThreadsChanged();
        toast('已停止生成，保留已生成的内容');
      } else {
        assistantEl.remove();
      }
    } else {
      console.error('[chat]', err);
      assistantEl.remove();
      const errorEl = document.createElement('div');
      errorEl.className = 'msg msg-assistant msg-error';
      const needsSettings = Boolean(err.needsSettings) || /设置|接口|模型名称|请求头/.test(err.message || '');
      errorEl.innerHTML = `
        <div class="msg-avatar">!</div>
        <div class="msg-main">
          <div class="msg-meta"><span class="msg-role">提示</span><time>${escapeHtml(formatClock(Date.now()))}</time></div>
          <div class="msg-content">${escapeHtml(friendlyNetworkError(err))}</div>
          <div class="msg-actions">
            ${needsSettings ? '<button class="msg-action" type="button" data-open-settings>打开设置</button>' : '<button class="msg-action" type="button" data-retry-last>重试</button>'}
          </div>
        </div>
      `;
      $('#messages').appendChild(errorEl);
      scrollBottom(true);
      toast('请求没有完成，请检查网络或接口设置', 'error');
    }
  } finally {
    state.abortController = null;
    setStreaming(false);
    renderThreadList();
    updateSendState();
  }
}

function stopStreaming() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
}

/* ---------- public actions ---------- */
export function startNewChat({ persona = 'general', prefill = '', send = false, focus = true } = {}) {
  if (state.streaming) {
    toast('正在生成回答，请先停止再来', 'error');
    return;
  }
  setActive(null);
  const select = $('#persona-select');
  if (select) select.value = PERSONAS[persona] ? persona : 'general';
  renderThreadList();
  renderMessages();
  const input = $('#chat-input');
  if (input) {
    input.value = prefill || '';
    autoGrow(input, 160);
    updateCharCount();
    updateSendState();
    if (send && prefill.trim()) {
      setTimeout(() => sendMessage(prefill), 60);
    } else if (focus) {
      setTimeout(() => input.focus({ preventScroll: false }), 80);
    }
  }
  updateChatHeader();
}

export function openThread(id) {
  if (state.streaming) {
    toast('正在生成回答，请先停止再来', 'error');
    return;
  }
  const thread = state.threads.find((t) => t.id === id);
  if (!thread) return;
  setActive(id);
  const select = $('#persona-select');
  if (select) select.value = thread.persona;
  renderThreadList();
  renderMessages();
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
    updateCharCount();
    updateSendState();
  }
}

async function deleteThread(id) {
  if (state.streaming) {
    toast('正在生成回答，请先停止再来', 'error');
    return;
  }
  const thread = state.threads.find((t) => t.id === id);
  if (!thread) return;
  const ok = await confirmDialog({
    title: '删除这段对话？',
    message: `「${thread.title}」将从本机移除，无法恢复。`,
    confirmText: '删除',
    danger: true,
    kicker: 'DELETE CONVERSATION',
  });
  if (!ok) return;
  state.threads = state.threads.filter((t) => t.id !== id);
  if (state.activeId === id) {
    setActive(null);
    renderMessages();
  }
  saveThreads();
  renderThreadList();
  emitThreadsChanged();
  toast('对话已删除');
}

async function clearActiveConversation() {
  if (state.streaming) {
    toast('正在生成回答，请先停止', 'error');
    return;
  }
  const thread = activeThread();
  if (!thread || !thread.messages.length) {
    startNewChat({ persona: $('#persona-select')?.value || 'general' });
    return;
  }
  const ok = await confirmDialog({
    title: '清空当前对话？',
    message: '这段对话会从本机移除，已生成的文字不会保留。',
    confirmText: '清空',
    danger: true,
    kicker: 'CLEAR CONVERSATION',
  });
  if (!ok) return;
  state.threads = state.threads.filter((t) => t.id !== thread.id);
  setActive(null);
  saveThreads();
  renderThreadList();
  renderMessages();
  emitThreadsChanged();
  toast('对话已清空');
}

export async function testApiConnection(override = null) {
  const request = resolveRequest(override);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: buildHeaders(request),
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: 'user', content: '请只回复：连接成功' }],
        stream: false,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response);
    const json = await response.json();
    const text = extractDelta(json) || json?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('接口已响应，但没有返回可读内容');
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('连接超时（30 秒），请检查接口地址');
    throw new Error(friendlyNetworkError(err));
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- bindings ---------- */
function bindUI() {
  if (state.bound) return;
  state.bound = true;

  const form = $('#composer');
  const input = $('#chat-input');
  updateSendState();
  updateCharCount();

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.streaming) {
      stopStreaming();
      return;
    }
    sendMessage(input.value);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (state.streaming) stopStreaming();
      else sendMessage(input.value);
    }
  });

  input?.addEventListener('input', () => {
    autoGrow(input, 160);
    updateCharCount();
    updateSendState();
  });

  $$('.suggestion').forEach((btn) => {
    btn.addEventListener('click', () => {
      sendMessage(btn.dataset.suggest || '');
    });
  });

  $('#persona-select')?.addEventListener('change', (e) => {
    const persona = PERSONAS[e.target.value] ? e.target.value : 'general';
    const thread = activeThread();
    if (thread) {
      thread.persona = persona;
      touchThread(thread);
      saveThreads();
      renderThreadList();
      emitThreadsChanged();
      toast(`已切换到「${PERSONAS[persona].label}」`);
    } else {
      toast(`新对话将使用「${PERSONAS[persona].label}」`);
    }
  });

  $('#chat-clear')?.addEventListener('click', clearActiveConversation);

  $('#thread-list')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-thread-del]');
    if (del) {
      e.stopPropagation();
      deleteThread(del.dataset.threadDel);
      return;
    }
    const item = e.target.closest('[data-thread-id]');
    if (item) openThread(item.dataset.threadId);
  });

  $('#messages')?.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy-index]');
    if (copyBtn) {
      const index = Number(copyBtn.dataset.copyIndex);
      const message = activeThread()?.messages[index];
      if (message) {
        const ok = await copyText(message.content);
        toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', ok ? 'ok' : 'error');
      }
      return;
    }
    if (e.target.closest('[data-open-settings]')) {
      window.dispatchEvent(new CustomEvent('mori:navigate', { detail: { view: 'settings' } }));
      return;
    }
    if (e.target.closest('[data-retry-last]')) {
      const thread = activeThread();
      const lastUser = [...(thread?.messages || [])].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        // Remove the previous user message from UI/history, then resend it.
        thread.messages.pop();
        saveThreads();
        renderMessages();
        sendMessage(lastUser.content);
      }
    }
  });

  // Allow the app to prompt "retry" without knowing internals.
  window.addEventListener('mori:send', (e) => {
    if (e.detail?.text) sendMessage(e.detail.text);
  });
}

export function initChat() {
  loadConfig();
  state.threads = loadThreads();
  const savedActive = store.get(ACTIVE_KEY, null);
  state.activeId = state.threads.some((t) => t.id === savedActive) ? savedActive : null;
  bindUI();
  updateChatHeader();
  if (state.activeId) {
    const thread = activeThread();
    if (thread) {
      const select = $('#persona-select');
      if (select) select.value = thread.persona;
    }
  }
  renderThreadList();
  renderMessages();
  updateSendState();
  updateCharCount();
}
