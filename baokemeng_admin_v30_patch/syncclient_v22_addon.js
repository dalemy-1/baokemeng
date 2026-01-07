/**
 * SyncClientV22 Add-on (MVP Push/Pull Closure)
 * ------------------------------------------------------------
 * 目标：在不写回 IndexedDB 的前提下，实现：
 *   1) 从 IndexedDB 生成本地快照 OPS_LOCAL_SNAPSHOT_V1
 *   2) push 到云端 /api/sync/push（幂等 upsert）
 *   3) pull 回来 /api/sync/pull，并做 counts + hash 校验
 *
 * 依赖：你当前已验收通过的 window.SyncClientV21（用于 baseUrl/token 与 fetch 封装也可不用）
 * 输出：window.SyncClientV22
 *
 * 注意：你需要在 CONFIG 里填对 IndexedDB 的 DB 名称和 store 名称。
 */

/* =========================
 * CONFIG（你只需要改这里）
 * ========================= */
const V22_CONFIG = {
  // 你的 IndexedDB 数据库名（在 DevTools -> Application -> IndexedDB 里能看到）
  IDB_DB_NAME: "ops_v20",           // TODO: 改成你的真实 DB 名
  IDB_DB_VERSION: undefined,        // 不确定可留空（让浏览器自己选择当前版本）

  // 三个 store 的名字（同样在 IndexedDB 面板里可见）
  STORES: {
    accounts: "accounts",           // TODO: 改成你的真实 store 名
    activities: "activities",       // TODO: 改成你的真实 store 名
    entries: "activity_entries"     // TODO: 改成你的真实 store 名
  },

  // 三表的主键字段名（用于排序与 diff；通常是 id）
  ID_FIELD: "id",

  // localStorage keys（按你前面约定）
  LS_KEYS: {
    LOCAL_SNAPSHOT: "OPS_LOCAL_SNAPSHOT_V1",
    LAST_CLOUD_PULL: "OPS_LAST_CLOUD_PULL_V1"
  },

  // 接口（同域优先；baseUrl 为空则使用 location.origin）
  API: {
    push: "/api/sync/push",
    pull: "/api/sync/pull",
    ping: "/api/sync/ping"
  }
};

/* =========================
 * 工具：稳定序列化 + 简单 hash
 * ========================= */
function stableStringify(obj) {
  // 只满足 MVP：对象 key 排序，数组保持顺序
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// 简单且可复现的 hash（非加密用途；只做一致性校验）
function hashString(str) {
  let h1 = 0x811c9dc5; // FNV-like
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
  }
  // 输出 8位十六进制
  return ("00000000" + h1.toString(16)).slice(-8);
}

function nowISO() {
  return new Date().toISOString();
}

function log(...args) {
  console.log("[V22]", ...args);
}

/* =========================
 * IndexedDB 读取：全量导出 store
 * ========================= */
