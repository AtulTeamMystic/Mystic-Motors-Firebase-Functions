/* eslint max-len: 0 */
const fs = require("fs");
const path = require("path");
const botDifficulty = require("./botDifficulty");
const botSpellDeck = require("./botSpellDeck");
/**
 * Load garageItemsData from DefaultData.json
 * @return {Array<Object>} garageItemsData array
 */
function getGarageItemsData() {
  const dataPath = path.join(__dirname, "DefaultData.json");
  const json = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  return (json.garageData && json.garageData.garageItemsData) ?
    json.garageData.garageItemsData :
    [];
}

/**
 * Map itemType number to string
 */
const ITEM_TYPE_MAP = {
  0: "Wheel",
  1: "Decal",
  2: "Spoiler",
  3: "Underglow",
  4: "Boost",
};

/**
 * Build a local cosmetics catalog from garageItemsData
 * @return {Object} Catalog organized by type and rarity
 */
function buildLocalCosmeticsCatalog() {
  const items = getGarageItemsData();
  const byTypeAndRarity = {};
  for (const cat of CATEGORIES) {
    byTypeAndRarity[cat] = {
      [RARITY.Common]: [],
      [RARITY.Rare]: [],
      [RARITY.Exotic]: [],
      [RARITY.Legendary]: [],
      [RARITY.Mythical]: [],
    };
  }
  for (const item of items) {
    const itemTypeStr = ITEM_TYPE_MAP[item.itemType];
    if (!itemTypeStr || !byTypeAndRarity[itemTypeStr]) continue;
    if (typeof item.itemRarity !== "number") continue;
    byTypeAndRarity[itemTypeStr][item.itemRarity].push({
      ...item,
      itemType: itemTypeStr,
      variants: Array.isArray(item.variants) &&
        item.variants.length > 0 ?
        item.variants :
        [{colorName: "Default"}],
    });
  }
  return byTypeAndRarity;
}
const functions = require("firebase-functions");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

// ================================
// BOT COSMETICS + CAR GENERATION
// ================================

// Bot Cosmetics Constants
const RARITY = {
  Common: 0,
  Rare: 1,
  Exotic: 2,
  Legendary: 3,
  Mythical: 4,
};
const RARITY_BY_ID = ["Common", "Rare", "Exotic", "Legendary", "Mythical"];
const CATEGORIES = ["Wheel", "Spoiler", "Decal", "Boost", "Underglow"];

// Hardcoded car unlock thresholds (based on trophies)
const CAR_THRESHOLDS = [
  { car: 1, trophies: 0 },
  { car: 2, trophies: 1400 },
  { car: 3, trophies: 2000 },
  { car: 4, trophies: 2600 },
  { car: 5, trophies: 3200 },
  { car: 6, trophies: 3800 },
  { car: 7, trophies: 4400 },
  { car: 8, trophies: 5000 },
  { car: 9, trophies: 5600 },
  { car: 10, trophies: 6000 },
  { car: 11, trophies: 6300 },
  { car: 12, trophies: 6600 },
  { car: 13, trophies: 6800 },
  { car: 14, trophies: 6900 },
  { car: 15, trophies: 7000 }
];

const RANK_THRESHOLDS_BOT = [
  [0, "Unranked"],
  [250, "Bronze I"],
  [500, "Bronze II"],
  [750, "Bronze III"],
  [1000, "Silver I"],
  [1250, "Silver II"],
  [1500, "Silver III"],
  [1750, "Gold I"],
  [2000, "Gold II"],
  [2250, "Gold III"],
  [2500, "Platinum I"],
  [2750, "Platinum II"],
  [3000, "Platinum III"],
  [3250, "Diamond I"],
  [3500, "Diamond II"],
  [3750, "Diamond III"],
  [4000, "Master I"],
  [4250, "Master II"],
  [4500, "Master III"],
  [4750, "Champion I"],
  [5000, "Champion II"],
  [5250, "Champion III"],
  [5500, "Ascendant I"],
  [5750, "Ascendant II"],
  [6000, "Ascendant III"],
  [6250, "Hypersonic I"],
  [6500, "Hypersonic II"],
  [7000, "Hypersonic III"],
];

/**
 * Map trophies to rank label (inclusive)
 * @param {number} t - The trophy count
 * @return {string} The rank label
 */
function getRankForTrophiesBot(t) {
  for (let i = RANK_THRESHOLDS_BOT.length - 1; i >= 0; i--) {
    if (t >= RANK_THRESHOLDS_BOT[i][0]) return RANK_THRESHOLDS_BOT[i][1];
  }
  return "Unranked";
}

/**
 * Pick a car number based on trophies.
 * - Finds the highest car the trophies allow.
 * - Adds ±1 tier of randomness for variety.
 * @param {number} trophies - Trophy count
 * @param {Function} rng - Random number generator
 * @return {number} Car number (1-15)
 */
function assignCarForTrophies(trophies, rng) {
  let car = 1;
  for (let i = 0; i < CAR_THRESHOLDS.length; i++) {
    if (trophies >= CAR_THRESHOLDS[i].trophies) {
      car = CAR_THRESHOLDS[i].car;
    }
  }

  // Add ±1 variation
  const minCar = Math.max(1, car - 1);
  const maxCar = Math.min(15, car + 1);
  return Math.floor(rng() * (maxCar - minCar + 1)) + minCar;
}

/**
 * Map trophies to [0..1] progress over ranks for interpolation
 * @param {number} trophies - The trophy count
 * @return {number} Progress from 0 to 1
 */
function rankProgress01(trophies) {
  const min = RANK_THRESHOLDS_BOT[0][0];
  const max = RANK_THRESHOLDS_BOT[RANK_THRESHOLDS_BOT.length - 1][0];
  const clamped = Math.max(min, Math.min(max, trophies));
  return (clamped - min) / (max - min);
}

/**
 * Ease-in curve so high ranks get rarities more aggressively
 * @param {number} t - Input value 0-1
 * @param {number} exp - Exponent for easing
 * @return {number} Eased value
 */
function easeProgress(t, exp = 1.3) {
  return Math.pow(t, exp);
}

/**
 * Linear blend a..b by u in [0..1]
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} u - Blend factor 0-1
 * @return {number} Blended value
 */
function lerp(a, b, u) {
  return a * (1 - u) + b * u;
}

/**
 * Build a rarity probability vector for a rank/category.
 * @param {number} trophies - Trophy count
 * @param {string} category - Cosmetic category
 * @return {Array<number>} Probability array for rarities
 */
function rarityVectorFor(trophies, category) {
  const t0 = rankProgress01(trophies);
  const u = easeProgress(t0, 1.3);
  const LOW = [0.75, 0.20, 0.05, 0.00, 0.00];
  const HIGH = [0.00, 0.05, 0.15, 0.50, 0.30];
  const raw = new Array(5);
  for (let i = 0; i < 5; i++) {
    raw[i] = lerp(LOW[i], HIGH[i], u);
  }
  if (category === "Underglow") {
    raw[RARITY.Legendary] += raw[RARITY.Mythical];
    raw[RARITY.Mythical] = 0;
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [1, 0, 0, 0, 0];
  return raw.map((x) => x / sum);
}

/**
 * Weighted random pick of rarity ID (0..4) from probability vector
 * @param {Array<number>} probVec - Probability vector
 * @param {Function} rng - Random number generator
 * @return {number} Selected rarity ID
 */
function sampleRarityId(probVec, rng) {
  let r = rng();
  for (let i = 0; i < probVec.length; i++) {
    r -= probVec[i];
    if (r <= 0) return i;
  }
  return probVec.length - 1;
}

/**
 * Tiny PRNG for deterministic runs (Mulberry32)
 * @param {number} seed - Random seed
 * @return {Function} Random number generator function
 */
function makeRng(seed = Date.now()) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Load cosmetics catalog from Firestore.
 * @param {Object} db - Firestore database instance
 * @return {Promise<Object>} Catalog organized by type and rarity
 */
async function loadCosmeticsCatalog(db) {
  // Use local garageItemsData from DefaultData.json
  return buildLocalCosmeticsCatalog();
}

/**
 * Pick one item (and variant) for a given category and target rarity.
 * @param {Object} byTypeAndRarity - Catalog organized by type/rarity
 * @param {string} category - Cosmetic category
 * @param {number} rarityId - Target rarity ID
 * @param {Function} rng - Random number generator
 * @return {Object|null} Selected item with variant
 */
function chooseItemByRarity(byTypeAndRarity, category, rarityId, rng) {
  for (let r = rarityId; r >= RARITY.Common; r--) {
    const pool = byTypeAndRarity[category][r];
    if (pool && pool.length > 0) {
      const item = pool[Math.floor(rng() * pool.length)];
      const variant = item.variants[Math.floor(rng() * item.variants.length)];
      return {...item, chosenVariant: variant, chosenRarityId: r};
    }
  }
  for (let r = rarityId + 1; r <= RARITY.Mythical; r++) {
    const pool = byTypeAndRarity[category][r];
    if (pool && pool.length > 0) {
      const item = pool[Math.floor(rng() * pool.length)];
      const variant = item.variants[Math.floor(rng() * item.variants.length)];
      return {...item, chosenVariant: variant, chosenRarityId: r};
    }
  }
  return null;
}

/**
 * Generate bot cosmetics based on trophy levels
 */
exports.generateBotCosmetics = functions.https.onCall(async (data, context) => {
  try {
    const actual = (data && data.data) || data || {};
    const botTrophies = actual.botTrophies;
    const seed = typeof actual.seed === "number" ? actual.seed : Date.now();

    if (!Array.isArray(botTrophies) || botTrophies.length === 0) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "botTrophies (number[]) is required.",
      );
    }

    const rng = makeRng(seed);
    const byTypeAndRarity = await loadCosmeticsCatalog();
    const botsOut = [];

    for (const trophies of botTrophies) {
      const rank = getRankForTrophiesBot(trophies);
      const cosmetics = {};

      // ---- COSMETICS LOGIC ----
      for (const category of CATEGORIES) {
        const probs = rarityVectorFor(trophies, category);
        const rarityId = sampleRarityId(probs, rng);
        let picked = chooseItemByRarity(byTypeAndRarity, category, rarityId, rng);
        // Fallback: if no item found, try any rarity for this category
        if (!picked) {
          for (let r = RARITY.Common; r <= RARITY.Mythical; r++) {
            picked = chooseItemByRarity(byTypeAndRarity, category, r, rng);
            if (picked) break;
          }
        }
        if (picked) {
          cosmetics[category] = {
            itemId: picked.id,
            itemName: picked.itemName,
            itemType: picked.itemType,
            rarityName: RARITY_BY_ID[picked.chosenRarityId],
            colorName:
              (picked.chosenVariant && picked.chosenVariant.colorName) ||
              "Default",
          };
        } else {
          cosmetics[category] = null;
        }
      }

      // ---- CAR LOGIC ----
      const car = assignCarForTrophies(trophies, rng);

      // ---- OUTPUT ----
      botsOut.push({
        trophies,
        rank,
        car: car,                           // NEW FIELD
        cosmetics,
      });
    }
    console.log(
        "generateBotCosmetics response (to Unity):",
        JSON.stringify(botsOut, null, 2),
    );
    return {
      success: true,
      bots: botsOut,
    };
  } catch (err) {
    console.error("generateBotCosmetics error:", err);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to generate bot cosmetics.",
        (err && err.message) || String(err),
    );
  }
});

// =============================================================================
// BOOSTER SYSTEM - Purchase, activate, and track coin/XP boosters
// =============================================================================

// Booster pricing in gems (Unity item IDs)
const BOOSTER_PRICES = {
  "coinbooster_1": 80,
  "coinbooster_6": 320,
  "coinbooster_12": 560,
  "coinbooster_24": 960,
  "xpbooster_1": 60,
  "xpbooster_6": 240,
  "xpbooster_12": 420,
  "xpbooster_24": 720,
};

// Booster duration in milliseconds (Unity item IDs)
const BOOSTER_DURATIONS = {
  "coinbooster_1": 1 * 60 * 60 * 1000, // 1 hour
  "coinbooster_6": 6 * 60 * 60 * 1000, // 6 hours
  "coinbooster_12": 12 * 60 * 60 * 1000, // 12 hours
  "coinbooster_24": 24 * 60 * 60 * 1000, // 24 hours
  "xpbooster_1": 1 * 60 * 60 * 1000, // 1 hour
  "xpbooster_6": 6 * 60 * 60 * 1000, // 6 hours
  "xpbooster_12": 12 * 60 * 60 * 1000, // 12 hours
  "xpbooster_24": 24 * 60 * 60 * 1000, // 24 hours
};

// =============================================================================
// GEM TO COINS CONVERSION SYSTEM - Based on trophy levels
// =============================================================================

// Gem conversion rates based on trophy levels (from GemConversionsV2.csv)
const GEM_CONVERSION_RATES = [
  [0, 12000],
  [500, 15800],
  [1000, 18000],
  [1500, 21200],
  [2000, 23000],
  [2500, 31000],
  [3000, 43000],
  [3500, 58000],
  [4000, 80000],
  [4500, 110000],
  [5000, 150000],
  [5500, 206000],
  [6000, 282000],
  [6500, 386000],
  [7000, 529000],
];

/**
 * Get coins per 100 gems based on trophy level
 * @param {number} trophies - Player's current trophy count
 * @return {number} Coins per 100 gems
 */
function getConversionRate(trophies) {
  // Handle edge cases
  if (trophies <= 0) return GEM_CONVERSION_RATES[0][1];
  if (trophies >= 7000) {
    return GEM_CONVERSION_RATES[GEM_CONVERSION_RATES.length - 1][1];
  }

  // Find the appropriate bracket and interpolate
  for (let i = 0; i < GEM_CONVERSION_RATES.length - 1; i++) {
    const [trophyMin, coinsMin] = GEM_CONVERSION_RATES[i];
    const [trophyMax, coinsMax] = GEM_CONVERSION_RATES[i + 1];

    if (trophies >= trophyMin && trophies <= trophyMax) {
      // Linear interpolation between the two points
      const ratio = (trophies - trophyMin) / (trophyMax - trophyMin);
      return Math.round(coinsMin + (coinsMax - coinsMin) * ratio);
    }
  }

  // Fallback to max rate
  return GEM_CONVERSION_RATES[GEM_CONVERSION_RATES.length - 1][1];
}

/**
 * Get active conversion rate for a player
 */
exports.getActiveConversion = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`getActiveConversion called for userId: ${userId}`);

  try {
    const db = admin.firestore();

    // Get user profile data
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);
    // Ensure trophies are never negative (fix any existing negative values)
    const trophyLevel = Math.max(0, profileData.trophyLevel || 0);
    const coinsPerHundredGems = getConversionRate(trophyLevel);

    console.log(`Trophy level: ${trophyLevel}, ` +
                `Conversion rate: ${coinsPerHundredGems} coins per 100 gems`);

    return {
      success: true,
      userId: userId,
      trophyLevel: trophyLevel,
      coinsPerHundredGems: coinsPerHundredGems,
      coinsPerGem: Math.round(coinsPerHundredGems / 100),
      message: `Conversion rate: ${coinsPerHundredGems} coins per 100 gems`,
    };
  } catch (error) {
    console.error("Error in getActiveConversion function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get conversion rate.",
        error.message,
    );
  }
});

/**
 * Buy coins with gems
 */
