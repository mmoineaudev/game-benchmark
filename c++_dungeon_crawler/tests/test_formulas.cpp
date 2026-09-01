// Port of scripts/formula-check.mjs — pure-function checks over constants.hpp.
// Guarantees every formula is bit-identical to the JS contract.
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <string>
#include <set>

#include "dc/constants.hpp"

using namespace dc;

TEST_CASE("evolution: tier thresholds + 11-point ceiling table", "[formula]") {
  CHECK(evolution::kTierThresholds == std::array<int, 5>{50, 100, 200, 400, 800});
  // 11 points: 0, 49, 50, 99, 100, 199, 200, 399, 400, 799, 800
  const int souls[] = {0, 49, 50, 99, 100, 199, 200, 399, 400, 799, 800};
  const int tiers[] = {0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5};
  for (int i = 0; i < 11; i++) CHECK(weaponTier(souls[i]) == tiers[i]);
  CHECK(weaponTier(100000) == 5); // capped at MAX_TIER
  CHECK(kMaxTier == 5);
}

TEST_CASE("sword: damage ladder 2/2/3 base, +tier, size scale, combo windows", "[formula]") {
  CHECK(swordHitDamage(0, 0) == 2);
  CHECK(swordHitDamage(1, 0) == 2);
  CHECK(swordHitDamage(2, 0) == 3);
  CHECK(swordHitDamage(2, 5) == 8); // 3 + T5
  CHECK(swordSizeScale(0) == Catch::Approx(1.0));
  CHECK(swordSizeScale(5) == Catch::Approx(5.0));
  CHECK(totalSwordScale(5, 1.0) == Catch::Approx(kMaxTotalScale)); // capped
  CHECK(totalSwordScale(5, 2.0) == Catch::Approx(kMaxTotalScale)); // still capped
  CHECK(kComboWindow == Catch::Approx(0.34));
  CHECK(kComboCooldown == Catch::Approx(0.30));
  // combo steps
  CHECK(kSwordCombo[0].damage == 2);
  CHECK(kSwordCombo[1].damage == 2);
  CHECK(kSwordCombo[2].damage == 3);
  CHECK(kSwordCombo[2].thrust);
  CHECK(kSwordCombo[2].rangeMult == Catch::Approx(1.25));
  CHECK(sword::kElectricChance == Catch::Approx(0.05));
}

TEST_CASE("sword: attackSpeedFromSouls", "[formula]") {
  CHECK(attackSpeedFromSouls(0) == Catch::Approx(1.0));
  CHECK(attackSpeedFromSouls(100) == Catch::Approx(1.1));
  CHECK(attackSpeedFromSouls(1000) == Catch::Approx(2.0));
}

TEST_CASE("sword: soul weapon-damage bonus (+1% per 10 souls, stepped)", "[formula]") {
  // Stepped: 9 souls → +0%, 10 → +1%, 99 → +9%, 100 → +10%.
  CHECK(weaponSoulBonus(0) == Catch::Approx(1.0));
  CHECK(weaponSoulBonus(9) == Catch::Approx(1.0));
  CHECK(weaponSoulBonus(10) == Catch::Approx(1.01));
  CHECK(weaponSoulBonus(99) == Catch::Approx(1.09));
  CHECK(weaponSoulBonus(100) == Catch::Approx(1.10));
  CHECK(weaponSoulBonus(1000) == Catch::Approx(2.0));
  // damageMult composes the soul part on top of size × tier × level.
  CHECK(damageMult(1.0, 0, 0) == Catch::Approx(1.0)); // default souls = 0
  CHECK(damageMult(1.0, 0, 0, 100) == Catch::Approx(1.10));
  CHECK(damageMult(2.0, 1, 10, 100) == Catch::Approx(1.5 * 1.1 * 1.21 * 1.1));
  CHECK(damageMult(2.0, 1, 10, 5) == Catch::Approx(1.5 * 1.1 * 1.21)); // 5 < 10 → no step
}

TEST_CASE("orb: damage multiplier + direct/explode", "[formula]") {
  CHECK(orbDamageMultiplier(0) == Catch::Approx(1.0));
  CHECK(orbDamageMultiplier(100) == Catch::Approx(3.0)); // 1 + 0.02*100
  CHECK(orbDirectDamage(0) == 2);
  CHECK(orbDirectDamage(100) == 6); // round(2 * 3.0)
  CHECK(orbExplodeDamage(0) == 5);
  CHECK(orbExplodeDamage(100) == 15); // round(5 * (1 + 0.02 * 100)) = 5 * 3
  CHECK(orbWeapon::kPoolNormal == 48);
  CHECK(orbWeapon::kPoolFireball == 6);
}

