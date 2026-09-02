#pragma once
#include <string>
#include <vector>
#include <GL/glew.h>

class Shader {
public:
    static bool init(const std::string& shaderDir);
    static void shutdown();
    static Shader* get(const char* name);
    static int u(Shader* s, const char* name);

    void use() const;
    GLuint program() const { return prog; }

private:
    struct Reg { std::string name; Shader* s; int loc; };
    std::vector<Reg> uniforms;
    GLuint prog = 0;
    std::string name;

    static std::string readFile(const std::string& path);
};
