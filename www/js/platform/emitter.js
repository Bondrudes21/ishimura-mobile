// Мини-аналог EventEmitter из Node: on возвращает функцию отписки
export class Emitter {
  constructor() { this._ev = new Map(); }
  on(type, fn) {
    if (!this._ev.has(type)) this._ev.set(type, new Set());
    this._ev.get(type).add(fn);
    return () => this._ev.get(type).delete(fn);
  }
  emit(type, payload) {
    for (const fn of this._ev.get(type) || []) { try { fn(payload); } catch (e) { console.error(e); } }
  }
}
