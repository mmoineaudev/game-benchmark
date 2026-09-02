#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <chrono>
#include <thread>

// IMPORTANT: glew.h MUST be first before any other GL headers
#include <GL/glew.h>
#include <GLFW/glfw3.h>

// Dear ImGui
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

// Project headers
#include "core/Constants.hpp"
#include "core/Window.hpp"
#include "core/GameState.hpp"
#include "core/Timing.hpp"
#include "core/EventBus.hpp"
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include "utils/ResourceLoader.hpp"
#include "utils/ConfigParser.hpp"
#include <nlohmann/json.hpp>
#include "systems/InputSystem.hpp"
#include "systems/PhysicsSystem.hpp"
#include "systems/RenderSystem.hpp"
#include "systems/ParticleSystem.hpp"
#include "systems/LightManager.hpp"
#include "systems/AudioSystem.hpp"
#include "gameplay/PlayerShip.hpp"
#include "gameplay/WeaponSystem.hpp"
#include "gameplay/BuffSystem.hpp"
#include "entities/Entity.hpp"
#include "entities/EntityFactory.hpp"
#include "entities/components/Physics.hpp"
#include "entities/components/Render.hpp"
#include "entities/components/Damage.hpp"
#include "entities/components/AI.hpp"
#include "level/GalaxyGenerator.hpp"
#include "level/RouteManager.hpp"
#include "systems/EncounterSystem.hpp"
#include "ui/HUD.hpp"
#include "ui/EncounterUI.hpp"

namespace SH {

// ==================== Game Class ====================

class Game {
public:
    Game() : running_(true), paused_(false) {}
    ~Game() { shutdown(); }

    bool init() {
        LOG_INFO("Game", "=== Space Hauler C++ ===");

        // 1. Initialize timing
        Timing::instance().init();

        // 2. Initialize logging
        Logger::Config logConfig;
        logConfig.consoleEnabled = true;
        logConfig.fileEnabled = true;
        logConfig.logDir = "logs";
        logConfig.traceEnabled = true;
        Logger::instance().init(logConfig);

        LOG_INFO("Game", "Logging initialized");

        // 3. Create window
        window_ = std::make_unique<Window>(Constants::WINDOW_WIDTH, Constants::WINDOW_HEIGHT, Constants::WINDOW_TITLE);
        window_->center();
        LOG_INFO("Game", "Window created");

        // 4. Initialize OpenGL/GLEW
        glewExperimental = GL_TRUE;
        GLenum err = glewInit();
        if (err != GLEW_OK) {
            LOG_FATAL("Game", std::string("GLEW error: ") + reinterpret_cast<const char*>(glewGetErrorString(err)));
            return false;
        }
        LOG_INFO("Game", "GLEW initialized, GL version: " + std::string(reinterpret_cast<const char*>(glGetString(GL_VERSION))));

        // 5. Initialize ImGui
        ImGui::CreateContext();
        ImGuiIO& io = ImGui::GetIO();
        io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
        // io.ConfigFlags |= ImGuiConfigFlags_DockingEnable; // Not available in this ImGui version
        ImGui::StyleColorsDark();
        ImGui_ImplGlfw_InitForOpenGL(window_->raw(), true);
        ImGui_ImplOpenGL3_Init("#version 330");
        LOG_INFO("Game", "ImGui initialized");

        // 6. Initialize systems
        input_.init(window_->raw());
        gameState_.loadMeta();
        gameState_.reset();

        physicsSystem_.init();
        renderSystem_.init(window_.get());
        particleSystem_.init();
        lightManager_.init();
        audioSystem_.init();
        encounterSystem_.init();
        hud_.init(window_.get());
        encounterUI_.init(window_.get());

        LOG_INFO("Game", "All systems initialized");

        // 7. Generate galaxy
        galaxyGenerator_.generate();
        gameState_.systems = galaxyGenerator_.getSystems();
        gameState_.routes = galaxyGenerator_.getRoutes();
        routeManager_.setRouteData(gameState_.systems, gameState_.routes);
        LOG_INFO("Game", "Galaxy generated with " + std::to_string(gameState_.systems.size()) + " systems");

        // 8. Load data files
        loadGameData();

        // 9. Create player ship
        playerShip_ = std::make_unique<PlayerShip>(gameState_.shipId);
        playerShip_->addComponent<RenderComponent>(1, 1, Vec3(0.0f, 1.0f, 1.0f), 1.0f);

        // 10. Setup event bus handlers
        setupEventHandlers();

        LOG_INFO("Game", "=== Game initialization complete ===");
        return true;
    }

