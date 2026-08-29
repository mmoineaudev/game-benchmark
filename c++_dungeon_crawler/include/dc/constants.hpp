// dc/constants.hpp — the game's data contract.
// Port of ox-alpha_dungeon_crawler/src/core/Constants.js (spec v2 §4.1/§5–§23).
// Every number here is BINDING — the formula_check suite asserts on them.
#pragma once
#include <array>
#include <cmath>
#include <limits>
#include <numbers>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace dc {

namespace world {
constexpr int kCellSize = 6;
constexpr int kWallHeight = 20;
} // namespace world

namespace player {
constexpr double kRadius = 0.35;
constexpr double kBaseSpeed = 4.0;
constexpr double kSprintMult = 1.55;
constexpr double kSprintAccelWindow = 1.0; // s of consecutive sprint to gain a tier
constexpr double kSprintAccelStep = 0.05; //  +5% per tier
constexpr double kSprintAccelMax = 3.0; //  cap ×3 (multiplicative on the 1.55 base)
constexpr double kSensitivity = 0.002;
constexpr double kPitchClamp = std::numbers::pi * 85.0 / 180.0;
constexpr int kMaxHealthBase = 3;
constexpr double kRegenDelay = 8.0; // regen starts 8 s after last damage
constexpr double kRegenInterval = 6.0; // +1 heart / 6 s after the delay
constexpr double kInvulnTime = 0.8;
constexpr double kSafeSpawnTime = 5.0;
constexpr double kShakeTime = 0.25;
constexpr double kExitRoomDist2 = 4.0; // within 2 u of exit cell center
} // namespace player

namespace camera {
constexpr int kFov = 90;
constexpr double kSprintFovKick = 8.0;
constexpr double kNear = 0.1;
constexpr double kFar = 160.0;
} // namespace camera

namespace lighting {
constexpr double kAmbientIntensityStone = 0.55;
constexpr double kHeadlightIntensity = 1.0;
constexpr double kHeadlightDistance = 30.0;
constexpr double kHeadlightDecay = 1.05;
} // namespace lighting

namespace materials {
constexpr int kTextureRepeat = 2;
constexpr int kSurfaceSize = 256;
constexpr int kGlowSize = 64;
} // namespace materials

namespace dungeon {
constexpr int kGridMin = 12;
constexpr int kGridMax = 16;
constexpr int kRoomCount = 10;
constexpr int kRoomCountMin = 8;
constexpr int kMinRoomDist = 1; // JS DUNGEON.MIN_ROOM_DIST: 1 (cells of margin between rooms)
constexpr int kDeadEndMax = 4;
constexpr int kMaxAttempts = 200;
constexpr int kTorchSpacingLegacy = 16; // legacy/inert; real spacing lives in LightingSystem
constexpr double kArchProbability = 0.0; // legacy/inert — WorldBuilder builds no arches/cracks
constexpr double kCrackProbability = 0.0; // legacy/inert
} // namespace dungeon

// Room type definitions (§5). `biomes` null = 'all'.
struct RoomTypeDef {
  std::string id;
  int weight;
  int minSize;
  int maxSize;
  int hMax = -1; // optional; -1 = use maxSize
  std::vector<std::string> biomes; // empty = 'all'
};

inline const std::vector<RoomTypeDef> kRoomTypes = {
  {"CHAMBER", 40, 2, 3, -1, {}},
  {"HALL", 35, 1, 2, 1, {}},
  {"VAULT", 25, 3, 4, -1, {}},
  {"ARMORY", 10, 3, 3, -1, {"STONE", "VOLCANIC_DEPTHS", "GOLDEN_TEMPLE", "EMBER_FORGE"}},
  {"LIBRARY", 10, 3, 3, -1, {"STONE", "HAUNTED_CRYPT"}},
  {"CRYPT", 10, 2, 3, -1, {"HAUNTED_CRYPT"}},
  {"MUSHROOM_GROVE", 8, 2, 3, -1, {"FUNGAL_CAVERN", "POISON_SWAMP"}},
  {"ARENA", 6, 4, 4, -1, {}},
  {"CRYSTAL_CHAMBER", 8, 2, 3, -1, {"CRYSTAL_DEPTHS"}},
  {"TEMPLE", 8, 3, 3, -1, {"GOLDEN_TEMPLE"}},
};

