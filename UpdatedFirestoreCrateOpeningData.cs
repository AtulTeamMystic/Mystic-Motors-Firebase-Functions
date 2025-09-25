using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Firebase.Firestore;
using Firebase.Extensions;
using Firebase.Functions;

public class FirestoreCrateOpeningData : MonoBehaviour
{
    public static FirestoreCrateOpeningData Instance { get; private set; }
    void Awake()
    {
        Instance = this;
    }
    [SerializeField] private CratesDistributionData defaultCrateDistributionData;
    [SerializeField] private string collectionName = "CratesDistributionData";
    void Start()
    {
        StartCoroutine(GetCrateDistributionData());
        Invoke(nameof(TestCrateOpening), 10);
    }
    IEnumerator GetCrateDistributionData()
    {
        while (FirestoreManager.Instance == null || !FirestoreManager.Instance.IsInitialized)
        {
            yield return null;
        }
        
        var docRef = FirestoreManager.Instance.db.Collection(collectionName).Document(collectionName);
        
        docRef.GetSnapshotAsync().ContinueWithOnMainThread(task =>
        {
            if (task.IsFaulted)
            {
                Debug.LogError($"Failed to fetch crate distribution data: {task.Exception?.GetBaseException().Message}");
                if (defaultCrateDistributionData != null)
                {
                    Debug.Log("Using default crate distribution data");
                }
                return;
            }
            
            if (task.IsCanceled)
            {
                Debug.LogError("Fetch crate distribution data was canceled.");
                return;
            }
            
            var snapshot = task.Result;
            if (!snapshot.Exists)
            {
                Debug.LogWarning("Crate distribution document does not exist. Using default data.");
                return;
            }
            
            if (!snapshot.ContainsField(collectionName))
            {
                Debug.LogWarning($"Field '{collectionName}' not found in document. Using default data.");
                return;
            }
            
            try
            {
                string jsonData = snapshot.GetValue<string>(collectionName);
                
                CratesDistributionData firestoreData = JsonUtility.FromJson<CratesDistributionData>(jsonData);
                
                if (firestoreData != null)
                {
                    defaultCrateDistributionData = firestoreData;
                    Debug.Log("Successfully loaded crate distribution data from Firestore");
                }
                else
                {
                    Debug.LogError("Failed to parse crate distribution data from JSON");
                }
            }
            catch (System.Exception ex)
            {
                Debug.LogError($"Error parsing crate distribution data: {ex.Message}");
            }
        });
    }

    public CratesDistributionData GetCurrentCrateDistributionData()
    {
        return defaultCrateDistributionData;
    }

    public void RefreshCrateDistributionData()
    {
        StartCoroutine(GetCrateDistributionData());
    }
    
    public void TestCrateOpening()
    {
        // Test opening a crate with a specific type
        OpenCrateServerSide(CrateType.Common, FirebaseAuthManager.Instance._loggedInUser?.UserId);
    }

    public void OpenCrateServerSide(CrateType crateType, string userId = null)
    {
        StartCoroutine(CallOpenCrateFunction(crateType, userId));
    }

    private IEnumerator CallOpenCrateFunction(CrateType crateType, string userId)
    {
        while (!FirestoreManager.Instance.IsInitialized)
        {
            yield return null;
        }

        FirebaseFunctions functions = FirebaseFunctions.DefaultInstance;
        
        var data = new Dictionary<string, object>
        {
            {"crateType", crateType.ToString()},
            {"userId", userId ?? FirebaseAuthManager.Instance._loggedInUser?.UserId}
        };

        Debug.Log($"Calling openCrate function with crateType: {crateType} userId: {userId}");

        var function = functions.GetHttpsCallable("openCrate");
        
        function.CallAsync(data).ContinueWithOnMainThread(task =>
        {
            if (task.IsFaulted)
            {
                Debug.LogError($"Error calling openCrate function: {task.Exception?.GetBaseException().Message}");
                return;
            }

            if (task.IsCanceled)
            {
                Debug.LogError("openCrate function call was canceled");
                return;
            }

            var result = task.Result;

            try
            {
                // Convert Firebase dictionary result to CrateOpeningResult
                if (result.Data is Dictionary<object, object> resultDict)
                {
                    var crateResult = new CrateOpeningResult
                    {
                        success = Convert.ToBoolean(resultDict["success"]),
                        itemName = resultDict["itemName"]?.ToString(),
                        colorName = resultDict["colorName"]?.ToString(),
                        itemType = Convert.ToInt32(resultDict["itemType"]),
                        itemRarity = Convert.ToInt32(resultDict["itemRarity"]),
                        message = resultDict["message"]?.ToString()
                    };
                    
                    Debug.Log($"Received: {crateResult.itemName} ({crateResult.colorName}) - Rarity: {crateResult.itemRarity}");
                    
                    if (crateResult.success)
                    {
                        Debug.Log($"✅ Crate opened successfully!");
                        OnCrateOpeningSuccess(crateResult);
                    }
                    else
                    {
                        Debug.LogError($"❌ Failed to open crate: {crateResult.message}");
                    }
                }
                else
                {
                    Debug.LogError($"❌ Unexpected result type: {result.Data.GetType()}");
                }
            }
            catch (System.Exception ex)
            {
                Debug.LogError($"❌ Error parsing crate opening result: {ex.Message}");
            }
        });
    }

    protected virtual void OnCrateOpeningSuccess(CrateOpeningResult result)
    {
        Debug.Log($"🎉 Crate opening successful! Received: {result.itemName} - {result.colorName}");
    }

    // Helper class for JSON conversion
    [Serializable]
    public class CratesDistributionData
    {
        public DistributionData Common;
        public DistributionData Rare;
        public DistributionData Exotic;
        public DistributionData Legendary;
        public DistributionData Mythical;
    }
    
    [Serializable]
    public class DistributionData
    {
        public float CommonPercentage;
        public float RarePercentage;
        public float ExoticPercentage;
        public float LegendaryPercentage;
        public float MythicalPercentage;
    }
}

// Updated to match the new Firebase function response structure
[System.Serializable]
public class CrateOpeningResult
{
    public bool success;
    public string itemName;
    public string colorName;
    public int itemType;
    public int itemRarity;
    public string message;
}

public enum CrateType
{
    Common,
    Rare,
    Exotic,
    Legendary,
    Mythical
}