TEST_CASE("orb: explosion + electric constants", "[formula]") {
  CHECK(orbWeapon::kExplodeDamage == 5);
  CHECK(orbWeapon::kExplodeRadius == Catch::Approx(2.0));
  CHECK(sword::kElectricDamageMult == Catch::Approx(5.0));
  CHECK(sword::kElectricRange == Catch::Approx(20.0));
  CHECK(sword::kArcPool == 8);
  CHECK(sword::kArcMaxFlight == 6);
  CHECK(sword::kArcSpeed == Catch::Approx(24.0));
}

TEST_CASE("arc: chance/bolts per tier", "[formula]") {
  CHECK(kArcChance == std::array<double, 6>{0, 0, 0, 0.10, 0.35, 1.0});
  CHECK(kArcBolts == std::array<int, 6>{0, 0, 0, 1, 1, 2});
}

TEST_CASE("boss: base HP 25 + level cap + halved wealth/hearts stack", "[formula]") {
  // Level 7, NG0, empty bank, base health → base 25.
  CHECK(bossHp(7, 0, 0, 3) == 25);
  // Deep level caps pressure at ×2 (level-100 boss = 2× a level-7 boss, not 11×).
  CHECK(bossHp(100, 0, 0, 3) == 50);
  // NG+ pressure also caps at ×2 combined.
  CHECK(bossHp(7, 1, 0, 3) == 50); // (1+3)*... capped → 2
  // Wealth: souls stack, halved.
  // souls=50 → soulsPart=1.25 → wealth=(1.25-1)/2+1=1.125 → ceil(25*1.125)=29
  CHECK(bossHp(7, 0, 50, 3) == 29);
  // Hearts: maxHealth 13 → heartsExtra=10 → heartsPart=1.1^10≈2.5937 →
  // wealth=(1*2.5937-1)/2+1≈1.7968 → ceil(25*1.7968)=45
  CHECK(bossHp(7, 0, 0, 13) == 45);
  // burnHp: 30 flat NG0, ×(1+3·ngPlus)
  CHECK(burnHp(0) == 30);
  CHECK(burnHp(1) == 120);
  CHECK(burnHp(2) == 210);
}

TEST_CASE("enemy: HP multiplier linear overflow", "[formula]") {
  CHECK(enemyHpMultiplier(0, 7, 0) == Catch::Approx(1.0));
  CHECK(enemyHpMultiplier(0, 10, 0) == Catch::Approx(2.0)); // 1 + floor(10/10)
  CHECK(enemyHpMultiplier(1, 10, 0) == Catch::Approx(8.0)); // 4 * 2
  // Linear overflow past 990:
  CHECK(enemyHpMultiplier(0, 1000, 0) == Catch::Approx((1.0) * (1 + 100) * (1 + 1.5 * floor((1000 - 990) / 10.0))));
  CHECK(enemyHpMultiplier(0, 1100, 0) == Catch::Approx(111.0 * (1 + 1.5 * 11.0))); // 1942.5
}

TEST_CASE("biome: spawn weights sum to 100 per biome", "[formula]") {
  for (const auto& [biome, w] : kEnemySpawnWeights) {
    const int sum = w.skeleton + w.magician + w.armored + w.archer + w.rat + w.brute + w.wraith;
    INFO("biome=" + biome);
    CHECK(sum == 100);
  }
  CHECK(kEnemySpawnWeights.size() == 11); // all 11 biomes present
}

TEST_CASE("biome: per-biome eligible room weight >= 100 (pool non-empty)", "[formula]") {
  // For every biome, the eligible room pool (after modifiers) must be non-empty
  // with positive total weight — otherwise generation would stall.
  for (const auto& [biome, mods] : kBiomeRoomModifiers) {
    double total = 0;
    int eligible = 0;
    for (const auto& rt : kRoomTypes) {
      if (!rt.biomes.empty() && std::find(rt.biomes.begin(), rt.biomes.end(), biome) == rt.biomes.end())
        continue;
      double w = rt.weight;
      auto it = mods.find(rt.id);
      if (it != mods.end()) w *= it->second;
      if (w <= 0) continue;
      total += w;
      eligible++;
    }
    INFO("biome=" + biome + " eligible=" + std::to_string(eligible) + " total=" + std::to_string(total));
    CHECK(eligible >= 1);
    CHECK(total > 0);
  }
}