// Palette values are FREE graphics (v2 ruling) — keys are the contract.
struct BiomeDef {
  int wall;
  int floor;
  int ceiling;
  int fog;
  double fogDensity;
  int ambient;
  double ambientIntensity;
  int torchColor;
  std::string label;
  std::string torchMode; // 'standard' | 'vaultOnly'
  std::vector<std::string> brazierRooms;
};

inline const std::unordered_map<std::string, BiomeDef> kBiomes = {
  {"STONE", {0x8a8074, 0x6e675c, 0x56504a, 0x0d0b08, 0.030, 0x40382c, 0.32, 0xff9a3c, "STONE DUNGEON", "standard", {"HALL"}}},
  {"HAUNTED_CRYPT", {0x6f7580, 0x585d68, 0x444852, 0x07090d, 0.034, 0x2a3340, 0.26, 0x7ab8d8, "HAUNTED CRYPT", "standard", {"HALL"}}},
  {"FUNGAL_CAVERN", {0x4a5a46, 0x39463a, 0x2b3630, 0x060b06, 0.032, 0x24352a, 0.22, 0x66ff99, "FUNGAL CAVERN", "vaultOnly", {"HALL"}}},
  {"VOLCANIC_DEPTHS", {0x5c4438, 0x453228, 0x33241c, 0x100502, 0.038, 0x38221a, 0.26, 0xff5a1e, "VOLCANIC DEPTHS", "standard", {"HALL"}}},
  {"FROZEN_HALLS", {0x9db8c8, 0x7d98aa, 0x607888, 0x0a1016, 0.033, 0x30485c, 0.30, 0x8ad0ff, "FROZEN HALLS", "standard", {"HALL"}}},
  {"CRYSTAL_DEPTHS", {0x6a5580, 0x534268, 0x3e3050, 0x0c0614, 0.032, 0x3a2850, 0.28, 0xb07aff, "CRYSTAL DEPTHS", "standard", {"HALL"}}},
  {"POISON_SWAMP", {0x4e563e, 0x3c4430, 0x2c3424, 0x080c05, 0.034, 0x26301e, 0.22, 0xaaff44, "POISON SWAMP", "vaultOnly", {"HALL"}}},
  {"GOLDEN_TEMPLE", {0xb89a5e, 0x94784a, 0x705a38, 0x120d04, 0.030, 0x48381c, 0.34, 0xffc84a, "GOLDEN TEMPLE", "standard", {"HALL"}}},
  {"FLOODED_RUINS", {0x5a7a72, 0x46605a, 0x344a44, 0x040b09, 0.033, 0x1e3830, 0.26, 0x4adfc8, "FLOODED RUINS", "standard", {"HALL"}}},
  {"EMBER_FORGE", {0x4a3c34, 0x382c26, 0x2a211c, 0x0e0603, 0.036, 0x301e14, 0.24, 0xff7a2a, "EMBER FORGE", "standard", {"HALL"}}},
  {"SPECTRAL_COURT", {0x585070, 0x443e58, 0x343044, 0x080612, 0.032, 0x2c2444, 0.28, 0xaa88ff, "SPECTRAL COURT", "standard", {"HALL"}}},
};

inline const std::vector<std::string> kBiomeSequence = {
  "STONE", "HAUNTED_CRYPT", "FUNGAL_CAVERN", "VOLCANIC_DEPTHS", "FROZEN_HALLS",
  "CRYSTAL_DEPTHS", "POISON_SWAMP", "GOLDEN_TEMPLE", "FLOODED_RUINS", "EMBER_FORGE"
};

namespace boss {
constexpr int kInterval = 7;
constexpr int kBaseHp = 25; // base boss HP at level 7, NG0, empty bank
constexpr double kHpLevelCap = 2.0; // level/NG+ pressure caps at ×2
constexpr double kAggroRange = 25.0; // the lord wakes when the player is seen within 25 u
constexpr double kChargeDmg = 2.0;
constexpr double kChargeSpeed = 14.0;
constexpr double kChargeTime = 0.9;
constexpr double kChargeRange = 14.0;
constexpr double kChargeCooldown = 3.2;
constexpr double kChargeFirstMult = 0.6;
constexpr double kContactRadius = 1.4;
constexpr double kBlinkCooldown = 8.0;
constexpr double kBlinkFirstMult = 0.5;
constexpr double kBlinkTelegraph = 1.0;
constexpr double kBlinkDmg = 3.0;
constexpr double kBlinkRadius = 3.0;
constexpr double kSmokeCooldown = 6.0;
constexpr double kSmokeFirstMult = 0.7;
constexpr double kSmokeFlight = 0.7;
constexpr double kSmokeSpeed = 10.0;
constexpr double kSmokeDuration = 4.0;
constexpr double kSmokeRadius = 2.2;
constexpr double kSmokeDmg = 1.0;
constexpr double kSummonInterval = 6.0;
constexpr double kSummonHeartsMult = 1.5;
constexpr int kMaxMinions = 10;
constexpr double kDriftSpeed = 2.2;
constexpr double kDriftKeep = 2.5;
constexpr double kRadius = 0.9;
} // namespace boss

