// Синхронизация рассказов с GitHub-репозиторием ishimura-archive и локальный кэш для офлайн-чтения.
// Перенос main/content.js из ПК-версии: тот же манифест, те же правила, только хранилище — vfs.
import { vfs } from './vfs.js';
import { Emitter } from './emitter.js';

export const OWNER = 'Bondrudes21';
export const REPO = 'ishimura-archive';
export const BRANCH = 'main';
export const ROOT = 'content';

const DIR = 'content';
const STATE = 'state/content-state.json';

const KINDS = {
  stories: (m) => m.stories || [],
  gallery: (m) => (m.gallery && m.gallery.items) || [],
  codex: (m) => (m.codex && m.codex.entries) || [],
  timeline: (m) => m.timeline || [],
  music: (m) => m.music || [],
};

function emptyManifest() {
  return {
    schema: 1, revision: 0, updated: null,
    series: [], stories: [], gallery: { albums: [], items: [] },
    music: [], codex: { categories: [], entries: [] }, timeline: [], map: null, files: {},
  };
}

const safe = (rel) => {
  const parts = String(rel).split('/');
  if (!rel || parts.some((p) => p === '..' || p === '') || /^[a-z]+:/i.test(rel)) throw new Error(`Недопустимый путь: ${rel}`);
  return `${DIR}/${rel}`;
};

export class ContentService extends Emitter {
  constructor() {
    super();
    this.syncing = null;
    this.state = null;
    this.manifest = emptyManifest();
    this.ready = this.init();
  }

  async init() {
    this.state = (await vfs.readJson(STATE)) || {
      sha: null, lastSync: null, lastError: null, online: null,
      fileIndex: {}, unseen: { stories: [], gallery: [], codex: [], timeline: [], music: [] },
    };
    await this.ensureSeed();
    this.manifest = (await vfs.readJson(`${DIR}/manifest.json`)) || emptyManifest();
  }

  get dirUrl() { return vfs.url(`${DIR}/`); }

  saveState() { return vfs.writeJson(STATE, this.state); }

  // Первый запуск (или новая версия приложения со свежим встроенным архивом): копируем встроенный контент
  async ensureSeed() {
    let seed = null;
    try { seed = await (await fetch('content/manifest.json', { cache: 'no-store' })).json(); } catch { return; }
    const local = await vfs.readJson(`${DIR}/manifest.json`);
    if (local && (local.revision || 0) >= (seed.revision || 0)) return;
    for (const [rel, sha] of Object.entries(seed.files || {})) {
      if (this.state.fileIndex[rel] === sha && await vfs.exists(safe(rel))) continue;
      try {
        const res = await fetch(`content/${rel.split('/').map(encodeURIComponent).join('/')}`);
        if (!res.ok) continue;
        await vfs.write(safe(rel), new Uint8Array(await res.arrayBuffer()));
        this.state.fileIndex[rel] = sha;
      } catch { /* нет файла во встроенном архиве — скачается при синхронизации */ }
    }
    await vfs.writeJson(`${DIR}/manifest.json`, seed);
    await this.saveState();
  }

  async readText(rel) { return vfs.readText(safe(rel)); }

  status() {
    return {
      online: this.state.online,
      lastSync: this.state.lastSync,
      lastError: this.state.lastError,
      revision: this.manifest.revision || 0,
      syncing: !!this.syncing,
      unseen: this.state.unseen,
      source: `${OWNER}/${REPO}`,
    };
  }

  async markSeen(kind, ids) {
    const list = this.state.unseen[kind];
    if (!list) return;
    this.state.unseen[kind] = ids === '*' ? [] : list.filter((id) => !ids.includes(id));
    await this.saveState();
    this.emit('status', this.status());
  }

  async fetchRaw(url, headers = {}) {
    let res;
    try {
      res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined });
    } catch (e) {
      throw new Error(navigator.onLine === false ? 'Нет подключения к интернету' : 'Нет связи с GitHub');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res;
  }

  sync() {
    if (!this.syncing) {
      this.syncing = this.ready.then(() => this.doSync()).finally(() => {
        this.syncing = null;
        this.emit('status', this.status());
      });
      this.emit('status', this.status());
    }
    return this.syncing;
  }

  async doSync() {
    try {
      let sha = null;
      let base;
      try {
        const res = await this.fetchRaw(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`, { Accept: 'application/vnd.github.sha' });
        sha = (await res.text()).trim();
        base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${ROOT}/`;
      } catch (e) {
        // Лимит API или временная ошибка — идём напрямую в raw (там кэш до 5 минут)
        if (/HTTP 404/.test(e.message)) throw e;
        base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${ROOT}/`;
      }

      if (sha && sha === this.state.sha) return this.finish(true, null, { changed: false });

      const remote = await (await this.fetchRaw(`${base}manifest.json${sha ? '' : `?t=${Date.now()}`}`)).json();
      if ((remote.revision || 0) < (this.manifest.revision || 0)) return this.finish(true, null, { changed: false });

      const files = remote.files || {};
      const queue = [];
      for (const [rel, s] of Object.entries(files)) {
        if (this.state.fileIndex[rel] !== s || !(await vfs.exists(safe(rel)))) queue.push([rel, s]);
      }
      await this.downloadAll(base, queue);

      for (const rel of Object.keys(this.state.fileIndex)) {
        if (!(rel in files)) {
          try { await vfs.remove(safe(rel)); } catch {}
          delete this.state.fileIndex[rel];
        }
      }

      const added = await this.applyManifest(remote);
      this.state.sha = sha;
      return this.finish(true, null, { changed: true, added });
    } catch (e) {
      return this.finish(false, e.message, { changed: false });
    }
  }

  async downloadAll(base, queue) {
    let i = 0;
    const worker = async () => {
      while (i < queue.length) {
        const [rel, sha] = queue[i++];
        const url = base + rel.split('/').map(encodeURIComponent).join('/');
        const buf = new Uint8Array(await (await this.fetchRaw(url)).arrayBuffer());
        await vfs.write(safe(rel), buf);
        this.state.fileIndex[rel] = sha;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async applyManifest(next) {
    const prev = this.manifest;
    const added = {};
    for (const [kind, get] of Object.entries(KINDS)) {
      const old = new Set(get(prev).map((x) => x.id));
      const fresh = get(next).filter((x) => !old.has(x.id));
      added[kind] = fresh;
      const ids = new Set(get(next).map((x) => x.id));
      this.state.unseen[kind] = [...(this.state.unseen[kind] || []).filter((id) => ids.has(id)), ...fresh.map((x) => x.id)];
    }
    await vfs.writeJson(`${DIR}/manifest.json`, next);
    this.manifest = next;
    await this.saveState();
    this.emit('updated', { manifest: next, added });
    return added;
  }

  async finish(online, error, result) {
    this.state.online = online;
    this.state.lastError = error;
    if (online) this.state.lastSync = new Date().toISOString();
    await this.saveState();
    return { ...result, online, error };
  }
}
