/**
 * Bot Spell Deck Generator
 * Converted from Python to JavaScript for Firebase Cloud Functions
 */

/**
 * Spell class definition
 */
class Spell {
  /**
   * @param {string} name - The spell name
   * @param {string} type - Type of spell (Powerup, Target Lock, Melee, Area Effect)
   * @param {number} unlockLevel - Level required to unlock (0 for DEFAULT)
   */
  constructor(name, type, unlockLevel) {
    this.name = name;
    this.type = type;
    this.unlockLevel = unlockLevel;
  }
}

// Catalog using the unlocks provided
const SPELLS = [
  new Spell("Invisibility", "Powerup", 0),
  new Spell("Meteor Wrath", "Target Lock", 0),
  new Spell("Ice lock", "Target Lock", 0),
  new Spell("Void blades", "Melee", 0),
  new Spell("Storm Aura", "Area Effect", 0),

  new Spell("Supersonic", "Powerup", 3),
  new Spell("Overdrive", "Powerup", 5),
  new Spell("Tiny Terror", "Powerup", 10),
  new Spell("Shockwave", "Area Effect", 15),
  new Spell("Fireball", "Target Lock", 20),
  new Spell("Power Out", "Target Lock", 25),
  new Spell("Phase Shift", "Powerup", 30),
  new Spell("Sky Reaper", "Target Lock", 35),
];

/**
 * Bot spell configuration class
 */
class BotSpellConfig {
  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.referenceTrophiesFor100=7500.0] - 100% point
   * @param {number} [options.referenceLevelAt100=133] - Level at 100% (used to infer bot level)
   * @param {number} [options.deckSize=5] - Spells per bot
   * @param {number|null} [options.deterministicSeed=null] - For reproducible rolls (optional)
   */
  constructor(options = {}) {
    this.referenceTrophiesFor100 = options.referenceTrophiesFor100 || 7500.0;
    this.referenceLevelAt100 = options.referenceLevelAt100 || 133;
    this.deckSize = options.deckSize || 5;
    this.deterministicSeed = options.deterministicSeed !== undefined ? options.deterministicSeed : null;
  }
}

/**
 * Convert trophies → inferred player level.
 * 0 trophies → level 1; reference_trophies_for_100 → reference_level_at_100.
 * Scales linearly beyond 100% (e.g., 11250 trophies = 150%).
 * 
 * @param {number} trophies - Player trophy count
 * @param {BotSpellConfig} cfg - Configuration object
 * @returns {number} - Inferred level
 */
function trophiesToLevel(trophies, cfg) {
  const perc = Math.max(0.0, parseFloat(trophies)) / Math.max(1e-9, cfg.referenceTrophiesFor100);
  // Level 1 as floor, then scale the additional chunk
  const level = 1 + perc * (cfg.referenceLevelAt100 - 1);
  return Math.max(1, Math.round(level));
}

/**
 * Return spells whose unlock_level <= level.
 * 
 * @param {number} level - Current level
 * @returns {Spell[]} - List of unlocked spells
 */
function unlockedSpellsAtLevel(level) {
  return SPELLS.filter(s => s.unlockLevel <= level);
}

/**
 * Linear interpolation
 * 
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} - Interpolated value
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * S-curve 0..1 → 0..1, smooth start/end
 * 
 * @param {number} x - Input value (0-1)
 * @returns {number} - Smoothed value
 */
function smoothstep01(x) {
  x = Math.max(0.0, Math.min(1.0, x));
  return x * x * (3 - 2 * x);
}

/**
 * Output a probability vector for spell levels [1,2,3,4,5] based on trophies.
 * - <1k: mostly 1–2
 * - 1k–3k: 2–4
 * - 3k–5k: 3–5
 * - ≥6k: mostly 5
 * Implemented as blend between 'low' and 'high' distributions with two smooth transitions.
 * 
 * @param {number} trophies - Trophy count
 * @param {BotSpellConfig} cfg - Configuration object
 * @returns {number[]} - Probability vector for levels [1,2,3,4,5]
 */
function levelProbabilitiesForTrophies(trophies, cfg) {
  const t = Math.max(0.0, trophies);
  
  // Define three anchor distributions (sum to 1):
  // low  (0..1k)      mid (1k..5k)        high (6k..7.5k+)
  const low = [0.55, 0.30, 0.12, 0.03, 0.00];  // L1,L2,L3,L4,L5
  const mid = [0.10, 0.30, 0.35, 0.20, 0.05];
  const high = [0.00, 0.05, 0.15, 0.30, 0.50];

  // Map trophies to two blend factors (0..1) with smoothstep:
  // f1: blend low→mid from 0k..3k (center ~1.5k)
  const f1 = smoothstep01(Math.min(1.0, t / 3000.0));
  // f2: blend mid→high from 3k..6k (center ~4.5k)
  const f2 = smoothstep01(Math.max(0.0, Math.min(1.0, (t - 3000.0) / 3000.0)));

  // First blend low→mid by f1
  let lv = low.map((val, i) => lerp(val, mid[i], f1));
  
  // Then blend that → high by f2
  lv = lv.map((val, i) => lerp(val, high[i], f2));

  // If trophies >= 6000, tilt further towards L5 as trophies rise to reference (or beyond)
  if (t >= 6000.0) {
    // From 6k to 7.5k, push an extra 20% mass to L5 progressively
    const push = Math.min(0.2, 0.2 * ((t - 6000.0) / Math.max(1.0, (cfg.referenceTrophiesFor100 - 6000.0))));
    
    // Steal proportionally from lower levels
    const steal = lv.slice(0, 4).reduce((acc, val) => acc + val, 0) * push;
    
    if (steal > 0) {
      const factor = (lv.slice(0, 4).reduce((acc, val) => acc + val, 0) - steal) / 
                     Math.max(1e-9, lv.slice(0, 4).reduce((acc, val) => acc + val, 0));
      
      for (let i = 0; i < 4; i++) {
        lv[i] *= factor;
      }
      lv[4] += steal;
    }
  }

  // Normalize (safety)
  const s = lv.reduce((acc, val) => acc + val, 0);
  return s > 0 ? lv.map(val => val / s) : [1, 0, 0, 0, 0];
}