inline const std::vector<std::string> kBossVariants = {
  "Skeleton", "Armored", "Archer", "Brute", "Wraith", "Rat", "Magician"
};
inline const std::unordered_map<std::string, std::string> kBossLabels = {
  {"Skeleton", "BONE LORD"}, {"Armored", "IRON GHOUL"}, {"Archer", "SPECTRAL HUNTER"},
  {"Brute", "ASH TITAN"}, {"Wraith", "SPECTRAL LORD"}, {"Rat", "VERMIN KING"}, {"Magician", "LICH ARCHMAGE"},
};

constexpr double kHeartsHpBonus = 0.1;
constexpr double kSoulsHpBonus = 0.25;

// Enemy HP multiplier (NG+ × level × linear overflow). §3/§16.1 — LINEAR overflow.
inline double enemyHpMultiplier(int ngPlus, int level, double souls) {
  return (1.0 + 3.0 * ngPlus) *
         (1.0 + std::floor(level / 10.0)) *
         (1.0 + 1.5 * std::floor(std::max(0.0, level + souls - 990.0) / 10.0));
}

// Boss HP. §17 — pressure capped at ×2, wealth stack halved. LINEAR overall.
inline int bossHp(int level, int ngPlus, double souls, int maxHealth) {
  const int heartsExtra = std::max(0, std::min(maxHealth - 3, 10));
  const double soulsPart = 1.0 + kSoulsHpBonus * std::floor(souls / 50.0);
  const double heartsPart = std::pow(1.0 + kHeartsHpBonus, heartsExtra);
  const double pressure = std::min((1.0 + 3.0 * ngPlus) * (1.0 + std::floor(level / 10.0)), boss::kHpLevelCap);
  const double wealth = 1.0 + (soulsPart * heartsPart - 1.0) / 2.0;
  return static_cast<int>(std::ceil(boss::kBaseHp * pressure * wealth));
}

// BURN HP — v2 ruling: 30 flat at NG0 every level, then ×(1 + 3·ngPlus).
inline int burnHp(int ngPlus) { return static_cast<int>(std::ceil(30.0 * (1.0 + 3.0 * ngPlus))); }

// Biome for a level — boss branch first, else the 2-level cyclic ladder. §7.
inline std::string biomeForLevel(int level) {
  if (level % boss::kInterval == 0) return "SPECTRAL_COURT";
  return kBiomeSequence[static_cast<size_t>((level - 1) / 2 % 10)];
}

// Per-biome room-type weight modifiers (×1 = none). §7.
inline const std::unordered_map<std::string, std::unordered_map<std::string, double>> kBiomeRoomModifiers = {
  {"STONE", {}},
  {"HAUNTED_CRYPT", {{"CRYPT", 3.0}, {"LIBRARY", 1.5}, {"ARMORY", 0.5}}},
  {"FUNGAL_CAVERN", {{"MUSHROOM_GROVE", 3.0}, {"VAULT", 0.7}}},
  {"VOLCANIC_DEPTHS", {{"ARMORY", 2.0}, {"CHAMBER", 0.8}}},
  {"FROZEN_HALLS", {{"VAULT", 1.5}, {"CHAMBER", 1.2}, {"MUSHROOM_GROVE", 0.0}}},
  {"CRYSTAL_DEPTHS", {{"CRYSTAL_CHAMBER", 3.0}, {"VAULT", 1.2}}},
  {"POISON_SWAMP", {{"MUSHROOM_GROVE", 2.5}, {"VAULT", 0.5}}},
  {"GOLDEN_TEMPLE", {{"TEMPLE", 3.0}, {"VAULT", 2.0}, {"ARMORY", 1.5}}},
  {"FLOODED_RUINS", {{"VAULT", 1.5}, {"CHAMBER", 1.2}}},
  {"EMBER_FORGE", {{"ARMORY", 2.5}, {"VAULT", 0.7}}},
  {"SPECTRAL_COURT", {}},
};

