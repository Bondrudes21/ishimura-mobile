// Плеер аудиокниг: один на всё приложение.
// Android — нативный плеер (Media3) со всей книгой как плейлистом: играет при выключенном экране,
// сам переходит к следующей главе и показывает кнопки на экране блокировки.
// Сайт/iPhone — обычный <audio> + Media Session (кнопки на экране блокировки iOS).
import { state, libAudioById, libUrl } from './state.js';
import { toCoverData } from './bookfmt.js';
import { isNative, Ark } from './platform/env.js';
import { vfs } from './platform/vfs.js';

const listeners = new Set();
let saveT = null;
let sleepT = null;
let lastEmit = 0;
const emitThrottled = () => { const now = Date.now(); if (now - lastEmit > 400) { lastEmit = now; player.emit(); } };
const scheduleSave = () => { if (!saveT) saveT = setTimeout(() => { saveT = null; player.saveNow(); }, 5000); };

// ---------- Движок: <audio> ----------
function htmlEngine() {
  const audio = new Audio();
  audio.preload = 'metadata';
  const eng = {
    get time() { return audio.currentTime || 0; },
    get duration() { return audio.duration || 0; },
    get playing() { return !audio.paused && !audio.ended; },
    get rate() { return audio.playbackRate; },
    set rate(v) { audio.playbackRate = v; },
    get volume() { return audio.volume; },
    set volume(v) { audio.volume = v; },
    loadBook(book, track, time, autoplay) { eng.setTrack(book, track, time, autoplay); },
    setTrack(book, i, time, autoplay) {
      audio.src = book.tracks[i].url;
      audio.playbackRate = book.speed || 1;
      audio.addEventListener('loadedmetadata', () => {
        if (time) audio.currentTime = Math.min(time, (audio.duration || time + 1) - 0.5);
        if (autoplay) audio.play().catch(() => {});
      }, { once: true });
    },
    play() { audio.play().catch(() => {}); },
    pause() { audio.pause(); },
    seek(t) { audio.currentTime = t; },
    close() { audio.pause(); audio.removeAttribute('src'); audio.load(); },
  };
  audio.addEventListener('timeupdate', () => { emitThrottled(); scheduleSave(); });
  audio.addEventListener('play', () => player.emit());
  audio.addEventListener('pause', () => player.emit());
  audio.addEventListener('loadedmetadata', () => onDuration(player.track, audio.duration));
  audio.addEventListener('ended', () => onTrackEnded());
  audio.addEventListener('error', () => player.emit());
  return eng;
}

// ---------- Движок: нативный плеер Android ----------
function nativeEngine() {
  const st = { index: 0, position: 0, duration: 0, playing: false, at: performance.now(), rate: 1, volume: 1 };
  let loadedBook = null;
  const path = (t) => vfs.abs(`library/${t.file}`);
  const eng = {
    // Позиция между событиями досчитывается по часам — полоска прогресса идёт плавно
    get time() { return st.playing ? st.position + ((performance.now() - st.at) / 1000) * st.rate : st.position; },
    get duration() { return st.duration > 0 ? st.duration : 0; },
    get playing() { return st.playing; },
    get rate() { return st.rate; },
    set rate(v) { st.rate = v; Ark.audioRate({ rate: v }); },
    get volume() { return st.volume; },
    set volume(v) { st.volume = v; Ark.audioVolume({ volume: v }); },
    loadBook(book, track, time, autoplay) {
      loadedBook = book.id;
      Object.assign(st, { index: track, position: time || 0, duration: 0, playing: false, at: performance.now(), rate: book.speed || 1 });
      Ark.audioLoad({
        tracks: book.tracks.map((t) => ({ path: path(t), title: t.title })),
        index: track, position: time || 0, rate: book.speed || 1, play: !!autoplay,
        title: book.title, artist: book.author || '',
        cover: book.cover ? vfs.abs(`library/${String(book.cover).split('?')[0]}`) : null,
      });
    },
    setTrack(book, i, time, autoplay) {
      if (loadedBook !== book.id) { eng.loadBook(book, i, time, autoplay); return; }
      Object.assign(st, { index: i, position: time || 0, duration: 0, at: performance.now() });
      Ark.audioTrack({ index: i, position: time || 0, play: !!autoplay });
    },
    play() { Ark.audioPlay(); },
    pause() { st.position = eng.time; st.playing = false; Ark.audioPause(); },
    seek(t) { Object.assign(st, { position: t, at: performance.now() }); Ark.audioSeek({ position: t }); },
    close() { loadedBook = null; st.playing = false; Ark.audioStop(); },
  };
  Ark.addListener('audio', (s) => {
    const wasPlaying = st.playing;
    const changedTrack = s.index !== st.index;
    Object.assign(st, { index: s.index, position: s.position, duration: s.duration, playing: s.playing, at: performance.now() });
    if (!player.book) return;
    if (changedTrack && s.index >= 0 && s.index < player.book.tracks.length) {
      // Нативный плеер сам перешёл к следующей главе
      player.track = s.index;
      updateSession();
      player.saveNow();
    }
    if (s.duration > 0) onDuration(s.index, s.duration);
    if (s.ended) { onTrackEnded(true); return; }
    if (s.error) console.warn('Плеер:', s.error);
    if (wasPlaying !== s.playing || changedTrack) player.emit(); else emitThrottled();
    if (s.playing) scheduleSave();
  });
  return eng;
}

