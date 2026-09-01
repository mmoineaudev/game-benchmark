// dc/drop_system.cpp — breakables/sarcophagi/drops (port of PropSystem +
// OrbSystem + Game._breakProp/_tickBreakables/_tickSarcophagi/_onEnemyKilled).
#include "dc/drop_system.hpp"

#include <algorithm>
#include <cmath>

namespace dc {

void DropSystem::buildLevel(const Dungeon& d, Rng& rng) {
  clear();
  const double cs = d.cellSize;
  int propCount = 0;
  for (const auto& room : d.rooms) {
    const double cx = (room.cx + (room.w - 1) / 2.0) * cs;
    const double cz = (room.cz + (room.h - 1) / 2.0) * cs;
    const double rw = room.w * cs * 0.4;
    const double rh = room.h * cs * 0.4;
    // CRYPT sarcophagus (one per room; collision box the app merges in).
    if (room.type == "CRYPT") {
      const double sx = cx + (rng.next() - 0.5) * rw;
      const double sz = cz + (rng.next() - 0.5) * rh;
      sarcophagi_.push_back({{sx, sz}, false,
                            {sx - 0.55, sx + 0.55, sz - 1.15, sz + 1.15}});
      propCount++;
    }
    // breakables (barrels/crates) in every room except HALL: 1-3, capped.
    if (room.type != "HALL") {
      const int nb = 1 + (int)std::floor(rng.next() * props::kBreakablesPerRoom);
      for (int i = 0; i < nb && propCount < props::kMaxPerLevel; i++) {
        const double bx = cx + (rng.next() - 0.5) * rw * 2.0;
        const double bz = cz + (rng.next() - 0.5) * rh * 2.0;
        breakables_.push_back({{bx, bz}, true});
        propCount++;
      }
    }
  }
}

void DropSystem::update(double dt, const Vec2& playerPos) {
  // auto-collect: within PICKUP_RADIUS (y-gate 2.2 always true at eye 1.6).
  for (size_t i = pickups_.size(); i-- > 0;) {
    const auto& p = pickups_[i];
    const double dx = p.pos.x - playerPos.x;
    const double dz = p.pos.z - playerPos.z;
    if (dx * dx + dz * dz < drop::kPickupRadius * drop::kPickupRadius) {
      if (p.kind == 0) {
        if (onHealthCollected) onHealthCollected();
      } else {
        if (onBuffCollected) onBuffCollected(p.pos);
      }
      pickups_.erase(pickups_.begin() + i);
    }
  }
  // bob + orb-visual life (pickups are erased above; bob is cosmetic).
  for (auto& p : pickups_) p.bob += dt * 3.0;
  for (auto& v : orbVisuals_)
    if (v.t >= 0) { v.t += dt; if (v.t >= drop::kVisualLife) v.t = -1; }
}

void DropSystem::tickBreakables(const Vec2& playerPos, double souls, Rng& rng) {
  for (auto& b : breakables_) {
    if (!b.alive) continue;
    const double dx = b.pos.x - playerPos.x;
    const double dz = b.pos.z - playerPos.z;
    if (dx * dx + dz * dz < props::kStepBreakDist * props::kStepBreakDist)
      breakProp(b, souls, rng);
  }
}

void DropSystem::tickSarcophagi(const Vec2& playerPos) {
  for (auto& s : sarcophagi_) {
    if (s.opened) continue;
    const double dx = s.pos.x - playerPos.x;
    const double dz = s.pos.z - playerPos.z;
    if (dx * dx + dz * dz < props::kSarcophagusTrigger * props::kSarcophagusTrigger) {
      s.opened = true;
      if (onSarcophagusOpened) onSarcophagusOpened(s);
    }
  }
}

void DropSystem::spawnOrbs(double x, double z, int n, Rng& rng) {
  for (int i = 0; i < n; i++) {
    // JS _onEnemyKilled scatter: pos ±0.4. Credit is instant (orbs ARE souls).
    const double ox = x + (rng.next() - 0.5) * drop::kOrbScatter;
    const double oz = z + (rng.next() - 0.5) * drop::kOrbScatter;
    if (onOrbCollected) onOrbCollected();
    spawnOrbVisual(ox, oz);
  }
}

void DropSystem::spawnHealth(double x, double z, Rng& rng) {
  pickups_.push_back({{x, z}, 0, rng.next() * 6.0});
}
void DropSystem::spawnBuff(double x, double z, Rng& rng) {
  pickups_.push_back({{x, z}, 1, rng.next() * 6.0});
}

void DropSystem::breakProp(Breakable& br, double souls, Rng& rng) {
  if (!br.alive) return;
  br.alive = false;
  const double bonus = souls > buff::kExcessOrbThreshold
                           ? (souls - buff::kExcessOrbThreshold) * buff::kExcessOrbBonus
                           : 0.0;
  if (rng.next() < buff::kChance + bonus) {
    spawnBuff(br.pos.x, br.pos.z, rng);
  } else if (rng.next() < buff::orbDropChance((int)souls)) {
    const int n = buff::kOrbDropMin +
                  (int)std::floor(rng.next() * (buff::kOrbDropMax - buff::kOrbDropMin + 1));
    for (int i = 0; i < n; i++) {
      const double ox = br.pos.x + (rng.next() - 0.5) * 1.2;
      const double oz = br.pos.z + (rng.next() - 0.5) * 1.2;
      if (onOrbCollected) onOrbCollected();
      spawnOrbVisual(ox, oz);
    }
  }
}

void DropSystem::spawnOrbVisual(double x, double z) {
  const int i = nextVisual_++ % drop::kOrbVisualPool;
  orbVisuals_[i] = {{x, z}, 0.0};
}

void DropSystem::clear() {
  breakables_.clear();
  sarcophagi_.clear();
  pickups_.clear();
  hazards_.clear();
  hazardAccum_ = 0.0;
  for (auto& v : orbVisuals_) v.t = -1;
  nextVisual_ = 0;
}

std::vector<Breakable>& DropSystem::breakables() { return breakables_; }
const std::vector<Breakable>& DropSystem::breakables() const { return breakables_; }
std::vector<Sarcophagus>& DropSystem::sarcophagi() { return sarcophagi_; }
const std::vector<Sarcophagus>& DropSystem::sarcophagi() const { return sarcophagi_; }
const std::vector<DropPickup>& DropSystem::pickups() const { return pickups_; }
const std::vector<DropOrbVisual>& DropSystem::orbVisuals() const { return orbVisuals_; }
const std::vector<Hazard>& DropSystem::hazards() const { return hazards_; }
std::vector<Hazard>& DropSystem::hazards() { return hazards_; }
int DropSystem::livePickupCount() const { return (int)pickups_.size(); }

// ---- hazards (lava/acid) — PropSystem.build hazard block + Game._tickHazards ----

// lava: VOLCANIC_DEPTHS/EMBER_FORGE; acid: POISON_SWAMP; else none.
static bool hazardKindFor(const std::string& biomeId, int& kind) {
  if (biomeId == "VOLCANIC_DEPTHS" || biomeId == "EMBER_FORGE") { kind = 0; return true; }
  if (biomeId == "POISON_SWAMP") { kind = 1; return true; }
  return false;
}

void DropSystem::buildHazards(const Dungeon& d, const std::string& biomeId, Rng& rng) {
  int kind = 0;
  if (!hazardKindFor(biomeId, kind)) return; // biome without hazards: no-op
  const double cs = d.cellSize;
  const double ex = d.exitCell ? d.exitCell->x * cs : 0.0;
  const double ez = d.exitCell ? d.exitCell->z * cs : 0.0;
  for (const auto& room : d.rooms) {
    const double cx = (room.cx + (room.w - 1) / 2.0) * cs;
    const double cz = (room.cz + (room.h - 1) / 2.0) * cs;
    const double rw = room.w * cs * 0.4;
    const double rh = room.h * cs * 0.4;
    // no hazards in the exit room (JS: roomContains(room, exitCell)).
    if (d.exitCell) {
      const auto& e = *d.exitCell;
      if (e.x >= room.cx && e.x < room.cx + room.w && e.z >= room.cz && e.z < room.cz + room.h)
        continue;
    }
    const int nh = 1 + (rng.next() < 0.5 ? 1 : 0); // 1-2 per room
    for (int i = 0; i < nh; i++) {
      const double hx = cx + (rng.next() - 0.5) * rw * 1.6;
      const double hz = cz + (rng.next() - 0.5) * rh * 1.6;
      // never within EXIT_CLEARANCE (3 u) of the exit marker.
      const double ddx = hx - ex, ddz = hz - ez;
      if (ddx * ddx + ddz * ddz < hazard::kExitClearance * hazard::kExitClearance) continue;
      hazards_.push_back({{hx, hz}, kind, 1.0 + rng.next() * 0.6});
    }
  }
}

void DropSystem::tickHazards(double dt, const Vec2& playerPos) {
  hazardAccum_ += dt;
  if (hazardAccum_ < hazard::kTick) return;
  hazardAccum_ = 0.0;
  for (const auto& h : hazards_) {
    const double dx = playerPos.x - h.pos.x;
    const double dz = playerPos.z - h.pos.z;
    if (dx * dx + dz * dz < hazard::kInnerRadius * hazard::kInnerRadius) {
      if (onHazardHit) onHazardHit(hazard::kDamage); // i-frames in the app
      break; // first hazard hit wins (JS `break`)
    }
  }
}

} // namespace dc