// Per-room enemy-type weight modifiers.
inline const std::unordered_map<std::string, std::unordered_map<std::string, double>> kRoomEnemyModifiers = {
  {"ARMORY", {{"ARMORED", 1.3}, {"ARCHER", 1.2}}},
  {"LIBRARY", {{"SKELETON", 1.0}, {"MAGICIAN", 0.0}, {"ARMORED", 0.0}, {"ARCHER", 0.0}, {"RAT", 0.0}, {"BRUTE", 0.0}, {"WRAITH", 0.0}}},
  {"CRYPT", {{"WRAITH", 1.4}, {"SKELETON", 1.2}}},
  {"MUSHROOM_GROVE", {{"RAT", 1.5}}},
  {"TEMPLE", {{"ARMORED", 1.2}}},
};

namespace renderer {
constexpr double kMaxPixelRatio = 2.0;
constexpr double kBloomStrength = 0.055;
constexpr double kBloomRadius = 0.5;
constexpr double kBloomThreshold = 0.5;
constexpr double kSaturation = 0.0175;
} // namespace renderer

namespace enemyGlow {
inline const std::array<double, 3> kBlurWeights = {0.227, 0.194, 0.121};
constexpr double kCompositeSharp = 0.5;
constexpr double kCompositeBlur = 1.6;
constexpr bool kHalfRes = true;
} // namespace enemyGlow

constexpr int kSmokeParticles = 9;
constexpr int kAmbientDustParticles = 30;
constexpr int kMaxRunes = 10; // JS RuneSystem: placed < 10

// Legacy per-type stat consts (kept for parity with the JS contract).
namespace skeletonStat { constexpr int kHp = 2; constexpr double kSpeed = 2.6; constexpr int kDmg = 1; constexpr double kRange = 1.6; }
namespace magicianStat { constexpr int kHp = 2; constexpr double kSpeed = 2.6; constexpr int kDmg = 1; constexpr double kCastRange = 9.0; constexpr double kOrbSpeed = 6.2; constexpr double kOrbLife = 4.0; constexpr double kOrbRadius = 0.3; constexpr double kStopFrac = 0.6; }
namespace armoredStat { constexpr int kHp = 5; constexpr double kSpeed = 1.8; constexpr int kDmg = 2; constexpr double kRange = 0.85; }
namespace archerStat { constexpr int kHp = 2; constexpr double kSpeed = 2.4; constexpr int kDmg = 1; constexpr double kRange = 10.0; constexpr double kKiteStop = 8.0; constexpr double kKiteRetreatUnder = 4.0; constexpr double kRetreatSpeed = 2.0; constexpr double kArrowSpeed = 8.0; constexpr double kArrowLife = 3.0; constexpr double kArrowRadius = 0.15; constexpr double kEliteFanDeg = 8.0; }
namespace ratStat { constexpr int kHp = 1; constexpr double kSpeed = 4.2; constexpr int kDmg = 1; constexpr double kRange = 0.9; constexpr int kPackMin = 2; constexpr int kPackMax = 3; constexpr int kCap = 6; }
namespace bruteStat { constexpr int kHp = 8; constexpr double kSpeed = 1.2; constexpr int kDmg = 3; constexpr double kRange = 2.4; constexpr double kConeRad = 0.87; }
namespace wraithStat { constexpr int kHp = 2; constexpr double kSpeed = 2.4; constexpr int kDmg = 1; constexpr double kRange = 0.9; }

struct EnemyCycle { double windup; double swing; double recover; double cooldown; };
struct EliteDef { std::string name; int hp; double speedMult; int drops; double scale = 1.0; double fanDeg = 0.0; };

struct EnemyTypeDef {
  int hp;
  double speed;
  int dmg;
  double range;
  bool ranged = false;
  std::string rangedKind; // 'orb' | 'arrow'
  double stopFrac = 0.0;
  double kiteStop = 0.0;
  double retreatUnder = 0.0;
  double retreatSpeed = 0.0;
  struct { double speed; double life; double radius; } projectile{8, 3, 0.15};
  EnemyCycle cycle{0.35, 0.25, 0.4, 1.2};
  int drops;
  bool instantAttack = false;
  double attackCooldown = 0.0;
  bool phases = false;
  bool shockwave = false;
  double coneRad = 0.0;
  std::array<int, 2> pack{};
  bool eliteEligible = false;
  std::optional<EliteDef> elite;
};

