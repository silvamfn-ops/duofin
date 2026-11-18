// app.js — Orquestrador principal DuoFin v6.7.0 (ES Modules)
import {
  bufToB64,
  b64ToBuf,
  randomBytes,
  hashPinWithSalt,
  deriveAesKey,
  encryptJsonAesGcm,
  decryptJsonAesGcm
} from './js/crypto.js';

import {
  initCyclesModule,
  bindRolloverEvents,
  addMonthsClamp,
  computeCycleReferenceMonth,
  assignCycleMonthLabels,
  buildCycles,
  computeCycleBalance,
  detectPreviousCycleRollover,
  renderRolloverBanner,
  computeCycleProjection,
  currentCycle,
  cycleName,
  cycleTransactions,
  getSelectedCycle
} from './js/cycles.js';

import {
  initChartsModule,
  hideChartTooltip,
  drawAnalyticsChart,
  drawChart
} from './js/charts.js';

import {
  initParserModule,
  extractKeywordFromDesc,
  saveLearnedCategoryRule,
  guessMovementTypeAndCategory,
  guessCategory,
  parseStatementTextLines,
  parseCsvContent
} from './js/parser.js';

import {
  createAutoSnapshot,
  listSnapshots,
  getSnapshotById,
  clearAllSnapshots
} from './js/snapshots.js';

import {
  $,
  now(),
  iso,
  cur(),
  esc,
  eur,
  sum,
  isPaid,
  isSavingTx,
  savingSigned,
  validDate,
  capFirst,
  mName,
  fmtDate,
  addDays,
  daysBetween,
  monthLast,
  monthIndex,
  dueDate
} from './js/utils.js';

import {
  initSyncModule,
  cloudConnected,
  cloudMessage,
  refreshToken,
  afterLogin,
  syncNow,
  pushCloud,
  queueCloudSave
} from './js/sync.js';

const KEY='orcamento-plus-v1';
const APP_VERSION='v6.7.0';
const CHANGELOG_KEY='duofin-seen-version-v1';
const defs=[['Habitação',850],['Supermercado',450],['Água, luz e gás',180],['Transportes',250],['Telecomunicações',70],['Saúde e farmácia',80],['Crianças e família',150],['Restaurantes e lazer',150],['Vestuário e pessoal',120],['Outros / imprevistos',300]];
const fresh=()=>({settings:{income:3200,target:6000,start:'2026-11-01',deadline:'2027-08-31',cycleGroupingDays:14,people:['Adulto 1','Adulto 2'],categories:defs.map(([name,budget])=>({name,budget})),categoryRules:[]},transactions:[],recurringExpenses:[],savingsGoals:[],deletedIds:[],handledCycleRollovers:[]});
let dbNeedsSync=false;

function normalizeDb(x){
 if(!x||!x.settings||!Array.isArray(x.transactions))return {db:fresh(),changed:false};
 let changed=false;
 if(!Array.isArray(x.recurringExpenses)){x.recurringExpenses=[];changed=true;}
 if(!Array.isArray(x.settings.categories)){x.settings.categories=defs.map(([name,budget])=>({name,budget}));changed=true;}
 if(!Array.isArray(x.settings.people)){x.settings.people=['Adulto 1','Adulto 2'];changed=true;}
 if(!Array.isArray(x.settings.categoryRules)){x.settings.categoryRules=[];changed=true;}
 if(!Array.isArray(x.deletedIds)){x.deletedIds=[];changed=true;}
 if(!Array.isArray(x.handledCycleRollovers)){x.handledCycleRollovers=[];changed=true;}
 if(!Number.isFinite(Number(x.settings.cycleGroupingDays))){x.settings.cycleGroupingDays=14;changed=true;}
 x.settings.cycleGroupingDays=Math.max(0,Math.min(20,Math.round(Number(x.settings.cycleGroupingDays)||0)));
 if(!Array.isArray(x.savingsGoals)){
   const legacyIds=x.transactions.filter(t=>t&&(t.type==='saving'||t.type==='saving_withdraw')).map(t=>String(t.id));
   x.savingsGoals=[];
   if(Number(x.settings.target)>0)x.savingsGoals.push({id:'goal-legacy',name:'Objetivo anterior',target:Number(x.settings.target),deadline:x.settings.deadline||null,status:'active',legacy:true,legacyTransactionIds:legacyIds,updatedAt:Date.now()});
   changed=true;
 }
 x.savingsGoals.forEach(g=>{
   if(!Array.isArray(g.legacyTransactionIds)){g.legacyTransactionIds=[];changed=true;}
   if(!['active','paused','completed'].includes(g.status)){g.status='active';changed=true;}
 });
 // Limpar tombstones com mais de 60 dias
 const cutoff=Date.now()-60*86400000;
 const cleanDel=x.deletedIds.filter(d=>d&&d.id&&(!d.at||d.at>cutoff));
 if(cleanDel.length!==x.deletedIds.length){x.deletedIds=cleanDel;changed=true;}
 return {db:x,changed};
}

function load(){try{const raw=JSON.parse(localStorage.getItem(KEY));if(raw?.settings&&Array.isArray(raw.transactions)){const n=normalizeDb(raw);dbNeedsSync=n.changed;if(n.changed)localStorage.setItem(KEY,JSON.stringify(n.db));return n.db;}}catch(e){}return fresh();}

// SISTEMA DE NOTIFICAÇÕES FLUTUANTES (TOASTS) COM OPÇÃO DESFAZER
let lastUndoSnapshot=null;

// GESTÃO DE AVISOS OCULTOS (SÓ AGORA OU ATÉ AO PRÓXIMO CICLO)
const DISMISSED_CYCLE_ALERTS_KEY = 'duofin-dismissed-cycle-alerts-v1';
const sessionDismissedAlerts = new Set();
let pendingAlertChoiceId = null;

function readCycleDismissedAlerts() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_CYCLE_ALERTS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function isAlertDismissed(cycleKey, alertId) {
  if (sessionDismissedAlerts.has(`${cycleKey}::${alertId}`)) return true;
  const stored = readCycleDismissedAlerts();
  return Array.isArray(stored[cycleKey]) && stored[cycleKey].includes(alertId);
}

function dismissAlertForNow(cycleKey, alertId) {
  sessionDismissedAlerts.add(`${cycleKey}::${alertId}`);
  pendingAlertChoiceId = null;
  render();
}

function dismissAlertForCycle(cycleKey, alertId) {
  const stored = readCycleDismissedAlerts();
  if (!Array.isArray(stored[cycleKey])) stored[cycleKey] = [];
  if (!stored[cycleKey].includes(alertId)) stored[cycleKey].push(alertId);
  const keys = Object.keys(stored);
  if (keys.length > 8) delete stored[keys[0]];
  localStorage.setItem(DISMISSED_CYCLE_ALERTS_KEY, JSON.stringify(stored));
  pendingAlertChoiceId = null;
  render();
}

function restoreDismissedAlerts(cycleKey) {
  for (const k of [...sessionDismissedAlerts]) {
    if (k.startsWith(`${cycleKey}::`)) sessionDismissedAlerts.delete(k);
  }
  const stored = readCycleDismissedAlerts();
  if (stored[cycleKey]) {
    delete stored[cycleKey];
    localStorage.setItem(DISMISSED_CYCLE_ALERTS_KEY, JSON.stringify(stored));
  }
  pendingAlertChoiceId = null;
  render();
}
function showToast(msg, opts={}){
 const container=$('toastContainer');
 if(!container)return;
 const {type='info',duration=3800,undoLabel=null,onUndo=null}=opts;
 const el=document.createElement('div');
 el.className='toast'+(type==='error'?' is-error':type==='success'?' is-success':'');
 const span=document.createElement('span');
 span.textContent=msg;
 el.appendChild(span);
 let timer=null;
 const close=()=>{
   if(timer)clearTimeout(timer);
   el.style.opacity='0';
   el.style.transform='translateY(8px)';
   el.style.transition='opacity .18s, transform .18s';
   setTimeout(()=>el.remove(),190);
 };
 if(undoLabel&&typeof onUndo==='function'){
   const btn=document.createElement('button');
   btn.type='button';
   btn.className='toast-undo';
   btn.textContent=undoLabel;
   btn.onclick=()=>{
     onUndo();
     close();
   };
   el.appendChild(btn);
 }
 container.appendChild(el);
 timer=setTimeout(close,duration);
}

function deleteTransactionWithUndo(id){
 const idx=db.transactions.findIndex(t=>String(t.id)===String(id));
 if(idx<0)return;
 const target=db.transactions[idx];
 const backupCopy=JSON.parse(JSON.stringify(target));
 if(target.status==='pending'&&target.occurrenceKey){
   target.status='skipped';
   target.updatedAt=Date.now();
   persist();
   showToast('Ocorrência ignorada.',{
     duration:5500,
     undoLabel:'Desfazer',
     onUndo:()=>{
       const curTx=db.transactions.find(t=>String(t.id)===String(id));
       if(curTx){curTx.status='pending';curTx.updatedAt=Date.now();persist();showToast('Ocorrência restaurada.',{type:'success'});}
     }
   });
 }else{
   recordDeletedId(target.id);
   db.transactions.splice(idx,1);
   if($('txEditId').value===String(id))resetTxForm();
   persist();
   haptic([20,40,20]);showToast('Movimento apagado.',{
     duration:5500,
     undoLabel:'Desfazer',
     onUndo:()=>{
       db.deletedIds=(db.deletedIds||[]).filter(d=>String(d.id)!==String(backupCopy.id));
       backupCopy.updatedAt=Date.now();
       db.transactions.push(backupCopy);
       persist();
       showToast('Movimento restaurado.',{type:'success'});
     }
   });
 }
}


// ============================================================================
// FEEDBACK HÁPTICO (MICRO-VIBRAÇÕES) & CALCULADORA INLINE (v6.6.0)
// ============================================================================
function haptic(pattern=12){
 try{
   if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function'){
     navigator.vibrate(pattern);
   }
 }catch(e){}
}

function evaluateAmountExpression(raw){
 const cleaned=String(raw??'')
   .replace(/[€$£\s\u00A0]/g,'')
   .replace(/,/g,'.')
   .replace(/[−–—]/g,'-')
   .replace(/[×xX]/g,'*')
   .replace(/[÷]/g,'/');
 if(!cleaned)return NaN;
 if(/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)){
   const v=parseFloat(cleaned);
   return Number.isFinite(v)?v:NaN;
 }
 if(!/^[0-9.+\-*/()]+$/.test(cleaned))return NaN;
 const tokens=cleaned.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
 if(!tokens||tokens.join('')!==cleaned)return NaN;

 // Shunting-yard seguro sem eval()
 const out=[],ops=[];
 const prec={'+':1,'-':1,'*':2,'/':2};
 let prevType='start';
 for(const tok of tokens){
   if(/^\d/.test(tok)){
     out.push(parseFloat(tok));
     prevType='num';
   }else if(tok==='('){
     ops.push(tok);
     prevType='op';
   }else if(tok===')'){
     while(ops.length&&ops[ops.length-1]!=='(')out.push(ops.pop());
     if(!ops.length)return NaN;
     ops.pop();
     prevType='num';
   }else{
     if((tok==='+'||tok==='-')&&(prevType==='start'||prevType==='op')){
       out.push(0);
     }else if(prevType!=='num'){
       return NaN;
     }
     while(ops.length&&ops[ops.length-1]!=='('&&prec[ops[ops.length-1]]>=prec[tok]){
       out.push(ops.pop());
     }
     ops.push(tok);
     prevType='op';
   }
 }
 while(ops.length){
   const op=ops.pop();
   if(op==='(')return NaN;
   out.push(op);
 }
 const stack=[];
 for(const item of out){
   if(typeof item==='number'){
     stack.push(item);
   }else{
     if(stack.length<2)return NaN;
     const b=stack.pop(),a=stack.pop();
     if(item==='+')stack.push(a+b);
     else if(item==='-')stack.push(a-b);
     else if(item==='*')stack.push(a*b);
     else if(item==='/'){
       if(b===0)return NaN;
       stack.push(a/b);
     }
   }
 }
 if(stack.length!==1||!Number.isFinite(stack[0]))return NaN;
 return Math.round(stack[0]*100)/100;
}

function updateAmountCalcPreview(){
 const inp=$('amount');
 const badge=$('calcPreviewBadge');
 if(!inp||!badge)return;
 const raw=inp.value.trim();
 const hasExpr=/[+\-*/×÷]/.test(raw.replace(/^[+-]/,''));
 if(!hasExpr){
   badge.hidden=true;
   return;
 }
 const val=evaluateAmountExpression(raw);
 if(Number.isFinite(val)&&val>0){
   badge.textContent='= '+eur(val);
   badge.hidden=false;
 }else{
   badge.hidden=true;
 }
}

function commitAmountCalculation(playHaptic=true){
 const inp=$('amount');
 if(!inp)return NaN;
 const val=evaluateAmountExpression(inp.value);
 if(Number.isFinite(val)&&val>0){
   inp.value=val.toFixed(2);
   updateAmountCalcPreview();
   if(playHaptic)haptic(10);
 }
 return val;
}

let db=load(),selected=iso(now()),selectedCycleKey=null,activeCycle=null,activeCycles=[];
const DAY_MS=86400000,dateMs=s=>Date.parse(s+'T00:00:00Z'),validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(dateMs(s)),addDays=(s,n)=>new Date(dateMs(s)+n*DAY_MS).toISOString().slice(0,10),daysBetween=(a,b)=>Math.round((dateMs(b)-dateMs(a))/DAY_MS),monthLast=m=>{const [y,mo]=m.split('-').map(Number);return `${m}-${String(new Date(y,mo,0).getDate()).padStart(2,'0')}`},fmtDate=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});

function recordDeletedId(id){
 if(!Array.isArray(db.deletedIds))db.deletedIds=[];
 const strId=String(id);
 if(!db.deletedIds.some(x=>String(x.id)===strId)){
   db.deletedIds.push({id:strId,at:Date.now()});
 }
}

function categoryIcon(t){
 if(t.type==='income')return '💶';
 if(t.type==='saving')return '🐷';
 if(t.type==='saving_withdraw')return '↩️';
 const c=String(t.category||'').toLocaleLowerCase('pt-PT');
 if(c.includes('habita')||c.includes('renda')||c.includes('casa'))return '🏠';
 if(c.includes('supermercado')||c.includes('aliment'))return '🛒';
 if(c.includes('água')||c.includes('luz')||c.includes('gás')||c.includes('energ'))return '⚡';
 if(c.includes('transport')||c.includes('combust')||c.includes('auto'))return '🚗';
 if(c.includes('telecom')||c.includes('net')||c.includes('telem'))return '📱';
 if(c.includes('saúde')||c.includes('farm'))return '💊';
 if(c.includes('criança')||c.includes('famíl')||c.includes('escol'))return '👨‍👩‍👧';
 if(c.includes('restaur')||c.includes('lazer')||c.includes('viag'))return '🍽️';
 if(c.includes('vestu')||c.includes('pessoal'))return '👕';
 if(c.includes('anim'))return '🐾';
 return '🧾';
}

function friendlyDateHeading(dateStr){
 const today=iso(now());
 if(dateStr===today)return 'Hoje · '+fmtDate(dateStr);
 if(dateStr===addDays(today,-1))return 'Ontem · '+fmtDate(dateStr);
 return fmtDate(dateStr);
}

function renderGroupedTransactions(list){
 if(!list.length)return '';
 let html='',lastDate='';
 list.forEach(t=>{
   if(t.date!==lastDate){
     html+=`<div class="date-group-header">${esc(friendlyDateHeading(t.date))}</div>`;
     lastDate=t.date;
   }
   html+=line(t,true);
 });
 return html;
}

function persist(skipCloud=false){localStorage.setItem(KEY,JSON.stringify(db));render();if(!skipCloud)queueCloudSave()}

const MORE_DRAWER_TABS=new Set(['recorrentes','calendario','orcamento','dados']);

function openMobileMoreDrawer(){
 const dr=$('mobileMoreDrawer'),bd=$('mobileMoreBackdrop'),btn=$('mobileMoreBtn');
 if(!dr||!bd)return;
 dr.hidden=false;
 bd.hidden=false;
 if(btn)btn.setAttribute('aria-expanded','true');
 haptic(10);
}

function closeMobileMoreDrawer(){
 const dr=$('mobileMoreDrawer'),bd=$('mobileMoreBackdrop'),btn=$('mobileMoreBtn');
 if(dr)dr.hidden=true;
 if(bd)bd.hidden=true;
 if(btn)btn.setAttribute('aria-expanded','false');
}

