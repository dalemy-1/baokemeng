/* admin_v31.2 hotfix: ensure filtered global */
var filtered = window.filtered || [];
window.filtered = filtered;

import { openDB, getAll, put, getByKey } from './state.js';

const DB = { name: 'act_acc_v199', version: 1, stores: { accounts: { keyPath:'account' }, activities: { keyPath:'id' } } };

const $ = (id)=>document.getElementById(id);

let db;
let accounts = [];
let activities = [];
let currentOriginal = null;
let currentDraft = null;
let editing = false;

function setStatus(text, kind=''){
  const el = $('kpiStatus');
  el.textContent = text;
  el.className = 'pill' + (kind==='ok' ? ' ok' : kind==='bad' ? ' bad' : '');
}

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function fmtIso(s){
  if(!s) return '—';
  try{
    const d = new Date(s);
    if(Number.isNaN(d.getTime())) return String(s);
    return d.toISOString().slice(0,19).replace('T',' ');
  }catch{ return String(s); }
}

function filterRows(q){
  q = (q||'').trim().toLowerCase();
  if(!q) return accounts;
  return accounts.filter(a=>{
    const hay = [a.account, a.tags, a.status, a.activity_name].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderTable(){
  const tb = $('tbody');
  tb.innerHTML = '';

  const rows = filtered;
  for(const a of rows){
    const tr = document.createElement('tr');

    const tdSel = document.createElement('td');
    tdSel.className = 'sel';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.setAttribute('data-sel','1');
    chk.checked = selectedAccounts.has(a.account);
    chk.addEventListener('change', ()=>{
      if(chk.checked) selectedAccounts.add(a.account);
      else selectedAccounts.delete(a.account);
    });
    tdSel.appendChild(chk);
    tr.appendChild(tdSel);

    const tdA = document.createElement('td');
    tdA.innerHTML = `<a href="#" class="link" data-account="${esc(a.account)}">${esc(a.account)}</a>`;
    tr.appendChild(tdA);

    const tdTag = document.createElement('td');
    tdTag.textContent = a.tags || '';
    tr.appendChild(tdTag);

    const tdAct = document.createElement('td');
    tdAct.textContent = a.apply_activity || '';
    tr.appendChild(tdAct);

    const tdWin = document.createElement('td');
    tdWin.textContent = normYesNo(a.win)==='yes' ? '中签' : '';
    tr.appendChild(tdWin);

    const tdPaid = document.createElement('td');
    tdPaid.textContent = normYesNo(a.paid)==='yes' ? '已付款' : '';
    tr.appendChild(tdPaid);

    const tdStatus = document.createElement('td');
    tdStatus.textContent = a.status || '';
    tr.appendChild(tdStatus);

    const tdU = document.createElement('td');
    tdU.textContent = (a.updated_at || '').slice(0,19).replace('T',' ');
    tr.appendChild(tdU);

    tb.appendChild(tr);
  }

  tb.querySelectorAll('a[data-account]').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      openModalByAccount(a.getAttribute('data-account'));
    });
  });

  $('listInfo').textContent = `(显示 ${rows.length} / ${accounts.length})`;
}

function renderForm(acc, mode='view'){
    const fields = [
    // 核心
    { k:'account', label:'账户（主键）', ro:true },
    { k:'pwd', label:'密码', ro:false },

    // 报名与状态（用于列表筛选/批量标记）
    { k:'apply_activity', label:'活动报名', ro:false, placeholder:'例如：活动A / 2026-01-xx' },
    { k:'win', label:'中签（yes/no）', ro:false, placeholder:'yes 或 no' },
    { k:'paid', label:'已付款（yes/no）', ro:false, placeholder:'yes 或 no' },
    { k:'tags', label:'标签', ro:false, placeholder:'例如：爱伪装1 / 黑名单 / 备注' },

    // 联系与地址
    { k:'aux_email', label:'辅助邮箱', ro:false },
    { k:'aux_pwd', label:'辅助邮箱密码', ro:false },
    { k:'phone', label:'电话号码', ro:false },
    { k:'zip', label:'邮编', ro:false },
    { k:'addr_city', label:'地址县市', ro:false },
    { k:'addr_line', label:'地址门牌', ro:false },

    // 个人信息
    { k:'name_kanji', label:'汉字名', ro:false },
    { k:'name_kana', label:'日语名', ro:false },

    // 卡信息（注意：仅用于内部管理；建议后续迁移到更安全的存储）
    { k:'card_name', label:'卡名', ro:false },
    { k:'card_no', label:'信用卡', ro:false },
    { k:'card_cvv', label:'CVV', ro:false },
    { k:'card_exp', label:'有效期', ro:false },
    { k:'birth_ym', label:'出生年月', ro:false },

    // 备注
    { k:'note1', label:'备注1', ro:false },
    { k:'note2', label:'备注2', ro:false },
    { k:'note3', label:'备注3', ro:false },
    { k:'note4', label:'备注4', ro:false },
  ];

  if(mode==='edit'){
    return fields.map(f=>{
      const v = acc?.[f.k] ?? '';
      const dis = f.ro ? 'disabled' : '';
      const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
      return `<div class="field">
        <label>${esc(f.label)}</label>
        <input class="input" data-k="${esc(f.k)}" value="${esc(v)}" ${dis} ${ph}/>
      </div>`;
    }).join('');
  }

  return fields.map(f=>{
    const v = acc?.[f.k];
    const shown = (v===undefined || v===null || String(v).trim()==='') ? '<span class="roval roempty">—</span>' : `<span class="roval">${esc(v)}</span>`;
    return `<div class="field">
      <label>${esc(f.label)}</label>
      <div class="robox" data-k="${esc(f.k)}">${shown}</div>
    </div>`;
  }).join('');
}

