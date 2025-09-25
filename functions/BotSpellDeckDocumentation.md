# Bot Spell Deck Generator Documentation

This document provides details on how to use the `generateBotSpellDecks` Firebase Cloud Function for creating AI bot spell loadouts based on trophy counts in Mystic Motors.

## Overview

The function generates spell decks for bots based on their trophy counts. It includes appropriate spell selection and leveling to ensure bots at different trophy ranges have suitable challenges for players.

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
      "referenceTrophiesFor100": 8000,
      "referenceLevelAt100": 150,
      "deckSize": 6,
      "deterministicSeed": 42
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
    "botSpellDecks": {
      "trophies": 3500,
      "inferredLevel": 63,
      "spells": [
        {
          "name": "Ice lock",
          "type": "Target Lock",
          "level": 3
        },
        {
          "name": "Void blades",
          "type": "Melee",
          "level": 4
        },
        {
          "name": "Storm Aura",
          "type": "Area Effect",
          "level": 3
        },
        {
          "name": "Supersonic",
          "type": "Powerup",
          "level": 4
        },
        {
          "name": "Overdrive",
          "type": "Powerup",
          "level": 3
        }
      ]
    }
  }
}
```

### Response for Multiple Trophy Values

```json
{
  "result": {
    "success": true,
    "botSpellDecks": [
      {
        "trophies": 0,
        "inferredLevel": 1,
        "spells": [
          {
            "name": "Invisibility",
            "type": "Powerup",
            "level": 1
          },
          {
            "name": "Meteor Wrath",
            "type": "Target Lock",
            "level": 1
          },
          {
            "name": "Ice lock",
            "type": "Target Lock",
            "level": 1
          },
          {
            "name": "Void blades",
            "type": "Melee",
            "level": 1
          },
          {
            "name": "Storm Aura",
            "type": "Area Effect",
            "level": 1
          }
        ]
      },
      {
        "trophies": 2500,
        "inferredLevel": 44,
        "spells": [
          {
            "name": "Void blades",
            "type": "Melee",
            "level": 3
          },
          {
            "name": "Supersonic",
            "type": "Powerup",
            "level": 3
          },
          {
            "name": "Overdrive",
            "type": "Powerup",
            "level": 4
          },
          {
            "name": "Tiny Terror",
            "type": "Powerup",
            "level": 3
          },
          {
            "name": "Shockwave",
            "type": "Area Effect",
            "level": 3
          }
        ]
      }
      // ... additional bot entries
    ]
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "internal",
    "message": "Failed to generate bot spell decks",
    "details": {}
  }
}
```

## Configuration Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `referenceTrophiesFor100` | Number | Trophy count that represents 100% difficulty | 7500 |
| `referenceLevelAt100` | Number | Player level at reference trophy count | 133 |
| `deckSize` | Number | Number of spells per bot | 5 |
| `deterministicSeed` | Number | Optional seed for reproducible randomness | null |

## Spell Level Distribution

The function calculates appropriate spell levels based on trophy count ranges:

| Trophy Range | Level Distribution |
|--------------|-------------------|
| 0-1000 | Mostly levels 1-2 |
| 1000-3000 | Mostly levels 2-4 |
| 3000-5000 | Mostly levels 3-5 |
| 6000+ | Mostly level 5 |

## Available Spells

The system includes 13 spells with different unlock levels:

| Spell Name | Type | Unlock Level |
|------------|------|-------------|
| Invisibility | Powerup | 0 (Default) |
| Meteor Wrath | Target Lock | 0 (Default) |
| Ice lock | Target Lock | 0 (Default) |
| Void blades | Melee | 0 (Default) |
| Storm Aura | Area Effect | 0 (Default) |
| Supersonic | Powerup | 3 |
| Overdrive | Powerup | 5 |
| Tiny Terror | Powerup | 10 |
| Shockwave | Area Effect | 15 |
| Fireball | Target Lock | 20 |
| Power Out | Target Lock | 25 |
| Phase Shift | Powerup | 30 |
| Sky Reaper | Target Lock | 35 |

## Unity Integration Example

```csharp
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

public class BotSpellDeckService : MonoBehaviour
{
    private const string FunctionUrl = "https://us-central1-myticmotorscargame.cloudfunctions.net/generateBotSpellDecks";
    private string idToken; // Firebase Auth token

    [System.Serializable]
    public class Spell
    {
        public string name;
        public string type;
        public int level;
    }

    [System.Serializable]
    public class BotSpellDeck
    {
        public float trophies;
        public int inferredLevel;
        public List<Spell> spells;
    }

    [System.Serializable]
    public class BotSpellDeckResponse
    {
        public bool success;
        public BotSpellDeck botSpellDecks;
    }

    [System.Serializable]
    public class BotSpellDecksArrayResponse
    {
        public bool success;
        public List<BotSpellDeck> botSpellDecks;
    }

    [System.Serializable]
    public class FunctionResponse
    {
        public BotSpellDeckResponse result;
    }

    [System.Serializable]
    public class FunctionArrayResponse
    {
        public BotSpellDecksArrayResponse result;
    }

    // Call with a single trophy value
    public async Task<BotSpellDeck> GetBotSpellDeckForTrophies(float trophies)
    {
        // Create request body
        var requestData = new Dictionary<string, object>
        {
            { "trophies", trophies }
        };
        
        var jsonBody = new Dictionary<string, object>
        {
            { "data", requestData }
        };
        
        string jsonString = JsonConvert.SerializeObject(jsonBody);
        
        using (UnityWebRequest request = new UnityWebRequest(FunctionUrl, "POST"))
        {
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonString);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Authorization", "Bearer " + idToken);
            
            await request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                string responseJson = request.downloadHandler.text;
                FunctionResponse response = JsonConvert.DeserializeObject<FunctionResponse>(responseJson);
                return response.result.botSpellDecks;
            }
            else
            {
                Debug.LogError("Error: " + request.error);
                Debug.LogError("Response: " + request.downloadHandler.text);
                return null;
            }
        }
    }

    // Call with multiple trophy values
    public async Task<List<BotSpellDeck>> GetBotSpellDecksForTrophyArray(float[] trophies)
    {
        // Create request body
        var requestData = new Dictionary<string, object>
        {
            { "trophies", trophies }
        };
        
        var jsonBody = new Dictionary<string, object>
        {
            { "data", requestData }
        };
        
        string jsonString = JsonConvert.SerializeObject(jsonBody);
        
        using (UnityWebRequest request = new UnityWebRequest(FunctionUrl, "POST"))
        {
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonString);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Authorization", "Bearer " + idToken);
            
            await request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                string responseJson = request.downloadHandler.text;
                FunctionArrayResponse response = JsonConvert.DeserializeObject<FunctionArrayResponse>(responseJson);
                return response.result.botSpellDecks;
            }
            else
            {
                Debug.LogError("Error: " + request.error);
                Debug.LogError("Response: " + request.downloadHandler.text);
                return null;
            }
        }
    }
}
```

## Usage Notes

1. The function scales spell levels based on trophy count, with higher trophies resulting in higher level spells
2. Bots only have access to spells that would be unlocked at their inferred level
3. For predictable randomization (e.g., tournaments), use the `deterministicSeed` parameter
4. Bots with trophies ≥ 7500 (100%) will have a strong bias toward level 5 spells
5. Default spells (unlock level 0) are used to fill decks when not enough spells are unlocked