inline const std::unordered_map<std::string, EnemyTypeDef> kEnemyTypes = {
  {"SKELETON", {2, 2.6, 1, 1.6, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {0.35, 0.25, 0.4, 1.2}, 1, false, 0, false, false, 0, {}, false, std::nullopt}},
  {"MAGICIAN", {2, 2.6, 1, 9.0, true, "orb", 0.6, 0, 0, 0, {8, 3, 0.15}, {0.35, 0.25, 0.4, 1.2}, 1, false, 0, false, false, 0, {}, false, std::nullopt}},
  {"ARMORED", {5, 1.8, 2, 0.85, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {0.5, 0.3, 0.5, 1.6}, 2, false, 0, false, false, 0, {}, true, EliteDef{"Warlord", 10, 1.3, 3}}},
  {"ARCHER", {2, 2.4, 1, 10.0, true, "arrow", 0, 8, 4, 2.0, {8, 3, 0.15}, {0.5, 0.1, 0.4, 1.8}, 1, false, 0, false, false, 0, {}, true, EliteDef{"Sharpshooter", 2, 1.0, 2, 1.0, 8}}},
  {"RAT", {1, 4.2, 1, 0.9, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {0.35, 0.25, 0.4, 1.2}, 0, true, 0.8, false, false, 0, {2, 3}, false, std::nullopt}},
  {"BRUTE", {8, 1.2, 3, 2.4, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {1.2, 0.3, 1.2, 2.5}, 3, false, 0, false, true, 0.87, {}, true, EliteDef{"Ogre", 16, 1.2, 4, 1.9}}},
  {"WRAITH", {2, 2.4, 1, 0.9, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {0.35, 0.25, 0.4, 1.2}, 2, true, 1.0, true, false, 0, {}, true, EliteDef{"Banshee", 4, 1.4, 3}}},
  // BURN — final-foe ash wraith (§18): WRAITH shape but a MELEE cycle (no
  // phases/instant), range 1.3, drops 2, hp overridden to burnHp(ngPlus).
  {"BURN", {1, 2.6, 1, 1.3, false, "", 0, 0, 0, 0, {8, 3, 0.15}, {0.4, 0.25, 0.35, 1.4}, 2, false, 0, false, false, 0, {}, false, std::nullopt}},
};

// Spawn weights per biome (sum 100): Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith
struct SpawnWeights { int skeleton; int magician; int armored; int archer; int rat; int brute; int wraith; };
inline const std::unordered_map<std::string, SpawnWeights> kEnemySpawnWeights = {
  {"STONE", {45, 10, 15, 15, 10, 5, 0}},
  {"HAUNTED_CRYPT", {25, 10, 10, 15, 5, 5, 30}},
  {"FUNGAL_CAVERN", {30, 10, 10, 5, 40, 5, 0}},
  {"VOLCANIC_DEPTHS", {20, 10, 25, 15, 10, 20, 0}},
  {"FROZEN_HALLS", {25, 10, 20, 25, 10, 10, 0}},
  {"CRYSTAL_DEPTHS", {30, 15, 15, 20, 10, 10, 0}},
  {"POISON_SWAMP", {15, 10, 10, 10, 45, 10, 0}},
  {"GOLDEN_TEMPLE", {20, 10, 25, 20, 10, 15, 0}},
  {"FLOODED_RUINS", {20, 15, 10, 15, 25, 15, 0}},
  {"EMBER_FORGE", {10, 10, 25, 15, 5, 35, 0}},
  {"SPECTRAL_COURT", {40, 15, 15, 15, 5, 10, 0}},
};

constexpr double kEliteChance = 0.1;