exports.buyCoins = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const {gemAmount} = actualData;

  console.log(`buyCoins called for userId: ${userId}, ` +
              `gemAmount: ${gemAmount}`);

  // Validate gem amount
  if (!Number.isInteger(gemAmount) || gemAmount <= 0) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Gem amount must be a positive integer",
    );
  }

  try {
    const db = admin.firestore();

    // Get user profile data
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);
    const currentGems = profileData.playerGem || 0;
    const currentCoins = profileData.playerCoins || 0;
    const currentCareerEarnings = profileData.careerEarning || 0;
    // Ensure trophies are never negative (fix any existing negative values)
    const trophyLevel = Math.max(0, profileData.trophyLevel || 0);

    // Check if user has enough gems
    if (currentGems < gemAmount) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `Insufficient gems. Required: ${gemAmount}, ` +
          `Available: ${currentGems}`,
      );
    }

    // Calculate coin conversion
    const coinsPerHundredGems = getConversionRate(trophyLevel);
    const coinsToAdd = Math.round((gemAmount / 100) * coinsPerHundredGems);

    // Update profile data
    const updatedProfileData = {
      ...profileData,
      playerGem: currentGems - gemAmount,
      playerCoins: currentCoins + coinsToAdd,
      careerEarning: currentCareerEarnings + coinsToAdd,
    };

    // Save updated profile data
    await userProfileRef.update({
      profileData: JSON.stringify(updatedProfileData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Gem conversion successful: ${gemAmount} gems → ` +
                `${coinsToAdd} coins (Rate: ${coinsPerHundredGems}/100)`);

    return {
      success: true,
      userId: userId,
      gemAmount: gemAmount,
      coinsReceived: coinsToAdd,
      conversionRate: coinsPerHundredGems,
      remainingGems: currentGems - gemAmount,
      newCoinBalance: currentCoins + coinsToAdd,
      newCareerEarnings: currentCareerEarnings + coinsToAdd,
      trophyLevel: trophyLevel,
      message: `Successfully converted ${gemAmount} gems to ` +
               `${coinsToAdd} coins`,
    };
  } catch (error) {
    console.error("Error in buyCoins function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to buy coins.",
        error.message,
    );
  }
});

// =============================================================================
// APP VERSION CHECK SYSTEM - Public version control
// =============================================================================

/**
 * Check the latest app version and force update status
 * Public function - no authentication required
 */
exports.checkAppVersion = functions.https.onCall(async (data, context) => {
  console.log("checkAppVersion called - public function");

  try {
    const db = admin.firestore();

    // Get app version data from Firestore
    const versionRef = db.collection("AppConfig").doc("version");
    const versionDoc = await versionRef.get();

    let versionData;
    if (!versionDoc.exists) {
      // Create default version data if it doesn't exist
      versionData = {
        latestAppVersion: 23,
        forceUpdate: true,
        releaseNotes: "Initial version setup",
        minSupportedVersion: 20,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Save default data to Firestore
      await versionRef.set(versionData);
      console.log("Created default app version data in Firestore");
    } else {
      versionData = versionDoc.data();
    }

    console.log(`App version - Latest: ${versionData.latestAppVersion}, ` +
                `Force update: ${versionData.forceUpdate}`);

    return {
      success: true,
      latestAppVersion: versionData.latestAppVersion,
      forceUpdate: versionData.forceUpdate,
      releaseNotes: versionData.releaseNotes || "",
      minSupportedVersion: versionData.minSupportedVersion || 1,
      message: "App version information retrieved successfully",
    };
  } catch (error) {
    console.error("Error in checkAppVersion function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to check app version.",
        error.message,
    );
  }
});


/**
 * Buy a booster with gems
 */
exports.buyBooster = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const {quantity = 1} = actualData;

  // Normalize booster type to lowercase (failsafe for Unity)
  const boosterType = (actualData.boosterType || "").toLowerCase();

  console.log(`buyBooster called for userId: ${userId}, ` +
              `boosterType: ${boosterType}, quantity: ${quantity}`);

  // Validate booster type (now using Unity IDs)
  if (!BOOSTER_PRICES[boosterType]) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid booster type: ${boosterType}. Valid types: ` +
        Object.keys(BOOSTER_PRICES).join(", "),
    );
  }

  // Validate quantity
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Quantity must be an integer between 1 and 10",
    );
  }

  try {
    const db = admin.firestore();
    const totalCost = BOOSTER_PRICES[boosterType] * quantity;

    // Get user profile
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);
    const currentGems = profileData.playerGem || 0;

    // Check if user has enough gems
    if (currentGems < totalCost) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `Insufficient gems. Required: ${totalCost}, ` +
          `Available: ${currentGems}`,
      );
    }

    // Get user booster data
    const userBoosterRef = db.collection("players").doc(userId)
        .collection("boosterData").doc("boosterData");
    const userBoosterDoc = await userBoosterRef.get();

    let boosterData;
    if (!userBoosterDoc.exists) {
      // Create default booster data if it doesn't exist
      boosterData = {
        "coinBooster_1h": 0,
        "coinBooster_6h": 0,
        "coinBooster_12h": 0,
        "coinBooster_24h": 0,
        "expBooster_1h": 0,
        "expBooster_6h": 0,
        "expBooster_12h": 0,
        "expBooster_24h": 0,
        "coinBoosterEndTime": 0,
        "expBoosterEndTime": 0,
      };
    } else {
      boosterData = JSON.parse(userBoosterDoc.data().boosterData);
    }

    // Update booster count and deduct gems
    const updatedProfileData = {
      ...profileData,
      playerGem: currentGems - totalCost,
    };

    const updatedBoosterData = {
      ...boosterData,
      [boosterType]: (boosterData[boosterType] || 0) + quantity,
    };

    // Execute transaction to update both profile and booster data
    await db.runTransaction(async (transaction) => {
      transaction.update(userProfileRef, {
        profileData: JSON.stringify(updatedProfileData),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!userBoosterDoc.exists) {
        transaction.set(userBoosterRef, {
          boosterData: JSON.stringify(updatedBoosterData),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(userBoosterRef, {
          boosterData: JSON.stringify(updatedBoosterData),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    console.log(`Purchase successful: ${quantity}x ${boosterType} ` +
                `for ${totalCost} gems`);

    return {
      success: true,
      boosterType: boosterType,
      quantity: quantity,
      totalCost: totalCost,
      remainingGems: currentGems - totalCost,
      newBoosterCount: updatedBoosterData[boosterType],
      message: `Successfully purchased ${quantity}x ${boosterType} ` +
               `for ${totalCost} gems`,
    };
  } catch (error) {
    console.error("Error in buyBooster function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to purchase booster.",
        error.message,
    );
  }
});

/**
 * Activate a booster (deduct from inventory and extend active time)
 */
exports.activateBooster = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  // Log incoming data for debugging
  console.log("activateBooster - Raw incoming data keys:", 
      data ? Object.keys(data) : "null");
  console.log("activateBooster - Processed actualData:",
      JSON.stringify(actualData));
  console.log("activateBooster - Auth context:",
              context.auth ? `UID: ${context.auth.uid}` : "No auth");

  // Normalize booster type to lowercase (failsafe for Unity)
  const boosterType = (actualData.boosterType || "").toLowerCase();

  console.log(`activateBooster called for userId: ${userId}, ` +
              `boosterType: ${boosterType}`);

  // Validate booster type (now using Unity IDs)
  if (!BOOSTER_DURATIONS[boosterType]) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid booster type: ${boosterType}. Valid types: ` +
        Object.keys(BOOSTER_DURATIONS).join(", "),
    );
  }

  try {
    const db = admin.firestore();

    // Get user booster data
    const userBoosterRef = db.collection("players").doc(userId)
        .collection("boosterData").doc("boosterData");
    const userBoosterDoc = await userBoosterRef.get();

    console.log(`Booster document exists: ${userBoosterDoc.exists}`);

    if (!userBoosterDoc.exists) {
      console.log("User booster data not found - " +
                  "user needs to purchase boosters first");
      throw new functions.https.HttpsError(
          "not-found",
          "User booster data not found. Purchase boosters first.",
      );
    }

    const boosterData = JSON.parse(userBoosterDoc.data().boosterData);
    console.log("Current booster data:", JSON.stringify(boosterData));

    // Check if user has this booster
    const currentCount = boosterData[boosterType] || 0;
    console.log(`Current count for ${boosterType}: ${currentCount}`);

    if (currentCount <= 0) {
      console.log(`Insufficient booster count - Type: ${boosterType}, ` +
                  `Count: ${currentCount}`);
      console.log("Available boosters:",
          Object.keys(boosterData).filter((key) =>
            key.includes("booster") && !key.includes("EndTime") &&
                    boosterData[key] > 0));
      throw new functions.https.HttpsError(
          "failed-precondition",
          `No ${boosterType} available in inventory. ` +
          `Current count: ${currentCount}. Available boosters: ` +
          Object.keys(boosterData).filter((key) =>
            key.includes("booster") && !key.includes("EndTime") &&
            boosterData[key] > 0).join(", "),
      );
    }

    // Determine which end time to update (check Unity ID)
    const isCoiner = boosterType.startsWith("coinbooster");
    const endTimeField = isCoiner ? "coinBoosterEndTime" : "expBoosterEndTime";
    const currentTime = Date.now();
    const currentEndTime = boosterData[endTimeField] || 0;

    // Calculate new end time (extend if already active, or start from now)
    const boosterDuration = BOOSTER_DURATIONS[boosterType];
    const newEndTime = Math.max(currentTime, currentEndTime) + boosterDuration;

    // Update booster data
    const updatedBoosterData = {
      ...boosterData,
      [boosterType]: currentCount - 1, // Deduct one booster
      [endTimeField]: newEndTime, // Extend active time
    };

    // Save updated booster data
    await userBoosterRef.update({
      boosterData: JSON.stringify(updatedBoosterData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    const durationHours = boosterDuration / (1000 * 60 * 60);
    const remainingTime = Math.max(0, newEndTime - currentTime);

    console.log(`Activated ${boosterType}: ${durationHours}h added, ` +
                `${remainingTime}ms total remaining`);

    return {
      success: true,
      boosterType: boosterType,
      durationAdded: boosterDuration,
      newEndTime: newEndTime,
      remainingTime: remainingTime,
      remainingCount: currentCount - 1,
      boosterCategory: isCoiner ? "coin" : "exp",
      message: `Successfully activated ${boosterType}. ` +
               `${durationHours}h added to ${isCoiner ? "coin" : "exp"} ` +
               `booster.`,
    };
  } catch (error) {
    console.error("Error in activateBooster function:", error);

    // Provide detailed error information
    let detailedError = "Failed to activate booster: ";

    if (error.code) {
      // This is already a Firebase HttpsError, re-throw with more context
      detailedError += `[${error.code}] ${error.message}`;
      console.error(`Firebase Error - Code: ${error.code}, ` +
                    `Message: ${error.message}`);
      throw new functions.https.HttpsError(
          error.code,
          detailedError,
          {
            originalError: error.message,
            userId: userId,
            boosterType: boosterType,
            timestamp: new Date().toISOString(),
          },
      );
    } else {
      // This is an unexpected error, provide full details
      detailedError += `Unexpected error: ${error.message || error.toString()}`;
      console.error(`Unexpected Error Details:`, {
        errorMessage: error.message,
        errorStack: error.stack,
        userId: userId,
        boosterType: boosterType,
        errorType: error.constructor.name,
      });
      throw new functions.https.HttpsError(
          "internal",
          detailedError,
          {
            errorType: error.constructor.name,
            errorMessage: error.message,
            userId: userId,
            boosterType: boosterType,
            timestamp: new Date().toISOString(),
          },
      );
    }
  }
});

/**
 * Get current booster data (counts and remaining active times)
 */
exports.getBoosterData = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`getBoosterData called for userId: ${userId}`);

  try {
    const db = admin.firestore();

    // Get user booster data
    const userBoosterRef = db.collection("players").doc(userId)
        .collection("boosterData").doc("boosterData");
    const userBoosterDoc = await userBoosterRef.get();

    let boosterData;
    if (!userBoosterDoc.exists) {
      // Return default booster data if it doesn't exist
      boosterData = {
        "coinBooster_1h": 0,
        "coinBooster_6h": 0,
        "coinBooster_12h": 0,
        "coinBooster_24h": 0,
        "expBooster_1h": 0,
        "expBooster_6h": 0,
        "expBooster_12h": 0,
        "expBooster_24h": 0,
        "coinBoosterEndTime": 0,
        "expBoosterEndTime": 0,
      };
    } else {
      boosterData = JSON.parse(userBoosterDoc.data().boosterData);
    }

    const currentTime = Date.now();
    const coinEndTime = boosterData.coinBoosterEndTime || 0;
    const expEndTime = boosterData.expBoosterEndTime || 0;

    // Calculate remaining time in seconds
    const coinRemainingSeconds = Math.max(0,
        Math.floor((coinEndTime - currentTime) / 1000));
    const expRemainingSeconds = Math.max(0,
        Math.floor((expEndTime - currentTime) / 1000));

    // Check if boosters are currently active
    const coinBoosterActive = coinRemainingSeconds > 0;
    const expBoosterActive = expRemainingSeconds > 0;

    console.log(`Booster status - Coin: ${coinRemainingSeconds}s remaining, ` +
                `Exp: ${expRemainingSeconds}s remaining`);

    // Extract booster counts using Unity IDs directly
    const boosterCounts = {
      "coinbooster_1": boosterData["coinbooster_1"] || 0,
      "coinbooster_6": boosterData["coinbooster_6"] || 0,
      "coinbooster_12": boosterData["coinbooster_12"] || 0,
      "coinbooster_24": boosterData["coinbooster_24"] || 0,
      "xpbooster_1": boosterData["xpbooster_1"] || 0,
      "xpbooster_6": boosterData["xpbooster_6"] || 0,
      "xpbooster_12": boosterData["xpbooster_12"] || 0,
      "xpbooster_24": boosterData["xpbooster_24"] || 0,
    };

    return {
      success: true,
      boosterCounts: boosterCounts,
      activeBoosterData: {
        coinBoosterActive: coinBoosterActive,
        expBoosterActive: expBoosterActive,
        coinRemainingSeconds: coinRemainingSeconds,
        expRemainingSeconds: expRemainingSeconds,
        coinEndTime: coinEndTime,
        expEndTime: expEndTime,
      },
      boosterPrices: BOOSTER_PRICES,
      message: "Booster data retrieved successfully",
    };
  } catch (error) {
    console.error("Error in getBoosterData function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get booster data.",
        error.message,
    );
  }
});

exports.updateUserScore = functions.https.onCall(async (data, context) => {
  // Ensure the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated.",
    );
  }

  const userId = context.auth.uid;
  const {score} = data; // Data sent from Unity

  if (typeof score !== "number") {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Score must be a number.",
    );
  }

  try {
    // Update Firestore document
    await admin.firestore().collection("users").doc(userId).update({
      score: admin.firestore.FieldValue.increment(score),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {message: `Score updated successfully for user ${userId}`};
  } catch (error) {
    throw new functions.https.HttpsError(
        "internal",
        "Failed to update score.",
        error.message,
    );
  }
});

exports.getEndRaceRewards = functions.https.onCall(async (data, context) => {
  // For testing without authentication, get userId from data
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;

  // The actual data is nested inside data.data
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  // Debug logging
  console.log(`getEndRaceRewards called for userId: ${userId}`);

  try {
    const db = admin.firestore();

    // Fetch user's garage data
    const userGarageRef = db.collection("players").doc(userId)
        .collection("garageData").doc("garageData");
    const userGarageDoc = await userGarageRef.get();

    if (!userGarageDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User garage data not found.",
      );
    }

    const garageData = JSON.parse(userGarageDoc.data().garageData);

    // Define reward probabilities based on the updated values
    const rewardProbabilities = [
      {type: "noreward", probability: 25.00},
      {type: "commoncrate", probability: 20.00},
      {type: "rarecrate", probability: 7.50},
      {type: "exoticcrate", probability: 5.00},
      {type: "legendarycrate", probability: 2.50},
      {type: "mythicalcrate", probability: 2.40},
      {type: "commonkey", probability: 20.00},
      {type: "rarekey", probability: 7.50},
      {type: "exotickey", probability: 5.00},
      {type: "legendarykey", probability: 2.50},
      {type: "mythicalkey", probability: 1.60},
    ];

    // Use cumulative probability for accurate selection
    const random = Math.random() * 100; // 0-100
    let cumulativeProbability = 0;
    let selectedReward = "noreward"; // fallback

    for (const reward of rewardProbabilities) {
      cumulativeProbability += reward.probability;
      if (random <= cumulativeProbability) {
        selectedReward = reward.type;
        break;
      }
    }

    console.log(`Random: ${random.toFixed(4)}, Selected reward: ${selectedReward}`);

    // Update garage data based on reward type
    const updatedGarageData = {...garageData};
    let rewardMessage = "";

    if (selectedReward === "noreward") {
      rewardMessage = "No reward this time!";
    } else if (selectedReward.includes("crate")) {
      // Handle crate rewards
      const crateType = selectedReward.replace("crate", "");
      // Capitalize first letter to match the key format (Common, Rare, etc.)
      const crateKey = crateType.charAt(0).toUpperCase() + crateType.slice(1);

      if (updatedGarageData.crateData &&
          updatedGarageData.crateData[crateKey] !== undefined) {
        updatedGarageData.crateData[crateKey] += 1;
        rewardMessage = `You received a ${crateKey} crate!`;
      } else {
        console.error(`Crate key ${crateKey} not found in crateData`);
        rewardMessage = `Error: Could not add ${crateKey} crate`;
      }
    } else if (selectedReward.includes("key")) {
      // Handle key rewards
      const keyType = selectedReward.replace("key", "");
      // Capitalize first letter to match the key format (Common, Rare, etc.)
      const keyKey = keyType.charAt(0).toUpperCase() + keyType.slice(1);

      if (updatedGarageData.keyData &&
          updatedGarageData.keyData[keyKey] !== undefined) {
        updatedGarageData.keyData[keyKey] += 1;
        rewardMessage = `You received a ${keyKey} key!`;
      } else {
        console.error(`Key key ${keyKey} not found in keyData`);
        rewardMessage = `Error: Could not add ${keyKey} key`;
      }
    }

    // Save updated garage data back to Firestore
    await userGarageRef.update({
      garageData: JSON.stringify(updatedGarageData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Return the reward result
    return {
      success: true,
      rewardType: selectedReward,
      message: rewardMessage,
    };
  } catch (error) {
    console.error("Error in getEndRaceRewards function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get end race rewards.",
        error.message,
    );
  }
});

exports.getLeaderboard = functions.https.onCall(async (data, context) => {
  // For testing without authentication, get userId from data
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;

  // The actual data is nested inside data.data
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  // 1=trophyLevel, 2=careerEarning, 3=totalRace
  const rankType = actualData.rankType;

  // Debug logging
  console.log(`getLeaderboard called for userId: ${userId}, ` +
      `rankType: ${rankType}`);

  // Validate rank type
  if (!rankType || ![1, 2, 3].includes(parseInt(rankType))) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid rankType. Must be 1 (trophyLevel), " +
        "2 (careerEarning), or 3 (totalRace)",
    );
  }

  try {
    const db = admin.firestore();

    // Fetch all players' profile data
    const playersRef = db.collection("players");
    const playersSnapshot = await playersRef.get();

    if (playersSnapshot.empty) {
      return {
        success: true,
        leaderboard: [],
        totalPlayers: 0,
        rankType: parseInt(rankType),
      };
    }

    const players = [];
    const rankTypeInt = parseInt(rankType);

    // Map rank type to property name
    const propertyMap = {
      1: "trophyLevel",
      2: "careerEarning",
      3: "totalRace",
    };

    const propertyName = propertyMap[rankTypeInt];

    // Process each player document
    for (const playerDoc of playersSnapshot.docs) {
      const playerId = playerDoc.id;

      try {
        // Get profile data for each player
        const profileRef = playerDoc.ref.collection("profileData")
            .doc("profileData");
        const profileDoc = await profileRef.get();

        if (profileDoc.exists) {
          const profileData = JSON.parse(profileDoc.data().profileData);

          // Check account status - only include active accounts
          let accountStatus = profileData.account_status;

          // If account_status is empty/undefined, set it to "active" (for old accounts)
          if (!accountStatus) {
            accountStatus = "active";
          }

          // Only include active accounts in leaderboard
          if (accountStatus === "active") {
            // Extract required data
            players.push({
              userId: profileData.userId || playerId,
              username: profileData.username || "Unknown",
              playerLevel: profileData.playerLevel || 1,
              statValue: profileData[propertyName] || 0,
              avatarId: profileData.avatarId || 0,
              clanName: profileData.clanName || "No Clan",
              clanBadge: profileData.clanBadge || 0,
              
            });
          }
        }
      } catch (error) {
        console.error(`Error processing player ${playerId}:`, error);
        // Continue processing other players
      }
    }

    // Sort players by statValue in descending order
    players.sort((a, b) => b.statValue - a.statValue);

    // Find user's rank in the sorted list
    let myRank = -1;
    const userIndex = players.findIndex((player) => player.userId === userId);
    if (userIndex !== -1) {
      myRank = userIndex + 1; // Rank is 1-based
    }

    // Get top 100 or all if less than 100
    const leaderboard = players.slice(0, 100);

    console.log(`Processed ${players.length} players, ` +
        `returning top ${leaderboard.length}`);

    return {
      success: true,
      leaderboard: leaderboard,
      totalPlayers: players.length,
      rankType: rankTypeInt,
      myRank: myRank,
    };
  } catch (error) {
    console.error("Error in getLeaderboard function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get leaderboard.",
        error.message,
    );
  }
});

exports.updateUserScore = functions.https.onCall(async (data, context) => {
  // Ensure the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated.",
    );
  }

  const userId = context.auth.uid;
  const {score} = data; // Data sent from Unity

  if (typeof score !== "number") {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Score must be a number.",
    );
  }

  try {
    // Update Firestore document
    await admin.firestore().collection("users").doc(userId).update({
      score: admin.firestore.FieldValue.increment(score),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {message: `Score updated successfully for user ${userId}`};
  } catch (error) {
    throw new functions.https.HttpsError(
        "internal",
        "Failed to update score.",
        error.message,
    );
  }
});

// =============================================================================
// RACE ECONOMY SYSTEM - Based on Python implementation
// Handles trophies (Elo-like), coins, XP, and rank management
// =============================================================================

// Rank thresholds (inclusive) - 28 ranks total
const RANK_THRESHOLDS = [
  [0, "Unranked"],
  [250, "Bronze I"],
  [500, "Bronze II"],
  [750, "Bronze III"],
  [1000, "Silver I"],
  [1250, "Silver II"],
  [1500, "Silver III"],
  [1750, "Gold I"],
  [2000, "Gold II"],
  [2250, "Gold III"],
  [2500, "Platinum I"],
  [2750, "Platinum II"],
  [3000, "Platinum III"],
  [3250, "Diamond I"],
  [3500, "Diamond II"],
  [3750, "Diamond III"],
  [4000, "Master I"],
  [4250, "Master II"],
  [4500, "Master III"],
  [4750, "Champion I"],
  [5000, "Champion II"],
  [5250, "Champion III"],
  [5500, "Ascendant I"],
  [5750, "Ascendant II"],
  [6000, "Ascendant III"],
  [6250, "Hypersonic I"],
  [6500, "Hypersonic II"],
  [7000, "Hypersonic III"],
];

// Trophy configuration
const TROPHY_CONFIG = {
  D: 700.0, // Elo spread
  TAU: 600.0, // Distance weighting scale
  W_MIN: 0.20, // Min per-opponent weight
  PER_PAIR_CLIP: 8.0, // Clip each pair's contribution
  CLAMP_MIN: -40, // Final clamp per race
  CLAMP_MAX: 40,
  BASE_K_BREAKPOINTS: [
    [2000, 48],
    [4000, 40],
    [6000, 32],
    [7000, 24],
    [8000, 12],
    [9000, 10],
    [10000, 8],
    [Infinity, 6],
  ],
  SOFT_CEILING_START: 7000.0,
  SOFT_CEILING_LAMBDA: 1 / 2000.0,
};

// Coin caps by rank and position (1st-8th place)
const COIN_CAPS_BY_RANK = {
  "Unranked": [2000, 1500, 1200, 900, 900, 900, 900, 900],
  "Bronze I": [2200, 1650, 1300, 1000, 1000, 1000, 1000, 1000],
  "Bronze II": [2500, 1900, 1500, 1100, 1100, 1100, 1100, 1100],
  "Bronze III": [2800, 2100, 1700, 1300, 1300, 1300, 1300, 1300],
  "Silver I": [3100, 2300, 1900, 1400, 1400, 1400, 1400, 1400],
  "Silver II": [3500, 2600, 2100, 1600, 1600, 1600, 1600, 1600],
  "Silver III": [3900, 2900, 2300, 1800, 1800, 1800, 1800, 1800],
  "Gold I": [4300, 3200, 2600, 1900, 1900, 1900, 1900, 1900],
  "Gold II": [4800, 3600, 2900, 2200, 2200, 2200, 2200, 2200],
  "Gold III": [5400, 4100, 3200, 2400, 2400, 2400, 2400, 2400],
  "Platinum I": [6000, 4500, 3600, 2700, 2700, 2700, 2700, 2700],
  "Platinum II": [6700, 5000, 4000, 3000, 3000, 3000, 3000, 3000],
  "Platinum III": [7500, 5600, 4500, 3400, 3400, 3400, 3400, 3400],
  "Diamond I": [8400, 6300, 5000, 3800, 3800, 3800, 3800, 3800],
  "Diamond II": [9400, 7100, 5600, 4200, 4200, 4200, 4200, 4200],
  "Diamond III": [10500, 7900, 6300, 4700, 4700, 4700, 4700, 4700],
  "Master I": [11800, 8900, 7100, 5300, 5300, 5300, 5300, 5300],
  "Master II": [13200, 9900, 7900, 5900, 5900, 5900, 5900, 5900],
  "Master III": [14800, 11100, 8900, 6600, 6600, 6600, 6600, 6600],
  "Champion I": [16600, 12400, 10000, 7500, 7500, 7500, 7500, 7500],
  "Champion II": [18600, 14000, 11200, 8400, 8400, 8400, 8400, 8400],
  "Champion III": [20900, 15700, 12500, 9400, 9400, 9400, 9400, 9400],
  "Ascendant I": [23400, 17600, 14000, 10500, 10500, 10500, 10500, 10500],
  "Ascendant II": [26200, 19700, 15700, 11800, 11800, 11800, 11800, 11800],
  "Ascendant III": [29400, 22100, 17600, 13200, 13200, 13200, 13200, 13200],
  "Hypersonic I": [32900, 24700, 19700, 14800, 14800, 14800, 14800, 14800],
  "Hypersonic II": [36900, 27700, 22100, 16600, 16600, 16600, 16600, 16600],
  "Hypersonic III": [41300, 31000, 24800, 18600, 18600, 18600, 18600, 18600],
};

// EXP multipliers for positions (1st to 8th place)
const EXP_PLACE_MULTIPLIERS = [1.20, 1.142857, 1.085714, 1.028571,
  0.971429, 0.914286, 0.857143, 0.80];

/**
 * Get rank label for given trophy count
 * @param {number} trophies - Current trophies
 * @return {string} Rank label
 */
function getRankForTrophies(trophies) {
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (trophies >= RANK_THRESHOLDS[i][0]) {
      return RANK_THRESHOLDS[i][1];
    }
  }
  return "Unranked";
}

/**
 * Get base K value for trophy calculation
 * @param {number} trophies - Current trophies
 * @param {object} config - Trophy configuration
 * @return {number} Base K value
 */
function getBaseK(trophies, config) {
  for (const [bound, k] of config.BASE_K_BREAKPOINTS) {
    if (trophies < bound) {
      return k;
    }
  }
  return config.BASE_K_BREAKPOINTS[config.BASE_K_BREAKPOINTS.length - 1][1];
}

/**
 * Get high rank damping multiplier
 * @param {number} trophies - Current trophies
 * @param {object} config - Trophy configuration
 * @return {number} Damping multiplier
 */
function getHighRankDamping(trophies, config) {
  const over = Math.max(0, trophies - config.SOFT_CEILING_START);
  return Math.exp(-config.SOFT_CEILING_LAMBDA * over);
}

/**
 * Calculate Elo expected score
 * @param {number} ratingA - Rating of player A
 * @param {number} ratingB - Rating of player B
 * @param {object} config - Trophy configuration
 * @return {number} Expected score (0-1)
 */
function expectedScore(ratingA, ratingB, config) {
  return 1.0 / (1.0 + Math.pow(10.0, (ratingB - ratingA) / config.D));
}

/**
 * Calculate trophy delta for a race finish
 * @param {number} playerIndex - Index of player in ratings array
 * @param {Array<number>} finishOrder - Array of player indices in finish order
 * @param {Array<number>} ratings - Array of player ratings at race start
 * @param {object} config - Trophy configuration
 * @return {number} Trophy delta for the player
 */
function calculateTrophies(playerIndex, finishOrder, ratings, config) {
  const n = ratings.length;
  const playerRating = ratings[playerIndex];

  // Calculate weights and expected scores
  const weights = [];
  const expectedScores = [];
  let totalWeight = 0;

  for (let j = 0; j < n; j++) {
    if (j === playerIndex) {
      weights[j] = 0;
      expectedScores[j] = 0;
      continue;
    }

    const dist = Math.abs(ratings[j] - playerRating);
    let weight = Math.exp(-dist / config.TAU);
    if (weight < config.W_MIN) weight = config.W_MIN;

    weights[j] = weight;
    expectedScores[j] = expectedScore(playerRating, ratings[j], config);
    totalWeight += weight;
  }

  // Normalize weights
  if (totalWeight > 0) {
    for (let j = 0; j < n; j++) {
      if (j !== playerIndex) {
        weights[j] = weights[j] / totalWeight;
      }
    }
  }

  // Find player position in finish order
  const playerPos = finishOrder.indexOf(playerIndex);
  const finishedBefore = new Set(finishOrder.slice(0, playerPos));

  // Calculate trophy delta
  const K = getBaseK(playerRating, config);
  const H = getHighRankDamping(playerRating, config);

  let total = 0;
  for (let j = 0; j < n; j++) {
    if (j === playerIndex) continue;

    const score = finishedBefore.has(j) ? 0.0 : 1.0;
    let delta = K * H * weights[j] * (score - expectedScores[j]);

    // Clip per-pair contribution
    if (delta > config.PER_PAIR_CLIP) delta = config.PER_PAIR_CLIP;
    if (delta < -config.PER_PAIR_CLIP) delta = -config.PER_PAIR_CLIP;

    total += delta;
  }

  // Round and clamp final result
  let finalDelta = Math.round(total);
  if (finalDelta < config.CLAMP_MIN) finalDelta = config.CLAMP_MIN;
  if (finalDelta > config.CLAMP_MAX) finalDelta = config.CLAMP_MAX;

  return finalDelta;
}

/**
 * Calculate average expected win probability vs lobby
 * @param {number} playerIndex - Index of player in ratings array
 * @param {Array<number>} ratings - Array of player ratings
 * @param {object} config - Trophy configuration
 * @return {number} Average expected win probability (0-1)
 */
function getAvgExpectedVsLobby(playerIndex, ratings, config) {
  const n = ratings.length;
  const playerRating = ratings[playerIndex];

  let totalWeight = 0;
  let weightedExpected = 0;

  for (let j = 0; j < n; j++) {
    if (j === playerIndex) continue;

    const dist = Math.abs(ratings[j] - playerRating);
    let weight = Math.exp(-dist / config.TAU);
    if (weight < config.W_MIN) weight = config.W_MIN;

    const expected = expectedScore(playerRating, ratings[j], config);

    totalWeight += weight;
    weightedExpected += weight * expected;
  }

  return totalWeight > 0 ? weightedExpected / totalWeight : 0.5;
}

/**
 * Calculate difficulty multiplier based on lobby strength
 * @param {number} avgExpected - Average expected win probability
 * @param {number} floor - Minimum multiplier (default 0.85)
 * @param {number} ceiling - Maximum multiplier (default 1.15)
 * @return {number} Difficulty multiplier
 */
function getDifficultyMultiplier(avgExpected, floor = 0.85, ceiling = 1.15) {
  const x = Math.max(-0.5, Math.min(0.5, 0.5 - avgExpected)) / 0.5;
  if (x >= 0) {
    return 1.0 + x * (ceiling - 1.0);
  } else {
    return 1.0 + x * (1.0 - floor);
  }
}

/**
 * Calculate coins based on rank, position, and lobby difficulty
 * @param {string} rankLabel - Player's rank label
 * @param {number} place - Race finish position (1-8)
 * @param {Array<number>} lobbyRatings - All player ratings in lobby
 * @param {number} playerIndex - Index of player in lobby
 * @param {boolean} hasCoinBooster - Whether coin booster is active
 * @return {number} Coin reward amount
 */
function calculateCoins(rankLabel, place, lobbyRatings, playerIndex,
    hasCoinBooster = false) {
  const caps = COIN_CAPS_BY_RANK[rankLabel];
  if (!caps || place < 1 || place > caps.length) {
    throw new Error(`Invalid rank ${rankLabel} or place ${place}`);
  }

  const maxForPlace = caps[place - 1];
  const avgExpected = getAvgExpectedVsLobby(
      playerIndex, lobbyRatings, TROPHY_CONFIG);
  const difficultyMult = getDifficultyMultiplier(avgExpected);
  const boosterMult = hasCoinBooster ? 2.0 : 1.0;

  const raw = maxForPlace * difficultyMult * boosterMult;
  const rounded = Math.round(raw / 100) * 100; // Round to nearest 100

  return Math.max(0, rounded);
}

/**
 * Calculate EXP based on rank and position
 * @param {number} trophies - Player's current trophies
 * @param {number} place - Race finish position
 * @param {string} rankLabel - Player's rank label (optional)
 * @param {boolean} hasExpBooster - Whether EXP booster is active
 * @return {number} EXP reward amount
 */
function calculateExp(trophies, place, rankLabel = null,
    hasExpBooster = false) {
  const boosterMult = hasExpBooster ? 2.0 : 1.0;

  // Use rank-based calculation if rank provided
  if (rankLabel) {
    const rankIndex = RANK_THRESHOLDS.findIndex(
        ([_, name]) => name === rankLabel);
    const baseExp = 100 + (208 - 100) *
        (rankIndex / (RANK_THRESHOLDS.length - 1));
    const placeMult = EXP_PLACE_MULTIPLIERS[place - 1] || 1.0;

    return Math.max(0, Math.round(baseExp * placeMult * boosterMult));
  }

  // Fallback: formula based on trophies
  const t = Math.max(0.0, Math.min(1.0, trophies / 7000.0));
  const base = 100 + (208 - 100) * t;
  const placeMult = EXP_PLACE_MULTIPLIERS[place - 1] || 1.0;

  return Math.max(0, Math.round(base * placeMult * boosterMult));
}

/**
 * Calculate pre-deduction for race start (quit-proofing)
 * @param {number} playerIndex - Index of player in ratings array
 * @param {Array<number>} ratings - Array of all player ratings
 * @return {number} Trophy delta if player finished last
 */
function calculateLastPlaceDelta(playerIndex, ratings) {
  const n = ratings.length;
  const lastPlaceOrder = [];

  // Create finish order with player last
  for (let i = 0; i < n; i++) {
    if (i !== playerIndex) {
      lastPlaceOrder.push(i);
    }
  }
  lastPlaceOrder.push(playerIndex);

  return calculateTrophies(playerIndex, lastPlaceOrder, ratings, TROPHY_CONFIG);
}

exports.startRace = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const {raceId, lobbyRatings, playerIndex} = actualData;

  console.log(`startRace called for userId: ${userId}, raceId: ${raceId}`);

  if (!raceId || !lobbyRatings || playerIndex === undefined) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required parameters: raceId, lobbyRatings, playerIndex",
    );
  }

  try {
    const db = admin.firestore();

    // Calculate pre-deduction (as-if last place)
    const lastPlaceDelta = calculateLastPlaceDelta(playerIndex, lobbyRatings);

    // Apply pre-deduction to user's trophies
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);
    // Ensure trophies are never negative (fix any existing negative values)
    const currentTrophies = Math.max(0, profileData.trophyLevel || 0);

    // Apply pre-deduction with trophy floor protection
    // Ensure trophies never go below 0
    const newTrophyLevel = Math.max(0, currentTrophies + lastPlaceDelta);
    const actualPreDeduction = newTrophyLevel - currentTrophies;

    profileData.trophyLevel = newTrophyLevel;

    console.log(`Trophy protection: ${currentTrophies} + ${lastPlaceDelta} = ` +
        `${newTrophyLevel} (actual deduction: ${actualPreDeduction})`);

    // Store race data for settlement later
    const raceDataRef = db.collection("raceData").doc(raceId);
    await raceDataRef.set({
      userId: userId,
      playerIndex: playerIndex,
      lobbyRatings: lobbyRatings,
      preDeductedDelta: actualPreDeduction, // Store actual amount deducted
      originalCalculatedDelta: lastPlaceDelta, // Store what was calculated
      // Store original trophy count for settlement
      originalTrophies: currentTrophies,
      startTime: admin.firestore.FieldValue.serverTimestamp(),
      settled: false,
    });

    // Update user profile with pre-deduction
    await userProfileRef.update({
      profileData: JSON.stringify(profileData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Pre-deducted ${actualPreDeduction} trophies ` +
        `(calculated: ${lastPlaceDelta}) for race ${raceId}`);

    return {
      success: true,
      preDeductedTrophies: actualPreDeduction, // Return actual amount deducted
      calculatedPenalty: lastPlaceDelta, // Include what was calculated
      trophyFloorHit: actualPreDeduction !== lastPlaceDelta, // Protection flag
      message: "Race started with trophy pre-deduction applied",
    };
  } catch (error) {
    console.error("Error in startRace function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to start race.",
        error.message,
    );
  }
});

exports.finishRace = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const {raceId, finishOrder, place, hasCoinBooster = false,
    hasExpBooster = false} = actualData;

  console.log(`finishRace called for userId: ${userId}, raceId: ${raceId}, ` +
              `place: ${place}`);

  if (!raceId || !finishOrder || place === undefined || place === null) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required parameters: raceId, finishOrder, place",
    );
  }

  // Handle place: 0 as 1st position (failsafe)
  const actualPlace = place === 0 ? 1 : place;

  try {
    const db = admin.firestore();

    // Get race data
    const raceDataRef = db.collection("raceData").doc(raceId);
    const raceDataDoc = await raceDataRef.get();

    if (!raceDataDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "Race data not found. Make sure startRace was called.",
      );
    }

    const raceData = raceDataDoc.data();
    if (raceData.settled) {
      throw new functions.https.HttpsError(
          "already-exists",
          "Race already settled.",
      );
    }

    // Get user profile
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);
    // Ensure trophies are never negative (fix any existing negative values)
    const currentTrophies = Math.max(0, profileData.trophyLevel || 0);

    console.log(`DEBUG finishRace: currentTrophies from profileData: ${currentTrophies}, ` +
        `raceData.originalTrophies: ${raceData.originalTrophies}, ` +
        `raceData.preDeductedDelta: ${raceData.preDeductedDelta}`);

    // Restore pre-deduction before applying actual trophy delta
    const originalTrophies = (raceData.originalTrophies !== undefined) ?
      raceData.originalTrophies :
      // fallback for legacy races
      currentTrophies + Math.abs(raceData.preDeductedDelta);

    // Calculate actual trophy delta for this race
    const actualTrophyDelta = calculateTrophies(
        raceData.playerIndex, finishOrder, raceData.lobbyRatings,
        TROPHY_CONFIG);

    // Apply the actual delta to the original trophies
    const finalTrophyLevel = Math.max(0, originalTrophies + actualTrophyDelta);
    const actualSettlement = finalTrophyLevel - currentTrophies;

    // Determine ranks using original and final trophy levels
    const oldRank = getRankForTrophies(originalTrophies);
    const newRank = getRankForTrophies(finalTrophyLevel);

    // Calculate coins and EXP using old rank for consistency
    const coins = calculateCoins(
        oldRank, actualPlace, raceData.lobbyRatings, raceData.playerIndex,
        hasCoinBooster);
    const exp = calculateExp(
        originalTrophies, actualPlace, oldRank, hasExpBooster);

    const updatedProfileData = {
      ...profileData,
      trophyLevel: finalTrophyLevel,
      careerEarning: (profileData.careerEarning || 0) + coins,
      playerCoins: (profileData.playerCoins || 0) + coins,
      playerExperience: (profileData.playerExperience || 0) + exp,
      totalRace: (profileData.totalRace || 0) + (place === 0 ? 1 : 0),
    };

    console.log(
        `Trophy: ${originalTrophies} + ${actualTrophyDelta} = ` +
        `${finalTrophyLevel} (settlement: ${actualSettlement},` +
        ` prededucted: ${raceData.preDeductedDelta})`,
    );

    console.log(`Rank change: ${oldRank} (${originalTrophies}) → ` +
    `${newRank} (${finalTrophyLevel})`);

    // Determine if promoted/demoted
    const getRankIndex = (rank) => RANK_THRESHOLDS.findIndex(
        ([_, name]) => name === rank);
    const promoted = getRankIndex(newRank) > getRankIndex(oldRank);
    const demoted = getRankIndex(newRank) < getRankIndex(oldRank);

    // Handle rank promotion rewards (set flag to claimable)
    let promotionRewardField = null;
    if (promoted) {
      const promotionMap = {
        "Unranked → Bronze I": "unrankedToBronzeI",
        "Bronze I → Bronze II": "bronzeIToBronzeII",
        "Bronze II → Bronze III": "bronzeIIToBronzeIII",
        "Bronze III → Silver I": "bronzeIIIToSilverI",
        "Silver I → Silver II": "silverIToSilverII",
        "Silver II → Silver III": "silverIIToSilverIII",
        "Silver III → Gold I": "silverIIIToGoldI",
        "Gold I → Gold II": "goldIToGoldII",
        "Gold II → Gold III": "goldIIToGoldIII",
        "Gold III → Platinum I": "goldIIIToPlatinumI",
        "Platinum I → Platinum II": "platinumIToPlatinumII",
        "Platinum II → Platinum III": "platinumIIToPlatinumIII",
        "Platinum III → Diamond I": "platinumIIIToDiamondI",
        "Diamond I → Diamond II": "diamondIToDiamondII",
        "Diamond II → Diamond III": "diamondIIToDiamondIII",
        "Diamond III → Master I": "diamondIIIToMasterI",
        "Master I → Master II": "masterIToMasterII",
        "Master II → Master III": "masterIIToMasterIII",
        "Master III → Champion I": "masterIIIToChampionI",
        "Champion I → Champion II": "championIToChampionII",
        "Champion II → Champion III": "championIIToChampionIII",
        "Champion III → Ascendant I": "championIIIToAscendantI",
        "Ascendant I → Ascendant II": "ascendantIToAscendantII",
        "Ascendant II → Ascendant III": "ascendantIIToAscendantIII",
        "Ascendant III → Hypersonic I": "ascendantIIIToHypersonicI",
        "Hypersonic I → Hypersonic II": "hypersonicIToHypersonicII",
        "Hypersonic II → Hypersonic III": "hypersonicIIToHypersonicIII",
      };

      const promotionKey = `${oldRank} → ${newRank}`;
      promotionRewardField = promotionMap[promotionKey];

      if (promotionRewardField) {
        console.log(`Rank promotion detected: ${promotionKey} - ` +
            `Setting ${promotionRewardField} to claimable (1)`);
      }
    }

    // Set promotion reward flag if promoted
    if (promotionRewardField) {
      // 1 = reward available to claim
      updatedProfileData[promotionRewardField] = 1;
    }

    // Execute transaction to update user and mark race as settled
    await db.runTransaction(async (transaction) => {
      transaction.update(userProfileRef, {
        profileData: JSON.stringify(updatedProfileData),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(raceDataRef, {
        settled: true,
        finishTime: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`Race ${raceId} settled: trophyChange=${actualSettlement}, ` +
                `coins=${coins}, exp=${exp}`);

    return {
      success: true,
      trophiesActual: actualTrophyDelta, // Can be negative
      // Now always the actual delta applied to original trophies
      trophiesSettlement: actualTrophyDelta,
      // What was actually applied to the user's account
      trophiesActualSettlement: actualSettlement,
      // Not relevant with new logic
      trophyFloorHit: false,
      coins: coins,
      exp: exp,
      oldRank: oldRank,
      newRank: newRank,
      promoted: promoted,
      demoted: demoted,
      preDeductedAmount: raceData.preDeductedDelta,
      promotionRewardAvailable: !!promotionRewardField,
      promotionRewardField: promotionRewardField,
      message: "Race finished and rewards calculated",
    };
  } catch (error) {
    console.error("Error in finishRace function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to finish race.",
        error.message,
    );
  }
});

exports.claimRewards = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const {rewardType} = actualData;

  console.log(`claimRewards called for userId: ${userId}, ` +
              `rewardType: ${rewardType}`);

  if (!rewardType) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required parameter: rewardType",
    );
  }

  // Define rank promotion rewards based on CSV data
  const PROMOTION_REWARDS = {
    "unrankedToBronzeI": {gems: 100, crateKey: "Common Key"},
    "bronzeIToBronzeII": {crateKey: "Common Crate"},
    "bronzeIIToBronzeIII": {gems: 100, crateKey: "Common Key"},
    "bronzeIIIToSilverI": {crateKey: "Common Crate"},
    "silverIToSilverII": {gems: 150, crateKey: "Rare Key"},
    "silverIIToSilverIII": {crateKey: "Rare Crate"},
    "silverIIIToGoldI": {gems: 150, crateKey: "Rare Key"},
    "goldIToGoldII": {crateKey: "Rare Crate"},
    "goldIIToGoldIII": {gems: 200, crateKey: "Exotic Key"},
    "goldIIIToPlatinumI": {crateKey: "Exotic Crate"},
    "platinumIToPlatinumII": {gems: 200, crateKey: "Exotic Key"},
    "platinumIIToPlatinumIII": {crateKey: "Exotic Crate"},
    "platinumIIIToDiamondI": {gems: 300, crateKey: "Legendary Key"},
    "diamondIToDiamondII": {crateKey: "Legendary Crate"},
    "diamondIIToDiamondIII": {gems: 300, crateKey: "Legendary Key"},
    "diamondIIIToMasterI": {crateKey: "Legendary Crate"},
    "masterIToMasterII": {gems: 350, crateKey: "Legendary Key"},
    "masterIIToMasterIII": {crateKey: "Legendary Crate"},
    "masterIIIToChampionI": {gems: 400, crateKey: "Legendary Key"},
    "championIToChampionII": {crateKey: "Legendary Crate"},
    "championIIToChampionIII": {gems: 450, crateKey: "Mythical Key"},
    "championIIIToAscendantI": {crateKey: "Mythical Crate"},
    "ascendantIToAscendantII": {gems: 500, crateKey: "Legendary Key"},
    "ascendantIIToAscendantIII": {crateKey: "Legendary Crate"},
    "ascendantIIIToHypersonicI": {gems: 500, crateKey: "Mythical Key"},
    "hypersonicIToHypersonicII": {crateKey: "Mythical Crate"},
    "hypersonicIIToHypersonicIII": {gems: 750, crateKey: "Mythical Crate"},
  };

  // Validate reward type
  if (!PROMOTION_REWARDS[rewardType]) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        `Invalid reward type: ${rewardType}`,
    );
  }

  try {
    const db = admin.firestore();

    // Get user profile
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);

    // Check if reward is available to claim (flag = 1)
    const rewardFlag = profileData[rewardType];
    if (rewardFlag === undefined || rewardFlag === 0) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Reward not available. You haven't reached this rank yet.",
      );
    }

    if (rewardFlag === 2) {
      throw new functions.https.HttpsError(
          "already-exists",
          "Reward has already been claimed.",
      );
    }

    if (rewardFlag !== 1) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `Invalid reward state: ${rewardFlag}. Expected 1 for claimable.`,
      );
    }

    // Get reward amounts
    const reward = PROMOTION_REWARDS[rewardType];

    // Update profile with rewards and mark as claimed
    const updatedProfileData = {
      ...profileData,
      [rewardType]: 2, // Mark as claimed
    };

    // Add gems if present in reward
    if (reward.gems) {
      updatedProfileData.playerGem = (profileData.playerGem || 0) +
          reward.gems;
    }

    // Handle crate/key rewards - need to update garage data
    if (reward.crateKey) {
      // Get user's garage data
      const userGarageRef = db.collection("players").doc(userId)
          .collection("garageData").doc("garageData");
      const userGarageDoc = await userGarageRef.get();

      if (userGarageDoc.exists) {
        const garageData = JSON.parse(userGarageDoc.data().garageData);
        const updatedGarageData = {...garageData};

        // Parse the reward type (e.g., "Common Key" -> "Common")
        const rewardParts = reward.crateKey.split(" ");
        const rewardRarity = rewardParts[0]; // Common, Rare, etc.
        const rewardItemType = rewardParts[1]; // Crate or Key

        if (rewardItemType === "Crate") {
          // Update crate count
          if (updatedGarageData.crateData &&
              updatedGarageData.crateData[rewardRarity] !== undefined) {
            updatedGarageData.crateData[rewardRarity] += 1;
            console.log(`Added 1 ${rewardRarity} crate`);
          }
        } else if (rewardItemType === "Key") {
          // Update key count
          if (updatedGarageData.keyData &&
              updatedGarageData.keyData[rewardRarity] !== undefined) {
            updatedGarageData.keyData[rewardRarity] += 1;
            console.log(`Added 1 ${rewardRarity} key`);
          }
        }

        // Save updated garage data
        await userGarageRef.update({
          garageData: JSON.stringify(updatedGarageData),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        console.error("User garage data not found for crate/key reward");
      }
    }

    // Update user profile
    await userProfileRef.update({
      profileData: JSON.stringify(updatedProfileData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    const rewardMessage = reward.gems && reward.crateKey ?
        `${reward.gems} Gems + ${reward.crateKey}` :
        reward.gems ? `${reward.gems} Gems` : reward.crateKey;

    console.log(`Rewards claimed for ${rewardType}: ${rewardMessage}`);

    return {
      success: true,
      rewardType: rewardType,
      rewards: {
        gems: reward.gems || 0,
        crateKey: reward.crateKey || null,
      },
      message: `Rank promotion rewards claimed: ${rewardMessage}`,
    };
  } catch (error) {
    console.error("Error in claimRewards function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to claim rewards.",
        error.message,
    );
  }
});

exports.getRankRewards = functions.https.onCall(async (data, context) => {
  try {
    // Extract rank data with maximum rewards (1st place coins)
    const rankRewards = Object.entries(COIN_CAPS_BY_RANK).map(
        ([rank, caps]) => ({
          rankName: rank,
          maxReward: caps[0], // First position has the maximum coins
        }),
    );

    console.log(`Returning ${rankRewards.length} rank reward data entries`);

    return {
      success: true,
      ranks: rankRewards,
      totalRanks: rankRewards.length,
      message: "Rank rewards data retrieved successfully",
    };
  } catch (error) {
    console.error("Error in getRankRewards function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get rank rewards data.",
        error.message,
    );
  }
});

exports.openCrate = functions.https.onCall(async (data, context) => {
  // For testing without authentication, get userId from data
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;

  // The actual data is nested inside data.data
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const crateType = actualData.crateType; // Data sent from Unity

  // Debug logging to see what we received
  console.log("Received data keys:", Object.keys(data));
  console.log("Actual data keys:", Object.keys(actualData));
  console.log(`actualData.userId: ${actualData.userId}`);
  console.log(`actualData.crateType: ${actualData.crateType}`);
  console.log(`Final userId: ${userId}, crateType: ${crateType}`);

  // Validate crate type
  const validCrateTypes = ["Common", "Rare", "Exotic", "Legendary", "Mythical"];
  if (!validCrateTypes.includes(crateType)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid crate type. Must be one of: " + validCrateTypes.join(", "),
    );
  }

  try {
    const db = admin.firestore();

    // Fetch user's garage data
    const userGarageRef = db.collection("players").doc(userId)
        .collection("garageData").doc("garageData");
    const userGarageDoc = await userGarageRef.get();

    if (!userGarageDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User garage data not found.",
      );
    }

    const garageData = JSON.parse(userGarageDoc.data().garageData);

    // Check and deduct crate/key from user's account
    const crateField = `${crateType}`;
    const keyField = `${crateType}`;

    const currentCrates = garageData.crateData[crateField] || 0;
    const currentKeys = garageData.keyData[keyField] || 0;

    console.log(`User has ${currentCrates} ${crateType} crates and ` +
        `${currentKeys} ${crateType} keys`);

    // Check if user has at least one crate or one key
    if (currentCrates <= 0 || currentKeys <= 0) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `Insufficient resources. You need at least 1 ${crateType} crate ` +
          `AND 1 ${crateType} key to open this crate.`,
      );
    }

    // Deduct both crate and key (one of each)
    garageData.crateData[crateField] -= 1;
    garageData.keyData[keyField] -= 1;
    console.log(`Deducted 1 ${crateType} crate and 1 ${crateType} key. ` +
        `Remaining crates: ${garageData.crateData[crateField]}, ` +
        `keys: ${garageData.keyData[keyField]}`);

    // Fetch crate distribution data
    const crateDistributionRef = db.collection("CratesDistributionData")
        .doc("CratesDistributionData");
    const crateDistributionDoc = await crateDistributionRef.get();

    if (!crateDistributionDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "Crate distribution data not found.",
      );
    }

    const distributionData = JSON.parse(
        crateDistributionDoc.data().CratesDistributionData,
    );
    const crateDistribution = distributionData[crateType];

    if (!crateDistribution) {
      throw new functions.https.HttpsError(
          "not-found",
          `Distribution data for crate type ${crateType} not found.`,
      );
    }

    // Categorize items by rarity
    const itemsByRarity = {
      Common: [],
      Rare: [],
      Exotic: [],
      Legendary: [],
      Mythical: [],
    };

    // Map item rarity numbers to names
    const rarityMap = {
      0: "Common",
      1: "Rare",
      2: "Exotic",
      3: "Legendary",
      4: "Mythical",
    };

    // Process garage items and categorize by rarity
    garageData.garageItemsData.forEach((item) => {
      const rarityName = rarityMap[item.itemRarity];

      // Skip items with "default" in their name (case-insensitive)
      if (rarityName && !item.itemName.toLowerCase().includes("default")) {
        // Add each color variant as a separate item
        item.variants.forEach((variant) => {
          itemsByRarity[rarityName].push({
            itemName: item.itemName,
            colorName: variant.colorName,
            itemType: item.itemType,
            itemRarity: item.itemRarity,
          });
        });
      }
    });

    // Create weighted item pool (100 items)
    const itemPool = [];
    const totalItems = 100;

    // Calculate item counts based on distribution percentages
    const commonCount = Math.round(
        (crateDistribution.CommonPercentage / 100) * totalItems,
    );
    const rareCount = Math.round(
        (crateDistribution.RarePercentage / 100) * totalItems,
    );
    const exoticCount = Math.round(
        (crateDistribution.ExoticPercentage / 100) * totalItems,
    );
    const legendaryCount = Math.round(
        (crateDistribution.LegendaryPercentage / 100) * totalItems,
    );
    const mythicalCount = Math.round(
        (crateDistribution.MythicalPercentage / 100) * totalItems,
    );

    // Helper function to add items to pool
    const addItemsToPool = (items, count) => {
      if (items.length === 0) {
        return 0; // Return how many items were actually added
      }

      for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * items.length);
        itemPool.push(items[randomIndex]);
      }
      return count;
    };

    // Add items to pool based on distribution
    const addedCommon = addItemsToPool(itemsByRarity.Common, commonCount);
    const addedRare = addItemsToPool(itemsByRarity.Rare, rareCount);
    const addedExotic = addItemsToPool(itemsByRarity.Exotic, exoticCount);
    const addedLegendary = addItemsToPool(
        itemsByRarity.Legendary, legendaryCount,
    );
    const addedMythical = addItemsToPool(
        itemsByRarity.Mythical, mythicalCount,
    );

    // Calculate how many items we still need to reach 100
    const totalAdded = addedCommon + addedRare + addedExotic +
        addedLegendary + addedMythical;
    const itemsNeeded = totalItems - totalAdded;

    // Fill remaining slots with available items (prioritize Common, then any)
    const fillRemainingSlots = (needed) => {
      let filled = 0;
      const availableRarities = [
        "Common", "Rare", "Exotic", "Legendary", "Mythical",
      ];

      for (const rarity of availableRarities) {
        if (filled >= needed) break;
        const availableItems = itemsByRarity[rarity];

        while (filled < needed && availableItems.length > 0) {
          const randomIndex = Math.floor(
              Math.random() * availableItems.length,
          );
          itemPool.push(availableItems[randomIndex]);
          filled++;
        }
      }
      return filled;
    };

    if (itemsNeeded > 0) {
      fillRemainingSlots(itemsNeeded);
    }

    // Final check - if we still don't have enough items, truncate to 100
    if (itemPool.length > totalItems) {
      itemPool.length = totalItems; // Trim to exactly 100
    }

    // Select a random item from the pool
    if (itemPool.length === 0) {
      throw new functions.https.HttpsError(
          "internal",
          "No items available for crate opening.",
      );
    }

    const randomIndex = Math.floor(Math.random() * itemPool.length);
    const selectedItem = itemPool[randomIndex];

    // Update user's garage data - increment the count for the selected item
    const updatedGarageData = {...garageData};
    const itemToUpdate = updatedGarageData.garageItemsData.find(
        (item) => item.itemName === selectedItem.itemName,
    );

    if (itemToUpdate) {
      const variantToUpdate = itemToUpdate.variants.find(
          (variant) => variant.colorName === selectedItem.colorName,
      );

      if (variantToUpdate) {
        variantToUpdate.count += 1;
        console.log(`Added ${selectedItem.itemName} ` +
            `${selectedItem.colorName} to garage ` +
            `(count: ${variantToUpdate.count})`);
      }
    } // Save updated garage data back to Firestore
    await userGarageRef.update({
      garageData: JSON.stringify(updatedGarageData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Return the selected item to Unity as a clean JSON
    return {
      success: true,
      itemName: selectedItem.itemName,
      colorName: selectedItem.colorName,
      itemType: selectedItem.itemType,
      itemRarity: selectedItem.itemRarity,
      message: `Successfully opened ${crateType} crate`,
    };
  } catch (error) {
    console.error("Error in openCrate function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to open crate.",
        error.message,
    );
  }
});

