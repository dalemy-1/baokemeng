/**
 * SyncClientV22 Add-on (MVP Push/Pull Closure) - act_acc_v199 适配版
 * ------------------------------------------------------------
 * 适配你的实际 IndexedDB：
 *   DB: act_acc_v199
 *   stores: accounts, activities
 *
 * 说明：
 * - 你的本地库当前没有 entries（activity_entries）store，所以 V22 MVP 默认把 entries 作为空数组参与闭环。
 * - 这样也可以完成“push -> pull -> 校验”的闭环验收（以 accounts/activities 为主）。
 */

const V22_CONFIG = {
  IDB_DB_NAME: "act_acc_v199",
  IDB_DB_VERSION: undefined,

  // 你的 store 名已确认：
  STORES: {
    accounts: "accounts",
    activities: "activities",
    // 你的本地没有 entries store：这里设为 null，代码会自动跳过读取
    entries: null
  },

  ID_FIELD: "id",

  LS_KEYS: {
    LOCAL_SNAPSHOT: "OPS_LOCAL_SNAPSHOT_V1",
    LAST_CLOUD_PULL: "OPS_LAST_CLOUD_PULL_V1"
  },

  API: {
    push: "/api/sync/push",
    pull: "/api/sync/pull",
    ping: "/api/sync/ping"
  }
};

/* ---------- stable stringify + hash ---------- */
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function hashString(str) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
  }
  return ("00000000" + h1.toString(16)).slice(-8);
}
function nowISO() { return new Date().toISOString(); }
function log(...args) { console.log("[V22]", ...args); }

/* ---------- IndexedDB helpers ---------- */
function openIDB(dbName, version) {
  return new Promise((resolve, reject) => {
    const req = (version === undefined) ? indexedDB.open(dbName) : indexedDB.open(dbName, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB.open failed"));
    req.onblocked = () => reject(new Error("indexedDB.open blocked (close other tabs?)"));
  });
}
function readAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("getAll failed: " + storeName));
  });
}
function normalizeAndSort(list, idField) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => String(a?.[idField] ?? "").localeCompare(String(b?.[idField] ?? "")));
  return arr;
}

/* ---------- snapshot ---------- */
async function generateLocalSnapshot() {
  const { IDB_DB_NAME, IDB_DB_VERSION, STORES, ID_FIELD, LS_KEYS } = V22_CONFIG;
  log("Generating local snapshot…", { db: IDB_DB_NAME, stores: STORES });

  const db = await openIDB(IDB_DB_NAME, IDB_DB_VERSION);
  try {
    const accounts = normalizeAndSort(await readAllFromStore(db, STORES.accounts), ID_FIELD);
    const activities = normalizeAndSort(await readAllFromStore(db, STORES.activities), ID_FIELD);

    // entries store 不存在：固定为空
    const entries = [];

    const data = { accounts, activities, entries };
    const counts = { accounts: accounts.length, activities: activities.length, entries: entries.length };

    const hash = hashString(stableStringify({ data }));
    const snapshot = { v: "V22_MVP", ts: nowISO(), counts, hash, data };

    localStorage.setItem(LS_KEYS.LOCAL_SNAPSHOT, JSON.stringify(snapshot));
    log("Local snapshot saved:", LS_KEYS.LOCAL_SNAPSHOT, snapshot.counts, "hash=", snapshot.hash);
    return snapshot;
  } finally {
    db.close();
  }
}

