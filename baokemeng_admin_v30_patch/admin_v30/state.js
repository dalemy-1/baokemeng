// state.js - admin_v30
// 仅封装 IndexedDB：open / getAll / get / put
export function openDB(name, version, storesDef){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e)=>{
      const db = req.result;
      for(const [storeName, def] of Object.entries(storesDef||{})){
        if(!db.objectStoreNames.contains(storeName)){
          db.createObjectStore(storeName, { keyPath: def.keyPath });
        }
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error || new Error('idb_open_failed'));
  });
}

function tx(db, store, mode='readonly'){
  const t = db.transaction([store], mode);
  const os = t.objectStore(store);
  return { t, os };
}

export function getAll(db, store){
  return new Promise((resolve, reject)=>{
    const { t, os } = tx(db, store, 'readonly');
    const req = os.getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error || t.error || new Error('idb_getAll_failed'));
  });
}

export function getByKey(db, store, key){
  return new Promise((resolve, reject)=>{
    const { t, os } = tx(db, store, 'readonly');
    const req = os.get(key);
    req.onsuccess = ()=>resolve(req.result || null);
    req.onerror = ()=>reject(req.error || t.error || new Error('idb_get_failed'));
  });
}

export function put(db, store, obj){
  return new Promise((resolve, reject)=>{
    const { t, os } = tx(db, store, 'readwrite');
    const req = os.put(obj);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error || t.error || new Error('idb_put_failed'));
  });
}
