/**
 * Leaderboard.js — localStorage-backed top-10 leaderboard (§23).
 * Entry: {level, time (total run seconds), orbs (banked at death), ngPlus, date}.
 * Ranking: ngPlus desc → level desc → total time asc → orbs desc.
 * Written on run end only.
 *
 * All localStorage access is guarded so it does not crash in headless Node;
 * an in-memory array is used as a fallback.
 */

const STORAGE_KEY = 'dungeonCrawlerLeaderboard';
const MAX_ENTRIES = 10;

export class Leaderboard {
  constructor(key = STORAGE_KEY) {
    this.key = key;
    this._mem = null; // in-memory fallback (headless)
  }

  _storageAvailable() {
    return typeof localStorage !== 'undefined';
  }

  _readRaw() {
    if (this._storageAvailable()) {
      try {
        const raw = localStorage.getItem(this.key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    }
    return this._mem ?? [];
  }

  _writeRaw(entries) {
    if (this._storageAvailable()) {
      try {
        localStorage.setItem(this.key, JSON.stringify(entries));
      } catch {
        /* quota/privacy errors: fall back to memory */
        this._mem = entries;
      }
    } else {
      this._mem = entries;
    }
  }

  /**
   * Insert an entry and trim to the top 10 by ranking.
   * @param {{level:number,time:number,orbs:number,ngPlus:number,date?:string}} entry
   */
  submit(entry) {
    const e = {
      level: entry.level ?? 0,
      time: entry.time ?? 0,
      orbs: entry.orbs ?? 0,
      ngPlus: entry.ngPlus ?? 0,
      date: entry.date ?? new Date().toISOString(),
    };
    const entries = [...this._readRaw(), e];
    entries.sort(Leaderboard.compare);
    this._writeRaw(entries.slice(0, MAX_ENTRIES));
  }

  /** @returns {Array} sorted leaderboard entries (best first). */
  load() {
    const entries = this._readRaw();
    entries.sort(Leaderboard.compare);
    return entries.slice(0, MAX_ENTRIES);
  }

  /**
   * Ranking comparator (§23): ngPlus desc → level desc → total time asc → orbs desc.
   */
  static compare(a, b) {
    if (b.ngPlus !== a.ngPlus) return b.ngPlus - a.ngPlus;
    if (b.level !== a.level) return b.level - a.level;
    if (a.time !== b.time) return a.time - b.time;
    return b.orbs - a.orbs;
  }

  // -----------------------------------------------------------------
  // F3 (C3): run save / load (§26 — "Save for later" / "Load last save").
  // One save slot, separate from the leaderboard key.
  // -----------------------------------------------------------------

  _saveKey() {
    return `${this.key}:save`;
  }

  /** Store a serialized GameState snapshot. Returns the stored object. */
  setSave(snapshot) {
    if (this._storageAvailable()) {
      try {
        localStorage.setItem(this._saveKey(), JSON.stringify(snapshot));
        return snapshot;
      } catch {
        this._memSave = snapshot;
        return snapshot;
      }
    }
    this._memSave = snapshot;
    return snapshot;
  }

  /** @returns {object|null} the stored snapshot, or null when absent/corrupt. */
  getSave() {
    if (this._storageAvailable()) {
      try {
        const raw = localStorage.getItem(this._saveKey());
        return raw ? JSON.parse(raw) : null;
      } catch {
        return this._memSave ?? null;
      }
    }
    return this._memSave ?? null;
  }
}
