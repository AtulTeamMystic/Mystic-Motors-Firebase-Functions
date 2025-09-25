// Test script for getRankRewards function
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK with your service account
// Replace with your actual service account file path
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://myticmotorscargame.firebaseio.com'
});

const functions = require('firebase-functions-test')();

// Test the getRankRewards function
async function testGetRankRewards() {
  try {
    // This would simulate the actual function call
    console.log('Testing getRankRewards function...');
    
    // Expected output structure
    const expectedRanks = [
      { rankName: "Unranked", maxReward: 2000 },
      { rankName: "Bronze I", maxReward: 2200 },
      { rankName: "Bronze II", maxReward: 2500 },
      { rankName: "Bronze III", maxReward: 2800 },
      { rankName: "Silver I", maxReward: 3100 },
      { rankName: "Silver II", maxReward: 3500 },
      { rankName: "Silver III", maxReward: 3900 },
      { rankName: "Gold I", maxReward: 4300 },
      { rankName: "Gold II", maxReward: 4800 },
      { rankName: "Gold III", maxReward: 5400 },
      { rankName: "Platinum I", maxReward: 6000 },
      { rankName: "Platinum II", maxReward: 6700 },
      { rankName: "Platinum III", maxReward: 7500 },
      { rankName: "Diamond I", maxReward: 8400 },
      { rankName: "Diamond II", maxReward: 9400 },
      { rankName: "Diamond III", maxReward: 10500 },
      { rankName: "Master I", maxReward: 11800 },
      { rankName: "Master II", maxReward: 13200 },
      { rankName: "Master III", maxReward: 14800 },
      { rankName: "Champion I", maxReward: 16600 },
      { rankName: "Champion II", maxReward: 18600 },
      { rankName: "Champion III", maxReward: 20900 },
      { rankName: "Ascendant I", maxReward: 23400 },
      { rankName: "Ascendant II", maxReward: 26200 },
      { rankName: "Ascendant III", maxReward: 29400 },
      { rankName: "Hypersonic I", maxReward: 32900 },
      { rankName: "Hypersonic II", maxReward: 36900 },
      { rankName: "Hypersonic III", maxReward: 41300 }
    ];
    
    console.log('Expected output:');
    console.log(JSON.stringify({
      success: true,
      ranks: expectedRanks,
      totalRanks: expectedRanks.length,
      message: "Rank rewards data retrieved successfully"
    }, null, 2));
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

testGetRankRewards();
