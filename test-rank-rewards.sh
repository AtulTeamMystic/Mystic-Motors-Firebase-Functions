#!/bin/bash

# Test the getRankRewards Firebase Cloud Function
# This function should return all rank names and their maximum coin rewards

echo "Testing getRankRewards function..."
echo "================================="

# You can test this with curl once the IAM permissions are set
# For now, this shows what the expected response should look like

echo "Expected Response Structure:"
echo "{"
echo "  \"success\": true,"
echo "  \"ranks\": ["
echo "    { \"rankName\": \"Unranked\", \"maxReward\": 2000 },"
echo "    { \"rankName\": \"Bronze I\", \"maxReward\": 2200 },"
echo "    { \"rankName\": \"Bronze II\", \"maxReward\": 2500 },"
echo "    { \"rankName\": \"Bronze III\", \"maxReward\": 2800 },"
echo "    { \"rankName\": \"Silver I\", \"maxReward\": 3100 },"
echo "    { \"rankName\": \"Silver II\", \"maxReward\": 3500 },"
echo "    { \"rankName\": \"Silver III\", \"maxReward\": 3900 },"
echo "    { \"rankName\": \"Gold I\", \"maxReward\": 4300 },"
echo "    { \"rankName\": \"Gold II\", \"maxReward\": 4800 },"
echo "    { \"rankName\": \"Gold III\", \"maxReward\": 5400 },"
echo "    { \"rankName\": \"Platinum I\", \"maxReward\": 6000 },"
echo "    { \"rankName\": \"Platinum II\", \"maxReward\": 6700 },"
echo "    { \"rankName\": \"Platinum III\", \"maxReward\": 7500 },"
echo "    { \"rankName\": \"Diamond I\", \"maxReward\": 8400 },"
echo "    { \"rankName\": \"Diamond II\", \"maxReward\": 9400 },"
echo "    { \"rankName\": \"Diamond III\", \"maxReward\": 10500 },"
echo "    { \"rankName\": \"Master I\", \"maxReward\": 11800 },"
echo "    { \"rankName\": \"Master II\", \"maxReward\": 13200 },"
echo "    { \"rankName\": \"Master III\", \"maxReward\": 14800 },"
echo "    { \"rankName\": \"Champion I\", \"maxReward\": 16600 },"
echo "    { \"rankName\": \"Champion II\", \"maxReward\": 18600 },"
echo "    { \"rankName\": \"Champion III\", \"maxReward\": 20900 },"
echo "    { \"rankName\": \"Ascendant I\", \"maxReward\": 23400 },"
echo "    { \"rankName\": \"Ascendant II\", \"maxReward\": 26200 },"
echo "    { \"rankName\": \"Ascendant III\", \"maxReward\": 29400 },"
echo "    { \"rankName\": \"Hypersonic I\", \"maxReward\": 32900 },"
echo "    { \"rankName\": \"Hypersonic II\", \"maxReward\": 36900 },"
echo "    { \"rankName\": \"Hypersonic III\", \"maxReward\": 41300 }"
echo "  ],"
echo "  \"totalRanks\": 28,"
echo "  \"message\": \"Rank rewards data retrieved successfully\""
echo "}"

echo ""
echo "Function URL (when IAM permissions are set):"
echo "https://us-central1-myticmotorscargame.cloudfunctions.net/getRankRewards"
