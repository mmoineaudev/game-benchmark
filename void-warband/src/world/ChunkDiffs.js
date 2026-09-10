/**
 * ChunkDiffs.js — Minecraft-style chunk persistence (player mutations only).
 *
 * Chunk generation is fully deterministic (mulberry32 seeded by the world
 * seed + chunk coords), so a reloaded chunk rebuilds identically. Instead of
 * storing whole chunks, we persist only the DIFF: ids of destructible records
 * the player destroyed (crystals, mines, breakable props, hulk wrecks).
 * On materialize, records whose id is in the diff are pruned, so the world
 * keeps the player's damage across chunk unload/reload and game restarts.
 *
 * Storage: localStorage (single JSON key, debounced writes; the data is a
 * few KB even after hours of play — ids are short strings).
 */

const STORAGE_KEY = 'vw.chunkDiffs.v1';

/** @type {Map<string, Set<string>>} chunkKey → destroyed local ids. */
const _diffs = new Map();
let _dirty = false;
let _flushTimer = null;

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const chunkKey of Object.keys(obj)) {
      _diffs.set(chunkKey, new Set(obj[chunkKey]));
    }
  } catch {
    // Corrupt or unavailable storage: start with a clean diff map.
  }
}

function _flush() {
  _dirty = false;
  try {
    const obj = {};
    for (const [k, set] of _diffs) {
      if (set.size > 0) obj[k] = [...set];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Storage full/unavailable: persistence degrades to session-only.
  }
}

function _scheduleFlush() {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_dirty) _flush();
  }, 1000);
}

_load();

/**
 * True when the record `localId` in `chunkKey` was destroyed by the player.
 * @param {string} chunkKey
 * @param {string|number} localId
 * @returns {boolean}
 */
export function isDestroyed(chunkKey, localId) {
  const set = _diffs.get(chunkKey);
  return set ? set.has(String(localId)) : false;
}

/**
 * Record a player destruction (persisted, debounced write).
 * @param {string} chunkKey
 * @param {string|number} localId
 */
export function markDestroyed(chunkKey, localId) {
  if (!chunkKey || localId === undefined || localId === null) return;
  let set = _diffs.get(chunkKey);
  if (!set) {
    set = new Set();
    _diffs.set(chunkKey, set);
  }
  set.add(String(localId));
  _scheduleFlush();
}

/**
 * Forget every diff (debug / new-universe). Applies on the next regenerate —
 * currently loaded chunks keep their state until unloaded.
 */
export function resetAll() {
  _diffs.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/** Flush pending writes immediately (visibilitychange / restart safety). */
export function flush() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_dirty) _flush();
}

/** Number of chunks with recorded diffs (debug). */
export function chunkCount() {
  let n = 0;
  for (const s of _diffs.values()) if (s.size > 0) n++;
  return n;
}
