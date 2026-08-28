// dc/leaderboard.hpp — top-10 rankings (§23). Port of core/Leaderboard.js.
// localStorage becomes a JSON file (the save-server equivalent). Same
// ranking order: NG+ desc → level desc → time asc → orbs desc.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace dc {

struct ScoreEntry {
  int ngPlus = 0;
  int level = 0;
  double time = 0;
  int orbs = 0;
  std::int64_t date = 0; // ms epoch (Date.now() equivalent)
  bool operator==(const ScoreEntry& o) const {
    return ngPlus == o.ngPlus && level == o.level && time == o.time &&
           orbs == o.orbs && date == o.date;
  }
};

class Leaderboard {
public:
  // path: the JSON file backing store ("" = in-memory only, e.g. tests).
  explicit Leaderboard(std::string path = "");

  // Same ordering as Leaderboard.compare (static, pure).
  static int compare(const ScoreEntry& a, const ScoreEntry& b);

  // Push + re-rank + trim to LEADERBOARD_SIZE + persist.
  void submit(ScoreEntry e);

  // 1-based rank of `entry` (matched by identity or date+time), or -1.
  int rankOf(const ScoreEntry& e) const;

  // Top N (≤ LEADERBOARD_SIZE).
  std::vector<ScoreEntry> top() const;

  const std::vector<ScoreEntry>& entries() const { return entries_; }

private:
  std::vector<ScoreEntry> entries_;
  std::string path_;
  void load();
  void persist() const;
};

} // namespace dc
