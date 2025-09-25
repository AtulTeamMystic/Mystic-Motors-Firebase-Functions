# Bot Difficulty Function Documentation

This document provides details on how to use the `calculateBotDifficulty` Firebase Cloud Function for adjusting bot difficulty based on trophy counts in Mystic Motors.

## Overview

The function calculates bot stats based on player trophy counts using linear scaling. Higher trophy counts result in more challenging bot opponents with improved speed, acceleration, and boost capabilities.

## Request Format

### Single Trophy Request

```json
{
  "data": {
    "trophies": 3500
  }
}
```

### Multiple Trophy Values Request

```json
{
  "data": {
    "trophies": [0, 1000, 2500, 5000, 7500, 10000]
  }
}
```

### Request with Custom Configuration

```json
{
  "data": {
    "trophies": [2500, 5000],
    "config": {
      "referenceTrophies": 8000,
      "allowOver100": true,
      "clampToBounds": true,
      "maxSpeed": { "minVal": 90, "maxVal": 270 },
      "acceleration": { "minVal": 6, "maxVal": 13 },
      "boostTime": { "minVal": 1.0, "maxVal": 3.5 },
      "boostFrequency": { "minVal": 3, "maxVal": 12 },
      "boostCooldown": { "minVal": 5, "maxVal": 1.0 }
    }
  }
}
```

## Response Format

### Response for Single Trophy Value

```json
{
  "result": {
    "success": true,
    "botStats": {
      "trophies": 3500,
      "percentOfReference": 0.4667,
      "maxSpeed": 159.335,
      "acceleration": 8.2669,
      "boostTime": 1.8334,
      "boostFrequency": 5.7335,
      "boostCooldown": 3.9332
    }
  }
}
```

### Response for Multiple Trophy Values

```json
{
  "result": {
    "success": true,
    "botStats": [
      {
        "trophies": 0,
        "percentOfReference": 0,
        "maxSpeed": 80,
        "acceleration": 5,
        "boostTime": 0.8,
        "boostFrequency": 2,
        "boostCooldown": 6
      },
      {
        "trophies": 1000,
        "percentOfReference": 0.1333,
        "maxSpeed": 102.67,
        "acceleration": 5.93,
        "boostTime": 1.09,
        "boostFrequency": 3.07,
        "boostCooldown": 5.4
      },
      {
        "trophies": 2500,
        "percentOfReference": 0.3333,
        "maxSpeed": 136.67,
        "acceleration": 7.33,
        "boostTime": 1.53,
        "boostFrequency": 4.67,
        "boostCooldown": 4.5
      }
      // ... additional trophy entries
    ]
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "internal",
    "message": "Failed to calculate bot difficulty stats",
    "details": {}
  }
}
```

## Configuration Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `referenceTrophies` | Number | Trophy count that represents 100% difficulty | 7500 |
| `allowOver100` | Boolean | Whether to allow difficulty scaling beyond 100% | true |
| `clampToBounds` | Boolean | Whether to clamp all stat values to their min/max range | false |

## Stat Parameters

Each stat has a minimum value (at 0 trophies) and maximum value (at reference trophies):

| Stat | Min Value | Max Value | Description |
|------|-----------|-----------|-------------|
| `maxSpeed` | 80.0 | 250.0 | Maximum speed in game units |
| `acceleration` | 5.0 | 12.0 | Acceleration rate in m/s² |
| `boostTime` | 0.8 | 3.0 | Duration of boost in seconds |
| `boostFrequency` | 2.0 | 10.0 | How often boost is used (higher = more frequent) |
| `boostCooldown` | 6.0 | 1.5 | Time between boosts in seconds (lower is better) |

## Usage Notes

1. The function scales bot difficulty linearly based on trophy count
2. For `boostCooldown`, lower values are better (less waiting between boosts)
3. You can customize all parameters using the config object
4. Trophy counts above the reference value will exceed 100% difficulty if `allowOver100` is true
5. Use the `clampToBounds` option to ensure values stay within their defined ranges
