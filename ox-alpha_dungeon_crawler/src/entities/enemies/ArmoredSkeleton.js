// Variant rigs for the enemy roster. Each extends the base Skeleton with type-specific
// build tweaks already handled in Skeleton._buildRig; these files exist to satisfy
// the §4.1 module map and hold per-variant tuning/behaviors beyond base stats.

// ArmoredSkeleton.js — tank variant (armor = HP, no block)
export { default } from '../Skeleton.js';
