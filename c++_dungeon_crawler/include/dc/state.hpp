// dc/state.hpp — serializable run state (§4.5). Port of core/GameState.js.
// Pure data + the sprint/buff helpers that Game.js drives each frame.
#pragma once
#include <optional>
#include <string>
#include <vector>

namespace dc {

// One point in the 2D world (the JS `player` / entity pos).
struct PlayerPos {
  double x = 0, y = 1.6, z = 0, yaw = 0, pitch = 0;
};

// Serializable run state. Field-for-field port of GameState.js so the
// save/load schema (toJSON/fromJSON) round-trips identically.
struct GameState {
  // ---- live player transform (not persisted; reset on load) ----
  PlayerPos player;

  // ---- THE ONE souls counter + derived weapon tier ----
  int collectedOrbs = 0; // souls
  int weaponTier = 0;    // recomputed from the bank when constructed
  int ngPlus = 0;
  int bossKills = 0;
  int totalOrbs = 0;

  // ---- health ----
  int health = 0;
  int maxHealth = 0; // self-heals to base + bossKills if stale/desynced
  double invulnTimer = 0;
  double safeSpawn = 0;

  // ---- world / run ----
  std::vector<std::string> visitedCells; // null → empty (JS null)
  int dungeonSeed = 0;
  bool effectsEnabled = true;
  bool minimapVisible = false; // legacy/unused
  bool pointerLocked = false;
  bool inExitRoom = false;
  double runTime = 0;
  int level = 1;
  double levelTime = 0;
  std::string biome = "STONE";
  int biomeIndex = 0;

  // ---- combat / feel ----
  int swordCombo = 0;
  double hitStop = 0;
  double sprintHoldTime = 0;
  int sprintTier = 0;
  int buffEffect = 0; // 0..5
  double buffTime = 0;

  // Buff names, index by buffEffect (0 = none). Mirrors GameState.BUFF_NAMES.
  static const char* const kBuffNames[6];

  // Constructor from optional run fields (mirrors `new GameState(opts)`).
  static GameState fromOpts(int collectedOrbs = 0, int weaponTier = -1,
                            int ngPlus = 0, int bossKills = 0,
                            int maxHealth = -1, double runTime = 0,
                            int level = 1);

  // applyBuff: never the same buff twice in a row (caller enforces via roll).
  void applyBuff(int effect, double time);
  // updateBuff: returns true the frame the buff EXPIRES (so the caller can
  // clear its visual), false otherwise.
  bool updateBuff(double dt);
  // updateSprint: accrue sprint tiers over consecutive held sprint.
  void updateSprint(double dt, bool sprinting, bool moving, bool safeSpawnActive);
  // sprintSpeedMult: SPRINT_MULT * (1 + STEP*tier), capped at ACCEL_MAX.
  double sprintSpeedMult() const;
  // the accel component only (HUD readout).
  double sprintMult() const;

  // ---- save/load schema (mirror toJSON / fromJSON) ----
  struct Save {
    int level;
    double runTime;
    int collectedOrbs;
    int weaponTier;
    int maxHealth;
    int ngPlus;
    int bossKills;
    int health;
  };
  Save toSave() const;
  // Returns nullopt if `json` is null/invalid (mirrors `return null`).
  static std::optional<GameState> fromSave(const Save& s);
};

} // namespace dc