    void run() {
        LOG_INFO("Game", "=== Starting game loop ===");

        while (running_ && !glfwWindowShouldClose(window_->raw())) {
            auto startTime = std::chrono::high_resolution_clock::now();

            // Update timing
            Timing::instance().update();
            float dt = Timing::instance().getDelta();

            // Poll input
            input_.poll();

            // Handle window events
            window_->pollEvents();

            // Check for quit
            if (input_.edgePressed(InputSystem::Action::PAUSE)) {
                paused_ = !paused_;
                LOG_INFO("Game", "Game " + std::string(paused_ ? "paused" : "unpaused"));
            }

            if (!paused_) {
                // Update game logic
                update(dt);
            }

            // Render
            render();

            // Reset input edge flags
            input_.resetEdges();

            // Swap buffers
            window_->swapBuffers();

            // Frame time check (only warn when below the 30fps floor)
            auto endTime = std::chrono::high_resolution_clock::now();
            auto frameTime = std::chrono::duration<float>(endTime - startTime).count() * 1000.0f;
            if (frameTime > 33.0f) { // > ~30fps floor warning
                LOG_WARN("Game", "Frame time: " + std::to_string(static_cast<int>(frameTime)) + "ms");
            }
        }

        LOG_INFO("Game", "Game loop ended");
    }

    void shutdown() {
        LOG_INFO("Game", "=== Shutting down ===");

        // Save game state
        gameState_.save("data/save.json");

        // Shutdown systems in reverse order
        hud_.shutdown();
        encounterUI_.shutdown();
        audioSystem_.shutdown();
        lightManager_.shutdown();
        particleSystem_.shutdown();
        renderSystem_.shutdown();
        physicsSystem_.shutdown();

        // Shutdown ImGui
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplGlfw_Shutdown();
        ImGui::DestroyContext();

        // Shutdown other systems
        encounterSystem_.shutdown();
        Timing::instance().shutdown();
        Logger::instance().shutdown();

        LOG_INFO("Game", "=== Shutdown complete ===");
    }

private:
    std::unique_ptr<Window> window_;
    InputSystem input_;
    GameState gameState_;
    PhysicsSystem physicsSystem_;
    RenderSystem renderSystem_;
    ParticleSystem particleSystem_;
    LightManager lightManager_;
    AudioSystem audioSystem_;
    EncounterSystem encounterSystem_;
    HUD hud_;
    EncounterUI encounterUI_;
    GalaxyGenerator galaxyGenerator_;
    RouteManager routeManager_;

    std::unique_ptr<PlayerShip> playerShip_;
    std::vector<std::unique_ptr<Entity>> entities_;
    WeaponSystem weaponSystem_;
    BuffSystem buffSystem_;

    bool running_;
    bool paused_;
    EntityFactory entityFactory_;