function setEditing(on){
  editing = on;
  $('btnSave').disabled = !on;
  $('btnCancel').disabled = !on;
  $('btnEdit').disabled = on;

  if(currentDraft){
    $('form').innerHTML = renderForm(currentDraft, on ? 'edit' : 'view');
  }

  $('saveHint').textContent = on
    ? '编辑模式：修改后点击【保存】写回 IndexedDB（accounts store）。'
    : '只读模式：点击【编辑】进入可修改状态。';
}

function openModalByAccount(account){
  const acc = accounts.find(x=>x && x.account===account);
  if(!acc){ alert('未找到账号：' + account); return; }
  currentOriginal = acc;
  currentDraft = structuredClone(acc);
  $('mSub').textContent = `account = ${account}`;
  $('form').innerHTML = renderForm(currentDraft, 'view');
  $('backdrop').style.display = 'flex';
  setEditing(false);
}

function closeModal(){
  $('backdrop').style.display = 'none';
  currentOriginal = null;
  currentDraft = null;
}

function collectDraft(){
  const d = structuredClone(currentDraft || {});
  if(editing){
    document.querySelectorAll('#form input').forEach(inp=>{
      const k = inp.getAttribute('data-k');
      d[k] = inp.value;
    });
  }
  const now = new Date().toISOString();
  if(!d.created_at) d.created_at = currentOriginal?.created_at || now;
  d.updated_at = now;
  return d;
}

async function save(){
  try{
    if(!db) throw new Error('db_not_ready');
    const draft = collectDraft();
    if(!draft.account) throw new Error('missing_account_key');
    await put(db, 'accounts', draft);
    // refresh single row in memory
    const fresh = await getByKey(db, 'accounts', draft.account);
    const idx = accounts.findIndex(a=>a.account===draft.account);
    if(idx>=0) accounts[idx] = fresh || draft;
    renderTable();
    currentOriginal = fresh || draft;
    currentDraft = structuredClone(currentOriginal);
    setEditing(false);
    alert('保存成功：已写回 IndexedDB，并刷新列表。');
  }catch(e){
    console.error(e);
    alert('保存失败：' + (e?.message || String(e)));
  }
}

async function load(){
  setStatus('连接 IndexedDB…');
  db = await openDB(DB.name, DB.version, DB.stores);
  $('dbInfo').textContent = `DB=${DB.name} v${DB.version}`;
  accounts = await getAll(db, 'accounts');
  try{ activities = await getAll(db, 'activities'); }catch{ activities = []; }
  $('kpiAccounts').textContent = String(accounts.length);
  $('kpiActivities').textContent = String(activities.length);
  setStatus('就绪', 'ok');
  renderTable();
}

