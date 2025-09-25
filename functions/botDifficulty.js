/**
 * Bot Difficulty Scaling System
 * Converted from Python to JavaScript for Firebase Cloud Functions
 */

// BotStatBounds class equivalent
class BotStatBounds {
  /**
   * Bounds for linear scaling. 'minVal' is the value at 0% (0 trophies),
   * 'maxVal' is the value at 100% (7500 trophies). If percent > 100%,
   * values may exceed 'maxVal' (unless clamped).
   * NOTE: For cooldown (lower is better), set minVal to the WORST (0%) value,
   *       and maxVal to the BEST (100%) value. The linear blend takes care of the rest.
   * @param {number} minVal - Minimum value at 0% trophy progress
   * @param {number} maxVal - Maximum value at 100% trophy progress
   */
  constructor(minVal, maxVal) {
    this.minVal = minVal;
    this.maxVal = maxVal;
  }
}

// Import admin for Firestore access
const admin = require("firebase-admin");

// BotDifficultyConfig class equivalent
class BotDifficultyConfig {
  /**
   * Tuning config for mapping trophies → bot stats.
   *
   * @param {Object} options - Configuration options
   * @param {number} [options.referenceTrophies=7500.0] - The trophies that represent 100%
   * @param {boolean} [options.allowOver100=true] - Allow >100% scaling if true; cap at 100% if false
   * @param {boolean} [options.clampToBounds=false] - Clamp each stat to [min,max] after scaling
   * @param {BotStatBounds} [options.maxSpeed] - Speed bounds
   * @param {BotStatBounds} [options.acceleration] - Acceleration bounds
   * @param {BotStatBounds} [options.boostTime] - Boost time bounds
   * @param {BotStatBounds} [options.boostFrequency] - Boost frequency bounds
   * @param {BotStatBounds} [options.boostCooldown] - Boost cooldown bounds
   */
  constructor(options = {}) {
    this.referenceTrophies = options.referenceTrophies || 7500.0;
    this.allowOver100 = options.allowOver100 !== undefined ? options.allowOver100 : true;
    this.clampToBounds = options.clampToBounds !== undefined ? options.clampToBounds : false;

    // Stat ranges (defaults chosen for balanced feel)
    // Given by user:
    this.maxSpeed = options.maxSpeed || new BotStatBounds(80.0, 250.0);  // units: game speed
    this.acceleration = options.acceleration || new BotStatBounds(5.0, 12.0);  // units: m/s^2-like

    // Suggested defaults (tweak as needed):
    // Boost time: sustained boost duration per activation (seconds, higher is better)
    this.boostTime = options.boostTime || new BotStatBounds(0.8, 3.0);

    // Boost frequency: triggers per time window (dimensionless scale; higher = more frequent)
    // Original mentioned "1–10"; we allow >10 if allowOver100=true, or clamp later.
    this.boostFrequency = options.boostFrequency || new BotStatBounds(2.0, 10.0);

    // Boost cooldown: seconds between boost windows (lower is better)
    // Define minVal as worst-at-0% (long cooldown), maxVal as best-at-100% (short cooldown).
    this.boostCooldown = options.boostCooldown || new BotStatBounds(6.0, 1.5);
  }
}

/**
 * Convert trophies → progress percent (0.0 = 0 trophies, 1.0 = cfg.referenceTrophies).
 * 
 * @param {number} trophies - Player trophy count
 * @param {BotDifficultyConfig} cfg - Configuration object
 * @returns {number} Progress percentage (0.0-1.0 or higher if allowOver100)
 */
function percentFromTrophies(trophies, cfg) {
  const ref = Math.max(1e-9, cfg.referenceTrophies);  // guard divide by zero
  let p = trophies / ref;
  
  if (!cfg.allowOver100) {
    // Cap at 0..1 if configured
    p = Math.min(1.0, Math.max(0.0, p));
  }
  // If over_100 allowed, p can exceed 1.0 (e.g., 1.5 for 150%)
  return Math.max(0.0, p);  // prevent negative trophies making negative %
}