    void update(float dt) {
        // Update ship
        playerShip_->applyInput(input_, dt);
        playerShip_->update(dt);

        // Update weapon system
        if (playerShip_->hasWeapon()) {
            weaponSystem_.update(dt, input_, entities_);
        }

        // Update encounter system
        encounterSystem_.update(dt, *playerShip_, entities_);

        // Update physics
        physicsSystem_.update(dt);

        // Update particles
        particleSystem_.update(dt);

        // Update lights
        lightManager_.update(dt);

        // Update buffs
        buffSystem_.update(dt, *playerShip_);

        // Check death (log only on transition into DEATH, not every frame)
        if (playerShip_->isDead() && gameState_.state != "DEATH") {
            gameState_.state = "DEATH";
            LOG_WARN("Game", "Player died");
        }

        // Update entities
        for (auto& entity : entities_) {
            entity->update(dt);
        }

        // Clean up dead entities
        entities_.erase(
            std::remove_if(entities_.begin(), entities_.end(),
                [](const std::unique_ptr<Entity>& e) { return !e->isActive(); }),
            entities_.end());

        // Handle state transitions
        handleStateTransitions(dt);

        // Log periodic state
        static int logCount = 0;
        if (++logCount % 300 == 0) { // Every ~5 seconds
            playerShip_->printState();
            gameState_.printState();
        }
    }

    void render() {
        // ImGui frame start
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        // Render game world
        if (gameState_.state == "FLIGHT" || gameState_.state == "ENCOUNTER") {
            // Safety check: ensure player ship is valid
            if (!playerShip_) {
                LOG_ERROR("Game", "Player ship is null in FLIGHT/ENCOUNTER state");
                return;
            }
            
            // Get camera transform
            Vec3 cameraPos = playerShip_->position;
            Quat cameraRot = Quat::fromEuler(
                playerShip_->orientation.x,
                playerShip_->orientation.y,
                playerShip_->orientation.z
            );

            // Build view matrix
            Vec3 forward = cameraRot.apply(Vec3(0.0f, 0.0f, -1.0f));
            Vec3 target = cameraPos + forward;
            Mat4 viewMatrix = Mat4::lookAt(cameraPos, target, Vec3(0.0f, 1.0f, 0.0f));
            Mat4 projMatrix = Mat4::perspective(
                deg2rad(Constants::CAMERA_FOV),
                static_cast<float>(window_->width()) / window_->height(),
                Constants::CAMERA_NEAR,
                Constants::CAMERA_FAR
            );

            // Render entities
            renderSystem_.render(entities_, cameraPos, cameraRot, viewMatrix, projMatrix);

            // Render particles
            particleSystem_.render();
        } else {
            // Non-flight states: draw a starfield backdrop so the window isn't black.
            static float t = 0.0f;
            t += Timing::instance().getDelta();
            renderSystem_.renderStarfield(t);
        }

        // Render HUD
        hud_.render(
            gameState_.state,
            *playerShip_,
            gameState_.systems,
            gameState_.currentSystem,
            0, // routeDanger
            0, // fuelCost
            encounterSystem_.getActiveEncounter(),
            std::unordered_map<std::string, int>()
        );

        // Render ImGui overlays based on state
        if (gameState_.state == "HUB") {
            ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x / 2.0f - 200, 100), ImGuiCond_FirstUseEver);
            ImGui::Begin("Home Port", nullptr, ImGuiWindowFlags_NoResize);
            ImGui::TextColored(ImVec4(0.0f, 1.0f, 1.0f, 1.0f), "Hauler Mk I — Home Port");
            ImGui::Separator();
            ImGui::Text("Credits: $%d", playerShip_->getCredits());
            ImGui::Text("Persistent: $%d", gameState_.persistentCredits);
            ImGui::Spacing();
            if (ImGui::Button("View Galaxy [M]", ImVec2(200, 50))) {
                LOG_INFO("Game", "View Galaxy button clicked, transitioning to MAP");
                gameState_.state = "MAP";
            }
            ImGui::Text("Click a system on the galaxy map to travel.");
            ImGui::End();
        } else if (gameState_.state == "MAP") {
            // Render the galaxy map via the render system's 2D ImGui overlay
            renderSystem_.renderGalaxyMap2D(gameState_.systems, gameState_.routes);
            ImGui::SetNextWindowPos(ImVec2(10, 10), ImGuiCond_FirstUseEver);
            ImGui::Begin("Galaxy Map Controls");
            ImGui::Text("Galaxy Map");
            ImGui::Text("Systems: %d", static_cast<int>(gameState_.systems.size()));
            ImGui::Separator();
            ImGui::Text("Click a system to set as destination.");
            ImGui::Separator();
            // List systems as buttons for MVP (adjacent-only logic would go here)
            for (const auto& sys : gameState_.systems) {
                std::string label = sys.name + "  [danger " + std::to_string(sys.danger) + "]";
                if (ImGui::Button(label.c_str())) {
                    gameState_.currentSystem = sys.id;
                    gameState_.state = "FLIGHT";
                }
                ImGui::SameLine();
            }
            if (ImGui::Button("Back to Hub")) {
                gameState_.state = "HUB";
            }
            ImGui::End();
        } else if (gameState_.state == "DEATH") {
            ImGui::Begin("Death Screen");
            ImGui::TextColored(ImVec4(1.0f, 0.0f, 0.0f, 1.0f), "Ship Destroyed!");
            ImGui::Text("Profit: %d credits", gameState_.profit);
            ImGui::Text("Systems Visited: %d", gameState_.systemsVisited);
            if (ImGui::Button("Continue")) {
                gameState_.reset();
                gameState_.addPersistentCredits(10);
            }
            ImGui::End();
        } else if (gameState_.state == "SYSTEM") {
            ImGui::Begin("Market");
            ImGui::Text("Market at %s", gameState_.currentSystem.c_str());
            ImGui::Text("Credits: $%d", playerShip_->getCredits());
            ImGui::Text("Cargo: %d/%d", playerShip_->getCargo(), playerShip_->getCargoMax());
            if (ImGui::Button("Buy Cargo")) {
                // Buy logic
            }
            if (ImGui::Button("Sell Cargo")) {
                // Sell logic
            }
            if (ImGui::Button("Depart")) {
                gameState_.state = "FLIGHT";
            }
            if (ImGui::Button("Return Home")) {
                // Auto-route home
            }
            ImGui::End();
        }

