#include "utils/Logging.hpp"
#include "core/Timing.hpp"
#include <iomanip>
#include <ctime>
#include <filesystem>
#include <algorithm>

namespace SH {

void Logger::init(const Config& config) {
    std::lock_guard<std::mutex> lock(mtx_);
    config_ = config;
    if (config_.fileEnabled) {
        openLogFile();
    }
    running_ = true;
}

void Logger::shutdown() {
    std::lock_guard<std::mutex> lock(mtx_);
    running_ = false;
    flushFile();
    if (logFile_.is_open()) logFile_.close();
}

void Logger::log(LogLevel level, const char* file, int line, const std::string& module, const std::string& msg) {
    if (!running_ || (level == LogLevel::DEBUG)) {
        if (level == LogLevel::DEBUG) return; // Zero-cost when disabled
    }

    auto timeStr = formatTime();

    // Get FPS & delta-time from the Timing system
    int fps = 0;
    float dtMs = 0.0f;
    {
        const auto& timing = Timing::instance();
        fps = timing.currentFPS();
        dtMs = timing.deltaTime() * 1000.0f;
    }

    std::string levelStr;
    switch (level) {
        case LogLevel::DEBUG: levelStr = "DEBUG"; break;
        case LogLevel::INFO:  levelStr = "INFO";  break;
        case LogLevel::WARN:  levelStr = "WARN";  break;
        case LogLevel::ERROR: levelStr = "ERROR"; break;
        case LogLevel::FATAL: levelStr = "FATAL"; break;
    }

    // Console output with ANSI colors
    if (config_.consoleEnabled) {
        const char* color = "";
        switch (level) {
            case LogLevel::DEBUG: color = "\x1B[36m"; break;  // Cyan
            case LogLevel::INFO:  color = "\x1B[37m"; break;  // White
            case LogLevel::WARN:  color = "\x1B[33m"; break;  // Yellow
            case LogLevel::ERROR: color = "\x1B[31m"; break;  // Red
            case LogLevel::FATAL: color = "\x1B[91m"; break;  // Bright Red
        }
        const char* reset = "\x1B[0m";
        std::cout << color << "[" << timeStr << "] ["
                  << levelStr << "] [FPS:" << fps << "] [dt:"
                  << std::fixed << std::setprecision(2) << dtMs << "ms] ["
                  << module << "] " << msg << reset << std::endl;
    }

    // File output (no ANSI, machine-parseable)
    if (config_.fileEnabled && logFile_.is_open()) {
        if (config_.jsonOutput) {
            logFile_ << "{\"timestamp\":\"" << timeStr << "\","
                     << "\"level\":\"" << levelStr << "\","
                     << "\"fps\":" << fps << ","
                     << "\"dt\":" << std::fixed << std::setprecision(2) << dtMs << ","
                     << "\"module\":\"" << module << "\","
                     << "\"line\":" << line << ","
                     << "\"message\":\"" << escapeJSON(msg) << "\"}" << std::endl;
        } else {
            logFile_ << timeStr << "|" << levelStr << "|FPS:" << fps
                     << "|dt:" << std::fixed << std::setprecision(2) << dtMs << "ms"
                     << "|" << module << ":" << line << "| " << msg << std::endl;
        }
        logFile_.flush(); // Unbuffered for crash safety
    }

    // FATAL: flush then abort
    if (level == LogLevel::FATAL) {
        flushFile();
        std::cerr << "[FATAL] Aborting on fatal error." << std::endl;
        std::abort();
    }
}

void Logger::traceBegin(const std::string& name) {
    if (!config_.traceEnabled) return;
    log(LogLevel::INFO, "TraceScope.cpp", 0, "Trace", ">>> TRACE " + name + " <<<");
}

void Logger::traceEnd(const std::string& name) {
    if (!config_.traceEnabled) return;
    log(LogLevel::INFO, "TraceScope.cpp", 0, "Trace", "<<< TRACE " + name + " END");
}

void Logger::openLogFile() {
    // Create log directory if it doesn't exist
    namespace fs = std::filesystem;
    if (!fs::exists(config_.logDir)) {
        fs::create_directories(config_.logDir);
    }
    logFilePath_ = config_.logDir + "/game.log";
    logFile_.open(logFilePath_, std::ios::app);
    if (!logFile_.is_open()) {
        std::cerr << "[Logger] Failed to open log file: " << logFilePath_ << std::endl;
        config_.fileEnabled = false;
    }
}

void Logger::flushFile() {
    if (logFile_.is_open()) logFile_.flush();
}

std::string Logger::escapeJSON(const std::string& str) {
    std::string result;
    result.reserve(str.size() * 2);
    for (char c : str) {
        switch (c) {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:   result += c; break;
        }
    }
    return result;
}

std::string Logger::formatTime() {
    auto now = std::chrono::system_clock::now();
    auto time_t_now = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;

    std::tm* tm_now = std::localtime(&time_t_now);

    std::ostringstream oss;
    oss << std::setfill('0')
        << std::setw(2) << tm_now->tm_hour << ":"
        << std::setw(2) << tm_now->tm_min << ":"
        << std::setw(2) << tm_now->tm_sec << "."
        << std::setw(3) << ms.count();
    return oss.str();
}

} // namespace SH
