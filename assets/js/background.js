/* Background image manager: upload, compress, persist in IndexedDB, render & tune. */

import { $, $$, store, toast, confirmDialog, icon, formatDateCN, uid, escapeHtml } from './core.js';

const DB_NAME = 'mori-workbench';
const DB_VERSION = 1;
const STORE_NAME = 'backgrounds';
const MAX_ITEMS = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 2560;
const ACTIVE_KEY = 'mori.bg.active';
const SETTINGS_KEY = 'mori.bg.settings';

const PRESETS = {
  fog: { name: '雾蓝', css: 'linear-gradient(135deg, #e3e9ee 0%, #d3dde5 48%, #b7c7d4 100%)' },
  moss: { name: '苔绿', css: 'linear-gradient(135deg, #e6ebe2 0%, #d4dfce 48%, #a9bea9 100%)' },
  sand: { name: '暖沙', css: 'linear-gradient(135deg, #f0e9dd 0%, #e6dac7 48%, #d5c2a2 100%)' },
  dusk: { name: '暮紫', css: 'linear-gradient(135deg, #e8e2ea 0%, #d9cede 48%, #b9a8bd 100%)' },
  ink: { name: '砚墨', css: 'linear-gradient(135deg, #6a6e72 0%, #46494d 48%, #242628 100%)' },
};

const DEFAULT_SETTINGS = { veil: 62, blur: 0, position: 'center' };

const state = {
  items: [],
  activeId: null,
  settings: { ...DEFAULT_SETTINGS },
  ready: false,
  busy: false,
  dbUnavailable: false,
};

let dbPromise = null;
let bound = false;

/* ---------- IndexedDB ---------- */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法打开本地图片库'));
    req.onblocked = () => reject(new Error('本地图片库被其他页面占用'));
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('本地图片库操作失败'));
    tx.onabort = () => reject(tx.error || new Error('本地图片库操作被中止'));
  });
}

async function getAllRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord(record) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(record);
  await txDone(tx);
}

async function deleteRecord(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await txDone(tx);
}

async function clearRecords() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await txDone(tx);
}

/* ---------- helpers ---------- */
function loadSettings() {
  const saved = store.get(SETTINGS_KEY, {});
  const veil = Number.isFinite(Number(saved?.veil)) ? Number(saved.veil) : DEFAULT_SETTINGS.veil;
  const blur = Number.isFinite(Number(saved?.blur)) ? Number(saved.blur) : DEFAULT_SETTINGS.blur;
  const position = ['center', 'top', 'bottom'].includes(saved?.position) ? saved.position : 'center';
  state.settings = {
    veil: Math.min(95, Math.max(10, veil)),
    blur: Math.min(18, Math.max(0, blur)),
    position,
  };
}

function saveSettings() {
  store.set(SETTINGS_KEY, state.settings);
}

function saveActive() {
  if (state.activeId) store.set(ACTIVE_KEY, state.activeId);
  else store.remove(ACTIVE_KEY);
}

function activeKind() {
  if (!state.activeId) return 'default';
  if (state.activeId.startsWith('preset:')) return 'preset';
  return 'upload';
}

function activeRecord() {
  if (activeKind() !== 'upload') return null;
  return state.items.find((item) => item.id === state.activeId) || null;
}

function activePreset() {
  if (activeKind() !== 'preset') return null;
  return PRESETS[state.activeId.slice('preset:'.length)] || null;
}

function displayName() {
  if (activeKind() === 'default') return '默认素白';
  if (activeKind() === 'preset') return `静色 · ${activePreset()?.name || ''}`;
  return activeRecord()?.name || '自定义背景';
}