namespace enemySpawn {
constexpr double kSpawnInterval = 0.5;
constexpr int kMaxAlive = 200;
constexpr int kSpawnCap = 100; // spawnMult capped at ×100
constexpr double kExcessHpPer10 = 1.5; // past cap: +150% HP per 10 excess (linear)
constexpr int kHardCap = 24; // planned-mob cap (§16.1) — excess slots convert to mob HP
constexpr double kExcessHpPer = 0.1; // each planned slot beyond HARD_CAP: +10% mob HP
constexpr int kLiveCap = 30; // hard live-body cap (mobs + boss minions)
constexpr double kSpawnPlayerDist = 30.0; // spawns only > 30 m from player
constexpr double kDeferPlayerDist = 30.0; // queued spawn within 30 m rotates back
constexpr double kFrozenDist = 40.0; // mobs > 40 m frozen immobile
constexpr int kBfsMinFromEntrance = 6;
constexpr double kPathReeval = 0.3;
constexpr double kSubstep = 0.08;
constexpr double kLosStep = 0.4;
constexpr double kLosRadius = 0.25;
} // namespace enemySpawn

// Speed/attack scaling. §16.1
constexpr double kSpeedPerLevel = 0.02;
constexpr double kAttackPer3Levels = 0.05;
constexpr double kBossKillBuff = 0.1;

namespace sword {
constexpr double kRange = 2.2;
constexpr double kElectricChance = 0.05; // kept at SWORD level (gotcha §27)
constexpr double kElectricDamageMult = 5.0;
constexpr double kElectricRange = 20.0;
constexpr int kArcPool = 8;
constexpr int kArcMaxFlight = 6;
constexpr double kArcSpeed = 24.0;
constexpr double kArcLife = 1.2;
constexpr double kArcTargetRange = 20.0;
constexpr double kHitStop = 0.06;
constexpr double kBladeFlash = 0.1;
} // namespace sword

struct ComboStep { double windup; double swing; double recover; int damage; double arcDot; bool thrust; double rangeMult = 1.0; };
// NOTE: explicit ComboStep{...} element braces — required to dodge a GCC 13 bug
// where std::array<Aggregate,N> nested-brace init reports "too many initializers".
inline const std::array<ComboStep, 3> kSwordCombo = {
  ComboStep{0.10, 0.16, 0.14, 2, std::cos(0.38 * std::numbers::pi), false, 1.0},
  ComboStep{0.08, 0.15, 0.14, 2, std::cos(0.38 * std::numbers::pi), false, 1.0},
  ComboStep{0.12, 0.18, 0.20, 3, std::cos(0.09 * std::numbers::pi), true, 1.25},
};
constexpr double kComboWindow = 0.34; // from each recover start
constexpr double kComboCooldown = 0.30;

namespace hitStop { constexpr double swordHit = 0.06; constexpr double electricChain = 0.12; constexpr double evolution = 0.1; }

namespace evolution {
inline const std::array<int, 5> kTierThresholds = {50, 100, 200, 400, 800};
inline const std::array<std::string, 6> kTierNames = {
  "Dagger", "Knight's Arming Sword", "Runic Greatsword", "Crystal Soulblade",
  "White-Hot Soulfire Greatblade", "Lightsaber"
};
inline const std::array<std::string, 6> kTierEffects = {
  "5% electric blast", "—", "—", "arc bolts 10%", "arc bolts 35%",
  "double arc bolts · idle crackle · electric blast"
};
} // namespace evolution

// weaponTier(souls): ceiling over thresholds. Pure.
inline int weaponTier(int souls) {
  int t = 0;
  for (size_t i = 0; i < evolution::kTierThresholds.size(); i++)
    if (souls >= evolution::kTierThresholds[i]) t = static_cast<int>(i) + 1;
  return t;
}
constexpr int kMaxTier = 5;

// Damage ladder: base per step + tier. Pure.
inline int swordHitDamage(int step, int tier) { return kSwordCombo[step].damage + tier; }

// damageMult composition: size part × tier part × level part. §9.2
inline double damageMult(double scale, int tier, int level) {
  return (1.0 + (scale - 1.0) * 0.5) * std::pow(1.1, tier) * std::pow(1.1, std::floor(level / 5.0));
}

// Sword SIZE ladder: tier-driven only (+80%/tier, ×5 at T5). Orbs never drive size. §9.2
constexpr double kMaxTotalScale = 5.0;
inline double swordSizeScale(int tier) { return 1.0 + 0.8 * tier; }

inline double totalSwordScale(int tier, double lengthMult = 1.0) {
  return std::min(swordSizeScale(tier) * lengthMult, kMaxTotalScale);
}

// Attack speed: buffs × souls component. §9.2
inline double attackSpeedFromSouls(double souls) { return 1.0 + 0.001 * souls; }

