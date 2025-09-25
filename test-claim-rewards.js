// Test data for claimRewards function based on CSV
// This shows the correct reward structure matching rank_rewards.csv

const PROMOTION_REWARDS_TEST = {
  // CSV: Unranked → Bronze I,100 Gems,Common Key
  "unrankedToBronzeI": {gems: 100, crateKey: "Common Key"},
  
  // CSV: Bronze I → Bronze II,Common Crate,
  "bronzeIToBronzeII": {crateKey: "Common Crate"},
  
  // CSV: Bronze II → Bronze III,100 Gems,Common Key
  "bronzeIIToBronzeIII": {gems: 100, crateKey: "Common Key"},
  
  // CSV: Bronze III → Silver I,Common Crate,
  "bronzeIIIToSilverI": {crateKey: "Common Crate"},
  
  // CSV: Silver I → Silver II,150 Gems,Rare Key
  "silverIToSilverII": {gems: 150, crateKey: "Rare Key"},
  
  // CSV: Silver II → Silver III,Rare Crate,
  "silverIIToSilverIII": {crateKey: "Rare Crate"},
  
  // CSV: Silver III → Gold I,150 Gems,Rare Key
  "silverIIIToGoldI": {gems: 150, crateKey: "Rare Key"},
  
  // CSV: Gold I → Gold II,Rare Crate,
  "goldIToGoldII": {crateKey: "Rare Crate"},
  
  // CSV: Gold II → Gold III,200 Gems,Exotic Key
  "goldIIToGoldIII": {gems: 200, crateKey: "Exotic Key"},
  
  // CSV: Gold III → Platinum I,Exotic Crate,
  "goldIIIToPlatinumI": {crateKey: "Exotic Crate"},
  
  // CSV: Platinum I → Platinum II,200 Gems,Exotic Key
  "platinumIToPlatinumII": {gems: 200, crateKey: "Exotic Key"},
  
  // CSV: Platinum II → Platinum III,Exotic Crate,
  "platinumIIToPlatinumIII": {crateKey: "Exotic Crate"},
  
  // CSV: Platinum III → Diamond I,300 Gems,Legendary Key
  "platinumIIIToDiamondI": {gems: 300, crateKey: "Legendary Key"},
  
  // CSV: Diamond I → Diamond II,Legendary Crate,
  "diamondIToDiamondII": {crateKey: "Legendary Crate"},
  
  // CSV: Diamond II → Diamond III,300 Gems,Legendary Key
  "diamondIIToDiamondIII": {gems: 300, crateKey: "Legendary Key"},
  
  // CSV: Diamond III → Master I,Legendary Crate,
  "diamondIIIToMasterI": {crateKey: "Legendary Crate"},
  
  // CSV: Master I → Master II,350 Gems,Legendary Key
  "masterIToMasterII": {gems: 350, crateKey: "Legendary Key"},
  
  // CSV: Master II → Master III,Legendary Crate,
  "masterIIToMasterIII": {crateKey: "Legendary Crate"},
  
  // CSV: Master III → Champion I,400 Gems,Legendary Key
  "masterIIIToChampionI": {gems: 400, crateKey: "Legendary Key"},
  
  // CSV: Champion I → Champion II,Legendary Crate,
  "championIToChampionII": {crateKey: "Legendary Crate"},
  
  // CSV: Champion II → Champion III,450 Gems,Mythical Key
  "championIIToChampionIII": {gems: 450, crateKey: "Mythical Key"},
  
  // CSV: Champion III → Ascendant I,Mythical Crate,
  "championIIIToAscendantI": {crateKey: "Mythical Crate"},
  
  // CSV: Ascendant I → Ascendant II,500 Gems,Legendary Key
  "ascendantIToAscendantII": {gems: 500, crateKey: "Legendary Key"},
  
  // CSV: Ascendant II → Ascendant III,Legendary Crate,
  "ascendantIIToAscendantIII": {crateKey: "Legendary Crate"},
  
  // CSV: Ascendant III → Hypersonic I,500 Gems,Mythical Key
  "ascendantIIIToHypersonicI": {gems: 500, crateKey: "Mythical Key"},
  
  // CSV: Hypersonic I → Hypersonic II,Mythical Crate,
  "hypersonicIToHypersonicII": {crateKey: "Mythical Crate"},
  
  // CSV: Hypersonic II → Hypersonic III,750 Gems,Mythical Crate
  "hypersonicIIToHypersonicIII": {gems: 750, crateKey: "Mythical Crate"},
};

// Example function calls:
console.log("=== CLAIM REWARDS TEST DATA ===");

// Test case 1: Gems + Crate/Key reward
console.log("Test 1 - Unranked → Bronze I:");
console.log("Expected reward:", PROMOTION_REWARDS_TEST.unrankedToBronzeI);
console.log("Call: claimRewards({ rewardType: 'unrankedToBronzeI' })");

// Test case 2: Only Crate/Key reward
console.log("\nTest 2 - Bronze I → Bronze II:");
console.log("Expected reward:", PROMOTION_REWARDS_TEST.bronzeIToBronzeII);
console.log("Call: claimRewards({ rewardType: 'bronzeIToBronzeII' })");

// Test case 3: High tier reward
console.log("\nTest 3 - Hypersonic II → Hypersonic III:");
console.log("Expected reward:", PROMOTION_REWARDS_TEST.hypersonicIIToHypersonicIII);
console.log("Call: claimRewards({ rewardType: 'hypersonicIIToHypersonicIII' })");

console.log("\n=== REWARD BREAKDOWN ===");
console.log("Gem Rewards Only:", Object.entries(PROMOTION_REWARDS_TEST)
  .filter(([_, reward]) => reward.gems && !reward.crateKey)
  .map(([key, reward]) => `${key}: ${reward.gems} gems`));

console.log("Crate/Key Only:", Object.entries(PROMOTION_REWARDS_TEST)
  .filter(([_, reward]) => reward.crateKey && !reward.gems)
  .map(([key, reward]) => `${key}: ${reward.crateKey}`));

console.log("Both Gems + Crate/Key:", Object.entries(PROMOTION_REWARDS_TEST)
  .filter(([_, reward]) => reward.gems && reward.crateKey)
  .map(([key, reward]) => `${key}: ${reward.gems} gems + ${reward.crateKey}`));
