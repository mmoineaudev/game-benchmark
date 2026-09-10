/**
 * EnemyGlow.js — per-type glow constants for the EnemyManager Points cloud.
 * Bodies are 1.6–2 u → sub-pixel beyond ~200 u; the cloud keeps every enemy
 * readable at distance (SPEC §5 interaction density) at 1 draw call.
 */

/** Glow color per enemy type (matches body material identity). */
export const GLOW_COLOR = {
  drone: 0xff3b30,
  interceptor: 0x8a93a8,
  rammer: 0xff8c1a,
  frigate: 0x9f5cff,
  sniper: 0x27e0c0,
  golden: 0xffd24a,
  sentinel: 0x9f5cff,
  warden: 0xff3b30,
};

/** Base glow world size per type, u (bosses bigger). */
export const GLOW_SIZE = {
  drone: 6,
  interceptor: 7,
  rammer: 7,
  frigate: 10,
  sniper: 7,
  golden: 8,
  sentinel: 18,
  warden: 30,
};
