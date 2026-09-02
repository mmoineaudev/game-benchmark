cmake_minimum_required(VERSION 3.16)
project(VoidDrift VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
add_compile_options(-Wall -Wextra -O2)

find_package(glfw3 REQUIRED)
find_package(OpenGL REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(SNDFILE REQUIRED sndfile)
find_package(nlohmann_json REQUIRED)

include_directories(${CMAKE_SOURCE_DIR}/external/imgui)
include_directories(${CMAKE_SOURCE_DIR}/external/imgui/backends)
include_directories(${CMAKE_SOURCE_DIR}/src)
include_directories(${CMAKE_SOURCE_DIR}/src/core)
include_directories(${CMAKE_SOURCE_DIR}/src/systems)
include_directories(${CMAKE_SOURCE_DIR}/src/gameplay)
include_directories(${CMAKE_SOURCE_DIR}/src/level)
include_directories(${CMAKE_SOURCE_DIR}/src/ui)
include_directories(${CMAKE_SOURCE_DIR}/src/utils)

file(GLOB_RECURSE SOURCES CONFIGURE_DEPENDS src/*.cpp)

add_executable(void_drift ${SOURCES}
    external/imgui/imgui.cpp
    external/imgui/imgui_draw.cpp
    external/imgui/imgui_tables.cpp
    external/imgui/imgui_widgets.cpp
    external/imgui/backends/imgui_impl_glfw.cpp
    external/imgui/backends/imgui_impl_opengl3.cpp
)

target_link_libraries(void_drift
    OpenGL::GL
    glfw
    GLEW
    ${SNDFILE_LIBRARIES}
    nlohmann_json::nlohmann_json
)
# OpenAL: link runtime lib (dev headers may be absent)
find_library(AL_LIB openal)
if(AL_LIB)
    target_link_libraries(void_drift ${AL_LIB})
    target_compile_definitions(void_drift PRIVATE HAS_OPENAL=1)
endif()
target_include_directories(void_drift PRIVATE ${SNDFILE_INCLUDE_DIRS})
target_link_directories(void_drift PRIVATE ${SNDFILE_LIBRARY_DIRS})
