cmake_minimum_required(VERSION 3.22)
project(dungeon_crawler_cpp CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE "Release" CACHE STRING "" FORCE)
endif()

add_compile_options(-Wall -Wextra)

# ---- Sanitizers (crash-diagnostics build, §3.4) -----------------------------
# -DDC_SANITIZERS=On adds AddressSanitizer + UBSan to every target. This is
# the build that catches a synthetic UAF/OOB injected into the sim (via
# dc_repro --fault) and names the exact crashing line, proving a real crash
# is a debuggable bug. Use a Debug build for a readable report.
option(DC_SANITIZERS "Build all targets with -fsanitize=address,undefined" OFF)
if(DC_SANITIZERS)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-optimize-sibling-calls)
  add_link_options(-fsanitize=address,undefined)
endif()

# ---- dc_core: deterministic, no GPU ------------------------------------------
# All gameplay data + sim. This is where parity lives; GPU-free and testable.
file(GLOB DC_CORE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/core/*.cpp)
add_library(dc_core STATIC ${DC_CORE_SOURCES})
target_include_directories(dc_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

# ---- dc_render: renderer-agnostic interface + null renderer ------------------
file(GLOB DC_RENDER_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/render/*.cpp)
add_library(dc_render STATIC ${DC_RENDER_SOURCES})
target_include_directories(dc_render PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(dc_render PUBLIC dc_core)

# OpenGL core (GLFW)
find_package(OpenGL QUIET)
find_package(Glfw QUIET)
if(OpenGL_FOUND AND Glfw_FOUND)
  set(DC_GL_LIBS OpenGL::GL Glfw::Glfw)
else()
  set(DC_GL_LIBS GL glfw)
endif()
target_link_libraries(dc_render PUBLIC ${DC_GL_LIBS})

# ---- dc_app: the executable (GL spike / game) ---------------------------------
file(GLOB DC_APP_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/app/*.cpp)
add_executable(dc_app ${DC_APP_SOURCES})
target_include_directories(dc_app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(dc_app PRIVATE dc_render dc_core ${DC_GL_LIBS})

# ---- dc_repro: headless repro/replay harness (no GPU) ------------------------
file(GLOB DC_REPRO_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/repro/*.cpp)
add_executable(dc_repro ${DC_REPRO_SOURCES})
target_link_libraries(dc_repro PRIVATE dc_core)

# ---- tests: Catch2 ported verification suite (headless, no GPU) --------------
file(GLOB DC_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)
add_executable(dc_tests ${DC_TEST_SOURCES})
target_link_libraries(dc_tests PRIVATE dc_core)

find_package(Catch2 3 QUIET)
if(Catch2_FOUND)
  target_link_libraries(dc_tests PRIVATE Catch2::Catch2WithMain)
else()
  target_include_directories(dc_tests PRIVATE /usr/include)
endif()

enable_testing()
add_test(NAME dc_tests COMMAND dc_tests)
# Headless sim gate: spawn/move/resolve a player through a generated dungeon
# with zero tunneling (no GPU). A real sim bug trips the ZERO-TUNNELING check.
add_test(NAME dc_repro_headless COMMAND dc_repro --seed 1000 --frames 120)
