// dc/state.cpp — GameState (port of core/GameState.js).
#include "dc/state.hpp"
#include "dc/constants.hpp"

namespace dc {

const char* const GameState::kBuffNames[6] = {
  nullptr, "BRIGHT", "FIREBALL", "EMPOWERED", "GODSPEED", "HUNTER"
};

GameState GameState::fromOpts(int collectedOrbs, int weaponTier, int ngPlus,
                              int bossKills, int maxHealth, double runTime, int level) {
  GameState s;
  s.player = {0, 1.6, 0, 0, 0};
  s.collectedOrbs = collectedOrbs;
  s.weaponTier = (weaponTier >= 0) ? weaponTier : dc::weaponTier(s.collectedOrbs);
  s.ngPlus = ngPlus;
  s.bossKills = bossKills;
  s.totalOrbs = 0;
  s.health = (maxHealth >= 0) ? maxHealth : player::kMaxHealthBase;
  const int healedMax = player::kMaxHealthBase + bossKills;
  s.maxHealth = std::max((maxHealth >= 0) ? maxHealth : 0, healedMax);
  s.invulnTimer = 0;
  s.safeSpawn = 0;
  s.dungeonSeed = 0;
  s.effectsEnabled = true;
  s.minimapVisible = false;
  s.pointerLocked = false;
  s.inExitRoom = false;
  s.runTime = runTime;
  s.level = level;
  s.levelTime = 0;
  s.biome = "STONE";
  s.biomeIndex = 0;
  s.swordCombo = 0;
  s.hitStop = 0;
  s.sprintHoldTime = 0;
  s.sprintTier = 0;
  s.buffEffect = 0;
  s.buffTime = 0;
  return s;
}

void GameState::applyBuff(int effect, double time) {
  this->buffEffect = effect;
  this->buffTime = time;
}

bool GameState::updateBuff(double dt) {
  if (this->buffEffect > 0) {
    this->buffTime -= dt;
    if (this->buffTime <= 0) {
      this->buffEffect = 0;
      this->buffTime = 0;
      return true;
    }
  }
  return false;
}

void GameState::updateSprint(double dt, bool sprinting, bool moving, bool safeSpawnActive) {
  if (!sprinting || !moving || safeSpawnActive) {
    this->sprintHoldTime = 0;
    this->sprintTier = 0;
    return;
  }
  this->sprintHoldTime += dt;
  while (this->sprintHoldTime >= player::kSprintAccelWindow) {
    this->sprintHoldTime -= player::kSprintAccelWindow;
    this->sprintTier += 1;
  }
}

double GameState::sprintSpeedMult() const {
  const double m = player::kSprintMult *
                   (1.0 + player::kSprintAccelStep * this->sprintTier);
  return std::min(m, player::kSprintAccelMax);
}

double GameState::sprintMult() const {
  return 1.0 + player::kSprintAccelStep * this->sprintTier;
}

GameState::Save GameState::toSave() const {
  return Save{this->level, this->runTime, this->collectedOrbs, this->weaponTier,
              this->maxHealth, this->ngPlus, this->bossKills, this->health};
}

std::optional<GameState> GameState::fromSave(const Save& s) {
  // mirror fromJSON: clamp to the same ranges the JS loader applies.
  const int level = s.level > 0 ? s.level : 1;
  const double runTime = s.runTime >= 0 ? s.runTime : 0;
  const int collectedOrbs = s.collectedOrbs > 0 ? s.collectedOrbs : 0;
  int weaponTier = s.weaponTier < 0 ? 0 : std::min(5, s.weaponTier);
  const int maxHealth = std::max(player::kMaxHealthBase, s.maxHealth < 0 ? 0 : s.maxHealth);
  const int ngPlus = s.ngPlus > 0 ? s.ngPlus : 0;
  const int bossKills = s.bossKills > 0 ? s.bossKills : 0;
  GameState st = fromOpts(collectedOrbs, weaponTier, ngPlus, bossKills, maxHealth,
                          runTime, level);
  st.health = st.maxHealth; // loading restarts the level fresh & full
  return st;
}

} // namespace dc