function openIDB(dbName, version) {
  return new Promise((resolve, reject) => {
    const req = (version === undefined)
      ? indexedDB.open(dbName)
      : indexedDB.open(dbName, version);

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

/* =========================
 * 快照生成
 * ========================= */
function normalizeAndSort(list, idField) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => {
    const av = a?.[idField] ?? "";
    const bv = b?.[idField] ?? "";
    return String(av).localeCompare(String(bv));
  });
  return arr;
}

async function generateLocalSnapshot() {
  const { IDB_DB_NAME, IDB_DB_VERSION, STORES, ID_FIELD, LS_KEYS } = V22_CONFIG;

  log("Generating local snapshot from IndexedDB…", { db: IDB_DB_NAME, stores: STORES });
  const db = await openIDB(IDB_DB_NAME, IDB_DB_VERSION);

  try {
    const accounts = normalizeAndSort(await readAllFromStore(db, STORES.accounts), ID_FIELD);
    const activities = normalizeAndSort(await readAllFromStore(db, STORES.activities), ID_FIELD);
    const entries = normalizeAndSort(await readAllFromStore(db, STORES.entries), ID_FIELD);

    const data = { accounts, activities, entries };
    const counts = { accounts: accounts.length, activities: activities.length, entries: entries.length };

    const payloadForHash = stableStringify({ data }); // hash 只看 data（避免 ts 影响）
    const hash = hashString(payloadForHash);

    const snapshot = {
      v: "V22_MVP",
      ts: nowISO(),
      counts,
      hash,
      data
    };

    localStorage.setItem(LS_KEYS.LOCAL_SNAPSHOT, JSON.stringify(snapshot));
    log("Local snapshot saved:", LS_KEYS.LOCAL_SNAPSHOT, snapshot.counts, "hash=", snapshot.hash);

    return snapshot;
  } finally {
    db.close();
  }
}

/* =========================
 * API 调用（同域 + x-admin-token）
 * ========================= */
function resolveBaseUrl() {
  // 优先复用 SyncClientV21 的 baseUrl 记忆（若存在）
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
    headers: {
      "content-type": "application/json",
      "x-admin-token": token
    },
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

/* =========================
 * Push / Pull / 校验
 * ========================= */
function diffIds(localList, cloudList, idField) {
  const a = new Set((localList || []).map(x => String(x?.[idField] ?? "")));
  const b = new Set((cloudList || []).map(x => String(x?.[idField] ?? "")));

  const localOnly = [];
  const cloudOnly = [];

  for (const id of a) if (id && !b.has(id)) localOnly.push(id);
  for (const id of b) if (id && !a.has(id)) cloudOnly.push(id);

  localOnly.sort();
  cloudOnly.sort();
  return { localOnly, cloudOnly };
}

function computeDataHash(dataObj) {
  return hashString(stableStringify({ data: dataObj }));
}

async function pushFromSnapshot(snapshot) {
  if (!snapshot?.data) throw new Error("snapshot missing data");
  log("Pushing snapshot to cloud…", snapshot.counts, "hash=", snapshot.hash);
  const json = await postJSON(V22_CONFIG.API.push, { data: snapshot.data, meta: { ts: snapshot.ts, hash: snapshot.hash } });
  log("Push OK:", json);
  return json;
}

async function pullToCache() {
  log("Pulling from cloud…");
  const json = await postJSON(V22_CONFIG.API.pull, {});

  // 兼容不同返回结构：json.data 或 json.payload.data
  const data = json.data || json.payload?.data || json.payload || null;
  const counts = json.counts || json.payload?.counts || null;

  const wrapped = { ts: nowISO(), counts, data };
  localStorage.setItem(V22_CONFIG.LS_KEYS.LAST_CLOUD_PULL, JSON.stringify(wrapped));
  log("Pull cached:", V22_CONFIG.LS_KEYS.LAST_CLOUD_PULL, counts);

  return wrapped;
}

function verifyClosure(localSnapshot, cloudWrapped) {
  const idField = V22_CONFIG.ID_FIELD;
  const localData = localSnapshot?.data;
  const cloudData = cloudWrapped?.data;

  if (!localData || !cloudData) {
    return { ok: false, reason: "missing localData/cloudData" };
  }

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

  const summary = {
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

  return summary;
}

/* =========================
 * 最小 UI：两个按钮
 *  - 生成快照
 *  - Push+Pull+校验
 * ========================= */
function ensurePanel() {
  let el = document.getElementById("sync-v22-panel");
  if (el) return el;

  el = document.createElement("div");
  el.id = "sync-v22-panel";
  el.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:99999",
    "background:#fff",
    "border:1px solid #e5e7eb",
    "box-shadow:0 8px 24px rgba(0,0,0,.12)",
    "border-radius:12px",
    "padding:12px",
    "width:320px",
    "font:12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ].join(";");

  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">V22 Push/Pull 闭环（MVP）</div>
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

function setStatus(text) {
  const el = document.getElementById("v22-status");
  if (el) el.textContent = text;
}

async function runSnapshot() {
  setStatus("生成快照中…");
  try {
    const snap = await generateLocalSnapshot();
    setStatus(`快照完成\ncounts=${JSON.stringify(snap.counts)}\nhash=${snap.hash}\nts=${snap.ts}`);
    return snap;
  } catch (e) {
    console.error(e);
    setStatus(`快照失败\n${e.message || e}`);
    throw e;
  }
}

async function runClosure() {
  setStatus("闭环执行中…\n1) 读取/生成快照");
  try {
    const snap = await runSnapshot();
    setStatus("2) Push 到云端…");
    await pushFromSnapshot(snap);
    setStatus("3) Pull 回来缓存…");
    const cloud = await pullToCache();
    setStatus("4) 校验 counts + hash…");
    const report = verifyClosure(snap, cloud);

    if (report.ok) {
      setStatus(
        "PASS 闭环成立\n" +
        `counts=${JSON.stringify(report.cloudCounts)}\n` +
        `hash(local)=${report.localHash}\n` +
        `hash(cloud)=${report.cloudHash}`
      );
    } else {
      setStatus(
        "FAIL 闭环未通过\n" +
        `countsOk=${report.countsOk} hashOk=${report.hashOk}\n` +
        `localCounts=${JSON.stringify(report.localCounts)}\n` +
        `cloudCounts=${JSON.stringify(report.cloudCounts)}\n` +
        `localHash=${report.localHash}\ncloudHash=${report.cloudHash}\n\n` +
        "diffPreview=" + JSON.stringify(report.diffsPreview, null, 2)
      );
    }
    log("Closure report:", report);
    return report;
  } catch (e) {
    console.error(e);
    const resp = e?.response ? "\nresponse=" + JSON.stringify(e.response) : "";
    setStatus(`闭环失败\n${e.message || e}${resp}`);
    throw e;
  }
}

function bindUI() {
  const panel = ensurePanel();
  panel.querySelector("#v22-btn-snapshot").onclick = () => runSnapshot();
  panel.querySelector("#v22-btn-closure").onclick = () => runClosure();
}

/* =========================
 * 导出到 window
 * ========================= */
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

// 自动挂载（你如果不想自动挂载，把下面这行注释掉）
try { window.SyncClientV22.mountUI(); } catch (e) { console.warn("[V22] mount UI failed", e); }
