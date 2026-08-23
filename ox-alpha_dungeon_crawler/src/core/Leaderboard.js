// Leaderboard.js — localStorage top-10 rankings (§23)
import { LEADERBOARD_SIZE } from './Constants.js';

const KEY = 'dungeonCrawlerLeaderboard';

export default class Leaderboard {
  constructor() {
    try { this.entries = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { this.entries = []; }
  }

  // Ranking: NG+ desc → level desc → time asc → orbs desc
  static compare(a, b) {
    if (b.ngPlus !== a.ngPlus) return b.ngPlus - a.ngPlus;
    if (b.level !== a.level) return b.level - a.level;
    if (a.time !== b.time) return a.time - b.time;
    return b.orbs - a.orbs;
  }

  submit(entry) {
    this.entries.push({ ...entry, date: Date.now() });
    this.entries.sort(Leaderboard.compare);
    this.entries = this.entries.slice(0, LEADERBOARD_SIZE);
    try { localStorage.setItem(KEY, JSON.stringify(this.entries)); } catch { /* private mode */ }
  }

  rankOf(entry) {
    const idx = this.entries.findIndex(e => e === entry || (e.date === entry.date && e.time === entry.time));
    return idx >= 0 ? idx + 1 : null;
  }

  top() { return this.entries.slice(0, LEADERBOARD_SIZE); }
}