const engine = isNative ? nativeEngine() : htmlEngine();

function onDuration(i, d) {
  const b = player.book;
  if (!b || !d || !isFinite(d)) return;
  const t = b.tracks[i];
  if (t && !t.duration) {
    t.duration = d;
    const total = b.tracks.every((x) => x.duration) ? b.tracks.reduce((a, x) => a + x.duration, 0) : null;
    window.ark.library.update('audio', b.id, { tracks: b.tracks, duration: total });
  }
  player.emit();
}

// Конец главы (сайт) или конец всей книги (Android сам листает главы)
function onTrackEnded(bookEnd = false) {
  if (player.sleep.mode === 'chapter') {
    player.sleep = { mode: 'off', until: 0 };
    if (isNative && !bookEnd) engine.pause();
    player.saveNow(); player.emit();
    return;
  }
  if (!bookEnd && player.book && player.track < player.book.tracks.length - 1) player.setTrack(player.track + 1, 0, true);
  else if (player.book) {
    window.ark.library.update('audio', player.book.id, { finished: true, position: { track: 0, time: 0 } });
    player.emit();
  }
}

export const player = {
  book: null,
  track: 0,
  sleep: { mode: 'off', until: 0 },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach((fn) => { try { fn(player); } catch {} }); },

  get playing() { return engine.playing; },
  get time() { return engine.time; },
  get duration() { return engine.duration || (this.cur && this.cur.duration) || 0; },
  get cur() { return this.book ? this.book.tracks[this.track] : null; },
  get speed() { return engine.rate; },

  totals() {
    if (!this.book) return { pos: 0, total: 0 };
    const tr = this.book.tracks;
    let pos = 0;
    for (let i = 0; i < this.track; i++) pos += tr[i].duration || 0;
    pos += this.time;
    const total = tr.every((t) => t.duration) ? tr.reduce((a, t) => a + t.duration, 0) : 0;
    return { pos, total };
  },

  load(id, { autoplay = true, track, time } = {}) {
    const b = libAudioById(id);
    if (!b) return;
    if (this.book && this.book.id === id && track == null) { if (autoplay) this.play(); return; }
    this.saveNow();
    this.book = b;
    const p = b.position || { track: 0, time: 0 };
    this.track = Math.max(0, Math.min(b.tracks.length - 1, track ?? p.track ?? 0));
    engine.loadBook(b, this.track, time ?? p.time ?? 0, autoplay);
    updateSession();
    this.emit();
  },

  setTrack(i, time = 0, autoplay = true) {
    if (!this.book) return;
    this.track = Math.max(0, Math.min(this.book.tracks.length - 1, i));
    engine.setTrack(this.book, this.track, time, autoplay);
    updateSession();
    this.emit();
  },

  play() { if (this.book) engine.play(); },
  pause() { engine.pause(); this.saveNow(); this.emit(); },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) { engine.seek(Math.max(0, Math.min(this.duration - 0.2, t))); this.emit(); },
  skip(s) {
    const t = this.time + s;
    if (t < 0 && this.track > 0) { this.setTrack(this.track - 1, 0, this.playing); return; }
    if (this.duration && t > this.duration && this.track < this.book.tracks.length - 1) { this.setTrack(this.track + 1, 0, this.playing); return; }
    this.seek(t);
  },
  next() { if (this.book && this.track < this.book.tracks.length - 1) this.setTrack(this.track + 1, 0, true); },
  prev() { if (this.time > 5) this.seek(0); else if (this.track > 0) this.setTrack(this.track - 1, 0, true); },
  setSpeed(v) {
    engine.rate = v;
    if (this.book) { this.book.speed = v; window.ark.library.update('audio', this.book.id, { speed: v }); }
    this.emit();
  },

  // Таймер сна: минуты или «до конца главы»
  setSleep(mode) {
    clearTimeout(sleepT);
    if (!mode || mode === 'off') this.sleep = { mode: 'off', until: 0 };
    else if (mode === 'chapter') this.sleep = { mode: 'chapter', until: 0 };
    else {
      const ms = Number(mode) * 60 * 1000;
      this.sleep = { mode: 'time', until: Date.now() + ms };
      sleepT = setTimeout(() => fadeOutAndPause(), ms);
    }
    this.emit();
  },

  addBookmark(note = '') {
    if (!this.book) return;
    const bm = { id: crypto.randomUUID().slice(0, 8), track: this.track, time: Math.floor(this.time), note, at: new Date().toISOString() };
    this.book.bookmarks = [...(this.book.bookmarks || []), bm];
    window.ark.library.update('audio', this.book.id, { bookmarks: this.book.bookmarks });
    this.emit();
    return bm;
  },
  removeBookmark(id) {
    this.book.bookmarks = (this.book.bookmarks || []).filter((b) => b.id !== id);
    window.ark.library.update('audio', this.book.id, { bookmarks: this.book.bookmarks });
    this.emit();
  },

  saveNow() {
    if (!this.book) return;
    clearTimeout(saveT);
    saveT = null;
    const position = { track: this.track, time: Math.floor(this.time) };
    this.book.position = position;
    window.ark.library.update('audio', this.book.id, { position, lastPlayed: new Date().toISOString() });
  },

  close() {
    this.pause();
    this.book = null;
    engine.close();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    this.emit();
  },
};