// =============================================================================
// CLAN SYSTEM - Create and manage clan functionality
// =============================================================================

/**
 * Clan roles and types
 */
const CLAN_ROLES = {
  LEADER: "leader",
  CO_LEADER: "co-leader",
  MEMBER: "member",
};

const CLAN_TYPES = {
  OPEN: 0,       // Open clan (anyone can join directly)
  REQUEST: 1,    // Request to join (requires approval)
  CLOSED: 2,     // Closed (invitation only)
};

const MAX_CLAN_MEMBERS = 50; // Maximum members per clan

/**
 * Find clan by clanId
 * Helper function to find a clan by its ID
 */
async function findClanByClanId(db, clanId) {
  try {
    console.log(`Finding clan by clanId: ${clanId}`);
    const clansRef = db.collection("clans");
    const snapshot = await clansRef.where("clanId", "==", clanId).limit(1).get();
    
    if (snapshot.empty) {
      console.log(`No clan found with clanId: ${clanId}`);
      return null;
    }
    
    console.log(`Found clan with clanId: ${clanId}, document ID: ${snapshot.docs[0].id}`);
    return {
      doc: snapshot.docs[0],
      id: snapshot.docs[0].id,
      data: snapshot.docs[0].data(),
    };
  } catch (error) {
    console.error(`Error finding clan by clanId ${clanId}:`, error);
    return null;
  }
}

