/**
 * SyncClientV24 Deletes Add-on - act_acc_v199
 * 作用：用 Console 先验收 deletes 队列（不改 UI）
 *
 * 提供：
 *  - SyncClientV24.addDelete(tableName, rowId)
 *  - SyncClientV24.pushDeletes()  // 仅推送 deletes
 *  - SyncClientV24.pullAndApplyDeletes({ since }) // 拉取 deletes 并应用到 IndexedDB
 *  - SyncClientV24.status()
 *
 * 依赖：同域 /api/sync/push /pull 已升级到 V24（返回 deletes），并且有 admin token 存在 localStorage.ADMIN_SYNC_TOKEN
 */

(function () {
  const DB_NAME = "act_acc_v199";
  const STORES = { accounts: "accounts", activities: "activities" }; // entries 暂不在本地库
  const LS = {
    ADMIN_TOKEN: "ADMIN_SYNC_TOKEN",
    LOCAL_DELETES: "OPS_LOCAL_DELETES_V1",
    LAST_DELETES_PULL: "OPS_LAST_DELETES_PULL_V1",
  };

  function nowISO() { return new Date().toISOString(); }
  function log(...a){ console.log("[V24]", ...a); }
  function getToken(){
    const t = localStorage.getItem(LS.ADMIN_TOKEN) || "";
    return (t || "").trim();
  }
  function baseUrl(){ return location.origin; }
  function withAdminToken(url, token){
    if(!token) return url;
    const u = new URL(url, location.origin);
    if(!u.searchParams.get("admin_token")) u.searchParams.set("admin_token", token);
    return u.toString();
  }
  async function postJSON(path, body){
    const token = getToken();
    const url = withAdminToken(baseUrl() + path, token);
    const res = await fetch(url, {
      method:"POST",
      headers: { "content-type":"application/json", "x-admin-token": token },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let json; try{ json = JSON.parse(text); }catch{ json = { ok:false, raw:text }; }
    if(!res.ok || json?.ok === false){
      const e = new Error(`API ${path} failed (${res.status})`);
      e.status = res.status; e.response = json; e.url = url;
      throw e;
    }
    return json;
  }

  function loadDeletes(){
    try { return JSON.parse(localStorage.getItem(LS.LOCAL_DELETES) || "[]"); }
    catch { return []; }
  }
  function saveDeletes(list){
    localStorage.setItem(LS.LOCAL_DELETES, JSON.stringify(list || []));
  }

  function addDelete(table_name, row_id){
    const t = String(table_name || "").trim();
    const id = String(row_id || "").trim();
    if(!t || !id) throw new Error("addDelete requires (table_name,row_id)");
    if(t !== "accounts" && t !== "activities" && t !== "entries") throw new Error("table_name must be accounts|activities|entries");
    const list = loadDeletes();
    const key = t + "::" + id;
    const exists = list.some(x => (x.table_name + "::" + x.row_id) === key);
    if(!exists) list.push({ table_name: t, row_id: id, deleted_at: nowISO(), source:"admin" });
    saveDeletes(list);
    log("queued delete:", { table_name:t, row_id:id, total:list.length });
    return list;
  }

  function openIDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error || new Error("indexedDB.open failed"));
      req.onblocked = ()=> reject(new Error("indexedDB.open blocked"));
    });
  }
  function deleteOne(db, storeName, key){
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error || new Error("delete failed: " + storeName));
    });
  }

  async function pushDeletes(){
    const pending = loadDeletes();
    if(!pending.length){
      log("no pending deletes");
      return { ok:true, pushed:0 };
    }
    log("pushing deletes…", pending.length);
    const resp = await postJSON("/api/sync/push", { deletes: pending });
    // 最小策略：推送成功即清空
    saveDeletes([]);
    log("pushDeletes ok; cleared local queue");
    return resp;
  }

  async function pullAndApplyDeletes(opts){
    const since = opts?.since || null;
    log("pull deletes…", { since });
    const resp = await postJSON("/api/sync/pull", since ? { since } : {});
    const deletes = Array.isArray(resp?.deletes) ? resp.deletes : [];
    localStorage.setItem(LS.LAST_DELETES_PULL, JSON.stringify({ ts: nowISO(), since: since||null, count: deletes.length }));
    if(!deletes.length){
      log("no deletes from cloud");
      return { ok:true, applied:0, deletes:0 };
    }

    const db = await openIDB();
    let applied = 0;
    try{
      for(const d of deletes){
        const t = d?.table_name;
        const id = String(d?.row_id ?? "").trim();
        if(!id) continue;
        if(t === "accounts" || t === "activities"){
          await deleteOne(db, STORES[t], id);
          applied += 1;
        }
        // entries 暂不在本地库，先跳过
      }
    } finally {
      db.close();
    }
    log("applied deletes to IndexedDB:", applied, "/", deletes.length);
    // [V25-0 ACK] best-effort: tell cloud we applied deletes locally (for applied_count stats)
if (applied > 0) {    
try {
  const adminToken =
    (typeof window !== "undefined" && window.ADMIN_SYNC_TOKEN) ||
    (typeof ADMIN_SYNC_TOKEN !== "undefined" ? ADMIN_SYNC_TOKEN : "") ||
    (localStorage.getItem("ADMIN_SYNC_TOKEN") || "");

  fetch("/api/sync/ack_deletes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deletes: (Array.isArray(deletes) ? deletes : []).map(d => ({
        table_name: d.table_name,
        row_id: d.row_id
      })),
      source: (localStorage.getItem("SYNC_DEVICE_ID") || ""),
      admin_token: adminToken
    })
  })
    .then(async (r) => {
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
})
.then(({ status, j }) => console.log("[SYNC][ACK] status=", status, "ok=", j?.ok, "updated=", j?.updated))

    .catch(e => console.warn("[SYNC][ACK] ignored error:", e));
} catch (e) {
  console.warn("[SYNC][ACK] ignored error:", e);
}
} // <-- 这行必须有  
    return { ok:true, applied, deletes: deletes.length };
  }

  function status(){
    return {
      db: DB_NAME,
      stores: STORES,
      tokenPresent: !!getToken(),
      pendingDeletes: loadDeletes().length,
      lastDeletesPull: localStorage.getItem(LS.LAST_DELETES_PULL),
    };
  }

  window.SyncClientV24 = { addDelete, pushDeletes, pullAndApplyDeletes, status };
  log("SyncClientV24 ready. Try: SyncClientV24.status()");
})();
