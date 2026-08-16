// enemyTypes.js — the enemy variant REGISTRY (resolves the circular import).
//
// The base `Skeleton` does NOT import its variants (that would create a cycle:
// Skeleton → variants → Skeleton, and the variants `extends Skeleton` which is
// in the TDZ while the cycle is being linked). Instead, this module imports the
// base plus every variant and populates a registry. `Skeleton.forType` looks
// the registry up lazily, so callers can just `import { Skeleton } from
// './Skeleton.js'` and get the full factory, or import this module directly.
//
// Import order here is safe:
//   Skeleton.js  → (no variant imports)
//   variants     → import Skeleton (base, fully linked) + registerVariant
//   enemyTypes   → import Skeleton + variants (all base deps resolved)

import { Skeleton } from './Skeleton.js';

// Import variants; each self-registers via Skeleton.registerVariant at load.
import { ArmoredSkeleton } from './enemies/ArmoredSkeleton.js';
import { ArcherSkeleton } from './enemies/ArcherSkeleton.js';
import { Brute } from './enemies/Brute.js';
import { Rat } from './enemies/Rat.js';
import { Wraith } from './enemies/Wraith.js';
import { Burning } from './enemies/Burning.js';

export const ENEMY_CLASS_REGISTRY = {
  SKELETON: Skeleton,
  MAGICIAN: Skeleton,
  ARMORED: ArmoredSkeleton,
  ARCHER: ArcherSkeleton,
  RAT: Rat,
  BRUTE: Brute,
  WRAITH: Wraith,
  BURN: Burning,
};

// Register into the base so the SYNC Skeleton.forType() factory resolves the
// concrete variant classes. (Variants already self-register via
// Skeleton.registerVariant at their top level; this is belt-and-suspenders
// and covers SKELETON/MAGICIAN which have no dedicated variant class.)
Skeleton.registerVariant('SKELETON', Skeleton);
Skeleton.registerVariant('MAGICIAN', Skeleton);
Skeleton.registerVariant('ARMORED', ArmoredSkeleton);
Skeleton.registerVariant('ARCHER', ArcherSkeleton);
Skeleton.registerVariant('RAT', Rat);
Skeleton.registerVariant('BRUTE', Brute);
Skeleton.registerVariant('WRAITH', Wraith);
Skeleton.registerVariant('BURN', Burning);

export { Skeleton, ArmoredSkeleton, ArcherSkeleton, Brute, Rat, Wraith, Burning };