/**
 * Get user profile helper function
 */
async function getUserProfile(db, userId) {
  try {
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      // Create a minimal profile
      console.log(`Creating minimal profile for user ${userId}`);
      const minimalProfile = {
        userId: userId,
        username: `Player_${userId.substring(0, 5)}`,
        trophyLevel: 0
      };
      
      await userProfileRef.set({
        profileData: JSON.stringify(minimalProfile)
      });
      
      return {
        ref: userProfileRef,
        data: minimalProfile
      };
    }

    // Parse profile data, handle potential JSON parsing errors
    try {
      const profileData = JSON.parse(userProfileDoc.data().profileData);
      return {
        ref: userProfileRef,
        data: profileData,
      };
    } catch (parseError) {
      console.error(`Error parsing profile data for user ${userId}:`, parseError);
      
      // Return minimal profile if parsing fails
      const minimalProfile = {
        userId: userId,
        username: `Player_${userId.substring(0, 5)}`,
        trophyLevel: 0
      };
      
      return {
        ref: userProfileRef,
        data: minimalProfile
      };
    }
  } catch (error) {
    console.error(`Error in getUserProfile for user ${userId}:`, error);
    throw new functions.https.HttpsError(
        "internal",
        "Internal error fetching user profile"
    );
  }
}

/**
 * Update user profile with clan info
 */
async function updateUserProfileWithClanInfo(db, userId, clanId, clanRole, clanName = null, clanBadge = null) {
  console.log(`updateUserProfileWithClanInfo called for user ${userId} with clanId: ${clanId}, clanRole: ${clanRole}, clanName: ${clanName}, clanBadge: ${clanBadge}`);
  
  const profile = await getUserProfile(db, userId);
  
  console.log(`Current profile data for user ${userId}:`, profile.data);
  
  const updatedProfileData = {
    ...profile.data,
    clanId: clanId,
    clanRole: clanRole,
  };

  // If clanName and clanBadge are not provided, fetch them from clan data
  if (clanName === null || clanBadge === null) {
    console.log(`Fetching clan details for ${clanId} because clanName or clanBadge is null`);
    try {
      const clan = await findClanByClanId(db, clanId);
      if (clan && clan.data) {
        if (clanName === null) clanName = clan.data.clanName;
        if (clanBadge === null) clanBadge = clan.data.clanBadge;
        console.log(`Fetched clan details - clanName: ${clanName}, clanBadge: ${clanBadge}`);
      }
    } catch (error) {
      console.error(`Error fetching clan details for ${clanId}:`, error);
      // Continue with null values if fetch fails
    }
  }

  // Add clanName and clanBadge to profile
  if (clanName !== null) {
    updatedProfileData.clanName = clanName;
  }
  if (clanBadge !== null) {
    updatedProfileData.clanBadge = clanBadge;
  }

  console.log(`Final updated profile data for user ${userId}:`, updatedProfileData);

  await profile.ref.update({
    profileData: JSON.stringify(updatedProfileData),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });
  
  console.log(`Successfully updated profile for user ${userId} with clan info`);
}

/**
 * Remove clan info from user profile
 */
async function removeClanInfoFromUserProfile(db, userId) {
  const profile = await getUserProfile(db, userId);
  
  console.log(`Removing clan info for user ${userId}. Current clan fields:`, {
    clanId: profile.data.clanId,
    clanRole: profile.data.clanRole,
    clanName: profile.data.clanName,
    clanBadge: profile.data.clanBadge
  });
  
  // Remove ALL clan-related fields to prevent data inconsistency
  const { clanId, clanRole, clanName, clanBadge, ...profileWithoutClan } = profile.data;
  
  await profile.ref.update({
    profileData: JSON.stringify(profileWithoutClan),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  });
  
  console.log(`Successfully removed all clan fields for user ${userId}`);
}

/**
 * Fix clan data inconsistencies
 * This function checks if a user has a valid clan association
 * and fixes the user profile if there's an inconsistency
 */
