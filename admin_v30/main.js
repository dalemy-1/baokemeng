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
  const q = $('q').value || '';
  const rows = filterRows(q);
  $('listInfo').textContent = `（显示 ${rows.length} / ${accounts.length}）`;
  const tb = $('tbody');
  if(rows.length===0){
    tb.innerHTML = `<tr><td colspan="4" class="muted">无匹配结果</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(a=>{
    return `<tr>
      <td><a class="link" data-open="${esc(a.account||'')}">${esc(a.account||'')}</a></td>
      <td>${a.tags?esc(a.tags):'<span class="muted">—</span>'}</td>
      <td>${a.status?esc(a.status):'<span class="muted">—</span>'}</td>
      <td>${esc(fmtIso(a.updated_at || a.created_at))}</td>
    </tr>`;
  }).join('');
}

function renderForm(acc, mode='view'){
  const fields = [
    { k:'account', label:'账号（主键）', ro:true },
    { k:'pwd', label:'密码', ro:false },
    { k:'aux_email', label:'辅助邮箱', ro:false },
    { k:'aux_pwd', label:'辅助邮箱密码', ro:false },
    { k:'phone', label:'手机号', ro:false },
    { k:'tags', label:'标签', ro:false, placeholder:'例如：A类 / 黑名单 / 备注' },
    { k:'status', label:'状态', ro:false, placeholder:'例如：正常 / 异常 / 已停用' },
    { k:'activity_name', label:'当前活动名（可选）', ro:false },
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

// events
document.addEventListener('click', (e)=>{
  const a = e.target?.closest?.('a[data-open]');
  if(a){
    e.preventDefault();
    openModalByAccount(a.getAttribute('data-open'));
  }
});

$('q').addEventListener('input', ()=>renderTable());
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
