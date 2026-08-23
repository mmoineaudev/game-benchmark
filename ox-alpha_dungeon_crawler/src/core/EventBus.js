// EventBus.js — tiny pub/sub (§4.4)
export default class EventBus {
  constructor() { this._map = new Map(); }

  on(evt, fn) {
    if (!this._map.has(evt)) this._map.set(evt, []);
    this._map.get(evt).push(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) {
    const arr = this._map.get(evt);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(evt, data) {
    const arr = this._map.get(evt);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) arr[i](data);
  }
}