async function fixClanDataInconsistency(db, userId) {
  try {
    // Get user profile
    const profile = await getUserProfile(db, userId);
    
    // Check if user has a clanId in their profile
    if (profile.data.clanId) {
      // Check if clan exists
      const clan = await findClanByClanId(db, profile.data.clanId);
      
      if (!clan) {
        // Clan doesn't exist, remove clan info from profile
        console.log(`Fixing inconsistent data: User ${userId} has clanId ${profile.data.clanId} but clan not found.`);
        const { clanId, clanRole, ...profileWithoutClan } = profile.data;
        await profile.ref.update({
          profileData: JSON.stringify(profileWithoutClan),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        return {
          fixed: true,
          message: "Removed invalid clan reference from user profile"
        };
      }
      
      // Clan exists, check if user is in members list
      const isInMembers = clan.data.members.some(m => m.userId === userId);
      if (!isInMembers) {
        // User is not in members list, remove clan info from profile
        console.log(`Fixing inconsistent data: User ${userId} has clanId ${profile.data.clanId} but is not in clan's member list.`);
        const { clanId, clanRole, ...profileWithoutClan } = profile.data;
        await profile.ref.update({
          profileData: JSON.stringify(profileWithoutClan),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        return {
          fixed: true,
          message: "Removed clan reference - user not in clan's member list"
        };
      }
    }
    
    // Check if user owns a clan but doesn't have it in profile
    const clansRef = db.collection("clans").doc(userId);
    const clansDoc = await clansRef.get();
    
    if (clansDoc.exists) {
      const clanData = clansDoc.data();
      // User has a clan but no clanId in profile
      if (!profile.data.clanId) {
        // Add clan info to profile
        console.log(`Fixing inconsistent data: User ${userId} owns clan ${clanData.clanId} but has no clanId in profile.`);
        const updatedProfileData = {
          ...profile.data,
          clanId: clanData.clanId,
          clanRole: CLAN_ROLES.LEADER,
        };
        
        await profile.ref.update({
          profileData: JSON.stringify(updatedProfileData),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          fixed: true,
          message: "Added missing clan reference to user profile"
        };
      }
    }
    
    return {
      fixed: false,
      message: "No inconsistencies found"
    };
  } catch (error) {
    console.error("Error fixing clan data inconsistency:", error);
    return {
      fixed: false,
      error: error.message
    };
  }
}

/**
 * Update clan totalTrophies field
 * Helper function to calculate and update the total trophies of a clan based on member trophies
 */
async function updateClanTotalTrophies(db, clan) {
  try {
    // Calculate total trophies from members
    const totalTrophies = clan.data.members.reduce((sum, member) => sum + (member.trophies || 0), 0);
    
    // Check if totalTrophies already exists and is the same
    if (clan.data.totalTrophies === totalTrophies) {
      return {
        updated: false,
        totalTrophies: totalTrophies
      };
    }
    
    // Update clan document with new total trophies
    const clanRef = db.collection("clans").doc(clan.id);
    await clanRef.update({
      totalTrophies: totalTrophies,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Updated total trophies for clan ${clan.data.clanId} to ${totalTrophies}`);
    
    return {
      updated: true,
      totalTrophies: totalTrophies
    };
  } catch (error) {
    console.error(`Error updating clan total trophies for clan ${clan.data.clanId}:`, error);
    return {
      updated: false,
      error: error.message
    };
  }
}

/**
 * Check user permissions for clan operations
 */
function checkClanPermissions(clanData, userId, allowedRoles) {
  const member = clanData.members.find((m) => m.userId === userId);
  
  if (!member) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "You are not a member of this clan."
    );
  }
  
  if (!allowedRoles.includes(member.role)) {
    throw new functions.https.HttpsError(
        "permission-denied",
        `This action requires ${allowedRoles.join(" or ")} privileges.`
    );
  }
  
  return member;
}

/**
 * Create a new clan
 * 
 * @param {Object} data - Clan creation data
 * @param {string} data.clanName - Name of the clan
 * @param {string} data.clanDescription - Description of the clan
 * @param {number} data.clanBadge - Badge ID for the clan
 * @param {number} data.clanType - Type of clan (0 = open, 1 = request to join, 2 = closed)
 * @param {string} data.clanLocation - Location/region of the clan
 * @param {string} data.clanLanguage - Primary language of the clan
 * @param {number} data.minimumRequiredTrophies - Minimum trophies required to join
 * @returns {Object} - Response with clan data
 */
exports.createClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`createClan called for userId: ${userId}`);

  try {
    const db = admin.firestore();
    
    // Validate required fields
    const requiredFields = [
      "clanName", "clanDescription", "clanBadge", 
      "clanType", "clanLocation", "clanLanguage", 
      "minimumRequiredTrophies"
    ];
    
    for (const field of requiredFields) {
      if (actualData[field] === undefined || actualData[field] === null) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `Missing required field: ${field}`
        );
      }
    }

    // Validate clan name length
    if (actualData.clanName.length < 3 || actualData.clanName.length > 20) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Clan name must be between 3 and 20 characters"
      );
    }

    // Check if user already has a clan - check both the clans collection and user profile
    const existingClansRef = db.collection("clans").doc(userId);
    const existingClansDoc = await existingClansRef.get();
    
    // Get user profile to check clanId
    const userProfileForCheck = await getUserProfile(db, userId);
    
    if (existingClansDoc.exists || userProfileForCheck.data.clanId) {
      // If there's an inconsistency, try to fix it by checking if the clan actually exists
      if (userProfileForCheck.data.clanId && !existingClansDoc.exists) {
        // Check if the clan referenced in the user profile actually exists
        const existingClan = await findClanByClanId(db, userProfileForCheck.data.clanId);
        if (!existingClan) {
          // The clan doesn't exist, so clear the clanId from user profile
          console.log(`Fixing inconsistent data: User ${userId} has clanId ${userProfileForCheck.data.clanId} but clan not found.`);
          const { clanId, clanRole, ...profileWithoutClan } = userProfileForCheck.data;
          await userProfileForCheck.ref.update({
            profileData: JSON.stringify(profileWithoutClan),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          // Continue with creating new clan
        } else {
          // Clan exists, so user is already in a clan
          throw new functions.https.HttpsError(
              "already-exists",
              "You already have a clan. You can only create one clan per account."
          );
        }
      } else {
        throw new functions.https.HttpsError(
            "already-exists",
            "You already have a clan. You can only create one clan per account."
        );
      }
    }

    // Get user profile to get user name for members list
    const userProfile = await getUserProfile(db, userId);
    const userName = userProfile.data.username || "Unknown Player";
    const userTrophies = userProfile.data.trophyLevel || 0;

    // Create clan data
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const clanData = {
      clanId: `clan_${userId}_${Date.now()}`,
      clanName: actualData.clanName,
      clanDescription: actualData.clanDescription,
      clanBadge: actualData.clanBadge,
      clanType: actualData.clanType,
      clanLocation: actualData.clanLocation,
      clanLanguage: actualData.clanLanguage,
      minimumRequiredTrophies: actualData.minimumRequiredTrophies,
      createdBy: userId,
      createdAt: timestamp,
      lastUpdated: timestamp,
      members: [
        {
          userId: userId,
          userName: userName,
          role: CLAN_ROLES.LEADER,
          joinedAt: new Date(),
          trophies: userTrophies
        }
      ],
      requestsToJoin: [],
      invites: [],
      totalMembers: 1,
      totalTrophies: userTrophies // Initialize with the leader's trophies
    };

    // Save clan to Firestore
    await existingClansRef.set(clanData);

    // Update user profile to mark as clan owner
    await updateUserProfileWithClanInfo(db, userId, clanData.clanId, CLAN_ROLES.LEADER, clanData.clanName, clanData.clanBadge);

    console.log(`Clan created: ${clanData.clanId} by user ${userId}`);

    return {
      success: true,
      message: "Clan created successfully",
      clanData: {
        clanId: clanData.clanId,
        clanName: clanData.clanName,
        clanBadge: clanData.clanBadge,
        clanType: clanData.clanType,
        totalMembers: clanData.totalMembers,
        role: CLAN_ROLES.LEADER
      }
    };
  } catch (error) {
    console.error("Error in createClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to create clan",
        error.details
    );
  }
});

/**
 * Join an existing clan
 * 
 * @param {Object} data - Join clan data
 * @param {string} data.clanId - ID of the clan to join
 * @returns {Object} - Response with join status
 */
exports.joinClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const clanId = actualData.clanId;

  console.log(`joinClan called for userId: ${userId}, clanId: ${clanId}`);

  try {
    const db = admin.firestore();
    
    if (!clanId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing clanId parameter"
      );
    }

    // Get user profile
    const userProfile = await getUserProfile(db, userId);
    
    // DEBUG: Log user profile data to see what trophy fields exist
    console.log(`DEBUG - User ${userId} profile data keys:`, Object.keys(userProfile.data));
    console.log(`DEBUG - User ${userId} trophyLevel:`, userProfile.data.trophyLevel);
    console.log(`DEBUG - User ${userId} playerTrophies:`, userProfile.data.playerTrophies);
    console.log(`DEBUG - User ${userId} trophies:`, userProfile.data.trophies);
    
    // Check if user is already in a clan
    if (userProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are already a member of a clan. Leave your current clan before joining a new one."
      );
    }

    // Find the clan by clanId
    const clan = await findClanByClanId(db, clanId);
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }

    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if clan is full
    if (clanData.totalMembers >= MAX_CLAN_MEMBERS) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Clan is full. Maximum members reached."
      );
    }
    
    // Check trophy requirements
    const userTrophies = userProfile.data.trophyLevel || 0;
    if (userTrophies < clanData.minimumRequiredTrophies) {
      throw new functions.https.HttpsError(
          "permission-denied",
          `You need at least ${clanData.minimumRequiredTrophies} trophies to join this clan.`
      );
    }

    // Check clan type and handle accordingly
    if (clanData.clanType === CLAN_TYPES.OPEN) {
      // For open clans, directly add the user
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      const newMember = {
        userId: userId,
        userName: userProfile.data.username || "Unknown Player",
        role: CLAN_ROLES.MEMBER,
        joinedAt: new Date(),
        trophies: userTrophies
      };
      
      // Update clan with new member
      await clanRef.update({
        members: admin.firestore.FieldValue.arrayUnion(newMember),
        totalMembers: admin.firestore.FieldValue.increment(1),
        lastUpdated: timestamp
      });
      
      // Update user profile with clan info
      await updateUserProfileWithClanInfo(db, userId, clanId, CLAN_ROLES.MEMBER, clanData.clanName, clanData.clanBadge);
      
      // VERIFICATION: Read back the profile to confirm data was saved
      console.log("VERIFICATION: Reading back user profile after join...");
      const verifyProfile = await getUserProfile(db, userId);
      console.log("VERIFICATION: Profile after join:", {
        clanId: verifyProfile.data.clanId,
        clanRole: verifyProfile.data.clanRole,
        clanName: verifyProfile.data.clanName,
        clanBadge: verifyProfile.data.clanBadge
      });
      
      return {
        success: true,
        message: "Successfully joined the clan",
        clanData: {
          clanId: clanData.clanId,
          clanName: clanData.clanName,
          clanBadge: clanData.clanBadge,
          role: CLAN_ROLES.MEMBER
        }
      };
    } else if (clanData.clanType === CLAN_TYPES.REQUEST || clanData.clanType === CLAN_TYPES.CLOSED) {
      // For request-to-join (type 1) and closed clans (type 2), check if user is invited
      const isInvited = (clanData.invites || []).includes(userId);
      
      if (isInvited) {
        // User is invited, add them to the clan
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const newMember = {
          userId: userId,
          userName: userProfile.data.username || "Unknown Player",
          role: CLAN_ROLES.MEMBER,
          joinedAt: new Date(),
          trophies: userTrophies
        };
        
        // Update clan with new member and remove from invites
        await clanRef.update({
          members: admin.firestore.FieldValue.arrayUnion(newMember),
          invites: admin.firestore.FieldValue.arrayRemove(userId),
          totalMembers: admin.firestore.FieldValue.increment(1),
          lastUpdated: timestamp
        });
        
        // Update user profile with clan info
        await updateUserProfileWithClanInfo(db, userId, clanId, CLAN_ROLES.MEMBER, clanData.clanName, clanData.clanBadge);
        
        // VERIFICATION: Read back the profile to confirm data was saved
        console.log("VERIFICATION: Reading back user profile after invitation join...");
        const verifyProfile = await getUserProfile(db, userId);
        console.log("VERIFICATION: Profile after invitation join:", {
          clanId: verifyProfile.data.clanId,
          clanRole: verifyProfile.data.clanRole,
          clanName: verifyProfile.data.clanName,
          clanBadge: verifyProfile.data.clanBadge
        });
        
        return {
          success: true,
          message: "Successfully joined the clan via invitation",
          clanData: {
            clanId: clanData.clanId,
            clanName: clanData.clanName,
            clanBadge: clanData.clanBadge,
            role: CLAN_ROLES.MEMBER
          }
        };
      } else {
        // User is not invited to an invite-only or closed clan
        throw new functions.https.HttpsError(
            "permission-denied",
            `This clan requires an invitation to join.`
        );
      }
    }
    
    // Should never reach here due to the if-else structure above
    throw new functions.https.HttpsError(
        "internal",
        "Unknown clan type."
    );
  } catch (error) {
    console.error("Error in joinClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to join clan",
        error.details
    );
  }
});

/**
 * Leave a clan
 * 
 * @param {Object} data - Leave clan data
 * @returns {Object} - Response with leave status
 */
exports.leaveClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  // Prioritize the userId from the request data over the authenticated userId
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`leaveClan called for userId: ${userId}`);

  try {
    const db = admin.firestore();
    
    // Get user profile
    const userProfile = await getUserProfile(db, userId);
    
    // First, check if user is in a clan based on profile
    let clanId = null;
    if (userProfile && userProfile.data && userProfile.data.clanId) {
      clanId = userProfile.data.clanId;
    }
    
    // If no clanId in profile, check if they own a clan (data inconsistency case)
    if (!clanId) {
      console.log(`User ${userId} has no clanId in profile, checking if they own a clan...`);
      
      try {
        // Check if the user owns a clan
        const ownedClansQuery = await db.collection("clans").doc(userId).get();
        
        if (ownedClansQuery.exists) {
          const clanData = ownedClansQuery.data();
          if (clanData && clanData.clanId) {
            clanId = clanData.clanId;
            console.log(`Found clan ownership: User ${userId} owns clan ${clanId} - fixing inconsistency`);
            
            // Fix the inconsistency by updating the user's profile
            await updateUserProfileWithClanInfo(db, userId, clanId, CLAN_ROLES.LEADER);
          }
        }
      } catch (err) {
        console.error("Error checking clan ownership:", err);
      }
    }
    
    // Check if user is in a clan (either from profile or ownership check)
    if (!clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      // Clan not found but user has clanId - clean up user profile
      await removeClanInfoFromUserProfile(db, userId);
      
      return {
        success: true,
        message: "You have been removed from the clan (clan not found)."
      };
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if user is the clan leader
    const userMember = clanData.members.find(m => m.userId === userId);
    if (userMember && userMember.role === CLAN_ROLES.LEADER) {
      // If leader is leaving, check if there are co-leaders who can take over
      const coLeaders = clanData.members.filter(m => 
        m.userId !== userId && m.role === CLAN_ROLES.CO_LEADER);
      
      if (coLeaders.length > 0) {
        // Promote the first co-leader to leader
        const newLeader = coLeaders[0];
        const updatedMembers = clanData.members.map(m => {
          if (m.userId === newLeader.userId) {
            return {...m, role: CLAN_ROLES.LEADER};
          }
          return m;
        }).filter(m => m.userId !== userId);
        
        // Update clan with new leader and remove current user
        await clanRef.update({
          members: updatedMembers,
          totalMembers: admin.firestore.FieldValue.increment(-1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Update new leader's profile
        await updateUserProfileWithClanInfo(db, newLeader.userId, clanId, CLAN_ROLES.LEADER);
      } else {
        // No co-leaders, check for any members
        const otherMembers = clanData.members.filter(m => m.userId !== userId);
        
        if (otherMembers.length > 0) {
          // Promote the first member to leader
          const newLeader = otherMembers[0];
          const updatedMembers = clanData.members.map(m => {
            if (m.userId === newLeader.userId) {
              return {...m, role: CLAN_ROLES.LEADER};
            }
            return m;
          }).filter(m => m.userId !== userId);
          
          // Update clan with new leader and remove current user
          await clanRef.update({
            members: updatedMembers,
            totalMembers: admin.firestore.FieldValue.increment(-1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          
          // Update new leader's profile
          await updateUserProfileWithClanInfo(db, newLeader.userId, clanId, CLAN_ROLES.LEADER);
        } else {
          // No other members, delete the clan
          await clanRef.delete();
        }
      }
    } else {
      // Regular member or co-leader leaving
      const updatedMembers = clanData.members.filter(m => m.userId !== userId);
      
      // Update clan by removing the user
      await clanRef.update({
        members: updatedMembers,
        totalMembers: admin.firestore.FieldValue.increment(-1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Remove clan info from user profile
    await removeClanInfoFromUserProfile(db, userId);
    
    return {
      success: true,
      message: "You have successfully left the clan."
    };
  } catch (error) {
    console.error("Error in leaveClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to leave clan",
        error.details
    );
  }
});

/**
 * Invite user to clan
 * 
 * @param {Object} data - Invite data
 * @param {string} data.targetUserId - ID of user to invite
 * @returns {Object} - Response with invitation status
 */
exports.inviteToClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`inviteToClan called by userId: ${userId}, inviting: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Get user profile (inviter)
    const userProfile = await getUserProfile(db, userId);
    
    // Check if user is in a clan
    if (!userProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    const clanId = userProfile.data.clanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if user has permission to invite (leader or co-leader)
    checkClanPermissions(clanData, userId, [CLAN_ROLES.LEADER, CLAN_ROLES.CO_LEADER]);
    
    // Check if clan is full
    if (clanData.totalMembers >= MAX_CLAN_MEMBERS) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Clan is full. Cannot invite more members."
      );
    }
    
    // Check if target user exists
    const targetUserProfile = await getUserProfile(db, targetUserId);
    
    // Check if target user is already in a clan
    if (targetUserProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "User is already a member of a clan."
      );
    }
    
    // Check if user is already invited
    const invites = clanData.invites || [];
    if (invites.includes(targetUserId)) {
      throw new functions.https.HttpsError(
          "already-exists",
          "User has already been invited to this clan."
      );
    }
    
    // Add user to invites
    await clanRef.update({
      invites: admin.firestore.FieldValue.arrayUnion(targetUserId),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return {
      success: true,
      message: "Invitation sent successfully",
      targetUserId: targetUserId,
      clanData: {
        clanId: clanData.clanId,
        clanName: clanData.clanName,
      }
    };
  } catch (error) {
    console.error("Error in inviteToClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to invite user to clan",
        error.details
    );
  }
});

/**
 * Request to join clan
 * 
 * @param {Object} data - Request data
 * @param {string} data.clanId - ID of clan to join
 * @returns {Object} - Response with request status
 */
exports.requestToJoinClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  
  // Safe logging of request data
  console.log("Front-end provided userId:", actualData.userId);
  console.log("Auth userId:", authUserId);
  console.log("Clan ID:", actualData.clanId);
  
  // Prioritize the userId from the request data over the authenticated userId
  const userId = actualData.userId || authUserId || defaultUserId;
  const clanId = actualData.clanId;

  console.log(`requestToJoinClan called for userId: ${userId}, clanId: ${clanId}`);

  try {
    const db = admin.firestore();
    
    if (!clanId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing clanId parameter"
      );
    }

    // Check for and fix any data inconsistencies first
    const fixResult = await fixClanDataInconsistency(db, userId);
    if (fixResult.fixed) {
      console.log(`Fixed clan data inconsistency for user ${userId}: ${fixResult.message}`);
    }

    // Get user profile after potential fixes
    const userProfile = await getUserProfile(db, userId);
    console.log(`User ${userId} profile clanId: ${userProfile.data.clanId}`);
    
    // More thorough check: verify user is actually not in any clan
    let isUserInAnyClan = false;
    let userCurrentClanId = null;
    
    // First check if user has a clanId in profile
    if (userProfile.data.clanId) {
      console.log(`User ${userId} has clanId in profile: ${userProfile.data.clanId}`);
      
      // Verify the clan actually exists and user is in it
      const currentClan = await findClanByClanId(db, userProfile.data.clanId);
      if (currentClan) {
        console.log(`Found clan for clanId ${userProfile.data.clanId}, checking member list...`);
        console.log(`Clan members: ${JSON.stringify(currentClan.data.members.map(m => ({userId: m.userId, userName: m.userName})))}`);
        
        const memberExists = currentClan.data.members.some(m => m.userId === userId);
        console.log(`User ${userId} is in member list: ${memberExists}`);
        
        if (memberExists) {
          isUserInAnyClan = true;
          userCurrentClanId = userProfile.data.clanId;
          console.log(`User ${userId} is confirmed to be in clan ${userCurrentClanId}`);
        } else {
          console.log(`User ${userId} has invalid clanId reference, will clean it up`);
          // Clean up the invalid reference immediately
          const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
          await userProfile.ref.update({
            profileData: JSON.stringify(profileWithoutClan),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Cleaned up invalid clan reference for user ${userId}`);
        }
      } else {
        console.log(`Clan not found for clanId ${userProfile.data.clanId}, cleaning up profile`);
        // Clean up the invalid reference immediately
        const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
        await userProfile.ref.update({
          profileData: JSON.stringify(profileWithoutClan),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Cleaned up non-existent clan reference for user ${userId}`);
      }
    } else {
      console.log(`User ${userId} has no clanId in profile`);
    }
    
    // Also check if user owns a clan (they could be a leader without clanId in profile)
    if (!isUserInAnyClan) {
      console.log(`Checking if user ${userId} owns a clan...`);
      const clansRef = db.collection("clans").doc(userId);
      const clansDoc = await clansRef.get();
      
      if (clansDoc.exists) {
        const ownedClanData = clansDoc.data();
        isUserInAnyClan = true;
        userCurrentClanId = ownedClanData.clanId;
        console.log(`User ${userId} owns clan ${userCurrentClanId}`);
        
        // Update profile to include the clan info if missing
        if (!userProfile.data.clanId) {
          console.log(`Adding missing clan info to user ${userId} profile`);
          const updatedProfileData = {
            ...userProfile.data,
            clanId: ownedClanData.clanId,
            clanRole: CLAN_ROLES.LEADER,
          };
          
          await userProfile.ref.update({
            profileData: JSON.stringify(updatedProfileData),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } else {
        console.log(`User ${userId} does not own a clan`);
      }
    } else {
      console.log(`User ${userId} already confirmed to be in a clan, skipping ownership check`);
    }
    
    // Final check: if user is in any clan, reject the request
    if (isUserInAnyClan) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `You are already a member of clan "${userCurrentClanId}". Leave your current clan before requesting to join a new one.`
      );
    }
    
    console.log(`User ${userId} confirmed to not be in any clan, proceeding with join request`);

    // Get user profile one more time to ensure we have the latest data
    const finalUserProfile = await getUserProfile(db, userId);

    // Find the clan by clanId
    const clan = await findClanByClanId(db, clanId);
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }

    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if clan is full
    if (clanData.totalMembers >= MAX_CLAN_MEMBERS) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Clan is full. Cannot request to join."
      );
    }
    
    // Check trophy requirements
    const userTrophies = finalUserProfile.data.trophyLevel || 0;
    if (userTrophies < clanData.minimumRequiredTrophies) {
      throw new functions.https.HttpsError(
          "permission-denied",
          `You need at least ${clanData.minimumRequiredTrophies} trophies to join this clan.`
      );
    }

    // Check clan type
    if (clanData.clanType === CLAN_TYPES.OPEN) {
      // For type 0 clans, directly add the user (open clan)
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      const newMember = {
        userId: userId,
        userName: finalUserProfile.data.username || "Unknown Player",
        role: CLAN_ROLES.MEMBER,
        joinedAt: new Date(),
        trophies: userTrophies
      };
      
      // Update clan with new member
      await clanRef.update({
        members: admin.firestore.FieldValue.arrayUnion(newMember),
        totalMembers: admin.firestore.FieldValue.increment(1),
        lastUpdated: timestamp
      });
      
      // Update user profile with clan info
      await updateUserProfileWithClanInfo(db, userId, clanId, CLAN_ROLES.MEMBER);
      
      return {
        success: true,
        message: "Successfully joined the clan",
        clanData: {
          clanId: clanData.clanId,
          clanName: clanData.clanName,
          clanBadge: clanData.clanBadge,
          role: CLAN_ROLES.MEMBER
        }
      };
    } else if (clanData.clanType === CLAN_TYPES.REQUEST) {
      // For type 1 clans, add user to requests list for approval (request to join)
      const requestsToJoin = clanData.requestsToJoin || [];
      
      if (requestsToJoin.includes(userId)) {
        throw new functions.https.HttpsError(
            "already-exists",
            "You have already requested to join this clan."
        );
      }
      
      // Add user to requests list
      await clanRef.update({
        requestsToJoin: admin.firestore.FieldValue.arrayUnion(userId),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: true,
        message: "Join request sent successfully. Waiting for clan leader/co-leader approval.",
        clanId: clanData.clanId
      };
    } else if (clanData.clanType === CLAN_TYPES.CLOSED) {
      // For type 2 clans, only invites are allowed (closed)
      throw new functions.https.HttpsError(
          "permission-denied",
          "This clan is closed and only accepts invited members."
      );
    }
    
    // Should never reach here due to the if-else structure above
    throw new functions.https.HttpsError(
        "internal",
        "Unknown clan type."
    );
  } catch (error) {
    console.error("Error in requestToJoinClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to request joining clan",
        error.details
    );
  }
});

/**
 * Accept join request
 * 
 * @param {Object} data - Accept request data
 * @param {string} data.targetUserId - ID of user whose request to accept
 * @returns {Object} - Response with accept status
 */
exports.acceptJoinRequest = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`acceptJoinRequest called by userId: ${userId}, accepting: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Check for and fix any data inconsistencies first
    const fixResult = await fixClanDataInconsistency(db, userId);
    if (fixResult.fixed) {
      console.log(`Fixed clan data inconsistency for user ${userId}: ${fixResult.message}`);
    }
    
    // Get user profile (clan admin) after potential fixes
    const userProfile = await getUserProfile(db, userId);
    console.log(`User ${userId} profile clanId: ${userProfile.data.clanId}`);
    
    // More thorough check: verify user is actually in a clan and has proper role
    let isUserInAnyClan = false;
    let userCurrentClanId = null;
    let userClanRole = null;
    
    // First check if user has a clanId in profile
    if (userProfile.data.clanId) {
      console.log(`User ${userId} has clanId in profile: ${userProfile.data.clanId}`);
      
      // Verify the clan actually exists and user is in it
      const currentClan = await findClanByClanId(db, userProfile.data.clanId);
      if (currentClan) {
        console.log(`Found clan for clanId ${userProfile.data.clanId}, checking member list...`);
        
        const memberData = currentClan.data.members.find(m => m.userId === userId);
        if (memberData) {
          isUserInAnyClan = true;
          userCurrentClanId = userProfile.data.clanId;
          userClanRole = memberData.role;
          console.log(`User ${userId} is confirmed to be in clan ${userCurrentClanId} with role ${userClanRole}`);
        } else {
          console.log(`User ${userId} has invalid clanId reference, will clean it up`);
          // Clean up the invalid reference immediately
          const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
          await userProfile.ref.update({
            profileData: JSON.stringify(profileWithoutClan),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Cleaned up invalid clan reference for user ${userId}`);
        }
      } else {
        console.log(`Clan not found for clanId ${userProfile.data.clanId}, cleaning up profile`);
        // Clean up the invalid reference immediately
        const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
        await userProfile.ref.update({
          profileData: JSON.stringify(profileWithoutClan),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Cleaned up non-existent clan reference for user ${userId}`);
      }
    } else {
      console.log(`User ${userId} has no clanId in profile`);
    }
    
    // Also check if user owns a clan (they could be a leader without clanId in profile)
    if (!isUserInAnyClan) {
      console.log(`Checking if user ${userId} owns a clan...`);
      const clansRef = db.collection("clans").doc(userId);
      const clansDoc = await clansRef.get();
      
      if (clansDoc.exists) {
        const ownedClanData = clansDoc.data();
        isUserInAnyClan = true;
        userCurrentClanId = ownedClanData.clanId;
        userClanRole = CLAN_ROLES.LEADER;
        console.log(`User ${userId} owns clan ${userCurrentClanId} as LEADER`);
        
        // Update profile to include the clan info if missing
        if (!userProfile.data.clanId) {
          console.log(`Adding missing clan info to user ${userId} profile`);
          const updatedProfileData = {
            ...userProfile.data,
            clanId: ownedClanData.clanId,
            clanRole: CLAN_ROLES.LEADER,
          };
          
          await userProfile.ref.update({
            profileData: JSON.stringify(updatedProfileData),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } else {
        console.log(`User ${userId} does not own a clan`);
      }
    } else {
      console.log(`User ${userId} already confirmed to be in a clan, skipping ownership check`);
    }
    
    // Final check: if user is not in any clan, reject the request
    if (!isUserInAnyClan) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    console.log(`User ${userId} confirmed to be in clan ${userCurrentClanId} with role ${userClanRole}`);
    
    // Check if user has permission to accept requests (leader or co-leader)
    if (userClanRole !== CLAN_ROLES.LEADER && userClanRole !== CLAN_ROLES.CO_LEADER) {
      throw new functions.https.HttpsError(
          "permission-denied",
          "Only clan leaders and co-leaders can accept join requests."
      );
    }
    
    const clanId = userCurrentClanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if clan is full
    if (clanData.totalMembers >= MAX_CLAN_MEMBERS) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Clan is full. Cannot accept more members."
      );
    }
    
    // Check if target user requested to join
    const requestsToJoin = clanData.requestsToJoin || [];
    if (!requestsToJoin.includes(targetUserId)) {
      throw new functions.https.HttpsError(
          "not-found",
          "User has not requested to join this clan."
      );
    }
    
    // Get target user profile
    const targetUserProfile = await getUserProfile(db, targetUserId);
    
    // Check if target user is already in a clan
    if (targetUserProfile.data.clanId) {
      // Remove from requests and return error
      await clanRef.update({
        requestsToJoin: admin.firestore.FieldValue.arrayRemove(targetUserId),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      throw new functions.https.HttpsError(
          "failed-precondition",
          "User is already a member of another clan."
      );
    }

    // Add target user to clan
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const newMember = {
      userId: targetUserId,
      userName: targetUserProfile.data.username || "Unknown Player",
      role: CLAN_ROLES.MEMBER,
      joinedAt: new Date(),
      trophies: targetUserProfile.data.trophyLevel || 0
    };
    
    // Update clan document
    await clanRef.update({
      members: admin.firestore.FieldValue.arrayUnion(newMember),
      requestsToJoin: admin.firestore.FieldValue.arrayRemove(targetUserId),
      totalMembers: admin.firestore.FieldValue.increment(1),
      lastUpdated: timestamp
    });
    
    // Update target user profile
    await updateUserProfileWithClanInfo(db, targetUserId, clanId, CLAN_ROLES.MEMBER);
    
    return {
      success: true,
      message: "Join request accepted successfully",
      targetUserId: targetUserId,
      newMember: newMember
    };
  } catch (error) {
    console.error("Error in acceptJoinRequest function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to accept join request",
        error.details
    );
  }
});

/**
 * Decline join request
 * 
 * @param {Object} data - Decline request data
 * @param {string} data.targetUserId - ID of user whose request to decline
 * @returns {Object} - Response with decline status
 */
exports.declineJoinRequest = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`declineJoinRequest called by userId: ${userId}, declining: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Check for and fix any data inconsistencies first
    const fixResult = await fixClanDataInconsistency(db, userId);
    if (fixResult.fixed) {
      console.log(`Fixed clan data inconsistency for user ${userId}: ${fixResult.message}`);
    }
    
    // Get user profile (clan admin) after potential fixes
    const userProfile = await getUserProfile(db, userId);
    console.log(`User ${userId} profile clanId: ${userProfile.data.clanId}`);
    
    // More thorough check: verify user is actually in a clan and has proper role
    let isUserInAnyClan = false;
    let userCurrentClanId = null;
    let userClanRole = null;
    
    // First check if user has a clanId in profile
    if (userProfile.data.clanId) {
      console.log(`User ${userId} has clanId in profile: ${userProfile.data.clanId}`);
      
      // Verify the clan actually exists and user is in it
      const currentClan = await findClanByClanId(db, userProfile.data.clanId);
      if (currentClan) {
        console.log(`Found clan for clanId ${userProfile.data.clanId}, checking member list...`);
        
        const memberData = currentClan.data.members.find(m => m.userId === userId);
        if (memberData) {
          isUserInAnyClan = true;
          userCurrentClanId = userProfile.data.clanId;
          userClanRole = memberData.role;
          console.log(`User ${userId} is confirmed to be in clan ${userCurrentClanId} with role ${userClanRole}`);
        } else {
          console.log(`User ${userId} has invalid clanId reference, will clean it up`);
          // Clean up the invalid reference immediately
          const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
          await userProfile.ref.update({
            profileData: JSON.stringify(profileWithoutClan),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Cleaned up invalid clan reference for user ${userId}`);
        }
      } else {
        console.log(`Clan not found for clanId ${userProfile.data.clanId}, cleaning up profile`);
        // Clean up the invalid reference immediately
        const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
        await userProfile.ref.update({
          profileData: JSON.stringify(profileWithoutClan),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Cleaned up non-existent clan reference for user ${userId}`);
      }
    } else {
      console.log(`User ${userId} has no clanId in profile`);
    }
    
    // Also check if user owns a clan (they could be a leader without clanId in profile)
    if (!isUserInAnyClan) {
      console.log(`Checking if user ${userId} owns a clan...`);
      const clansRef = db.collection("clans").doc(userId);
      const clansDoc = await clansRef.get();
      
      if (clansDoc.exists) {
        const ownedClanData = clansDoc.data();
        isUserInAnyClan = true;
        userCurrentClanId = ownedClanData.clanId;
        userClanRole = CLAN_ROLES.LEADER;
        console.log(`User ${userId} owns clan ${userCurrentClanId} as LEADER`);
        
        // Update profile to include the clan info if missing
        if (!userProfile.data.clanId) {
          console.log(`Adding missing clan info to user ${userId} profile`);
          const updatedProfileData = {
            ...userProfile.data,
            clanId: ownedClanData.clanId,
            clanRole: CLAN_ROLES.LEADER,
          };
          
          await userProfile.ref.update({
            profileData: JSON.stringify(updatedProfileData),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } else {
        console.log(`User ${userId} does not own a clan`);
      }
    } else {
      console.log(`User ${userId} already confirmed to be in a clan, skipping ownership check`);
    }
    
    // Final check: if user is not in any clan, reject the request
    if (!isUserInAnyClan) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    console.log(`User ${userId} confirmed to be in clan ${userCurrentClanId} with role ${userClanRole}`);
    
    // Check if user has permission to decline requests (leader or co-leader)
    if (userClanRole !== CLAN_ROLES.LEADER && userClanRole !== CLAN_ROLES.CO_LEADER) {
      throw new functions.https.HttpsError(
          "permission-denied",
          "Only clan leaders and co-leaders can decline join requests."
      );
    }
    
    const clanId = userCurrentClanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if target user requested to join
    const requestsToJoin = clanData.requestsToJoin || [];
    if (!requestsToJoin.includes(targetUserId)) {
      throw new functions.https.HttpsError(
          "not-found",
          "User has not requested to join this clan."
      );
    }
    
    // Simply remove the user from the requests list
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    
    await clanRef.update({
      requestsToJoin: admin.firestore.FieldValue.arrayRemove(targetUserId),
      lastUpdated: timestamp
    });
    
    return {
      success: true,
      message: "Join request declined successfully",
      targetUserId: targetUserId
    };
  } catch (error) {
    console.error("Error in declineJoinRequest function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to decline join request",
        error.details
    );
  }
});

/**
 * Promote clan member to co-leader
 * 
 * @param {Object} data - Promote member data
 * @param {string} data.targetUserId - ID of user to promote
 * @returns {Object} - Response with promotion status
 */
exports.promoteMember = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`promoteMember called by userId: ${userId}, promoting: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Get user profile (clan admin)
    const userProfile = await getUserProfile(db, userId);
    
    // Check if user is in a clan
    if (!userProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    const clanId = userProfile.data.clanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if user is leader (only leaders can promote)
    checkClanPermissions(clanData, userId, [CLAN_ROLES.LEADER]);
    
    // Check if target user is in the clan
    const targetMember = clanData.members.find(m => m.userId === targetUserId);
    if (!targetMember) {
      throw new functions.https.HttpsError(
          "not-found",
          "Target user is not a member of this clan."
      );
    }
    
    // Check if target is already a co-leader
    if (targetMember.role === CLAN_ROLES.CO_LEADER) {
      throw new functions.https.HttpsError(
          "already-exists",
          "User is already a co-leader."
      );
    }
    
    // Check if target is the leader (shouldn't be possible)
    if (targetMember.role === CLAN_ROLES.LEADER) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Cannot promote the leader."
      );
    }
    
    // Update target member's role to co-leader
    const updatedMembers = clanData.members.map(m => {
      if (m.userId === targetUserId) {
        return {...m, role: CLAN_ROLES.CO_LEADER};
      }
      return m;
    });
    
    // Update clan document
    await clanRef.update({
      members: updatedMembers,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update target user profile
    await updateUserProfileWithClanInfo(db, targetUserId, clanId, CLAN_ROLES.CO_LEADER);
    
    return {
      success: true,
      message: "Member promoted to co-leader successfully",
      targetUserId: targetUserId,
      newRole: CLAN_ROLES.CO_LEADER
    };
  } catch (error) {
    console.error("Error in promoteMember function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to promote member",
        error.details
    );
  }
});

/**
 * Demote co-leader to regular member
 * 
 * @param {Object} data - Demote member data
 * @param {string} data.targetUserId - ID of user to demote
 * @returns {Object} - Response with demotion status
 */
exports.demoteMember = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`demoteMember called by userId: ${userId}, demoting: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Get user profile (clan admin)
    const userProfile = await getUserProfile(db, userId);
    
    // Check if user is in a clan
    if (!userProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    const clanId = userProfile.data.clanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if user is leader (only leaders can demote)
    checkClanPermissions(clanData, userId, [CLAN_ROLES.LEADER]);
    
    // Check if target user is in the clan
    const targetMember = clanData.members.find(m => m.userId === targetUserId);
    if (!targetMember) {
      throw new functions.https.HttpsError(
          "not-found",
          "Target user is not a member of this clan."
      );
    }
    
    // Check if target is already a regular member
    if (targetMember.role === CLAN_ROLES.MEMBER) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "User is already a regular member."
      );
    }
    
    // Check if target is the leader (shouldn't be possible)
    if (targetMember.role === CLAN_ROLES.LEADER) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Cannot demote the leader."
      );
    }
    
    // Update target member's role to regular member
    const updatedMembers = clanData.members.map(m => {
      if (m.userId === targetUserId) {
        return {...m, role: CLAN_ROLES.MEMBER};
      }
      return m;
    });
    
    // Update clan document
    await clanRef.update({
      members: updatedMembers,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update target user profile
    await updateUserProfileWithClanInfo(db, targetUserId, clanId, CLAN_ROLES.MEMBER);
    
    return {
      success: true,
      message: "Co-leader demoted to member successfully",
      targetUserId: targetUserId,
      newRole: CLAN_ROLES.MEMBER
    };
  } catch (error) {
    console.error("Error in demoteMember function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to demote member",
        error.details
    );
  }
});

/**
 * Kick member from clan
 * 
 * @param {Object} data - Kick member data
 * @param {string} data.targetUserId - ID of user to kick
 * @returns {Object} - Response with kick status
 */
exports.kickMember = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const targetUserId = actualData.targetUserId;

  console.log(`kickMember called by userId: ${userId}, kicking: ${targetUserId}`);

  try {
    const db = admin.firestore();
    
    if (!targetUserId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing targetUserId parameter"
      );
    }
    
    // Get user profile (clan admin)
    const userProfile = await getUserProfile(db, userId);
    
    // Check if user is in a clan
    if (!userProfile.data.clanId) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "You are not a member of any clan."
      );
    }
    
    const clanId = userProfile.data.clanId;
    const clan = await findClanByClanId(db, clanId);
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Get the roles of both users
    const adminMember = clanData.members.find(m => m.userId === userId);
    const targetMember = clanData.members.find(m => m.userId === targetUserId);
    
    if (!targetMember) {
      throw new functions.https.HttpsError(
          "not-found",
          "Target user is not a member of this clan."
      );
    }
    
    // Permission checks
    if (adminMember.role === CLAN_ROLES.LEADER) {
      // Leaders can kick anyone
    } else if (adminMember.role === CLAN_ROLES.CO_LEADER) {
      // Co-leaders can only kick members, not other co-leaders or the leader
      if (targetMember.role !== CLAN_ROLES.MEMBER) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Co-leaders can only kick members, not other co-leaders or the leader."
        );
      }
    } else {
      // Regular members cannot kick anyone
      throw new functions.https.HttpsError(
          "permission-denied",
          "You don't have permission to kick members."
      );
    }
    
    // Remove target member from clan
    const updatedMembers = clanData.members.filter(m => m.userId !== targetUserId);
    
    // Update clan document
    await clanRef.update({
      members: updatedMembers,
      totalMembers: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update target user profile to remove clan info
    await removeClanInfoFromUserProfile(db, targetUserId);
    
    return {
      success: true,
      message: "Member kicked from clan successfully",
      targetUserId: targetUserId,
    };
  } catch (error) {
    console.error("Error in kickMember function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to kick member",
        error.details
    );
  }
});

