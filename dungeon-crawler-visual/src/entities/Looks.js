// One declarative "look" per enemy type — the single source that maps an
// enemy's visual identity to which Meshes/accessories/colors the builder
// classes emit. Values pull from Constants.js so the numeric source of truth
// stays in one place and there are no duplicated color branches.
import * as C from '../core/Constants.js';

// Accessory-set flags that drive `_addArmor`/`_addHoodAndBow`/etc. rather
// than per-class hardcoding. The builder classes read `look.accessories`.
export const Looks = {
  SKELETON: {
    humanoid: true,
    variant: 'SKELETON',
    bone: C.SKELETON.BONE_COLOR,
    eye: C.SKELETON.EYE_GLOW,
    weapons: ['SWORD'],
    accessories: [],
  },
  MAGICIAN: {
    humanoid: true,
    variant: 'MAGICIAN',
    bone: C.SKELETON.BONE_COLOR,
    eye: C.SKELETON.EYE_GLOW,
    weapons: ['STAFF'],
    accessories: ['HOOD'],
  },
  ARMORED: {
    humanoid: true,
    variant: 'ARMORED',
    bone: C.ARMORED.BONE,
    eye: C.ARMORED.EYE,
    weapons: ['AXE'],
    accessories: ['CHESTPLATE', 'KITE_SHIELD', 'HELM'],
  },
  ARMORED_ELITE: { // Warlord gold trim
    humanoid: true,
    variant: 'ARMORED',
    bone: C.ELITE.ARMORED.BONE,
    trims: C.ELITE.ARMORED.TRIM,
    weapons: ['AXE'],
    accessories: ['CHESTPLATE', 'KITE_SHIELD', 'HELM', 'GOLD_TRIM'],
  },
  ARCHER: {
    humanoid: true,
    variant: 'ARCHER',
    bone: C.ARCHER.BONE,
    eye: C.SKELETON.EYE_GLOW,
    hood: C.ARCHER.HOOD,
    weapons: ['BOW'],
    accessories: ['HOOD', 'QUIVER'],
  },
  ARCHER_ELITE: {
    humanoid: true,
    variant: 'ARCHER',
    bone: C.ELITE.ARCHER.BONE,
    hood: C.ELITE.ARCHER.HOOD,
    weapons: ['BOW'],
    accessories: ['HOOD', 'QUIVER'],
  },
  BRUTE: {
    humanoid: true,
    variant: 'BRUTE',
    bone: C.BRUTE.BONE,
    eye: C.BRUTE.EYE,
    cloth: C.BRUTE.TUNIC,
    weapons: ['CLUB'],
    accessories: ['TUNIC'],
  },
  BRUTE_ELITE: {
    humanoid: true,
    variant: 'OGRE',
    bone: C.ELITE.BRUTE.BONE,
    eye: C.BRUTE.EYE,
    cloth: C.BRUTE.TUNIC,
    weapons: ['CLUB'],
    accessories: ['TUNIC'],
  },
  WRAITH: {
    humanoid: false,
    phantom: true,
    body: C.WRAITH.BODY,
    eye: C.WRAITH.EYE,
  },
  WRAITH_ELITE: {
    humanoid: false,
    phantom: true,
    body: C.ELITE.WRAITH.BODY,
    eye: C.WRAITH.EYE,
  },
  RAT: {
    humanoid: false,
    creature: true,
    body: C.RAT.BODY,
    head: C.RAT.HEAD,
    eye: C.RAT.EYE,
  },
  BURN: {
    humanoid: false,
    fire: true,
  },

  // Resolve a look by type + elite flag (throws if unknown — catches typos
  // the moment an enemy is constructed, headlessly).
  resolve(type, elite, isMagician) {
    const key = type === 'BURN' ? 'BURN'
      : type === 'RAT' ? 'RAT'
      : type === 'WRAITH' ? (elite ? 'WRAITH_ELITE' : 'WRAITH')
      : type === 'ARMORED' ? (elite ? 'ARMORED_ELITE' : 'ARMORED')
      : type === 'ARCHER' ? (elite ? 'ARCHER_ELITE' : 'ARCHER')
      : type === 'BRUTE' ? (elite ? 'BRUTE_ELITE' : 'BRUTE')
      : isMagician ? 'MAGICIAN' : 'SKELETON';
    const look = Looks[key];
    if (!look) throw new Error(`Unknown enemy look key: ${key}`);
    return look;
  },
};
