#pragma once
#include "Window.hpp"
#include "GameState.hpp"
#include "Rng.hpp"
#include "Constants.hpp"
#include "PlayerShip.hpp"
#include "WeaponSystem.hpp"
#include "ScoreSystem.hpp"
#include "PhysicsSystem.hpp"
#include "CameraSystem.hpp"
#include "ChunkManager.hpp"
#include "ParticleSystem.hpp"
#include "Starfield.hpp"
#include "PostProcessingSystem.hpp"
#include "LightManager.hpp"
#include "AdaptiveQuality.hpp"
#include "AudioSystem.hpp"
#include "HUD.hpp"
#include "AsteroidField.hpp"
#include "CometSystem.hpp"
#include "BlackHoleSystem.hpp"
#include "DeadStarSystem.hpp"
#include "NebulaSystem.hpp"
#include "StationSystem.hpp"
#include "DebrisSystem.hpp"
#include "CrystalSystem.hpp"
#include "PulsarSystem.hpp"
#include "StormSystem.hpp"
#include "HulkSystem.hpp"
#include "CitySystem.hpp"
#include "InputSystem.hpp"
#include <string>
#include <vector>

struct CliArgs {
    float teleport = 0.0f;
    float perfDuration = 0.0f;
    bool headless = false;
    int seed = 12345;
};

class Game {
public:
    int run(int argc, char** argv);

private:
    CliArgs args;
    PlayerShip ship;
    WeaponSystem weapons;
    ScoreSystem score;
    PhysicsSystem physics;
    CameraSystem camera;
    ChunkManager chunkMgr;
    ParticleSystem particles;
    Starfield starfield;
    PostProcessingSystem postprocess;
    LightManager lights;
    AdaptiveQuality quality;
    AudioSystem audio;
    HUD hud;
    AsteroidField asteroids;
    CometSystem comets;
    BlackHoleSystem blackHoles;
    DeadStarSystem deadStars;
    NebulaSystem nebulae;
    StationSystem stations;
    DebrisSystem debris;
    CrystalSystem crystals;
    PulsarSystem pulsars;
    StormSystem storms;
    HulkSystem hulks;
    CitySystem city;
    InputSystem input;
};
