
import { nowIso, uid, idbGetAll, idbGet, idbPut, idbDelete, idbBulkPut, idbClear, exportAll, importAll, saveSnapshot, listSnapshots, loadSnapshot } from './db.js';

const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));

const els = {
  dbBadge: $('#dbBadge'),
  kpiAccounts: $('#kpiAccounts'),
  kpiActivities: $('#kpiActivities'),
  currentActivitySelect: $('#currentActivitySelect'),

  navAccounts: $('#navAccounts'),
  navActivities: $('#navActivities'),
  navSafety: $('#navSafety'),

  panelAccounts: $('#panelAccounts'),
  panelActivities: $('#panelActivities'),
  panelSafety: $('#panelSafety'),

  btnAddAccount: $('#btnAddAccount'),
  btnReload: $('#btnReload'),
  btnApplyFilters: $('#btnApplyFilters'),
  btnClearFilters: $('#btnClearFilters'),
  q: $('#q'),
  qTag: $('#qTag'),
  fStatus: $('#fStatus'),
  fEnrolled: $('#fEnrolled'),
  fWinner: $('#fWinner'),
  fPaid: $('#fPaid'),
  filteredCount: $('#filteredCount'),

  parseBox: $('#parseBox'),
  btnParseSelect: $('#btnParseSelect'),
  btnParseClear: $('#btnParseClear'),

  ckAll: $('#ckAll'),
  tbAccounts: $('#tbAccounts'),
  selHint: $('#selHint'),

  btnBatchEnroll: $('#btnBatchEnroll'),
  btnBatchWinner: $('#btnBatchWinner'),
  btnBatchPaid: $('#btnBatchPaid'),
  btnBatchUnEnroll: $('#btnBatchUnEnroll'),
  btnBatchUnWinner: $('#btnBatchUnWinner'),
  btnBatchUnPaid: $('#btnBatchUnPaid'),

  btnExportFilteredCsv: $('#btnExportFilteredCsv'),
  btnExportSelectedCsv: $('#btnExportSelectedCsv'),

  btnSaveSnapshot: $('#btnSaveSnapshot'),
  btnExportAll: $('#btnExportAll'),
  btnExportAll2: $('#btnExportAll2'),
  btnImport: $('#btnImport'),
  btnImport2: $('#btnImport2'),
  fileInput: $('#fileInput'),

  // activities
  tbActivities: $('#tbActivities'),
  btnAddActivity: $('#btnAddActivity'),

  // safety
  btnMakeSnap: $('#btnMakeSnap'),
  btnClearAll: $('#btnClearAll'),
  tbSnaps: $('#tbSnaps'),

  // modal
  modalOverlay: $('#modalOverlay'),
  mTitle: $('#mTitle'),
  mSub: $('#mSub'),
  mBody: $('#mBody'),
  mClose: $('#mClose'),
  mEdit: $('#mEdit'),
  mSave: $('#mSave'),
  mCancel: $('#mCancel'),
};

const HEADERS_CN = [
  '活动报名','标签','账户','密码','辅助邮箱','密码','电话号码','邮编','地址县市','地址门牌',
  '汉字名','日语名','卡名','信用卡','CVV','有效期','出生年月','备注1','备注2','备注3','备注4'
];

const ACCOUNT_FIELDS = [
  ['enrolled_name','活动报名'],   // derived from current activity in export; keep for csv format
  ['tag','标签'],
  ['account','账户'],
  ['password','密码'],
  ['aux_email','辅助邮箱'],
  ['aux_password','密码2'],
  ['phone','电话号码'],
  ['zipcode','邮编'],
  ['addr_city','地址县市'],
  ['addr_line','地址门牌'],
  ['name_cn','汉字名'],
  ['name_jp','日语名'],
  ['card_name','卡名'],
  ['card_number','信用卡'],
  ['cvv','CVV'],
  ['card_exp','有效期'],
  ['birth_ym','出生年月'],
  ['note1','备注1'],
  ['note2','备注2'],
  ['note3','备注3'],
  ['note4','备注4'],
];