function switchTab(tabId){
 closeMobileMoreDrawer();
 document.querySelectorAll('nav button[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tabId));
 const moreBtn=$('mobileMoreBtn');
 if(moreBtn)moreBtn.classList.toggle('active',MORE_DRAWER_TABS.has(tabId));
 document.querySelectorAll('[data-drawer-tab]').forEach(x=>x.classList.toggle('active',x.dataset.drawerTab===tabId));
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===tabId));
 const fab=$('quickAddFab');
 if(fab)fab.hidden=tabId!=='resumo';
 hideChartTooltip('chartTooltip');
 hideChartTooltip('analyticsTooltip');
 haptic(8);
 if(tabId==='resumo')requestAnimationFrame(drawChart);
 if(tabId==='graficos')requestAnimationFrame(drawAnalyticsChart);
}

function line(t, omitDate=false){
 let state=t.status==='pending'?' · <strong>Pendente</strong>':t.status==='skipped'?' · <strong>Ignorada</strong>':'';
 if(t.type==='income'&&t.countsForCycle===false)state+=' · <em>Extra (não fecha ciclo)</em>';
 if(t.type==='saving_withdraw'){
   const g=(db.savingsGoals||[]).find(x=>x.id===t.goalId);
   state+=g?` · <em>Resgate: ${esc(g.name)}</em>`:' · <em>Resgate de poupança</em>';
 }else if(t.type==='saving'&&t.goalId){
   const g=(db.savingsGoals||[]).find(x=>x.id===t.goalId);
   if(g)state+=` · <em>Objetivo: ${esc(g.name)}</em>`;
 }
 if(t.date>iso(now()))state+=' · <em>Agendado</em>';
 let actions=t.status==='pending'?`<button class="secondary" data-confirm-rec="${esc(String(t.id))}">Confirmar</button><button class="danger" data-skip-rec="${esc(String(t.id))}">Ignorar</button>`:'';
 const cls=t.type==='income'?'plus':t.type==='saving_withdraw'?'neutral':'minus';
 const badgeCls=t.type==='income'?'is-inc':isSavingTx(t)?'is-sav':'';
 const prefix=t.type==='income'?'+':t.type==='saving'?'↗':t.type==='saving_withdraw'?'↙':'−';
 const datePrefix=omitDate?'':`${t.date} · `;
 return `<div class="item row tx-clickable" data-open-tx="${esc(String(t.id))}"><div class="tx-left"><span class="tx-badge ${badgeCls}" aria-hidden="true">${categoryIcon(t)}</span><div class="tx-info"><b>${esc(t.description)}</b><div class="small">${datePrefix}${esc(t.category)} · ${esc(t.person)}${state}</div></div></div><div class="row" style="gap:6px;flex-shrink:0"><b class="amount ${cls}">${prefix} ${eur(t.amount)}</b>${actions}<button class="icon-btn" type="button" data-edit-tx="${esc(String(t.id))}" title="Ver ou editar movimento" aria-label="Ver ou editar movimento">✎</button><button class="danger" type="button" data-del="${esc(String(t.id))}" title="Apagar movimento" aria-label="Apagar movimento">×</button></div></div>`;
}

function updateRecurrentsNavBadge(){
 const btn=$('navRecorrentesBtn');
 const pendingCount=(db.transactions||[]).filter(t=>t.status==='pending'&&t.recurrenceId).length;
 if(btn)btn.innerHTML=pendingCount>0?`Recorrentes <span class="nav-badge">${pendingCount}</span>`:'Recorrentes';
 const mBadge=$('mobileMoreBadge');
 if(mBadge){
   mBadge.hidden=pendingCount<=0;
   mBadge.textContent=pendingCount>0?String(pendingCount):'';
 }
 const dBadge=$('drawerRecBadge');
 if(dBadge){
   dBadge.hidden=pendingCount<=0;
   dBadge.textContent=pendingCount>0?String(pendingCount):'';
 }
}

function render(){
 const {cycles,cycle}=getSelectedCycle();
 const mLabel=cycle.monthLabel||computeCycleReferenceMonth(cycle);
 $('monthTitle').textContent=cycle.fallback?`${mLabel} · período provisório`:cycle.preCycle?mLabel:`Ciclo de ${mLabel}${cycle.open?' (em curso)':''}`;
 $('cycleRange').textContent=`Período: ${fmtDate(cycle.start)} a ${fmtDate(cycle.end)}`+(cycle.fallback?' · regista um rendimento para ciclos reais':'');
 $('cycleSelect').innerHTML=cycles.slice().reverse().map(c=>`<option value="${esc(c.key)}">${esc(cycleName(c))}</option>`).join('');
 $('cycleSelect').value=cycle.key;
 const cIdx=cycles.findIndex(c=>c.key===cycle.key);
 if($('prevCycleBtn'))$('prevCycleBtn').disabled=cIdx<=0;
 if($('nextCycleBtn'))$('nextCycleBtn').disabled=cIdx<0||cIdx>=cycles.length-1;

 // Verificar se há sobra do ciclo anterior para tratar
 renderRolloverBanner(cycles,cycle);
 updateRecurrentsNavBadge();

 // Sincroniza seletor de ciclos e categorias do separador Gráficos
 const aSel=$('analyticsCycleSelect');
 if(aSel){
   const prevA=aSel.value;
   aSel.innerHTML=cycles.slice().reverse().map(c=>`<option value="${esc(c.key)}">${esc(cycleName(c))}</option>`).join('');
   aSel.value=prevA&&[...aSel.options].some(o=>o.value===prevA)?prevA:cycle.key;
 }
 const aCatSel=$('analyticsTrendCategory');
 if(aCatSel){
   const prevCat=aCatSel.value;
   aCatSel.innerHTML=db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
   if(prevCat&&[...aCatSel.options].some(o=>o.value===prevCat))aCatSel.value=prevCat;
 }

 const today=iso(now());
 const tx=cycleTransactions(cycle).filter(t=>t.date<=today);
 const ex=tx.filter(t=>t.type==='expense'&&isPaid(t)),inc=tx.filter(t=>t.type==='income'&&isPaid(t));
 const svIn=tx.filter(t=>t.type==='saving'&&isPaid(t)),svOut=tx.filter(t=>t.type==='saving_withdraw'&&isPaid(t));
 const netSaving=sum(svIn)-sum(svOut);
 const cycleBalance=sum(inc)+sum(svOut)-sum(ex)-sum(svIn);

 $('inc').textContent=eur(sum(inc));
 $('exp').textContent=eur(sum(ex));
 $('bal').textContent=eur(cycleBalance);
 $('balCard').classList.toggle('is-negative',cycleBalance<0);
 $('bal').className=cycleBalance<0?'minus':'';
 $('savm').textContent=eur(netSaving);
 $('savm').className=netSaving>0?'plus':netSaving<0?'minus':'';

 // Projeção de fecho de ciclo
 const proj=computeCycleProjection(cycle,cycleBalance);
 const projEl=$('projectedBalLine');
 if(proj&&projEl){
   projEl.hidden=false;
   projEl.classList.toggle('is-warn',proj.projectedBalance<0);
   projEl.innerHTML=`Previsto no fecho: <strong>${eur(proj.projectedBalance)}</strong> (${proj.itemCount} agend./pend.)`;
 }else if(projEl){
   projEl.hidden=true;
 }

 let rawAlerts = [];
 db.settings.categories.forEach(c => {
   let v = sum(ex.filter(t => t.category === c.name));
   if (v > c.budget) {
     rawAlerts.push({
       id: `over:${c.name}`,
       cls: 'alert red',
       html: `⚠ ${esc(c.name)} acima do limite em ${eur(v - c.budget)}.`
     });
   } else if (c.budget && v >= c.budget * 0.85) {
     rawAlerts.push({
       id: `warn:${c.name}`,
       cls: 'alert',
       html: `Atenção: ${esc(c.name)} já consumiu ${Math.round(v / c.budget * 100)}% do limite neste ciclo.`
     });
   }
 });

 const smartCheck = computeSmartBudgetInsights();
 smartCheck.categories.forEach(st => {
   if (!st.locked && st.consecutiveOver >= 2 && st.suggestedBudget > st.currentBudget) {
     rawAlerts.push({
       id: `smart:${st.name}`,
       cls: 'alert',
       html: `💡 <strong>${esc(st.name)}</strong> ultrapassou o limite (${eur(st.currentBudget)}) nos últimos ${st.consecutiveOver} ciclos (média real: <strong>${eur(st.effectiveReal)}</strong>). <button type="button" class="smart-apply-pill" style="margin-left:6px" data-quick-adapt-cat="${st.index}" data-smart-val="${st.suggestedBudget}">Atualizar limite para ${eur(st.suggestedBudget)}</button>`
     });
   }
 });

 if (smartCheck.refIncome > 0 && smartCheck.currentTotal > smartCheck.refIncome) {
   rawAlerts.push({
     id: 'balance:over-income',
     cls: 'alert red',
     html: `⚖️ O orçamento total planeado (${eur(smartCheck.currentTotal)}) está acima das receitas médias (${eur(smartCheck.refIncome)}). Revê a distribuição no separador <strong>Orçamento</strong>.`
   });
 }

 const visibleAlerts = rawAlerts.filter(a => !isAlertDismissed(cycle.key, a.id));
 const hiddenCount = rawAlerts.length - visibleAlerts.length;

 if (!rawAlerts.length) {
   $('alerts').innerHTML = '<div class="alert good">Despesas dentro dos limites definidos neste ciclo.</div>';
 } else {
   const cardsHtml = visibleAlerts.map(a => {
     if (pendingAlertChoiceId === a.id) {
       return `<div class="swipe-alert-wrap">
         <div class="alert-choice-bar">
           <span>Ocultar este aviso:</span>
           <div class="alert-choice-actions">
             <button type="button" class="secondary" data-alert-hide-now()="${esc(a.id)}">Só agora</button>
             <button type="button" class="primary" data-alert-hide-cycle="${esc(a.id)}">Até ao próximo ciclo</button>
             <button type="button" class="ghost" data-alert-cancel-hide>Cancelar</button>
           </div>
         </div>
       </div>`;
     }
     return `<div class="swipe-alert-wrap" data-swipe-alert="${esc(a.id)}">
       <div class="swipe-alert-bg" aria-hidden="true"><span>← Ocultar aviso</span><span>Ocultar aviso →</span></div>
       <div class="${a.cls}">
         <div style="flex:1;min-width:0">${a.html}</div>
         <button type="button" class="alert-dismiss-x" data-alert-ask-hide="${esc(a.id)}" title="Ocultar aviso" aria-label="Ocultar aviso">✕</button>
       </div>
     </div>`;
   }).join('');

   const restoreHtml = hiddenCount > 0
     ? `<div class="hidden-alerts-bar"><button type="button" class="ghost" data-restore-alerts>👁️ ${hiddenCount} aviso(s) oculto(s) neste ciclo · Mostrar</button></div>`
     : '';

   $('alerts').innerHTML = cardsHtml + restoreHtml;
 }

 $('cats').innerHTML=db.settings.categories.map(c=>{
   let v=sum(ex.filter(t=>t.category===c.name));
   let pct=c.budget?Math.min(100,v/c.budget*100):0;
   let barCls=c.budget?(v>c.budget?'over':v>=c.budget*0.85?'warn':''):'';
   let valText=c.budget?`<b>${eur(v)}</b> <span class="small">/ ${Math.round(c.budget)} €</span>`:`<b>${eur(v)}</b>`;
   return `<div class="barline"><span class="barline-name" title="${esc(c.name)}">${esc(c.name)}</span><div class="bar"><i class="${barCls}" style="width:${pct}%"></i></div><span class="barline-val">${valText}</span></div>`;
 }).join('');

 $('persons').innerHTML=[...db.settings.people,'Conta conjunta'].map(p=>`<div class="item row">${esc(p)}<b>${eur(sum(ex.filter(t=>t.person===p)))}</b></div>`).join('');

 const recent=[...tx].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
 $('recent').innerHTML=recent.length?recent.map(t=>line(t,false)).join(''):'<div class="empty">Ainda sem movimentos neste ciclo.</div>';

 const prevCatVal=$('category').value;
 $('category').innerHTML=db.settings.categories.map(c=>`<option>${esc(c.name)}</option>`).join('');
 if(prevCatVal&&[...$('category').options].some(o=>o.value===prevCatVal))$('category').value=prevCatVal;

 $('incomePlan').value=db.settings.income??0;
 $('adult1').value=db.settings.people[0];
 $('adult2').value=db.settings.people[1];
 $('cycleGroupingDays').value=db.settings.cycleGroupingDays??14;

 const smartInsights=computeSmartBudgetInsights();
 if($('autoAdjustBudgetsToggle'))$('autoAdjustBudgetsToggle').checked=!!db.settings.autoAdjustBudgets;
 $('budgetFields').innerHTML=smartInsights.categories.map(st=>{
   const diff=st.suggestedBudget-st.currentBudget;
   const showSuggest=!st.locked&&st.hasSample&&Math.abs(diff)>=5;
   const realText=st.hasSample?`Média real: <strong>${eur(st.effectiveReal)}</strong>${st.recFloor>st.avgSpent?' (incl. recorrentes)':''}`:'Sem histórico suficiente ainda';
   const suggestBtn=showSuggest?`<button type="button" class="smart-apply-pill" data-apply-smart="${st.index}" data-smart-val="${st.suggestedBudget}">Ajustar para ${eur(st.suggestedBudget)}</button>`:'';
   const lockTitle=st.locked?'Desbloquear categoria (permitir ajuste automático)':'Bloquear limite desta categoria (manter teto fixo)';
   return `<div class="budget-cat-row">
     <div class="budget-cat-top">
       <label style="margin:0;flex:1">${esc(st.name)}</label>
       <div class="row" style="gap:6px">
         <input data-budget="${st.index}" type="number" min="0" step=".01" value="${st.currentBudget}" style="width:125px;min-height:38px;padding:7px 10px;text-align:right">
         <button type="button" class="lock-cat-btn ${st.locked?'is-locked':''}" data-toggle-lock="${st.index}" title="${lockTitle}" aria-label="${lockTitle}">${st.locked?'🔒':'🔓'}</button>
       </div>
     </div>
     <div class="budget-cat-meta">
       <span>${realText}</span>
       ${suggestBtn}
     </div>
   </div>`;
 }).join('');
 updateBudget();

 $('categoryManager').innerHTML=db.settings.categories.map((c,i)=>`<div class="item" data-category-row="${i}"><div class="grid"><div><label>Nome da categoria</label><input data-cat-name="${i}" maxlength="50" value="${esc(c.name)}"></div><div><label>Limite por ciclo (€)</label><input data-cat-budget="${i}" type="number" min="0" step=".01" value="${Number(c.budget)||0}"></div></div><div class="actions"><button class="secondary" type="button" data-cat-save="${i}">Guardar alterações</button><button class="danger" type="button" data-cat-delete="${i}">Eliminar</button></div></div>`).join('')||'<div class="empty">Ainda não existem categorias.</div>';

 renderLearnedRules();

 const move=$('movementCycle'),oldMove=move.value;
 move.innerHTML='<option value="selected">Ciclo selecionado no Resumo</option><option value="all">Todos os movimentos (sem limite de ciclo)</option><option value="future">Prestações / movimentos futuros</option>'+cycles.slice().reverse().map(c=>`<option value="${esc(c.key)}">${esc(cycleName(c))}</option>`).join('');
 move.value=oldMove&&[...move.options].some(o=>o.value===oldMove)?oldMove:'selected';

 const fCat=$('filterCategory'),oldFCat=fCat.value;
 fCat.innerHTML='<option value="all">Todas as categorias</option>'+db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
 fCat.value=oldFCat&&[...fCat.options].some(o=>o.value===oldFCat)?oldFCat:'all';

 const fPer=$('filterPerson'),oldFPer=fPer.value;
 const peopleOpts=[...db.settings.people,'Conta conjunta'];
 fPer.innerHTML='<option value="all">Todos</option>'+peopleOpts.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
 fPer.value=oldFPer&&[...fPer.options].some(o=>o.value===oldFPer)?oldFPer:'all';

 const csvPer=$('csvDefaultPerson'),oldCsvPer=csvPer.value;
 csvPer.innerHTML=['Conta conjunta',...db.settings.people].map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
 if(oldCsvPer&&[...csvPer.options].some(o=>o.value===oldCsvPer))csvPer.value=oldCsvPer;

 renderTransactions();
 renderGoals();

 const activeGoals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 $('forecastText').innerHTML=activeGoals.length?activeGoals.map(g=>{
   const left=Math.max(0,Number(g.target)-goalTotal(g));
   const fc=computeGoalForecast(g);
   return `<div class="item"><div class="row"><b>${esc(g.name)}</b><span class="small">Faltam <strong>${eur(left)}</strong> de ${eur(g.target)}</span></div><div class="goal-forecast-badge ${fc.kind}">${esc(fc.text)}</div></div>`;
 }).join(''):'<div class="empty">Ainda não existem objetivos ativos.</div>';

 drawChart();
 drawAnalyticsChart();
 drawCalendar();
 renderRecurrences();
 renderQuickTemplates();
 updateTxFormVisibility();
 checkNavScroll();
}