function fadeOutAndPause() {
  const v0 = engine.volume;
  let k = 1;
  const step = setInterval(() => {
    k -= 0.05;
    engine.volume = Math.max(0, v0 * k);
    if (k <= 0) { clearInterval(step); player.pause(); engine.volume = v0; player.sleep = { mode: 'off', until: 0 }; player.emit(); }
  }, 150);
}

// Кнопки на экране блокировки (сайт/iPhone). На Android их показывает нативный плеер.
const artCache = new Map();
async function artwork(b) {
  if (!b.cover) return [];
  if (!artCache.has(b.cover)) {
    try { artCache.set(b.cover, await toCoverData(libUrl(b.cover), 512)); } catch { artCache.set(b.cover, null); }
  }
  const src = artCache.get(b.cover);
  return src ? [{ src, sizes: '512x512', type: 'image/jpeg' }] : [];
}

async function updateSession() {
  if (isNative || !('mediaSession' in navigator) || !player.book) return;
  const b = player.book;
  const meta = { title: player.cur ? player.cur.title : b.title, artist: b.author || '', album: b.title };
  navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: await artwork(b) });
}
if (!isNative && 'mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  set('play', () => player.play());
  set('pause', () => player.pause());
  set('seekbackward', () => player.skip(-30));
  set('seekforward', () => player.skip(30));
  set('previoustrack', () => player.prev());
  set('nexttrack', () => player.next());
}

addEventListener('beforeunload', () => player.saveNow());
// Ушли из приложения — сразу запоминаем место
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') player.saveNow(); });

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function refreshPlayerBook() {
  if (!player.book) return;
  const fresh = (state.library.audio || []).find((a) => a.id === player.book.id);
  if (fresh) { fresh.position = player.book.position; player.book = fresh; updateSession(); }
  else player.close();
}
