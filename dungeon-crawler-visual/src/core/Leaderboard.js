const STORAGE_KEY = 'dungeonCrawlerLeaderboard';
const MAX_ENTRIES = 10;

export class Leaderboard {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  // Rank: NG+ level desc (a deeper NG+ cycle outranks any base level), then
  // level desc, then total time asc (faster wins ties), then orbs desc.
  // Returns rank (1-based) or -1 if not top 10.
  add(level, timeSeconds, orbs = 0, ngPlus = 0) {
    const list = this.load();
    list.push({ level, time: Math.round(timeSeconds), orbs, ngPlus: ngPlus || 0, date: Date.now() });
    list.sort((a, b) =>
      (b.ngPlus || 0) - (a.ngPlus || 0)
      || b.level - a.level
      || a.time - b.time
      || b.orbs - a.orbs);
    const trimmed = list.slice(0, MAX_ENTRIES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* storage full/blocked */ }
    const idx = trimmed.findIndex(e =>
      e.level === level && e.time === Math.round(timeSeconds) && e.orbs === orbs
      && (e.ngPlus || 0) === (ngPlus || 0));
    return idx === -1 ? -1 : idx + 1;
  }

  best() {
    return this.load()[0] || null;
  }

  // Wipe the leaderboard (rankings are stored in localStorage).
  clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  }

  // Remove the FIRST entry matching level/time/orbs/ngPlus. Used when a saved
  // run is loaded and continues — the death entry recorded for it is stale.
  remove({ level, time, orbs, ngPlus }) {
    const list = this.load();
    const idx = list.findIndex(e =>
      e.level === level && e.time === Math.round(time) && e.orbs === orbs
      && (e.ngPlus || 0) === (ngPlus || 0));
    if (idx === -1) return false;
    list.splice(idx, 1);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
    return true;
  }
}