function renderLearnedRules(){
 const container=$('learnedRulesList');
 if(!container)return;
 const rules=db.settings.categoryRules||[];
 if(!rules.length){
   container.innerHTML='<div class="empty">Ainda não existem regras personalizadas guardadas.</div>';
   return;
 }
 container.innerHTML=rules.map((r,idx)=>`<div class="item row"><div><b>${esc(r.keyword)}</b><div class="small">${r.type==='saving'?'Classificação: <strong>Poupança transferida</strong>':r.type==='saving_withdraw'?'Classificação: <strong>Resgate de poupança</strong>':r.type==='income'?'Classificação: <strong>Rendimento</strong>':'Categoria associada: <strong>'+esc(r.category)+'</strong>'}</div></div><button type="button" class="danger" data-del-rule="${idx}" title="Eliminar regra">×</button></div>`).join('');
}
$('learnedRulesList').addEventListener('click',e=>{
 const btn=e.target.closest('[data-del-rule]');
 if(!btn)return;
 const idx=Number(btn.dataset.delRule);
 if(db.settings.categoryRules[idx]){
   db.settings.categoryRules.splice(idx,1);
   persist();
 }
});

let quickStatusFilter='all';
document.querySelectorAll('[data-quick-status]').forEach(btn=>{
 btn.onclick=()=>{
   quickStatusFilter=btn.dataset.quickStatus;
   document.querySelectorAll('[data-quick-status]').forEach(b=>b.classList.toggle('active',b===btn));
   renderTransactions();
 };
});

function getFilteredMovements(){
 const f=$('filter').value,period=$('movementCycle').value,search=$('filterSearch').value.trim().toLocaleLowerCase('pt-PT'),cat=$('filterCategory').value,per=$('filterPerson').value;
 const dFrom=$('filterDateFrom').value,dTo=$('filterDateTo').value;
 const today=iso(now());
 let list=[...db.transactions],periodLabel='Todos os movimentos';

 if(period==='selected'&&activeCycle){
   list=list.filter(t=>t.date>=activeCycle.start&&t.date<=activeCycle.end);
   periodLabel=cycleName(activeCycle);
 }else if(period==='future'){
   list=list.filter(t=>t.date>today);
   periodLabel='Prestações e movimentos futuros';
 }else if(period!=='all'&&period!=='selected'){
   const c=activeCycles.find(x=>x.key===period);
   if(c){list=list.filter(t=>t.date>=c.start&&t.date<=c.end);periodLabel=cycleName(c);}
 }

 if(dFrom){list=list.filter(t=>t.date>=dFrom);}
 if(dTo){list=list.filter(t=>t.date<=dTo);}
 if(dFrom||dTo){
   periodLabel+=` · Datas: ${dFrom?fmtDate(dFrom):'início'} até ${dTo?fmtDate(dTo):'hoje'}`;
 }

 if(f!=='all')list=list.filter(t=>t.type===f);
 if(cat!=='all')list=list.filter(t=>t.category===cat);
 if(per!=='all')list=list.filter(t=>t.person===per);
 if(search)list=list.filter(t=>String(t.description||'').toLocaleLowerCase('pt-PT').includes(search)||String(t.category||'').toLocaleLowerCase('pt-PT').includes(search));

 list.sort((a,b)=>b.date.localeCompare(a.date));
 const typeLabels={all:'Todos os tipos',expense:'Despesas',income:'Rendimentos',saving:'Poupança transferida',saving_withdraw:'Resgates de poupança'};
 let filterParts=[typeLabels[f]||'Todos os tipos'];
 if(dFrom||dTo)filterParts.push(`De ${dFrom||'…'} a ${dTo||'…'}`);
 if(cat!=='all')filterParts.push('Cat.: '+cat);
 if(per!=='all')filterParts.push('Resp.: '+per);
 if(search)filterParts.push('Pesquisa: "'+$('filterSearch').value.trim()+'"');
 if(quickStatusFilter==='pending')list=list.filter(t=>t.status==='pending');
 else if(quickStatusFilter==='skipped')list=list.filter(t=>t.status==='skipped');
 else if(quickStatusFilter==='installments')list=list.filter(t=>!!t.installmentGroupId);
 const hasExtraFilters=f!=='all'||cat!=='all'||per!=='all'||search.length>0||!!dFrom||!!dTo||quickStatusFilter!=='all';
 return {list,periodLabel,typeLabel:filterParts.join(' · '),hasExtraFilters};
}


function computeFrequentTemplates(){
 const map=new Map();
 const validCatSet=new Set((db.settings.categories||[]).map(c=>c.name));
 const fallbackCat=validCatSet.has('Outros / imprevistos')?'Outros / imprevistos':(db.settings.categories[0]?.name||'');

 (db.transactions||[]).forEach(t=>{
   if(!t||t.type!=='expense'||t.status==='skipped')return;
   const cleanDesc=String(t.description||'').replace(/\s*\(\d+\/\d+\)\s*$/,'').trim();
   if(cleanDesc.length<2)return;
   const key=cleanDesc.toLocaleLowerCase('pt-PT');
   const prev=map.get(key)||{
     description:cleanDesc,
     category:validCatSet.has(t.category)?t.category:fallbackCat,
     person:t.person||'Conta conjunta',
     lastAmount:Number(t.amount)||0,
     lastDate:t.date||'',
     count:0
   };
   prev.count+=1;
   if((t.date||'')>=prev.lastDate){
     prev.lastDate=t.date||'';
     prev.lastAmount=Number(t.amount)||0;
     prev.category=validCatSet.has(t.category)?t.category:fallbackCat;
     prev.person=t.person||prev.person;
   }
   map.set(key,prev);
 });

 const sorted=[...map.values()]
   .filter(x=>x.count>=2)
   .sort((a,b)=>b.count-a.count||b.lastDate.localeCompare(a.lastDate))
   .slice(0,8);

 if(sorted.length)return sorted;

 return [
   {description:'Supermercado',category:validCatSet.has('Supermercado')?'Supermercado':fallbackCat,person:'Conta conjunta',lastAmount:0},
   {description:'Combustível',category:validCatSet.has('Transportes')?'Transportes':fallbackCat,person:'Conta conjunta',lastAmount:0},
   {description:'Café / Pastelaria',category:validCatSet.has('Restaurantes e lazer')?'Restaurantes e lazer':fallbackCat,person:'Conta conjunta',lastAmount:0},
   {description:'Farmácia',category:validCatSet.has('Saúde e farmácia')?'Saúde e farmácia':fallbackCat,person:'Conta conjunta',lastAmount:0}
 ].filter(x=>x.category);
}

function renderQuickTemplates(){
 const bar=$('quickTemplatesBar');
 const listEl=$('quickTemplatesList');
 if(!bar||!listEl)return;
 const isEditing=!!$('txEditId')?.value;
 if(isEditing){
   bar.hidden=true;
   return;
 }
 const tpls=computeFrequentTemplates();
 if(!tpls.length){
   bar.hidden=true;
   return;
 }
 bar.hidden=false;
 listEl.innerHTML=tpls.map((tpl,idx)=>{
   const fakeTx={type:'expense',category:tpl.category};
   const amtTag=tpl.lastAmount>0?`<span class="quick-tpl-amt">${eur(tpl.lastAmount)}</span>`:'';
   return `<button type="button" class="quick-tpl-btn" data-tpl-idx="${idx}"><span>${categoryIcon(fakeTx)}</span><span>${esc(tpl.description)}</span>${amtTag}</button>`;
 }).join('');
 listEl._templates=tpls;
}

function renderTransactions(){
 const {list,hasExtraFilters}=getFilteredMovements();
 $('filterCountLabel').textContent=`${list.length} movimento(s) encontrado(s) · Total filtrado: ${eur(sum(list.filter(isPaid)))}`;
 $('resetFiltersBtn').hidden=!hasExtraFilters;
 $('transactions').innerHTML=list.length?renderGroupedTransactions(list):'<div class="empty">Sem movimentos que correspondam aos filtros selecionados.</div>';
}

// EXPORTAÇÃO PARA CSV / EXCEL (UTF-8 BOM + SEPARADOR ;)
function exportFilteredCsv(){
 const {list}=getFilteredMovements();
 if(!list.length){
   alert('Não existem movimentos na lista filtrada atual para exportar.');
   return;
 }
 const sep=';';
 const escapeCsv=v=>`"${String(v??'').replace(/"/g,'""')}"`;
 const headers=['Data','Tipo','Descrição','Categoria','Responsável','Valor (€)','Estado'];
 const lines=[headers.map(escapeCsv).join(sep)];
 list.forEach(t=>{
   const signedAmt=t.type==='income'?Number(t.amount):-Number(t.amount);
   const fmtAmt=signedAmt.toFixed(2).replace('.',',');
   const st=t.status==='pending'?'Pendente':t.status==='skipped'?'Ignorada':t.date>iso(now())?'Agendado':'Confirmado';
   lines.push([
     t.date,
     txTypeLabel(t),
     t.description,
     t.category,
     t.person,
     fmtAmt,
     st
   ].map(escapeCsv).join(sep));
 });
 const csvBlob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
 const url=URL.createObjectURL(csvBlob);
 const a=document.createElement('a');
 a.href=url;
 a.download=`duofin-movimentos-${iso(now())}.csv`;
 a.click();
 URL.revokeObjectURL(url);
}
$('exportCsvBtn').onclick=exportFilteredCsv;
$('exportDadosCsvBtn').onclick=exportFilteredCsv;

// POP-UP (MODAL) DE VISUALIZAÇÃO, DUPLICAÇÃO, EDIÇÃO E GESTÃO DE PRESTAÇÕES EM LOTE
function openTransactionDetailModal(id, startInEdit=false){
 const t=db.transactions.find(x=>String(x.id)===String(id));
 if(!t)return;
 $('modalTxId').value=String(t.id);
 $('txModalTitle').textContent=startInEdit?'Editar movimento':'Detalhe do movimento';
 $('txModalSubtitle').textContent=friendlyDateHeading(t.date);

 $('txModalIcon').textContent=categoryIcon(t);
 const cls=t.type==='income'?'plus':t.type==='saving_withdraw'?'neutral':'minus';
 const prefix=t.type==='income'?'+':t.type==='saving'?'↗':t.type==='saving_withdraw'?'↙':'−';
 const amtEl=$('txModalAmountDisplay');
 amtEl.textContent=`${prefix} ${eur(t.amount)}`;
 amtEl.className='tx-modal-amount '+cls;
 $('txModalDescDisplay').textContent=t.description;
 $('txModalDateDisplay').textContent=fmtDate(t.date);
 $('txModalTypeDisplay').textContent=txTypeLabel(t);
 $('txModalCatRow').hidden=t.type!=='expense';
 $('txModalCatDisplay').textContent=t.category||'—';
 $('txModalPersonDisplay').textContent=t.person||'—';

 let extraInfo='';
 if(t.status==='pending')extraInfo='Pendente de confirmação';
 else if(t.status==='skipped')extraInfo='Ignorada';
 else if(t.date>iso(now()))extraInfo='Agendado (futuro)';
 else if(t.type==='income')extraInfo=t.countsForCycle===false?'Rendimento extra (não fecha ciclo)':'Define o início do ciclo financeiro';
 else if(isSavingTx(t)&&t.goalId){
   const g=(db.savingsGoals||[]).find(x=>x.id===t.goalId);
   if(g)extraInfo='Objetivo: '+g.name;
 }
 $('txModalExtraRow').hidden=!extraInfo;
 $('txModalExtraDisplay').textContent=extraInfo;

 // Bloco de grupo de prestações
 const groupBox=$('txModalInstallmentGroupBox');
 const applyAllWrap=$('modalEditApplyAllInstWrap');
 if(t.installmentGroupId){
   const groupItems=db.transactions.filter(x=>x.installmentGroupId===t.installmentGroupId);
   const today=iso(now());
   const futureItems=groupItems.filter(x=>x.date>today);
   const totalGroup=sum(groupItems);
   const remainingGroup=sum(futureItems);
   groupBox.hidden=false;
   $('txModalInstGroupBadge').textContent=`${groupItems.length} prestações`;
   $('txModalInstGroupSummary').textContent=`Total da compra: ${eur(totalGroup)} · Em falta (futuras): ${eur(remainingGroup)} (${futureItems.length} prestação(ões)).`;
   $('txModalDeleteFutureInstBtn').hidden=futureItems.length===0;
   applyAllWrap.hidden=groupItems.length<=1;
   $('modalEditApplyAllInst').checked=false;
   $('modalEditApplyFutureAmountInst').checked=false;
   $('modalEditApplyFutureAmountWrap').hidden=futureItems.length===0;
 }else{
   groupBox.hidden=true;
   applyAllWrap.hidden=true;
 }

 // Preencher formulário de edição no pop-up
 $('modalEditDate').value=t.date;
 $('modalEditType').value=t.type;
 $('modalEditDesc').value=t.description;
 $('modalEditAmount').value=Number(t.amount)||'';
 $('modalEditCat').innerHTML=db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
 if([...$('modalEditCat').options].some(o=>o.value===t.category))$('modalEditCat').value=t.category;
 $('modalEditPerson').innerHTML=[...db.settings.people,'Conta conjunta'].map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
 if([...$('modalEditPerson').options].some(o=>o.value===t.person))$('modalEditPerson').value=t.person;
 $('modalEditCountsCycle').checked=t.countsForCycle!==false;
 const goals=(db.savingsGoals||[]).filter(g=>g.status==='active'||g.id===t.goalId);
 $('modalEditGoal').innerHTML='<option value="">Sem objetivo</option>'+goals.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 $('modalEditGoal').value=t.goalId||'';

 syncModalEditVisibility();
 $('txModalReadView').hidden=startInEdit;
 $('txModalEditForm').hidden=!startInEdit;
 $('txDetailModal').hidden=false;
 if(startInEdit)setTimeout(()=>$('modalEditDesc').focus(),100);
}

function syncModalEditVisibility(){
 const tp=$('modalEditType').value;
 $('modalEditCatWrap').hidden=tp!=='expense';
 $('modalEditIncomeCycleWrap').hidden=tp!=='income';
 $('modalEditGoalWrap').hidden=tp!=='saving'&&tp!=='saving_withdraw';
}