/**
 * Linear interpolation that can exceed max if percent>1.
 * 
 * @param {number} minVal - Minimum value
 * @param {number} maxVal - Maximum value
 * @param {number} percent - Percentage (0.0-1.0 or higher)
 * @returns {number} Interpolated value
 */
function lerp(minVal, maxVal, percent) {
  return minVal + (maxVal - minVal) * percent;
}

/**
 * Optionally clamp to [min,max].
 * 
 * @param {number} value - Value to check
 * @param {BotStatBounds} bounds - Bounds object
 * @param {boolean} clamp - Whether to clamp values
 * @returns {number} Potentially clamped value
 */
function applyBounds(value, bounds, clamp) {
  if (clamp) {
    const lo = Math.min(bounds.minVal, bounds.maxVal);
    const hi = Math.max(bounds.minVal, bounds.maxVal);
    if (value < lo) return lo;
    if (value > hi) return hi;
  }
  return value;
}

/**
 * Fetch bot difficulty configuration from Firestore.
 * If no configuration exists, it creates a default one in Firestore.
 * 
 * @returns {Promise<BotDifficultyConfig>} A promise that resolves to a BotDifficultyConfig
 */
async function getFirestoreBotDifficultyConfig() {
  try {
    // Check if we already have initialized Firebase admin
    if (!admin.apps.length) {
      admin.initializeApp();
    }

    const db = admin.firestore();
    const docRef = db.collection("botDifficulty").doc("config");
    const doc = await docRef.get();

    // If document exists, use its values
    if (doc.exists) {
      const data = doc.data();
      console.log("Found bot difficulty config in Firestore:", data);
      
      // Create configuration with values from Firestore
      const config = new BotDifficultyConfig({
        referenceTrophies: data.referenceTrophies || 7500.0,
        allowOver100: data.allowOver100 !== undefined ? data.allowOver100 : true,
        clampToBounds: data.clampToBounds !== undefined ? data.clampToBounds : false,
        maxSpeed: new BotStatBounds(
          data.maxSpeed && data.maxSpeed.minVal !== undefined ? data.maxSpeed.minVal : 80.0,
          data.maxSpeed && data.maxSpeed.maxVal !== undefined ? data.maxSpeed.maxVal : 250.0
        ),
        acceleration: new BotStatBounds(
          data.acceleration && data.acceleration.minVal !== undefined ? data.acceleration.minVal : 5.0,
          data.acceleration && data.acceleration.maxVal !== undefined ? data.acceleration.maxVal : 12.0
        ),
        boostTime: new BotStatBounds(
          data.boostTime && data.boostTime.minVal !== undefined ? data.boostTime.minVal : 0.8,
          data.boostTime && data.boostTime.maxVal !== undefined ? data.boostTime.maxVal : 3.0
        ),
        boostFrequency: new BotStatBounds(
          data.boostFrequency && data.boostFrequency.minVal !== undefined ? data.boostFrequency.minVal : 2.0,
          data.boostFrequency && data.boostFrequency.maxVal !== undefined ? data.boostFrequency.maxVal : 10.0
        ),
        boostCooldown: new BotStatBounds(
          data.boostCooldown && data.boostCooldown.minVal !== undefined ? data.boostCooldown.minVal : 6.0,
          data.boostCooldown && data.boostCooldown.maxVal !== undefined ? data.boostCooldown.maxVal : 1.5
        )
      });
      
      return config;
    } else {
      // Document doesn't exist, create default configuration and save to Firestore
      console.log("No bot difficulty config found in Firestore, creating default");
      const defaultConfig = new BotDifficultyConfig();
      
      // Convert configuration to a Firestore-friendly format
      const configData = {
        referenceTrophies: defaultConfig.referenceTrophies,
        allowOver100: defaultConfig.allowOver100,
        clampToBounds: defaultConfig.clampToBounds,
        maxSpeed: {
          minVal: defaultConfig.maxSpeed.minVal,
          maxVal: defaultConfig.maxSpeed.maxVal
        },
        acceleration: {
          minVal: defaultConfig.acceleration.minVal,
          maxVal: defaultConfig.acceleration.maxVal
        },
        boostTime: {
          minVal: defaultConfig.boostTime.minVal,
          maxVal: defaultConfig.boostTime.maxVal
        },
        boostFrequency: {
          minVal: defaultConfig.boostFrequency.minVal,
          maxVal: defaultConfig.boostFrequency.maxVal
        },
        boostCooldown: {
          minVal: defaultConfig.boostCooldown.minVal,
          maxVal: defaultConfig.boostCooldown.maxVal
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
      
      // Save default config to Firestore
      await docRef.set(configData);
      console.log("Default bot difficulty config saved to Firestore");
      
      return defaultConfig;
    }
  } catch (error) {
    console.error("Error fetching bot difficulty config from Firestore:", error);
    // In case of any error, fallback to default configuration
    return new BotDifficultyConfig();
  }
}

/**
 * Map a list of trophies → a list of bot stat dictionaries.
 *
 * Each object contains:
 *   - 'trophies'
 *   - 'percentOfReference' (e.g., 1.5 for 150%)
 *   - 'maxSpeed', 'acceleration', 'boostTime', 'boostFrequency', 'boostCooldown'
 *
 * Scaling is linear against the MIN..MAX bands. Percent > 1.0 is allowed if cfg.allowOver100=true,
 * which means stats can exceed the 'max' reference (except if cfg.clampToBounds=true).
 * 
 * @param {number[]} trophiesList - List of trophy values
 * @param {BotDifficultyConfig} [cfg] - Configuration object
 * @returns {Promise<Object[]>} Promise that resolves to a list of bot stat objects
 */
async function computeBotStatsForTrophies(trophiesList, cfg = null) {
  // If no config is provided, fetch from Firestore
  if (!cfg) {
    cfg = await getFirestoreBotDifficultyConfig();
  }
  
  const output = [];
  
  for (const trophies of trophiesList) {
    const p = percentFromTrophies(trophies, cfg);

    const maxSpeed = applyBounds(
      lerp(cfg.maxSpeed.minVal, cfg.maxSpeed.maxVal, p), 
      cfg.maxSpeed, 
      cfg.clampToBounds
    );
    
    const acceleration = applyBounds(
      lerp(cfg.acceleration.minVal, cfg.acceleration.maxVal, p), 
      cfg.acceleration, 
      cfg.clampToBounds
    );
    
    const boostTime = applyBounds(
      lerp(cfg.boostTime.minVal, cfg.boostTime.maxVal, p), 
      cfg.boostTime, 
      cfg.clampToBounds
    );
    
    const boostFreq = applyBounds(
      lerp(cfg.boostFrequency.minVal, cfg.boostFrequency.maxVal, p), 
      cfg.boostFrequency, 
      cfg.clampToBounds
    );
    
    // Cooldown: lower is better; our bounds already encode worst→best as min→max
    const boostCooldown = applyBounds(
      lerp(cfg.boostCooldown.minVal, cfg.boostCooldown.maxVal, p), 
      cfg.boostCooldown, 
      cfg.clampToBounds
    );

    output.push({
      trophies: parseFloat(trophies),
      percentOfReference: p,  // e.g., 1.0 = 100%, 1.5 = 150%
      maxSpeed: maxSpeed,
      acceleration: acceleration,
      boostTime: boostTime,
      boostFrequency: boostFreq,
      boostCooldown: boostCooldown,
    });
  }
  
  return output;
}

// Export the functionality
module.exports = {
  BotStatBounds,
  BotDifficultyConfig,
  percentFromTrophies,
  lerp,
  applyBounds,
  getFirestoreBotDifficultyConfig,
  computeBotStatsForTrophies
};
