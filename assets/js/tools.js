/* Local-only utilities. Everything here runs in the browser. */

import { $, $$, escapeHtml, openModal, toast, copyText, icon } from './core.js';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (n) => String(n).padStart(2, '0');

function modalFooter() {
  return `<button class="btn btn-ghost" type="button" data-close-modal>关闭</button>`;
}

function copyTextFromElement(selector) {
  const el = $(selector);
  if (!el) return;
  const text = el.textContent.trim();
  if (!text || /^结果会显示在这里/.test(text)) {
    toast('还没有可复制的结果', 'error');
    return;
  }
  copyText(text).then((ok) => toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择', ok ? 'ok' : 'error'));
}

/* ---------- 字数统计 ---------- */
function openCountTool() {
  const modal = openModal({
    title: '字数统计',
    kicker: 'UTILITY · COUNT',
    body: `
      <div class="tool-label"><span>输入文本</span><em>实时统计</em></div>
      <textarea id="tool-count-input" class="tool-area" placeholder="粘贴或输入要统计的文字…" aria-label="要统计的文本"></textarea>
      <div class="tool-stats">
        <div class="tool-stat"><strong id="count-chars">0</strong><span>字符数</span></div>
        <div class="tool-stat"><strong id="count-nospace">0</strong><span>不含空格</span></div>
        <div class="tool-stat"><strong id="count-lines">0</strong><span>行数</span></div>
        <div class="tool-stat"><strong id="count-read">0 分</strong><span>阅读时长</span></div>
      </div>
      <p class="tool-hint">阅读时长按中文约 350 字 / 分钟估算；空行也计入行数。</p>
    `,
    footer: modalFooter(),
  });
  if (!modal) return;
  const input = $('#tool-count-input', modal.bodyEl);
  const update = () => {
    const text = input.value;
    const chars = Array.from(text).length;
    const noSpace = Array.from(text.replace(/\s/gu, '')).length;
    const lines = text ? text.split('\n').length : 0;
    const minutes = chars ? Math.max(1, Math.ceil(chars / 350)) : 0;
    $('#count-chars', modal.bodyEl).textContent = String(chars);
    $('#count-nospace', modal.bodyEl).textContent = String(noSpace);
    $('#count-lines', modal.bodyEl).textContent = String(lines);
    $('#count-read', modal.bodyEl).textContent = `${minutes} 分`;
  };
  input.addEventListener('input', update);
  update();
}

/* ---------- JSON ---------- */
function openJsonTool() {
  const modal = openModal({
    title: 'JSON 格式化',
    kicker: 'UTILITY · JSON',
    body: `
      <div class="tool-label"><span>JSON 输入</span><em>本地解析</em></div>
      <textarea id="tool-json-input" class="tool-area" placeholder='{"hello":"world","items":[1,2,3]}' aria-label="JSON 输入" spellcheck="false"></textarea>
      <div class="tool-toolbar">
        <button class="btn btn-primary" type="button" data-json="format">格式化</button>
        <button class="btn btn-ghost" type="button" data-json="minify">压缩</button>
        <button class="btn btn-ghost" type="button" data-json="clear">清空</button>
        <button class="btn btn-ghost" type="button" data-copy-result>${icon('copy')}复制结果</button>
      </div>
      <div class="tool-label" style="margin-top:14px"><span>结果</span><em>自动缩进 2 空格</em></div>
      <div class="tool-result" id="tool-json-result">结果会显示在这里</div>
    `,
    footer: modalFooter(),
  });
  if (!modal) return;
  const input = $('#tool-json-input', modal.bodyEl);
  const result = $('#tool-json-result', modal.bodyEl);

  const run = (mode) => {
    const text = input.value.trim();
    if (!text) {
      result.classList.remove('error');
      result.textContent = '结果会显示在这里';
      return;
    }
    try {
      const parsed = JSON.parse(text);
      result.classList.remove('error');
      result.textContent = mode === 'minify' ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
    } catch (err) {
      result.classList.add('error');
      const match = String(err.message).match(/position\s+(\d+)/i);
      let where = '';
      if (match) {
        const pos = Number(match[1]);
        const line = text.slice(0, pos).split('\n').length;
        const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        const column = pos - lineStart + 1;
        where = `（第 ${line} 行，第 ${column} 列附近）`;
      }
      result.textContent = `解析失败${where}：${err.message}`;
    }
  };

  modal.bodyEl.addEventListener('click', (e) => {
    const action = e.target.closest('[data-json]')?.dataset.json;
    if (action === 'format') run('format');
    if (action === 'minify') run('minify');
    if (action === 'clear') {
      input.value = '';
      result.textContent = '结果会显示在这里';
      result.classList.remove('error');
      input.focus();
    }
    if (e.target.closest('[data-copy-result]')) {
      if (result.classList.contains('error')) {
        toast('结果不是有效 JSON，无法复制', 'error');
        return;
      }
      copyText(result.textContent).then((ok) => toast(ok ? '结果已复制' : '复制失败', ok ? 'ok' : 'error'));
    }
  });

  // Format on first paste for a nice default.
  input.addEventListener('paste', () => setTimeout(() => run('format'), 30));
}

/* ---------- Base64 ---------- */
function encodeUTF8Base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeUTF8Base64(str) {
  const normalized = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function openBase64Tool() {
  let mode = 'encode';
  const modal = openModal({
    title: 'Base64 编解码',
    kicker: 'UTILITY · BASE64',
    body: `
      <div class="seg-mini" id="b64-mode" role="group" aria-label="转换方向">
        <button type="button" class="active" data-b64-mode="encode">文本 → Base64</button>
        <button type="button" data-b64-mode="decode">Base64 → 文本</button>
      </div>
      <div class="tool-label"><span>输入</span><em id="b64-mode-hint">UTF-8 编码</em></div>
      <textarea id="tool-b64-input" class="tool-area" placeholder="输入要编码的文字…" spellcheck="false"></textarea>
      <div class="tool-toolbar">
        <button class="btn btn-primary" type="button" data-b64-run>转换</button>
        <button class="btn btn-ghost" type="button" data-b64-clear>清空</button>
        <button class="btn btn-ghost" type="button" data-b64-copy>${icon('copy')}复制结果</button>
      </div>
      <div class="tool-label" style="margin-top:14px"><span>结果</span><em>支持中文与 Emoji</em></div>
      <div class="tool-result" id="tool-b64-result">结果会显示在这里</div>
    `,
    footer: modalFooter(),
  });
  if (!modal) return;
  const input = $('#tool-b64-input', modal.bodyEl);
  const result = $('#tool-b64-result', modal.bodyEl);
  const hint = $('#b64-mode-hint', modal.bodyEl);
  const placeholder = '输入要编码的文字…';

  const setMode = (next) => {
    mode = next;
    $$('[data-b64-mode]', modal.bodyEl).forEach((btn) => btn.classList.toggle('active', btn.dataset.b64Mode === next));
    hint.textContent = next === 'encode' ? 'UTF-8 编码' : '自动忽略空白';
    input.placeholder = next === 'encode' ? placeholder : '粘贴 Base64 字符串…';
  };

  const run = () => {
    const text = input.value;
    if (!text.trim()) {
      result.classList.remove('error');
      result.textContent = '结果会显示在这里';
      return;
    }
    try {
      result.classList.remove('error');
      result.textContent = mode === 'encode' ? encodeUTF8Base64(text) : decodeUTF8Base64(text);
    } catch (err) {
      result.classList.add('error');
      result.textContent = mode === 'encode'
        ? `编码失败：${err.message}`
        : '解码失败：内容不是有效的 Base64，或结果不是 UTF-8 文本。';
    }
  };

  modal.bodyEl.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-b64-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.b64Mode); return; }
    if (e.target.closest('[data-b64-run]')) { run(); return; }
    if (e.target.closest('[data-b64-clear]')) {
      input.value = '';
      result.textContent = '结果会显示在这里';
      result.classList.remove('error');
      input.focus();
      return;
    }
    if (e.target.closest('[data-b64-copy]')) copyTextFromElement('#tool-b64-result');
  });

  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
}

