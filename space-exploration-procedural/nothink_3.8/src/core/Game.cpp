#include "Game.hpp"
#include "EventBus.hpp"
#include "Timing.hpp"
#include <algorithm>
#include "Shader.hpp"
#include "PlayerShip.hpp"
#include "WeaponSystem.hpp"
#include "ScoreSystem.hpp"
#include "PhysicsSystem.hpp"
#include "CameraSystem.hpp"
#include "InputSystem.hpp"
#include "LightManager.hpp"
#include "AdaptiveQuality.hpp"
#include "ParticleSystem.hpp"
#include "PostProcessingSystem.hpp"
#include "AudioSystem.hpp"
#include "HUD.hpp"
#include "Starfield.hpp"
#include "ChunkManager.hpp"
#include "BiomeGenerator.hpp"
#include "ProceduralWrecks.hpp"
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
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>

int Game::run(int argc, char** argv) {
    (void)argc; (void)argv;

    Window::instance().init();

    // Parse args
    float teleportDist = 0;
    float perfDuration = 0;
    bool headless = false;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--teleport" && i+1 < argc) teleportDist = (float)atof(argv[++i]);
        if (a == "--perf-duration" && i+1 < argc) perfDuration = (float)atof(argv[++i]);
        if (a == "--headless") headless = true;
    }
    (void)headless; (void)perfDuration;

    // Init all systems
    GameState::instance().reset(teleportDist);
    Shader::init("shaders");
    PW::Cache::instance().build("shaders");
    ship.init();
    weapons.init();
    score.init();
    physics.init();
    camera.init();
    lights.init();
    quality.init();
    particles.init();
    postprocess.init(Window::instance().width(), Window::instance().height());
    audio.init();
    hud.init();
    starfield.init();

    // Chunk manager with all entity systems
    std::vector<ChunkManager::System*> systems = {
        &asteroids, &comets, &blackHoles, &deadStars, &nebulae, &stations,
        &debris, &crystals, &pulsars, &storms, &hulks, &city
    };
    chunkMgr.init(systems);
    ship.teleport(teleportDist);
    camera.teleport(ship.pos());

    // ImGui init
    ImGui::CreateContext();
    ImGui::GetIO().IniFilename = nullptr;
    ImGui_ImplGlfw_InitForOpenGL(Window::instance().handle(), true);
    ImGui_ImplOpenGL3_Init("#version 460");

    float elapsed = 0;
    while (!Window::instance().shouldClose()) {
        float dt = Timing::deltaTime();
        elapsed += dt;
        input.update();
        if (input.wantPause()) { input.consumePause(); GameState::instance().paused = !GameState::instance().paused; }
        if (input.wantMute()) { input.consumeMute(); audio.setMuted(!GameState::instance().muted); }
        if (input.wantRestart()) { input.consumeRestart(); ship.respawn(); weapons.clearAll(); }
        if (input.wantLightProfile()) { input.consumeLightProfile(); lights.setProfile(GameState::instance().lightProfile == "auto" ? "eco" : "auto"); }
        if (input.wantLadderChart()) { input.consumeLadderChart(); }

        if (!GameState::instance().paused) {
            // Ship
            float throttle = input.throttle();
            ship.setThrust(throttle);
            ship.update(dt, throttle, input.isFiring(), input.isShieldHeld());

            // Weapons
            weapons.update(dt, ship);
            if (input.isFiring()) {
                weapons.firePlayerBeams(ship);
            }

            // Score
            score.update(dt);

            // Black hole gravity
            VD::Vec3 grav = blackHoles.gravity(ship.pos());
            ship.applyGravity(grav);

            // Pulsar beam damage
            int pdmg = pulsars.beamDamage(ship.pos(), ship.forward());
            if (pdmg > 0 && ship.invulnTimer() <= 0) {
                ship.addHealth(-pdmg);
            }

            // Storm strike damage
            int sdmg = storms.strikeDamage(ship.pos());
            if (sdmg > 0 && ship.invulnTimer() <= 0) {
                ship.addHealth(-sdmg);
                EventBus::instance().emit(Events::ENV_STORM_STRIKE);
            }

            // Chunk update
            chunkMgr.update(dt, ship.pos(), GameState::instance().distance);

            // Entity updates
            comets.update(dt, ship.pos());
            blackHoles.update(dt, ship.pos());
            deadStars.update(dt, ship.pos());
            nebulae.update(dt, ship.pos());
            stations.update(dt, ship.pos());
            debris.update(dt, ship.pos());
            crystals.update(dt, ship.pos());
            pulsars.update(dt, ship.pos());
            storms.update(dt, ship.pos());
            hulks.update(dt, ship.pos());
            city.update(dt, ship.pos());

            // Particles
            particles.update(dt);
            if (ship.thrustIntensity() > 0.1f) {
                VD::Vec3 f = ship.forward();
                particles.emitExhaust(ship.pos() - f * 3.0f, f, (int)(ship.thrustIntensity() * 3.0f));
            }

            // Camera
            camera.update(dt, ship);

            // Adaptive quality
            quality.update(dt, Timing::fps());
            float resScale = quality.resolutionScale();
            postprocess.setResolutionScale(resScale);
            postprocess.setCA(quality.caEnabled() ? 0.003f : 0);
            postprocess.setGrain(quality.grainEnabled() ? 0.03f : 0);
        }

        // Rung change detection
        int newRung = BiomeGenerator::getRungIndex(GameState::instance().distance);
        if (newRung != GameState::instance().rungIndex) {
            GameState::instance().rungIndex = newRung;
            EventBus::instance().emit(Events::LADDER_RUNG_CHANGED);
            if (newRung == 13) EventBus::instance().emit(Events::LADDER_FINALE_REACHED);
        }

        // Wormhole intensity
        if (GameState::instance().distance > 5000 && GameState::instance().distance < 7000) {
            float t = (GameState::instance().distance - 5000) / 2000;
            GameState::instance().wormholeIntensity = glm::sin(t * 3.14159f) * 0.5f;
        } else {
            GameState::instance().wormholeIntensity = 0;
        }

        // Render
        postprocess.beginScene();
        starfield.update(dt, ship.pos());
        starfield.render(camera.viewProj(), ship.pos());
        chunkMgr.render(camera.viewProj(), camera.position());
        asteroids.render(camera.viewProj(), camera.position());
        comets.render(camera.viewProj(), camera.position());
        blackHoles.render(camera.viewProj(), camera.position());
        deadStars.render(camera.viewProj(), camera.position());
        nebulae.render(camera.viewProj(), camera.position());
        stations.render(camera.viewProj(), camera.position());
        debris.render(camera.viewProj(), camera.position());
        crystals.render(camera.viewProj(), camera.position());
        pulsars.render(camera.viewProj(), camera.position());
        storms.render(camera.viewProj(), camera.position());
        hulks.render(camera.viewProj(), camera.position());
        city.render(camera.viewProj(), camera.position());
        weapons.render(camera.viewProj(), camera.position());
        postprocess.endScene();
        postprocess.present();

        // ImGui
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();
        hud.render();
        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        Window::instance().swapBuffers();
    }

    // Cleanup
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    PW::Cache::instance().dispose();
    audio.shutdown();
    Window::instance().shutdown();
    return 0;
}
