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

  // Rank: level desc, then total time asc (faster wins ties). Returns rank (1-based) or -1 if not top 10.
  add(level, timeSeconds) {
    const list = this.load();
    list.push({ level, time: Math.round(timeSeconds), date: Date.now() });
    list.sort((a, b) => b.level - a.level || a.time - b.time);
    const trimmed = list.slice(0, MAX_ENTRIES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* storage full/blocked */ }
    const idx = trimmed.findIndex(e => e.level === level && e.time === Math.round(timeSeconds));
    return idx === -1 ? -1 : idx + 1;
  }

  best() {
    return this.load()[0] || null;
  }
}
