// Shared proportion ladder for the humanoid entity family and creatures.
// Replaces blind `group.scale` with an explicit per-entity body budget so no
// enemy can clip the world (wall height 4.0) or misalign relative to the
// player/humanoid reference. All lengths in world units, rig origin at the
// ground contact, joints on the Rig standard layout.
export const Proportion = {
  // --- humanoid reference (Skeleton lineage) ---
  HUMAN: {
    total: 1.05,      // feet -> skull apex
    hipY: 0.95,       // pelvis joint height
    ribcageY: 0.95,   // pelvis + spine + ribcage centers
    headR: 0.16,
    limbWidth: 0.09,  // thigh/upper-arm baseline
    armReach: 0.42,
    legReach: 0.95,
  },

  // --- creature / non-humanoid ---
  RAT: {
    total: 0.26, bodyW: 0.12, bodyL: 0.19, headR: 0.07, tailL: 0.25,
  },

  // Explicit body budgets per humanoid variant (NOT a scale multiplier).
  // `torsoW` drives ribcage/chest width; `limbMult` scales limb girth;
  // `total` is the full height.
  VARIANTS: {
    SKELETON: { total: 1.05, torsoW: 1.0, limbMult: 1.0, limbs: true },
    MAGICIAN: { total: 1.05, torsoW: 1.0, limbMult: 1.0, limbs: true },
    ARMORED:  { total: 1.1,  torsoW: 1.12, limbMult: 1.15, limbs: true },
    ARCHER:   { total: 1.02, torsoW: 0.95, limbMult: 0.95, limbs: true },
    BRUTE:    { total: 1.35, torsoW: 1.5,  limbMult: 1.35, limbs: true },
    OGRE:     { total: 1.55, torsoW: 1.7,  limbMult: 1.45, limbs: true },
  },

  // Bounding-box budget (x/z half-extent at the widest point) used by the
  // grounding + silhouette probes so we can assert no clipping headlessly.
  halfExtents: {
    SKELETON: 0.30, MAGICIAN: 0.30, ARMORED: 0.34, ARCHER: 0.30,
    BRUTE: 0.45, OGRE: 0.50, RAT: 0.16, WRAITH: 0.30, BOSS: 0.6,
  },

  // Returns the fixed body budget for a variant (falls back to SKELETON).
  forVariant(variant) {
    return Proportion.VARIANTS[variant] || Proportion.VARIANTS.SKELETON;
  },

  // Sanity: a body budget must not exceed the wall height (world can't show
  // anything taller). Brute/Ogre are the tallest.
  fitsWallHeight(total) {
    return total <= 4.0;
  },
};
