# Clan Bookmark API Documentation

## bookmarkClan

**Request Format:**
```json
{
  "data": {
    "clanId": "string"
  }
}
```

**Response Format:**
```json
{
  "success": true,
  "message": "Clan bookmarked successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```

## removeClanBookmark

**Request Format:**
```json
{
  "data": {
    "clanId": "string"
  }
}
```

**Response Format:**
```json
{
  "success": true,
  "message": "Clan bookmark removed successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```

## getBookmarks

**Request Format:**
```json
{
  "data": {
    "limit": number,     // optional
    "lastVisible": {     // optional
      "id": "string",
      "name": "string",
      "memberCount": number,
      "trophies": number,
      "createdAt": timestamp
    }
  }
}
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "clans": [
      {
        "id": "string",
        "name": "string",
        "description": "string",
        "type": "string",
        "requiredTrophies": number,
        "memberCount": number,
        "trophies": number,
        "createdAt": timestamp,
        "region": "string",
        "clanLeader": "string",
        "lastActive": timestamp
      }
    ],
    "lastVisible": {
      "id": "string",
      "name": "string",
      "memberCount": number,
      "trophies": number,
      "createdAt": timestamp
    }
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```
