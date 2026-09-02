#pragma once
#include <chrono>
#include <vector>
#include <deque>
#include <atomic>
#include <mutex>
#include <functional>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <thread>
#include <condition_variable>
#include <future>
#include <map>
#include <algorithm>
#include "utils/Math.hpp"
#include "utils/Logging.hpp"
#include "core/Constants.hpp"

namespace SH {

// Timing system: fixed timestep at 60 Hz with delta-time normalization
class Timing {
public:
    static Timing& instance() {
        static Timing timing;
        return timing;
    }

    void init() {
        running_ = true;
        lastTime_ = std::chrono::high_resolution_clock::now();
        frameCount_ = 0;
        fpsAccumulator_ = 0.0f;
        currentFPS_ = 60;
        dt_ = Constants::TARGET_DT;
        LOG_INFO("Timing", "Timing system initialized at 60 Hz");
    }

    void shutdown() {
        running_ = false;
        LOG_INFO("Timing", "Timing system shut down");
    }

    void update() {
        if (!running_) return;

        auto now = std::chrono::high_resolution_clock::now();
        float frameTime = std::chrono::duration<float>(now - lastTime_).count();
        lastTime_ = now;

        // Clamp frame time to prevent spiral of death (cap at 100ms)
        frameTime = std::min(frameTime, 0.1f);

        // Update FPS
        frameCount_++;
        fpsAccumulator_ += frameTime;
        if (fpsAccumulator_ >= 1.0f) {
            currentFPS_ = static_cast<int>(frameCount_ / fpsAccumulator_);
            frameCount_ = 0;
            fpsAccumulator_ = 0.0f;
        }

        // Delta time is the real (clamped) frame time. The game loop calls
        // update(dt) exactly once per frame, so there is no fixed-timestep
        // sub-stepping here — dt is consumed directly by the update systems.
        dt_ = frameTime;
    }

    float deltaTime() const { return dt_; }
    int currentFPS() const { return currentFPS_; }

    // Thread-safe delta time access
    float getDelta() const {
        std::lock_guard<std::mutex> lock(mtx_);
        return dt_;
    }

    // Async resource loading on a dedicated worker thread
    class AsyncLoader {
    public:
        AsyncLoader() = default;

        ~AsyncLoader() {
            shutdown();
        }

        void init() {
            running_ = true;
            worker_ = std::thread([this]() {
                while (running_) {
                    {
                        std::unique_lock<std::mutex> lock(mtx_);
                        auto pred = [this]() { return !tasks_.empty() || !running_; };
                        if (!pred()) {
                            cv_.wait_for(lock, std::chrono::milliseconds(100), pred);
                        }
                        if (tasks_.empty() && !running_) break;

                        // Process all pending tasks
                        while (!tasks_.empty()) {
                            auto task = std::move(tasks_.front());
                            tasks_.pop_front();
                            lock.unlock();
                            task();
                            lock.lock();
                        }
                    }
                }
            });
            LOG_INFO("AsyncLoader", "Async worker thread started");
        }

        void shutdown() {
            running_ = false;
            cv_.notify_all();
            if (worker_.joinable()) worker_.join();
        }

        void loadAsync(std::function<void()> task, int /*priority*/ = 5) {
            {
                std::lock_guard<std::mutex> lock(mtx_);
                tasks_.emplace_back(std::move(task));
            }
            cv_.notify_one();
        }

        void flush() {
            std::lock_guard<std::mutex> lock(mtx_);
            tasks_.clear();
        }

    private:
        std::deque<std::function<void()>> tasks_;
        std::mutex mtx_;
        std::condition_variable cv_;
        std::thread worker_;
        bool running_ = false;
    };

    // Get async loader reference (must be after AsyncLoader class)
    AsyncLoader* getAsyncLoader() {
        if (!asyncLoader_) {
            asyncLoader_ = std::make_unique<AsyncLoader>();
            asyncLoader_->init();
        }
        return asyncLoader_.get();
    }

    // Perf probe for logging integration
    class PerfProbe {
    public:
        static PerfProbe& instance() {
            static PerfProbe probe;
            return probe;
        }

        void init() {
            LOG_INFO("PerfProbe", "Performance monitoring initialized");
        }

        int currentFPS() const {
            std::lock_guard<std::mutex> lock(mtx_);
            return Timing::instance().currentFPS();
        }

        float deltaTime() const {
            std::lock_guard<std::mutex> lock(mtx_);
            return Timing::instance().dt_;
        }

    private:
        mutable std::mutex mtx_;
    };

private:
    Timing() = default;

    std::chrono::high_resolution_clock::time_point lastTime_;
    float dt_ = Constants::TARGET_DT;
    int currentFPS_ = 60;
    int frameCount_ = 0;
    float fpsAccumulator_ = 0.0f;
    bool running_ = false;
    mutable std::mutex mtx_;
    std::unique_ptr<AsyncLoader> asyncLoader_;
};

// Global accessor for PerfProbe
inline Timing::PerfProbe* getPerfProbe() {
    return &Timing::PerfProbe::instance();
}

} // namespace SH
