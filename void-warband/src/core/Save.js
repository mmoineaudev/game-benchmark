/**
 * Save.js — meta progression persistence in localStorage.
 * Key: `void_warband_meta`. JSON with validation; parse-failure falls back
 * to defaults silently (SPEC §7, §11).
 */
import { SAVE_KEY, UPGRADES, ITEMS } from './Constants.js';

/**
 * Default meta state.
 * @returns {object}
 */
export function defaultMeta() {
  const upgrades = {};
  for (const u of UPGRADES) upgrades[u.id] = 0;
  return {
    /** Banked scrap (persists across deaths). */
    scrap: 0,
    /** Owned ship ids (user feedback: 3 purchasable ships). */
    ownedShips: [],
    /** Active ship id (null = stock). */
    ship: null,
    /** Upgrade levels by upgrade id. */
    upgrades,
    /** Banked inventory: { itemId: count } (persists; mods equipable in hangar). */
    inventory: {},
    /** Discovered item ids (collection log). */
    discovered: [],
    /** Total kills (lifetime). */
    kills: 0,
    /** Total runs. */
    runs: 0,
    /** Distance reached, u (best ladder progress). */
    bestDistance: 0,
    /** Warden kills (lifetime; SPEC §5 sector 6 finale). */
    wardenKills: 0,
  };
}

/**
 * Validate/repair a parsed meta object; returns a clean meta state.
 * @param {unknown} raw
 * @returns {object} meta
 */
export function validateMeta(raw) {
  const meta = defaultMeta();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return meta;

  if (Number.isFinite(raw.scrap)) meta.scrap = Math.max(0, Math.floor(raw.scrap));

  if (Array.isArray(raw.ownedShips)) {
    meta.ownedShips = raw.ownedShips.filter((id) => typeof id === 'string');
  }
  if (typeof raw.ship === 'string') meta.ship = raw.ship;

  if (raw.upgrades && typeof raw.upgrades === 'object') {
    for (const u of UPGRADES) {
      const v = raw.upgrades[u.id];
      meta.upgrades[u.id] = Number.isInteger(v) ? Math.min(Math.max(v, 0), u.max) : 0;
    }
  }

  if (raw.inventory && typeof raw.inventory === 'object' && !Array.isArray(raw.inventory)) {
    for (const [id, count] of Object.entries(raw.inventory)) {
      const item = ITEMS.find((i) => i.id === id);
      if (item && Number.isFinite(count) && count > 0) {
        meta.inventory[id] = Math.min(Math.floor(count), 99999);
      }
    }
  }

  if (Array.isArray(raw.discovered)) {
    meta.discovered = raw.discovered.filter(
      (id) => typeof id === 'string' && ITEMS.some((i) => i.id === id),
    );
  }

  if (Number.isFinite(raw.kills)) meta.kills = Math.max(0, Math.floor(raw.kills));
  if (Number.isFinite(raw.runs)) meta.runs = Math.max(0, Math.floor(raw.runs));
  if (Number.isFinite(raw.bestDistance)) meta.bestDistance = Math.max(0, raw.bestDistance);
  if (Number.isFinite(raw.wardenKills)) {
    meta.wardenKills = Math.max(0, Math.floor(raw.wardenKills));
  }

  return meta;
}

/**
 * Load meta from localStorage; silent fallback to defaults on any failure.
 * @returns {object} meta
 */
export function loadMeta() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultMeta();
    return validateMeta(JSON.parse(raw));
  } catch {
    return defaultMeta();
  }
}

/**
 * Persist meta to localStorage; failures are silent (private mode, quota).
 * @param {object} meta
 * @returns {boolean} success
 */
export function saveMeta(meta) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(validateMeta(meta)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Wipe meta (fresh start).
 */
export function clearMeta() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
