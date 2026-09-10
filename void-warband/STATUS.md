# Void Warband — STATUS

## Date
2026-09-07 (run at 15:0x CEST)

## Gate results (fresh dist, all PASS)
- `npm run smoke` — **PASS** (11/11: boot, launch→FLIGHT, run alive, Tab log open/close, death, restart, hangar purchase, relaunch, upgrade stat applies, perf overlay 60 fps)
- `node scripts/check-perf.mjs` — **PASS** (60 s finale sampling: avg FPS 60.0, avg draw calls 13, heap stable — budgets ≤220 calls / ≥30 fps met with huge margin)
- `node scripts/restart-leak.mjs` — **PASS** (3 death/restart cycles: pickups/hulks cleared, enemy count flat 781→781, heap flat 10.7 MB, 0 page errors)

## SPEC v1.0 checklist
| Section | Status |
|---|---|
| §1 Concept (push-pull bank-or-lose loop) | done |
| §2 Controls rev 2 (arrows gyro, Q/E roll, A/D strafe, Shift/Space/B, F fire, G bank, Tab log, ?perf=1) | done |
| §3 Player ship (hull/shield/regen, pulse autocannon, cargo, hit feedback, damage numbers) | done |
| §4 Enemies ×7 (drone, interceptor, rammer, frigate, sniper cloak+telegraph, Sentinel mini-boss, Warden 3 phases) + golden drone exotic | done |
| §5 Chunk ladder (2500 u cubes, seeded, hysteresis), sectors 1–6 + voids, linear scaling, stations, THE FORGE arena, Warden victory + endless | done |
| §6 Loot: 22 items / 4 tiers, rarity beams, discovery popups, Collection Log X/22, weighted drop tables | done |
| §7 Hangar meta (localStorage `void_warband_meta`, validated save, 5 linear-cost upgrades, exact SPEC costs/caps) | done |
| §8 Perf budgets + `?perf=1` overlay + headless check | done (enforced by gate) |
| §9 Architecture (EventBus, Constants, pooled/instanced, Game state machine) | done |
| §11 Pitfall gates: restart cleanup ×3, delta cap, AZERTY event.code, pooled FX | done |

## Remaining bugs
None known. Fixed during development (notable): UI clicks swallowed by pointer-lock request (lock only on canvas mousedown); sub-pixel enemy bodies at range (EnemyGlow Points cloud, 1 draw call); scene missing lights (black hulls); spawn station blocking launch view (moved off-axis).

## Verdict
**FINISHED** — all three gates PASS on a fresh build, SPEC checklist complete, no remaining known bugs.

## Update — 2026-09-07 (second run)
Controls rev 3 landed (cursor-is-crosshair mouse-aim, scroll throttle, MMB free-look fire). All three gates re-run PASS on the rev-3 build (smoke 11/11, check:perf 60.0 fps / 13 draw calls, restart-leak 3× clean, heap 9.5 MB flat). Committed as `c4c2f9a`. SPEC §2 updated to rev 3.