function download(filename, text){
  const blob = new Blob([text], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


async function importJsonText(text){
  let data;
  try{ data = JSON.parse(text); }catch{ throw new Error('json_parse_failed'); }
  let list = [];
  if(Array.isArray(data)) list = data;
  else if(Array.isArray(data.accounts)) list = data.accounts;
  else throw new Error('invalid_format_need_accounts_array');

  // basic normalize
  const now = new Date().toISOString();
  const cleaned = [];
  for(const raw of list){
    const a = raw && typeof raw === 'object' ? raw : null;
    if(!a) continue;
    const account = String(a.account || '').trim();
    if(!account) continue;
    const obj = { ...a, account };
    if(!obj.created_at) obj.created_at = now;
    obj.updated_at = now;
    cleaned.push(obj);
  }
  if(cleaned.length===0) throw new Error('no_valid_accounts');

  // write
  for(const a of cleaned){
    await put(db, 'accounts', a);
  }
  return cleaned.length;
}

function makeTestAccount(){
  const rand = Math.random().toString(16).slice(2,8);
  const now = new Date().toISOString();
  return {
    account: `test_${rand}@example.com`,
    pwd: '123456',
    tags: 'test',
    status: '正常',
    created_at: now,
    updated_at: now
  };
}

function normYesNo(v){
  const s = String(v ?? '').trim().toLowerCase();
  if(['1','y','yes','true','是','中签','已中签','paid','已付款'].includes(s)) return 'yes';
  if(['0','n','no','false','否','未中签','未付款'].includes(s)) return 'no';
  return '';
}

function toCsv(rows, cols){
  const escCsv = (x)=>{
    const s = x===undefined || x===null ? '' : String(x);
    if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const header = cols.map(c=>escCsv(c.label)).join(',');
  const lines = rows.map(r=> cols.map(c=>escCsv(r[c.key])).join(','));
  return [header, ...lines].join('\n');
}

function downloadText(filename, text, mime='text/plain;charset=utf-8'){
  const blob = new Blob([text], {type:mime});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}


function extractAccountsFromText(text){
  const out = new Set();
  const raw = String(text||'');
  const parts = raw.split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean);
  for(const p of parts){
    const m = p.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if(m) out.add(m[0].toLowerCase());
    else out.add(p.toLowerCase());
  }
  return Array.from(out);
}

function syncSelectionCheckboxes(){
  document.querySelectorAll('input[data-sel]').forEach(chk=>{
    const tr = chk.closest('tr');
    if(!tr) return;
    const link = tr.querySelector('a[data-account]');
    const acc = link ? link.getAttribute('data-account') : null;
    if(!acc) return;
    chk.checked = selectedAccounts.has(acc);
  });
  const chkAll = $('chkAll');
  if(chkAll){
    chkAll.checked = filtered.length>0 && filtered.every(a=>selectedAccounts.has(a.account));
  }
}

let selectedAccounts = new Set();

function getSelectedList(){ return Array.from(selectedAccounts); }

function clearSelection(){
  selectedAccounts = new Set();
  const chkAll = document.getElementById('chkAll');
  if(chkAll) chkAll.checked = false;
  document.querySelectorAll('input[data-sel]').forEach(x=> x.checked=false);
}

function applyFilters(){
  const q = ($('q')?.value || '').trim().toLowerCase();
  const fActivity = ($('fActivity')?.value || '').trim().toLowerCase();
  const fTag = ($('fTag')?.value || '').trim().toLowerCase();
  const fWin = $('fWin')?.value || '';
  const fPaid = $('fPaid')?.value || '';

  filtered = accounts.filter(a=>{
    const hay = [a.account,a.tags,a.status,a.apply_activity,a.phone,a.aux_email].map(x=>String(x||'').toLowerCase()).join(' ');
    if(q && !hay.includes(q)) return false;
    if(fTag && !String(a.tags||'').toLowerCase().includes(fTag)) return false;
    if(fActivity && !String(a.apply_activity||'').toLowerCase().includes(fActivity)) return false;

    const win = normYesNo(a.win);
    const paid = normYesNo(a.paid);
    if(fWin==='yes' && win!=='yes') return false;
    if(fWin==='no' && win==='yes') return false;
    if(fPaid==='yes' && paid!=='yes') return false;
    if(fPaid==='no' && paid==='yes') return false;
    return true;
  });

  window.filtered = filtered;
  renderTable();
  updateCounts();
  clearSelection();
}


// events
document.addEventListener('click', (e)=>{
  const a = e.target?.closest?.('a[data-open]');
  if(a){
    e.preventDefault();
    openModalByAccount(a.getAttribute('data-open'));
  }
});

$('q').addEventListener('input', ()=> applyFilters());
$('btnReload').addEventListener('click', ()=>load().catch(err=>{ console.error(err); setStatus('加载失败','bad'); alert(String(err?.message||err)); }));

$('btnImportJson').addEventListener('click', ()=> $('fileJson').click());
$('fileJson').addEventListener('change', async (e)=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  try{
    const text = await file.text();
    const n = await importJsonText(text);
    await load();
    alert(`导入成功：写入 ${n} 条账号到 IndexedDB。`);
  }catch(err){
    console.error(err);
    alert('导入失败：' + (err?.message || String(err)));
  }
});

$('btnAddTest').addEventListener('click', async ()=>{
  try{
    if(!db) throw new Error('db_not_ready');
    const a = makeTestAccount();
    await put(db, 'accounts', a);
    await load();
    alert('已新增测试账号：' + a.account);
  }catch(err){
    console.error(err);
    alert('新增失败：' + (err?.message || String(err)));
  }
});



$('btnApplyFilters').addEventListener('click', ()=> applyFilters());
$('btnClearFilters').addEventListener('click', ()=>{
  $('fActivity').value=''; $('fWin').value=''; $('fPaid').value=''; $('fTag').value='';
  applyFilters();
});

$('chkAll').addEventListener('change', ()=>{
  const on = $('chkAll').checked;
  selectedAccounts = new Set();
  if(on){
    for(const a of filtered) selectedAccounts.add(a.account);
  }
  document.querySelectorAll('input[data-sel]').forEach(x=> x.checked=on);
});

async function batchUpdate(mutator){
  const list = getSelectedList();
  if(list.length===0) return alert('请先勾选账号（批量操作）。');
  const now = new Date().toISOString();
  let changed = 0;
  for(const accId of list){
    const a = accounts.find(x=>x.account===accId);
    if(!a) continue;
    const next = {...a};
    mutator(next);
    next.updated_at = now;
    await put(db, 'accounts', next);
    Object.assign(a, next);
    changed++;
  }
  applyFilters();
  alert(`批量操作完成：已写回 ${changed} 条账号。`);
}

$('btnBatchApply').addEventListener('click', async ()=>{
  const act = ($('fActivity').value || '').trim();
  if(!act) return alert('请先在“活动报名”输入框填写活动名（用于批量报名）。');
  await batchUpdate((a)=>{ a.apply_activity = act; });
});

$('btnBatchWin').addEventListener('click', async ()=>{ await batchUpdate((a)=>{ a.win = 'yes'; }); });
$('btnBatchPaid').addEventListener('click', async ()=>{ await batchUpdate((a)=>{ a.paid = 'yes'; }); });
$('btnBatchClear').addEventListener('click', async ()=>{ await batchUpdate((a)=>{ a.win=''; a.paid=''; }); });


$('btnParseSelect').addEventListener('click', ()=>{
  const text = $('parseInput').value || '';
  const tokens = extractAccountsFromText(text);
  if(tokens.length===0) return alert('没有可解析的账号/邮箱。');
  const map = new Map();
  for(const a of accounts) map.set(String(a.account||'').toLowerCase(), a);
  let hit = 0;
  for(const t of tokens){
    if(map.has(t)){
      selectedAccounts.add(t);
      hit++;
    }
  }
  if(hit===0){
    alert('未匹配到账号库中的 account。请确认粘贴的是“账户”列（邮箱）。');
  }else{
    syncSelectionCheckboxes();
    alert(`已匹配并勾选：${hit} 个账号（共解析 ${tokens.length} 个 token）。`);
  }
});

$('btnParseClear').addEventListener('click', ()=>{ $('parseInput').value=''; });

$('btnExportCsv').addEventListener('click', ()=>{
  const rows = filtered.map(a=>({...a, win:normYesNo(a.win), paid:normYesNo(a.paid)}));
  const cols = [
    {key:'apply_activity', label:'活动报名'},
    {key:'tags', label:'标签'},
    {key:'account', label:'账户'},
    {key:'pwd', label:'密码'},
    {key:'aux_email', label:'辅助邮箱'},
    {key:'aux_pwd', label:'辅助邮箱密码'},
    {key:'phone', label:'电话号码'},
    {key:'zip', label:'邮编'},
    {key:'addr_city', label:'地址县市'},
    {key:'addr_line', label:'地址门牌'},
    {key:'name_kanji', label:'汉字名'},
    {key:'name_kana', label:'日语名'},
    {key:'card_name', label:'卡名'},
    {key:'card_no', label:'信用卡'},
    {key:'card_cvv', label:'CVV'},
    {key:'card_exp', label:'有效期'},
    {key:'birth_ym', label:'出生年月'},
    {key:'note1', label:'备注1'},
    {key:'note2', label:'备注2'},
    {key:'note3', label:'备注3'},
    {key:'note4', label:'备注4'},
    {key:'win', label:'中签'},
    {key:'paid', label:'已付款'},
    {key:'status', label:'状态'},
    {key:'updated_at', label:'更新时间'},
  ];
  const csv = toCsv(rows, cols);
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  downloadText(`accounts_export_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
});

$('btnExportJson').addEventListener('click', ()=>{
  const payload = { exported_at: new Date().toISOString(), db: DB.name, accounts };
  download(`accounts_export_${Date.now()}.json`, JSON.stringify(payload, null, 2));
});

$('btnClose').addEventListener('click', closeModal);
$('backdrop').addEventListener('click', (e)=>{ if(e.target===$('backdrop')) closeModal(); });

$('btnEdit').addEventListener('click', ()=>{
  if(!currentOriginal) return;
  setEditing(true);
});

$('btnCancel').addEventListener('click', ()=>{
  if(!currentOriginal) return;
  currentDraft = structuredClone(currentOriginal);
  setEditing(false);
});
$('btnSave').addEventListener('click', save);

// boot
load().catch(err=>{ console.error(err); setStatus('加载失败','bad'); alert('初始化失败：'+(err?.message||String(err))); });
