# VOID WARBAND — Complete Player Documentation

Everything the player is supposed to DO, FIGHT, and SEE in the whole game.
Written after the post-playtest fix round (sun reference, station trading,
input remap, breakables, reticle colors, enemy density).

---

## 1. The Loop (30-second summary)

Fly out from the SUN → fight enemies → loot their wreckage and shootable
props → return to a SPACE STATION to bank cargo, repair, and trade → spend
scrap in the HANGAR on permanent upgrades → launch deeper along the sector
ladder → everything you carry is LOST if you die → the run culminates in
THE FORGE, a fight against THE WARDEN.

---

## 2. World & Navigation

### The Sun
- A colossal star sits at the world origin — by far the biggest entity in
  the game (1,200 u core radius; a station's whole interaction bubble is
  120 u). The player spawns ~3,000 u from it — near it, never inside it.
- The sun is ALWAYS visible: a huge bright core + corona, plus a screen-space
  marker dot that never disappears regardless of distance. It is the
  orientation reference: turn around, find the sun, and you know where home
  is.
- HUD distance ("Open Space · 3000u") is measured FROM the sun — it has a
  concrete meaning: how far out you are.

### The sector ladder (fly outward = away from the sun) — distances ×3
| Distance from sun | Sector | What you see / face |
|---|---|---|
| 0 – 9,000 u | Open Space | Blue-grey space, drones, first station, spawn safety zone |
| 9,000 – 12,000 u | Void (1) | Empty black travel zone — breathing room |
| 12,000 – 24,000 u | Asteroid Belt | Rock fields (solid, collision damage), mines, +rammers |
| 24,000 – 28,500 u | Void (2) | Empty; rare void treasure caches |
| 28,500 – 42,000 u | Crystal Fields | Cyan-magenta crystals (destructible), pulsars, +frigates |
| 42,000 – 48,000 u | Void (3) | Empty |
| 48,000 – 63,000 u | Plasma Storm | Storm clouds with lightning, minefields, stat ×2.0 |
| 63,000 – 70,500 u | Void (4) | Empty |
| 70,500 – 85,500 u | Derelict Graveyard | Wreck hulks (destructible), ambush drones, +snipers |
| 85,500 – 94,500 u | Void (5) | Final approach |
| 94,500 – 120,000 u | THE FORGE | Red-gold megastructure debris; THE WARDEN finale arena |
| 120,000 – 150,000 u | THE ABYSS | Violet void filled with BLACK HOLES — gravity pulls you in (stronger when closer, event horizon = 60+ dmg/s). Home of the CHROME SENTINELS: mirror-alien darts hunting in 5-ship V-wing fleets, strafing runs with phase-cascading weaves. Rare-leaning loot. |
| 150,000 – 190,000 u | DEAD STAR REACH | Cold dark space haunted by DEATH STARS — massive battlestations (90 u hull, glowing green trench) that cruise with boost-thrust accelerations and brake-hard sharp turns, fire red lasers from 4 batteries (900 u range), and launch interceptor waves from their hangar bays every 6 s. |
| 190,000 – 230,000 u | THE SHIP GRAVEYARD | Bone-rot murk choked with broken-ship wrecks (torn hulls, fin plates, bent masts, slow tumbling) — and LONG ALIEN WORMS (10-segment serpentine chains with glowing orange maws and bioluminescent body rings) that hunt the player in 600 u range and BITE (25 dmg, then recoil to swallow). |
| 230,000 u+ | THE END | The universe is dead. Pure black, near-starless, NOTHING spawns. The hull decays 4 HP/s after an 8 s grace — a silent countdown. How far can you go before the decay wins? |

- Stat scaling (post-review): enemy **damage** grows +0.25 per *content*
  sector (voids skipped) — Forge ×3.0, Abyss ×3.25, Dead Star ×3.5,
  Graveyard ×3.75; enemy **HP** caps at ×2.25 at sector 6, then resumes at
  half-rate (+0.125/sector) — Graveyard ×2.63, THE END ×3.13.
- Stations: rarity decays with distance from the sun, BUT every content
  sector has one GUARANTEED station at its midpoint.
- Stat scaling is linear per sector: ×1.0 → ×2.25 capped at sector 6 — no
  snowball cliffs.

---

## 3. Controls (post-remap)

| Action | Input |
|---|---|
| Aim / steer | Move the mouse — the ship noses toward the cursor |
| Throttle | Mouse wheel up = accelerate, down = brake (full down = retro-burn) |
| Fire | **Left click (hold)** — pulse autocannon at the cursor |
| IEM burst | **Middle click (tap)** — AoE around the ship, 5 s shutdown after |
| Missiles | **KeyF** — 3×5 autoguided homing salvos, 6 s reload |
| Free look | **KeyG (turret mode)** — ship holds course, aim follows mouse 360° |
| Roll | KeyQ / KeyE |
| Boost | **Shift** — ×2 speed, 4.5 s burn, 8 s cooldown. The engine reactors turn RED while boosting/recharging and return BLUE when ready. |
| Station trade | **KeyH** near a station — bank + open the trade menu (pauses) |
| Collection log | Tab |
| Pause / Help | P, F1, or Escape |
| Restart | R (death screen only) |

