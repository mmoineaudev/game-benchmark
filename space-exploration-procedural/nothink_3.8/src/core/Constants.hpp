#pragma once
// Void Drift — all magic numbers (source of numeric truth). See 03-technical-specification §2.
#include "Math.hpp"

namespace VD {

// ---- Ship (§2.1) ----
constexpr int   MAX_HEALTH = 100;
constexpr float HEALTH_REGEN_PERCENT_PER_SEC = 0.02f;
constexpr float DAMAGE_INVULNERABILITY = 0.75f;
constexpr float SHIELD_RADIUS = 22.0f;
constexpr float SHIELD_DEFLECT_POWER = 60.0f;
constexpr float SHIELD_COOLDOWN = 1.0f;
constexpr float SHIP_ACCELERATION = 44.0f;
constexpr float MAX_SHIP_SPEED = 88.0f;
constexpr float SHIP_DRAG = 0.98f;
constexpr float SHIP_ROLL_SPEED = 3.0f;
constexpr float MOUSE_LOOK_SPEED = 0.0025f;
constexpr float KEYBOARD_PITCH_SPEED = 1.5f;
constexpr float PITCH_LIMIT = 1.2f;
constexpr Vec3  SHIP_SPAWN = Vec3(0.0f, 2.0f, 0.0f);
constexpr float CAMERA_DISTANCE = 6.0f;
constexpr float CAMERA_HEIGHT = 3.0f;
constexpr float CAMERA_FOV_REST = 75.0f;
constexpr float CAMERA_FOV_MAX = 95.0f;
constexpr float CAMERA_DAMPING = 5.0f;
constexpr float HEADLIGHT_INTENSITY = 6.5f;
constexpr float HEADLIGHT_RANGE = 95.0f;
constexpr float HEADLIGHT_ANGLE = 0.7f;
constexpr float SHIP_RADIUS = 2.0f;

// ---- World (§2.2) ----
constexpr float CHUNK_SIZE = 200.0f;
constexpr int   CHUNKS_RADIUS = 1;
constexpr float CHUNKS_CLEANUP_RADIUS = 1.6f;
constexpr int   CHUNKS_SPAWN_PER_FRAME = 3;
constexpr float CONTENT_Y_BAND = 100.0f;
constexpr float DENSITY_REDUCTION = 0.55f;
constexpr float INSTANCE_CULL_RADIUS = 460.0f;

// ---- Weapon (§2.3) ----
constexpr float FIRE_RATE = 6.0f;
constexpr float PROJECTILE_SPEED = 200.0f;
constexpr float PROJECTILE_LIFETIME = 1.5f;
constexpr float PROJECTILE_RANGE = 200.0f;
constexpr int   PROJECTILE_DAMAGE = 25;
constexpr int   LASER_POOL = 96;
constexpr float LASER_LENGTH = 9.0f;
constexpr float LASER_RADIUS = 0.18f;
constexpr float LASER_GLOW_RADIUS = 0.5f;
constexpr float LASER_HIT_RADIUS = 1.8f;
constexpr Vec3  LASER_COLOR = Vec3(0.2f, 1.0f, 0.4f);
constexpr float CRYSTAL_SPLIT_ANGLE = 0.3142f;
constexpr int   CRYSTAL_CHILD_BEAM_MAX = 12;

// ---- Score (§2.4) ----
constexpr float SCORE_DISTANCE_DIVISOR = 10.0f;
constexpr int   SCORE_ASTEROID = 10;
constexpr int   SCORE_COMET = 60;
constexpr int   SCORE_CRYSTAL = 40;
constexpr int   SCORE_PULSAR = 150;
constexpr int   SCORE_STORM = 80;
constexpr int   SCORE_STATION = 120;
constexpr int   SCORE_HULK = 150;
constexpr int   SCORE_WRECK = 200;
constexpr int   SCORE_CITY = 300;
constexpr int   SCORE_DEBRIS = 5;
constexpr int   SCORE_BLACK_HOLE = 500;

// ---- Particles (§2.5) ----
constexpr int EXHAUST_MAX = 200;
constexpr int SPARK_MAX = 50;
constexpr int EXPLOSION_MAX = 80;
constexpr int EMBER_MAX = 100;
constexpr int SPARKLE_MAX = 256;
constexpr int RING_POOL = 4;
constexpr int SHARD_POOL = 12;
constexpr int SPEEDLINE_POOL = 24;
constexpr int IMPACT_POOL = 4;

// ---- Starfield (§2.6) ----
constexpr int STAR_FAR_COUNT = 5000;
constexpr int STAR_MID_COUNT = 2000;
constexpr int STAR_NEAR_COUNT = 500;
constexpr int BRIGHT_STAR_COUNT = 30;
constexpr float STARFIELD_WRAP = 1200.0f;
constexpr float PARALLAX_FAR = 0.1f;
constexpr float PARALLAX_MID = 0.3f;
constexpr float PARALLAX_NEAR = 0.8f;
constexpr float SHOOTING_INTERVAL = 30.0f;
constexpr float SHOOTING_MAX = 2.0f;
constexpr float SHOOTING_LIFE = 0.45f;
constexpr float SHOOTING_SPEED = 1600.0f;

// ---- Post-processing (§2.7) ----
constexpr float BLOOM_STRENGTH = 1.5f;
constexpr float BLOOM_RADIUS = 0.4f;
constexpr float BLOOM_THRESHOLD = 0.15f;
constexpr float VIGNETTE_DARKNESS = 0.5f;
constexpr float VIGNETTE_OFFSET = 0.2f;
constexpr float FILM_GRAIN_INTENSITY = 0.03f;
constexpr float CA_MAX = 0.003f;
constexpr Vec3  FOG_COLOR = Vec3(0.0f, 0.0f, 0.067f);
constexpr float FOG_DENSITY = 0.008f;

// ---- Light manager (§2.8) ----
constexpr int LIGHT_CAP_AUTO = 16;
constexpr int LIGHT_CAP_ECO = 6;
constexpr int LIGHT_SIG_BUDGET = 4;
constexpr int LIGHT_LAND_BUDGET = 4;
constexpr int LIGHT_REEVAL_EVERY = 6;

// ---- Adaptive quality (§2.9) ----
constexpr float AQ_DROP_FPS = 45.0f;
constexpr float AQ_DROP_HOLD = 2.0f;
constexpr float AQ_SCALE1 = 0.85f;
constexpr float AQ_HARD_FPS = 30.0f;
constexpr float AQ_SCALE2 = 0.7f;
constexpr float AQ_RECOVER_FPS = 55.0f;
constexpr float AQ_RECOVER_HOLD = 3.0f;

// ---- Black holes (§5.3) ----
constexpr float BH_GRAVITY_BASE = 7500.0f;
constexpr float BH_PULL_MAX = 160.0f;
constexpr float BH_SHIP_PULL_FACTOR = 1.15f;
constexpr float BH_ATTRACT_RANGE = 480.0f;
constexpr float BH_ATTRACT_STRENGTH = 60000.0f;
constexpr float BH_ATTRACT_CAP = 100.0f;
constexpr float BH_COLLAPSE_RANGE = 80.0f;
constexpr float BH_COLLAPSE_DAMAGE = 50.0f;

// ---- Entity tuning (§2.11 / §5) ----
namespace CRYSTAL {
constexpr int DENSITY = 8;
constexpr int CLUSTER_MIN = 4, CLUSTER_MAX = 8;
constexpr int HP = 25, SCORE = 40, DAMAGE = 10;
}
namespace PULSAR {
constexpr int DENSITY = 4;
constexpr float BEAM_LENGTH = 500.0f;
constexpr int DAMAGE = 50;
constexpr float MIN_SPACING = 800.0f;
constexpr float MIN_DIST_SHIP = 400.0f;
constexpr float RADIUS_MIN = 22.0f, RADIUS_MAX = 30.0f;
constexpr float BEAM_TOUCH_RADIUS = 9.0f;
constexpr float HALF_ANGLE = 0.06f;
constexpr float PULSE_HZ = 1.5f;
}
namespace STORM {
constexpr int DENSITY = 4;
constexpr int STRIKE_DAMAGE = 45;
constexpr float STRIKE_RADIUS = 28.0f;
constexpr float BOLT_LIFE = 0.15f;
constexpr int BOLT_SEGMENTS = 6;
constexpr float TELEGRAPH_TIME = 0.4f;
constexpr float RESTRIKE_MIN = 1.2f, RESTRIKE_MAX = 2.8f;
constexpr float STATIC_RANGE = 350.0f;
constexpr float STATIC_RANGE_INTENSE = 150.0f;
constexpr float FLICKER_HZ = 6.0f;
constexpr float CLOUD_RADIUS_MIN = 20.0f, CLOUD_RADIUS_MAX = 40.0f;
constexpr float BOLT_DISTANCE_MAX = 120.0f;
}
namespace HULK {
constexpr int DENSITY = 4;
constexpr int HP = 100, DAMAGE = 30, SCORE = 150;
constexpr float STROBE_FREQ = 1.5f;
constexpr float MIN_SPACING = 300.0f;
}
namespace CITY {
constexpr float CITY_CHANCE = 0.75f;
constexpr float FRAGMENT_SCALE = 260.0f;
constexpr float FRAGMENT_RADIUS = 70.0f;
constexpr int FRAGMENT_DAMAGE = 25;
constexpr int WINDOW_COUNT = 90;
constexpr int WRECK_DENSITY = 5;
constexpr int WRECK_HP = 100, WRECK_SCORE = 200, WRECK_DAMAGE = 25;
constexpr float MIN_SPACING = 500.0f;
constexpr float MIN_DIST_SHIP = 600.0f;
constexpr float FLICKER_FREQ = 0.8f;
constexpr float DROPOUT_EVERY = 2.0f;
constexpr float DROPOUT_DURATION = 0.2f;
constexpr float STROBE_FREQ = 3.0f;
constexpr float GLOW_OPACITY = 0.08f;
}
namespace DEADSTAR {
constexpr float RADIUS_MIN = 3.0f, RADIUS_MAX = 6.0f;
}
namespace COMET {
constexpr int HP = 150, SCORE = 100, DAMAGE = 25;
constexpr float RADIUS_MIN = 2.5f, RADIUS_MAX = 4.5f;
constexpr float SPEED_MIN = 18.0f, SPEED_MAX = 30.0f;
}
namespace STATION {
constexpr int DAMAGE = 20;
}
namespace DEBRIS {
constexpr int HP = 10, SCORE = 5, DAMAGE = 5;
constexpr float RADIUS_MIN = 0.5f, RADIUS_MAX = 1.2f;
}
namespace ASTEROID {
constexpr float R_LARGE_MIN = 8.0f, R_LARGE_MAX = 12.0f;
constexpr float R_MED_MIN = 4.0f, R_MED_MAX = 7.0f;
constexpr float R_SML_MIN = 2.0f, R_SML_MAX = 3.5f;
constexpr int HP_LARGE = 100, HP_MED = 50, HP_SML = 25;
constexpr int SCORE_LARGE = 100, SCORE_MED = 50, SCORE_SML = 25;
constexpr int DMG_LARGE = 25, DMG_MED = 15, DMG_SML = 10;
}
namespace NEBULA {
constexpr float SCALE_MIN = 60.0f, SCALE_MAX = 120.0f;
constexpr float OPACITY = 0.35f;
}
} // namespace VD