/**
 * Get clan details
 * 
 * @param {Object} data - Get clan details data
 * @param {string} data.clanId - ID of clan to get details for
 * @returns {Object} - Response with clan details
 */
exports.getClanDetails = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  const clanId = actualData.clanId;

  console.log(`getClanDetails called by userId: ${userId}, clanId: ${clanId}`);

  try {
    const db = admin.firestore();
    
    if (!clanId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing clanId parameter"
      );
    }
    
    // Find the clan by clanId
    const clan = await findClanByClanId(db, clanId);
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    
    // Check if requester is a member to show extra information
    const isMember = clanData.members.some(m => m.userId === userId);
    const userRole = isMember ? 
        clanData.members.find(m => m.userId === userId).role : 
        null;
    
    // Basic clan data visible to everyone
    const response = {
      success: true,
      clanData: {
        clanId: clanData.clanId,
        clanName: clanData.clanName,
        clanDescription: clanData.clanDescription,
        clanBadge: clanData.clanBadge,
        clanType: clanData.clanType,
        clanLocation: clanData.clanLocation,
        clanLanguage: clanData.clanLanguage,
        minimumRequiredTrophies: clanData.minimumRequiredTrophies,
        totalMembers: clanData.totalMembers,
        createdBy: clanData.createdBy,
        members: clanData.members.map(m => ({
          userId: m.userId,
          userName: m.userName,
          role: m.role,
          trophies: m.trophies,
          joinedAt: m.joinedAt,
        })),
      }
    };
    
    // Add additional data if member is leader or co-leader
    if (userRole === CLAN_ROLES.LEADER || userRole === CLAN_ROLES.CO_LEADER) {
      response.clanData.requestsToJoin = clanData.requestsToJoin || [];
      response.clanData.invites = clanData.invites || [];
    }
    
    // Add user's role if they are a member
    if (isMember) {
      response.userRole = userRole;
    }
    
    return response;
  } catch (error) {
    console.error("Error in getClanDetails function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to get clan details",
        error.details
    );
  }
});

/**
 * Get clans list with optional filtering and pagination
 * 
 * @param {Object} data - Get clans data
 * @param {string} data.searchName - Optional clan name to search for
 * @param {number} data.minTrophies - Optional minimum trophies filter
 * @param {number} data.maxTrophies - Optional maximum trophies filter
 * @param {string} data.location - Optional location filter
 * @param {string} data.language - Optional language filter
 * @param {number} data.limit - Optional limit for results (default 20)
 * @param {string} data.lastClanId - Optional last clanId for pagination
 * @param {boolean} data.topClans - Whether to sort by total clan trophies (default false)
 * @returns {Object} - Response with clans list
 */