// In-memory state
let state = {
  accounts: [],
  activities: [],
  enrollments: [],
  filtered: [],
  selectedIds: new Set(),
  currentActivityId: null,
  modal: { id: null, editing:false, orig:null },
};

function setBadge(ok, text){
  els.dbBadge.innerHTML = `<span class="dot ${ok?'good':'bad'}"></span><span>${escapeHtml(text)}</span>`;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(msg){
  alert(msg);
}

function normalizePhone(s){
  const d = String(s||'').replace(/\D+/g,'');
  return d;
}

function parseTokens(text){
  const t = String(text||'');
  const emails = new Set((t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []).map(x=>x.toLowerCase()));
  const nums = new Set((t.match(/\d{6,}/g) || []).map(x=>x));
  // also allow raw account string tokens (like abc@xxx) already covered
  return { emails, nums };
}

function getCurrentActivity(){
  if(!state.currentActivityId) return null;
  return state.activities.find(a=>a.id===state.currentActivityId) || null;
}

function enrId(activityId, accountId){
  return `${activityId}|${accountId}`;
}

function findEnrollment(activityId, accountId){
  const id = enrId(activityId, accountId);
  return state.enrollments.find(e=>e.id===id) || null;
}

function ensureEnrollment(activityId, accountId){
  const id = enrId(activityId, accountId);
  let e = state.enrollments.find(x=>x.id===id);
  if(!e){
    e = { id, activityId, accountId, enrolled:false, winner:false, paid:false, updated_at: nowIso() };
    state.enrollments.push(e);
  }
  return e;
}

function enrollmentStats(activityId){
  const rows = state.enrollments.filter(e=>e.activityId===activityId);
  const enrolled = rows.filter(e=>e.enrolled).length;
  const winner = rows.filter(e=>e.winner).length;
  const paid = rows.filter(e=>e.paid).length;
  return { enrolled, winner, paid };
}

async function loadAll(){
  try{
    setBadge(true,'加载中…');
    const [accounts, activities, enrollments] = await Promise.all([
      idbGetAll('accounts'),
      idbGetAll('activities'),
      idbGetAll('enrollments'),
    ]);
    // Sort
    accounts.sort((a,b)=> (b.updated_at||'').localeCompare(a.updated_at||''));
    activities.sort((a,b)=> (b.created_at||'').localeCompare(a.created_at||''));
    enrollments.sort((a,b)=> (b.updated_at||'').localeCompare(a.updated_at||''));

    state.accounts = accounts;
    state.activities = activities;
    state.enrollments = enrollments;

    // default current activity
    if(!state.currentActivityId && activities[0]) state.currentActivityId = activities[0].id;
    if(state.currentActivityId && !activities.find(a=>a.id===state.currentActivityId)){
      state.currentActivityId = activities[0]?.id || null;
    }

    rebuildActivitySelect();
    applyFilters();
    renderActivities();
    await renderSnapshots();

    els.kpiAccounts.textContent = String(state.accounts.length);
    els.kpiActivities.textContent = String(state.activities.length);

    setBadge(true,'就绪（本地库）');
  }catch(e){
    console.error(e);
    setBadge(false,'初始化失败');
    toast('初始化失败：' + (e?.message || e));
  }
}

function rebuildActivitySelect(){
  const sel = els.currentActivitySelect;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— 请选择活动（用于批量操作/筛选）—';
  sel.appendChild(opt0);
  for(const a of state.activities){
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  sel.value = state.currentActivityId || '';
}

function applyFilters(){
  const q = (els.q.value || '').trim().toLowerCase();
  const tagNeed = (els.qTag.value||'').trim().toLowerCase().split(/\s+/).filter(Boolean);

  const fStatus = els.fStatus.value;
  const fEnrolled = els.fEnrolled.value;
  const fWinner = els.fWinner.value;
  const fPaid = els.fPaid.value;

  const act = getCurrentActivity();
  const actId = act?.id || null;

  let rows = state.accounts.slice();

  if(q){
    rows = rows.filter(a=>{
      const hay = [
        a.account, a.tag, a.status, a.phone, a.note1,a.note2,a.note3,a.note4, a.aux_email
      ].map(x=>String(x||'').toLowerCase()).join(' | ');
      return hay.includes(q);
    });
  }
  if(tagNeed.length){
    rows = rows.filter(a=>{
      const t = String(a.tag||'').toLowerCase();
      return tagNeed.every(k=>t.includes(k));
    });
  }
  if(fStatus !== 'all'){
    rows = rows.filter(a => String(a.status||'') === fStatus);
  }

  // activity-based filters only apply when activity selected
  if(actId){
    if(fEnrolled !== 'all'){
      rows = rows.filter(a=>{
        const e = findEnrollment(actId, a.id);
        const v = !!(e && e.enrolled);
        return (fEnrolled==='yes') ? v : !v;
      });
    }
    if(fWinner !== 'all'){
      rows = rows.filter(a=>{
        const e = findEnrollment(actId, a.id);
        const v = !!(e && e.winner);
        return (fWinner==='yes') ? v : !v;
      });
    }
    if(fPaid !== 'all'){
      rows = rows.filter(a=>{
        const e = findEnrollment(actId, a.id);
        const v = !!(e && e.paid);
        return (fPaid==='yes') ? v : !v;
      });
    }
  }

  state.filtered = rows;
  els.filteredCount.textContent = `筛选后：${rows.length}`;

  // Clean selection if records not in filtered
  const setFilteredIds = new Set(rows.map(x=>x.id));
  for(const id of Array.from(state.selectedIds)){
    if(!setFilteredIds.has(id)) state.selectedIds.delete(id);
  }
  renderAccounts();
}

function renderAccounts(){
  const act = getCurrentActivity();
  const actId = act?.id || null;

  const rows = state.filtered;
  els.tbAccounts.innerHTML = '';
  for(const a of rows){
    const e = actId ? findEnrollment(actId, a.id) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="ckRow" data-id="${a.id}" ${state.selectedIds.has(a.id)?'checked':''}></td>
      <td class="mono"><a href="#" class="openAcc" data-id="${a.id}">${escapeHtml(a.account||'')}</a></td>
      <td>${escapeHtml(a.tag||'')}</td>
      <td>${actId ? (e?.enrolled ? '已报名' : '—') : '—'}</td>
      <td>${actId ? (e?.winner ? '中签' : '—') : '—'}</td>
      <td>${actId ? (e?.paid ? '已付款' : '—') : '—'}</td>
      <td>${escapeHtml(a.status||'')}</td>
      <td class="small muted">${escapeHtml(a.updated_at||'')}</td>
    `;
    els.tbAccounts.appendChild(tr);
  }

  // header checkbox
  const allIds = rows.map(r=>r.id);
  const allChecked = allIds.length>0 && allIds.every(id=>state.selectedIds.has(id));
  els.ckAll.checked = allChecked;

  updateSelHint();
}

function updateSelHint(){
  els.selHint.textContent = `已勾选：${state.selectedIds.size}`;
}

function showPanel(which){
  els.panelAccounts.style.display = (which==='accounts') ? '' : 'none';
  els.panelActivities.style.display = (which==='activities') ? '' : 'none';
  els.panelSafety.style.display = (which==='safety') ? '' : 'none';
}

function csvEscape(v){
  const s = String(v ?? '');
  if(/[,"\n\r]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function download(filename, content, mime='application/octet-stream'){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}

function buildCsvForAccounts(accounts, activityId){
  const act = activityId ? state.activities.find(a=>a.id===activityId) : null;
  const actName = act?.name || '';

  const header = HEADERS_CN.join(',');
  const lines = [header];

  for(const a of accounts){
    const e = activityId ? findEnrollment(activityId, a.id) : null;
    const enrolledName = (e && e.enrolled) ? actName : '';
    const row = [
      enrolledName,
      a.tag||'',
      a.account||'',
      a.password||'',
      a.aux_email||'',
      a.aux_password||'',
      a.phone||'',
      a.zipcode||'',
      a.addr_city||'',
      a.addr_line||'',
      a.name_cn||'',
      a.name_jp||'',
      a.card_name||'',
      a.card_number||'',
      a.cvv||'',
      a.card_exp||'',
      a.birth_ym||'',
      a.note1||'',
      a.note2||'',
      a.note3||'',
      a.note4||'',
    ].map(csvEscape).join(',');
    lines.push(row);
  }
  return lines.join('\n');
}

async function exportAllJson(){
  const payload = await exportAll();
  download(`act_acc_v40_backup_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

async function openImport(){
  els.fileInput.value = '';
  els.fileInput.click();
}

async function onImportFile(file){
  const txt = await file.text();
  const payload = JSON.parse(txt);
  await importAll(payload);
  toast('导入完成（已合并写入本地库）。建议立刻“重新加载”。');
  await loadAll();
}

function ensureActivitySelected(){
  const act = getCurrentActivity();
  if(!act) { toast('请先在左侧选择一个“当前活动”。'); return null; }
  return act;
}

async function batchSetFlags({enrolled, winner, paid}){
  const act = ensureActivitySelected();
  if(!act) return;
  const ids = Array.from(state.selectedIds);
  if(!ids.length){ toast('请先勾选账号。'); return; }

  const updates = [];
  for(const id of ids){
    const e = ensureEnrollment(act.id, id);
    if(enrolled !== undefined) e.enrolled = enrolled;
    if(winner !== undefined) e.winner = winner;
    if(paid !== undefined) e.paid = paid;
    e.updated_at = nowIso();
    updates.push(e);
  }
  await idbBulkPut('enrollments', updates);
  await saveSnapshot('batch flags');
  await loadAll();
  toast(`已批量更新：${ids.length} 个账号（活动：${act.name}）。`);
}

function parseAndSelect(){
  const { emails, nums } = parseTokens(els.parseBox.value);
  let hit = 0;
  const inFiltered = new Set(state.filtered.map(a=>a.id));
  for(const a of state.accounts){
    const em = String(a.account||'').toLowerCase();
    const phone = normalizePhone(a.phone||'');
    if(emails.has(em) || (phone && nums.has(phone))){
      // prefer to select within filtered; but allow select anyway
      if(inFiltered.has(a.id) || state.filtered.length===0){
        state.selectedIds.add(a.id);
      }else{
        state.selectedIds.add(a.id);
      }
      hit++;
    }
  }
  renderAccounts();
  toast(`解析完成：命中 ${hit} 个账号（已自动勾选）。`);
}

function modalOpen(accountId){
  const a = state.accounts.find(x=>x.id===accountId);
  if(!a) return;
  state.modal.id = accountId;
  state.modal.orig = JSON.parse(JSON.stringify(a));
  state.modal.editing = false;

  els.mTitle.textContent = '账号详情';
  els.mSub.textContent = a.account || '';
  els.mBody.innerHTML = renderAccountForm(a, false);
  els.modalOverlay.classList.add('show');

  updateModalButtons();
}

function modalClose(){
  els.modalOverlay.classList.remove('show');
  state.modal = { id:null, editing:false, orig:null };
}

function updateModalButtons(){
  const editing = state.modal.editing;
  els.mEdit.style.display = editing ? 'none' : '';
  els.mSave.disabled = !editing;
  // cancel always enabled
}

function renderAccountForm(a, editable){
  const ro = editable ? '' : 'readonly';
  const dis = editable ? '' : 'disabled';
  const v = (x)=>escapeHtml(x ?? '');
  const field = (label, name, value, placeholder='—', type='text') => `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" data-field="${name}" value="${v(value)}" placeholder="${escapeHtml(placeholder)}" ${ro}>
    </div>
  `;
  const sel = (label, name, value, options) => {
    const opts = options.map(o=>`<option value="${escapeHtml(o)}" ${String(value||'')===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return `
      <div class="field">
        <label>${label}</label>
        <select data-field="${name}" ${dis}>
          <option value="">—</option>
          ${opts}
        </select>
      </div>
    `;
  };

  return `
    <div class="split">
      ${field('账户（主键）','account',a.account,'例如：001@dalemy.top')}
      ${field('密码','password',a.password)}
      ${field('辅助邮箱','aux_email',a.aux_email)}
      ${field('辅助邮箱密码','aux_password',a.aux_password)}
      ${field('电话号码','phone',a.phone)}
      ${field('邮编','zipcode',a.zipcode)}
      ${field('地址县市','addr_city',a.addr_city)}
      ${field('地址门牌','addr_line',a.addr_line)}
      ${field('汉字名','name_cn',a.name_cn)}
      ${field('日语名','name_jp',a.name_jp)}
      ${field('卡名','card_name',a.card_name)}
      ${field('信用卡','card_number',a.card_number)}
      ${field('CVV','cvv',a.cvv)}
      ${field('有效期','card_exp',a.card_exp,'例如：12/29')}
      ${field('出生年月','birth_ym',a.birth_ym,'例如：1998-07')}
      ${field('备注1','note1',a.note1)}
      ${field('备注2','note2',a.note2)}
      ${field('备注3','note3',a.note3)}
      ${field('备注4','note4',a.note4)}
      ${field('标签','tag',a.tag,'例如：爱伪装1')}
      ${sel('状态','status',a.status,['正常','异常','已停用'])}
    </div>
    <div class="hr"></div>
    <div class="help">提示：活动报名/中奖/已付款属于“活动维度”，不放在账号字段里；在列表批量操作中完成。</div>
  `;
}

function collectModalForm(){
  const root = els.mBody;
  const inputs = $$('#modalOverlay [data-field]');
  const patch = {};
  for(const el of inputs){
    const k = el.getAttribute('data-field');
    patch[k] = el.value;
  }
  return patch;
}

async function modalSave(){
  const id = state.modal.id;
  const a = state.accounts.find(x=>x.id===id);
  if(!a) return;

  const patch = collectModalForm();
  const next = { ...a, ...patch, updated_at: nowIso() };

  // ensure account unique
  const want = String(next.account||'').trim().toLowerCase();
  if(!want){ toast('账户不能为空'); return; }
  // check duplicates
  const dup = state.accounts.find(x=>x.id!==id && String(x.account||'').trim().toLowerCase()===want);
  if(dup){ toast('账户已存在，不能重复。'); return; }

  next.account = String(next.account||'').trim();

  await idbPut('accounts', next);
  await saveSnapshot('save account');
  await loadAll();
  toast('保存成功');
  modalClose();
}

async function addAccount(){
  const empty = {
    id: uid(),
    account: '',
    tag: '',
    status: '正常',
    updated_at: nowIso(),
    password:'',
    aux_email:'',
    aux_password:'',
    phone:'',
    zipcode:'',
    addr_city:'',
    addr_line:'',
    name_cn:'',
    name_jp:'',
    card_name:'',
    card_number:'',
    cvv:'',
    card_exp:'',
    birth_ym:'',
    note1:'',
    note2:'',
    note3:'',
    note4:'',
  };
  await idbPut('accounts', empty);
  await saveSnapshot('add account');
  await loadAll();
  modalOpen(empty.id);
  state.modal.editing = true;
  els.mBody.innerHTML = renderAccountForm(empty, true);
  updateModalButtons();
}

async function addActivity(){
  const name = prompt('请输入活动名（例如：2026-01 日本站 抽签）');
  if(!name) return;
  const a = { id: uid(), name: name.trim(), created_at: nowIso() };
  await idbPut('activities', a);
  await saveSnapshot('add activity');
  await loadAll();
  state.currentActivityId = a.id;
  rebuildActivitySelect();
  applyFilters();
  toast('已新增活动');
}

async function deleteActivity(id){
  const act = state.activities.find(a=>a.id===id);
  if(!act) return;
  if(!confirm(`确认删除活动：${act.name} ？\n（会同时删除该活动下的报名/中奖/付款标记）`)) return;

  // delete enrollments under activity
  const toDel = state.enrollments.filter(e=>e.activityId===id).map(e=>e.id);
  for(const key of toDel){
    await idbDelete('enrollments', key);
  }
  await idbDelete('activities', id);
  await saveSnapshot('delete activity');
  await loadAll();
  toast('已删除活动');
}

function renderActivities(){
  const tb = els.tbActivities;
  tb.innerHTML = '';
  for(const a of state.activities){
    const s = enrollmentStats(a.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}</td>
      <td class="right">${s.enrolled}</td>
      <td class="right">${s.winner}</td>
      <td class="right">${s.paid}</td>
      <td class="small muted">${escapeHtml(a.created_at||'')}</td>
      <td>
        <button class="btn small useAct" data-id="${a.id}">设为当前</button>
        <button class="btn small openAct" data-id="${a.id}">查看报名</button>
        <button class="btn small danger delAct" data-id="${a.id}">删除</button>
      </td>
    `;
    tb.appendChild(tr);
  }
}

function openActivityView(activityId){
  // Quick view: filter account list to enrolled for activity
  state.currentActivityId = activityId;
  rebuildActivitySelect();
  els.fEnrolled.value = 'yes';
  els.fWinner.value = 'all';
  els.fPaid.value = 'all';
  showPanel('accounts');
  applyFilters();
}

async function renderSnapshots(){
  const snaps = await listSnapshots(30);
  els.tbSnaps.innerHTML = '';
  for(const s of snaps){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${s.id}</td>
      <td>${escapeHtml(s.note||'')}</td>
      <td class="right">${(s.accounts||[]).length}</td>
      <td class="right">${(s.activities||[]).length}</td>
      <td>
        <button class="btn small loadSnap" data-id="${s.id}">回滚到此快照</button>
      </td>
    `;
    els.tbSnaps.appendChild(tr);
  }
}

async function clearAll(){
  if(!confirm('确认清空本地数据？这会删除账号、活动、报名标记。建议先导出JSON备份。')) return;
  await Promise.all([idbClear('accounts'), idbClear('activities'), idbClear('enrollments')]);
  await saveSnapshot('clear all');
  await loadAll();
}

function wire(){
  // navigation
  els.navAccounts.onclick = ()=>showPanel('accounts');
  els.navActivities.onclick = ()=>{ showPanel('activities'); renderActivities(); };
  els.navSafety.onclick = ()=>{ showPanel('safety'); renderSnapshots(); };

  els.currentActivitySelect.onchange = ()=>{
    state.currentActivityId = els.currentActivitySelect.value || null;
    applyFilters();
  };

  // filters
  els.btnApplyFilters.onclick = ()=>applyFilters();
  els.btnClearFilters.onclick = ()=>{
    els.q.value=''; els.qTag.value='';
    els.fStatus.value='all'; els.fEnrolled.value='all'; els.fWinner.value='all'; els.fPaid.value='all';
    applyFilters();
  };
  els.btnReload.onclick = ()=>loadAll();

  // parse
  els.btnParseSelect.onclick = ()=>parseAndSelect();
  els.btnParseClear.onclick = ()=>{ els.parseBox.value=''; };

  // select all
  els.ckAll.onchange = ()=>{
    const ids = state.filtered.map(a=>a.id);
    if(els.ckAll.checked){
      ids.forEach(id=>state.selectedIds.add(id));
    }else{
      ids.forEach(id=>state.selectedIds.delete(id));
    }
    renderAccounts();
  };

  // table events (delegate)
  els.tbAccounts.addEventListener('click', (ev)=>{
    const t = ev.target;
    if(t.classList.contains('openAcc')){
      ev.preventDefault();
      const id = t.getAttribute('data-id');
      modalOpen(id);
    }
  });
  els.tbAccounts.addEventListener('change', (ev)=>{
    const t = ev.target;
    if(t.classList.contains('ckRow')){
      const id = t.getAttribute('data-id');
      if(t.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      renderAccounts();
    }
  });

  // modal
  els.mClose.onclick = ()=>modalClose();
  els.mCancel.onclick = ()=>modalClose();
  els.mEdit.onclick = ()=>{
    const id = state.modal.id;
    const a = state.accounts.find(x=>x.id===id);
    if(!a) return;
    state.modal.editing = true;
    els.mBody.innerHTML = renderAccountForm(a, true);
    updateModalButtons();
  };
  els.mSave.onclick = ()=>modalSave();

  // add
  els.btnAddAccount.onclick = ()=>addAccount();

  // batch
  els.btnBatchEnroll.onclick = ()=>batchSetFlags({enrolled:true});
  els.btnBatchWinner.onclick = ()=>batchSetFlags({winner:true});
  els.btnBatchPaid.onclick = ()=>batchSetFlags({paid:true});
  els.btnBatchUnEnroll.onclick = ()=>batchSetFlags({enrolled:false});
  els.btnBatchUnWinner.onclick = ()=>batchSetFlags({winner:false});
  els.btnBatchUnPaid.onclick = ()=>batchSetFlags({paid:false});

  // export csv
  els.btnExportFilteredCsv.onclick = ()=>{
    const actId = state.currentActivityId;
    const csv = buildCsvForAccounts(state.filtered, actId);
    download(`accounts_filtered_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };
  els.btnExportSelectedCsv.onclick = ()=>{
    const ids = new Set(state.selectedIds);
    const rows = state.accounts.filter(a=>ids.has(a.id));
    const actId = state.currentActivityId;
    const csv = buildCsvForAccounts(rows, actId);
    download(`accounts_selected_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  // snapshots
  els.btnSaveSnapshot.onclick = async ()=>{
    const id = await saveSnapshot('manual snapshot');
    await renderSnapshots();
    toast('快照已保存：' + id);
  };

  els.btnMakeSnap.onclick = async ()=>{
    const id = await saveSnapshot('manual snapshot');
    await renderSnapshots();
    toast('快照已保存：' + id);
  };

  els.tbSnaps.addEventListener('click', async (ev)=>{
    const t = ev.target;
    if(t.classList.contains('loadSnap')){
      const id = Number(t.getAttribute('data-id'));
      if(!confirm('确认回滚到快照 ' + id + ' ？（会覆盖当前本地数据）')) return;
      await loadSnapshot(id);
      await loadAll();
      toast('已回滚');
    }
  });

  els.btnClearAll.onclick = ()=>clearAll();

  // activities
  els.btnAddActivity.onclick = ()=>addActivity();
  els.tbActivities.addEventListener('click', (ev)=>{
    const t = ev.target;
    if(t.classList.contains('useAct')){
      const id = t.getAttribute('data-id');
      state.currentActivityId = id;
      rebuildActivitySelect();
      applyFilters();
      toast('已设为当前活动');
    }
    if(t.classList.contains('openAct')){
      const id = t.getAttribute('data-id');
      openActivityView(id);
    }
    if(t.classList.contains('delAct')){
      const id = t.getAttribute('data-id');
      deleteActivity(id);
    }
  });

  // json import/export
  const doExport = ()=>exportAllJson();
  els.btnExportAll.onclick = doExport;
  els.btnExportAll2.onclick = doExport;

  els.btnImport.onclick = ()=>openImport();
  els.btnImport2.onclick = ()=>openImport();
  els.fileInput.addEventListener('change', async ()=>{
    const f = els.fileInput.files?.[0];
    if(!f) return;
    try{
      await onImportFile(f);
    }catch(e){
      console.error(e);
      toast('导入失败：' + (e?.message||e));
    }
  });
}

(async function main(){
  wire();
  await loadAll();
})();