namespace orbWeapon {
constexpr double kStepInterval = 0.22;
constexpr double kSequenceWindow = 1.2;
constexpr double kSpeed = 12.4;
constexpr double kLife = 2.5;
constexpr double kRadius = 0.3;
constexpr int kBaseDamage = 2;
constexpr int kExplodeDamage = 5;
constexpr double kExplodeRadius = 2.0;
constexpr double kExplodeYGate = 2.6;
constexpr int kBounces = 3;
constexpr int kPoolNormal = 48;
constexpr int kPoolFireball = 6;
constexpr double kFireballCooldown = 0.35;
} // namespace orbWeapon

inline double orbDamageMultiplier(double orbs) { return 1.0 + 0.02 * orbs; }
inline int orbDirectDamage(double orbs) { return static_cast<int>(std::round(orbWeapon::kBaseDamage * orbDamageMultiplier(orbs))); }
inline int orbExplodeDamage(double orbs) { return static_cast<int>(std::round(orbWeapon::kExplodeDamage * orbDamageMultiplier(orbs))); }

// Arc bolt chances per tier (index by tier; 0-2 none). §9.3
inline const std::array<double, 6> kArcChance = {0, 0, 0, 0.10, 0.35, 1.0};
inline const std::array<int, 6> kArcBolts = {0, 0, 0, 1, 1, 2};

namespace buff {
constexpr double kChance = 0.06;
constexpr double kExcessOrbBonus = 0.0005; // +0.05% per orb above 100
constexpr int kExcessOrbThreshold = 100;
constexpr double kOrbDropChance = 0.20;
constexpr int kOrbDropMin = 1;
constexpr int kOrbDropMax = 5;
constexpr double kMaxDuration = 90.0;
constexpr double kBossDuration = 300.0;
constexpr int kCarryMult = 5;
} // namespace buff

namespace hunter {
constexpr int kHp = 9999;
constexpr double kFollowSpeed = 6.5;
constexpr double kKeepDist = 2.5;
constexpr double kAttackRange = 7.0;
constexpr int kBeamDmg = 2;
constexpr double kBeamFlash = 0.35;
} // namespace hunter

namespace drop {
constexpr double kVisualLife = 1.0;
constexpr double kHealthChance = 0.15;
constexpr int kHealthRestore = 3;
constexpr double kPickupRadius = 1.4;
constexpr double kOrbScatter = 0.8;  // soul orbs scatter ±0.4 around the drop point
constexpr int kOrbVisualPool = 24;   // JS OrbSystem visual pool size
} // namespace drop

namespace props {
constexpr int kMaxPerLevel = 400;
constexpr int kBreakablesPerRoom = 3;
constexpr int kBreakableHp = 1;
constexpr double kStepBreakDist = 0.45;
constexpr double kSarcophagusTrigger = 2.5;
constexpr double kSarcophagusWraith = 0.3;
constexpr double kDebrisPerCell = 0.2; // ~1/cell cut 80%
constexpr int kStalactites = 60;
constexpr int kWaterPools = 24;
} // namespace props

struct LightSource { double intensity; double distance; double decay; bool shadow; };
inline const std::unordered_map<std::string, LightSource> kLightSources = {
  {"TORCH", {0.9, 16.0, 1.15, false}},
  {"BRAZIER", {1.1, 18.0, 1.15, false}},
  {"CRYSTAL", {1.4, 14.0, 1.2, false}},
  {"MUSHROOM", {3.2, 12.0, 1.2, false}}, // binding §7.3
  {"MARKER_START", {1.0, 10.0, 1.4, false}},
  {"MARKER_EXIT", {1.6, 16.0, 1.3, false}},
  {"WISP", {1.0, 10.0, 1.3, false}},
  {"SWORD_EXTRA_T5", {0.9, 8.0, 1.4, false}},
};

namespace lightCeiling { constexpr int kAvg = 154; constexpr int kMax = 199; }
constexpr int kTorchShadowCount = 1;

constexpr double kLevelTimeLimit = 180.0; // TIMED_RUN.LEVEL_TIME_LIMIT

namespace hazard {
constexpr double kTick = 0.8;
constexpr int kDamage = 1;
constexpr double kInnerRadius = 1.2;
constexpr double kExitClearance = 3.0;
} // namespace hazard

constexpr int kLeaderboardSize = 10;
inline const std::string kSaveKey = "dungeonCrawlerSave";
inline const std::string kSaveServer = "http://localhost:5174";

} // namespace dc