exports.getClans = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;
  
  // Optional filters
  const searchName = actualData.searchName;
  const minTrophies = actualData.minTrophies;
  const maxTrophies = actualData.maxTrophies;
  const location = actualData.location;
  const language = actualData.language;
  const limit = actualData.limit || 20;
  const lastClanId = actualData.lastClanId;
  const topClans = actualData.topClans || false;
  
  // New optional filters
  const minMembers = actualData.minMembers;
  const maxMembers = actualData.maxMembers;
  const canBeJoined = actualData.canBeJoined;
  
  try {
    console.log(`[DEBUG] getClans called with raw data:`, JSON.stringify(data));
    console.log(`[DEBUG] getClans parsed actualData:`, JSON.stringify(actualData));
  } catch (e) {
    console.log(`[DEBUG] Error stringifying input data:`, e.message);
  }
  console.log(`[DEBUG] getClans called by userId: ${userId}, topClans: ${topClans}`);
  console.log(`[DEBUG] Filters - searchName: ${searchName}, minTrophies: ${minTrophies}, maxTrophies: ${maxTrophies}, location: ${location}, language: ${language}, limit: ${limit}, lastClanId: ${lastClanId}`);
  console.log(`[DEBUG] Additional filters - minMembers: ${minMembers}, maxMembers: ${maxMembers}, canBeJoined: ${canBeJoined}`);

  try {
    const db = admin.firestore();
    const clansRef = db.collection("clans");
    
    // If canBeJoined is true, we need to get the user's trophy level
    let userTrophyLevel = 0;
    if (canBeJoined) {
      try {
        const userProfile = await getUserProfile(db, userId);
        userTrophyLevel = userProfile.data.trophyLevel || 0;
        console.log(`[DEBUG] User trophy level for canBeJoined check: ${userTrophyLevel}`);
      } catch (e) {
        console.log(`[DEBUG] Error getting user trophy level: ${e.message}. Will use 0 as default.`);
      }
    }
    
    // Debug: Log the total number of clans in the collection
    const totalClansSnapshot = await clansRef.count().get();
    console.log(`[DEBUG] Total clans in database: ${totalClansSnapshot.data().count}`);
    
    // Additional validation - check if collection exists and has documents
    const collectionSnapshot = await clansRef.limit(1).get();
    console.log(`[DEBUG] Collection 'clans' exists: ${!collectionSnapshot.empty}`);
    if (!collectionSnapshot.empty) {
      const sampleDoc = collectionSnapshot.docs[0];
      console.log(`[DEBUG] Sample clan document ID: ${sampleDoc.id}`);
      console.log(`[DEBUG] Sample clan document data:`, JSON.stringify(sampleDoc.data()));
    }
    
    let query = clansRef;
    
    // For top clans, we need to sort by totalTrophies
    if (topClans) {
      // Don't sort by totalTrophies in the initial query, since that field doesn't exist
      // Instead, get all clans and sort them afterwards
      console.log(`[DEBUG] Building top clans query - not sorting in Firestore, will sort in memory later`);
      // Use a default sort by clanName to ensure consistent results
      query = query.orderBy("clanName");
    } else {
      // For regular queries, add a default ordering by clanName
      // This ensures consistent pagination
      console.log(`[DEBUG] Building regular clans query - ordering by clanName`);
      query = query.orderBy("clanName");
    }
    
    console.log(`[DEBUG] Query prepared with sorting applied`);
    
    // We'll use different approaches based on whether we're searching by name or not
    if (searchName) {
      // When searching by name, we fetch all clans first and filter by name in memory
      // This avoids issues with composite indices and provides a better user experience
      console.log(`[DEBUG] Name search detected: "${searchName}" - Will fetch all clans and filter in memory`);
      
      // Just use basic ordering for consistency - don't apply any filters
      // When searching by name, we want to search ALL clans regardless of trophy requirements
      console.log(`[DEBUG] Using simple query without filters for name search`);
      query = clansRef.orderBy("clanName");
      
      // Log that we're not applying database filters for text search
      console.log(`[DEBUG] NOT applying trophy or other filters in database query for text search - will filter in memory`);
    } else {
      // Apply filters if provided - AFTER setting initial ordering
      if (minTrophies !== undefined) {
        // For top clans with minTrophies, we need a compound query
        if (!topClans) {
          if (minTrophies > 0) {
            // Reset the query to use the right ordering, but only if minTrophies > 0
            console.log(`[DEBUG] Applying minTrophies filter in database query: ${minTrophies}`);
            query = clansRef.where("minimumRequiredTrophies", ">=", minTrophies).orderBy("minimumRequiredTrophies").orderBy("clanName");
          } else {
            // If minTrophies is 0, don't apply any filter - show all clans
            console.log(`[DEBUG] minTrophies is 0, showing all clans with simple sorting`);
            query = clansRef.orderBy("clanName");
          }
        } else {
          // For top clans, we can filter after getting results since we're already sorting by totalTrophies
          console.log(`[DEBUG] Will filter by minTrophies in memory for top clans`);
        }
      }
      
      // Location and language filters
      if (location) {
        // These filters require an index if combined with sorting
        if (topClans) {
          // Get results first, then filter
        } else {
          query = query.where("clanLocation", "==", location);
        }
      }
      
      if (language) {
        if (topClans) {
          // Get results first, then filter
        } else {
          query = query.where("clanLanguage", "==", language);
        }
      }
    }
    
    // Get results
    let snapshot;
    
    if (lastClanId && !topClans) {
      // For pagination - get the last document
      console.log(`[DEBUG] Attempting pagination with lastClanId: ${lastClanId}`);
      const lastClan = await findClanByClanId(db, lastClanId);
      if (lastClan && lastClan.doc) {
        console.log(`[DEBUG] Found last clan with ID: ${lastClanId} for pagination`);
        console.log(`[DEBUG] Last clan document data:`, JSON.stringify(lastClan.data));
        snapshot = await query.startAfter(lastClan.doc).limit(limit).get();
        console.log(`[DEBUG] Pagination query executed with startAfter, limit: ${limit}`);
      } else {
        console.log(`[DEBUG] Last clan with ID ${lastClanId} not found, starting from beginning`);
        snapshot = await query.limit(limit).get();
        console.log(`[DEBUG] Query executed with limit: ${limit}`);
      }
    } else {
      // For top clans, we need all clans to calculate trophies and sort correctly
      // For regular queries, use the requested limit
      const actualLimit = topClans ? 1000 : limit; // Get up to 1000 clans for top clans sorting
      console.log(`[DEBUG] Executing query with limit: ${actualLimit}`);
      snapshot = await query.limit(actualLimit).get();
      console.log(`[DEBUG] Query executed successfully, checking results...`);
    }
    
    // Process results
    let clans = [];
    console.log(`[DEBUG] Processing snapshot with ${snapshot.size} documents`);
    console.log(`[DEBUG] Is snapshot empty: ${snapshot.empty}`);
    
    let docCount = 0;
    snapshot.forEach((doc) => {
      docCount++;
      const clan = doc.data();
      
      // Log raw document data for first few documents
      if (docCount <= 3) {
        try {
          console.log(`[DEBUG] Raw document ${docCount}: ID=${doc.id}, data:`, JSON.stringify(clan));
        } catch (e) {
          console.log(`[DEBUG] Error stringifying document ${docCount}:`, e.message);
          console.log(`[DEBUG] Document ${docCount} fields:`, Object.keys(clan).join(", "));
        }
      }
      
      // Skip documents without required fields
      if (!clan.clanId || !clan.clanName) {
        console.log(`[DEBUG] Skipping incomplete clan document: ${doc.id}, missing clanId or clanName`);
        console.log(`[DEBUG] Document fields:`, Object.keys(clan).join(", "));
        return;
      }
      
      // Always calculate total trophies from members
      let totalTrophies = 0;
      if (clan.members && clan.members.length > 0) {
        console.log(`[DEBUG] Calculating totalTrophies from ${clan.members.length} members for clan: ${clan.clanName}`);
        
        // Log first few members' trophies for debugging
        if (clan.members.length > 0) {
          for (let i = 0; i < Math.min(3, clan.members.length); i++) {
            console.log(`[DEBUG] Member ${i+1} trophies: ${clan.members[i].trophies || 0}`);
          }
        }
        
        totalTrophies = clan.members.reduce((sum, member) => sum + (member.trophies || 0), 0);
        console.log(`[DEBUG] Calculated totalTrophies: ${totalTrophies} for clan: ${clan.clanName}`);
      } else {
        console.log(`[DEBUG] No members found for clan: ${clan.clanName}, using totalTrophies = 0`);
      }
      
      // Check if user can join this clan
      let canUserJoin = false;
      if (canBeJoined) {
        // Check if clan type is 0 (OPEN) and user meets trophy requirements
        canUserJoin = (clan.clanType === CLAN_TYPES.OPEN) && 
                      userTrophyLevel >= (clan.minimumRequiredTrophies || 0);
      }
      
      // Add to results - we'll filter afterward
      clans.push({
        clanId: clan.clanId,
        clanName: clan.clanName,
        clanBadge: clan.clanBadge || 0,
        clanType: clan.clanType || 0,
        clanLocation: clan.clanLocation || "",
        clanLanguage: clan.clanLanguage || "",
        minimumRequiredTrophies: clan.minimumRequiredTrophies || 0,
        totalMembers: clan.totalMembers || 0,
        totalTrophies: totalTrophies,
        canBeJoined: canUserJoin,
        rank: topClans ? 0 : undefined // Initialize rank for top clans
      });
    });
    
    console.log(`[DEBUG] Found ${clans.length} clans before filtering`);
    console.log(`[DEBUG] Processed ${docCount} documents from snapshot`);
    
    // Apply post-query filters
    if (searchName) {
      const searchLower = searchName.toLowerCase().trim();
      console.log(`[DEBUG] Searching for name: '${searchName}', lowercase: '${searchLower}'`);
      
      // Log each clan name before filtering
      if (clans.length > 0) {
        console.log(`[DEBUG] Available clan names before filtering:`);
        clans.forEach(clan => {
          console.log(`[DEBUG] Clan: '${clan.clanName}', lowercase: '${clan.clanName.toLowerCase()}'`);
        });
      }
      
      // Improved search with multiple strategies:
      // 1. Direct substring match (clan name contains search term)
      // 2. Search term contains clan name (for very short clan names)
      // 3. Word-by-word matching (for multi-word searches)
      clans = clans.filter(clan => {
        const clanNameLower = clan.clanName.toLowerCase();
        
        // Strategy 1: Direct substring match
        if (clanNameLower.includes(searchLower)) {
          console.log(`[DEBUG] '${clan.clanName}' matched by direct inclusion`);
          return true;
        }
        
        // Strategy 2: Search term contains clan name (for very short clan names)
        // Only use for clan names shorter than 5 characters
        if (clanNameLower.length < 5 && searchLower.includes(clanNameLower)) {
          console.log(`[DEBUG] '${clan.clanName}' matched because search contains clan name`);
          return true;
        }
        
        // Strategy 3: Word matching for clan name with spaces
        const clanWords = clanNameLower.split(/\s+/);
        for (const word of clanWords) {
          // Only match words with 3+ characters
          if (word.length >= 3 && (searchLower.includes(word) || word.includes(searchLower))) {
            console.log(`[DEBUG] '${clan.clanName}' matched on word: '${word}'`);
            return true;
          }
        }
        
        // Strategy 4: Try matching word stems (for plurals like "racer" vs "racers")
        // Remove common endings and try to match the stem
        const stemClanName = clanNameLower.replace(/s$|ers$|ing$|ed$/, "");
        const stemSearch = searchLower.replace(/s$|ers$|ing$|ed$/, "");
        
        if (stemClanName.includes(stemSearch) || stemSearch.includes(stemClanName)) {
          console.log(`[DEBUG] '${clan.clanName}' matched by stem: clanStem="${stemClanName}", searchStem="${stemSearch}"`);
          return true;
        }
        
        return false;
      });
      
      console.log(`[DEBUG] After name filter: ${clans.length} clans`);
    }
    
    if (maxTrophies !== undefined) {
      clans = clans.filter(clan => clan.minimumRequiredTrophies <= maxTrophies);
      console.log(`[DEBUG] After maxTrophies filter: ${clans.length} clans`);
    }
    
    // Apply new filters for member count
    if (minMembers !== undefined) {
      clans = clans.filter(clan => clan.totalMembers >= minMembers);
      console.log(`After minMembers filter: ${clans.length} clans`);
    }
    
    if (maxMembers !== undefined) {
      clans = clans.filter(clan => clan.totalMembers <= maxMembers);
      console.log(`After maxMembers filter: ${clans.length} clans`);
    }
    
    // Filter by canBeJoined if requested
    if (canBeJoined) {
      clans = clans.filter(clan => clan.canBeJoined);
      console.log(`After canBeJoined filter: ${clans.length} clans`);
    }
    
    // For top clans, we might have filtered out some results, so apply these filters post-query
    if (topClans) {
      if (minTrophies !== undefined) {
        clans = clans.filter(clan => clan.minimumRequiredTrophies >= minTrophies);
      }
      
      if (location) {
        clans = clans.filter(clan => clan.clanLocation === location);
      }
      
      if (language) {
        clans = clans.filter(clan => clan.clanLanguage === language);
      }
    }
    
    // Always sort if topClans is true, regardless of trophy counts
    if (topClans) {
      clans.sort((a, b) => b.totalTrophies - a.totalTrophies);
      
      // Add ranks after sorting
      clans.forEach((clan, index) => {
        clan.rank = index + 1;
      });
      
      // Limit results after sorting and filtering
      if (clans.length > limit) {
        clans = clans.slice(0, limit);
      }
      
      console.log(`[DEBUG] Sorted ${clans.length} clans by trophies:`);
      clans.forEach((clan, idx) => {
        if (idx < 10) { // Log only top 10 for brevity
          console.log(`[DEBUG]   ${idx+1}. ${clan.clanName}: ${clan.totalTrophies} trophies`);
        }
      });
    }
    
    const hasMore = (!topClans && clans.length >= limit) || (topClans && clans.length > 0 && clans.length === limit);
    
    console.log(`[DEBUG] Preparing final response - success: true, total clans: ${clans.length}, hasMore: ${hasMore}`);
    if (clans.length > 0) {
      try {
        console.log(`[DEBUG] First clan in response:`, JSON.stringify(clans[0]));
        if (clans.length > 1) {
          console.log(`[DEBUG] Last clan in response:`, JSON.stringify(clans[clans.length - 1]));
        }
      } catch (e) {
        console.log(`[DEBUG] Error stringifying clan objects:`, e.message);
        if (clans.length > 0 && clans[0]) {
          console.log(`[DEBUG] First clan fields:`, Object.keys(clans[0]).join(", "));
        }
      }
    } else {
      console.log(`[DEBUG] WARNING: No clans found in the final result set. Review query parameters and database state.`);
    }
    
    return {
      success: true,
      clans: clans,
      hasMore: hasMore,
      total: clans.length,
    };
  } catch (error) {
    console.error("[ERROR] Error in getClans function:", error);
    console.error("[ERROR] Error stack:", error.stack);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to get clans list",
        error.details
    );
  }
});

/**
 * Update clan information
 * 
 * @param {Object} data - Update clan data
 * @param {string} data.clanDescription - Optional new clan description
 * @param {number} data.clanBadge - Optional new clan badge
 * @param {number} data.clanType - Optional new clan type
 * @param {string} data.clanLocation - Optional new clan location
 * @param {string} data.clanLanguage - Optional new clan language
 * @param {number} data.minimumRequiredTrophies - Optional new minimum trophies
 * @returns {Object} - Response with update status
 */
exports.updateClan = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`updateClan called by userId: ${userId}`);

  try {
    const db = admin.firestore();
    
    // Check for and fix any data inconsistencies
    const fixResult = await fixClanDataInconsistency(db, userId);
    if (fixResult.fixed) {
      console.log(`Fixed clan data inconsistency for user ${userId}: ${fixResult.message}`);
    }
    
    // Get user profile
    const userProfile = await getUserProfile(db, userId);
    
    // Check if user has a clan
    // Handle clan lookup - either from user profile or direct ownership
    let clanId;
    let clan;
    
    if (!userProfile.data.clanId) {
      // Also check if user owns a clan but doesn't have it in profile (double-check)
      const clansRef = db.collection("clans").doc(userId);
      const clansDoc = await clansRef.get();
      
      if (clansDoc.exists) {
        const ownedClanData = clansDoc.data();
        // User has a clan but no clanId in profile - fix it
        console.log(`Inconsistency: User ${userId} owns clan ${ownedClanData.clanId} but has no clanId in profile.`);
        await updateUserProfileWithClanInfo(db, userId, ownedClanData.clanId, CLAN_ROLES.LEADER);
        
        // Use the clan we already found
        clanId = ownedClanData.clanId;
        clan = {
          doc: clansDoc,
          id: userId,
          data: ownedClanData
        };
      } else {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "You are not a member of any clan."
        );
      }
    } else {
      // Normal flow if user has a clanId in profile
      clanId = userProfile.data.clanId;
      clan = await findClanByClanId(db, clanId);
    }
    
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          "Clan not found."
      );
    }
    
    const clanData = clan.data;
    const clanOwnerUserId = clan.id;
    const clanRef = db.collection("clans").doc(clanOwnerUserId);
    
    // Check if user has permission to update clan (leader or co-leader)
    checkClanPermissions(clanData, userId, [CLAN_ROLES.LEADER, CLAN_ROLES.CO_LEADER]);
    
    // Prepare update object
    const updateData = {};
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    updateData.lastUpdated = timestamp;
    
    // Add fields if they are provided
    if (actualData.clanDescription !== undefined) {
      updateData.clanDescription = actualData.clanDescription;
    }
    
    if (actualData.clanBadge !== undefined) {
      updateData.clanBadge = actualData.clanBadge;
    }
    
    if (actualData.clanType !== undefined) {
      updateData.clanType = actualData.clanType;
    }
    
    if (actualData.clanLocation !== undefined) {
      updateData.clanLocation = actualData.clanLocation;
    }
    
    if (actualData.clanLanguage !== undefined) {
      updateData.clanLanguage = actualData.clanLanguage;
    }
    
    if (actualData.minimumRequiredTrophies !== undefined) {
      updateData.minimumRequiredTrophies = actualData.minimumRequiredTrophies;
    }
    
    // Check if there's anything to update
    if (Object.keys(updateData).length <= 1) { // Only lastUpdated
      throw new functions.https.HttpsError(
          "invalid-argument",
          "No clan properties to update provided."
      );
    }
    
    // Update clan document
    await clanRef.update(updateData);
    
    return {
      success: true,
      message: "Clan information updated successfully",
      updatedFields: Object.keys(updateData).filter(key => key !== "lastUpdated"),
    };
  } catch (error) {
    console.error("Error in updateClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to update clan",
        error.details
    );
  }
});

// =============================================================================
// MAINTENANCE SYSTEM - Check maintenance status and provide rewards
// =============================================================================

/**
 * Check maintenance status and create default if not exists
 * Returns user-specific maintenance reward availability
 */
exports.checkMaintenance = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`checkMaintenance called for userId: ${userId}`);

  try {
    const db = admin.firestore();

    // Check if maintenance collection exists
    const maintenanceRef = db.collection("maintenance").doc("current");
    const maintenanceDoc = await maintenanceRef.get();

    let maintenanceData;

    if (!maintenanceDoc.exists) {
      // Create default maintenance data
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      const maintenanceId = `maintenance_${currentTime}`;

      maintenanceData = {
        id: maintenanceId,
        upcomingMaintenance: false,
        upcomingMaintenanceTime: 0,
        onGoingMaintenance: false,
        onGoingMaintenanceTime: 0,
        maintenanceComplete: false,
        maintenanceCompleteTime: 0,
        maintenanceRewardAvailable: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      await maintenanceRef.set(maintenanceData);
      console.log("Created default maintenance data:", maintenanceId);
    } else {
      maintenanceData = maintenanceDoc.data();
    }

    // Check user-specific reward availability
  let userSpecificRewardAvailable = false;
    if (maintenanceData.maintenanceRewardAvailable) {
      // Get user profile to check if they've already claimed this maintenance reward
      const userProfileRef = db.collection("players").doc(userId)
          .collection("profileData").doc("profileData");
      const userProfileDoc = await userProfileRef.get();

      if (userProfileDoc.exists) {
        const profileData = JSON.parse(userProfileDoc.data().profileData);
  const claimedMaintenances = profileData.claimedMaintenances || [];
        // Reward is available if global flag is true AND user hasn't claimed it yet
        userSpecificRewardAvailable = !claimedMaintenances.includes(maintenanceData.id);
      } else {
        // If user profile doesn't exist, reward is available (new user)
        userSpecificRewardAvailable = true;
      }
    }

    return {
      success: true,
      maintenance: {
        id: maintenanceData.id,
        upcomingMaintenance: maintenanceData.upcomingMaintenance || false,
        upcomingMaintenanceTime: maintenanceData.upcomingMaintenanceTime || 0,
        onGoingMaintenance: maintenanceData.onGoingMaintenance || false,
        onGoingMaintenanceTime: maintenanceData.onGoingMaintenanceTime || 0,
        maintenanceComplete: maintenanceData.maintenanceComplete || false,
        maintenanceCompleteTime: maintenanceData.maintenanceCompleteTime || 0,
        maintenanceRewardAvailable: userSpecificRewardAvailable,
      },
      message: "Maintenance status retrieved successfully",
    };
  } catch (error) {
    console.error("Error in checkMaintenance function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to check maintenance status.",
        error.message,
    );
  }
});

/**
 * Get maintenance reward (200 gems)
 */
