#pragma once
#include <iostream>
#include <fstream>
#include <string>
#include <sstream>
#include <chrono>
#include <ctime>
#include <atomic>
#include <thread>
#include <iomanip>
#include <cstring>
#include <mutex>

#ifdef __GNUG__
#define LOG_FILE __FILE__
#define LOG_LINE __LINE__
#else
#define LOG_FILE "unknown"
#define LOG_LINE 0
#endif

// Compile-time control: #define LOG_ENABLE_DEBUG to enable DEBUG logs
#ifndef LOG_ENABLE_DEBUG
#pragma message("DEBUG logging disabled (compile-time)")
#endif

namespace SH {

// Severity levels
enum class LogLevel { DEBUG, INFO, WARN, ERROR, FATAL };

// Thread-safe logging system with console + file output and trace scopes
class Logger {
public:
    struct Config {
        bool consoleEnabled = true;
        bool fileEnabled = true;
        std::string logDir = "logs";
        size_t maxLogFileKB = 1024;   // 1MB
        bool jsonOutput = false;
        bool traceEnabled = true;
    };

    static Logger& instance() {
        static Logger logger;
        return logger;
    }

    // Set the performance probe pointer (avoids circular dependency)
    void setPerfProbe(void* probe) { perfProbe_ = probe; }

    void init(const Config& config);
    void shutdown();

    // Log functions
    void log(LogLevel level, const char* file, int line, const std::string& module, const std::string& msg);

    // TraceScope for session tracing
    class TraceScope {
    public:
        TraceScope(const std::string& name) : active_(true), start_(std::chrono::high_resolution_clock::now()), name_(name) {
            Logger::instance().traceBegin(name);
        }

        ~TraceScope() {
            if (active_) {
                Logger::instance().traceEnd(name_);
            }
        }

        TraceScope(const TraceScope&) = delete;
        TraceScope& operator=(const TraceScope&) = delete;

        void disable() { active_ = false; }

    private:
        bool active_;
        std::string name_;
        std::chrono::high_resolution_clock::time_point start_;
    };

    // Convenience methods
    void info(const std::string& module, const std::string& msg) {
        log(LogLevel::INFO, LOG_FILE, LOG_LINE, module, msg);
    }

    void warn(const std::string& module, const std::string& msg) {
        log(LogLevel::WARN, LOG_FILE, LOG_LINE, module, msg);
    }

    void error(const std::string& module, const std::string& msg) {
        log(LogLevel::ERROR, LOG_FILE, LOG_LINE, module, msg);
    }

    void fatal(const std::string& module, const std::string& msg) {
        log(LogLevel::FATAL, LOG_FILE, LOG_LINE, module, msg);
    }

#ifdef LOG_ENABLE_DEBUG
    void debug(const std::string& module, const std::string& msg) {
        log(LogLevel::DEBUG, LOG_FILE, LOG_LINE, module, msg);
    }
#endif

    void flush() { flushFile(); }
    std::string getLogFile() { return logFilePath_; }

private:
    Logger() = default;

    void openLogFile();
    void flushFile();
    std::string escapeJSON(const std::string& str);
    std::string formatTime();
    void traceBegin(const std::string& name);
    void traceEnd(const std::string& name);

    std::atomic<bool> running_{false};
    Config config_;
    std::ofstream logFile_;
    std::string logFilePath_;
    std::mutex mtx_;
    void* perfProbe_{nullptr}; // Raw pointer to avoid circular dependency
};

// Log macros (convenience): LOG_INFO(module, msg)
#define LOG_INFO(module, msg) SH::Logger::instance().info(module, msg)
#define LOG_WARN(module, msg) SH::Logger::instance().warn(module, msg)
#define LOG_ERROR(module, msg) SH::Logger::instance().error(module, msg)
#define LOG_FATAL(module, msg) SH::Logger::instance().fatal(module, msg)

#ifdef LOG_ENABLE_DEBUG
#define LOG_DEBUG(module, msg) SH::Logger::instance().debug(module, msg)
#else
#define LOG_DEBUG(module, msg)
#endif

// TraceScope usage: { SH::Logger::TraceScope scope("trace:name"); ... }

} // namespace SH
