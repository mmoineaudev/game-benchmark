# Entity 3D Representation Redesign — Plan

**Project:** `~/Documents/games-benchmarks/dungeon-crawler-visual`
**Scope:** Full 3D coherence — enemies, player first-person weapon, projectiles, drops, props, breakables, structure, world objects.
**Goals:** More realistic, more detailed, more coherent. AI-art direction = **stylized dark-fantasy with exaggerated, readable silhouettes** + **a layer of realism** (finer subdivision, edge loops, slope shading).
**Asset rule:** Procedural only. A shared procedural material/texture library module is allowed (honors spec §10 "no external assets"). No binary/glTF/fbx imports.
**Constraints honored from prior work:**
- **No vision tool** — all QA via headless console, WebGL-error checks, DOM probes, and geometry/log assertions (user cannot see screenshots).
- **Perf-sensitive:** fluid gameplay with a **30 fps floor**, `MAX_ALIVE` = 16 enemies, 8-torch shadow budget. Every realism gain must be provably within budget.
- All geometry built from **primitives**; all animation is **damped procedural** (no skeletal skinning / no external rigs).
- Keeps the existing Dark-Souls-ish dark-fantasy palette and per-entity color constants in `Constants.js`.

---

## 1. Current state assessment (what is to be improved)

Everything is built from untextured `MeshStandardMaterial` primitives. The main weaknesses, grouped:

### 1.1 Silhouette / readability
- Most enemies read as **boxes-on-boxes**; ribs are torus arcs but limbs are plain boxes with hard edges.
- **Rat** is 3 squashed spheres + a cylinder tail — reads as a blob at combat distance.
- **Wraith / GhostBoss / Burning** are translucent cones/spheres with little interior structure — realistic *form* is missing (cloak folds, limb suggestion).
- Enemy-vs-enemy silhouettes are distinguishable only by color + a single accessory (shield/hood/club). At 10+ units with fog they blur together.