TEST_CASE("biome: sequence + boss interval + biomeForLevel", "[formula]") {
  CHECK(kBiomeSequence.size() == 10);
  CHECK(boss::kInterval == 7);
  // Boss branch first.
  CHECK(biomeForLevel(7) == "SPECTRAL_COURT");
  CHECK(biomeForLevel(14) == "SPECTRAL_COURT");
  // Else 2-level cyclic ladder.
  CHECK(biomeForLevel(1) == "STONE");
  CHECK(biomeForLevel(2) == "STONE");
  CHECK(biomeForLevel(3) == "HAUNTED_CRYPT");
  CHECK(biomeForLevel(4) == "HAUNTED_CRYPT");
  CHECK(biomeForLevel(5) == "FUNGAL_CAVERN");
  CHECK(biomeForLevel(6) == "FUNGAL_CAVERN");
  // floor((15-1)/2)=7 → kBiomeSequence[7] = GOLDEN_TEMPLE
  CHECK(biomeForLevel(15) == "GOLDEN_TEMPLE");
  CHECK(biomeForLevel(16) == "GOLDEN_TEMPLE"); // idx 7 too? floor(15/2)=7
  CHECK(biomeForLevel(17) == "FLOODED_RUINS"); // idx 8
  CHECK(biomeForLevel(18) == "FLOODED_RUINS");
  CHECK(biomeForLevel(19) == "EMBER_FORGE"); // idx 9
  CHECK(biomeForLevel(20) == "EMBER_FORGE");
}

TEST_CASE("world + player + camera binding values", "[formula]") {
  CHECK(world::kCellSize == 6);
  CHECK(world::kWallHeight == 20);
  CHECK(player::kRadius == Catch::Approx(0.35));
  CHECK(player::kBaseSpeed == Catch::Approx(4.0));
  CHECK(player::kSprintMult == Catch::Approx(1.55));
  CHECK(player::kSprintAccelStep == Catch::Approx(0.05));
  CHECK(player::kSprintAccelMax == Catch::Approx(3.0));
  CHECK(player::kMaxHealthBase == 3);
  CHECK(player::kRegenDelay == Catch::Approx(8.0));
  CHECK(player::kRegenInterval == Catch::Approx(6.0));
  CHECK(player::kInvulnTime == Catch::Approx(0.8));
  CHECK(camera::kFov == 90);
  CHECK(camera::kNear == Catch::Approx(0.1));
  CHECK(camera::kFar == Catch::Approx(160.0));
}

TEST_CASE("dungeon constants binding values", "[formula]") {
  CHECK(dungeon::kGridMin == 12);
  CHECK(dungeon::kGridMax == 16);
  CHECK(dungeon::kRoomCount == 10);
  CHECK(dungeon::kRoomCountMin == 8);
  CHECK(dungeon::kMinRoomDist == 1);
  CHECK(dungeon::kDeadEndMax == 4);
  CHECK(dungeon::kMaxAttempts == 200);
}

TEST_CASE("enemy spawn constants binding values", "[formula]") {
  CHECK(enemySpawn::kSubstep == Catch::Approx(0.08));
  CHECK(enemySpawn::kLosStep == Catch::Approx(0.4));
  CHECK(enemySpawn::kLosRadius == Catch::Approx(0.25));
  CHECK(enemySpawn::kSpawnPlayerDist == Catch::Approx(30.0));
  CHECK(enemySpawn::kLiveCap == 30);
  CHECK(enemySpawn::kHardCap == 24);
  CHECK(kSpeedPerLevel == Catch::Approx(0.02));
  CHECK(kAttackPer3Levels == Catch::Approx(0.05));
  CHECK(kBossKillBuff == Catch::Approx(0.1));
  CHECK(kEliteChance == Catch::Approx(0.1));
}