/* ---------- Timestamp ---------- */
function formatLocalDate(date) {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${WEEKDAYS[date.getDay()]}`;
}

function openTimestampTool() {
  const modal = openModal({
    title: '时间戳转换',
    kicker: 'UTILITY · TIME',
    body: `
      <div class="tool-label"><span>时间戳或日期</span><em>支持秒 / 毫秒 / 日期字符串</em></div>
      <div class="field">
        <input id="tool-ts-input" type="text" placeholder="例如 1793344415 或 2026-10-30 15:00" autocomplete="off" spellcheck="false">
      </div>
      <div class="tool-toolbar">
        <button class="btn btn-primary" type="button" data-ts-now>填入当前时间</button>
        <button class="btn btn-ghost" type="button" data-ts-copy>${icon('copy')}复制秒级时间戳</button>
      </div>
      <div class="tool-label" style="margin-top:14px"><span>换算结果</span><em>按本机时区</em></div>
      <div class="tool-result" id="tool-ts-result"></div>
    `,
    footer: modalFooter(),
  });
  if (!modal) return;
  const input = $('#tool-ts-input', modal.bodyEl);
  const result = $('#tool-ts-result', modal.bodyEl);
  let lastDate = new Date();

  const update = () => {
    const raw = input.value.trim();
    let date;
    let from = '当前时间';
    if (!raw) {
      date = new Date();
      from = '当前时间';
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      const num = Number(raw);
      date = new Date(Math.abs(num) >= 1e12 ? num : num * 1000);
      from = Math.abs(num) >= 1e12 ? '毫秒时间戳' : '秒时间戳';
    } else {
      date = new Date(raw.replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) date = new Date(raw);
      from = '日期字符串';
    }

    if (Number.isNaN(date.getTime())) {
      result.classList.add('error');
      result.textContent = '无法识别这个时间，请尝试 10 位秒级时间戳、13 位毫秒时间戳，或 2026-10-30 15:00 这样的日期。';
      return;
    }
    result.classList.remove('error');
    lastDate = date;
    const seconds = Math.floor(date.getTime() / 1000);
    const millis = date.getTime();
    const diff = Date.now() - millis;
    const abs = Math.abs(diff);
    let relative;
    if (abs < 60 * 1000) relative = '就是现在';
    else if (abs < 3600 * 1000) relative = `${Math.round(abs / 60000)} 分钟${diff > 0 ? '前' : '后'}`;
    else if (abs < 86400 * 1000) relative = `${Math.round(abs / 3600000)} 小时${diff > 0 ? '前' : '后'}`;
    else relative = `${Math.round(abs / 86400000)} 天${diff > 0 ? '前' : '后'}`;

    result.innerHTML = `
      <div class="tool-line"><span class="muted">识别为</span><span>${escapeHtml(from)}</span></div>
      <div class="tool-line"><span class="muted">本地时间</span><span>${escapeHtml(formatLocalDate(date))}</span></div>
      <div class="tool-line"><span class="muted">ISO 8601</span><span>${escapeHtml(date.toISOString())}</span></div>
      <div class="tool-line"><span class="muted">时间戳</span><span>${seconds} 秒 · ${millis} 毫秒</span></div>
      <div class="tool-line"><span class="muted">相对现在</span><span>${escapeHtml(relative)}</span></div>
    `;
  };

  modal.bodyEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-ts-now]')) {
      input.value = String(Math.floor(Date.now() / 1000));
      update();
      return;
    }
    if (e.target.closest('[data-ts-copy]')) {
      if (result.classList.contains('error')) {
        toast('没有可复制的时间', 'error');
        return;
      }
      const value = String(Math.floor(lastDate.getTime() / 1000));
      copyText(value).then((ok) => toast(ok ? `已复制 ${value}` : '复制失败', ok ? 'ok' : 'error'));
    }
  });

  input.addEventListener('input', update);
  update();
}

/* ---------- URL ---------- */
function openUrlTool() {
  let mode = 'encode';
  const modal = openModal({
    title: 'URL 编解码',
    kicker: 'UTILITY · URL',
    body: `
      <div class="seg-mini" id="url-mode" role="group" aria-label="转换方向">
        <button type="button" class="active" data-url-mode="encode">编码</button>
        <button type="button" data-url-mode="decode">解码</button>
      </div>
      <div class="tool-label"><span>输入</span><em>encodeURIComponent</em></div>
      <textarea id="tool-url-input" class="tool-area" placeholder="例如：https://example.com/搜索?q=想法" spellcheck="false"></textarea>
      <div class="tool-toolbar">
        <button class="btn btn-primary" type="button" data-url-run>转换</button>
        <button class="btn btn-ghost" type="button" data-url-clear>清空</button>
        <button class="btn btn-ghost" type="button" data-url-copy>${icon('copy')}复制结果</button>
      </div>
      <div class="tool-label" style="margin-top:14px"><span>结果</span><em>本地处理</em></div>
      <div class="tool-result" id="tool-url-result">结果会显示在这里</div>
    `,
    footer: modalFooter(),
  });
  if (!modal) return;
  const input = $('#tool-url-input', modal.bodyEl);
  const result = $('#tool-url-result', modal.bodyEl);

  const setMode = (next) => {
    mode = next;
    $$('[data-url-mode]', modal.bodyEl).forEach((btn) => btn.classList.toggle('active', btn.dataset.urlMode === next));
    input.placeholder = next === 'encode' ? '例如：https://example.com/搜索?q=想法' : '粘贴带 % 编码的链接…';
  };

  const run = () => {
    const text = input.value;
    if (!text.trim()) {
      result.classList.remove('error');
      result.textContent = '结果会显示在这里';
      return;
    }
    try {
      result.classList.remove('error');
      result.textContent = mode === 'encode' ? encodeURIComponent(text) : decodeURIComponent(text);
    } catch (err) {
      result.classList.add('error');
      result.textContent = mode === 'decode'
        ? '解码失败：链接中包含不完整的编码序列（例如单独的 % 或 %ZZ）。'
        : `编码失败：${err.message}`;
    }
  };

  modal.bodyEl.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-url-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.urlMode); return; }
    if (e.target.closest('[data-url-run]')) { run(); return; }
    if (e.target.closest('[data-url-clear]')) {
      input.value = '';
      result.textContent = '结果会显示在这里';
      result.classList.remove('error');
      input.focus();
      return;
    }
    if (e.target.closest('[data-url-copy]')) copyTextFromElement('#tool-url-result');
  });
}

/* ---------- dispatch ---------- */
const TOOL_HANDLERS = {
  count: openCountTool,
  json: openJsonTool,
  base64: openBase64Tool,
  timestamp: openTimestampTool,
  url: openUrlTool,
};

export function initTools() {
  $('#tools-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-tool]');
    if (!card) return;
    const tool = card.dataset.tool;
    TOOL_HANDLERS[tool]?.();
  });
}