### 1.2 Coherence (the biggest gap)
- **Scale/proportion inconsistency:** `Skeleton` is ~1.0–1.1 u tall; `Brute` scales the whole group ×1.6 (clipping into walls/ceiling at 4 u height); `GhostBoss` cone is 3 u tall; the **player has no body** — only a detached floating dagger (no hands, no arms, no visible torso). First-person arms are the single most jarring incoherence.
- **Materials are ad-hoc:** each entity defines its own `MeshStandardMaterial` with hardcoded rough/metal coords and ad-hoc color hexes duplicated across files (bone color is repeated everywhere). No shared material vocabulary → tonal incoherence.
- **No shared construction vocabulary:** each class has its own `_mesh`/`_bone` helpers with subtly different conventions (a real `bones` group system exists in `Skeleton.js` but isn't generalized to Rat/Wraith/Burning/boss).
- **Lighting awareness is inconsistent:** enemies don't get ambient-occlusion-style shading; translucent enemies ignore shadow entirely (correct) but no fake-AO or rim to ground them.

### 1.3 Detail / realism
- No normal/roughness maps anywhere (flat shaded primitives; edges catch no highlight variation).
- No secondary animation (no idle cloaks swaying, no cloth/leather, no chains reacting, no enemy breathing vs. dormant distinction beyond one scale pulse).
- Props are single/low-detail meshes (barrel = cylinder + 2 rings; chain = plain pillar; banner = flat plane, no hanging cloth).
- Projectiles are bare spheres/cylinders — no travel streak falloff, no illumination glow at the surface, no impact particles (only orbs have this via sprites).
- Drops (orb, health cross, buff octahedron) are clean and readable but stylistically disconnected from each other and from the world.

### 1.4 Grounding / presentation
- `_ground()` computes a `Box3` to rest the lowest vertex on y=0 — works, but entities are float-registered; no soft contact shadow / contact darkening is emitted under them.
- Eyes/glows rely on additive sprites; these are readable but don't "sit" in the world (no occlusion-driven flicker, no chromatic touch).

---

## 2. Design pillars (the target art direction)

1. **Dark-fantasy, stylized, readable.** Exaggerate the one thing that identifies each enemy (Skeleton = skull+ribs, Armored = heavy plate silhouette, Archer = hood+bow arc, Brute = bulk+club girth, Wraith = hooded phantom, Rat = scuttling vermin, Burning = wreathed in flame). Make each silhouette readable in a 1-frame glance against fog.
2. **Ground with a shared ruleset, not magic numbers.** One material library, one bone/rig convention, one proportion ladder, one shading pass.
3. **Add a realism pass** on top of the stylization: finer subdivision on key forms, chamfered/beveled edges, procedural normal + roughness maps so light actually plays across surfaces, subtle secondary motion.
4. **First-person presence.** Give the player hands/arms and a proper weapon so the POV reads as a body in the world, coherent with the enemies.
5. **No visual QA by screenshot.** Every change verifiable headlessly (geometry counts, material params, bounding boxes, silhouette occlusion probes).

---

## 3. Proposed architecture (new modules)

Introduce shared modules so all existing classes inherit the gains (this is how we get "coherent" without touching each class's AI/behavior):

```
src/core/
  Materials.js            (NEW)  shared procedural material + texture library
src/entities/
  Rig.js                  (NEW)  generalized articulated bone rig + damp helper (extracted from Skeleton.js)
  Proportion.js           (NEW)  shared proportion ladder / unit scale constants
  Looks.js                (NEW)  per-entity visual "look" descriptors (color, armor, accent) that pull from Constants
  ContactShadow.js        (NEW)  cheap blob/soft shadow + grounding helper
```

### 3.1 `Materials.js` — the shared material/texture library
Procedural canvas-generated maps for realism, cached and shared (one instance per material, not per mesh):

- `makeBone(hex)` → meshstandard, roughness ~0.7, **canvas normal map** of subtle pits/ridges + roughness map with slight variation.
- `makeMetal(hex)` → metalness ~0.85, anisotropic-ish normal streaks, roughness noise.
- `makeCloth(hex, foldTex=false)` → weave normal, high roughness.
- `makeLeather(hex)` → fine grain.
- `makeSkinFlesh(hex)` / `makeHide(hex)` for rat/brute.
- `makeGlassCrystal(hex)`, `makeFlameCore(hex)` (additive basic + normal no-op).
- `makeStone(hex)` for structural props.
- Helper `generateNormalMap(seed, style)` / `generateRoughnessMap(seed)` — canvas noise → `THREE.CanvasTexture`, `repeat` appropriate to the mesh, `needsUpdate` once, cached by key.
- Each material clone keeps its own `.opacity` for death-fade (preserves the current transparent fade pattern).

This kills the ad-hoc `new MeshStandardMaterial({color:...})` scattered across every file and unifies tone/roughness/metalness vocabulary.

### 3.2 `Rig.js` — generalized bone rig
Extract and generalize the working rig from `Skeleton.js` into a reusable, documented rig:

- `Rig.group`, `Rig.bone(name, parent, pos)`, `Rig.mesh(geo, mat, parent, pos)`, `Rig.damp(obj, field, target, lambda, dt)`.
- Standard named-joint layout (`root, pelvis, spine, ribcage, head, armL/R, forearmL/R, legL/R, shinL/R`) so every humanoid (Skeleton, Armored, Archer, Brute, Magician) shares the exact same 12-joint skeleton. Subclasses add accessories to the standard joints → instant proportion & behavior coherence, and shared walk/attack/death pose code can be lifted into `Rig`.
- Keep `bones` map API identical so `SkeletonSystem` / existing update callbacks are untouched.

### 3.3 `Proportion.js` — shared proportion ladder
One canonical height/width budget for the humanoid family and for creatures:

- Standard humanoid ~1.05 u (hips at 0.95, head ~0.15 radius) — keeps current numbers, but **documented** and reused.
- `Brute` scale becomes an explicit proportion set (broad torso, short thick limbs) rather than blind `group.scale` that risks wall-clipping.
- Provides `bounds(entity)` for the `_ground()` and contact-shadow helpers.

### 3.4 `Looks.js` — one visual descriptor per entity
A table keyed by enemy type that centralizes accessories so the builder classes read declaratively:
```
LOOKS = {
  SKELETON: { bone: BONE, weapon: 'SWORD', eye: EYE_GLOW, ... },
  ARMORED:  { bone, armor:'CHESTPLATE+KITESHIELD+HELM', weapon:'AXE', trim: gold },
  ARCHER:   { bone, hood, weapon:'BOW', quiver },
  BRUTE:    { bone, cloth, weapon:'CLUB', flash },
  WRAITH:   {...phantom}, RAT: {...}, BURN: {...}
}
```
Reduces duplicated "if elite then color else color" branches; keeps `Constants.js` as the single numeric source of truth.

### 3.5 `ContactShadow.js` — grounding
Cheap radial-gradient blob under every entity (a `MeshBasicMaterial` black sprite or a dark circle mesh, `opacity` ~0.25, `depthWrite:false`) that scales/fades with the entity's bobbing and moves with it. Improves "real" groundedness with essentially zero perf cost, and is trivially verifiable headlessly.

---

## 4. Per-entity redesign detail

### 4.1 Shared humanoid (Skeleton + subclasses)
Using `Rig` + shared pose:
- **Geometry realism pass:** replace hard-edged `BoxGeometry` limbs with slightly-subdivided forms. Give tibia/femur slight taper (`CylinderGeometry` with top/bottom radius) instead of boxes; add small joint spheres at elbow/knee so the silhouette reads as articulated bone rather than sticks. Keep total tri count modest (see budget §6).
- **Skull:** higher-subdivision sphere (16×12), subtle flattened cheekbones via scaling, recessed eye sockets with the existing additive eye + a small rim-light socket; keep jaw, add nasal aperture box cut (visual via dark inset, not boolean).
- **Ribs:** keep the 4 torus arcs but increase radial segments (8→10) and add a subtle `flatShading`-off smoothing; do NOT make them heavy.
- **Walk/attack/death poses:** refactor into `Rig` shared pose functions so Armored/Archer/Brute/Magician all get identical gait cadence, differing only in speed & amplitude. This is the single biggest "coherence" win.
- **Hood/magician:** reuse `Rig` head joint; hood gets a slight cloth fold (add a second overlapping cone segment + fine normal map).

### 4.2 ArmoredSkeleton (Warlord elite)
- **Chestplate:** replace flat box with a form-fitted plate: curved chest using a scaled/rounded box with a displaced front panel + rivet row (small spheres), gold trim on elite. Add pauldron (shoulder cap) geometry on both arms.
- **Shield:** replace box with a proper kite shield: `ConeGeometry` tapered tip + rounded top (`SphereGeometry` slice or `LatheGeometry`), boss center (sphere), metal normal map. Keep it on `armL`.
- **Helm:** cylinder → rounded great-helm: tapered `CylinderGeometry` + brow plate + cheek guard boxes; open face retains the skull + eye glow.
- **Axe:** replace flat blade with a bearded axe: `LatheGeometry`/extruded silhouette, edge highlight via normal map.

### 4.3 ArcherSkeleton (Sharpshooter elite)
- **Bow:** proper recurve — two curved `LatheGeometry`/`TubeGeometry` limbs + a visible string that **visibly draws** during the windup (string Y-pulls back as `windup` progress p goes 0→1 — pure positional anim, easily verified, big realism win over the static string).
- **Quiver** (currently missing even though spec §5.3 lists it): add a `CylinderGeometry` quiver on the back with 3–4 visible arrow shafts + fletching cones; bow-tip glow on the drawn arrow.
- **Hood:** cloth-fined, red on elite.

### 4.4 Brute (Ogre elite)
- Stop using blind `group.scale` (risk). Build **proportionally wider/thicker** via `Proportion.js`: broad shoulders (wider ribcage+clavicles), thick short forearms, heavy pelvis.
- **Tunic:** torn cloth cylinder → layered: an under-tunic + torn over-layer with ragged edge; cloth normal map, subtle idle sway (breathe).
- **Club:** keep girthy head but add texture (grooves via normal map); keep the orange emissive telegraph.
- **Slam shockwave** (§ present) stays; add a small dust/contact puff at ground on impact (Cloth→particles) for realism.

### 4.5 Wraith (Banshee elite)
- Replace bare cone with **hooded phantom**: a `LatheGeometry` cloak silhouette (flared hem, pointed hood) + inside a faint suggestion of a hooded head (dark sphere) + 2 bright eyes. Cloak hem oscillates (sin waves on a couple of rim meshes) for "floating" realism.
- Keep additive translucent bodyMat, depthWrite false, no shadow.
- Improve trail wisps: keep 3 sprites (perf) but add slight per-wisp size/opacity jitter tied to `bob`.

### 4.6 Rat (pack)
- Realistic-but-cheap quadruped: elongated body (scaled sphere → better a `CapsuleGeometry` oriented) + **separate head that bobs up/down** on a short neck, 2 ears (small spheres/cones), **4 short legs** (tiny cylinders that scuttle — alternate phase = high-realism cheap win), a **proper tapered tail** that whips (curved via segmented cylinders or a `TubeGeometry` with sin bend), 2 red eye points.
- Keep toxic-green emissive + glow (readability) but ground it with the contact shadow.
- Keep the flop-on-side death but make it flip properly (rotate around the long axis).

### 4.7 Burning
- Add **procedural flame envelope**: 3–5 stacked additive cone/plane "flames" of varying height/sin flicker around the black body (currently just one glow sprite) — big realism gain for near-zero cost (small geometry, additive).
- Refine the black body: give it a vaguely humanoid taper + ember cracks (emissive noise) instead of a plain box; keep red eyes + core glow.
- Death already sinks/fades; add ember particle scatter.

### 4.8 GhostBoss (7 variants)
- Keep the charge/summon AI untouched. Visual pass:
  - Cone body → **spectral cloak** (`LatheGeometry` flare) + a crown/horn suggestion per variant so each boss variant reads distinctly (e.g., BONE LORD gets antler horns, ASH TITAN gets broad shoulders, LICH gets a hooded crown).
  - Refine core as a bright hollow orb; add faint inner teeth/jaw hint for SKELETON variant.
  - Keep additive, no shadow, keep glow halo; increase rim on the head to pop the eyes.
  - Ensure each `BOSS_VARIANTS` color maps through the shared material library for tonal coherence with that enemy family.

### 4.9 Player: first-person arms + weapon (biggest coherence fix)
The POV currently has **no body** — a floating dagger. Add a first-person layer 2 rig:
- **Hands/arms:** two low-poly gloved hands (dark leather material) + forearm sleeves that hold the dagger, attached to the camera on layer 2 (same as the dagger → the ×10 headlight still won't light them; emissive keeps them readable). Hands follow the dagger's melee keyframes (grip anchored, wrist rotates through the combo).
- Keep the current combo state machine, trails, sparks, smoke, danger/growth glows — just parent them relative to the hand grip instead of the bare group.
- **Held fireball (buff):** keep, but add 2–3 orbiting flame motes for realism.
- Arms must be *non-blocking* (stay low/right, never cover the crosshair) — enforce bounds headlessly (assert hand never enters the center 8% of screen).

---

## 5. Projectiles, drops, and effects

- **Player orb:** keep sphere+glow, add a subtle **elongated travel streak** (additive stretched sprite aligned to the velocity vector) that the existing smear approximates — refine into a proper oriented trail, plus tiny flicker on the mesh emissive while in flight.
- **Fireball:** keep; add swirling flame cone + ember particles on impact.
- **Archer arrow / magician orb:** give arrows a small fletching cone + a faint travel glow; magician orbs inherit the shared emissive-orb material.
- **Explosion rings:** existing torus is fine; add a brief interior flash sphere on detonate for a blast core.
- **Brute shockwave:** existing ring; add a dust ring (fainter, slower-second, second color) for layered realism.
- **Drops:** standardize the three pickups on the **shared material library** (orb=blue emissive, health=red emissive cross, buff=gold emissive octahedron). Add a subtle orbiting light accent so they read as "loot" consistently. Keep pooling.
- **Death burst:** current purple bubble-pop; upgrade to a **purple flame + bone-chunk scatter** (a few additive shards + a few solid bone-colored chips) so skeletons "shatter" rather than just dissolve — verifiable via particle count.

---

## 6. Budget & performance (30 fps floor — mandatory gate)

- Target: keep live render cost **≤ current + ~10–15%**. The current game holds 30 fps with 16 enemies + 8 shadow torches; every redesign item must be bounded.
- **Geometry caps per entity** (enforced in code + asserted headlessly):
  - Humanoid bone rig: ~160–220 tris (currently ~90–120). Keep under 300.
  - Rat: ~120 tris. Wraith/Boss/Burning each under ~350 tris (largely untextured translucents are cheap).
  - First-person arms: ~250–350 tris total (they're layer-2, constant, no shadows).
- **One shared material per type** (via `Materials.js` cache) — no per-entity material allocations except the necessary color clones for death-fade. Canvas normal/roughness maps generated **once** and reused.
- **No new shadow casters.** All realistic shading comes from normals/roughness + existing lights. Contact shadows are sprite/blob (no shadow map).
- **No new per-frame allocations:** all new secondary motion (cloak sway, rat scuttle, flame envelope) uses existing `animTime`/precomputed meshes; no `new` in the hot loop. New transient effects (embers, bone chips) go through **existing pooled arrays** (the pattern already used by bursts/shockwaves).
- **Verification gate (headless):** a `scripts/entity-budget-check.mjs` asserts per-entity tri counts, draw-call counts (shared material dedup), and that no entity allocates in `update()`. Any regression fails the check.
- Textures: all canvases ≤ 128×128, ≤ 3–4 unique textures per biome/entity family; reused across instances.

---

## 7. Verification strategy (headless — no vision)

Since you cannot view screenshots, every step yields a **console/geometry assertion**:

1. **Per-entity progress/migration check** (`scripts/entity-qa-check.mjs`): for each enemy + prop + weapon, assert it now uses the shared `Materials.js` + `Rig.js` and has a `Look` entry; print tri/draw-call budget.
2. **Silhouette / grounding probe:** instantiate each entity in an isolated headless scene (a small node harness with `three`), raycast a few fixed angles, assert the bounding box is within the expected 1 × 1 × height envelope and the lowest vertex rests on y=0 (the existing `_ground` logic, now unit-tested). This is the "readability/silhouette" check done blind.
3. **Proportion ladder:** assert `Brute` fits within wall height (4 u) without clipping, and `GhostBoss` variants differ from their base enemy's bone color (already the case) — extended to assert distinct silhouette metrics per variant.
4. **No per-frame allocation:** instrument `update()` once (a toggle counting `new`), assert zero allocations after the scene warms up.
5. **WebGL-error check** via the existing headless launch harness (load the built `dist`, watch console for red errors / `THREE.*` warnings).
6. **FPS smoke test:** run the game loop headless for N frames, assert frame deltas stay within the 30 fps floor envelope.

---

## 8. Coherence checklist (definition of "done")

- [ ] Every 3D entity uses `Materials.js` (no ad-hoc duplicated material hexes/rough/metal).
- [ ] Every humanoid uses the **same 12-joint `Rig`** with shared pose functions; subclasses add accessories only.
- [ ] `Looks.js` centralizes each enemy's visual identity; `Constants.js` remains the numeric source of truth.
- [ ] Proportion ladder (`Proportion.js`) replaces all blind `group.scale` (Brute no longer risks wall-clip).
- [ ] All entities grounded with a contact shadow.
- [ ] Player has first-person hands/arms + kept weapon (dagger / buff fireball), non-blocking, layer-2.
- [ ] All projectiles/drops/effects use the shared material library and pooled transient arrays.
- [ ] Canvas normal/roughness maps generated once, cached, ≤128².
- [ ] All headless checks pass (budget, grounding, proportions, no-alloc, WebGL-clean, 30 fps).

---

## 9. Phased implementation order

**Phase A — Foundational modules (no visual change to gameplay):**
1. `Materials.js` (procedural normal/roughness + cache).
2. `Rig.js` (extract & generalize skeleton rig/poses).
3. `Proportion.js` + `Looks.js` + `ContactShadow.js`.
4. Wire them in as drop-in (existing classes refactored to use them with identical geometry) → **run all existing scripts to confirm zero regression** (`boss-check`, `dungeon-check`, `orb-economy-check`, `sword-death-check`, `buff-system-check`, `sprint-accel-check`).

**Phase B — Enemy realism pass (one type at a time, verified each):**
5. Shared humanoid (Skeleton, Magician).
6. ArmoredSkeleton + Warlord.
7. ArcherSkeleton + Sharpshooter (incl. bow string draw + quiver).
8. Brute + Ogre (proportion ladder, tunic layer).
9. Wraith + Banshee (cloak).
10. Rat (quadruped scuttle).
11. Burning (flame envelope).
12. GhostBoss 7 variants (distinct silhouettes).

**Phase C — First-person presence:**
13. Hand/arm rig + grip parenting of dugger combo, fireball buff.

**Phase D — Props / structure / world coherence:**
14. Breakables (barrel/crate) detail + shared wood/band materials.
15. Structural (pillars, bookshelves, sarcophagi, weapon racks) — fine normals, consistent stone.
16. Decoratives (chains, banners→cloth sway, skull piles→bone mat, webs, blood, stalactites, rubble, wisps) via shared library.
17. Projectiles/drops/effects pass (streaks, blast core, bone-chunk death, standardized loot).

**Phase E — Budget hardening & final verification:**
18. `entity-budget-check.mjs` + full headless regression + 30 fps gate. Commit once green.

Each phase ends with the relevant headless check passing and a commit, so any regression is localized and reversible. Final deliverable is a fully coherent 3D entity set verified blind.

---

## 10. Open items to confirm before implementation (already asked)
- [x] Scope = everything 3D (full coherence) — **user confirmed.**
- [x] Art direction = stylized dark-fantasy + realism layer — **user confirmed.**
- [x] Detail technique = procedural + shared material/texture library — **user confirmed.**

Remaining minor notes assumed (flag if you disagree):
- Keep the existing color constants and the Dark-Souls-ish dark fantasy palette; no brightening.
- First-person hands/arms will be dark leather gloves (matches dagger grip) so they don't distract.
- New transient particles all reuse existing pools (no new GPU allocations in hot path).