---

## 4. HUD — what you see

- Top-left: HULL (red) and SHIELD (blue) bars; shield regenerates 3 s after
  the last hit.
- Status line: SCRAP, CARGO x/max, sector name + distance FROM THE SUN, KILLS.
- Crosshair follows the cursor; ring highlights in turret mode.
- Bottom-right: IEM (MMB) and MISSILES (RMB) cooldown chips.
- Boss HP bar (top center) while THE WARDEN is alive.
- Toasts: pickups, discoveries, banking.

### Target reticle color code (AR brackets)
- **RED brackets** — enemies (hostile, will attack you).
- **ORANGE brackets** — breakables (shoot them: chance of loot).
- **WHITE brackets** — lootable pickups (fly close — auto pickup).
- Nearest target's name + interaction hint shows bottom-left.

---

## 5. Combat — what you fight

### Enemies — ships from rival manufacturers
Each of the 8 types is a distinct hand-built ship silhouette:
| Enemy | Ship | Manufacturer look |
|---|---|---|
| Drone | Wedge hull + spore pods | Vespid hive swarm-craft |
| Interceptor | Racing needle + swept fins | Aurora Corp |
| Rammer | Boxy tug + breaching bumper | Kessler Industrial |
| Frigate | Heavy slab gunship + gun pods | Kessler Industrial |
| Sniper | Thin rail needle + stabilizer rings | Aurora Corp |
| Golden Drone | Gilded yacht + tail fins | Aurora Corp |
| Chrome Sentinel | Mirror-polished dart + violet glow fins | The Abyss endemic (fleets of 5) |
| Sentinel | Mini-boss core + rotating ring | — |
| THE WARDEN | 3-phase finale boss | — |

| Enemy | Sector | Behavior | Threat |
|---|---|---|---|
| Drone | 1+ | Swarms (2–5), seeks contact | 5 dmg on touch |
| Interceptor | 1+ | Orbits at 250 u, fires 1.5/s | 12 dmg shots |
| Rammer | 2+ | Charges, detonates at 5 u | 25 AoE, self-destructs |
| Frigate | 3+ | Stationary heavy turret | 20 dmg, 0.8/s |
| Sniper | 4+ | Cloaked beyond 600 u, telegraphed rail beam | 30 dmg every 4 s |
| Golden Drone | 1+ (cameo S4+) | FLEES — 250 scrap bounty | None, but fast |
| Sentinel | every sector exit | Mini-boss: 5-shot spread bursts + summons 4 drones/12 s | 400+ HP |
| THE WARDEN | THE FORGE | 3-phase finale: barrage → minefield+drones → sweeping enrage beams | 3,000 HP |

All enemy types glow (per-type color, e.g. red drones, teal snipers, gold
golden drone, purple sentinel) so they are visible at any distance.
Deeper sectors: bigger packs (2–5), richer type mix, occasional golden-drone
bounty cameos.

### Breakables (cosmetics you can shoot) — 4 prop models with loot bias
- **Cargo Container** (ribbed freight crate, 80 HP): raw resources — scrap,
  plates, coolant.
- **Cargo Pods** (tethered pod cluster, 50 HP): consumables — ammo, hull
  patches, shield cells.
- **Satellite Wreck** (dish + solar panels, 60 HP): tech — data fragments,
  weapon mods.
- **Defense Buoy** (armored sphere + spikes, 100 HP): weapons — ammo cells,
  weapon mods, cores.
- Each: 65% chance to drop its bias table on destruction.
- **Hulk wrecks** (Graveyard, 250 HP): guaranteed 3 scrap drops.
- **Crystals** (Crystal Fields, 20 HP): shatter for loot.
- Everything else (asteroids, stations, forge structures) is solid but
  indestructible — collisions bounce you back with impact damage.

---

## 6. Loot, Cargo, Trading

### Picking up
Fly within pickup radius (8 u, +Magnet Coil bonus); items magnetize to you.
First pickup of a type → discovery popup; Tab shows the collection log
(22 items, discovered X/22). The collection log IS your inventory reference.

### Cargo
- Scrap stacks (1 slot for any amount); every other item = 1 slot each.
- Cargo is UNBANKED — you lose everything on death.

### Stations (KeyH within 120 u)
1. **Bank**: cargo → persistent, scrap → wallet, hull + shield fully
   repaired.
