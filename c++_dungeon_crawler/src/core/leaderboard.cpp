// dc/leaderboard.cpp — file-backed top-10 (port of core/Leaderboard.js).
#include "dc/leaderboard.hpp"
#include "dc/constants.hpp"

#include <algorithm>
#include <fstream>
#include <sstream>

namespace dc {

// ---- minimal JSON (de)serialization for the entry array ----------------------
// Shape: [{"ngPlus":n,"level":n,"time":n,"orbs":n,"date":n}, ...]

static std::string serializeEntries(const std::vector<ScoreEntry>& es) {
  std::ostringstream os;
  os << '[';
  for (size_t i = 0; i < es.size(); i++) {
    const auto& e = es[i];
    if (i) os << ',';
    os << "{\"ngPlus\":" << e.ngPlus << ",\"level\":" << e.level
       << ",\"time\":" << e.time << ",\"orbs\":" << e.orbs
       << ",\"date\":" << e.date << "}";
  }
  os << ']';
  return os.str();
}

// Parse a (possibly empty) entry array. Tolerant: skips malformed objects,
// never throws. Returns false on a totally unreadable payload.
static bool parseEntries(const std::string& text, std::vector<ScoreEntry>& out) {
  out.clear();
  size_t i = 0;
  auto skipWs = [&]() { while (i < text.size() && (text[i]==' '||text[i]=='\t'||text[i]=='\n'||text[i]=='\r')) i++; };
  skipWs();
  if (i >= text.size() || text[i] != '[') return false;
  i++;
  while (true) {
    skipWs();
    if (i < text.size() && text[i] == ']') break;
    skipWs();
    if (i < text.size() && text[i] == ',') { i++; continue; }
    if (i >= text.size() || text[i] != '{') break;
    i++;
    ScoreEntry e;
    bool any = false;
    while (true) {
      skipWs();
      if (i < text.size() && text[i] == '}') { i++; break; }
      if (i < text.size() && text[i] == ',') { i++; continue; }
      // expect "key":value
      if (i >= text.size() || text[i] != '"') break;
      i++; // open quote
      std::string key;
      while (i < text.size() && text[i] != '"') { if (text[i]=='\\' && i+1<text.size()) i++; key.push_back(text[i]); i++; }
      if (i < text.size() && text[i] == '"') i++;
      skipWs();
      if (i < text.size() && text[i] == ':') i++;
      skipWs();
      // value: number
      size_t vs = i;
      if (i < text.size() && (text[i]=='-'||text[i]=='+')) i++;
      while (i < text.size() && (isdigit(static_cast<unsigned char>(text[i])) || text[i]=='.' || text[i]=='-' || text[i]=='+' || text[i]=='e' || text[i]=='E')) i++;
      std::string num = text.substr(vs, i - vs);
      if (key == "ngPlus") { e.ngPlus = num.empty() ? 0 : std::stoi(num); any = true; }
      else if (key == "level") { e.level = num.empty() ? 0 : std::stoi(num); }
      else if (key == "orbs") { e.orbs = num.empty() ? 0 : std::stoi(num); }
      else if (key == "date") { e.date = num.empty() ? 0 : std::stoll(num); }
      else if (key == "time") { e.time = num.empty() ? 0.0 : std::stod(num); }
    }
    if (any) out.push_back(e);
  }
  return true;
}

// ---- Leaderboard ----------------------------------------------------------------

Leaderboard::Leaderboard(std::string path) : path_(std::move(path)) {
  load();
}

void Leaderboard::load() {
  if (path_.empty()) return;
  std::ifstream in(path_);
  if (!in) return;
  std::ostringstream ss;
  ss << in.rdbuf();
  parseEntries(ss.str(), entries_);
}

void Leaderboard::persist() const {
  if (path_.empty()) return;
  std::ofstream out(path_, std::ios::trunc);
  if (!out) return; // private-mode equivalent: swallow write errors
  out << serializeEntries(entries_);
}

int Leaderboard::compare(const ScoreEntry& a, const ScoreEntry& b) {
  if (b.ngPlus != a.ngPlus) return b.ngPlus - a.ngPlus;
  if (b.level != a.level) return b.level - a.level;
  if (a.time != b.time) return static_cast<int>(a.time - b.time);
  return b.orbs - a.orbs;
}

void Leaderboard::submit(ScoreEntry e) {
  entries_.push_back(std::move(e));
  std::sort(entries_.begin(), entries_.end(),
             [](const ScoreEntry& a, const ScoreEntry& b) { return compare(a, b) < 0; });
  if (entries_.size() > static_cast<size_t>(kLeaderboardSize))
    entries_.resize(kLeaderboardSize);
  persist();
}

int Leaderboard::rankOf(const ScoreEntry& e) const {
  for (size_t i = 0; i < entries_.size(); i++) {
    const auto& x = entries_[i];
    if (x == e || (x.date == e.date && x.time == e.time)) return static_cast<int>(i) + 1;
  }
  return -1;
}

std::vector<ScoreEntry> Leaderboard::top() const {
  const size_t n = std::min(entries_.size(), static_cast<size_t>(kLeaderboardSize));
  return std::vector<ScoreEntry>(entries_.begin(), entries_.begin() + n);
}

} // namespace dc
