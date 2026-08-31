# Fix plan — c++_dungeon_crawler (8 items)

Status: EXECUTING. Items 1/2/7 landed in commit `af2de48`. Item 4's axis
swap was drafted in the working tree but is **buggy** (see §4 below). Items
3/5/6/8 pending. Each item: root cause, fix, verification. Per-item commits.

## Current state (verified against code, 2026-08-31)
- **1, 2, 7 — DONE** (commit `af2de48`): death-screen `Save [S]` + title-screen
  `Continue [L]`, `_ngPlus()` keeps `floor(souls*0.25)` + live toll preview,
  `descend()` keeps `buffEffect` and resets `buffTime = kMaxDuration` (90 s).
- **4 — DRAFTED, BUGGY (working tree, uncommitted)**: the swing was switched to
  a rotation about **local Y** (the blade's own axis) so the blade tip doesn't
  move at all; needs the **local-Z** matrix + per-step angle retune.
- **3, 5, 6, 8 — NOT STARTED.**
- Build is green (warnings only); `--vault-view` smoke renders (50 fps).

---

## 1. No "Save" option on death   (DONE — af2de48)

**Root cause**: The C++ port dropped the JS death-overlay button. JS `index.html` has
`Save for later [S]` → `_saveForLater()`; the C++ death screen (`main.cpp:3062-3077`,
keys at `main.cpp:2634-2640`) only offers `[N] Restart` / `[Y] New Game+` / `[L] Continue`.
The save machinery itself exists and works (`_endRun` already writes `save.json` on
death; `loadRun()`/`[L]` restores it) — the option is just not exposed on the death
screen itself, and JS's `_saveForLater` (manual save anytime) has no C++ key binding
(S is taken by "walk back" movement).

**Fix**
- Death screen: add `Save for later  [S]` line under the `[N]/[Y]` hint; bind KeyS in
  the `Screen::Dead` branch → call the same save write path (`_endRun`-style save
  write without touching the leaderboard: extract `_writeSave()` out of `_endRun` so
  death, timeout and manual save all share it).
- Also add the same Save option to the Title screen (JS has it on both menus) —
  cheap, same code path.
- Confirm the `save.json` schema round-trips (it already does via `_readSaveFile`).

**Verify**: die (or use `--death-view`), press S, see the hint line, confirm
`save.json` mtime/content updates and `[L]` continues the saved level.

## 2. NG+ soul toll is 100%, should be 75% (keep 25%)   (DONE — af2de48)

**Root cause**: `main.cpp:2636` — `[Y] New Game+` does
`state.ngPlus += 1; startRun(...)` and `startRun` calls `GameState::fromOpts()` with
zero orbs. The JS reference `_ngPlus()` (`Game.js:288-305`) keeps
`Math.floor(s.collectedOrbs * 0.25)`, recomputes weapon tier from the kept bank,
keeps `bossKills`, `maxHealth`, `runTime`, and starts at `max(1, floor(level/2))`.

**Fix**
- New `App::_ngPlus()` mirroring JS: kept souls `= floor(collectedOrbs * 0.25)`,
  `weaponTier = weaponTier(kept)`, `ngPlus+1`, carry `bossKills`, `maxHealth`,
  `runTime`; start level `max(1, level/2)` (JS behavior — confirm with you in review,
  default = JS parity); regenerate dungeon for that level; full health.
- Death-screen hint text: show the toll live, like JS
  (`keep X of Y Souls → T<tier>`), so the 25% is visible before pressing Y.

**Verify**: `--death-view` with souls (e.g. 120 → keep 30 → T1 dagger… 30<50 →
T0; use 1000 souls → keep 250 → T3), press Y, assert souls == floor(0.25*old) via
stderr log + HUD.

## 3. Every enemy needs a health bar

**Root cause**: None exists; only the boss has a bottom-center bar (`main.cpp:3444+`).
Enemies are flat-color instances in the scene pass; enemy sim lives in
`SkeletonSystem::enemies()` (+ `Boss`, + BURN foe).

**Fix**
- In the scene instance pass (where enemies are pushed, ~`main.cpp:2300-2450`), for
  every live enemy/boss/burn: push two screen-space-ish world quads above the head:
  background (dark, full width) + foreground (colored, width = hp/maxHp).
  - World-space quads at head height (per-type top ≈ from the existing part list,
    e.g. 1.9u for mobs, 2.6u brute/boss), billboarded toward the camera each frame
    (camera basis already available in that pass — same `right/upv/fwd` math as the
    sword code, or reuse the dust/smoke billboard VAO approach).
  - Simplest robust path: reuse the camera-facing billboard quad VAO (the one used
    for smoke/dust, `kSmokeVert` style with per-instance pos3+scale2+color3+alpha)
    → one draw call per bar pair per frame, trivial count (< 40 live).
  - Color: bg `#1a0c0c`-ish dark, fg red `#c04838` (boss palette) — consistent with
    HUD boss bar. Show only when hp < maxHp (fresh spawns stay clean), always for
    boss/burn.
- No sim changes; render-only.

**Verify**: `--combat-view` / `--enemy-view` screenshots; damage one enemy, confirm
bar appears at the head and shrinks; confirm no bar at full HP for normal mobs.

## 4. Weapon swing is vertical — should be horizontal   (IN PROGRESS)

**Root cause**: `main.cpp` `swordW`/`swordRot` rotate the sword around local X
(`SwingX`), arcing the +Y blade in the vertical (Y/Z) plane. The JS original
(`PlayerSword.js:211-221`) animates `formGroup.rotation.z` (a big left↔right
sweep: step1 z 0.18→−1.72, step2 z −1.7→+0.2, step3 z=0.18 thrust) on top of a
base tilt `Euler(-0.35,-0.25,0.18)` — i.e. the blade sweeps **horizontally**.

**Working-tree bug (must fix)**: the drafted axis swap wrote
`Sw={ca,0,sa | 0,1,0 | -sa,0,ca}` with `lx2=lx*ca+lz*sa; lz2=-lx*sa+lz*ca` —
that is a rotation about **local Y** (the blade's own axis). Verified numerically:
the +Y blade tip is a fixed point, so the blade does not move at all (only the
guard spins). The correct horizontal sweep is a rotation about **local Z**:
`swordW`: `lx2=lx*ca-ly*sa; ly2=lx*sa+ly*ca; lz2=lz`; `swordRot`:
`Sw={ca,sa,0 | -sa,ca,0 | 0,0,1}`. Base-tilt then Ccam unchanged.

**Fix**
- Swap to the Z-rotation (matrix above) in BOTH `swordW` and `swordRot`; run the
  base tilt on `(lx2, ly2, lz2)` (currently `ly` is passed through unrotated).
- Retune per-step angles for the horizontal read (positive = blade LEFT):
  - rest `phi = −0.5` (keep, low-right via the baked base tilt)
  - step 1: wind up LEFT `a0=+1.30` → strike RIGHT `a1=−1.50`
  - step 2: wind up RIGHT `a0=−1.50` → strike LEFT `a1=+1.50`
  - step 3 (thrust): `a0=+0.50 → a1=−0.50` + keep the forward lunge
- Trail ghosts + impact flash reuse `swordW/swordRot`, so they follow
  automatically — verify flash plane + ghost arc after the swap.

**Verify**: mid-swing probe (step 1 & 2) — blade must be at the LEFT/RIGHT side
(horizontal), never overhead/underfoot; trail ghosts sweep horizontally.

## 5. Text 2× bigger + cleaner

**Root cause**: baked font at 24 px (`bakeFont`, P=24, single 512×256 atlas,
`GL_LINEAR`) with HUD sizes 0.40–0.6f (~10–15 px on screen) → tiny and soft at
non-integer scales.

**Fix**
- Bake at higher res: P=48 (2×), atlas 1024×512. Glyphs stay crisp when scaled down
  and are 2× oversampled when drawn at current sizes.
- Double all text `size` multipliers (title 3.0→keep as display, but HUD
  0.40/0.42/0.45/0.5/0.55/0.6/0.85 → ×2, boss label, toasts 0.6→1.2, combo/slot,
  death-screen stat lines). Where doubled sizes would overflow their panels, widen
  the panels (souls panel pw 150→~220, combat panel 172→~260) or wrap/shorten
  labels rather than shrink text.
- "Cleaner": keep the 4-way outline but scale its width to the larger glyph
  (`o = 0.18*size` already does that); add `GL_LINEAR_MIPMAP_LINEAR` + generate
  mipmaps so scaled-down text doesn't shimmer; bump outline alpha slightly.
- Title/death screens: bump those sizes proportionally too (they're the big text,
  "cleaner" mainly = crisper bake + mips).

**Verify**: `--hud-view` before/after screenshots at 1024×720; measure that no HUD
panel clips; `--title`/`--death-view` for the big text.

## 6. HUNTER buff is bugged — no visible effect

**Root cause** (three-fold, `main.cpp:1186-1202`):
1. The hunter is simulated (`hunter.update` fires `onHit`) but **never rendered** —
   no mesh, no beam in the scene pass. The only visual is the HUD badge
   `HUNTER 90s`.
2. `attackTimer` starts at 0 and `pos` at {0,0}; first frame the hunter is at the
   world origin 2.5u behind spawn (teleport), fine — but combined with #1 the
   player sees nothing.
3. Targeting uses `los()` to the enemy's feet; fine.

**Fix**
- Render the hunter in the scene pass: a wraith-style figure (reuse the existing
  wraith mesh builder from the enemy roster — it's already in the enemy draw code,
  call it with the hunter's pos + a fixed tint, e.g. blue-white `#9fefff`-ish to
  match T5 blade) standing 2.5u behind the player.
- Render the beam: on `hunter.beamFlash > 0`, draw a bright line/plane from the
  hunter to the last target (store `hunter.targetPos` + `targetId` on hit in the
  app lambda) — emissive quad like the exit-beam, alpha = beamFlash/kBeamFlash.
- Optional polish: bob while following, small arrival puff. (Keep minimal.)

**Verify**: force the buff (repro hook already sets `buffEffect` — extend the
`--hud-view`-style probe or a `--hunter-view` flag) → screenshot: companion behind
player + beam flash on hit; confirm damage lands (mob hp drops without player
action).

## 7. Buffs must survive the exit portal; countdown resets   (DONE — af2de48)

**Root cause**: `descend()` (`main.cpp:1165-1167`) explicitly clears
`state.buffEffect = 0; state.buffTime = 0;` (port parity with JS, which builds a
fresh `GameState` on `_descend`).

**Fix**
- In `descend()`: keep `state.buffEffect`, set `state.buffTime = dc::buff::kMaxDuration`
  (full 90 s reset — boss-buff 300 s also resets to its own original? simplest +
  consistent: reset to `kMaxDuration` 90 s for all, like a re-picked buff).
  Keep `hunter.active` (don't reset) — the companion walks through the portal with
  you.
- Death-screen/NG+ and `loadRun` keep clearing the buff (unchanged — load parity).

**Verify**: apply a buff (probe or kill a breakable until one drops), descend via
`--descend-view` path, assert `buffEffect` unchanged and `buffTime == 90` from the
HUD badge; confirm hunter buff specifically keeps the companion alive through the
portal (ties into item 6).

## 8. Wall/floor variety + more breakables/diversity

**8a — different walls & grounds**
**Root cause**: `World::buildInstanceData` (`main.cpp:513+`) tints one shared cube
texture set per biome (`aColor` per instance); the shader (`kLitFrag` 220-240) adds
only a procedural `stoneDetail` noise — so every biome has one wall tile + one
floor tile.

**Fix** (procedural, no new assets):
- Extend `kLitFrag` with a tile-pattern selector driven by world position:
  e.g. `int pat = hash(floor(wp.xz / (cs*2)))` → per 2×2-cell block: variant A
  (plain), B (horizontal course lines — mortar grooves: darken by
  `fract(wp.y / courseH)` bands), C (vertical buttress ribs), D (diagonal
  herringbone floor for ground tiles), E (checker 1u tiles).
- Walls: 3-4 variants; floors: 3 variants (plain, herringbone, plank/stripe along
  room axis). Variants pick from the same biome palette (light/dark mixes) so color
  consistency is untouched — only pattern geometry changes.
- Keep it in the fragment shader (cheap, no geometry changes); ensure the pattern
  is stable per cell (quantize to cell coords, not raw wp, to avoid seams at
  block borders).
- Room-type accent: VAULT floor gets the checker, HALL the herringbone, chambers
  plain — small per-room bias on top of the hash for authored-feel.

**Verify**: `--vault-view` + regular level screenshots across 3 biomes; confirm
multiple distinct wall patterns and ≥2 floor patterns visible per screen.

**8b — more breakables + diversity**
**Root cause**: `DropSystem::buildLevel` — 1–3 per non-HALL room
(`kBreakablesPerRoom = 3`), single visual (one brown cube `main.cpp:2093`),
`breakProp` gives only buff-or-orbs.

**Fix**
- Constants: `kBreakablesPerRoom` 3 → 4-5 (range 2-6 per room), `kMaxPerLevel`
  400 → 600 (VBO has 1400-instance cap with headroom — recompute worst case in
  the capacity comment).
- Diversity: add a `kind` field to `Breakable` (drop_system) with 4-5 types,
  each with its own size/shape/color/drop table:
  1. Crate (existing brown cube, 1 HP) — orbs
  2. Barrel (taller cylinder-ish box, orange-ish, 1 HP) — orbs, +15% health drop
  3. Keg/pot (short wide, blue-gray, 1 HP) — orbs ×2
  4. Bone pile (low wide, bone-white, 1 HP) — guaranteed 1 health drop + orbs
  5. Supply chest (VAULT/ARMORY only, gold-trimmed, 2 HP) — guaranteed buff orb
- Drops wired through the existing `breakProp` roll table (per-kind overrides).
- Render: per-kind push in the scene pass (sizes/colors differ); breakable hit
  check unchanged (step-break + sword arc already hit the vector).
- Sarcophagi unchanged (already per-CRYPT).

**Verify**: `--drop-view` screenshots; count props per room via stderr dump
(`cpp_dump` tool) — assert ≥ avg 3/room and ≥3 distinct kinds per level; confirm
chest needs 2 hits and always drops a buff.

---

## Build / test gates (all items)
- `cmake -B build && cmake --build build` clean, then the existing smoke views
  (`--hud-view --death-view --title --descend-view --combat-view --drop-view
  --vault-view`) render without GL errors.
- `tests/` suite + `tools/cpp_dump.cpp` for the new breakable kinds.
- Commit per item (8 commits) into the parent repo, following the existing
  commit-message style.

## Open questions (defaults chosen; say the word to change)
1. NG+ start level: JS parity = `max(1, floor(level/2))` (dies at L12 → NG+ starts
   L6). C++ currently restarts at L1. **Default: JS parity (L/2).**
2. Buff countdown reset on portal: **default 90 s (kMaxDuration)** for every buff,
   including the 300 s boss one (simpler + consistent; alternative: preserve the
   buff's own original duration).
3. Save key on death: **S** (JS parity; S is movement in-game but the sim is
   frozen on the death screen, so no conflict there).