$('modalEditType').onchange=syncModalEditVisibility;
$('closeTxModalBtn').onclick=()=>{$('txDetailModal').hidden=true;};
$('txDetailModal').addEventListener('click',e=>{
 if(e.target===$('txDetailModal'))$('txDetailModal').hidden=true;
});
$('txModalSwitchEditBtn').onclick=()=>{
 $('txModalTitle').textContent='Editar movimento';
 $('txModalReadView').hidden=true;
 $('txModalEditForm').hidden=false;
 syncModalEditVisibility();
 $('modalEditDesc').focus();
};
$('txModalDuplicateBtn').onclick=()=>{
 const id=$('modalTxId').value;
 const t=db.transactions.find(x=>String(x.id)===String(id));
 if(!t)return;
 $('txDetailModal').hidden=true;
 switchTab('movimentos');
 resetTxForm();
 $('date').value=iso(now());
 $('type').value=t.type;
 updateTxFormVisibility();
 // Remove eventual sufixo de prestação ex.: " (1/3)"
 $('desc').value=String(t.description||'').replace(/\s*\(\d+\/\d+\)\s*$/,'');
 $('amount').value=Number(t.amount)||'';
 if(t.type==='expense'&&[...$('category').options].some(o=>o.value===t.category))$('category').value=t.category;
 if(t.type==='income')$('incomeCountsForCycle').checked=t.countsForCycle!==false;
 if((t.type==='saving'||t.type==='saving_withdraw')&&t.goalId&&[...$('savingGoal').options].some(o=>o.value===t.goalId))$('savingGoal').value=t.goalId;
 if([...$('person').options].some(o=>o.value===t.person))$('person').value=t.person;
 $('txFormCard').scrollIntoView({behavior:'smooth',block:'start'});
 setTimeout(()=>$('amount').focus(),200);
};
$('txModalCancelEditBtn').onclick=()=>{
 const id=$('modalTxId').value;
 openTransactionDetailModal(id,false);
};
$('txModalDeleteFutureInstBtn').onclick=()=>{
 const id=$('modalTxId').value;
 const target=db.transactions.find(t=>String(t.id)===String(id));
 if(!target||!target.installmentGroupId)return;
 const today=iso(now());
 const futureItems=db.transactions.filter(x=>x.installmentGroupId===target.installmentGroupId&&x.date>today);
 if(!futureItems.length)return;
 if(confirm(`Apagar as ${futureItems.length} prestações futuras deste grupo (mantendo as já vencidas/pagas)?`)){
   futureItems.forEach(x=>recordDeletedId(x.id));
   const toDel=new Set(futureItems.map(x=>String(x.id)));
   db.transactions=db.transactions.filter(x=>!toDel.has(String(x.id)));
   $('txDetailModal').hidden=true;
   persist();
 }
};
$('txModalDeleteBtn').onclick=()=>{
 const id=$('modalTxId').value;
 $('txDetailModal').hidden=true;
 deleteTransactionWithUndo(id);
};
$('txModalEditForm').onsubmit=e=>{
 e.preventDefault();
 const id=$('modalTxId').value;
 const existing=db.transactions.find(x=>String(x.id)===String(id));
 if(!existing)return;
 const a=+$('modalEditAmount').value;
 if(!Number.isFinite(a)||a<=0)return;
 const tp=$('modalEditType').value;
 const catLabel=tp==='expense'?$('modalEditCat').value:tp==='saving'?'Poupança':tp==='saving_withdraw'?'Resgate de poupança':'Rendimento';
 const nowTs=Date.now();
 existing.date=$('modalEditDate').value;
 existing.type=tp;
 existing.description=$('modalEditDesc').value.trim();
 existing.amount=Number(a.toFixed(2));
 existing.category=catLabel;
 existing.person=$('modalEditPerson').value;
 existing.updatedAt=nowTs;
 if(tp==='income')existing.countsForCycle=$('modalEditCountsCycle').checked;
 else delete existing.countsForCycle;
 if(tp==='saving'||tp==='saving_withdraw'){
   if($('modalEditGoal').value)existing.goalId=$('modalEditGoal').value;
   else delete existing.goalId;
 }else{
   delete existing.goalId;
 }

 // Aplicar categoria/responsável/valor futuro ao grupo de prestações se marcado
 if(existing.installmentGroupId){
   const applyCatPerson=$('modalEditApplyAllInst').checked;
   const applyFutureAmt=$('modalEditApplyFutureAmountInst').checked;
   const todayStr=iso(now());
   if(applyCatPerson||applyFutureAmt){
     db.transactions.forEach(item=>{
       if(item.installmentGroupId===existing.installmentGroupId&&item.id!==existing.id){
         if(applyCatPerson){
           if(tp==='expense')item.category=catLabel;
           item.person=existing.person;
         }
         if(applyFutureAmt&&item.date>todayStr){
           item.amount=existing.amount;
         }
         item.updatedAt=nowTs;
       }
     });
   }
 }

 $('txDetailModal').hidden=true;
 persist();
};

function goalTransactions(g){
 const legacy=new Set((g.legacyTransactionIds||[]).map(String));
 return db.transactions.filter(t=>isSavingTx(t)&&isPaid(t)&&(t.goalId===g.id||(!t.goalId&&legacy.has(String(t.id)))));
}

function computeGoalForecast(g){
 const saved=goalTotal(g),target=Number(g.target)||0;
 const left=Math.max(0,target-saved);
 if(left<=0)return {text:'Objetivo concluído!',kind:'is-done'};

 const today=iso(now());
 const cycles=buildCycles().filter(c=>!c.preCycle&&!c.fallback);
 const recentClosed=cycles.slice(-4);
 let avgPerCycle=0;
 if(recentClosed.length){
   const gTxs=goalTransactions(g);
   const totalRecent=recentClosed.reduce((acc,cy)=>{
     return acc+gTxs.filter(t=>t.date>=cy.start&&t.date<=cy.end).reduce((s,t)=>s+savingSigned(t),0);
   },0);
   avgPerCycle=Math.max(0,totalRecent/recentClosed.length);
 }

 if(g.deadline){
   const daysLeft=daysBetween(today,g.deadline);
   if(daysLeft<=0)return {text:`Prazo expirado (${fmtDate(g.deadline)}) · faltam ${eur(left)}`,kind:'is-warn'};
   const cyclesLeft=Math.max(1,Math.ceil(daysLeft/30.4));
   const neededPerCycle=left/cyclesLeft;
   const paceNote=avgPerCycle>0?(avgPerCycle>=neededPerCycle?` · ritmo atual (${eur(avgPerCycle)}/ciclo) suficiente`:` · ritmo atual: ${eur(avgPerCycle)}/ciclo`):'';
   return {
     text:`Necessário poupar ~${eur(neededPerCycle)}/ciclo (${cyclesLeft} ciclo(s) até ${fmtDate(g.deadline)})${paceNote}`,
     kind:avgPerCycle>0&&avgPerCycle<neededPerCycle?'is-warn':''
   };
 }

 if(avgPerCycle>0){
   const estCycles=Math.ceil(left/avgPerCycle);
   const estDate=addMonthsClamp(today,estCycles);
   return {
     text:`Ao ritmo médio de ${eur(avgPerCycle)}/ciclo, conclusão prevista em ~${estCycles} ciclo(s) (${fmtDate(estDate)})`,
     kind:''
   };
 }
 return {text:'Sem data-limite · regista reforços para estimar o prazo de conclusão',kind:''};
}

function goalTotal(g){return Math.max(0,goalTransactions(g).reduce((s,t)=>s+savingSigned(t),0));}
function goalStatusLabel(s){return s==='paused'?'Pausado':s==='completed'?'Concluído':'Ativo';}