2. **Shop opens** (game pauses) with two tabs:
   - **CARGO** — everything you carry: **INSTALL** (≤3 modules, strong
     buff until run end), **UNINSTALL** (frees a slot, item stays fitted),
     **SELL** (tier value × your sell-bonus buffs: common 10, uncommon 25,
     rare 60, exotic 150).
   - **SHOP** — the full 22-item catalog: **BUY** with scrap at tier prices
     (common 30 / uncommon 70 / rare 160 / exotic 400); the module lands in
     cargo — install it from the CARGO tab.
     | Item | Buff |
     |---|---|
     | Weapon Mod: Fire Rate | +1 shots/s · **installed +3 shots/s** |
     | Weapon Mod: Damage | +4 dmg · **installed +12 dmg** |
     | Engine Mod | +8 speed · **installed +24 speed** |
     | Core: Overclock | +1 shots/s, +3 dmg · **installed +3 shots/s, +8 dmg** |
     | Core: Aegis | +10 hull, +10 shield · **installed +30/+30** |
     | Hull Patch | +5 hull · **installed +15 hull** |
     | Shield Cell | +5 shield · **installed +20 shield** |
     | Magnet Coil | +4 pickup · **installed +12 pickup** |
     | Salvage Plate | +4 hull · **installed +12 hull** |
     | Coolant | +2 regen/s · **installed +6 regen/s** |
     | Ammo Cell | +0.5 shots/s · **installed +1.5 shots/s** |
     | Fuel Skip | +4 speed · **installed +12 speed** |
     | Data Fragment | +1 dmg · **installed +3 dmg** |
     | Trade Chip | +5% sell · **installed +20% sell** |
     | Mystery Crate | +2 dmg, +2 hull · **installed +6/+6** |
     | Weapon Mod: Split Beam | +6 dmg, +0.5 shots/s · **installed +18 dmg, +1.5 shots/s** |
     | Weapon Mod: Homing | +3 dmg, +4 speed · **installed +10 dmg, +10 speed** |
     | Station Voucher | +10% sell · **installed +30% sell** |
     | Warden Shard | +10 dmg, +5 shield · **installed +30 dmg, +15 shield** |
     | Void Relic | +4 regen/s, +6 speed · **installed +12 regen/s, +18 speed** |
     | Golden Drone | +6 pickup, +10% sell · **installed +20 pickup, +30% sell** |

     Every one of the 21 collectible items (scrap is currency) gives a buff just
     for being CARRIED, and a ~3× stronger buff when INSTALLED at a station
     (max 3 modules). The shop's CARGO tab also shows sell prices boosted by
     your sell-bonus items.
   - **SELL** — convert items to scrap: common 10, uncommon 25, rare 60,
     exotic 150.
3. **SHIPS tab** — 3 purchasable ships (permanent purchase, free switch at
   any station). Pricier ships anger the sector: more enemy spawns.
   | Ship | Price | Stats |
   |---|---|---|
   | **Explorer** (red) | 300 | ×2 damage, **2 boost charges**, malus ×2 spawns |
   | **Fighter** (blue) | 600 | Bigger hull, +50% shield, ×1.5 speed, ×2 damage, **×2 enemy loot**, malus ×2 spawns |
   | **Flagship** (gold) | 1200 | **×3 speed, ×3 damage**, ×2 pickup range, **damage-reflecting shield** (50% bounced back), malus ×3 spawns |

Enemies keep out of the station shield bubble and hold fire while you're
inside — stations are safe havens.

### Hangar (permanent, between runs)
Scrap buys permanent upgrades: Hull Plating, Shield Capacitor, Weapon
Tuning, Cargo Pods, Engine Mk — linear costs, capped levels.

---

## 7. Victory & Death

- **Death**: everything unbanked is forfeited; death screen shows sector
  reached, kills, scrap lost. R or RESTART returns to the hangar.
- **Victory**: kill THE WARDEN in THE FORGE → toast "THE WARDEN IS
  DESTROYED — THE FORGE FALLS", 3× guaranteed-rare loot, wardenKills saved
  permanently.

---

## 8. Visual landmarks checklist (what a fresh player should spot)

- [x] The SUN — always visible, screen marker; 1,200 u core (biggest entity);
      spawn 3,000 u from it
- [x] Distance HUD measured from the sun
- [x] Spawn station near the sun (safe zone: no enemies within 1,200 u);
      stations are RARE (~1 per 5+ chunks of travel — waypoints, not furniture)
- [x] Asteroid fields (rust-orange sector), mines
- [x] Cyan/magenta crystals + pulsars (Crystal Fields)
- [x] Teal storm clouds + lightning (Plasma Storm)
- [x] Amber hulk wrecks (Derelict Graveyard)
- [x] Red-gold broken megastructures (THE FORGE)
- [x] Stations with green docking lights + shield bubble
- [x] Reticle colors: red = enemy, orange = breakable, white = loot
- [x] 4 breakable prop models (container / pods / satellite / buoy), loot bias
- [x] Station shop: CARGO + SHOP tabs, BUY modules, install ≤3
- [x] Crosshair = main-weapon convergence point (not the raw cursor)
- [x] Loot tier colors: grey common, green uncommon, blue rare, gold exotic
- [x] Exotic rarity beacon (visible from 800 u)
