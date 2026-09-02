#include "Shader.hpp"
#include <fstream>
#include <filesystem>
#include <cstdlib>
#include <cstdio>
#include <GL/glew.h>

namespace {
struct Entry { std::string name; Shader* s; };
std::vector<Entry> g_entries;
}

static GLuint compileShader(GLenum type, const std::string& src, const char* fname) {
    GLuint sh = glCreateShader(type);
    const char* c = src.c_str();
    glShaderSource(sh, 1, &c, nullptr);
    glCompileShader(sh);
    GLint ok = 0;
    glGetShaderiv(sh, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetShaderInfoLog(sh, sizeof(log), nullptr, log);    }
    return sh;
}

static GLuint linkProgram(GLuint vs, GLuint fs, const char* name) {
    GLuint p = glCreateProgram();
    glAttachShader(p, vs);
    glAttachShader(p, fs);
    glLinkProgram(p);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetProgramInfoLog(p, sizeof(log), nullptr, log);    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    return p;
}

std::string Shader::readFile(const std::string& path) {
    std::ifstream f(path);
    if (!f) return "";
    std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return s;
}

bool Shader::init(const std::string& shaderDir) {
    const char* pairs[] = {
        "base", "star", "particle", "nebula", "disk", "beacon",
        "bloom_extract", "bloom_blur", "composite", "beam"
    };
    for (const char* n : pairs) {
        std::string vsrc = readFile(shaderDir + "/" + n + ".vert");
        std::string fsrc = readFile(shaderDir + "/" + n + ".frag");
        if (vsrc.empty() || fsrc.empty()) {            return false;
        }
        auto* s = new Shader();
        s->name = n;
        s->prog = linkProgram(
            compileShader(GL_VERTEX_SHADER, vsrc, (std::string(n) + ".vert").c_str()),
            compileShader(GL_FRAGMENT_SHADER, fsrc, (std::string(n) + ".frag").c_str()),
            n);
        g_entries.push_back({n, s});
    }
    return true;
}

void Shader::shutdown() {
    for (auto& e : g_entries) {
        glDeleteProgram(e.s->prog);
        delete e.s;
    }
    g_entries.clear();
}

Shader* Shader::get(const char* name) {
    for (auto& e : g_entries)
        if (e.name == name) return e.s;
    return nullptr;
}

int Shader::u(Shader* s, const char* name) {
    if (!s) return -1;
    for (auto& r : s->uniforms)
        if (r.name == name) return r.loc;
    int loc = (int)glGetUniformLocation(s->prog, name);
    s->uniforms.push_back({name, s, loc});
    return loc;
}

void Shader::use() const { glUseProgram(prog); }