exports.getMaintenanceReward = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`getMaintenanceReward called for userId: ${userId}`);

  try {
    const db = admin.firestore();

    // Get current maintenance data
    const maintenanceRef = db.collection("maintenance").doc("current");
    const maintenanceDoc = await maintenanceRef.get();

    if (!maintenanceDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "Maintenance data not found.",
      );
    }

    const maintenanceData = maintenanceDoc.data();

    // Check if maintenance reward is available
    if (!maintenanceData.maintenanceRewardAvailable) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Maintenance reward is not available.",
      );
    }

    // Get user profile
    const userProfileRef = db.collection("players").doc(userId)
        .collection("profileData").doc("profileData");
    const userProfileDoc = await userProfileRef.get();

    if (!userProfileDoc.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          "User profile data not found.",
      );
    }

    const profileData = JSON.parse(userProfileDoc.data().profileData);

    // Check if user has already claimed this maintenance reward
    const claimedMaintenances = profileData.claimedMaintenances || [];
    if (claimedMaintenances.includes(maintenanceData.id)) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          "Maintenance reward already claimed.",
      );
    }

    // Add 200 gems to user
    const currentGems = profileData.playerGem || 0;
    const rewardGems = 200;

    const updatedProfileData = {
      ...profileData,
      playerGem: currentGems + rewardGems,
      claimedMaintenances: [...claimedMaintenances, maintenanceData.id],
    };

    // Update user profile
    await userProfileRef.update({
      profileData: JSON.stringify(updatedProfileData),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Maintenance reward given: ${rewardGems} gems to user ${userId} for maintenance ${maintenanceData.id}`);

    return {
      success: true,
      rewardGems: rewardGems,
      newGemBalance: currentGems + rewardGems,
      maintenanceId: maintenanceData.id,
      message: `Successfully claimed ${rewardGems} gems maintenance reward`,
    };
  } catch (error) {
    console.error("Error in getMaintenanceReward function:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to get maintenance reward.",
        error.message,
    );
  }
});

/**
 * Get the clan details for the current user
 * 
 * @param {Object} data - Request data
 * @param {string} data.userId - Optional user ID (uses authenticated user if not provided)
 * @returns {Object} - Response with user's clan data
 */
exports.getUserClanDetails = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const actualData = data.data || data;
  const userId = actualData.userId || authUserId || defaultUserId;

  console.log(`getUserClanDetails called for userId: ${userId}`);

  try {
    const db = admin.firestore();
    
    // Check for and fix any data inconsistencies
    const fixResult = await fixClanDataInconsistency(db, userId);
    if (fixResult.fixed) {
      console.log(`Fixed clan data inconsistency for user ${userId}: ${fixResult.message}`);
    }
    
    // Get the user's profile to find their clan ID
    const userProfile = await getUserProfile(db, userId);
    
    console.log(`getUserClanDetails - User ${userId} profile data:`, {
      clanId: userProfile.data.clanId,
      clanRole: userProfile.data.clanRole,
      clanName: userProfile.data.clanName,
      clanBadge: userProfile.data.clanBadge,
      allKeys: Object.keys(userProfile.data)
    });
    
    // Check if user has a clan
    if (!userProfile.data.clanId) {
      // Also check if user owns a clan but doesn't have it in profile (double-check)
      const clansRef = db.collection("clans").doc(userId);
      const clansDoc = await clansRef.get();
      
      if (clansDoc.exists) {
        const ownedClanData = clansDoc.data();
        // User has a clan but no clanId in profile - fix it
        console.log(`Inconsistency: User ${userId} owns clan ${ownedClanData.clanId} but has no clanId in profile.`);
        await updateUserProfileWithClanInfo(db, userId, ownedClanData.clanId, CLAN_ROLES.LEADER);
        
        // Reload the profile
        const updatedProfile = await getUserProfile(db, userId);
        const clanId = updatedProfile.data.clanId;
        const clan = {
          doc: clansDoc,
          id: userId,
          data: ownedClanData
        };
      } else {
        return {
          success: false,
          message: "User is not a member of any clan",
          isInClan: false
        };
      }
    }
    
    // Normal flow if we have a clan ID
    const clanId = userProfile.data.clanId;
    
    // Find the clan using the clanId from the user's profile
    const clan = await findClanByClanId(db, clanId);
    if (!clan) {
      // This is an inconsistent state - user has a clanId but the clan doesn't exist
      console.error(`Inconsistent state: User ${userId} has clanId ${clanId} but clan not found`);
      
      // Automatically fix this by removing the clan ID from the user's profile
      const { clanId, clanRole, ...profileWithoutClan } = userProfile.data;
      await userProfile.ref.update({
        profileData: JSON.stringify(profileWithoutClan),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: false,
        message: "Clan not found. Data inconsistency has been fixed.",
        isInClan: false
      };
    }
    
    const clanData = clan.data;
    
    // Find the user's role in the clan
    const memberData = clanData.members.find(m => m.userId === userId);
    const userRole = memberData ? memberData.role : null;
    
    // Fetch the latest trophy data for all members
    let totalTrophies = 0;
    const memberPromises = clanData.members.map(async (member) => {
      try {
        // Get latest user profile data for each member
        const memberProfile = await getUserProfile(db, member.userId);
        const currentTrophies = memberProfile.data.trophyLevel || 0;
        const avatarId = memberProfile.data.avatarId || 1; // Default to 1 if not available
        const playerExperience = memberProfile.data.playerExperience || 0; // Default to 0 if not available
        
        // Add to the total
        totalTrophies += currentTrophies;
        
        // Return updated member data with current trophies, avatarId, and playerExperience
        return {
          userId: member.userId,
          userName: memberProfile.data.username || member.userName || "Unknown Player",
          role: member.role,
          trophies: currentTrophies, // Use current trophy count instead of stored one
          joinedAt: member.joinedAt,
          avatarId: avatarId, // Include avatarId from user's profile
          playerExperience: playerExperience, // Include playerExperience from user's profile
        };
      } catch (err) {
        console.log(`Error fetching profile for member ${member.userId}: ${err.message}`);
        // If we can't get current data, use the stored trophy data
        totalTrophies += member.trophies || 0;
        return {
          userId: member.userId,
          userName: member.userName || "Unknown Player",
          role: member.role,
          trophies: member.trophies || 0,
          joinedAt: member.joinedAt,
          avatarId: 1, // Default avatar if we can't get profile data
          playerExperience: 0, // Default to 0 if we can't get profile data
        };
      }
    });
    
    // Await all member profile fetches
    const updatedMembers = await Promise.all(memberPromises);
    
    // Basic clan data for response
    const response = {
      success: true,
      isInClan: true,
      userRole: userRole,
      clanData: {
        clanId: clanData.clanId,
        clanName: clanData.clanName,
        clanDescription: clanData.clanDescription,
        clanBadge: clanData.clanBadge,
        clanType: clanData.clanType,
        clanLocation: clanData.clanLocation,
        clanLanguage: clanData.clanLanguage,
        minimumRequiredTrophies: clanData.minimumRequiredTrophies,
        totalMembers: clanData.totalMembers,
        totalTrophies: totalTrophies,
        createdBy: clanData.createdBy,
        members: updatedMembers
      }
    };
    
    // Add additional data if member is leader or co-leader
    if (userRole === CLAN_ROLES.LEADER || userRole === CLAN_ROLES.CO_LEADER) {
      // Fetch detailed information for users who requested to join
      const requestsToJoin = clanData.requestsToJoin || [];
      const requestsPromises = requestsToJoin.map(async (requestUserId) => {
        try {
          // Get user profile data for the requester
          const requestUserProfile = await getUserProfile(db, requestUserId);
          return {
            userId: requestUserId,
            userName: requestUserProfile.data.username || "Unknown Player",
            trophies: requestUserProfile.data.trophyLevel || 0,
            avatarId: requestUserProfile.data.avatarId || 1,
            playerExperience: requestUserProfile.data.playerExperience || 0,
            requestedAt: new Date()  // Note: If you track request timestamp, replace this
          };
        } catch (err) {
          console.log(`Error fetching profile for request user ${requestUserId}: ${err.message}`);
          return {
            userId: requestUserId,
            userName: "Unknown Player",
            trophies: 0,
            avatarId: 1,
            playerExperience: 0,
            requestedAt: new Date()
          };
        }
      });
      
      // Await all requester profile fetches
      const requestDetails = await Promise.all(requestsPromises);
      
      response.clanData.requestsToJoin = requestDetails;
      response.clanData.invites = clanData.invites || [];
    }
    
    return response;
  } catch (error) {
    console.error("Error in getUserClanDetails function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to get user's clan details",
        error.details
    );
  }
});

/**
 * Calculate bot difficulty stats based on trophy count
 * This function takes either a single trophy value or an array of trophy values
 * and returns the corresponding bot stats.
 *
 * @param {Object} data - Request data
 * @param {number|number[]} data.trophies - Single trophy value or array of trophy values
 * @param {Object} [data.config] - Optional custom configuration
 * @returns {Object} Bot stats for the provided trophy values
 */
exports.calculateBotDifficulty = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const userId = authUserId || defaultUserId;
  
  console.log(`calculateBotDifficulty called by userId: ${userId}`);
  
  try {
    const trophiesInput = data.trophies;
    
    // Validate input
    if (trophiesInput === undefined) {
      throw new Error("Missing required 'trophies' parameter");
    }
    
    // Convert single trophy value to array for consistent processing
    const trophiesList = Array.isArray(trophiesInput) ? trophiesInput : [trophiesInput];
    
    // Create configuration
    let config;
    if (data.config) {
      // Build custom configuration if provided
      config = new botDifficulty.BotDifficultyConfig({
        referenceTrophies: data.config.referenceTrophies || 7500.0,
        allowOver100: data.config.allowOver100 !== undefined ? data.config.allowOver100 : true,
        clampToBounds: data.config.clampToBounds !== undefined ? data.config.clampToBounds : false
      });
      
      // Handle custom stat bounds if provided
      if (data.config.maxSpeed) {
        config.maxSpeed = new botDifficulty.BotStatBounds(
          data.config.maxSpeed.minVal, 
          data.config.maxSpeed.maxVal
        );
      }
      if (data.config.acceleration) {
        config.acceleration = new botDifficulty.BotStatBounds(
          data.config.acceleration.minVal, 
          data.config.acceleration.maxVal
        );
      }
      if (data.config.boostTime) {
        config.boostTime = new botDifficulty.BotStatBounds(
          data.config.boostTime.minVal, 
          data.config.boostTime.maxVal
        );
      }
      if (data.config.boostFrequency) {
        config.boostFrequency = new botDifficulty.BotStatBounds(
          data.config.boostFrequency.minVal, 
          data.config.boostFrequency.maxVal
        );
      }
      if (data.config.boostCooldown) {
        config.boostCooldown = new botDifficulty.BotStatBounds(
          data.config.boostCooldown.minVal, 
          data.config.boostCooldown.maxVal
        );
      }
    } else {
      // Use default configuration from Firestore or create one if needed
      config = null; // We'll fetch from Firestore
    }
    
    // Compute bot stats - using async version that fetches from Firestore if no config is provided
    const botStats = await botDifficulty.computeBotStatsForTrophies(trophiesList, config);
    
    // Convert keys to camelCase as is standard for JavaScript
    const result = Array.isArray(trophiesInput) ? botStats : botStats[0];
    
    return {
      success: true,
      botStats: result
    };
  } catch (error) {
    console.error("Error in calculateBotDifficulty function:", error);
    throw new functions.https.HttpsError(
      error.code || "internal",
      error.message || "Failed to calculate bot difficulty stats",
      error.details
    );
  }
});

/**
 * Generate bot spell decks based on trophy counts.
 * This function takes an array of trophy values and returns
 * corresponding bot spell decks with appropriate spell levels.
 *
 * @param {Object} data - Request data
 * @param {number|number[]} data.trophies - Single trophy value or array of trophy values
 * @param {Object} [data.config] - Optional custom configuration
 * @returns {Object} Bot spell decks for the provided trophy values
 */
exports.generateBotSpellDecks = functions.https.onCall(async (data, context) => {
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  const userId = authUserId || defaultUserId;
  
  console.log(`generateBotSpellDecks called by userId: ${userId}`);
  
  // Debug the incoming data structure with more detail
  try {
    console.log(`[DEBUG] generateBotSpellDecks raw data type:`, typeof data);
    console.log(`[DEBUG] generateBotSpellDecks raw data:`, JSON.stringify(data));
    
    // Log all top-level keys for debugging
    if (data && typeof data === "object") {
      console.log(`[DEBUG] Top level keys:`, Object.keys(data));
    }
    
    if (data && data.data) {
      console.log(`[DEBUG] data.data exists:`, typeof data.data);
      if (typeof data.data === "object") {
        console.log(`[DEBUG] data.data fields:`, Object.keys(data.data));
        
        // Log even deeper levels
        if (data.data.data) {
          console.log(`[DEBUG] data.data.data exists:`, typeof data.data.data);
          console.log(`[DEBUG] data.data.data fields:`, Object.keys(data.data.data));
        }
      }
    }
  } catch (e) {
    console.log(`[DEBUG] Error in data logging:`, e.message);
  }
  
  try {
    // Enhanced handling for finding trophies data in various formats
    let trophiesInput;
    
    // Option 1: Direct access at top level
    if (data && data.trophies !== undefined) {
      console.log(`[DEBUG] Found trophies at top level`);
      trophiesInput = data.trophies;
    } 
    // Option 2: Inside data object (common with Unity SDK)
    else if (data && data.data && data.data.trophies !== undefined) {
      console.log(`[DEBUG] Found trophies inside data.data`);
      trophiesInput = data.data.trophies;
    }
    // Option 3: Deeply nested (some Unity serialization scenarios)
    else if (data && data.data && data.data.data && data.data.data.trophies !== undefined) {
      console.log(`[DEBUG] Found trophies inside data.data.data`);
      trophiesInput = data.data.data.trophies;
    }
    // Option 4: Maybe data is the trophy array itself (unlikely but possible)
    else if (Array.isArray(data)) {
      console.log(`[DEBUG] Data itself is an array, using as trophies`);
      trophiesInput = data;
    }
    
    console.log(`[DEBUG] Found trophiesInput:`, trophiesInput);
    
    // Validate input
    if (trophiesInput === undefined) {
      console.error(`[ERROR] Missing trophies parameter. Full data:`, JSON.stringify(data));
      throw new Error("Missing required 'trophies' parameter");
    }
    
    // Convert single trophy value to array for consistent processing
    const trophiesList = Array.isArray(trophiesInput) ? trophiesInput : [trophiesInput];
    
    // Create configuration
    let config;
    if (data.config) {
      // Build custom configuration if provided
      config = new botSpellDeck.BotSpellConfig({
        referenceTrophiesFor100: data.config.referenceTrophiesFor100 || 7500.0,
        referenceLevelAt100: data.config.referenceLevelAt100 || 133,
        deckSize: data.config.deckSize || 5,
        deterministicSeed: data.config.deterministicSeed !== undefined ? data.config.deterministicSeed : null
      });
    } else {
      // Use default configuration
      config = new botSpellDeck.BotSpellConfig();
    }
    
    // Generate bot spell decks
    const spellDecks = botSpellDeck.generateBotsSpellDecks(trophiesList, config);
    
    // Return the result
    const result = Array.isArray(trophiesInput) ? spellDecks : spellDecks[0];
    
    return {
      success: true,
      botSpellDecks: result
    };
  } catch (error) {
    console.error("Error in generateBotSpellDecks function:", error);
    throw new functions.https.HttpsError(
      error.code || "internal",
      error.message || "Failed to generate bot spell decks",
      error.details
    );
  }
});

/**
 * Bookmark a clan for the user
 * Allows users to save clans they're interested in
 * 
 * @param {Object} data - Request data
 * @param {string} data.userId - Optional user ID (uses auth user ID if not provided)
 * @param {string} data.clanId - ID of the clan to bookmark
 * @returns {Object} - Response with bookmark status
 */
exports.bookmarkClan = functions.https.onCall(async (data, context) => {
  
  // Extract clanId and userId from the request data
  let clanId;
  let userId;
  
  // Always prioritize userId from Unity
  if (data && data.userId) {
    userId = data.userId;
  } else if (data && data.data && data.data.userId) {
    userId = data.data.userId;
  } else {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing userId parameter"
    );
  }
  
  // Get clanId from different possible locations in the request
  if (data && data.clanId) {
    clanId = data.clanId;
  } else if (data && data.data && data.data.clanId) {
    clanId = data.data.clanId;
  } else if (data && data.data && typeof data.data === "string") {
    // Maybe the clanId was directly passed as a string in data.data
    clanId = data.data;
  }
  
  console.log(`[DEBUG] bookmarkClan parsed data - userId: ${userId}, clanId: ${clanId}`);

  try {
    const db = admin.firestore();
    
    // Validate clanId
    if (!clanId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing clanId parameter"
      );
    }
    
    // Check if clan exists
    const clan = await findClanByClanId(db, clanId);
    if (!clan) {
      throw new functions.https.HttpsError(
          "not-found",
          `Clan with ID ${clanId} not found`
      );
    }
    
    // Check if bookmarks collection exists for user, if not create it
    const userBookmarksRef = db.collection("userClanBookmarks").doc(userId);
    const userBookmarksDoc = await userBookmarksRef.get();
    
    if (!userBookmarksDoc.exists) {
      // Create the document with the first bookmark
      await userBookmarksRef.set({
        userId: userId,
        bookmarkedClans: [clanId],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Add to existing bookmarks if not already bookmarked
      await userBookmarksRef.update({
        bookmarkedClans: admin.firestore.FieldValue.arrayUnion(clanId),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    return {
      success: true,
      message: "Clan bookmarked successfully",
      clanId: clanId
    };
  } catch (error) {
    console.error("Error in bookmarkClan function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to bookmark clan",
        error.details
    );
  }
});

/**
 * Remove a clan bookmark for the user
 * 
 * @param {Object} data - Request data
 * @param {string} data.userId - Optional user ID (uses auth user ID if not provided)
 * @param {string} data.clanId - ID of the clan to remove from bookmarks
 * @returns {Object} - Response with removal status
 */
exports.removeClanBookmark = functions.https.onCall(async (data, context) => {
  // Add safer debugging
  try {
    console.log(`[DEBUG] removeClanBookmark function called`);
    if (data) {
      if (data.data) {
        console.log(`[DEBUG] data.data exists:`, typeof data.data);
        if (typeof data.data === "object") {
          console.log(`[DEBUG] data.data fields:`, Object.keys(data.data));
        }
      } else {
        console.log(`[DEBUG] direct data fields:`, Object.keys(data));
      }
    }
    console.log(`[DEBUG] removeClanBookmark auth:`, context.auth ? `User: ${context.auth.uid}` : "No auth");
  } catch (e) {
    console.log(`[DEBUG] Error in logging:`, e.message);
  }
  
  // Extract clanId and userId from the request data
  let clanId;
  let userId;
  
  // Always prioritize userId from Unity
  if (data && data.userId) {
    userId = data.userId;
  } else if (data && data.data && data.data.userId) {
    userId = data.data.userId;
  } else {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing userId parameter"
    );
  }
  
  // Get clanId from different possible locations in the request
  if (data && data.clanId) {
    clanId = data.clanId;
  } else if (data && data.data && data.data.clanId) {
    clanId = data.data.clanId;
  } else if (data && data.data && typeof data.data === "string") {
    // Maybe the clanId was directly passed as a string in data.data
    clanId = data.data;
  }
  
  console.log(`removeClanBookmark called by userId: ${userId}, clanId: ${clanId}`);

  try {
    const db = admin.firestore();
    
    // Validate clanId
    if (!clanId) {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing clanId parameter"
      );
    }
    
    // Check if bookmarks collection exists for user
    const userBookmarksRef = db.collection("userClanBookmarks").doc(userId);
    const userBookmarksDoc = await userBookmarksRef.get();
    
    if (!userBookmarksDoc.exists) {
      // No bookmarks collection, nothing to remove
      return {
        success: true,
        message: "User has no bookmarks",
        clanId: clanId
      };
    }
    
    // Remove the clan from bookmarks
    await userBookmarksRef.update({
      bookmarkedClans: admin.firestore.FieldValue.arrayRemove(clanId),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return {
      success: true,
      message: "Clan bookmark removed successfully",
      clanId: clanId
    };
  } catch (error) {
    console.error("Error in removeClanBookmark function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to remove clan bookmark",
        error.details
    );
  }
});

/**
 * Get all bookmarked clans for a user with full clan data
 * 
 * @param {Object} data - Request data
 * @param {string} data.userId - Optional user ID (uses auth user ID if not provided)
 * @returns {Object} - Response with list of bookmarked clans
 */
exports.getBookmarks = functions.https.onCall(async (data, context) => {
  // Add safer debugging
  try {
    console.log(`[DEBUG] getBookmarks function called`);
    if (data) {
      if (data.data) {
        console.log(`[DEBUG] data.data exists:`, typeof data.data);
        if (typeof data.data === "object") {
          console.log(`[DEBUG] data.data fields:`, Object.keys(data.data));
          if (data.data.data) {
            console.log(`[DEBUG] data.data.data exists:`, typeof data.data.data);
            if (typeof data.data.data === "object") {
              console.log(`[DEBUG] data.data.data fields:`, Object.keys(data.data.data));
            }
          }
        }
      } else {
        console.log(`[DEBUG] direct data fields:`, Object.keys(data));
      }
    }
    console.log(`[DEBUG] getBookmarks auth:`, context.auth ? `User: ${context.auth.uid}` : "No auth");
  } catch (e) {
    console.log(`[DEBUG] Error in logging:`, e.message);
  }
  
  const defaultUserId = "fMGdSdZ2DNcfsJD0Jewf7aM3CDF3";
  const authUserId = context.auth && context.auth.uid;
  
  // Handle deeply nested data structure from Unity
  // It could be data.userId, data.data.userId, or even data.data.data.userId
  let userId = authUserId || defaultUserId;
  
  // Try to find userId in various locations
  if (data && data.userId) {
    userId = data.userId;
  } else if (data && data.data) {
    if (typeof data.data === "object") {
      if (data.data.userId) {
        userId = data.data.userId;
      } else if (data.data.data && typeof data.data.data === "object" && data.data.data.userId) {
        userId = data.data.data.userId;
      }
    }
  }
  
  console.log(`getBookmarks called by userId: ${userId}`);

  try {
    const db = admin.firestore();
    
    // Get the user's bookmarks
    const userBookmarksRef = db.collection("userClanBookmarks").doc(userId);
    const userBookmarksDoc = await userBookmarksRef.get();
    
    // If no bookmarks document exists, return an empty array
    if (!userBookmarksDoc.exists) {
      return {
        success: true,
        bookmarkedClans: [],
        total: 0
      };
    }
    
    const bookmarksData = userBookmarksDoc.data();
    const bookmarkedClanIds = bookmarksData.bookmarkedClans || [];
    
    if (bookmarkedClanIds.length === 0) {
      return {
        success: true,
        bookmarkedClans: [],
        total: 0
      };
    }
    
    // Get clan data for each bookmarked clan ID
    const clansRef = db.collection("clans");
    let bookmarkedClans = [];
    
    // We'll use Promise.all to fetch all clans in parallel
    const clanPromises = bookmarkedClanIds.map(async (clanId) => {
      const clan = await findClanByClanId(db, clanId);
      if (clan) {
        return clan.data;
      }
      return null;
    });
    
    const clanResults = await Promise.all(clanPromises);
    
    // Process results - format specifically for Unity client
    bookmarkedClans = clanResults
      .filter(clan => clan !== null) // Remove any clans not found
      .map(clan => {
        // Calculate total trophies if not stored in the document
        let totalTrophies = clan.totalTrophies || 0;
        if (clan.totalTrophies === undefined && clan.members && clan.members.length > 0) {
          totalTrophies = clan.members.reduce((sum, member) => sum + (member.trophies || 0), 0);
        }
        
        // Format to match BookmarkedClanData in Unity
        return {
          id: clan.clanId,
          name: clan.clanName,
          description: clan.description || "",
          type: (clan.clanType !== undefined && clan.clanType !== null) ? clan.clanType.toString() : "0",
          requiredTrophies: clan.minimumRequiredTrophies || 0,
          memberCount: clan.totalMembers || 0,
          trophies: totalTrophies,
          clanBadge: clan.clanBadge || 0, // Added clanBadge field
          createdAt: clan.createdAt || { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 },
          region: clan.clanLocation || "",
          clanLeader: clan.leaderName || clan.leaderUserId || "",
          lastActive: clan.lastActive || { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 }
        };
      });
    
    console.log(`[DEBUG] getBookmarks formatted response: ${bookmarkedClans.length} clans found`);
    if (bookmarkedClans.length > 0) {
      console.log(`[DEBUG] First clan example:`, JSON.stringify(bookmarkedClans[0]).substring(0, 200) + "...");
    }
    
    // Format response to match Unity's expected structure
    return {
      success: true,
      data: {
        clans: bookmarkedClans,
        // Adding empty lastVisible as it's expected by the client
        lastVisible: bookmarkedClans.length > 0 ? {
          id: bookmarkedClans[bookmarkedClans.length - 1].id,
          name: bookmarkedClans[bookmarkedClans.length - 1].name,
          memberCount: bookmarkedClans[bookmarkedClans.length - 1].memberCount,
          trophies: bookmarkedClans[bookmarkedClans.length - 1].trophies,
          createdAt: bookmarkedClans[bookmarkedClans.length - 1].createdAt
        } : null
      }
    };
  } catch (error) {
    console.error("Error in getBookmarks function:", error);
    throw new functions.https.HttpsError(
        error.code || "internal",
        error.message || "Failed to get bookmarked clans",
        error.details
    );
  }
});