TEST_CASE("lighting budgets binding values", "[formula]") {
  CHECK(lightCeiling::kAvg == 154);
  CHECK(lightCeiling::kMax == 199);
  CHECK(kTorchShadowCount == 1);
  CHECK(kLightSources.at("MUSHROOM").intensity == Catch::Approx(3.2)); // binding §7.3
  CHECK(kLightSources.at("TORCH").intensity == Catch::Approx(0.9));
  CHECK(kLightSources.at("BRAZIER").intensity == Catch::Approx(1.1));
}

TEST_CASE("props pools binding values", "[formula]") {
  CHECK(props::kMaxPerLevel == 400);
  CHECK(props::kStalactites == 60);
  CHECK(props::kWaterPools == 24);
  CHECK(kSmokeParticles == 9);
  CHECK(kAmbientDustParticles == 30);
}

TEST_CASE("renderer + enemy glow constants", "[formula]") {
  CHECK(renderer::kBloomStrength == Catch::Approx(0.055));
  CHECK(renderer::kBloomRadius == Catch::Approx(0.5));
  CHECK(renderer::kBloomThreshold == Catch::Approx(0.5));
  CHECK(renderer::kSaturation == Catch::Approx(0.0175));
  CHECK(enemyGlow::kBlurWeights == std::array<double, 3>{0.227, 0.194, 0.121});
  CHECK(enemyGlow::kHalfRes);
}

TEST_CASE("hit-stop + damage mult composition", "[formula]") {
  CHECK(hitStop::swordHit == Catch::Approx(0.06));
  CHECK(hitStop::electricChain == Catch::Approx(0.12));
  CHECK(hitStop::evolution == Catch::Approx(0.1));
  // damageMult(scale, tier, level): (1+(scale-1)*0.5) * 1.1^tier * 1.1^floor(level/5)
  CHECK(damageMult(1.0, 0, 0) == Catch::Approx(1.0));
  CHECK(damageMult(2.0, 0, 0) == Catch::Approx(1.5));
  CHECK(damageMult(1.0, 1, 0) == Catch::Approx(1.1));
  CHECK(damageMult(1.0, 0, 5) == Catch::Approx(1.1));
  CHECK(damageMult(2.0, 1, 10) == Catch::Approx(1.5 * 1.1 * 1.21)); // floor(10/5)=2 → 1.1²
}

TEST_CASE("boss variants + labels", "[formula]") {
  CHECK(kBossVariants.size() == 7);
  CHECK(kBossLabels.at("Skeleton") == "BONE LORD");
  CHECK(kBossLabels.at("Magician") == "LICH ARCHMAGE");
}

TEST_CASE("hunter + drop + hazard + timed run", "[formula]") {
  CHECK(hunter::kHp == 9999);
  CHECK(hunter::kFollowSpeed == Catch::Approx(6.5));
  CHECK(hunter::kBeamDmg == 3);
  CHECK(hunter::kMaxBeamTargets == 5);
  CHECK(drop::kHealthChance == Catch::Approx(0.15));
  CHECK(drop::kHealthRestore == 3);
  CHECK(drop::kPickupRadius == Catch::Approx(1.4));
  CHECK(hazard::kTick == Catch::Approx(0.8));
  CHECK(hazard::kInnerRadius == Catch::Approx(1.2));
  CHECK(hazard::kExitClearance == Catch::Approx(3.0));
  CHECK(kLevelTimeLimit == Catch::Approx(180.0));
  CHECK(kLeaderboardSize == 10);
}

TEST_CASE("drop: soul-drop rate scales with the soul bank (+10% per 50 souls)", "[formula]") {
  CHECK(buff::kOrbDropChance == Catch::Approx(0.20));
  CHECK(buff::kDropRateSoulsPerStep == 50);
  CHECK(buff::kDropRatePerStep == Catch::Approx(0.10));
  // Stepped: 0-49 → ×1.0, 50-99 → ×1.1, 100-149 → ×1.2, 200-249 → ×1.4.
  CHECK(buff::orbDropChance(0) == Catch::Approx(0.20));
  CHECK(buff::orbDropChance(49) == Catch::Approx(0.20));
  CHECK(buff::orbDropChance(50) == Catch::Approx(0.22));
  CHECK(buff::orbDropChance(99) == Catch::Approx(0.22));
  CHECK(buff::orbDropChance(100) == Catch::Approx(0.24));
  CHECK(buff::orbDropChance(200) == Catch::Approx(0.28));
  CHECK(buff::kOrbDropMin == 1);
  CHECK(buff::kOrbDropMax == 5);
}