function shortName() {
  if (activeKind() === 'default') return '素白';
  if (activeKind() === 'preset') return activePreset()?.name || '预设';
  return activeRecord()?.name || '自定义';
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  return Math.round((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

async function prepareImage(file) {
  if (file.type === 'image/gif') {
    const dataUrl = await readAsDataURL(file);
    let width = 0;
    let height = 0;
    try {
      const img = await loadImage(dataUrl);
      width = img.naturalWidth;
      height = img.naturalHeight;
    } catch { /* keep zeroes */ }
    return { dataUrl, width, height, bytes: file.size };
  }

  const source = await readAsDataURL(file);
  const img = await loadImage(source);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('无法读取图片尺寸');
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Fill white behind transparent images only for JPEG fallback; WebP keeps alpha.
  ctx.drawImage(img, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/webp', 0.87);
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  }
  return { dataUrl, width, height, bytes: dataUrlBytes(dataUrl) };
}

function cleanName(name) {
  return String(name || '未命名背景')
    .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || '未命名背景';
}

function emitChange() {
  window.dispatchEvent(new CustomEvent('mori:bg-changed', {
    detail: {
      activeId: state.activeId,
      kind: activeKind(),
      name: displayName(),
      shortName: shortName(),
      count: state.items.length,
    },
  }));
}

/* ---------- applying background ---------- */
function applyCssSettings() {
  const root = document.documentElement;
  root.style.setProperty('--veil-alpha', (state.settings.veil / 100).toFixed(2));
  root.style.setProperty('--preview-veil', (state.settings.veil / 100).toFixed(2));
  root.style.setProperty('--bg-blur', `${state.settings.blur}px`);
  root.style.setProperty('--preview-blur', `${state.settings.blur}px`);
  root.style.setProperty('--bg-position', state.settings.position);

  const veilLabel = $('#veil-val');
  const blurLabel = $('#blur-val');
  if (veilLabel) veilLabel.textContent = `${state.settings.veil}%`;
  if (blurLabel) blurLabel.textContent = `${state.settings.blur} px`;
  const veilRange = $('#veil-range');
  const blurRange = $('#blur-range');
  if (veilRange) veilRange.value = String(state.settings.veil);
  if (blurRange) blurRange.value = String(state.settings.blur);
  const position = $('#bg-position');
  if (position) position.value = state.settings.position;
}

function applyActive() {
  const bgImage = $('#bg-image');
  const previewImg = $('#bg-preview-img');
  const thumb = $('#side-bg-thumb');
  const kind = activeKind();
  let css = '';
  let thumbCss = '';

  if (kind === 'preset') {
    const preset = activePreset();
    if (preset) {
      css = preset.css;
      thumbCss = preset.css;
    } else {
      state.activeId = null;
    }
  } else if (kind === 'upload') {
    const record = activeRecord();
    if (record) {
      css = `url("${record.data}")`;
      thumbCss = css;
    } else {
      state.activeId = null;
    }
  }

  if (css) {
    document.body.classList.add('has-bg');
    if (bgImage) {
      bgImage.style.backgroundImage = css;
      bgImage.style.backgroundPosition = state.settings.position;
    }
    if (previewImg) {
      previewImg.style.backgroundImage = css;
      previewImg.style.backgroundPosition = state.settings.position;
    }
    if (thumb) thumb.style.backgroundImage = thumbCss;
  } else {
    document.body.classList.remove('has-bg');
    if (bgImage) bgImage.style.backgroundImage = '';
    if (previewImg) previewImg.style.backgroundImage = '';
    if (thumb) thumb.style.backgroundImage = '';
  }

  const preview = $('#bg-preview');
  preview?.classList.toggle('has-image', Boolean(css));
  preview?.classList.toggle('is-default', !css);

  updateTexts();
  updatePresetActive();
  applyCssSettings();
}

function updateTexts() {
  const kind = activeKind();
  const nameEl = $('#bg-active-name');
  const metaEl = $('#bg-active-meta');
  const sideName = $('#side-bg-name');
  if (nameEl) nameEl.textContent = displayName();
  if (sideName) sideName.textContent = shortName();

  let meta = '未使用背景图片';
  if (kind === 'preset') {
    meta = `静色预设 · 遮罩 ${state.settings.veil}% · ${state.settings.position === 'center' ? '居中' : state.settings.position === 'top' ? '顶部对齐' : '底部对齐'}`;
  } else if (kind === 'upload') {
    const item = activeRecord();
    if (item) {
      const dims = item.width && item.height ? `${item.width} × ${item.height} · ` : '';
      meta = `${dims}${formatBytes(item.bytes)} · ${formatDateCN(item.createdAt)}`;
    }
  }
  if (metaEl) metaEl.textContent = meta;
}

function updatePresetActive() {
  $$('.preset-dot').forEach((dot) => {
    dot.classList.toggle('active', state.activeId === `preset:${dot.dataset.preset}`);
  });
}

/* ---------- gallery ---------- */
function renderGallery() {
  const gallery = $('#bg-gallery');
  if (!gallery) return;
  const countEl = $('#gallery-count');
  if (countEl) countEl.textContent = `${state.items.length} / ${MAX_ITEMS}`;
  gallery.innerHTML = '';

  if (!state.ready) {
    gallery.innerHTML = '<div class="bg-gallery-empty">正在读取本地背景图库…</div>';
    return;
  }

  if (state.dbUnavailable) {
    gallery.innerHTML = '<div class="bg-gallery-empty">当前浏览器无法使用本地图库，背景图上传不可用。</div>';
    return;
  }

  const sorted = [...state.items].sort((a, b) => b.createdAt - a.createdAt);

  if (!sorted.length) {
    gallery.innerHTML = `
      <div class="bg-gallery-empty">
        <span class="upload-icon">${icon('upload')}</span>
        <strong>图库还是空的</strong>
        <p>上传一张照片或插画，它会自动压缩后保存在本机。最多 ${MAX_ITEMS} 张。</p>
        <button class="btn btn-ghost" type="button" data-bg-upload="1">${icon('plus')}上传第一张背景</button>
      </div>
    `;
    return;
  }

  sorted.forEach((item) => {
    const thumb = document.createElement('div');
    thumb.className = `bg-thumb${state.activeId === item.id ? ' active' : ''}`;
    thumb.style.backgroundImage = `url("${item.data}")`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'bg-thumb-main';
    main.dataset.bgSelect = item.id;
    main.setAttribute('aria-label', `使用背景 ${item.name}`);

    const actions = document.createElement('div');
    actions.className = 'bg-thumb-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bg-thumb-btn';
    del.dataset.bgDelete = item.id;
    del.title = '删除这张背景';
    del.setAttribute('aria-label', `删除背景 ${item.name}`);
    del.innerHTML = icon('trash');
    actions.appendChild(del);

    const label = document.createElement('span');
    label.className = 'bg-thumb-label';
    label.innerHTML = `<span class="bg-thumb-name">${escapeHtml(item.name)}</span>`;
    main.appendChild(label);
    thumb.append(main, actions);
    gallery.appendChild(thumb);
  });

  if (state.items.length < MAX_ITEMS) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'bg-thumb-add';
    add.dataset.bgUpload = '1';
    add.innerHTML = `${icon('upload')}<span>继续上传</span>`;
    gallery.appendChild(add);
  }
}

/* ---------- actions ---------- */
function openFilePicker() {
  if (state.busy) return;
  if (state.items.length >= MAX_ITEMS) {
    toast(`图库已满（${MAX_ITEMS} 张），请先删除一张`, 'error');
    return;
  }
  const input = $('#bg-file');
  if (!input) return;
  input.value = '';
  input.click();
}

function setBusy(busy) {
  state.busy = busy;
  const zone = $('#upload-zone');
  if (!zone) return;
  if (busy) {
    if (!zone.dataset.defaultHtml) zone.dataset.defaultHtml = zone.innerHTML;
    zone.classList.add('is-busy');
    zone.innerHTML = `<span class="upload-icon">${icon('refresh')}</span><strong>正在处理图片…</strong><small>压缩并写入本地图库</small>`;
  } else {
    zone.classList.remove('is-busy');
    if (zone.dataset.defaultHtml) zone.innerHTML = zone.dataset.defaultHtml;
  }
}

async function handleFiles(fileList) {
  if (state.busy) return;
  const file = fileList?.[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    toast('请选择图片文件（JPG、PNG、WebP 或 GIF）', 'error');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    toast('暂不支持这种图片格式', 'error');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    toast('图片超过 20 MB，请先压缩后重试', 'error');
    return;
  }
  if (state.items.length >= MAX_ITEMS) {
    toast(`图库已满（${MAX_ITEMS} 张），请先删除一张`, 'error');
    return;
  }

  setBusy(true);
  try {
    const prepared = await prepareImage(file);
    const record = {
      id: uid('bg'),
      name: cleanName(file.name),
      data: prepared.dataUrl,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.bytes,
      sourceType: file.type,
      createdAt: Date.now(),
    };
    await putRecord(record);
    state.items.push(record);
    state.activeId = record.id;
    saveActive();
    applyActive();
    renderGallery();
    emitChange();
    toast('背景已更新，仅保存在本机');
  } catch (err) {
    console.error('[background]', err);
    if (err?.name === 'QuotaExceededError') {
      toast('本地存储空间不足，请删除一些背景后再试', 'error');
    } else {
      toast(err?.message || '图片处理失败，请换一张试试', 'error');
    }
  } finally {
    setBusy(false);
  }
}

async function selectBackground(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (state.activeId === id) { toast('这张背景正在使用'); return; }
  state.activeId = id;
  saveActive();
  applyActive();
  renderGallery();
  emitChange();
  toast(`已切换到「${item.name}」`);
}

async function removeBackground() {
  if (state.activeId === null) {
    toast('当前已是默认背景');
    return;
  }
  state.activeId = null;
  saveActive();
  applyActive();
  renderGallery();
  emitChange();
  toast('已恢复默认素白背景');
}

async function deleteBackground(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const ok = await confirmDialog({
    title: '删除这张背景？',
    message: `「${item.name}」将从本机图库中移除，这个操作无法撤销。`,
    confirmText: '删除',
    danger: true,
    kicker: 'DELETE BACKGROUND',
  });
  if (!ok) return;
  try {
    await deleteRecord(id);
    state.items = state.items.filter((entry) => entry.id !== id);
    if (state.activeId === id) {
      state.activeId = null;
      saveActive();
      applyActive();
    }
    renderGallery();
    emitChange();
    toast('背景已删除');
  } catch (err) {
    console.error('[background]', err);
    toast('删除失败，请重试', 'error');
  }
}

function selectPreset(presetId) {
  if (!PRESETS[presetId]) return;
  const id = `preset:${presetId}`;
  if (state.activeId === id) {
    toast(`正在使用「${PRESETS[presetId].name}」预设`);
    return;
  }
  state.activeId = id;
  saveActive();
  applyActive();
  renderGallery();
  emitChange();
  toast(`已应用「${PRESETS[presetId].name}」静色背景`);
}

/* ---------- bindings ---------- */
function bindUI() {
  if (bound) return;
  bound = true;

  const fileInput = $('#bg-file');
  fileInput?.addEventListener('change', () => {
    const files = fileInput.files;
    if (files && files.length) handleFiles(files);
  });

  $('#bg-upload-btn')?.addEventListener('click', openFilePicker);
  $('#bg-remove')?.addEventListener('click', removeBackground);

  const zone = $('#upload-zone');
  zone?.addEventListener('click', openFilePicker);
  zone?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  });

  $('#bg-gallery')?.addEventListener('click', (e) => {
    const upload = e.target.closest('[data-bg-upload]');
    if (upload) { openFilePicker(); return; }
    const del = e.target.closest('[data-bg-delete]');
    if (del) { deleteBackground(del.dataset.bgDelete); return; }
    const select = e.target.closest('[data-bg-select]');
    if (select) selectBackground(select.dataset.bgSelect);
  });

  $('#bg-presets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (btn) selectPreset(btn.dataset.preset);
  });

  const veil = $('#veil-range');
  veil?.addEventListener('input', () => {
    state.settings.veil = Number(veil.value);
    saveSettings();
    applyCssSettings();
    updateTexts();
  });
  const blur = $('#blur-range');
  blur?.addEventListener('input', () => {
    state.settings.blur = Number(blur.value);
    saveSettings();
    applyCssSettings();
  });
  const position = $('#bg-position');
  position?.addEventListener('change', () => {
    state.settings.position = ['center', 'top', 'bottom'].includes(position.value) ? position.value : 'center';
    saveSettings();
    const bgImage = $('#bg-image');
    const previewImg = $('#bg-preview-img');
    if (bgImage) bgImage.style.backgroundPosition = state.settings.position;
    if (previewImg) previewImg.style.backgroundPosition = state.settings.position;
    updateTexts();
  });

  // Drag & drop on the upload zone and the preview.
  const dropTargets = [zone, $('#bg-preview')].filter(Boolean);
  let dragDepth = 0;
  dropTargets.forEach((target) => {
    target.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      target.classList.add('drag-over');
    });
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) target.classList.remove('drag-over');
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      target.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });
  });

  // Prevent the browser from navigating away when a file is dropped slightly off target.
  const view = $('#view-background');
  view?.addEventListener('dragover', (e) => {
    if (e.target.closest('#upload-zone, #bg-preview')) return;
    e.preventDefault();
  });
  view?.addEventListener('drop', (e) => {
    if (e.target.closest('#upload-zone, #bg-preview')) return;
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
}

/* ---------- public API ---------- */
export function getBackgroundSummary() {
  return {
    activeId: state.activeId,
    kind: activeKind(),
    name: displayName(),
    shortName: shortName(),
    count: state.items.length,
  };
}

export function getBackgroundCount() {
  return state.items.length;
}

export async function clearBackgroundStore() {
  try {
    await clearRecords();
  } catch (err) {
    console.warn('[background] clear failed', err);
  }
  state.items = [];
  state.activeId = null;
  saveActive();
  applyActive();
  renderGallery();
  emitChange();
}

export async function initBackground() {
  loadSettings();
  const savedActive = store.get(ACTIVE_KEY, null);
  state.activeId = typeof savedActive === 'string' ? savedActive : null;

  // Apply immediately if it's a preset, so returning visitors see their atmosphere fast.
  if (state.activeId?.startsWith('preset:')) applyActive();
  else applyCssSettings();

  bindUI();

  try {
    const records = await getAllRecords();
    state.items = records;
  } catch (err) {
    console.error('[background] failed to open library', err);
    state.dbUnavailable = true;
    state.items = [];
  }

  if (state.activeId && !state.activeId.startsWith('preset:') && !state.items.some((item) => item.id === state.activeId)) {
    state.activeId = null;
    saveActive();
  }
  if (state.activeId?.startsWith('preset:') && !PRESETS[state.activeId.slice('preset:'.length)]) {
    state.activeId = null;
    saveActive();
  }

  state.ready = true;
  applyActive();
  renderGallery();
  emitChange();
}