/**
 * Seeded random number generator for reproducible results
 */
class SeededRandom {
  /**
   * @param {number|null} seed - Optional seed value
   */
  constructor(seed) {
    this.seed = seed || Math.floor(Math.random() * 2147483647);
    this.m = 2147483647; // 2^31 - 1
    this.a = 16807;      // 7^5
    this.state = this.seed;
  }

  /**
   * Returns random number between 0 and 1
   * @returns {number} - Random number
   */
  random() {
    this.state = (this.a * this.state) % this.m;
    return this.state / this.m;
  }

  /**
   * Shuffle an array in-place
   * @param {Array} array - Array to shuffle
   */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

/**
 * Sample from [p1..p5] → returns 1..5.
 * 
 * @param {number[]} probVec - Probability vector
 * @param {SeededRandom} rng - Random number generator
 * @returns {number} - Sampled level (1-5)
 */
function sampleSpellLevel(probVec, rng) {
  const r = rng.random();
  let acc = 0.0;
  
  for (let i = 0; i < probVec.length; i++) {
    acc += probVec[i];
    if (r <= acc) {
      return i + 1;
    }
  }
  
  return 5;
}

/**
 * Pick up to 'deckSize' distinct spells. If unlocked < deckSize, just return all.
 * Bias: slight preference toward higher-unlock spells (they feel 'newer').
 * 
 * @param {Spell[]} unlocked - List of unlocked spells
 * @param {number} deckSize - Desired deck size
 * @param {SeededRandom} rng - Random number generator
 * @returns {Spell[]} - Selected spells
 */
function pickUniqueSpells(unlocked, deckSize, rng) {
  if (unlocked.length <= deckSize) {
    return [...unlocked]; // as many as available
  }

  // Weight newer unlocks a bit more: w = 1 + unlock_level / 50
  const weighted = unlocked.map(s => ({
    spell: s,
    weight: 1.0 + (s.unlockLevel / 50.0)
  }));
  
  let totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
  const chosen = [];
  const pool = [...weighted];

  while (chosen.length < deckSize && pool.length > 0) {
    const r = rng.random() * totalWeight;
    let acc = 0.0;
    let idx = 0;
    
    for (let i = 0; i < pool.length; i++) {
      acc += pool[i].weight;
      if (r <= acc) {
        idx = i;
        break;
      }
    }
    
    const item = pool.splice(idx, 1)[0];
    chosen.push(item.spell);
    totalWeight -= item.weight;
  }

  return chosen;
}

/**
 * Main function to generate bot spell decks
 * 
 * @param {number[]} trophiesList - List of trophies (one per bot)
 * @param {BotSpellConfig} [cfg] - Configuration object
 * @returns {Object[]} - List of bot decks
 */
function generateBotsSpellDecks(trophiesList, cfg = new BotSpellConfig()) {
  const rng = new SeededRandom(cfg.deterministicSeed);
  const results = [];

  for (const trophies of trophiesList) {
    const inferredLevel = trophiesToLevel(trophies, cfg);
    const available = unlockedSpellsAtLevel(inferredLevel);

    // Choose the deck
    const deckSpells = pickUniqueSpells(available, cfg.deckSize, rng);

    // Decide spell levels from trophies-based distribution
    const levelProbs = levelProbabilitiesForTrophies(trophies, cfg);
    const deck = [];
    
    for (const sp of deckSpells) {
      let lvl = sampleSpellLevel(levelProbs, rng);

      // Ensure high-tier bots trend to L5 (hard cap feel)
      // If trophies well beyond reference, bias up further
      if (trophies >= cfg.referenceTrophiesFor100) {
        // 100%+ → 80% chance of bumping to 5 if not already
        if (lvl < 5 && rng.random() < 0.8) {
          lvl = 5;
        }
      }

      deck.push({
        name: sp.name,
        type: sp.type,
        level: Math.max(1, Math.min(5, lvl))
      });
    }

    // If we selected fewer than deckSize (very low level), top up with defaults (if needed)
    if (deck.length < cfg.deckSize) {
      // Make sure defaults exist:
      const usedNames = new Set(deck.map(item => item.name));
      const defaults = SPELLS.filter(s => s.unlockLevel === 0 && !usedNames.has(s.name));
      
      // Create a copy of defaults for shuffling
      const shuffledDefaults = [...defaults];
      rng.shuffle(shuffledDefaults);
      
      for (let i = 0; i < Math.min(shuffledDefaults.length, cfg.deckSize - deck.length); i++) {
        const sp = shuffledDefaults[i];
        const lvl = sampleSpellLevel(levelProbs, rng);
        
        deck.push({
          name: sp.name,
          type: sp.type,
          level: Math.max(1, Math.min(5, lvl))
        });
      }
    }

    results.push({
      trophies: parseFloat(trophies),
      inferredLevel: inferredLevel,
      spells: deck.slice(0, cfg.deckSize)
    });
  }

  return results;
}

// Export the functionality
module.exports = {
  Spell,
  BotSpellConfig,
  trophiesToLevel,
  unlockedSpellsAtLevel,
  levelProbabilitiesForTrophies,
  sampleSpellLevel,
  pickUniqueSpells,
  generateBotsSpellDecks
};
