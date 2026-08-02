Generate a standalone HTML file using pure WebGL that creates an interactive "NEON GEOMETRY CORE" experience.


- Three.js . Embed all vector/matrix math helpers.
- Central "Core" object: a morphing geometry (sphere → cube → torus → icosahedron) driven by a time-based vertex shader displacement.
- Orbiting satellite geometries: 4 unique primitives (cylinders, cones, octahedrons, helix lines) that react to user input with physics-like attraction/repulsion.
- Advanced lighting: dynamic volumetric-style light shafts (via shader tricks), 12 colored point lights forming a cyberpunk color palette that users can reassign, plus a pulsing directional "reactor glow" light.
- Shaders: 5 different fragment shaders (neon wireframe, holographic transparency, glitch distortion, data-stream overlay, retro phosphor glow). Main shader includes Fresnel rim, subsurface scattering approximation for glow, and scanline modulation.
- User inputs & interactivity:
  • Mouse drag = rotate entire scene around the Core
  • Scroll = scale the Core and satellites
  • Click on any geometry = "capture" it (highlights + pulls it to center) and displays floating sci-fi stats in a DOM panel
  • Keyboard Q/E = rotate selected object on its axis
  • R = randomise all light colors and positions
  • T = trigger a full-screen "reality glitch" effect (temporary shader chaos + particle explosion)
  • Number keys 1–4 = instantly switch core morphology
- Particle system: 100+ glowing data particles that flow along geometric paths and react to light colors.
- Retro UI: semi-transparent holographic control panel (CSS) with neon buttons, sliders for light intensity.
- Theme: deep black background, vibrant neon cyan/magenta/purple, Matrix-style digital rain subtly layered in the background shader.

Output the complete HTML code in /home/neo/Documents/webGL-test/NEON_GEOMETRY_CORE_$(date + "%Y/%m/%d") .