/* ---------- API ---------- */
function resolveBaseUrl() {
  const v21 = window.SyncClientV21;
  const fromV21 = v21?.getBaseUrl?.() || v21?.state?.baseUrl || "";
  const base = (fromV21 && typeof fromV21 === "string") ? fromV21.trim().replace(/\/+$/, "") : "";
  return base || location.origin;
}
function resolveAdminToken() {
  const v21 = window.SyncClientV21;
  const t = v21?.getAdminToken?.() || v21?.state?.adminToken || "";
  return (t && typeof t === "string") ? t : "";
}
async function postJSON(path, bodyObj) {
  const base = resolveBaseUrl();
  const url = base.replace(/\/+$/, "") + path;
  const token = resolveAdminToken();

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify(bodyObj || {})
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, raw: text }; }

  if (!res.ok || json?.ok === false) {
    const err = new Error(`API ${path} failed (${res.status})`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

/* ---------- push/pull/verify ---------- */
function diffIds(localList, cloudList, idField) {
  const a = new Set((localList || []).map(x => String(x?.[idField] ?? "")));
  const b = new Set((cloudList || []).map(x => String(x?.[idField] ?? "")));
  const localOnly = [], cloudOnly = [];
  for (const id of a) if (id && !b.has(id)) localOnly.push(id);
  for (const id of b) if (id && !a.has(id)) cloudOnly.push(id);
  localOnly.sort(); cloudOnly.sort();
  return { localOnly, cloudOnly };
}
function computeDataHash(dataObj) {
  return hashString(stableStringify({ data: dataObj }));
}

async function pushFromSnapshot(snapshot) {
  log("Pushing snapshot…", snapshot.counts, "hash=", snapshot.hash);
  return await postJSON(V22_CONFIG.API.push, { data: snapshot.data, meta: { ts: snapshot.ts, hash: snapshot.hash } });
}
async function pullToCache() {
  log("Pulling…");
  const json = await postJSON(V22_CONFIG.API.pull, {});
  const data = json.data || json.payload?.data || json.payload || null;
  const counts = json.counts || json.payload?.counts || null;

  const wrapped = { ts: nowISO(), counts, data };
  localStorage.setItem(V22_CONFIG.LS_KEYS.LAST_CLOUD_PULL, JSON.stringify(wrapped));
  return wrapped;
}

function verifyClosure(localSnapshot, cloudWrapped) {
  const idField = V22_CONFIG.ID_FIELD;
  const localData = localSnapshot?.data;
  const cloudData = cloudWrapped?.data;
  if (!localData || !cloudData) return { ok: false, reason: "missing localData/cloudData" };

  const localCounts = localSnapshot.counts || {};
  const cloudCounts = {
    accounts: (cloudData.accounts || []).length,
    activities: (cloudData.activities || []).length,
    entries: (cloudData.entries || []).length
  };

  const countsOk =
    localCounts.accounts === cloudCounts.accounts &&
    localCounts.activities === cloudCounts.activities &&
    localCounts.entries === cloudCounts.entries;

  const cloudHash = computeDataHash(cloudData);
  const hashOk = (localSnapshot.hash === cloudHash);

  const diffs = {
    accounts: diffIds(localData.accounts, cloudData.accounts, idField),
    activities: diffIds(localData.activities, cloudData.activities, idField),
    entries: diffIds(localData.entries, cloudData.entries, idField)
  };

  return {
    ok: countsOk && hashOk,
    countsOk,
    hashOk,
    localCounts,
    cloudCounts,
    localHash: localSnapshot.hash,
    cloudHash,
    diffsPreview: {
      accounts: { localOnly: diffs.accounts.localOnly.slice(0, 20), cloudOnly: diffs.accounts.cloudOnly.slice(0, 20) },
      activities: { localOnly: diffs.activities.localOnly.slice(0, 20), cloudOnly: diffs.activities.cloudOnly.slice(0, 20) },
      entries: { localOnly: diffs.entries.localOnly.slice(0, 20), cloudOnly: diffs.entries.cloudOnly.slice(0, 20) }
    }
  };
}

/* ---------- Minimal UI ---------- */
function ensurePanel() {
  let el = document.getElementById("sync-v22-panel");
  if (el) return el;

  el = document.createElement("div");
  el.id = "sync-v22-panel";
  el.style.cssText = [
    "position:fixed","right:16px","bottom:16px","z-index:99999",
    "background:#fff","border:1px solid #e5e7eb","box-shadow:0 8px 24px rgba(0,0,0,.12)",
    "border-radius:12px","padding:12px","width:320px",
    "font:12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ].join(";");

  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">V22 Push/Pull 闭环（act_acc_v199）</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button id="v22-btn-snapshot" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb;cursor:pointer;">生成快照</button>
      <button id="v22-btn-closure" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb;cursor:pointer;">Push+Pull+校验</button>
    </div>
    <div id="v22-status" style="white-space:pre-wrap;color:#111827;background:#f9fafb;border:1px dashed #e5e7eb;border-radius:10px;padding:8px;min-height:84px;">就绪</div>
    <div style="margin-top:8px;color:#6b7280;">
      快照：${V22_CONFIG.LS_KEYS.LOCAL_SNAPSHOT}<br/>
      云端拉取：${V22_CONFIG.LS_KEYS.LAST_CLOUD_PULL}
    </div>
  `;
  document.body.appendChild(el);
  return el;
}
function setStatus(t){ const el=document.getElementById("v22-status"); if(el) el.textContent=t; }

async function runSnapshot(){
  setStatus("生成快照中…");
  const snap = await generateLocalSnapshot();
  setStatus(`快照完成\ncounts=${JSON.stringify(snap.counts)}\nhash=${snap.hash}\nts=${snap.ts}`);
  return snap;
}
async function runClosure(){
  try{
    setStatus("闭环执行中…\n1) 生成快照");
    const snap = await runSnapshot();
    setStatus("2) Push 到云端…");
    await pushFromSnapshot(snap);
    setStatus("3) Pull 回来缓存…");
    const cloud = await pullToCache();
    setStatus("4) 校验 counts + hash…");
    const rep = verifyClosure(snap, cloud);

    if(rep.ok){
      setStatus("PASS 闭环成立\n" +
        `counts=${JSON.stringify(rep.cloudCounts)}\n` +
        `hash(local)=${rep.localHash}\n` +
        `hash(cloud)=${rep.cloudHash}`
      );
    }else{
      setStatus("FAIL 闭环未通过\n" +
        `countsOk=${rep.countsOk} hashOk=${rep.hashOk}\n` +
        `localCounts=${JSON.stringify(rep.localCounts)}\n` +
        `cloudCounts=${JSON.stringify(rep.cloudCounts)}\n` +
        `localHash=${rep.localHash}\ncloudHash=${rep.cloudHash}\n\n` +
        "diffPreview=" + JSON.stringify(rep.diffsPreview, null, 2)
      );
    }
    log("Closure report:", rep);
    return rep;
  }catch(e){
    console.error(e);
    const resp = e?.response ? "\nresponse=" + JSON.stringify(e.response) : "";
    setStatus(`闭环失败\n${e.message || e}${resp}`);
    throw e;
  }
}

function bindUI(){
  const p = ensurePanel();
  p.querySelector("#v22-btn-snapshot").onclick = () => runSnapshot();
  p.querySelector("#v22-btn-closure").onclick = () => runClosure();
}

window.SyncClientV22 = {
  config: V22_CONFIG,
  generateLocalSnapshot,
  pushFromSnapshot,
  pullToCache,
  verifyClosure,
  runSnapshot,
  runClosure,
  mountUI: () => { bindUI(); log("UI mounted"); }
};

try { window.SyncClientV22.mountUI(); } catch (e) { console.warn("[V22] mount UI failed", e); }
