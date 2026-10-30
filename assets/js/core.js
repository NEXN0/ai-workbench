/* Core helpers: DOM, storage, formatting, markdown, modal, toast. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const icon = (name, cls = '') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---------- storage ---------- */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  keys() {
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

/* ---------- date / time ---------- */
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatClock(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateCN(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEKDAYS[d.getDay()]}`;
}

export function formatKickerDate(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function relativeTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 45 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (dateKey(now) === dateKey(ts)) return `今天 ${formatClock(ts)}`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(yesterday.getTime()) === dateKey(ts)) return `昨天 ${formatClock(ts)}`;
  const d = new Date(ts);
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function isToday(ts) {
  return dateKey(ts) === dateKey(Date.now());
}

/* ---------- clipboard ---------- */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ---------- download ---------- */
export function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- markdown ---------- */
function inlineFormat(input, inlineCodes) {
  let text = input;
  text = text.replace(
    /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  text = text.replace(/\u0001I(\d+)\u0001/g, (m, idx) => `<code>${inlineCodes[Number(idx)] ?? ''}</code>`);
  return text;
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  const head = lines[index].trim();
  const sep = lines[index + 1].trim();
  if (!head.includes('|') || !sep.includes('|')) return false;
  const cells = sep.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(raw) {
  if (!raw) return '';
  const codeBlocks = [];
  const inlineCodes = [];
  let text = escapeHtml(String(raw)).replace(/\r\n?/g, '\n');

  text = text.replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
    const idx = codeBlocks.push({ lang: escapeHtml(lang), code }) - 1;
    return `\n\n\u0000C${idx}\u0000\n\n`;
  });
  text = text.replace(/`([^`\n]+)`/g, (m, code) => {
    const idx = inlineCodes.push(code) - 1;
    return `\u0001I${idx}\u0001`;
  });

  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const inline = (value) => inlineFormat(value, inlineCodes);

  const blockStart = (line, idx) => {
    const t = line.trim();
    if (!t) return true;
    if (/^\u0000C\d+\u0000$/.test(t)) return true;
    if (/^#{1,4}\s+/.test(t)) return true;
    if (/^&gt;\s?/.test(t)) return true;
    if (/^([-*_])\1{2,}$/.test(t)) return true;
    if (/^([-*+]|\d+\.)\s+/.test(t)) return true;
    if (isTableStart(lines, idx)) return true;
    return false;
  };

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) { i++; continue; }

    const codeMatch = line.match(/^\u0000C(\d+)\u0000$/);
    if (codeMatch) {
      const block = codeBlocks[Number(codeMatch[1])];
      const langLabel = block.lang ? `<span class="code-lang">${block.lang}</span>` : '';
      out.push(`<pre>${langLabel}<code>${block.code}</code></pre>`);
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^&gt;\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^&gt;/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${quoteLines.map(inline).join('<br>')}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const headers = splitTableRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const headHtml = headers.map((c) => `<th>${inline(c)}</th>`).join('');
      const bodyHtml = rows
        .map((cells) => `<tr>${headers.map((_, idx) => `<td>${inline(cells[idx] ?? '')}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    const listMatch = line.match(/^([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].trim().match(/^([-*+]|\d+\.)\s+(.+)$/);
        if (!m) break;
        if (/^\d/.test(m[1]) !== ordered) break;
        items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line];
    i++;
    while (i < lines.length && !blockStart(lines[i], i)) {
      paragraph.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('\n');
}

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(message, type = 'ok', duration = 2600) {
  const root = $('#toast');
  const msg = $('#toast-msg');
  if (!root || !msg) return;
  msg.textContent = message;
  root.classList.toggle('error', type === 'error');
  const use = root.querySelector('.toast-icon use');
  if (use) use.setAttribute('href', type === 'error' ? '#i-info' : '#i-check');
  root.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.hidden = true; }, duration);
}

/* ---------- modal ---------- */
let modalOnClose = null;
let modalPreviousFocus = null;
let modalOpen = false;
let previousOverflow = '';

export function openModal({ title = '', kicker = '', body = '', footer = '', onClose = null, width = '' } = {}) {
  const root = $('#modal-root');
  if (!root) return null;
  if (modalOpen) closeModal(true);

  const titleEl = $('#modal-title', root);
  const kickerEl = $('#modal-kicker', root);
  const bodyEl = $('#modal-body', root);
  const footEl = $('#modal-foot', root);
  const modalEl = $('.modal', root);

  titleEl.textContent = title;
  kickerEl.textContent = kicker;
  bodyEl.innerHTML = body;
  footEl.innerHTML = footer;
  footEl.classList.toggle('hidden', !footer);
  if (modalEl) modalEl.style.width = width || '';

  modalPreviousFocus = document.activeElement;
  modalOnClose = typeof onClose === 'function' ? onClose : null;
  modalOpen = true;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  root.hidden = false;

  setTimeout(() => {
    const first = bodyEl.querySelector('input:not([type="hidden"]), textarea, select, button')
      || footEl.querySelector('button')
      || $('.modal-close', root);
    first?.focus?.({ preventScroll: true });
  }, 30);

  return { root, bodyEl, footEl, close: closeModal };
}

export function closeModal(silent = false) {
  const root = $('#modal-root');
  if (!root || !modalOpen) return;
  modalOpen = false;
  root.hidden = true;
  const bodyEl = $('#modal-body', root);
  const footEl = $('#modal-foot', root);
  if (bodyEl) bodyEl.innerHTML = '';
  if (footEl) { footEl.innerHTML = ''; footEl.classList.add('hidden'); }
  document.body.style.overflow = previousOverflow;
  if (modalPreviousFocus?.focus) {
    try { modalPreviousFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  const callback = modalOnClose;
  modalOnClose = null;
  if (!silent && callback) callback();
}

export function isModalOpen() {
  return modalOpen;
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  kicker = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const footer = `
      <button class="btn btn-ghost" type="button" data-confirm-cancel>${escapeHtml(cancelText)}</button>
      <button class="btn ${danger ? 'btn-primary danger-solid' : 'btn-primary'}" type="button" data-confirm-ok>${escapeHtml(confirmText)}</button>
    `;
    const modal = openModal({
      title,
      kicker,
      body: `<p class="confirm-message">${escapeHtml(message)}</p>`,
      footer,
      onClose: () => settle(false),
    });
    if (!modal) { settle(false); return; }
    modal.bodyEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-confirm-ok]')) { settle(true); closeModal(true); }
      if (e.target.closest('[data-confirm-cancel]')) { settle(false); closeModal(true); }
    });
    modal.footEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-confirm-ok]')) { settle(true); closeModal(true); }
      if (e.target.closest('[data-confirm-cancel]')) { settle(false); closeModal(true); }
    });
  });
}

export function initCoreUI() {
  const root = $('#modal-root');
  if (root) {
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) closeModal();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const modal = $('.modal', root);
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
}

/* keyboard helper for textarea auto-grow */
export function autoGrow(textarea, maxHeight = 160) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
}
