
/**
 * IndexedDB schema (act_acc_v40)
 * - accounts: keyPath 'id'
 *    indexes: account (unique), tag, status, updated_at
 * - activities: keyPath 'id'
 *    indexes: name, created_at
 * - enrollments: keyPath 'id' (activityId|accountId)
 *    indexes: activityId, accountId, enrolled, winner, paid, updated_at
 * - snapshots: keyPath 'id' (timestamp)
 *
 * All writes are local-first. Export JSON is the primary safety net.
 */

export const DB_NAME = 'act_acc_v40';
export const DB_VER  = 1;

export function nowIso(){
  const d = new Date();
  return d.toISOString().slice(0,19).replace('T',' ');
}

export function uid(){
  return (crypto?.randomUUID?.() || (Date.now().toString(16) + Math.random().toString(16).slice(2)));
}

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = req.result;

      if(!db.objectStoreNames.contains('accounts')){
        const s = db.createObjectStore('accounts', { keyPath:'id' });
        s.createIndex('account','account',{unique:true});
        s.createIndex('tag','tag',{unique:false});
        s.createIndex('status','status',{unique:false});
        s.createIndex('updated_at','updated_at',{unique:false});
      }
      if(!db.objectStoreNames.contains('activities')){
        const s = db.createObjectStore('activities', { keyPath:'id' });
        s.createIndex('name','name',{unique:false});
        s.createIndex('created_at','created_at',{unique:false});
      }
      if(!db.objectStoreNames.contains('enrollments')){
        const s = db.createObjectStore('enrollments', { keyPath:'id' });
        s.createIndex('activityId','activityId',{unique:false});
        s.createIndex('accountId','accountId',{unique:false});
        s.createIndex('enrolled','enrolled',{unique:false});
        s.createIndex('winner','winner',{unique:false});
        s.createIndex('paid','paid',{unique:false});
        s.createIndex('updated_at','updated_at',{unique:false});
      }
      if(!db.objectStoreNames.contains('snapshots')){
        db.createObjectStore('snapshots', { keyPath:'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('openDB failed'));
  });
}

async function tx(db, storeNames, mode='readonly'){
  const t = db.transaction(storeNames, mode);
  const stores = storeNames.map(n => t.objectStore(n));
  return { t, stores };
}

function reqToPromise(r){
  return new Promise((resolve, reject)=>{
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('idb request failed'));
  });
}

export async function idbGetAll(storeName){
  const db = await openDB();
  const { stores } = await tx(db, [storeName], 'readonly');
  return await reqToPromise(stores[0].getAll());
}

export async function idbGetByIndex(storeName, indexName, value){
  const db = await openDB();
  const { stores } = await tx(db, [storeName], 'readonly');
  const idx = stores[0].index(indexName);
  return await reqToPromise(idx.getAll(value));
}

export async function idbGet(storeName, key){
  const db = await openDB();
  const { stores } = await tx(db, [storeName], 'readonly');
  return await reqToPromise(stores[0].get(key));
}

export async function idbPut(storeName, obj){
  const db = await openDB();
  const { t, stores } = await tx(db, [storeName], 'readwrite');
  stores[0].put(obj);
  return await new Promise((resolve, reject)=>{
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

export async function idbBulkPut(storeName, objs){
  const db = await openDB();
  const { t, stores } = await tx(db, [storeName], 'readwrite');
  for(const o of objs) stores[0].put(o);
  return await new Promise((resolve, reject)=>{
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

export async function idbDelete(storeName, key){
  const db = await openDB();
  const { t, stores } = await tx(db, [storeName], 'readwrite');
  stores[0].delete(key);
  return await new Promise((resolve, reject)=>{
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

export async function idbClear(storeName){
  const db = await openDB();
  const { t, stores } = await tx(db, [storeName], 'readwrite');
  stores[0].clear();
  return await new Promise((resolve, reject)=>{
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

export async function exportAll(){
  const [accounts, activities, enrollments] = await Promise.all([
    idbGetAll('accounts'),
    idbGetAll('activities'),
    idbGetAll('enrollments'),
  ]);
  return { schema: {name: DB_NAME, ver: DB_VER}, exported_at: nowIso(), accounts, activities, enrollments };
}

export async function importAll(payload){
  if(!payload || !payload.accounts) throw new Error('导入失败：JSON 结构不正确');
  // We do "upsert" behavior; do not clear by default.
  const acc = payload.accounts || [];
  const act = payload.activities || [];
  const enr = payload.enrollments || [];
  await idbBulkPut('accounts', acc);
  await idbBulkPut('activities', act);
  await idbBulkPut('enrollments', enr);
  return true;
}

export async function saveSnapshot(note='auto'){
  const db = await openDB();
  const data = await exportAll();
  const snap = { id: Date.now(), note, ...data };
  const { t, stores } = await tx(db, ['snapshots'], 'readwrite');
  stores[0].put(snap);
  return await new Promise((resolve,reject)=>{
    t.oncomplete = ()=>resolve(snap.id);
    t.onerror = ()=>reject(t.error||new Error('snapshot tx failed'));
    t.onabort = ()=>reject(t.error||new Error('snapshot tx aborted'));
  });
}

export async function listSnapshots(limit=30){
  const db = await openDB();
  const { stores } = await tx(db, ['snapshots'], 'readonly');
  const all = await reqToPromise(stores[0].getAll());
  all.sort((a,b)=>b.id-a.id);
  return all.slice(0, limit);
}

export async function loadSnapshot(id){
  const snap = await idbGet('snapshots', id);
  if(!snap) throw new Error('快照不存在');
  // Clear current and restore snapshot fully
  await Promise.all([idbClear('accounts'), idbClear('activities'), idbClear('enrollments')]);
  await importAll(snap);
  return true;
}