        // Render encounter UI
        if (encounterSystem_.isActive()) {
            encounterUI_.render(
                encounterSystem_.getActiveEncounter(),
                encounterSystem_.getEncounterDifficulty(),
                true,
                false,
                encounterSystem_.getTimer() / encounterSystem_.getEncounterDuration(),
                gameState_
            );
        }

        // Render to screen
        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    }

    void handleStateTransitions(float dt) {
        // Log state changes for debugging
        static std::string lastState = "";
        if (gameState_.state != lastState) {
            LOG_INFO("Game", "State changed: " + lastState + " -> " + gameState_.state);
            lastState = gameState_.state;
        }
        
        // Handle key presses for state changes
        if (input_.edgePressed(InputSystem::Action::TOGGLE_MAP)) {
            if (gameState_.state == "FLIGHT") {
                gameState_.state = "MAP";
            } else if (gameState_.state == "MAP") {
                gameState_.state = "FLIGHT";
            } else if (gameState_.state == "HUB") {
                gameState_.state = "MAP";
            }
        }

        // Update encounter system trigger check — only during active flight
        // AND only when the encounter queue has been generated for a route.
        if (gameState_.state == "FLIGHT") {
            // Only trigger encounters if we have a generated queue (i.e., a route
            // was actually launched). The MVP doesn't yet generate routes, so
            // this stays dormant until route generation is wired up.
            // encounterSystem_.checkEncounterTrigger(
            //     0.0f,   // distanceTraveled (would track this)
            //     1000.0f // maxRouteDistance
            // );
        }
    }

    void loadGameData() {
        // Load JSON data files
        std::string basePath = "data/";
        ResourceLoader &loader = ResourceLoader::instance();

        // Ships
        try {
            auto shipsJSON = loader.loadJSON(basePath + "ships.json");
            LOG_INFO("Game", "Loaded ships.json: " + std::to_string(shipsJSON.size()) + " ships");
        } catch (...) {
            LOG_WARN("Game", "Failed to load ships.json");
        }

        // Cargo
        try {
            auto cargoJSON = loader.loadJSON(basePath + "cargo.json");
            LOG_INFO("Game", "Loaded cargo.json: " + std::to_string(cargoJSON.size()) + " cargo types");
        } catch (...) {
            LOG_WARN("Game", "Failed to load cargo.json");
        }

        // Encounters
        try {
            auto encounterJSON = loader.loadJSON(basePath + "encounters.json");
            LOG_INFO("Game", "Loaded encounters.json: " + std::to_string(encounterJSON.size()) + " encounter types");
        } catch (...) {
            LOG_WARN("Game", "Failed to load encounters.json");
        }

        // Factions
        try {
            auto factionJSON = loader.loadJSON(basePath + "factions.json");
            LOG_INFO("Game", "Loaded factions.json: " + std::to_string(factionJSON.size()) + " factions");
        } catch (...) {
            LOG_WARN("Game", "Failed to load factions.json");
        }

        // Economy
        try {
            auto economyJSON = loader.loadJSON(basePath + "economy.json");
            LOG_INFO("Game", "Loaded economy.json");
        } catch (...) {
            LOG_WARN("Game", "Failed to load economy.json");
        }

        // Galaxy
        try {
            auto galaxyJSON = loader.loadJSON(basePath + "galaxy.json");
            LOG_INFO("Game", "Loaded galaxy.json");
        } catch (...) {
            LOG_WARN("Game", "Failed to load galaxy.json");
        }

        // Entity factory registrations
        entityFactory_.registerCreator("player_ship", [](int id) {
            return new Entity("player_ship", id);
        });
        entityFactory_.registerCreator("asteroid", [](int id) {
            return new Entity("asteroid", id);
        });
        entityFactory_.registerCreator("pirate_ship", [](int id) {
            return new Entity("pirate_ship", id);
        });
        entityFactory_.registerCreator("station", [](int id) {
            return new Entity("station", id);
        });
        entityFactory_.registerCreator("projectile", [](int id) {
            return new Entity("projectile", id);
        });

        LOG_INFO("Game", "All game data loaded");
    }

    void setupEventHandlers() {
        // Game state change handler
        EventBus::instance().subscribe("GAME_STATE_CHANGE", [this](const Event& e) {
            LOG_INFO("Game", "State changed to: " + e.get<std::string>("to"));
        });

        // Ship damaged handler
        EventBus::instance().subscribe("SHIP_DAMAGED", [this](const Event& e) {
            int damage = e.get<int>("amount");
            LOG_WARN("Game", "Ship damaged: " + std::to_string(damage) + " damage");
        });

        // Cargo sold handler
        EventBus::instance().subscribe("CARGO_SOLD", [this](const Event& e) {
            int profit = e.get<int>("profit");
            gameState_.addRunProfit(profit);
            LOG_INFO("Game", "Cargo sold for profit: $" + std::to_string(profit));
        });

        LOG_INFO("Game", "Event handlers registered");
    }
};

// ==================== Main Entry Point ====================

int main(int argc, char** argv) {
    std::cout << "=== Space Hauler C++ ===" << std::endl;
    std::cout << "Building with CMake, C++17, OpenGL 3.3+" << std::endl;
    std::cout << "Press ESC to exit" << std::endl;
    std::cout << std::endl;

    Game game;
    if (game.init()) {
        game.run();
    } else {
        std::cerr << "Failed to initialize game!" << std::endl;
        return EXIT_FAILURE;
    }

    game.shutdown();

    std::cout << "=== Game exited cleanly ===" << std::endl;
    return EXIT_SUCCESS;
}

} // namespace SH

// ==================== Main Entry Point (outside namespace) ====================

int main(int argc, char** argv) {
    return SH::main(argc, argv);
}
