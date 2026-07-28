/* 
   kickot - Avatar Cache Module (IndexedDB)
   Koristi IndexedDB za keširanje avatara umesto localStorage
   Ovo omogućava veći kapacitet i brže učitavanje
*/

const DB_NAME = 'kickot-avatar-cache';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';

let db = null;

/**
 * Inicijalizuje IndexedDB bazu za keširanje avatara
 */
async function initAvatarCache() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'username' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Dobavlja avatar URL iz IndexedDB keša
 * @param {string} username - Korisničko ime (case-insensitive)
 * @returns {Promise<string|null>} - Avatar URL ili null ako nije keširan
 */
async function getAvatarFromCache(username) {
  if (!username) return null;
  
  try {
    await initAvatarCache();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.get(username.toLowerCase());

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.url && result.url !== 'none') {
          resolve(result.url);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Error getting avatar from cache:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('Error accessing avatar cache:', error);
    return null;
  }
}

/**
 * Čuva avatar URL u IndexedDB kešu
 * @param {string} username - Korisničko ime (case-insensitive)
 * @param {string} url - Avatar URL ili 'none' ako avatar ne postoji
 */
async function setAvatarInCache(username, url) {
  if (!username) return;
  
  try {
    await initAvatarCache();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      
      const data = {
        username: username.toLowerCase(),
        url: url,
        timestamp: Date.now()
      };

      const request = objectStore.put(data);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('Error setting avatar in cache:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Error setting avatar in cache:', error);
  }
}

/**
 * Briše sve avatare iz keša
 */
async function clearAvatarCache() {
  try {
    await initAvatarCache();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.clear();

      request.onsuccess = () => {

        resolve();
      };

      request.onerror = () => {
        console.error('Error clearing avatar cache:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Error clearing avatar cache:', error);
  }
}

/**
 * Briše stare avatare (starije od 30 dana)
 */
async function cleanOldAvatars() {
  try {
    await initAvatarCache();
    
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const index = objectStore.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(thirtyDaysAgo));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {

          resolve();
        }
      };

      request.onerror = () => {
        console.error('Error cleaning old avatars:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Error cleaning old avatars:', error);
  }
}

/**
 * Dobavlja statistiku keša (broj stavki, ukupna veličina)
 */
async function getCacheStats() {
  try {
    await initAvatarCache();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(STORE_NAME);
      const countRequest = objectStore.count();

      countRequest.onsuccess = () => {
        resolve({
          count: countRequest.result,
          db: DB_NAME,
          version: DB_VERSION
        });
      };

      countRequest.onerror = () => {
        console.error('Error getting cache stats:', countRequest.error);
        reject(countRequest.error);
      };
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return null;
  }
}

/**
 * Briše stare avatar stavice iz localStorage (migracija na IndexedDB)
 * Ova funkcija čisti zastarele localStorage stavice koje se više ne koriste
 */
function clearOldLocalStorageAvatars() {
  try {
    let clearedCount = 0;
    
    // Prođi kroz sve localStorage ključeve
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      
      // Proveri da li je avatar cache ključ
      if (key && key.startsWith('avatar-cache-')) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {

    }
    
    return clearedCount;
  } catch (error) {
    console.error('Error clearing old localStorage avatars:', error);
    return 0;
  }
}

/**
 * Inicijalna migracija - čisti localStorage i inicijalizuje IndexedDB
 * Poziva se prilikom prvog load-a dashboard-a
 */
async function migrateAvatarCache() {
  try {
    // Prvo očisti stare localStorage stavice
    const clearedCount = clearOldLocalStorageAvatars();
    
    // Očisti zastarele OAuth state stavice
    clearStaleOAuthState();
    
    // Zatim inicijalizuj IndexedDB
    await initAvatarCache();
    
    // Opciono očisti stare avatare iz IndexedDB (starije od 30 dana)
    await cleanOldAvatars();
    

    
    return {
      localStorageCleared: clearedCount,
      indexedDBInitialized: true
    };
  } catch (error) {
    console.error('Error during avatar cache migration:', error);
    return {
      localStorageCleared: 0,
      indexedDBInitialized: false,
      error: error.message
    };
  }
}

/**
 * Čisti zastarele OAuth state stavice iz localStorage
 * Ovo čisti stare token state koji se više ne koriste
 */
function clearStaleOAuthState() {
  try {
    const keysToRemove = [
      'kick_oauth_state',
      'kick_code_verifier',
      'kick_token_type',
      'kick_session_active'
    ];
    
    let clearedCount = 0;
    
    keysToRemove.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    });
    
    if (clearedCount > 0) {

    }
    
    return clearedCount;
  } catch (error) {
    console.error('Error clearing stale OAuth state:', error);
    return 0;
  }
}

// Export funkcije za korišćenje u dashboard.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initAvatarCache,
    getAvatarFromCache,
    setAvatarInCache,
    clearAvatarCache,
    cleanOldAvatars,
    getCacheStats
  };
}