function renderGoals(){
 const goals=db.savingsGoals||[],active=goals.filter(g=>g.status==='active');
 $('goalCount').textContent=`${active.length} ativos · ${goals.length} no total`;
 $('goalsSummary').innerHTML=goals.length?goals.slice(0,4).map(g=>{
   const total=goalTotal(g),pct=g.target>0?Math.min(100,total/Number(g.target)*100):0;
   return `<div class="item"><div class="row"><b>${esc(g.name)}</b><span class="pill">${Math.round(pct)}%</span></div><div class="small">${eur(total)} / ${eur(g.target)} · ${goalStatusLabel(g.status)}</div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
 }).join(''):'<div class="empty">Cria o primeiro objetivo na secção «Objetivos».</div>';

 $('goalList').innerHTML=goals.length?goals.map(g=>{
  const tx=goalTransactions(g).sort((a,b)=>b.date.localeCompare(a.date)),total=goalTotal(g),pct=g.target>0?Math.min(100,total/Number(g.target)*100):0,left=Math.max(0,Number(g.target)-total);
  const savings=db.transactions.filter(t=>isSavingTx(t)&&isPaid(t)&&String(t.date||'')<=iso(now())).sort((a,b)=>b.date.localeCompare(a.date));
  const options=savings.filter(t=>t.goalId!==g.id).map(t=>{
    const current=db.savingsGoals.find(x=>x.id===t.goalId)||db.savingsGoals.find(x=>(x.legacyTransactionIds||[]).map(String).includes(String(t.id))&&!t.goalId);
    const kind=t.type==='saving_withdraw'?'[Resgate] ':'';
    return `<option value="${esc(String(t.id))}">${esc(t.date+' · '+kind+t.description+' · '+eur(t.amount)+(current?' · atualmente: '+current.name:''))}</option>`;
  }).join('');
  const history=tx.slice(0,8).map(t=>{
    const isOut=t.type==='saving_withdraw';
    return `<div class="item row"><div><b>${esc(t.description)}</b><div class="small">${esc(t.date)} · ${esc(t.person||'')}${isOut?' · Resgate':''}</div></div><div class="row"><b class="amount ${isOut?'minus':'plus'}">${isOut?'−':'+'} ${eur(t.amount)}</b><button class="danger" type="button" data-goal-remove-tx="${esc(String(t.id))}" data-goal-remove-from="${esc(g.id)}" title="Retirar deste objetivo">×</button></div></div>`;
  }).join('');
  return `<div class="card"><div class="row"><div><h2>${esc(g.name)}</h2><span class="pill">${goalStatusLabel(g.status)}</span></div><b>${Math.round(pct)}%</b></div><div class="row"><b>${eur(total)} / ${eur(g.target)}</b><span class="small">${g.deadline?'Prazo: '+fmtDate(g.deadline):'Sem data-limite'}</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="small">${left>0?'Faltam '+eur(left):'Montante-alvo atingido.'}</div><div class="goal-forecast-badge ${computeGoalForecast(g).kind}">${esc(computeGoalForecast(g).text)}</div><div class="actions"><button class="ghost" type="button" data-goal-edit="${esc(g.id)}">Editar</button>${g.status!=='completed'?`<button class="ghost" type="button" data-goal-toggle="${esc(g.id)}">${g.status==='paused'?'Retomar':'Pausar'}</button>`:''}<button class="secondary" type="button" data-goal-complete="${esc(g.id)}">${g.status==='completed'?'Reabrir':'Concluir'}</button></div>${g.status==='active'?`<div class="grid"><div><label>Atribuir movimento de poupança existente</label><select data-goal-assign-select="${esc(g.id)}"><option value="">Selecionar movimento…</option>${options}</select></div><div style="display:flex;align-items:end"><button class="secondary" type="button" data-goal-assign="${esc(g.id)}">Atribuir movimento</button></div></div>`:''}<h3 style="font-size:14px;margin:14px 0 4px">Reforços e resgates atribuídos</h3>${history||'<div class="empty">Ainda sem movimentos associados.</div>'}</div>`;
 }).join(''):'<div class="card empty">Ainda não existem objetivos. Usa o formulário acima para criar um.</div>';
}

let userTouchedCategory=false;
function resetTxForm(){
 $('txForm').reset();
 $('txEditId').value='';
 $('txFormTitle').textContent='Adicionar movimento';
 $('txEditBadge').hidden=true;
 $('txSaveBtn').textContent='Guardar movimento';
 $('txCancelEditBtn').hidden=true;
 $('date').value=iso(now());
 $('incomeCountsForCycle').checked=true;
 $('isInstallment').checked=false;
 $('installmentsOptions').hidden=true;
 $('amountLabel').textContent='Valor (€)';
 userTouchedCategory=false;
 if($('categoryAutoHint'))$('categoryAutoHint').textContent='';
 if($('calcPreviewBadge'))$('calcPreviewBadge').hidden=true;
 renderQuickTemplates();
 updateTxFormVisibility();
}

// Sugestão automática de categoria ao escrever descrição no formulário manual
$('category').addEventListener('change',()=>{
 userTouchedCategory=true;
 if($('categoryAutoHint'))$('categoryAutoHint').textContent='';
});
$('desc').addEventListener('input',()=>{
 if(userTouchedCategory||$('type').value!=='expense')return;
 const txt=$('desc').value.trim();
 if(txt.length<3){
   if($('categoryAutoHint'))$('categoryAutoHint').textContent='';
   return;
 }
 const suggested=guessCategory(txt);
 const fallbackCat=db.settings.categories.some(c=>c.name==='Outros / imprevistos')?'Outros / imprevistos':(db.settings.categories[0]?.name||'');
 if(suggested&&suggested!==fallbackCat&&[...$('category').options].some(o=>o.value===suggested)){
   $('category').value=suggested;
   if($('categoryAutoHint'))$('categoryAutoHint').textContent='· sugerida';
 }
});

function updateInstallmentPreview(){
 const isInst=$('isInstallment').checked;
 $('installmentsOptions').hidden=!isInst;
 const mode=$('installmentAmountMode').value;
 $('amountLabel').textContent=isInst&&mode==='total'?'Valor total a dividir (€)':'Valor (€)';
 const parsedVal=evaluateAmountExpression($('amount').value);
 const val=Number.isFinite(parsedVal)?parsedVal:0;
 const count=Math.max(2,Math.min(60,Math.round(Number($('installmentCount').value)||3)));
 if(isInst&&val>0){
   const perMonth=mode==='total'?(val/count):val;
   const total=mode==='total'?val:(val*count);
   $('installmentSummary').textContent=`Serão criadas ${count} prestações mensais de aprox. ${eur(perMonth)} cada (total: ${eur(total)}).`;
 }else{
   $('installmentSummary').textContent='A 1.ª prestação fica registada na data escolhida e as seguintes nos meses subsequentes (com arredondamento exato aos cêntimos).';
 }
}

$('isInstallment').onchange=updateInstallmentPreview;
$('installmentCount').oninput=updateInstallmentPreview;
$('installmentAmountMode').onchange=updateInstallmentPreview;
$('amount').oninput=()=>{
 updateAmountCalcPreview();
 if($('isInstallment').checked)updateInstallmentPreview();
};
$('amount').addEventListener('blur',()=>{
 const v=evaluateAmountExpression($('amount').value);
 if(Number.isFinite(v)&&v>0&&/[+\-*/×÷]/.test($('amount').value.trim().replace(/^[+-]/,''))){
   $('amount').value=v.toFixed(2);
   updateAmountCalcPreview();
   if($('isInstallment').checked)updateInstallmentPreview();
 }
});
document.querySelectorAll('[data-calc-op]').forEach(btn=>{
 btn.onclick=()=>{
   const inp=$('amount');
   if(!inp)return;
   const op=btn.dataset.calcOp;
   const curVal=inp.value.trim();
   inp.value=curVal?`${curVal} ${op} `:'';
   inp.focus();
   updateAmountCalcPreview();
   haptic(8);
 };
});
if($('calcEvalBtn'))$('calcEvalBtn').onclick=()=>{
 const v=commitAmountCalculation(true);
 if(Number.isFinite(v)&&v>0&&$('isInstallment').checked)updateInstallmentPreview();
};
if($('quickTemplatesList'))$('quickTemplatesList').addEventListener('click',e=>{
 const btn=e.target.closest('[data-tpl-idx]');
 if(!btn)return;
 const tpls=$('quickTemplatesList')._templates||[];
 const tpl=tpls[Number(btn.dataset.tplIdx)];
 if(!tpl)return;
 $('type').value='expense';
 userTouchedCategory=true;
 updateTxFormVisibility();
 $('desc').value=tpl.description;
 if(tpl.category&&[...$('category').options].some(o=>o.value===tpl.category))$('category').value=tpl.category;
 if(tpl.person&&[...$('person').options].some(o=>o.value===tpl.person))$('person').value=tpl.person;
 if(tpl.lastAmount>0){
   $('amount').value=tpl.lastAmount.toFixed(2);
 }else{
   $('amount').value='';
 }
 updateAmountCalcPreview();
 haptic(14);
 $('amount').focus();
 if(tpl.lastAmount>0)$('amount').select();
});
$('txCancelEditBtn').onclick=resetTxForm;
$('quickAddFab').onclick=()=>{
 switchTab('movimentos');
 resetTxForm();
 $('txFormCard').scrollIntoView({behavior:'smooth',block:'start'});
 setTimeout(()=>$('desc').focus(),220);
};

// GERAÇÃO DE RELATÓRIOS PARA IMPRESSÃO / PDF
function txTypeLabel(t){
 if(t.type==='income')return t.countsForCycle===false?'Rendimento (extra)':'Rendimento';
 if(t.type==='saving')return 'Poupança (+)';
 if(t.type==='saving_withdraw')return 'Resgate (−)';
 return 'Despesa';
}

function buildGoalsReportHtml(){
 const goals=db.savingsGoals||[];
 if(!goals.length)return '<div class="print-section"><h2>Objetivos de Poupança</h2><p class="small">Ainda não existem objetivos definidos.</p></div>';
 const totalTarget=goals.reduce((s,g)=>s+(Number(g.target)||0),0);
 const totalSaved=goals.reduce((s,g)=>s+goalTotal(g),0);
 const rows=goals.map(g=>{
   const saved=goalTotal(g),target=Number(g.target)||0,left=Math.max(0,target-saved),pct=target>0?Math.min(100,saved/target*100):0;
   const txs=goalTransactions(g).sort((a,b)=>b.date.localeCompare(a.date));
   const lastMove=txs[0]?`${txs[0].date} (${txs[0].type==='saving_withdraw'?'−':'+'}${eur(txs[0].amount)})`:'—';
   return `<tr>
     <td><b>${esc(g.name)}</b><br><span class="small">${goalStatusLabel(g.status)}</span></td>
     <td>${g.deadline?fmtDate(g.deadline):'Sem prazo'}</td>
     <td class="num">${eur(target)}</td>
     <td class="num"><b>${eur(saved)}</b></td>
     <td class="num">${eur(left)}</td>
     <td><span class="print-bar"><i style="width:${pct}%"></i></span><b>${Math.round(pct)}%</b></td>
     <td>${esc(lastMove)}</td>
   </tr>`;
 }).join('');
 return `<div class="print-section">
   <h2>Estado dos Objetivos de Poupança</h2>
   <div class="print-kpis" style="grid-template-columns:repeat(3,1fr)">
     <div class="print-kpi"><span>Total Poupança nos Objetivos</span><b>${eur(totalSaved)}</b></div>
     <div class="print-kpi"><span>Total Alvo Definido</span><b>${eur(totalTarget)}</b></div>
     <div class="print-kpi"><span>Montante Global em Falta</span><b>${eur(Math.max(0,totalTarget-totalSaved))}</b></div>
   </div>
   <table class="print-table">
     <thead><tr><th>Objetivo</th><th>Prazo</th><th class="num">Alvo</th><th class="num">Acumulado</th><th class="num">Em falta</th><th>Progresso</th><th>Último movimento</th></tr></thead>
     <tbody>${rows}</tbody>
   </table>
 </div>`;
}

function buildMovementsReportHtml(txList, subtitle, includeCategoryBreakdown=false){
 const paid=txList.filter(isPaid);
 const inc=sum(paid.filter(t=>t.type==='income'));
 const exp=sum(paid.filter(t=>t.type==='expense'));
 const svIn=sum(paid.filter(t=>t.type==='saving'));
 const svOut=sum(paid.filter(t=>t.type==='saving_withdraw'));
 const bal=inc+svOut-exp-svIn;

 let breakdownHtml='';
 if(includeCategoryBreakdown){
   const catRows=db.settings.categories.map(c=>{
     const v=sum(paid.filter(t=>t.type==='expense'&&t.category===c.name));
     const b=Number(c.budget)||0;
     const pctVal=b>0?Math.min(100,Math.round(v/b*100)):0;
     const pctLabel=b>0?Math.round(v/b*100)+'%':'—';
     return `<tr><td>${esc(c.name)}</td><td class="num">${eur(b)}</td><td class="num"><b>${eur(v)}</b></td><td><span class="print-bar" style="width:65px"><i style="width:${pctVal}%"></i></span><b>${pctLabel}</b></td></tr>`;
   }).join('');
   const peopleRows=[...db.settings.people,'Conta conjunta'].map(p=>{
     const v=sum(paid.filter(t=>t.type==='expense'&&t.person===p));
     return `<tr><td>${esc(p)}</td><td class="num"><b>${eur(v)}</b></td></tr>`;
   }).join('');
   let chartImgHtml='';
   const chartCanvas=$('chart');
   if(chartCanvas&&chartCanvas.width>0){
     try{
       const dataUrl=chartCanvas.toDataURL('image/png');
       chartImgHtml=`<div class="print-section"><h2>Evolução da Poupança Acumulada</h2><div class="print-chart-box"><img src="${dataUrl}" alt="Gráfico de poupança acumulada"></div></div>`;
     }catch(e){}
   }
   breakdownHtml=`<div class="print-section" style="display:grid;grid-template-columns:1.45fr 1fr;gap:16px">
     <div><h2>Despesas por Categoria</h2><table class="print-table"><thead><tr><th>Categoria</th><th class="num">Limite</th><th class="num">Gasto</th><th>Execução</th></tr></thead><tbody>${catRows}</tbody></table></div>
     <div><h2>Despesas por Adulto</h2><table class="print-table"><thead><tr><th>Responsável</th><th class="num">Total</th></tr></thead><tbody>${peopleRows}</tbody></table></div>
   </div>${chartImgHtml}`;
 }

 const rows=txList.length?txList.map(t=>{
   const sign=t.type==='income'?'+':t.type==='saving'?'↗':t.type==='saving_withdraw'?'↙':'−';
   const statusNote=t.status==='pending'?' [Pendente]':t.status==='skipped'?' [Ignorada]':'';
   return `<tr>
     <td style="white-space:nowrap">${esc(t.date)}</td>
     <td>${esc(txTypeLabel(t))}</td>
     <td><b>${esc(t.description)}</b>${esc(statusNote)}</td>
     <td>${esc(t.category)}</td>
     <td>${esc(t.person)}</td>
     <td class="num"><b>${sign} ${eur(t.amount)}</b></td>
   </tr>`;
 }).join(''):'<tr><td colspan="6" style="text-align:center;padding:14px">Sem movimentos registados neste âmbito.</td></tr>';

 return `<div class="print-section">
   <h2>Resumo Financeiro · ${esc(subtitle)}</h2>
   <div class="print-kpis">
     <div class="print-kpi"><span>Rendimentos</span><b>${eur(inc)}</b></div>
     <div class="print-kpi"><span>Despesas Pagas</span><b>${eur(exp)}</b></div>
     <div class="print-kpi"><span>Saldo Líquido</span><b>${eur(bal)}</b></div>
     <div class="print-kpi"><span>Poupança Líquida</span><b>${eur(svIn-svOut)}</b></div>
   </div>
 </div>
 ${breakdownHtml}
 <div class="print-section">
   <h2>Detalhe de Movimentos (${txList.length})</h2>
   <table class="print-table">
     <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th class="num">Valor</th></tr></thead>
     <tbody>${rows}</tbody>
   </table>
 </div>`;
}

function printReport(mode){
 drawChart();
 const {cycle}=getSelectedCycle();
 const emitted=new Date().toLocaleString('pt-PT',{dateStyle:'short',timeStyle:'short'});
 const peopleNames=db.settings.people.join(' & ');
 let title='Relatório Financeiro Geral',bodyHtml='';

 if(mode==='goals'){
   title='Relatório de Objetivos de Poupança';
   bodyHtml=buildGoalsReportHtml();
 }else if(mode==='movements'){
   const {list,periodLabel,typeLabel}=getFilteredMovements();
   title='Extrato de Movimentos';
   bodyHtml=buildMovementsReportHtml(list,`${periodLabel} (${typeLabel})`,false);
 }else{
   const today=iso(now());
   const tx=[...cycleTransactions(cycle)].filter(t=>t.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
   title='Relatório do Ciclo Financeiro e Objetivos';
   bodyHtml=buildMovementsReportHtml(tx,cycleName(cycle),true)+buildGoalsReportHtml();
 }

 $('printSheet').innerHTML=`
   <div class="print-header">
     <div><h1>DuoFin · ${esc(title)}</h1><div class="small">${esc(peopleNames)}</div></div>
     <div class="print-meta">Emitido em ${esc(emitted)}<br>DuoFin ${APP_VERSION}</div>
   </div>
   ${bodyHtml}
   <div class="print-footer"><span>DuoFin — Gestão Financeira a Dois</span><span>Documento gerado localmente no dispositivo</span></div>
 `;
 window.print();
}

function updateSavingGoalOptions(){
 const sel=$('savingGoal');if(!sel)return;
 const old=sel.value,goals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 sel.innerHTML='<option value="">Sem objetivo</option>'+goals.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 if([...sel.options].some(o=>o.value===old))sel.value=old;
}

function updateTxFormVisibility(){
 const t=$('type').value;
 const isEditing=!!$('txEditId').value;
 $('categoryField').hidden=t!=='expense';
 $('installmentsField').hidden=t!=='expense'||isEditing;
 $('incomeCycleField').hidden=t!=='income';
 const isSav=t==='saving'||t==='saving_withdraw';
 $('savingGoalField').hidden=!isSav;
 if(isSav){
   $('savingGoalLabel').textContent=t==='saving_withdraw'?'Objetivo de onde sai o valor':'Associar a objetivo (opcional)';
   $('savingGoalHelp').textContent=t==='saving_withdraw'?'O valor resgatado é abatido ao progresso do objetivo selecionado e fica disponível no saldo do ciclo.':'Só os movimentos de poupança associados contam para o progresso do objetivo.';
   updateSavingGoalOptions();
 }
}

// IMPORTADOR DE EXTRATOS BANCÁRIOS (PDF & CSV) COM APRENDIZAGEM DE CATEGORIAS
// MOTOR DE ORÇAMENTO INTELIGENTE E EQUILÍBRIO RECEITA vs. DESPESA
function roundSmartBudget(val){
 if(!Number.isFinite(val)||val<=0)return 0;
 if(val<=25)return Math.ceil(val);
 if(val<=200)return Math.round(val/5)*5;
 return Math.round(val/10)*10;
}

function getReferenceMonthlyIncome(){
 const today=iso(now());
 const cycles=buildCycles().filter(c=>!c.preCycle&&!c.fallback);
 const closed=cycles.filter(c=>!c.open).slice(-4);
 const sample=closed.length?closed:cycles.slice(-4);
 if(sample.length){
   const totals=sample.map(cy=>{
     const txs=cycleTransactions(cy).filter(t=>t.date<=today&&isPaid(t)&&t.type==='income');
     return sum(txs);
   }).filter(v=>v>0);
   if(totals.length){
     const avg=totals.reduce((a,b)=>a+b,0)/totals.length;
     return Number(avg.toFixed(2));
   }
 }
 return Math.max(0,Number(db.settings.income)||0);
}

function computeSmartBudgetInsights(){
 const today=iso(now());
 const cycles=buildCycles().filter(c=>!c.preCycle);
 const closedCycles=cycles.filter(c=>!c.open).slice(-4);
 const currentCyc=currentCycle(cycles);
 const sampleCycles=closedCycles.length?closedCycles:(currentCyc?[currentCyc]:[]);
 const refIncome=getReferenceMonthlyIncome();

 const catStats=db.settings.categories.map((c,idx)=>{
   let avgSpent=0;
   let consecutiveOver=0;
   if(sampleCycles.length){
     const vals=sampleCycles.map(cy=>{
       const txs=cycleTransactions(cy).filter(t=>t.date<=today&&isPaid(t)&&t.type==='expense'&&t.category===c.name);
       return sum(txs);
     });
     avgSpent=vals.reduce((a,b)=>a+b,0)/vals.length;
     for(let i=vals.length-1;i>=0;i--){
       if(c.budget>0&&vals[i]>c.budget*1.05)consecutiveOver++;
       else break;
     }
   }
   // Considerar também despesas recorrentes ativas desta categoria como piso mínimo
   const recFloor=(db.recurringExpenses||[])
     .filter(r=>r.active&&r.category===c.name)
     .reduce((s,r)=>s+(Number(r.amount)||0),0);

   const effectiveReal=Math.max(avgSpent,recFloor);
   const rawSuggested=effectiveReal>0?roundSmartBudget(effectiveReal):(Number(c.budget)||0);
   return {
     index:idx,
     name:c.name,
     currentBudget:Number(c.budget)||0,
     locked:!!c.locked,
     avgSpent:Number(avgSpent.toFixed(2)),
     recFloor:Number(recFloor.toFixed(2)),
     effectiveReal:Number(effectiveReal.toFixed(2)),
     suggestedBudget:rawSuggested,
     consecutiveOver,
     hasSample:sampleCycles.length>0&&(avgSpent>0||recFloor>0)
   };
 });

 // Garantir que a soma das sugestões não ultrapassa a receita de referência (se existir receita > 0)
 let totalSuggested=catStats.reduce((s,x)=>s+(x.locked?x.currentBudget:x.suggestedBudget),0);
 if(refIncome>0&&totalSuggested>refIncome){
   const lockedSum=catStats.filter(x=>x.locked).reduce((s,x)=>s+x.currentBudget,0);
   const availableForUnlocked=Math.max(0,refIncome-lockedSum);
   const unlockedSum=catStats.filter(x=>!x.locked).reduce((s,x)=>s+x.suggestedBudget,0);
   if(unlockedSum>0){
     const ratio=availableForUnlocked/unlockedSum;
     catStats.forEach(x=>{
       if(!x.locked){
         x.suggestedBudget=Math.max(0,roundSmartBudget(x.suggestedBudget*ratio));
       }
     });
     // Ajuste fino caso arredondamento ainda passe ligeiramente o teto
     let checkTotal=catStats.reduce((s,x)=>s+(x.locked?x.currentBudget:x.suggestedBudget),0);
     if(checkTotal>refIncome){
       const largest=[...catStats].filter(x=>!x.locked&&x.suggestedBudget>0).sort((a,b)=>b.suggestedBudget-a.suggestedBudget)[0];
       if(largest){
         largest.suggestedBudget=Math.max(0,Math.floor(largest.suggestedBudget-(checkTotal-refIncome)));
       }
     }
   }
 }

 const currentTotal=catStats.reduce((s,x)=>s+x.currentBudget,0);
 return {
   refIncome,
   currentTotal,
   sampleCount:sampleCycles.length,
   categories:catStats
 };
}

function runAutoBudgetAdjustment(silent=true){
 if(!db.settings.autoAdjustBudgets)return false;
 const insights=computeSmartBudgetInsights();
 if(!insights.sampleCount)return false;
 let changed=false;
 const nowTs=Date.now();
 insights.categories.forEach(st=>{
   if(st.locked||!st.hasSample)return;
   const cat=db.settings.categories[st.index];
   if(!cat)return;
   // Atualizar se houver diferença relevante (>= 5€ ou >= 10%)
   if(Math.abs(cat.budget-st.suggestedBudget)>=5){
     cat.budget=st.suggestedBudget;
     cat.updatedAt=nowTs;
     changed=true;
   }
 });
 if(changed&&!silent){
   showToast('Orçamento atualizado automaticamente com base na média real.',{type:'success'});
 }
 return changed;
}

function updateBudget(){
 const total=[...document.querySelectorAll('[data-budget]')].reduce((s,x)=>s+(+x.value||0),0);
 $('budgetTotal').textContent=eur(total);
 const refInc=getReferenceMonthlyIncome();
 if($('budgetRefIncomeVal'))$('budgetRefIncomeVal').textContent=eur(refInc);
 if($('budgetPlannedVal'))$('budgetPlannedVal').textContent=eur(total);
 const margin=refInc-total;
 const marginEl=$('budgetMarginVal');
 if(marginEl){
   marginEl.textContent=refInc>0?eur(margin):'—';
   marginEl.className=refInc>0?(margin<0?'minus':'plus'):'';
 }
 const badge=$('budgetHealthBadge');
 const alertBox=$('budgetHealthAlert');
 const balBtn=$('balanceToIncomeBtn');
 if(refInc>0&&total>refInc){
   if(badge){badge.textContent='Acima das receitas';badge.style.background='#fff0ee';badge.style.color='#923c38';}
   if(alertBox){
     alertBox.hidden=false;
     alertBox.className='alert red';
     alertBox.innerHTML=`⚠ O total orçamentado (<strong>${eur(total)}</strong>) supera as receitas médias em <strong>${eur(total-refInc)}</strong>. Usa «Enquadrar nas receitas» para reajustar proporcionalmente.`;
   }
   if(balBtn)balBtn.hidden=false;
 }else{
   if(badge){badge.textContent='Equilibrado';badge.style.background='';badge.style.color='';}
   if(alertBox)alertBox.hidden=true;
   if(balBtn)balBtn.hidden=true;
 }
}

function drawCalendar(){
 let m=$('calendarMonth').value||cur(),[y,mo]=m.split('-').map(Number),off=(new Date(y,mo-1,1).getDay()+6)%7,days=new Date(y,mo,0).getDate(),s=['2ª','3ª','4ª','5ª','6ª','Sáb','Dom'].map(x=>`<div class="dayname">${x}</div>`).join('');
 const today=iso(now());
 for(let i=0;i<off;i++)s+='<div></div>';
 for(let d=1;d<=days;d++){
   let dt=m+'-'+String(d).padStart(2,'0');
   const dayTxs=db.transactions.filter(t=>t.date===dt&&isPaid(t));
   const expTotal=sum(dayTxs.filter(t=>t.type==='expense'));
   const hasInc=dayTxs.some(t=>t.type==='income');
   const hasSav=dayTxs.some(t=>isSavingTx(t));
   let dots='';
   if(expTotal>0)dots+='<i class="dot dot-exp"></i>';
   if(hasInc)dots+='<i class="dot dot-inc"></i>';
   if(hasSav)dots+='<i class="dot dot-sav"></i>';
   const cls=['day',dt===selected?'selected':'',dt===today?'today':''].filter(Boolean).join(' ');
   s+=`<button type="button" class="${cls}" data-day="${dt}"><b>${d}</b><div class="day-dots">${dots}</div>${expTotal?`<em>${Math.round(expTotal)} €</em>`:''}</button>`;
 }
 $('calendar').innerHTML=s;$('calTitle').textContent=mName(m);showDay(selected);
}

function showDay(d){
 selected=d;$('dayTitle').textContent='Movimentos · '+new Date(d+'T12:00:00').toLocaleDateString('pt-PT');
 let a=db.transactions.filter(t=>t.date===d);
 $('dayItems').innerHTML=a.length?a.map(t=>line(t,true)).join(''):'<div class="empty">Sem movimentos neste dia.</div>';
 document.querySelectorAll('[data-day]').forEach(b=>b.classList.toggle('selected',b.dataset.day===d));
}

function checkNavScroll(){
 const nav=$('mainNav'),wrap=$('navWrapper');
 if(!nav||!wrap)return;
 const hasMore=nav.scrollWidth>nav.clientWidth+4&&nav.scrollLeft+nav.clientWidth<nav.scrollWidth-6;
 wrap.classList.toggle('has-scroll',hasMore);
}
if($('mainNav'))$('mainNav').addEventListener('scroll',checkNavScroll,{passive:true});
window.addEventListener('resize',()=>{
 checkNavScroll();
 if($('resumo').classList.contains('active'))drawChart();
 if($('graficos').classList.contains('active'))drawAnalyticsChart();
});

document.querySelectorAll('nav button[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
if($('mobileMoreBtn'))$('mobileMoreBtn').onclick=()=>{
 const dr=$('mobileMoreDrawer');
 if(dr&&!dr.hidden)closeMobileMoreDrawer();
 else openMobileMoreDrawer();
};
if($('closeMobileMoreBtn'))$('closeMobileMoreBtn').onclick=closeMobileMoreDrawer;
if($('mobileMoreBackdrop'))$('mobileMoreBackdrop').onclick=closeMobileMoreDrawer;
document.querySelectorAll('[data-drawer-tab]').forEach(btn=>{
 btn.onclick=()=>switchTab(btn.dataset.drawerTab);
});

$('calendarMonth').value=cur();$('calendarMonth').onchange=()=>{selected=$('calendarMonth').value+'-01';drawCalendar()};
$('date').value=iso(now());

$('cycleSelect').onchange=()=>{selectedCycleKey=$('cycleSelect').value;render()};
$('prevCycleBtn').onclick=()=>{
 const idx=activeCycles.findIndex(c=>c.key===selectedCycleKey);
 if(idx>0){selectedCycleKey=activeCycles[idx-1].key;render();}
};
$('nextCycleBtn').onclick=()=>{
 const idx=activeCycles.findIndex(c=>c.key===selectedCycleKey);
 if(idx>=0&&idx<activeCycles.length-1){selectedCycleKey=activeCycles[idx+1].key;render();}
};

$('filter').onchange=renderTransactions;
$('movementCycle').onchange=renderTransactions;
$('filterDateFrom').onchange=renderTransactions;
$('filterDateTo').onchange=renderTransactions;
$('filterCategory').onchange=renderTransactions;
$('filterPerson').onchange=renderTransactions;
$('filterSearch').oninput=renderTransactions;
$('resetFiltersBtn').onclick=()=>{
 $('filter').value='all';
 $('filterDateFrom').value='';
 $('filterDateTo').value='';
 $('filterCategory').value='all';
 $('filterPerson').value='all';
 $('filterSearch').value='';
 quickStatusFilter='all';
 document.querySelectorAll('[data-quick-status]').forEach(b=>b.classList.toggle('active',b.dataset.quickStatus==='all'));
 renderTransactions();
};
$('type').onchange=()=>{
 userTouchedCategory=false;
 if($('categoryAutoHint'))$('categoryAutoHint').textContent='';
 if($('calcPreviewBadge'))$('calcPreviewBadge').hidden=true;
 renderQuickTemplates();
 updateTxFormVisibility();
};

// Eventos dos botões de impressão
$('printFullReportBtn').onclick=()=>printReport('full');
$('printMovementsBtn').onclick=()=>printReport('movements');
$('printGoalsBtn').onclick=()=>printReport('goals');
$('printDadosFullBtn').onclick=()=>printReport('full');
$('printDadosMovBtn').onclick=()=>printReport('movements');
$('printDadosGoalsBtn').onclick=()=>printReport('goals');

$('txForm').onsubmit=e=>{
 e.preventDefault();
 let a=evaluateAmountExpression($('amount').value);if(!Number.isFinite(a)||a<=0){alert('Introduz um valor ou expressão válida superior a zero.');$('amount').focus();return;}
 let t=$('type').value;
 const editId=$('txEditId').value;
 const catLabel=t==='expense'?$('category').value:t==='saving'?'Poupança':t==='saving_withdraw'?'Resgate de poupança':'Rendimento';
 const desc=$('desc').value.trim();
 const baseDate=$('date').value;
 const person=$('person').value;
 const nowTs=Date.now();

 if(editId){
   const existing=db.transactions.find(x=>String(x.id)===String(editId));
   if(existing){
     existing.date=baseDate;
     existing.type=t;
     existing.description=desc;
     existing.amount=Number(a.toFixed(2));
     existing.category=catLabel;
     existing.person=person;
     existing.updatedAt=nowTs;
     if(t==='income')existing.countsForCycle=$('incomeCountsForCycle').checked;
     else delete existing.countsForCycle;
     if(t==='saving'||t==='saving_withdraw'){
       if($('savingGoal').value)existing.goalId=$('savingGoal').value;
       else delete existing.goalId;
     }else{
       delete existing.goalId;
     }
   }
   resetTxForm();
   persist();
   haptic([14,30,18]);
   return;
 }

 if(t==='expense'&&$('isInstallment').checked){
   const count=Math.max(2,Math.min(60,Math.round(Number($('installmentCount').value)||3)));
   const mode=$('installmentAmountMode').value;
   const totalCents=mode==='total'?Math.round(a*100):Math.round(a*100*count);
   const baseCents=Math.floor(totalCents/count);
   const remainder=totalCents-(baseCents*count);
   const groupId='inst-'+nowTs.toString(36);
   for(let i=0;i<count;i++){
     const cents=baseCents+(i<remainder?1:0);
     db.transactions.push({
       id:groupId+'-'+(i+1),
       date:addMonthsClamp(baseDate,i),
       type:'expense',
       description:`${desc} (${i+1}/${count})`,
       amount:cents/100,
       category:catLabel,
       person,
       installmentGroupId:groupId,
       updatedAt:nowTs
     });
   }
   resetTxForm();
   persist();
   haptic([14,30,18]);
   return;
 }

 let entry={id:nowTs+'-'+Math.random().toString(36).slice(2,6),date:baseDate,type:t,description:desc,amount:Number(a.toFixed(2)),category:catLabel,person,updatedAt:nowTs};
 if(t==='income')entry.countsForCycle=$('incomeCountsForCycle').checked;
 if((t==='saving'||t==='saving_withdraw')&&$('savingGoal').value)entry.goalId=$('savingGoal').value;
 db.transactions.push(entry);
 resetTxForm();
 persist();
 haptic([14,30,18]);
};

document.addEventListener('click',e=>{
 let ed=e.target.closest('[data-edit-tx]');if(ed){e.stopPropagation();openTransactionDetailModal(ed.dataset.editTx,true);return;}
 let b=e.target.closest('[data-del]');if(b){e.stopPropagation();deleteTransactionWithUndo(b.dataset.del);return;}
 let c=e.target.closest('[data-confirm-rec]');if(c){e.stopPropagation();let t=db.transactions.find(x=>String(x.id)===c.dataset.confirmRec);if(t&&t.status==='pending'){t.status='confirmed';t.confirmedAt=iso(new Date());t.updatedAt=Date.now();persist();haptic(16)}return;}
 let sk=e.target.closest('[data-skip-rec]');if(sk){e.stopPropagation();let t=db.transactions.find(x=>String(x.id)===sk.dataset.skipRec);if(t&&t.status==='pending'&&confirm('Ignorar esta ocorrência? Não será contabilizada como despesa.')){t.status='skipped';t.updatedAt=Date.now();persist()}return;}
 let openTx=e.target.closest('[data-open-tx]');if(openTx){openTransactionDetailModal(openTx.dataset.openTx,false);return;}
 let d=e.target.closest('[data-day]');if(d)showDay(d.dataset.day);
});

// Despesas recorrentes
if(!Array.isArray(db.recurringExpenses))db.recurringExpenses=[];
function renderRecurrences(){
 const cats=$('recurrenceCategory'),people=$('recurrencePerson');if(!cats||!people)return;
 const prevCat=cats.value,prevPerson=people.value;
 cats.innerHTML=db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
 people.innerHTML=[...db.settings.people,'Conta conjunta'].map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
 if([...cats.options].some(o=>o.value===prevCat))cats.value=prevCat;if([...people.options].some(o=>o.value===prevPerson))people.value=prevPerson;
 const rules=db.recurringExpenses||[];
 $('recurrenceRules').innerHTML=rules.length?rules.map(r=>`<div class="item"><div class="row"><div><b>${esc(r.description)}</b><div class="small">${eur(r.amount)} · dia ${r.day} · ${esc(r.category)} · ${esc(r.person)}</div><div class="small">Desde ${r.startMonth}${r.endMonth?' até '+r.endMonth:''} · ${r.active?'Ativa':'Suspensa'}</div></div><span class="pill">${r.active?'Ativa':'Pausada'}</span></div><div class="actions"><button type="button" class="ghost" data-recurrence-edit="${esc(r.id)}">Editar</button><button type="button" class="secondary" data-recurrence-toggle="${esc(r.id)}">${r.active?'Suspender':'Retomar'}</button><button type="button" class="danger" data-recurrence-delete="${esc(r.id)}">Eliminar regra</button></div></div>`).join(''):'<div class="empty">Ainda não existem despesas recorrentes.</div>';
 $('recurrenceRules').onclick=e=>{
  const edit=e.target.closest('[data-recurrence-edit]');
  const toggle=e.target.closest('[data-recurrence-toggle]');
  const del=e.target.closest('[data-recurrence-delete]');
  if(edit){const r=db.recurringExpenses.find(x=>String(x.id)===edit.dataset.recurrenceEdit);if(r){loadRecurrenceForm(r);$('recurrenceFormTitle').scrollIntoView({behavior:'smooth',block:'start'});$('recurrenceDescription').focus({preventScroll:true});}return;}
  if(toggle){const r=db.recurringExpenses.find(x=>String(x.id)===toggle.dataset.recurrenceToggle);if(r){r.active=!r.active;r.updatedAt=Date.now();persist();}return;}
  if(del){const r=db.recurringExpenses.find(x=>String(x.id)===del.dataset.recurrenceDelete);if(r&&confirm('Eliminar esta regra? Os movimentos já criados serão preservados.')){recordDeletedId(r.id);db.recurringExpenses=db.recurringExpenses.filter(x=>x.id!==r.id);persist();}}
 };
 const pending=db.transactions.filter(t=>t.status==='pending'&&t.recurrenceId).sort((a,b)=>a.date.localeCompare(b.date));
 $('pendingRecurring').innerHTML=pending.length?pending.map(t=>line(t,false)).join(''):'<div class="empty">Não há despesas recorrentes pendentes.</div>';
}
function loadRecurrenceForm(r){
 if(!r)return;
 $('recurrenceId').value=String(r.id);$('recurrenceDescription').value=r.description??'';$('recurrenceAmount').value=Number(r.amount)||'';
 if(![...$('recurrenceCategory').options].some(o=>o.value===r.category)){const o=document.createElement('option');o.value=r.category;o.textContent=r.category;$('recurrenceCategory').append(o)}
 if(![...$('recurrencePerson').options].some(o=>o.value===r.person)){const o=document.createElement('option');o.value=r.person;o.textContent=r.person;$('recurrencePerson').append(o)}
 $('recurrenceCategory').value=r.category;$('recurrencePerson').value=r.person;$('recurrenceDay').value=r.day;$('recurrenceStart').value=r.startMonth;$('recurrenceEnd').value=r.endMonth||'';$('recurrenceFormTitle').textContent='Editar despesa recorrente';$('recurrenceSave').textContent='Guardar alterações';$('recurrenceCancel').hidden=false;
}
function resetRecurrenceForm(){ $('recurrenceForm').reset();$('recurrenceId').value='';$('recurrenceDay').value='1';$('recurrenceStart').value=cur();$('recurrenceFormTitle').textContent='Nova despesa recorrente';$('recurrenceSave').textContent='Guardar recorrência';$('recurrenceCancel').hidden=true; }
$('recurrenceStart').value=cur();
$('recurrenceForm').onsubmit=e=>{
 e.preventDefault();const id=$('recurrenceId').value,description=$('recurrenceDescription').value.trim(),amount=Number($('recurrenceAmount').value),day=Number($('recurrenceDay').value),startMonth=$('recurrenceStart').value,endMonth=$('recurrenceEnd').value;
 if(!description||!Number.isFinite(amount)||amount<=0||!Number.isInteger(day)||day<1||day>31||!startMonth||(endMonth&&endMonth<startMonth)){alert('Confirma a descrição, o valor, o dia e o período da recorrência.');return;}
 const data={description,amount,day,startMonth,endMonth:endMonth||null,category:$('recurrenceCategory').value,person:$('recurrencePerson').value,active:true,updatedAt:Date.now()};
 if(id){const r=db.recurringExpenses.find(x=>x.id===id);if(!r)return;data.active=r.active;Object.assign(r,data)}else{data.id='rr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);db.recurringExpenses.push(data)}
 resetRecurrenceForm();generateDueOccurrences();persist();
};
$('recurrenceCancel').onclick=resetRecurrenceForm;

// Gestão de Categorias
function validCategoryName(name, exceptIndex=-1){
  const n=String(name||'').trim();
  return n.length>0 && !db.settings.categories.some((c,i)=>i!==exceptIndex&&String(c.name).trim().toLocaleLowerCase('pt-PT')===n.toLocaleLowerCase('pt-PT'));
}
let txCategoryMode='create',txCategoryIndex=-1;
function openTxCategoryEditor(mode,index=-1){
  txCategoryMode=mode;txCategoryIndex=index;
  const box=$('txCategoryEditor');box.hidden=false;
  if(mode==='edit'){
    const c=db.settings.categories[index];if(!c){box.hidden=true;return;}
    $('txCategoryEditorTitle').textContent='Editar categoria';
    $('txCategoryName').value=c.name;$('txCategoryBudget').value=Number(c.budget)||0;
  }else{
    $('txCategoryEditorTitle').textContent='Nova categoria';
    $('txCategoryName').value='';$('txCategoryBudget').value='0';
  }
  $('txCategoryName').focus();
}
$('txCategoryAdd').onclick=()=>openTxCategoryEditor('create');
$('txCategoryEdit').onclick=()=>{
  const index=db.settings.categories.findIndex(c=>c.name===$('category').value);
  if(index<0){alert('Seleciona primeiro uma categoria.');return;}
  openTxCategoryEditor('edit',index);
};
$('txCategoryCancel').onclick=()=>{$('txCategoryEditor').hidden=true};
$('txCategorySave').onclick=()=>{
  const name=$('txCategoryName').value.trim(),budget=Number($('txCategoryBudget').value);
  if(!validCategoryName(name,txCategoryMode==='edit'?txCategoryIndex:-1)){alert('O nome não pode estar vazio nem repetir outra categoria.');$('txCategoryName').focus();return;}
  if(!Number.isFinite(budget)||budget<0){alert('Indica um limite válido (zero ou superior).');$('txCategoryBudget').focus();return;}
  if(txCategoryMode==='edit'){
    const c=db.settings.categories[txCategoryIndex];if(!c)return;
    const previous=c.name;c.name=name;c.budget=budget;
    if(previous!==name){db.transactions.forEach(t=>{if(t.category===previous)t.category=name;});db.recurringExpenses?.forEach(r=>{if(r.category===previous)r.category=name;});db.settings.categoryRules?.forEach(rl=>{if(rl.category===previous)rl.category=name;});}
  }else{
    db.settings.categories.push({name,budget});
  }
  persist();
  $('category').value=name;
  $('txCategoryEditor').hidden=true;
};
$('newCategoryForm').onsubmit=e=>{
  e.preventDefault();
  const name=$('newCategoryName').value.trim(), budget=+$('newCategoryBudget').value;
  if(!validCategoryName(name)){alert('Indique um nome válido e diferente das categorias existentes.');return;}
  if(!Number.isFinite(budget)||budget<0){alert('Indique um limite válido.');return;}
  db.settings.categories.push({name,budget});
  $('newCategoryForm').reset();$('newCategoryBudget').value='0';
  persist();showToast('Categoria adicionada.',{type:'success'});
};
$('categoryManager').addEventListener('click',e=>{
  const save=e.target.closest('[data-cat-save]');
  const del=e.target.closest('[data-cat-delete]');
  if(save){
    const i=Number(save.dataset.catSave), row=document.querySelector(`[data-category-row="${i}"]`);
    if(!db.settings.categories[i]||!row)return;
    const name=row.querySelector('[data-cat-name]').value.trim(), budget=+row.querySelector('[data-cat-budget]').value;
    if(!validCategoryName(name,i)){alert('O nome não pode estar vazio nem repetir outra categoria.');return;}
    if(!Number.isFinite(budget)||budget<0){alert('Indique um limite válido.');return;}
    const previous=db.settings.categories[i].name;
    db.settings.categories[i]={name,budget};
    if(previous!==name){db.transactions.forEach(t=>{if(t.category===previous)t.category=name;});db.recurringExpenses?.forEach(r=>{if(r.category===previous)r.category=name;});db.settings.categoryRules?.forEach(rl=>{if(rl.category===previous)rl.category=name;});}
    persist();showToast('Categoria atualizada.',{type:'success'});
  }
  if(del){
    const i=Number(del.dataset.catDelete), cat=db.settings.categories[i];
    if(!cat)return;
    if(db.settings.categories.length<=1){alert('É necessário manter pelo menos uma categoria.');return;}
    const used=db.transactions.filter(t=>t.category===cat.name);
    let replacement=null;
    if(used.length){
      const choices=db.settings.categories.filter((c,j)=>j!==i).map(c=>c.name);
      const answer=prompt('Esta categoria está associada a '+used.length+' movimento(s). Escreva exatamente o nome da categoria de destino:\n'+choices.join('\n'));
      if(answer===null)return;
      replacement=choices.find(n=>n.toLocaleLowerCase('pt-PT')===answer.trim().toLocaleLowerCase('pt-PT'));
      if(!replacement){alert('Categoria de destino não reconhecida. Nada foi alterado.');return;}
      if(!confirm('Os '+used.length+' movimento(s) serão reclassificados como "'+replacement+'". Continuar?'))return;
      db.transactions.forEach(t=>{if(t.category===cat.name)t.category=replacement;});db.recurringExpenses?.forEach(r=>{if(r.category===cat.name)r.category=replacement;});
    } else if(!confirm('Eliminar a categoria "'+cat.name+'"?')) return;
    db.settings.categories.splice(i,1);
    persist();
  }
});

$('budgetFields').addEventListener('input',updateBudget);

$('autoAdjustBudgetsToggle').onchange=e=>{
 db.settings.autoAdjustBudgets=e.target.checked;
 if(db.settings.autoAdjustBudgets)runAutoBudgetAdjustment(true);
 persist();
 showToast(db.settings.autoAdjustBudgets?'Auto-ajuste inteligente ativado.':'Auto-ajuste inteligente desativado.',{type:'success'});
};

$('applyAllSmartBudgetsBtn').onclick=()=>{
 const insights=computeSmartBudgetInsights();
 let count=0;
 const nowTs=Date.now();
 insights.categories.forEach(st=>{
   if(!st.locked&&st.hasSample&&Math.abs(st.suggestedBudget-st.currentBudget)>=1){
     db.settings.categories[st.index].budget=st.suggestedBudget;
     db.settings.categories[st.index].updatedAt=nowTs;
     count++;
   }
 });
 if(!count){
   showToast('Os limites já estão alinhados com a média real dos últimos ciclos.');
   return;
 }
 persist();
 showToast(`${count} categoria(s) ajustada(s) à média real (dentro das receitas).`,{type:'success'});
};

$('balanceToIncomeBtn').onclick=()=>{
 const refInc=getReferenceMonthlyIncome();
 if(refInc<=0){
   showToast('Regista primeiro rendimentos ou define um rendimento de referência.',{type:'error'});
   return;
 }
 const inputs=[...document.querySelectorAll('[data-budget]')];
 const vals=inputs.map(inp=>({idx:+inp.dataset.budget,val:Math.max(0,+inp.value||0),locked:!!db.settings.categories[+inp.dataset.budget]?.locked}));
 const lockedSum=vals.filter(x=>x.locked).reduce((s,x)=>s+x.val,0);
 const unlockedSum=vals.filter(x=>!x.locked).reduce((s,x)=>s+x.val,0);
 const available=Math.max(0,refInc-lockedSum);
 if(unlockedSum<=0){
   showToast('Desbloqueia pelo menos uma categoria para redistribuir o valor.',{type:'error'});
   return;
 }
 const ratio=available/unlockedSum;
 const nowTs=Date.now();
 vals.forEach(x=>{
   if(!x.locked){
     const adjusted=roundSmartBudget(x.val*ratio);
     db.settings.categories[x.idx].budget=adjusted;
     db.settings.categories[x.idx].updatedAt=nowTs;
   }
 });
 // Garantir que não ultrapassa nem 1 euro após arredondamento
 let totalAfter=db.settings.categories.reduce((s,c)=>s+(Number(c.budget)||0),0);
 if(totalAfter>refInc){
   const biggest=db.settings.categories.filter(c=>!c.locked&&c.budget>0).sort((a,b)=>b.budget-a.budget)[0];
   if(biggest)biggest.budget=Math.max(0,Math.floor(biggest.budget-(totalAfter-refInc)));
 }
 persist();
 showToast(`Orçamento enquadrado dentro das receitas (${eur(refInc)}).`,{type:'success'});
};

$('budgetFields').addEventListener('click',e=>{
 const applyBtn=e.target.closest('[data-apply-smart]');
 if(applyBtn){
   const idx=+applyBtn.dataset.applySmart;
   const val=+applyBtn.dataset.smartVal;
   if(db.settings.categories[idx]){
     db.settings.categories[idx].budget=val;
     db.settings.categories[idx].updatedAt=Date.now();
     persist();
     showToast(`Limite de «${db.settings.categories[idx].name}» ajustado para ${eur(val)}.`,{type:'success'});
   }
   return;
 }
 const lockBtn=e.target.closest('[data-toggle-lock]');
 if(lockBtn){
   const idx=+lockBtn.dataset.toggleLock;
   const cat=db.settings.categories[idx];
   if(cat){
     cat.locked=!cat.locked;
     cat.updatedAt=Date.now();
     persist();
     showToast(cat.locked?`«${cat.name}» bloqueada (teto fixo).`:`«${cat.name}» desbloqueada para sugestões.`);
   }
 }
});

$('alerts').addEventListener('click',e=>{
 const qBtn=e.target.closest('[data-quick-adapt-cat]');
 if(!qBtn)return;
 const idx=+qBtn.dataset.quickAdaptCat;
 const val=+qBtn.dataset.smartVal;
 if(db.settings.categories[idx]){
   db.settings.categories[idx].budget=val;
   db.settings.categories[idx].updatedAt=Date.now();
   persist();
   showToast(`Limite de «${db.settings.categories[idx].name}» atualizado para ${eur(val)}.`,{type:'success'});
 }
});

// Interação de deslize (touch/rato) e escolha de ocultação nos cartões de aviso
let alertSwipeState = null;

$('alerts').addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  const wrap = e.target.closest('[data-swipe-alert]');
  if (!wrap) return;
  const card = wrap.querySelector('.alert');
  alertSwipeState = {
    wrap,
    card,
    id: wrap.dataset.swipeAlert,
    startX: e.clientX,
    startY: e.clientY,
    dx: 0,
    lockedHorizontal: false
  };
});

window.addEventListener('pointermove', e => {
  if (!alertSwipeState) return;
  const dx = e.clientX - alertSwipeState.startX;
  const dy = e.clientY - alertSwipeState.startY;
  if (!alertSwipeState.lockedHorizontal) {
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      alertSwipeState = null;
      return;
    }
    if (Math.abs(dx) > 8) {
      alertSwipeState.lockedHorizontal = true;
      alertSwipeState.wrap.classList.add('is-dragging');
    }
  }
  if (alertSwipeState && alertSwipeState.lockedHorizontal) {
    alertSwipeState.dx = dx;
    alertSwipeState.card.style.transform = `translateX(${dx}px)`;
    alertSwipeState.card.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 220));
  }
});

window.addEventListener('pointerup', () => {
  if (!alertSwipeState) return;
  const { wrap, card, id, dx, lockedHorizontal } = alertSwipeState;
  alertSwipeState = null;
  wrap.classList.remove('is-dragging');
  if (lockedHorizontal && Math.abs(dx) >= 75) {
    pendingAlertChoiceId = id;
    render();
  } else {
    card.style.transform = '';
    card.style.opacity = '';
  }
});

$('alerts').addEventListener('click', e => {
  const askBtn = e.target.closest('[data-alert-ask-hide]');
  if (askBtn) {
    pendingAlertChoiceId = askBtn.dataset.alertAskHide;
    render();
    return;
  }
  const nowBtn = e.target.closest('[data-alert-hide-now()]');
  if (nowBtn && activeCycle) {
    dismissAlertForNow(activeCycle.key, nowBtn.dataset.alertHideNow);
    return;
  }
  const cycleBtn = e.target.closest('[data-alert-hide-cycle]');
  if (cycleBtn && activeCycle) {
    dismissAlertForCycle(activeCycle.key, cycleBtn.dataset.alertHideCycle);
    showToast('Aviso ocultado até ao próximo ciclo.');
    return;
  }
  if (e.target.closest('[data-alert-cancel-hide]')) {
    pendingAlertChoiceId = null;
    render();
    return;
  }
  if (e.target.closest('[data-restore-alerts]') && activeCycle) {
    restoreDismissedAlerts(activeCycle.key);
    showToast('Avisos do ciclo restaurados.');
  }
});

$('budgetForm').onsubmit=e=>{e.preventDefault();document.querySelectorAll('[data-budget]').forEach(x=>{const c=db.settings.categories[+x.dataset.budget];c.budget=Math.max(0,+x.value||0);c.updatedAt=Date.now();});persist();showToast('Limites de orçamento guardados.',{type:'success'})};
$('saveIncome').onclick=()=>{db.settings.income=+$('incomePlan').value||0;persist();showToast('Rendimento de referência guardado.',{type:'success'})};
$('savePeople').onclick=()=>{
  let old=db.settings.people;
  db.settings.people=[$('adult1').value.trim()||'Adulto 1',$('adult2').value.trim()||'Adulto 2'];
  db.transactions.forEach(t=>{if(t.person===old[0])t.person=db.settings.people[0];if(t.person===old[1])t.person=db.settings.people[1]});
  $('person').innerHTML=db.settings.people.map(p=>`<option>${esc(p)}</option>`).join('')+'<option>Conta conjunta</option>';
  updateSavingGoalOptions();persist();showToast('Nomes dos adultos guardados.',{type:'success'});
};

// Objetivos
let editingGoalId=null;
function resetGoalForm(){editingGoalId=null;$('goalForm').reset();$('goalId').value='';$('goalFormTitle').textContent='Criar objetivo de poupança';$('goalSave').textContent='Guardar objetivo';$('goalCancel').hidden=true;}
function editGoal(g){editingGoalId=g.id;$('goalId').value=g.id;$('goalName').value=g.name;$('goalTarget').value=Number(g.target)||'';$('goalDeadline').value=g.deadline||'';$('goalFormTitle').textContent='Editar objetivo';$('goalSave').textContent='Guardar alterações';$('goalCancel').hidden=false;$('goalFormTitle').scrollIntoView({behavior:'smooth',block:'start'});}
$('goalForm').onsubmit=e=>{
 e.preventDefault();
 const name=$('goalName').value.trim(),target=Number($('goalTarget').value),deadline=$('goalDeadline').value;
 if(!name||!Number.isFinite(target)||target<=0){alert('Indica um nome e um montante-alvo válido.');return;}
 if(deadline&&!validDate(deadline)){alert('A data-limite não é válida.');return;}
 const duplicate=db.savingsGoals.some(g=>g.id!==editingGoalId&&g.name.trim().toLocaleLowerCase('pt-PT')===name.toLocaleLowerCase('pt-PT'));
 if(duplicate){alert('Já existe um objetivo com esse nome.');return;}
 if(editingGoalId){const g=db.savingsGoals.find(x=>x.id===editingGoalId);if(!g)return;Object.assign(g,{name,target,deadline:deadline||null,updatedAt:Date.now()});}
 else{db.savingsGoals.push({id:'goal-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name,target,deadline:deadline||null,status:'active',legacyTransactionIds:[],updatedAt:Date.now()});}
 resetGoalForm();persist();
};
$('goalCancel').onclick=resetGoalForm;
$('goalList').addEventListener('click',e=>{
 const edit=e.target.closest('[data-goal-edit]'),toggle=e.target.closest('[data-goal-toggle]'),complete=e.target.closest('[data-goal-complete]'),assign=e.target.closest('[data-goal-assign]'),remove=e.target.closest('[data-goal-remove-tx]');
 if(edit){const g=db.savingsGoals.find(x=>x.id===edit.dataset.goalEdit);if(g)editGoal(g);return;}
 if(toggle){const g=db.savingsGoals.find(x=>x.id===toggle.dataset.goalToggle);if(g){g.status=g.status==='paused'?'active':'paused';g.updatedAt=Date.now();persist();}return;}
 if(complete){const g=db.savingsGoals.find(x=>x.id===complete.dataset.goalComplete);if(g){g.status=g.status==='completed'?'active':'completed';g.updatedAt=Date.now();persist();}return;}
 if(assign){
   const g=db.savingsGoals.find(x=>x.id===assign.dataset.goalAssign);
   const select=$('goalList').querySelector(`[data-goal-assign-select="${g?.id||''}"]`);
   const tx=db.transactions.find(t=>String(t.id)===String(select?.value));
   if(!g||!tx||!isSavingTx(tx))return;
   const old=db.savingsGoals.find(x=>x.id===tx.goalId)||db.savingsGoals.find(x=>(x.legacyTransactionIds||[]).map(String).includes(String(tx.id))&&!tx.goalId);
   if(old&&old.id!==g.id&&!confirm('Este movimento será retirado do objetivo «'+old.name+'» e atribuído a «'+g.name+'». Continuar?'))return;
   if(old&&old.id!==g.id&&!tx.goalId)old.legacyTransactionIds=(old.legacyTransactionIds||[]).filter(id=>String(id)!==String(tx.id));
   tx.goalId=g.id;tx.updatedAt=Date.now();persist();return;
 }
 if(remove){
   const g=db.savingsGoals.find(x=>x.id===remove.dataset.goalRemoveFrom),tx=db.transactions.find(t=>String(t.id)===remove.dataset.goalRemoveTx);
   if(!g||!tx)return;
   if(!confirm('Retirar este movimento do objetivo? O movimento será preservado no histórico.'))return;
   if(tx.goalId===g.id)delete tx.goalId;
   tx.updatedAt=Date.now();
   g.legacyTransactionIds=(g.legacyTransactionIds||[]).filter(id=>String(id)!==String(tx.id));
   persist();
 }
});

$('saveCycleGrouping').onclick=()=>{const n=Number($('cycleGroupingDays').value);if(!Number.isInteger(n)||n<0||n>20){alert('Indica um número inteiro entre 0 e 20 dias.');return;}db.settings.cycleGroupingDays=n;selectedCycleKey=null;persist();showToast('Definição dos ciclos guardada.',{type:'success'});};
function shift(n){let d=new Date(($('calendarMonth').value||cur())+'-02T12:00:00');d.setMonth(d.getMonth()+n);$('calendarMonth').value=iso(d).slice(0,7);selected=iso(d).slice(0,7)+'-01';drawCalendar()}
$('prev').onclick=()=>shift(-1);$('next').onclick=()=>shift(1);

// ============================================================================
// MODAL DE NOVIDADES DA VERSÃO (CHANGELOG v6.5.0)
// ============================================================================
function openChangelogModal(){
 const m=$('changelogModal');
 if(m)m.hidden=false;
}
function closeChangelogModal(){
 const m=$('changelogModal');
 if(m)m.hidden=true;
 localStorage.setItem(CHANGELOG_KEY,APP_VERSION);
}
if($('versionBadgeBtn'))$('versionBadgeBtn').onclick=openChangelogModal;
if($('openChangelogBtn'))$('openChangelogBtn').onclick=openChangelogModal;
if($('closeChangelogBtn'))$('closeChangelogBtn').onclick=closeChangelogModal;
if($('confirmChangelogBtn'))$('confirmChangelogBtn').onclick=closeChangelogModal;
if($('changelogModal'))$('changelogModal').addEventListener('click',e=>{
 if(e.target===$('changelogModal'))closeChangelogModal();
});

// ============================================================================
// CAMADA DE SEGURANÇA & PRIVACIDADE
// Web Crypto API (AES-256-GCM + PBKDF2 + SHA-256), PIN Local, WebAuthn, E2EE
// ============================================================================
const SEC_KEY='duofin-security-v1';
const secDefaults={pinHash:'',pinSalt:'',autoLockMin:5,bioCredId:'',privacyMask:false};
let secCfg=(()=>{try{return {...secDefaults,...JSON.parse(localStorage.getItem(SEC_KEY)||'{}')}}catch(e){return {...secDefaults}}})();
function saveSecCfg(){localStorage.setItem(SEC_KEY,JSON.stringify(secCfg));}

// Modo Privacidade (Ocultar valores monetários)
function applyPrivacyMask(){
  document.body.classList.toggle('privacy-masked',!!secCfg.privacyMask);
  const btn=$('privacyToggleBtn');
  if(btn){
    btn.classList.toggle('is-active',!!secCfg.privacyMask);
    btn.title=secCfg.privacyMask?'Mostrar valores monetários':'Ocultar valores monetários';
  }
  hideChartTooltip('chartTooltip');
  hideChartTooltip('analyticsTooltip');
}
function togglePrivacyMask(){
  secCfg.privacyMask=!secCfg.privacyMask;
  saveSecCfg();
  applyPrivacyMask();
  showToast(secCfg.privacyMask?'Modo privacidade ativado (valores ocultos).':'Valores monetários visíveis.');
}
if($('privacyToggleBtn'))$('privacyToggleBtn').onclick=togglePrivacyMask;
if($('togglePrivacyCardBtn'))$('togglePrivacyCardBtn').onclick=togglePrivacyMask;
applyPrivacyMask();

// Bloqueio Local por PIN e Biometria (WebAuthn)
let appLocked=false;
let lastActivityTs=Date.now();
function hasLocalPin(){return !!(secCfg.pinHash&&secCfg.pinSalt);}

function updatePinDots(val){
  const dots=$('pinDotsDisplay')?.querySelectorAll('span')||[];
  dots.forEach((s,i)=>s.classList.toggle('filled',i<val.length));
}

function lockApp(){
  if(!hasLocalPin())return;
  appLocked=true;
  const ov=$('appLockOverlay');
  if(ov)ov.hidden=false;
  if($('appLockPinInput')){$('appLockPinInput').value='';$('appLockPinInput').focus();}
  if($('appLockError'))$('appLockError').textContent='';
  updatePinDots('');
  if($('appLockBioBtn'))$('appLockBioBtn').hidden=!secCfg.bioCredId;
}

function unlockAppSuccess(){
  appLocked=false;
  lastActivityTs=Date.now();
  const ov=$('appLockOverlay');
  if(ov)ov.hidden=true;
  if($('appLockPinInput'))$('appLockPinInput').value='';
  if($('appLockError'))$('appLockError').textContent='';
  updatePinDots('');
}

async function verifyPinAndUnlock(){
  const pin=($('appLockPinInput')?.value||'').trim();
  if(!/^\d{4,6}$/.test(pin)){
    $('appLockError').textContent='Introduz um PIN de 4 a 6 dígitos.';
    return;
  }
  const h=await hashPinWithSalt(pin,secCfg.pinSalt);
  if(h===secCfg.pinHash){
    unlockAppSuccess();
  }else{
    $('appLockError').textContent='PIN incorreto. Tenta novamente.';
    $('appLockPinInput').value='';
    updatePinDots('');
  }
}

async function registerWebAuthnBio(){
  if(!window.PublicKeyCredential||!navigator.credentials){
    alert('Este navegador ou dispositivo não suporta autenticação biométrica WebAuthn.');
    return;
  }
  try{
    const userId=randomBytes(16);
    const challenge=randomBytes(32);
    const cred=await navigator.credentials.create({
      publicKey:{
        challenge,
        rp:{name:'DuoFin'},
        user:{id:userId,name:'duofin-local-user',displayName:'Utilizador DuoFin'},
        pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
        authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},
        timeout:60000
      }
    });
    if(cred&&cred.rawId){
      secCfg.bioCredId=bufToB64(cred.rawId);
      saveSecCfg();
      paintSecurityCard();
      showToast('Biometria do dispositivo ativada com sucesso.',{type:'success'});
    }
  }catch(e){
    alert('Não foi possível ativar a biometria: '+(e.message||'operação cancelada'));
  }
}

async function unlockWithWebAuthnBio(){
  if(!secCfg.bioCredId||!navigator.credentials)return;
  try{
    const challenge=randomBytes(32);
    const assertion=await navigator.credentials.get({
      publicKey:{
        challenge,
        allowCredentials:[{id:b64ToBuf(secCfg.bioCredId),type:'public-key'}],
        userVerification:'required',
        timeout:60000
      }
    });
    if(assertion)unlockAppSuccess();
  }catch(e){
    if($('appLockError'))$('appLockError').textContent='Verificação biométrica não concluída. Usa o PIN.';
  }
}

function paintSecurityCard(){
  const active=hasLocalPin();
  if($('lockAppHeaderBtn'))$('lockAppHeaderBtn').hidden=!active;
  if($('lockNowBtn'))$('lockNowBtn').hidden=!active;
  if($('disablePinBtn'))$('disablePinBtn').hidden=!active;
  if($('enableBioBtn'))$('enableBioBtn').hidden=!active||!window.PublicKeyCredential;
  if($('autoLockMinutes'))$('autoLockMinutes').value=String(secCfg.autoLockMin??5);
  const st=$('securityLockStatus');
  if(st){
    if(active){
      st.className='alert good';
      st.textContent='Bloqueio local ativo (PIN SHA-256'+(secCfg.bioCredId?' + Biometria':'')+' · bloqueio automático: '+(Number(secCfg.autoLockMin)>0?secCfg.autoLockMin+' min':'manual')+').';
    }else{
      st.className='alert';
      st.textContent='Bloqueio por PIN desativado neste dispositivo.';
    }
  }
}

if($('savePinBtn'))$('savePinBtn').onclick=async()=>{
  const pin=($('newPinInput')?.value||'').trim();
  if(!/^\d{4,6}$/.test(pin)){alert('O PIN deve ter entre 4 e 6 dígitos numéricos.');return;}
  const salt=bufToB64(randomBytes(16));
  const hash=await hashPinWithSalt(pin,salt);
  secCfg.pinSalt=salt;
  secCfg.pinHash=hash;
  secCfg.autoLockMin=Number($('autoLockMinutes')?.value||5);
  saveSecCfg();
  $('newPinInput').value='';
  paintSecurityCard();
  showToast('PIN de segurança guardado neste dispositivo.',{type:'success'});
};
if($('autoLockMinutes'))$('autoLockMinutes').onchange=()=>{
  secCfg.autoLockMin=Number($('autoLockMinutes').value||0);
  saveSecCfg();
  paintSecurityCard();
};
if($('disablePinBtn'))$('disablePinBtn').onclick=()=>{
  if(!confirm('Remover o bloqueio por PIN e biometria deste dispositivo?'))return;
  secCfg.pinHash='';secCfg.pinSalt='';secCfg.bioCredId='';
  saveSecCfg();
  paintSecurityCard();
  showToast('Bloqueio local desativado.');
};
if($('enableBioBtn'))$('enableBioBtn').onclick=registerWebAuthnBio;
if($('lockNowBtn'))$('lockNowBtn').onclick=lockApp;
if($('lockAppHeaderBtn'))$('lockAppHeaderBtn').onclick=lockApp;
if($('appLockUnlockBtn'))$('appLockUnlockBtn').onclick=verifyPinAndUnlock;
if($('appLockBioBtn'))$('appLockBioBtn').onclick=unlockWithWebAuthnBio;
if($('appLockPinInput')){
  $('appLockPinInput').addEventListener('input',e=>{
    const clean=e.target.value.replace(/\D/g,'').slice(0,6);
    e.target.value=clean;
    updatePinDots(clean);
    if(secCfg.pinHash&&clean.length>=4){
      hashPinWithSalt(clean,secCfg.pinSalt).then(h=>{if(h===secCfg.pinHash)unlockAppSuccess();});
    }
  });
  $('appLockPinInput').addEventListener('keydown',e=>{if(e.key==='Enter')verifyPinAndUnlock();});
}

// Monitorizar inatividade para auto-bloqueio
['pointerdown','keydown','touchstart','scroll'].forEach(ev=>{
  document.addEventListener(ev,()=>{if(!appLocked)lastActivityTs=Date.now();},{passive:true});
});
setInterval(()=>{
  if(!hasLocalPin()||appLocked)return;
  const mins=Number(secCfg.autoLockMin||0);
  if(mins>0&&Date.now()-lastActivityTs>=mins*60000)lockApp();
},10000);

paintSecurityCard();
if(hasLocalPin())lockApp();

// Exportação e Importação de Cópias de Segurança (Simples ou Encriptada AES-256-GCM)
$('export').onclick=()=>{
  let a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));
  a.href=u;a.download='duofin-backup.json';a.click();URL.revokeObjectURL(u);
};
if($('exportEncryptedBtn'))$('exportEncryptedBtn').onclick=async()=>{
  const pass=prompt('Define uma palavra-passe para proteger esta cópia de segurança (mínimo 6 caracteres):');
  if(pass===null)return;
  if(pass.trim().length<6){alert('A palavra-passe deve ter pelo menos 6 caracteres.');return;}
  try{
    const encrypted=await encryptJsonAesGcm(db,pass.trim());
    const a=document.createElement('a');
    const u=URL.createObjectURL(new Blob([JSON.stringify(encrypted,null,2)],{type:'application/json'}));
    a.href=u;a.download='duofin-backup-protegido.duofin';a.click();URL.revokeObjectURL(u);
    showToast('Cópia de segurança encriptada exportada.',{type:'success'});
  }catch(e){
    alert('Não foi possível encriptar a cópia: '+e.message);
  }
};
$('import').onchange=async e=>{
  try{
    const rawText=await e.target.files[0].text();
    let parsed=JSON.parse(rawText);
    if(parsed&&parsed.__duofin_encrypted__===true){
      const pass=prompt('Esta cópia está encriptada. Introduz a palavra-passe:');
      if(!pass){e.target.value='';return;}
      parsed=await decryptJsonAesGcm(parsed,pass.trim());
    }
    if(!parsed.settings||!Array.isArray(parsed.transactions))throw new Error('Estrutura inválida');
    await createAutoSnapshot(db, 'Antes de importar cópia');
    const n=normalizeDb(parsed);
    db=n.db;
    refreshSnapshotsUI();
    persist();
    showToast('Cópia de segurança importada com sucesso.',{type:'success'});
  }catch(_){
    alert('Ficheiro inválido ou palavra-passe incorreta.');
  }
  e.target.value='';
};
$('reset').onclick=async()=>{if(confirm('Apagar todos os dados deste dispositivo?')){await createAutoSnapshot(db, 'Antes de repor dados');db=fresh();persist();refreshSnapshotsUI();}};
$('person').innerHTML=db.settings.people.map(p=>`<option>${esc(p)}</option>`).join('')+'<option>Conta conjunta</option>';

// Preferências visuais locais
const UI_PREF_KEY='duofin-ui-preferences-v1';
const uiDefaults={theme:'auto',density:'balanced'};
function readUiPrefs(){try{return {...uiDefaults,...JSON.parse(localStorage.getItem(UI_PREF_KEY)||'{}')}}catch(e){return {...uiDefaults}}}
let uiPrefs=readUiPrefs();
function applyUiPrefs(){
  const root=document.documentElement;
  root.classList.remove('theme-dark','density-compact','density-detailed');
  const systemDark=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark=uiPrefs.theme==='dark'||(uiPrefs.theme==='auto'&&systemDark);
  if(isDark)root.classList.add('theme-dark');
  const metaTheme=$('metaThemeColor');
  if(metaTheme)metaTheme.setAttribute('content',isDark?'#0f1924':'#142b45');
  if(uiPrefs.density==='compact')root.classList.add('density-compact');
  if(uiPrefs.density==='detailed')root.classList.add('density-detailed');
  requestAnimationFrame(()=>{drawChart();drawAnalyticsChart();});
}
function saveUiPrefs(){uiPrefs.theme=$('themeMode').value;uiPrefs.density=$('densityMode').value;localStorage.setItem(UI_PREF_KEY,JSON.stringify(uiPrefs));applyUiPrefs();}
$('themeMode').value=uiPrefs.theme;$('densityMode').value=uiPrefs.density;$('themeMode').onchange=saveUiPrefs;$('densityMode').onchange=saveUiPrefs;
applyUiPrefs();
if(window.matchMedia){
  const colorQuery=window.matchMedia('(prefers-color-scheme: dark)');
  if(colorQuery.addEventListener)colorQuery.addEventListener('change',()=>{if(uiPrefs.theme==='auto')applyUiPrefs()});
  else if(colorQuery.addListener)colorQuery.addListener(()=>{if(uiPrefs.theme==='auto')applyUiPrefs()});
}

// Instalação PWA
let installPrompt=null;
const installBtn=$('installApp');
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;installBtn.hidden=false;$('installHint').textContent='Este navegador permite instalar a DuoFin como aplicação opcional.'});
installBtn.onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;installBtn.hidden=true};
addEventListener('appinstalled',()=>{$('installHint').textContent='DuoFin adicionada ao dispositivo. Também podes continuar a utilizar o endereço no navegador.';installBtn.hidden=true});


// ============================================================================
// HISTÓRICO DE VERSÕES & RESTAURO COM 1 CLIQUE (INDEXEDDB SNAPSHOTS - v6.7.0)
// ============================================================================
async function refreshSnapshotsUI() {
  const listEl = $('snapshotsList');
  if (!listEl) return;
  const items = await listSnapshots();
  if (!items.length) {
    listEl.innerHTML = '<div class="small" style="padding:8px 0;color:var(--muted)">Ainda não existem cópias automáticas guardadas neste dispositivo. São criadas automaticamente antes de fusões na nuvem, importações ou reposições.</div>';
    return;
  }
  listEl.innerHTML = items.map(snap => {
    const dt = new Date(snap.createdAt).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    return `<div class="snapshot-item">
      <div class="snapshot-meta">
        <div class="snapshot-title">${esc(snap.reason || 'Cópia automática')}</div>
        <div class="small">${esc(dt)} · ${snap.txCount} movimento(s) · ${snap.goalCount || 0} objetivo(s)</div>
      </div>
      <button type="button" class="secondary snapshot-restore-btn" data-restore-snap="${snap.id}">Restaurar</button>
    </div>`;
  }).join('');
}

if ($('createManualSnapshotBtn')) {
  $('createManualSnapshotBtn').onclick = async () => {
    const saved = await createAutoSnapshot(db, 'Ponto de restauro manual');
    if (saved) {
      await refreshSnapshotsUI();
      showToast('Ponto de restauro guardado no navegador.', { type: 'success' });
    } else {
      showToast('Não foi possível criar o ponto de restauro.', { type: 'error' });
    }
  };
}

if ($('snapshotsList')) {
  $('snapshotsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-restore-snap]');
    if (!btn) return;
    const snapId = Number(btn.dataset.restoreSnap);
    const snap = await getSnapshotById(snapId);
    if (!snap || !snap.data) {
      showToast('Cópia não encontrada.', { type: 'error' });
      return;
    }
    const dt = new Date(snap.createdAt).toLocaleString('pt-PT');
    if (!confirm(`Restaurar a cópia de ${dt} (${snap.txCount} movimentos)?\nSerá guardada uma cópia de segurança do estado atual antes de restaurar.`)) {
      return;
    }
    await createAutoSnapshot(db, 'Antes de restaurar versão anterior');
    const n = normalizeDb(snap.data);
    db = n.db;
    persist();
    await refreshSnapshotsUI();
    showToast('Versão anterior restaurada com sucesso!', { type: 'success' });
  });
}

// ============================================================================
// INICIALIZAÇÃO DOS MÓDULOS ES & ARRANQUE DA APLICAÇÃO (v6.7.0)
// ============================================================================
const sharedContext = {
  get db() { return db; },
  setDb(newDb) { db = newDb; },
  KEY,
  fresh,
  normalizeDb,
  persist,
  render,
  now,
  iso,
  cur,
  eur,
  esc,
  sum,
  isPaid,
  mName,
  capFirst,
  addDays,
  daysBetween,
  monthLast,
  fmtDate,
  validDate,
  monthIndex,
  dueDate,
  haptic,
  showToast,
  runAutoBudgetAdjustment,
  updateSavingGoalOptions,
  generateDueOccurrences,
  buildCycles,
  cycleTransactions,
  cycleName,
  computeCycleReferenceMonth,
  getSelectedCycleKey: () => selectedCycleKey,
  getActiveCycle: () => activeCycle,
  getActiveCycles: () => activeCycles,
  setSelectedCycleState(key, cyc, list) {
    selectedCycleKey = key;
    activeCycle = cyc;
    activeCycles = list;
  },
  refreshSnapshotsUI
};

initCyclesModule(sharedContext);
bindRolloverEvents();
initChartsModule(sharedContext);
initParserModule(sharedContext);
initSyncModule(sharedContext, dbNeedsSync);

render();
refreshSnapshotsUI();
if (!cloudConnected() && generateDueOccurrences()) render();
if (cloudConnected()) {
  refreshToken()
    .then(afterLogin)
    .catch(e => cloudMessage('A sessão expirou. Inicia sessão novamente: ' + e.message, 'alert red'));
}

// Mostrar modal de novidades uma única vez após atualização para v6.7.0
if(!appLocked && localStorage.getItem(CHANGELOG_KEY)!==APP_VERSION){
  setTimeout(openChangelogModal, 450);
}

if('serviceWorker'in navigator&&location.protocol.startsWith('http'))addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
