const $=id=>document.getElementById(id),KEY='orcamento-plus-v1',now=new Date(),iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),cur=iso(now).slice(0,7);
const APP_VERSION='v6.6.0';
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

let db=load(),selected=iso(now),selectedCycleKey=null,activeCycle=null,activeCycles=[];
const eur=n=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(+n||0),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((s,t)=>s+(Number(t.amount)||0),0),isPaid=t=>t.status!=='pending'&&t.status!=='skipped',mName=m=>new Date(m+'-02T12:00:00').toLocaleDateString('pt-PT',{month:'long',year:'numeric'});
const capFirst=s=>s?s.charAt(0).toUpperCase()+s.slice(1):'';
const DAY_MS=86400000,dateMs=s=>Date.parse(s+'T00:00:00Z'),validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(dateMs(s)),addDays=(s,n)=>new Date(dateMs(s)+n*DAY_MS).toISOString().slice(0,10),daysBetween=(a,b)=>Math.round((dateMs(b)-dateMs(a))/DAY_MS),monthLast=m=>{const [y,mo]=m.split('-').map(Number);return `${m}-${String(new Date(y,mo,0).getDate()).padStart(2,'0')}`},fmtDate=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});
const isSavingTx=t=>t&&(t.type==='saving'||t.type==='saving_withdraw');
const savingSigned=t=>t.type==='saving_withdraw'?-(Number(t.amount)||0):(Number(t.amount)||0);

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
 const today=iso(now);
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

function addMonthsClamp(dateStr, monthsToAdd){
 const [y,m,d]=dateStr.split('-').map(Number);
 const totalM=(y*12+(m-1))+monthsToAdd;
 const ny=Math.floor(totalM/12),nm=(totalM%12)+1;
 const lastDay=new Date(ny,nm,0).getDate();
 return `${ny}-${String(nm).padStart(2,'0')}-${String(Math.min(d,lastDay)).padStart(2,'0')}`;
}

function computeCycleReferenceMonth(c){
 if(c.fallback)return capFirst(mName(c.key.slice(6)));
 if(c.preCycle)return 'Período inicial ('+capFirst(mName(c.end.slice(0,7)))+')';
 const [sy,sm,sd]=c.start.split('-').map(Number);
 let refY=sy,refM=sm;
 if(sd>=15){
   refM+=1;
   if(refM>12){refM=1;refY+=1;}
 }
 const refKey=`${refY}-${String(refM).padStart(2,'0')}`;
 return capFirst(mName(refKey));
}

function assignCycleMonthLabels(cycles){
 const counts={};
 cycles.forEach(c=>{
   const base=computeCycleReferenceMonth(c);
   c.monthLabel=base;
   counts[base]=(counts[base]||0)+1;
 });
 const seen={};
 cycles.forEach(c=>{
   if(counts[c.monthLabel]>1){
     seen[c.monthLabel]=(seen[c.monthLabel]||0)+1;
     c.monthLabel=`${c.monthLabel} (${seen[c.monthLabel]}.º)`;
   }
 });
 return cycles;
}

function buildCycles(){
 const today=iso(now),validTx=db.transactions.filter(t=>validDate(t.date)&&t.date<=today);
 const cycleIncomes=validTx.filter(t=>t.type==='income'&&isPaid(t)&&t.countsForCycle!==false).sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 if(!cycleIncomes.length){
   const monthKeys=[...new Set([...validTx.map(t=>t.date.slice(0,7)),cur])].sort();
   return assignCycleMonthLabels(monthKeys.map(m=>({key:'month:'+m,start:m+'-01',end:monthLast(m),fallback:true,preCycle:false,open:false,incomeDates:[],label:mName(m)})));
 }
 const maxGap=Math.max(0,Math.min(20,Math.round(Number(db.settings.cycleGroupingDays??14))));
 const groups=[];
 cycleIncomes.forEach(t=>{
   const g=groups[groups.length-1];
   if(g&&daysBetween(g.lastDate,t.date)<=maxGap){g.items.push(t);g.lastDate=t.date;}
   else groups.push({items:[t],firstDate:t.date,lastDate:t.date});
 });
 const cycles=[];
 const firstMovement=validTx.map(t=>t.date).sort()[0];
 if(firstMovement&&firstMovement<groups[0].firstDate){
   const preEnd=addDays(groups[0].firstDate,-1);
   cycles.push({key:'pre:'+firstMovement+':'+preEnd,start:firstMovement,end:preEnd,anchor:null,open:false,fallback:false,preCycle:true,incomeDates:[],incomeCount:0});
 }
 for(let i=0;i<groups.length;i++){
   const g=groups[i],next=groups[i+1];
   const start=g.firstDate;
   if(next){
     const end=addDays(next.firstDate,-1);
     cycles.push({key:'cycle:'+start+':'+end,start,end,anchor:g.lastDate,open:false,fallback:false,preCycle:false,incomeDates:g.items.map(t=>t.date),incomeCount:g.items.length});
   }else{
     const futureDates=db.transactions.filter(t=>validDate(t.date)&&t.date>today).map(t=>t.date).sort();
     const maxEnd=futureDates.length?futureDates[futureDates.length-1]:today;
     cycles.push({key:'open:'+start,start,end:maxEnd,anchor:g.lastDate,open:true,fallback:false,preCycle:false,incomeDates:g.items.map(t=>t.date),incomeCount:g.items.length});
   }
 }
 return assignCycleMonthLabels(cycles);
}

// CÁLCULO DE SALDO DE UM CICLO ESPECÍFICO
function computeCycleBalance(c, upToDate=iso(now)){
 const tx=cycleTransactions(c).filter(t=>t.date<=upToDate);
 const ex=tx.filter(t=>t.type==='expense'&&isPaid(t));
 const inc=tx.filter(t=>t.type==='income'&&isPaid(t));
 const svIn=tx.filter(t=>t.type==='saving'&&isPaid(t));
 const svOut=tx.filter(t=>t.type==='saving_withdraw'&&isPaid(t));
 return sum(inc)+sum(svOut)-sum(ex)-sum(svIn);
}

// GESTÃO INTERATIVA DE SOBRA DO CICLO ANTERIOR
let pendingRolloverCandidate=null;

function detectPreviousCycleRollover(cycles, selectedCycle){
 const curCyc=currentCycle(cycles);
 if(!curCyc||selectedCycle.key!==curCyc.key)return null;
 const idx=cycles.findIndex(c=>c.key===curCyc.key);
 if(idx<=0)return null;
 const prevCycle=cycles[idx-1];
 if(!prevCycle||prevCycle.fallback)return null;

 const handled=Array.isArray(db.handledCycleRollovers)?db.handledCycleRollovers:[];
 if(handled.some(h=>h&&h.cycleKey===prevCycle.key))return null;

 const prevBal=Number(computeCycleBalance(prevCycle,prevCycle.end).toFixed(2));
 if(prevBal<=0.009)return null;

 return {
   prevCycle,
   currentCycle:curCyc,
   amount:prevBal
 };
}

function renderRolloverBanner(cycles, selectedCycle){
 const banner=$('cycleRolloverBanner');
 if(!banner)return;
 const candidate=detectPreviousCycleRollover(cycles,selectedCycle);
 pendingRolloverCandidate=candidate;
 if(!candidate){
   banner.hidden=true;
   return;
 }
 const prevName=candidate.prevCycle.monthLabel||computeCycleReferenceMonth(candidate.prevCycle);
 $('rolloverMessage').innerHTML=`O ciclo anterior (<strong>${esc(prevName)}</strong>) fechou com uma sobra de <span class="rollover-amount">${eur(candidate.amount)}</span>. O que pretendes fazer com este valor?`;
 $('rolloverMainActions').hidden=false;
 $('rolloverGoalPicker').hidden=true;
 banner.hidden=false;
}

$('rolloverCarryBtn').onclick=()=>{
 if(!pendingRolloverCandidate)return;
 const {prevCycle,currentCycle:curCyc,amount}=pendingRolloverCandidate;
 const prevName=prevCycle.monthLabel||computeCycleReferenceMonth(prevCycle);
 const nowTs=Date.now();
 const txId='rollover-in-'+nowTs.toString(36);
 db.transactions.push({
   id:txId,
   date:curCyc.start,
   type:'income',
   description:`Saldo transitado · ${prevName}`,
   amount:Number(amount.toFixed(2)),
   category:'Rendimento',
   person:'Conta conjunta',
   countsForCycle:false,
   updatedAt:nowTs
 });
 if(!Array.isArray(db.handledCycleRollovers))db.handledCycleRollovers=[];
 db.handledCycleRollovers.push({cycleKey:prevCycle.key,action:'carry_forward',amount,txId,at:nowTs});
 persist();
};

$('rolloverSaveStepBtn').onclick=()=>{
 if(!pendingRolloverCandidate)return;
 const goals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 const sel=$('rolloverGoalSelect');
 sel.innerHTML='<option value="">Poupança geral (sem objetivo específico)</option>'+goals.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 $('rolloverMainActions').hidden=true;
 $('rolloverGoalPicker').hidden=false;
};

$('rolloverCancelSaveBtn').onclick=()=>{
 $('rolloverGoalPicker').hidden=true;
 $('rolloverMainActions').hidden=false;
};

$('rolloverConfirmSaveBtn').onclick=()=>{
 if(!pendingRolloverCandidate)return;
 const {prevCycle,amount}=pendingRolloverCandidate;
 const prevName=prevCycle.monthLabel||computeCycleReferenceMonth(prevCycle);
 const goalId=$('rolloverGoalSelect').value;
 const goalObj=goalId?(db.savingsGoals||[]).find(g=>g.id===goalId):null;
 const nowTs=Date.now();
 const txId='rollover-sav-'+nowTs.toString(36);
 const entry={
   id:txId,
   date:prevCycle.end,
   type:'saving',
   description:goalObj?`Sobra de ${prevName} → ${goalObj.name}`:`Sobra de ${prevName} → Poupança`,
   amount:Number(amount.toFixed(2)),
   category:'Poupança',
   person:'Conta conjunta',
   updatedAt:nowTs
 };
 if(goalObj)entry.goalId=goalObj.id;
 db.transactions.push(entry);
 if(!Array.isArray(db.handledCycleRollovers))db.handledCycleRollovers=[];
 db.handledCycleRollovers.push({cycleKey:prevCycle.key,action:'saving',goalId:goalId||null,amount,txId,at:nowTs});
 persist();
};

$('rolloverDismissBtn').onclick=()=>{
 if(!pendingRolloverCandidate)return;
 const {prevCycle,amount}=pendingRolloverCandidate;
 if(!Array.isArray(db.handledCycleRollovers))db.handledCycleRollovers=[];
 db.handledCycleRollovers.push({cycleKey:prevCycle.key,action:'dismissed',amount,at:Date.now()});
 persist();
};

// PROJEÇÃO DE FECHO DE CICLO (SALDO REAL VS. PREVISTO INCLUINDO POUPANÇAS AGENDADAS)
function computeCycleProjection(cycle, currentBalance){
 const today=iso(now);
 if(!cycle.open&&cycle.end<=today)return null;

 const estimatedCycleEnd=cycle.open?addDays(addMonthsClamp(cycle.start,1),-1):cycle.end;
 const horizonEnd=estimatedCycleEnd>today?estimatedCycleEnd:today;

 // 1. Despesas pendentes já geradas dentro do ciclo até hoje
 const pendingInCycle=cycleTransactions(cycle).filter(t=>t.type==='expense'&&t.status==='pending'&&t.date<=today);

 // 2. Despesas futuras já agendadas (ex.: prestações) dentro do horizonte do ciclo
 const scheduledFutureExp=db.transactions.filter(t=>t.type==='expense'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

 // 3. Transferências e resgates de poupança futuros já agendados no horizonte do ciclo
 const scheduledFutureSavOut=db.transactions.filter(t=>t.type==='saving'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);
 const scheduledFutureSavIn=db.transactions.filter(t=>t.type==='saving_withdraw'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

 // 4. Regras de despesas recorrentes ativas que ainda vão vencer entre amanhã e o fim estimado do ciclo
 const startYm=today.slice(0,7),endYm=horizonEnd.slice(0,7);
 const fromIdx=monthIndex(startYm),toIdx=monthIndex(endYm);
 let upcomingRulesTotal=0,upcomingRulesCount=0;
 (db.recurringExpenses||[]).forEach(r=>{
   if(!r.active||!r.startMonth)return;
   const rFrom=Math.max(fromIdx,monthIndex(r.startMonth));
   const rTo=r.endMonth?Math.min(toIdx,monthIndex(r.endMonth)):toIdx;
   for(let idx=rFrom;idx<=rTo;idx++){
     const y=Math.floor(idx/12),m=(idx%12)+1;
     const dStr=dueDate(y,m,Number(r.day)||1);
     const occKey=`${r.id}:${y}-${String(m).padStart(2,'0')}`;
     if(dStr>today&&dStr<=horizonEnd&&!db.transactions.some(t=>t.occurrenceKey===occKey)){
       upcomingRulesTotal+=(Number(r.amount)||0);
       upcomingRulesCount++;
     }
   }
 });

 // 5. Rendimentos futuros já agendados no mesmo horizonte
 const futureInc=db.transactions.filter(t=>t.type==='income'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

 const committedOut=sum(pendingInCycle)+sum(scheduledFutureExp)+sum(scheduledFutureSavOut)+upcomingRulesTotal;
 const committedIn=sum(futureInc)+sum(scheduledFutureSavIn);
 const totalItems=pendingInCycle.length+scheduledFutureExp.length+scheduledFutureSavOut.length+scheduledFutureSavIn.length+upcomingRulesCount+futureInc.length;
 if(totalItems===0)return null;

 return {
   projectedBalance:currentBalance+committedIn-committedOut,
   committedOut,
   committedIn,
   horizonEnd,
   itemCount:totalItems
 };
}

function currentCycle(cycles){
 const today=iso(now);
 return cycles.find(c=>c.start<=today&&c.end>=today&&!c.preCycle)||cycles.find(c=>c.start<=today&&c.end>=today)||cycles.slice(-1)[0];
}
function cycleName(c){
 const mTag=c.monthLabel||computeCycleReferenceMonth(c);
 if(c.fallback)return `${mTag} · período provisório`;
 if(c.preCycle)return `${mTag} (${fmtDate(c.start)} – ${fmtDate(c.end)})`;
 return `${mTag} (${fmtDate(c.start)} – ${fmtDate(c.end)})${c.open?' · em curso':''}`;
}
function cycleTransactions(c){return db.transactions.filter(t=>validDate(t.date)&&t.date>=c.start&&t.date<=c.end);}
function getSelectedCycle(){
 const cycles=buildCycles();
 let c=cycles.find(x=>x.key===selectedCycleKey)||currentCycle(cycles);
 if(!c){
   c={key:'month:'+cur,start:cur+'-01',end:monthLast(cur),fallback:true,preCycle:false,open:false};
   c.monthLabel=computeCycleReferenceMonth(c);
 }
 selectedCycleKey=c.key;activeCycle=c;activeCycles=cycles;
 return {cycles,cycle:c};
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
 if(t.date>iso(now))state+=' · <em>Agendado</em>';
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

 const today=iso(now);
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
             <button type="button" class="secondary" data-alert-hide-now="${esc(a.id)}">Só agora</button>
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
 const today=iso(now);
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
   const st=t.status==='pending'?'Pendente':t.status==='skipped'?'Ignorada':t.date>iso(now)?'Agendado':'Confirmado';
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
 a.download=`duofin-movimentos-${iso(now)}.csv`;
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
 else if(t.date>iso(now))extraInfo='Agendado (futuro)';
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
   const today=iso(now);
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
 $('date').value=iso(now);
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
 const today=iso(now);
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
   const todayStr=iso(now);
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

// ============================================================================
// TOOLTIPS INTERATIVOS PARA GRÁFICOS CANVAS (v6.5.0)
// ============================================================================
const chartHitAreas={chart:[],analyticsCanvas:[]};

function hideChartTooltip(tipId){
 const tip=$(tipId);
 if(tip)tip.hidden=true;
}

function showChartTooltip(tipId, containerEl, x, y, title, valText, subText=''){
 const tip=$(tipId);
 if(!tip||!containerEl)return;
 if(document.body.classList.contains('privacy-masked')){
   valText='•••• €';
   subText=subText?'Valor oculto (Modo Privacidade)':'';
 }
 tip.innerHTML=`<div class="chart-tooltip-title">${esc(title)}</div><div class="chart-tooltip-val">${esc(valText)}</div>${subText?`<div class="chart-tooltip-sub">${esc(subText)}</div>`:''}`;
 tip.hidden=false;

 const cw=containerEl.clientWidth||320;
 const ch=containerEl.clientHeight||220;
 const clampedX=Math.max(76,Math.min(cw-76,x));
 const placeBelow=y<58;
 tip.style.left=clampedX+'px';
 tip.style.top=(placeBelow?Math.min(ch-16,y+16):y)+'px';
 tip.style.transform=placeBelow?'translate(-50%, 0)':'translate(-50%, -112%)';
}

function hitTestArea(area, px, py){
 if(area.shape==='circle'){
   const dx=px-area.cx,dy=py-area.cy;
   return (dx*dx+dy*dy)<=area.r*area.r;
 }
 if(area.shape==='donut'){
   const dx=px-area.cx,dy=py-area.cy;
   const dist=Math.sqrt(dx*dx+dy*dy);
   if(dist<area.innerR||dist>area.outerR)return false;
   let ang=Math.atan2(dy,dx);
   if(ang<-Math.PI/2)ang+=Math.PI*2;
   return ang>=area.startAngle&&ang<=area.endAngle;
 }
 return px>=area.x&&px<=area.x+area.w&&py>=area.y&&py<=area.y+area.h;
}

function bindInteractiveCanvas(canvasId, tipId){
 const canvas=$(canvasId);
 if(!canvas||canvas.dataset.tooltipBound==='1')return;
 canvas.dataset.tooltipBound='1';
 const container=canvas.parentElement;

 const handlePointer=e=>{
   const areas=chartHitAreas[canvasId]||[];
   if(!areas.length){hideChartTooltip(tipId);return;}
   const rect=canvas.getBoundingClientRect();
   const px=e.clientX-rect.left;
   const py=e.clientY-rect.top;
   let found=null;
   for(let i=areas.length-1;i>=0;i--){
     if(hitTestArea(areas[i],px,py)){found=areas[i];break;}
   }
   if(found){
     canvas.style.cursor='pointer';
     showChartTooltip(tipId,container,found.tipX,found.tipY,found.title,found.valText,found.subText);
   }else{
     canvas.style.cursor='default';
     hideChartTooltip(tipId);
   }
 };

 canvas.addEventListener('pointermove',handlePointer);
 canvas.addEventListener('pointerdown',handlePointer);
 canvas.addEventListener('pointerleave',()=>{
   canvas.style.cursor='default';
   hideChartTooltip(tipId);
 });
}

// SEPARADOR GRÁFICOS: ANÁLISE VISUAL DE CICLO E HISTÓRICO MULTI-CICLO
const CHART_PALETTE=['#173653','#c5a56b','#245d49','#b54747','#396a94','#c97a1e','#5a4b81','#2e86ab','#7a8b99','#9c4f6e','#49796b','#b07d4f'];

function syncAnalyticsControlsVisibility(){
 const metric=$('analyticsMetric').value;
 const isMultiCycle=metric==='cycles_compare'||metric==='category_trend';
 $('analyticsCycleWrap').hidden=isMultiCycle;
 $('analyticsChartTypeWrap').hidden=metric==='cycles_compare';
 $('analyticsCategoryTrendWrap').hidden=metric!=='category_trend';
}

function buildAnalyticsDataset(cycle, metric){
 const today=iso(now);

 if(metric==='cycles_compare'){
   const recentCycles=buildCycles().filter(c=>!c.preCycle).slice(-6);
   const items=recentCycles.map(c=>{
     const tx=cycleTransactions(c).filter(t=>t.date<=today&&isPaid(t));
     const incVal=sum(tx.filter(t=>t.type==='income'));
     const expVal=sum(tx.filter(t=>t.type==='expense'));
     const savVal=sum(tx.filter(t=>t.type==='saving'))-sum(tx.filter(t=>t.type==='saving_withdraw'));
     return {
       label:(c.monthLabel||computeCycleReferenceMonth(c)).replace(/ de \d{4}$/,''),
       fullLabel:cycleName(c),
       income:incVal,
       expense:expVal,
       saving:savVal,
       value:expVal
     };
   });
   return {title:'Comparação últimos ciclos (Rendimentos vs. Despesas)',items,supportsDonut:false,isGroupedCycles:true};
 }

 if(metric==='category_trend'){
   const catName=$('analyticsTrendCategory').value||(db.settings.categories[0]?.name||'');
   const catObj=db.settings.categories.find(c=>c.name===catName);
   const targetBudget=Number(catObj?.budget)||0;
   const recentCycles=buildCycles().filter(c=>!c.preCycle).slice(-6);
   const items=recentCycles.map(c=>{
     const tx=cycleTransactions(c).filter(t=>t.date<=today&&isPaid(t)&&t.type==='expense'&&t.category===catName);
     return {
       label:(c.monthLabel||computeCycleReferenceMonth(c)).replace(/ de \d{4}$/,''),
       fullLabel:cycleName(c),
       value:sum(tx),
       budget:targetBudget,
       color:'#173653'
     };
   });
   return {title:`Evolução: ${catName}`,items,supportsDonut:false,isComparison:false,targetBudget,catName};
 }

 const tx=cycleTransactions(cycle).filter(t=>t.date<=today&&isPaid(t));
 const exp=tx.filter(t=>t.type==='expense');
 const inc=tx.filter(t=>t.type==='income');
 const svIn=tx.filter(t=>t.type==='saving');
 const svOut=tx.filter(t=>t.type==='saving_withdraw');

 if(metric==='categories'){
   const items=db.settings.categories.map((c,idx)=>({
     label:c.name,
     value:sum(exp.filter(t=>t.category===c.name)),
     budget:Number(c.budget)||0,
     color:CHART_PALETTE[idx%CHART_PALETTE.length]
   })).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
   return {title:'Despesas por categoria',items,supportsDonut:true,isComparison:false};
 }

 if(metric==='budget_vs_actual'){
   const items=db.settings.categories.map((c,idx)=>({
     label:c.name,
     value:sum(exp.filter(t=>t.category===c.name)),
     budget:Number(c.budget)||0,
     color:CHART_PALETTE[idx%CHART_PALETTE.length]
   })).filter(x=>x.value>0||x.budget>0);
   return {title:'Orçamento planeado vs. Gasto real',items,supportsDonut:false,isComparison:true};
 }

 if(metric==='daily_flow'){
   const endCap=cycle.end<today?cycle.end:today;
   const days=Math.max(1,daysBetween(cycle.start,endCap)+1);
   const step=days>35?Math.ceil(days/30):1;
   const items=[];
   let running=0;
   for(let i=0;i<days;i++){
     const d=addDays(cycle.start,i);
     const dayExp=sum(exp.filter(t=>t.date===d));
     running+=dayExp;
     if(i%step===0||i===days-1){
       items.push({
         label:fmtDate(d).replace(/ \d{4}$/,''),
         fullDate:fmtDate(d),
         value:Number(running.toFixed(2)),
         daySpent:dayExp,
         color:'#173653'
       });
     }
   }
   return {title:'Despesa acumulada ao longo do ciclo',items,supportsDonut:false,isComparison:false};
 }

 if(metric==='person'){
   const people=[...db.settings.people,'Conta conjunta'];
   const items=people.map((p,idx)=>({
     label:p,
     value:sum(exp.filter(t=>t.person===p)),
     color:CHART_PALETTE[idx%CHART_PALETTE.length]
   })).filter(x=>x.value>0);
   return {title:'Despesas por responsável',items,supportsDonut:true,isComparison:false};
 }

 const netSav=Math.max(0,sum(svIn)-sum(svOut));
 const items=[
   {label:'Rendimentos',value:sum(inc),color:'#245d49'},
   {label:'Despesas pagas',value:sum(exp),color:'#b54747'},
   {label:'Poupança líquida',value:netSav,color:'#c5a56b'}
 ].filter(x=>x.value>0);
 return {title:'Rendimentos vs. Despesas vs. Poupança',items,supportsDonut:true,isComparison:false};
}

function drawAnalyticsChart(){
 const canvas=$('analyticsCanvas');
 if(!canvas)return;
 bindInteractiveCanvas('analyticsCanvas','analyticsTooltip');
 hideChartTooltip('analyticsTooltip');
 chartHitAreas.analyticsCanvas=[];
 syncAnalyticsControlsVisibility();

 const cycleKey=$('analyticsCycleSelect')?.value||selectedCycleKey;
 const cycle=activeCycles.find(x=>x.key===cycleKey)||activeCycle;
 if(!cycle)return;

 const metric=$('analyticsMetric').value;
 let chartType=$('analyticsChartType').value;
 const dataset=buildAnalyticsDataset(cycle,metric);

 const donutOpt=$('analyticsChartType').querySelector('option[value="donut"]');
 if(donutOpt)donutOpt.disabled=!dataset.supportsDonut;
 if(!dataset.supportsDonut&&chartType==='donut'){
   chartType='bar';
   $('analyticsChartType').value='bar';
 }

 if(metric==='cycles_compare'){
   $('analyticsCycleSubtitle').textContent=`Evolução comparativa dos últimos ${dataset.items.length} ciclos`;
   $('analyticsTableTitle').textContent='Resumo comparativo por ciclo';
 }else if(metric==='category_trend'){
   $('analyticsCycleSubtitle').textContent=`Histórico de «${dataset.catName}» nos últimos ${dataset.items.length} ciclos`;
   $('analyticsTableTitle').textContent=`Detalhe de «${dataset.catName}» por ciclo`;
 }else{
   $('analyticsCycleSubtitle').textContent=cycleName(cycle);
   $('analyticsTableTitle').textContent='Indicadores rápidos do ciclo analisado';
 }

 const rect=canvas.getBoundingClientRect();
 const dpr=window.devicePixelRatio||1;
 const w=Math.max(300,Math.round(rect.width||canvas.parentElement?.clientWidth||680));
 const h=Math.max(220,Math.round(rect.height||265));
 canvas.width=w*dpr;
 canvas.height=h*dpr;
 const ctx=canvas.getContext('2d');
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,w,h);

 const styles=getComputedStyle(document.documentElement);
 const lineCol=styles.getPropertyValue('--line').trim()||'#dce4ec';
 const mutedCol=styles.getPropertyValue('--muted').trim()||'#68798a';
 const inkCol=styles.getPropertyValue('--ink').trim()||'#192838';
 const surfaceCol=styles.getPropertyValue('--surface').trim()||'#ffffff';
 const gCol=styles.getPropertyValue('--g').trim()||'#173653';
 const goldCol=styles.getPropertyValue('--gold').trim()||'#c5a56b';

 const items=dataset.items;
 const totalVal=items.reduce((s,x)=>s+x.value,0);

 if(!items.length){
   ctx.fillStyle=mutedCol;
   ctx.font='13px system-ui,sans-serif';
   ctx.textAlign='center';
   ctx.fillText('Sem dados suficientes para gerar o gráfico selecionado.',w/2,h/2);
   $('analyticsLegend').innerHTML='';
   $('analyticsSummaryTable').innerHTML='<div class="empty">Regista movimentos para visualizar estatísticas.</div>';
   return;
 }

 // GRÁFICO DE BARRAS AGRUPADAS (COMPARAÇÃO MULTI-CICLO)
 if(dataset.isGroupedCycles){
   const padL=50,padR=16,padT=20,padB=36;
   const plotW=w-padL-padR,plotH=h-padT-padB;
   const maxVal=Math.max(50,...items.map(x=>Math.max(x.income,x.expense)))*1.15;

   ctx.strokeStyle=lineCol;
   ctx.lineWidth=1;
   ctx.fillStyle=mutedCol;
   ctx.font='10.5px system-ui,sans-serif';
   ctx.textAlign='right';
   for(let i=0;i<=4;i++){
     const y=padT+plotH*i/4;
     ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(w-padR,y);ctx.stroke();
     ctx.fillText(Math.round(maxVal*(1-i/4))+'€',padL-6,y+3.5);
   }

   const slotW=plotW/items.length;
   const barW=Math.min(22,slotW*0.34);

   items.forEach((item,i)=>{
     const cx=padL+i*slotW+slotW/2;
     const incH=(item.income/maxVal)*plotH;
     const expH=(item.expense/maxVal)*plotH;

     ctx.fillStyle='#245d49';
     ctx.beginPath();
     ctx.roundRect(cx-barW-2,padT+plotH-incH,barW,Math.max(2,incH),[4,4,0,0]);
     ctx.fill();

     ctx.fillStyle='#b54747';
     ctx.beginPath();
     ctx.roundRect(cx+2,padT+plotH-expH,barW,Math.max(2,expH),[4,4,0,0]);
     ctx.fill();

     const diff=item.income-item.expense;
     chartHitAreas.analyticsCanvas.push({
       shape:'rect',
       x:padL+i*slotW+2,
       y:padT,
       w:slotW-4,
       h:plotH,
       tipX:cx+10,
       tipY:padT+plotH-Math.max(incH,expH)+10,
       title:item.label,
       valText:`Rend.: ${eur(item.income)} · Desp.: ${eur(item.expense)}`,
       subText:`Saldo ciclo: ${diff>=0?'+':''}${eur(diff)}`
     });

     ctx.fillStyle=mutedCol;
     ctx.font='10px system-ui,sans-serif';
     ctx.textAlign='center';
     const shortLbl=item.label.length>10?item.label.slice(0,9)+'…':item.label;
     ctx.fillText(shortLbl,cx,h-12);
   });

   const avgInc=items.reduce((s,x)=>s+x.income,0)/items.length;
   const avgExp=items.reduce((s,x)=>s+x.expense,0)/items.length;
   $('analyticsLegend').innerHTML=`
     <div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:#245d49"></span><span class="legend-label">Média Rendimentos</span></div><b>${eur(avgInc)}</b></div>
     <div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:#b54747"></span><span class="legend-label">Média Despesas</span></div><b>${eur(avgExp)}</b></div>
   `;
   $('analyticsSummaryTable').innerHTML=items.slice().reverse().map(item=>{
     const diff=item.income-item.expense;
     return `<div class="item row"><div><b>${esc(item.fullLabel)}</b><div class="small">Rend.: ${eur(item.income)} · Desp.: ${eur(item.expense)}</div></div><b class="${diff>=0?'plus':'minus'}">${diff>=0?'+':''}${eur(diff)}</b></div>`;
   }).join('');
   return;
 }

 if(chartType==='donut'){
   const cx=w/2,cy=h/2,radius=Math.min(w,h)*0.38,innerR=radius*0.56;
   let startAngle=-Math.PI/2;
   items.forEach(item=>{
     const slice=(item.value/totalVal)*Math.PI*2;
     const endAngle=startAngle+slice;
     ctx.beginPath();
     ctx.moveTo(cx,cy);
     ctx.arc(cx,cy,radius,startAngle,endAngle);
     ctx.closePath();
     ctx.fillStyle=item.color;
     ctx.fill();
     ctx.lineWidth=2;
     ctx.strokeStyle=surfaceCol;
     ctx.stroke();

     const midAngle=startAngle+slice/2;
     const midR=(radius+innerR)/2;
     const pct=totalVal>0?((item.value/totalVal)*100).toFixed(1):'0.0';
     chartHitAreas.analyticsCanvas.push({
       shape:'donut',
       cx,cy,innerR,outerR:radius,
       startAngle,endAngle,
       tipX:cx+Math.cos(midAngle)*midR+10,
       tipY:cy+Math.sin(midAngle)*midR+10,
       title:item.label,
       valText:eur(item.value),
       subText:`${pct}% do total`
     });

     startAngle=endAngle;
   });
   ctx.beginPath();
   ctx.arc(cx,cy,innerR,0,Math.PI*2);
   ctx.fillStyle=surfaceCol;
   ctx.fill();

   ctx.fillStyle=mutedCol;
   ctx.font='11px system-ui,sans-serif';
   ctx.textAlign='center';
   ctx.fillText('TOTAL',cx,cy-6);
   ctx.fillStyle=inkCol;
   ctx.font='700 14px system-ui,sans-serif';
   ctx.fillText(eur(totalVal),cx,cy+13);
 }else if(chartType==='hbar'){
   const visible=items.slice(0,9);
   const padL=112,padR=54,padT=14,padB=16;
   const plotW=w-padL-padR,plotH=h-padT-padB;
   const maxVal=Math.max(10,...visible.map(x=>Math.max(x.value,x.budget||0)))*1.12;
   const rowH=plotH/visible.length;
   const barH=Math.min(22,rowH*0.62);

   visible.forEach((item,idx)=>{
     const y=padT+idx*rowH+(rowH-barH)/2;
     ctx.fillStyle=inkCol;
     ctx.font='11.5px system-ui,sans-serif';
     ctx.textAlign='right';
     const shortName=item.label.length>15?item.label.slice(0,14)+'…':item.label;
     ctx.fillText(shortName,padL-8,y+barH*0.72);

     if(dataset.isComparison&&item.budget>0){
       const bw=(item.budget/maxVal)*plotW;
       ctx.fillStyle='rgba(197,165,107,0.35)';
       ctx.fillRect(padL,y,bw,barH);
     }
     const vw=(item.value/maxVal)*plotW;
     ctx.fillStyle=(dataset.isComparison||metric==='category_trend')&&item.budget>0&&item.value>item.budget?'#b54747':item.color;
     ctx.beginPath();
     ctx.roundRect(padL,y,Math.max(3,vw),barH,4);
     ctx.fill();

     const pct=totalVal>0?((item.value/totalVal)*100).toFixed(1):'0.0';
     const sub=dataset.isComparison&&item.budget>0?`Limite: ${eur(item.budget)} (${Math.round(item.value/item.budget*100)}%)`:`${pct}% do total`;
     chartHitAreas.analyticsCanvas.push({
       shape:'rect',
       x:padL,
       y:padT+idx*rowH,
       w:plotW+40,
       h:rowH,
       tipX:padL+Math.min(plotW-20,Math.max(24,vw/2))+10,
       tipY:y+10,
       title:item.label,
       valText:eur(item.value),
       subText:sub
     });

     ctx.fillStyle=mutedCol;
     ctx.font='600 11px system-ui,sans-serif';
     ctx.textAlign='left';
     ctx.fillText(Math.round(item.value)+'€',padL+Math.max(3,vw)+6,y+barH*0.72);
   });
 }else if(chartType==='line'){
   const padL=48,padR=20,padT=20,padB=32;
   const plotW=w-padL-padR,plotH=h-padT-padB;
   const maxVal=Math.max(10,...items.map(x=>Math.max(x.value,x.budget||0)))*1.15;

   ctx.strokeStyle=lineCol;
   ctx.lineWidth=1;
   ctx.fillStyle=mutedCol;
   ctx.font='10.5px system-ui,sans-serif';
   ctx.textAlign='right';
   for(let i=0;i<=4;i++){
     const y=padT+plotH*i/4;
     ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(w-padR,y);ctx.stroke();
     ctx.fillText(Math.round(maxVal*(1-i/4))+'€',padL-6,y+3.5);
   }

   if(metric==='category_trend'&&dataset.targetBudget>0){
     const by=padT+plotH*(1-dataset.targetBudget/maxVal);
     ctx.save();
     ctx.strokeStyle=goldCol;
     ctx.lineWidth=1.8;
     ctx.setLineDash([5,4]);
     ctx.beginPath();ctx.moveTo(padL,by);ctx.lineTo(w-padR,by);ctx.stroke();
     ctx.restore();
   }

   const pts=items.map((item,i)=>({
     x:padL+plotW*(items.length===1?0.5:i/(items.length-1)),
     y:padT+plotH*(1-item.value/maxVal),
     item
   }));

   if(pts.length>1){
     const grad=ctx.createLinearGradient(0,padT,0,padT+plotH);
     grad.addColorStop(0,'rgba(57,106,148,0.28)');
     grad.addColorStop(1,'rgba(57,106,148,0.0)');
     ctx.fillStyle=grad;
     ctx.beginPath();
     ctx.moveTo(pts[0].x,padT+plotH);
     pts.forEach(p=>ctx.lineTo(p.x,p.y));
     ctx.lineTo(pts[pts.length-1].x,padT+plotH);
     ctx.closePath();
     ctx.fill();
   }

   ctx.strokeStyle=gCol;
   ctx.lineWidth=2.8;
   ctx.lineJoin='round';
   ctx.beginPath();
   pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
   ctx.stroke();

   const labelStep=Math.max(1,Math.ceil(pts.length/6));
   pts.forEach((p,i)=>{
     ctx.fillStyle=surfaceCol;
     ctx.strokeStyle=(metric==='category_trend'&&dataset.targetBudget>0&&p.item.value>dataset.targetBudget)?'#b54747':gCol;
     ctx.lineWidth=2.2;
     ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();

     let sub='';
     if(metric==='daily_flow')sub=`Gasto no dia: ${eur(p.item.daySpent||0)}`;
     else if(metric==='category_trend'&&dataset.targetBudget>0)sub=`Limite: ${eur(dataset.targetBudget)}`;
     chartHitAreas.analyticsCanvas.push({
       shape:'circle',
       cx:p.x,
       cy:p.y,
       r:18,
       tipX:p.x+10,
       tipY:p.y+10,
       title:p.item.fullDate||p.item.label,
       valText:eur(p.item.value),
       subText:sub
     });

     if(i%labelStep===0||i===pts.length-1){
       ctx.fillStyle=mutedCol;
       ctx.font='10px system-ui,sans-serif';
       ctx.textAlign='center';
       const lbl=p.item.label.length>9?p.item.label.slice(0,8)+'…':p.item.label;
       ctx.fillText(lbl,p.x,h-10);
     }
   });
 }else{
   const visible=items.slice(0,10);
   const padL=48,padR=16,padT=20,padB=36;
   const plotW=w-padL-padR,plotH=h-padT-padB;
   const maxVal=Math.max(10,...visible.map(x=>Math.max(x.value,x.budget||0)))*1.15;

   ctx.strokeStyle=lineCol;
   ctx.lineWidth=1;
   ctx.fillStyle=mutedCol;
   ctx.font='10.5px system-ui,sans-serif';
   ctx.textAlign='right';
   for(let i=0;i<=4;i++){
     const y=padT+plotH*i/4;
     ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(w-padR,y);ctx.stroke();
     ctx.fillText(Math.round(maxVal*(1-i/4))+'€',padL-6,y+3.5);
   }

   if(metric==='category_trend'&&dataset.targetBudget>0){
     const by=padT+plotH*(1-dataset.targetBudget/maxVal);
     ctx.save();
     ctx.strokeStyle=goldCol;
     ctx.lineWidth=1.8;
     ctx.setLineDash([5,4]);
     ctx.beginPath();ctx.moveTo(padL,by);ctx.lineTo(w-padR,by);ctx.stroke();
     ctx.restore();
   }

   const slotW=plotW/visible.length;
   const barW=Math.min(34,slotW*0.62);

   visible.forEach((item,i)=>{
     const cx=padL+i*slotW+slotW/2;
     if(dataset.isComparison&&item.budget>0){
       const bh=(item.budget/maxVal)*plotH;
       ctx.fillStyle='rgba(197,165,107,0.38)';
       ctx.fillRect(cx-barW*0.6,padT+plotH-bh,barW*1.2,bh);
     }
     const vh=(item.value/maxVal)*plotH;
     ctx.fillStyle=(dataset.isComparison||metric==='category_trend')&&item.budget>0&&item.value>item.budget?'#b54747':item.color;
     ctx.beginPath();
     ctx.roundRect(cx-barW/2,padT+plotH-vh,barW,Math.max(2,vh),[5,5,0,0]);
     ctx.fill();

     const pct=totalVal>0?((item.value/totalVal)*100).toFixed(1):'0.0';
     let sub=`${pct}% do total`;
     if((dataset.isComparison||metric==='category_trend')&&item.budget>0){
       sub=`Limite: ${eur(item.budget)} (${Math.round(item.value/item.budget*100)}%)`;
     }else if(metric==='daily_flow'){
       sub=`Gasto no dia: ${eur(item.daySpent||0)}`;
     }
     chartHitAreas.analyticsCanvas.push({
       shape:'rect',
       x:padL+i*slotW+2,
       y:padT,
       w:slotW-4,
       h:plotH,
       tipX:cx+10,
       tipY:padT+plotH-Math.max(12,vh)+10,
       title:item.fullDate||item.label,
       valText:eur(item.value),
       subText:sub
     });

     ctx.fillStyle=mutedCol;
     ctx.font='10px system-ui,sans-serif';
     ctx.textAlign='center';
     const shortLbl=item.label.length>8?item.label.slice(0,7)+'…':item.label;
     ctx.fillText(shortLbl,cx,h-12);
   });
 }

 // Legenda e tabela resumo abaixo do gráfico
 if(metric==='daily_flow'){
   $('analyticsLegend').innerHTML=`<div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:${gCol}"></span><span class="legend-label">Despesa acumulada</span></div><b>${eur(items[items.length-1]?.value||0)}</b></div>`;
   const topDays=[...items].filter(x=>x.daySpent>0).sort((a,b)=>b.daySpent-a.daySpent).slice(0,5);
   $('analyticsSummaryTable').innerHTML=topDays.length?topDays.map(d=>`<div class="item row"><span>Dia ${esc(d.label)}</span><b>${eur(d.daySpent)}</b></div>`).join(''):'<div class="empty">Sem despesas diárias registadas.</div>';
 }else if(metric==='category_trend'){
   const avgVal=items.length?totalVal/items.length:0;
   $('analyticsLegend').innerHTML=`
     <div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:${gCol}"></span><span class="legend-label">Média por ciclo</span></div><b>${eur(avgVal)}</b></div>
     ${dataset.targetBudget>0?`<div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:${goldCol}"></span><span class="legend-label">Limite definido</span></div><b>${eur(dataset.targetBudget)}</b></div>`:''}
   `;
   $('analyticsSummaryTable').innerHTML=items.slice().reverse().map(item=>{
     const statusTxt=item.budget>0?(item.value>item.budget?`Acima em ${eur(item.value-item.budget)}`:`Dentro do limite (${Math.round(item.value/item.budget*100)}%)`):'Sem limite definido';
     return `<div class="item row"><div><b>${esc(item.fullLabel)}</b><div class="small">${statusTxt}</div></div><b class="${item.budget>0&&item.value>item.budget?'minus':''}">${eur(item.value)}</b></div>`;
   }).join('');
 }else{
   $('analyticsLegend').innerHTML=items.map(item=>{
     const pct=totalVal>0?Math.round((item.value/totalVal)*100):0;
     return `<div class="legend-pill"><div class="legend-left"><span class="legend-swatch" style="background:${item.color}"></span><span class="legend-label" title="${esc(item.label)}">${esc(item.label)}</span></div><b>${eur(item.value)} <span class="small">(${pct}%)</span></b></div>`;
   }).join('');

   $('analyticsSummaryTable').innerHTML=items.map(item=>{
     const pct=totalVal>0?((item.value/totalVal)*100).toFixed(1):'0.0';
     const extra=dataset.isComparison&&item.budget>0?` · Limite: ${eur(item.budget)}`:` · ${pct}% do total`;
     return `<div class="item row"><div><b>${esc(item.label)}</b><div class="small">${extra}</div></div><b>${eur(item.value)}</b></div>`;
   }).join('');
 }
}

$('analyticsCycleSelect').onchange=drawAnalyticsChart;
$('analyticsMetric').onchange=drawAnalyticsChart;
$('analyticsChartType').onchange=drawAnalyticsChart;
$('analyticsTrendCategory').onchange=drawAnalyticsChart;

function goalTransactions(g){
 const legacy=new Set((g.legacyTransactionIds||[]).map(String));
 return db.transactions.filter(t=>isSavingTx(t)&&isPaid(t)&&(t.goalId===g.id||(!t.goalId&&legacy.has(String(t.id)))));
}

function computeGoalForecast(g){
 const saved=goalTotal(g),target=Number(g.target)||0;
 const left=Math.max(0,target-saved);
 if(left<=0)return {text:'Objetivo concluído!',kind:'is-done'};

 const today=iso(now);
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
  const savings=db.transactions.filter(t=>isSavingTx(t)&&isPaid(t)&&String(t.date||'')<=iso(now)).sort((a,b)=>b.date.localeCompare(a.date));
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
 $('date').value=iso(now);
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
   const today=iso(now);
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
let parsedCsvRows=[];
const PDFJS_CDN_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfJsLoadingPromise=null;

function extractKeywordFromDesc(desc){
 return String(desc||'')
   .replace(/\b(compra|pagamento|serviços|servicos|transf\.?|trf\.?|mb\s*way|mbway|debito|direto|dd|pos|tpa)\b/gi,' ')
   .replace(/[0-9€$.,\/\-*]+/g,' ')
   .replace(/\s+/g,' ')
   .trim()
   .slice(0,26)
   .toUpperCase();
}

function saveLearnedCategoryRule(keyword, category, type='expense'){
 const cleanKey=String(keyword||'').trim().toUpperCase();
 if(cleanKey.length<3)return;
 if(!Array.isArray(db.settings.categoryRules))db.settings.categoryRules=[];
 const catVal=type==='saving'?'Poupança':type==='saving_withdraw'?'Resgate de poupança':type==='income'?'Rendimento':category;
 if(!catVal)return;
 const existing=db.settings.categoryRules.find(r=>r.keyword.toUpperCase()===cleanKey);
 if(existing){existing.category=catVal;existing.type=type;}
 else db.settings.categoryRules.unshift({keyword:cleanKey,category:catVal,type});
}

function ensurePdfJs(){
 if(window.pdfjsLib){
   window.pdfjsLib.GlobalWorkerOptions.workerSrc=`${PDFJS_CDN_BASE}/pdf.worker.min.js`;
   return Promise.resolve(window.pdfjsLib);
 }
 if(pdfJsLoadingPromise)return pdfJsLoadingPromise;
 pdfJsLoadingPromise=new Promise((resolve,reject)=>{
   const s=document.createElement('script');
   s.src=`${PDFJS_CDN_BASE}/pdf.min.js`;
   s.crossOrigin='anonymous';
   s.referrerPolicy='no-referrer';
   s.async=true;
   s.onload=()=>{
     if(window.pdfjsLib){
       window.pdfjsLib.GlobalWorkerOptions.workerSrc=`${PDFJS_CDN_BASE}/pdf.worker.min.js`;
       resolve(window.pdfjsLib);
     }else{
       pdfJsLoadingPromise=null;
       reject(new Error('Não foi possível inicializar o leitor de PDF.'));
     }
   };
   s.onerror=()=>{
     pdfJsLoadingPromise=null;
     reject(new Error('Sem ligação para carregar o leitor de PDF. Podes colar o texto do extrato usando o botão «Colar texto».'));
   };
   document.head.appendChild(s);
 });
 return pdfJsLoadingPromise;
}

async function extractTextLinesFromPdf(file, onProgress=null){
 if(typeof onProgress==='function')onProgress(0,0,'A carregar motor de leitura PDF…');
 const pdfjs=await ensurePdfJs();
 const arrayBuffer=await file.arrayBuffer();
 const pdf=await pdfjs.getDocument({data:arrayBuffer}).promise;
 const allLines=[];
 for(let pageNum=1;pageNum<=pdf.numPages;pageNum++){
   if(typeof onProgress==='function'){
     onProgress(pageNum,pdf.numPages,`A ler página ${pageNum} de ${pdf.numPages}…`);
   }
   await new Promise(r=>setTimeout(r,12));
   const page=await pdf.getPage(pageNum);
   const content=await page.getTextContent();
   const items=content.items
     .filter(it=>it&&typeof it.str==='string'&&it.str.trim().length>0)
     .map(it=>({
       str:it.str.trim(),
       x:Math.round(it.transform[4]*10)/10,
       y:Math.round(it.transform[5]*10)/10,
       w:it.width||0
     }));
   items.sort((a,b)=>Math.abs(b.y-a.y)>3.2?(b.y-a.y):(a.x-b.x));
   const rows=[];
   for(const item of items){
     const lastRow=rows[rows.length-1];
     if(lastRow&&Math.abs(lastRow.y-item.y)<=3.2){
       lastRow.items.push(item);
     }else{
       rows.push({y:item.y,items:[item]});
     }
   }
   for(const row of rows){
     row.items.sort((a,b)=>a.x-b.x);
     let lineStr='',prevRight=null;
     for(const it of row.items){
       if(prevRight!==null){
         const gap=it.x-prevRight;
         lineStr+=gap>16?'  ':gap>2?' ':'';
       }
       lineStr+=it.str;
       prevRight=it.x+it.w;
     }
     if(lineStr.trim())allLines.push(lineStr.trim());
   }
 }
 return allLines;
}

function parseCsvLine(line, sep){
 const res=[];let cur='',inQuotes=false;
 for(let i=0;i<line.length;i++){
   const ch=line[i];
   if(ch==='"'){
     if(inQuotes&&line[i+1]==='"'){cur+='"';i++;}
     else inQuotes=!inQuotes;
   }else if(ch===sep&&!inQuotes){
     res.push(cur.trim());cur='';
   }else{
     cur+=ch;
   }
 }
 res.push(cur.trim());
 return res;
}

const PT_MONTHS = {
  jan:'01', janeiro:'01',
  fev:'02', fevereiro:'02',
  mar:'03', marco:'03', 'março':'03',
  abr:'04', abril:'04',
  mai:'05', maio:'05',
  jun:'06', junho:'06',
  jul:'07', julho:'07',
  ago:'08', agosto:'08',
  set:'09', setembro:'09',
  out:'10', outubro:'10',
  nov:'11', novembro:'11', 'πον':'11',
  dez:'12', dezembro:'12'
};

function normalizeCsvDate(raw, fallbackYear){
 let s=String(raw||'').trim();
 if(!s)return null;
 const ptMatch=s.match(/^(\d{1,2})\s+([a-zA-ZçÇ\u0370-\u03FF]{3,10})\.?(?:\s+(\d{4}))?$/);
 if(ptMatch){
   const d=+ptMatch[1];
   const mKey=ptMatch[2].toLocaleLowerCase('pt-PT');
   const mo=PT_MONTHS[mKey];
   const y=ptMatch[3]||fallbackYear;
   if(mo&&y&&d>=1&&d<=31)return `${y}-${mo}-${String(d).padStart(2,'0')}`;
 }
 s=s.split(' ')[0];
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
 let m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
 if(m){
   const d=+m[1],mo=+m[2],y=+m[3];
   if(mo>=1&&mo<=12&&d>=1&&d<=31)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 m=s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
 if(m){
   const y=+m[1],mo=+m[2],d=+m[3];
   if(mo>=1&&mo<=12&&d>=1&&d<=31)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 m=s.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
 if(m&&fallbackYear){
   const d=+m[1],mo=+m[2];
   if(mo>=1&&mo<=12&&d>=1&&d<=31)return `${fallbackYear}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 return null;
}

function normalizeCsvAmount(raw){
 let s=String(raw||'').replace(/[€$£\s\u00A0]/g,'').trim();
 if(!s)return NaN;
 let neg=false;
 if(s.startsWith('(')&&s.endsWith(')')){neg=true;s=s.slice(1,-1);}
 if(s.endsWith('-')){neg=true;s=s.slice(0,-1);}
 if(s.endsWith('+')){s=s.slice(0,-1);}
 if(s.includes(',')&&s.includes('.')){
   if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');
   else s=s.replace(/,/g,'');
 }else if(s.includes(',')){
   s=s.replace(',','.');
 }
 const val=parseFloat(s);
 return neg&&Number.isFinite(val)?-Math.abs(val):val;
}

function guessMovementTypeAndCategory(desc, rawAmount){
 const d=desc.toLocaleLowerCase('pt-PT');
 const avail=new Set(db.settings.categories.map(c=>c.name));

 // 1. Regras personalizadas aprendidas (podem guardar type e category)
 for(const rule of (db.settings.categoryRules||[])){
   if(d.includes(rule.keyword.toLocaleLowerCase('pt-PT'))){
     if(rule.type==='saving')return {type:'saving',category:'Poupança'};
     if(rule.type==='saving_withdraw')return {type:'saving_withdraw',category:'Resgate de poupança'};
     if(rule.type==='income')return {type:'income',category:'Rendimento'};
     if(avail.has(rule.category))return {type:'expense',category:rule.category};
   }
 }

 // 2. Deteção automática de movimentos de poupança / conta prazo / PPR / Certificados
 const savingKeywords=['poupanca','poupança','conta prazo','deposito a prazo','depósito a prazo','certificados de aforro','igcp','ppr ','plano poupanca','reforco poupanca','reforço poupança','cofre','vault'];
 if(savingKeywords.some(k=>d.includes(k))){
   if(rawAmount<0)return {type:'saving',category:'Poupança'};
   return {type:'saving_withdraw',category:'Resgate de poupança'};
 }

 const isIncome=rawAmount>0;
 if(isIncome)return {type:'income',category:'Rendimento'};
 return {type:'expense',category:guessCategory(desc)};
}

function guessCategory(desc){
 const d=desc.toLocaleLowerCase('pt-PT');
 const avail=new Set(db.settings.categories.map(c=>c.name));

 // 1. Verificar primeiro regras personalizadas aprendidas pelo utilizador
 for(const rule of (db.settings.categoryRules||[])){
   if(avail.has(rule.category)&&d.includes(rule.keyword.toLocaleLowerCase('pt-PT'))){
     return rule.category;
   }
 }

 // 2. Regras gerais de estabelecimentos em Portugal
 const rules=[
   ['Supermercado',['continente','pingo doce','lidl','aldi','auchan','intermarche','mercadona','minipreco','supercor','talho','padaria','mercearia']],
   ['Transportes',['galp','repsol','bp ','cepsa','prio','via verde','uber','bolt','cp ','carris','metro','estacionamento','parque','auto','oficina','pneus']],
   ['Água, luz e gás',['edp','endesa','goldenergy','iberdrola','galp energia','epal','aguas','saneamento']],
   ['Telecomunicações',['meo','nos ','vodafone','digi','nowo','altice']],
   ['Saúde e farmácia',['farmacia','hospital','clinica','cuf','lusiadas','medico','dentista','optica','wells','medicare']],
   ['Restaurantes e lazer',['restaurante','cafe','cafes','pastelaria','mcdonald','burger','pizza','uber eats','glovo','cinema','bilhete','spotify','netflix','hbo','disney','vinhos']],
   ['Habitação',['renda','condominio','ikea','leroy','bricomarche','imov','habitacao','credito habitacao','multi-riscos','seguro de vida']],
   ['Vestuário e pessoal',['zara','hm ','primark','decathlon','sport zone','cabeleireiro','barbeiro','springfield']]
 ];
 for(const [catName,keywords] of rules){
   if(avail.has(catName)&&keywords.some(k=>d.includes(k)))return catName;
 }
 return avail.has('Outros / imprevistos')?'Outros / imprevistos':(db.settings.categories[0]?.name||'Outros / imprevistos');
}

function parseStatementTextLines(lines){
 const fullText=lines.join('\n');
 const yearMatches=fullText.match(/\b(20\d{2})\b/g);
 const fallbackYear=yearMatches&&yearMatches.length?yearMatches[0]:String(now.getFullYear());

 if(/D[:.]?\s*valor/i.test(fullText)){
   const santanderRows=parseSantanderLines(lines,fallbackYear);
   if(santanderRows.length)return santanderRows;
 }

 const rows=[];
 const datePatternStr='(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]\\d{4})?|\\d{1,2}\\s+[a-zA-ZçÇ\\u0370-\\u03FF]{3,10}\\.?(?:\\s+\\d{4})?)';
 const dateStartRe=new RegExp('^'+datePatternStr+'\\b\\s*(.*)$');
 const secondDateRe=new RegExp('^'+datePatternStr+'\\b\\s*(.*)$');
 const amountTokenRe=/([+-]?\s*(?:\d{1,3}(?:[.\s\u00A0]\d{3})+|\d+),\d{2}|[+-]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*[€$£]?/g;
 const skipLineRe=/^(saldo\s+(inicial|final|anterior|disponível|contabilístico|autorizado)|total\s+(de\s+)?(débitos|créditos|movimentos)|data\s+(mov|da\s+operação)|descrição|operação|página\s+\d|titular:|conta:|documento\s+com\s+data|para\s+pesquisas)/i;

 let pendingEntry=null;

 const flushPending=()=>{
   if(!pendingEntry)return;
   if(Number.isFinite(pendingEntry.amount)&&pendingEntry.amount!==0){
     const cleanDesc=pendingEntry.description.replace(/\s+/g,' ').trim()||'Movimento bancário';
     if(!skipLineRe.test(cleanDesc)){
       const guessedObj=guessMovementTypeAndCategory(cleanDesc,pendingEntry.amount);
       rows.push({
         selected:true,
         date:pendingEntry.date,
         description:cleanDesc,
         type:guessedObj.type,
         initialType:guessedObj.type,
         category:guessedObj.category,
         initialCategory:guessedObj.category,
         goalId:'',
         amount:Math.abs(pendingEntry.amount)
       });
     }
   }
   pendingEntry=null;
 };

 for(const rawLine of lines){
   const line=rawLine.trim();
   if(!line||skipLineRe.test(line)||/^D[:.]?\s*valor/i.test(line))continue;

   const dm=line.match(dateStartRe);
   if(dm){
     flushPending();
     const dt=normalizeCsvDate(dm[1],fallbackYear);
     if(!dt)continue;
     let rest=dm[2].trim();
     const dm2=rest.match(secondDateRe);
     if(dm2&&normalizeCsvDate(dm2[1],fallbackYear)){
       rest=dm2[2].trim();
     }
     const amtMatches=[...rest.matchAll(amountTokenRe)];
     if(amtMatches.length>0){
       const chosenMatch=amtMatches.length>=2?amtMatches[amtMatches.length-2]:amtMatches[0];
       let amt=normalizeCsvAmount(chosenMatch[1]);
       const firstAmtIdx=amtMatches[0].index;
       let descPart=rest.slice(0,firstAmtIdx).trim();
       const trailingText=rest.slice(chosenMatch.index+chosenMatch[0].length).trim();
       if(/^D\b|^DEB/i.test(trailingText)&&amt>0)amt=-amt;
       if(/^C\b|^CRED/i.test(trailingText)&&amt<0)amt=Math.abs(amt);
       if(!/[+-]/.test(chosenMatch[1])&&amt>0){
         if(amtMatches.length===1&&/\b(transf\.?\s*receb|trf\.?\s*mb\s*way\s*de|ordenado|vencimento|salário|reembolso|crédito|depósito|juros\s+cred)\b/i.test(descPart)){
           amt=Math.abs(amt);
         }else if(amtMatches.length===1){
           amt=-Math.abs(amt);
         }
       }
       pendingEntry={date:dt,description:descPart,amount:amt};
     }else{
       pendingEntry={date:dt,description:rest,amount:NaN};
     }
   }else if(pendingEntry){
     const amtMatches=[...line.matchAll(amountTokenRe)];
     if(!Number.isFinite(pendingEntry.amount)&&amtMatches.length>0){
       const chosenMatch=amtMatches.length>=2?amtMatches[amtMatches.length-2]:amtMatches[0];
       let amt=normalizeCsvAmount(chosenMatch[1]);
       const extraDesc=line.slice(0,amtMatches[0].index).trim();
       if(extraDesc)pendingEntry.description+=' '+extraDesc;
       if(!/[+-]/.test(chosenMatch[1])&&amt>0&&amtMatches.length===1){
         if(!/\b(transf\.?\s*receb|trf\.?\s*mb\s*way\s*de|ordenado|vencimento|salário|reembolso|crédito|depósito)\b/i.test(pendingEntry.description)){
           amt=-Math.abs(amt);
         }
       }
       pendingEntry.amount=amt;
     }else if(line.length<=70&&!/^\d+$/.test(line)){
       pendingEntry.description+=' '+line;
     }
   }
 }
 flushPending();
 return rows;
}

function parseSantanderLines(lines, fallbackYear){
 const dateOnlyRe=/^(\d{1,2}\s+[a-zA-ZçÇ\u0370-\u03FF]{3,10}\.?(?:\s+\d{4})?|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})$/;
 const dValorRe=/^D[:.]?\s*valor[:.]?\s*(.+)$/i;
 const amountTokenRe=/([+-]?\s*(?:\d{1,3}(?:[.\s\u00A0]\d{3})+|\d+),\d{2})\s*€/g;
 const skipHeaderRe=/^(santander|titular:|conta:|saldo\s+disponível|movimentos\s+da\s+sua\s+conta|operação|data\s+da\s+operação|documento\s+com\s+data|página\s+\d|para\s+pesquisas)/i;

 const cleanLines=lines.map(l=>l.trim()).filter(l=>l&&!skipHeaderRe.test(l));
 const blocks=[];
 let curBlock=[];
 for(const l of cleanLines){
   if(dValorRe.test(l)){
     curBlock.push(l);
     blocks.push(curBlock);
     curBlock=[];
   }else{
     const amts=[...l.matchAll(amountTokenRe)];
     if(curBlock.length>0&&amts.length>=1&&!curBlock.some(x=>dValorRe.test(x))){
       if(blocks.length>0&&!blocks[blocks.length-1].hasAmounts){
         blocks[blocks.length-1].push(l);
         blocks[blocks.length-1].hasAmounts=true;
         continue;
       }
     }
     curBlock.push(l);
   }
 }
 if(curBlock.length&&blocks.length&&!blocks[blocks.length-1].hasAmounts){
   blocks[blocks.length-1].push(...curBlock);
 }

 const results=[];
 let lastValidDate=null;
 for(const blk of blocks){
   let dt=null,descParts=[],amounts=[];
   for(const item of blk){
     const dv=item.match(dValorRe);
     if(dv){
       const parsedDv=normalizeCsvDate(dv[1].replace(/^D(\d)/,'0$1').trim(),fallbackYear);
       if(!dt&&parsedDv)dt=parsedDv;
       continue;
     }
     const parsedDate=normalizeCsvDate(item,fallbackYear);
     if(parsedDate&&dateOnlyRe.test(item)){
       if(!dt)dt=parsedDate;
       continue;
     }
     const amts=[...item.matchAll(amountTokenRe)];
     if(amts.length>0){
       const idxFirst=amts[0].index;
       const prefixText=item.slice(0,idxFirst).replace(/\|/g,'').trim();
       if(prefixText)descParts.push(prefixText);
       for(const m of amts){
         const v=normalizeCsvAmount(m[1]);
         if(Number.isFinite(v))amounts.push(v);
       }
     }else{
       const txt=item.replace(/\|/g,'').trim();
       if(txt)descParts.push(txt);
     }
   }
   if(!dt)dt=lastValidDate;
   if(dt)lastValidDate=dt;
   if(!dt||!amounts.length)continue;

   const movAmount=amounts.length>=2?amounts[amounts.length-2]:amounts[0];
   if(!Number.isFinite(movAmount)||movAmount===0)continue;
   const description=descParts.join(' ').replace(/\s+/g,' ').trim()||'Movimento Santander';
   const guessedObj=guessMovementTypeAndCategory(description,movAmount);
   results.push({
     selected:true,
     date:dt,
     description,
     type:guessedObj.type,
     initialType:guessedObj.type,
     category:guessedObj.category,
     initialCategory:guessedObj.category,
     goalId:'',
     amount:Math.abs(movAmount)
   });
 }
 return results;
}

function parseCsvContent(text){
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 if(lines.length<2)throw new Error('O ficheiro parece estar vazio.');
 const sample=lines.slice(0,5).join('\n');
 const sep=(sample.match(/;/g)||[]).length>=(sample.match(/,/g)||[]).length?';':',';
 let headerIdx=0;
 for(let i=0;i<Math.min(10,lines.length);i++){
   const cols=parseCsvLine(lines[i],sep).map(c=>c.toLocaleLowerCase('pt-PT'));
   if(cols.some(c=>c.includes('data')||c.includes('date'))&&cols.some(c=>c.includes('desc')||c.includes('movimento')||c.includes('valor')||c.includes('montante')||c.includes('amount')||c.includes('débito')||c.includes('debito'))){
     headerIdx=i;break;
   }
 }
 const headers=parseCsvLine(lines[headerIdx],sep).map(h=>h.toLocaleLowerCase('pt-PT'));
 let dateCol=headers.findIndex(h=>h.includes('data mov')||h.includes('data valor')||h==='data'||h==='date'||h.includes('data'));
 let descCol=headers.findIndex(h=>h.includes('descri')||h.includes('movimento')||h.includes('designa')||h.includes('detalhe')||h.includes('description'));
 let valCol=headers.findIndex(h=>h.includes('montante')||h.includes('valor')||h.includes('import')||h.includes('amount'));
 let debCol=headers.findIndex(h=>h.includes('débito')||h.includes('debito')||h.includes('saída'));
 let credCol=headers.findIndex(h=>h.includes('crédito')||h.includes('credito')||h.includes('entrada'));

 if(dateCol<0)dateCol=0;
 if(descCol<0)descCol=headers.length>2?1:0;

 const rows=[];
 for(let i=headerIdx+1;i<lines.length;i++){
   const cols=parseCsvLine(lines[i],sep);
   if(cols.length<2)continue;
   const dt=normalizeCsvDate(cols[dateCol]);
   if(!dt)continue;
   const desc=String(cols[descCol]||'Movimento bancário').replace(/\s+/g,' ').trim();
   let amt=NaN;
   if(valCol>=0&&cols[valCol]!==undefined&&cols[valCol]!==''){
     amt=normalizeCsvAmount(cols[valCol]);
   }else if(debCol>=0||credCol>=0){
     const dVal=debCol>=0?normalizeCsvAmount(cols[debCol]):NaN;
     const cVal=credCol>=0?normalizeCsvAmount(cols[credCol]):NaN;
     if(Number.isFinite(dVal)&&dVal!==0)amt=-Math.abs(dVal);
     else if(Number.isFinite(cVal)&&cVal!==0)amt=Math.abs(cVal);
   }
   if(!Number.isFinite(amt)||amt===0)continue;
   const guessedObj=guessMovementTypeAndCategory(desc,amt);
   rows.push({
     selected:true,
     date:dt,
     description:desc,
     type:guessedObj.type,
     initialType:guessedObj.type,
     category:guessedObj.category,
     initialCategory:guessedObj.category,
     goalId:'',
     amount:Math.abs(amt)
   });
 }
 return rows;
}

$('togglePasteExtractBtn').onclick=()=>{
 const box=$('pasteExtractBox');
 box.hidden=!box.hidden;
 if(!box.hidden)$('pasteExtractText').focus();
};
$('cancelPasteTextBtn').onclick=()=>{$('pasteExtractBox').hidden=true;};
$('parsePastedTextBtn').onclick=()=>{
 const raw=$('pasteExtractText').value.trim();
 if(!raw){alert('Cola primeiro o texto copiado do extrato bancário.');return;}
 const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 const rows=parseStatementTextLines(lines);
 if(!rows.length){
   alert('Não foi possível detetar movimentos com Data e Valor no texto colado. Confirma se copiaste as linhas completas do extrato.');
   return;
 }
 parsedCsvRows=rows;
 $('pasteExtractBox').hidden=true;
 renderCsvPreview();
};

$('csvFileInput').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
   const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
   if(isPdf){
     $('csvPreviewContainer').hidden=true;
     const pBox=$('pdfProgressBox'),pBar=$('pdfProgressBar'),pLbl=$('pdfProgressLabel'),pPct=$('pdfProgressPct');
     if(pBox){pBox.hidden=false;pBar.style.width='6%';pLbl.textContent='A abrir extrato PDF…';pPct.textContent='0%';}
     const pdfLines=await extractTextLinesFromPdf(file,(curPage,totalPages,label)=>{
       if(!pBox)return;
       const pct=totalPages>0?Math.round((curPage/totalPages)*100):10;
       pBar.style.width=Math.max(8,pct)+'%';
       pLbl.textContent=label;
       pPct.textContent=pct+'%';
     });
     if(pBox)pBox.hidden=true;
     if(!pdfLines.length)throw new Error('Este PDF não contém texto selecionável (pode ser uma imagem digitalizada).');
     parsedCsvRows=parseStatementTextLines(pdfLines);
     if(!parsedCsvRows.length)throw new Error('Não foi possível identificar linhas de movimentos (Data, Descrição e Valor) neste PDF. Tenta copiar o texto do PDF e usar o botão «Colar texto».');
     haptic([12,25,18]);
   }else{
     const text=await file.text();
     parsedCsvRows=parseCsvContent(text);
     if(!parsedCsvRows.length)throw new Error('Não foi possível identificar movimentos válidos (Data, Descrição e Valor) neste ficheiro.');
   }
   renderCsvPreview();
 }catch(err){
   if($('pdfProgressBox'))$('pdfProgressBox').hidden=true;
   $('csvPreviewContainer').hidden=true;
   alert(err.message||'Erro ao ler o ficheiro selecionado.');
 }
 e.target.value='';
};

function isDuplicateMovement(row){
 const amt=Number(row.amount);
 return db.transactions.some(t=>t.date===row.date&&Math.abs((Number(t.amount)||0)-amt)<0.005&&t.type===row.type);
}

function renderCsvPreview(){
 $('csvPreviewContainer').hidden=false;
 parsedCsvRows.forEach(r=>{
   if(r._checkedDup===undefined){
     r.isDup=isDuplicateMovement(r);
     if(r.isDup)r.selected=false;
     r._checkedDup=true;
   }
 });
 const selCount=parsedCsvRows.filter(r=>r.selected).length;
 $('csvSummaryAlert').textContent=`${parsedCsvRows.length} movimento(s) detetado(s) · ${selCount} selecionado(s) para importar.`;
 $('csvToggleAll').checked=selCount>0&&selCount===parsedCsvRows.length;

 $('csvPreviewList').innerHTML=parsedCsvRows.map((r,idx)=>{
   const typeBadge=r.type==='income'?'Rendimento':r.type==='saving'?'Poupança':r.type==='saving_withdraw'?'Resgate':r.category;
   const sign=r.type==='income'?'+':r.type==='saving'?'↗':r.type==='saving_withdraw'?'↙':'−';
   const amtCls=r.type==='income'?'plus':(r.type==='saving'||r.type==='saving_withdraw')?'neutral':'minus';
   return `<div class="imp-item ${r.selected?'':'is-unselected'}" data-imp-open="${idx}">
     <input type="checkbox" data-csv-check="${idx}" ${r.selected?'checked':''} aria-label="Selecionar movimento">
     <div class="imp-body">
       <div class="imp-desc">${esc(r.description)}</div>
       <div class="imp-meta">
         <span>${esc(fmtDate(r.date))}</span>
         <span class="imp-tag">${esc(typeBadge)}</span>
         ${r.isDup?'<span class="imp-tag dup">⚠ Possível duplicado</span>':''}
       </div>
     </div>
     <div class="imp-right">
       <b class="amount ${amtCls}">${sign} ${eur(r.amount)}</b>
       <span class="imp-chevron">Detalhe ›</span>
     </div>
   </div>`;
 }).join('');
}

function updateLearnRuleCheckbox(){
 const idx=Number($('impEditIdx').value);
 const r=parsedCsvRows[idx];
 const tp=$('impEditType').value;
 const newCat=$('impEditCat').value;
 const kw=extractKeywordFromDesc($('impEditDesc').value);
 const wrap=$('impLearnRuleWrap');
 if(!r||kw.length<3){wrap.hidden=true;return;}
 if(tp==='expense'&&newCat!==r.initialCategory){
   wrap.hidden=false;
   $('impLearnRuleLabel').textContent=`Memorizar «${kw}» → «${newCat}» para futuras importações`;
 }else if((tp==='saving'||tp==='saving_withdraw')&&tp!==(r.initialType||'expense')){
   wrap.hidden=false;
   $('impLearnRuleLabel').textContent=`Memorizar «${kw}» como movimento de Poupança para futuras importações`;
 }else{
   wrap.hidden=true;
 }
}

function openImportDetailModal(idx){
 const r=parsedCsvRows[idx];
 if(!r)return;
 $('impEditIdx').value=String(idx);
 $('importModalTitle').textContent=`Movimento ${idx+1} de ${parsedCsvRows.length}`;
 $('impEditSelected').checked=!!r.selected;
 $('impEditDate').value=r.date;
 $('impEditAmount').value=Number(r.amount).toFixed(2);
 $('impEditDesc').value=r.description;
 $('impEditType').value=r.type;
 $('impEditCat').innerHTML=db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
 if([...$('impEditCat').options].some(o=>o.value===r.category))$('impEditCat').value=r.category;
 $('impEditCatWrap').hidden=r.type!=='expense';
 const isSavImp=r.type==='saving'||r.type==='saving_withdraw';
 $('impEditGoalWrap').hidden=!isSavImp;
 const activeGoals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 $('impEditGoal').innerHTML='<option value="">Sem objetivo</option>'+activeGoals.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 $('impEditGoal').value=r.goalId||'';
 $('impLearnRuleCheck').checked=true;
 updateLearnRuleCheckbox();
 $('importDupWarning').hidden=!r.isDup;
 $('impPrevBtn').disabled=idx<=0;
 $('impNextBtn').disabled=idx>=parsedCsvRows.length-1;
 $('importDetailModal').hidden=false;
}

function saveCurrentImportModal(){
 const idx=Number($('impEditIdx').value);
 const r=parsedCsvRows[idx];
 if(!r)return;
 r.selected=$('impEditSelected').checked;
 if(validDate($('impEditDate').value))r.date=$('impEditDate').value;
 const v=parseFloat($('impEditAmount').value);
 if(Number.isFinite(v)&&v>0)r.amount=Number(v.toFixed(2));
 r.description=$('impEditDesc').value.trim()||'Movimento bancário';
 r.type=$('impEditType').value;
 if(!$('impLearnRuleWrap').hidden&&$('impLearnRuleCheck').checked){
   const kw=extractKeywordFromDesc(r.description);
   const chosenCat=$('impEditCat').value;
   saveLearnedCategoryRule(kw,chosenCat,r.type);
   parsedCsvRows.forEach(other=>{
     if(other.description.toUpperCase().includes(kw)){
       other.type=r.type;
       if(r.type==='expense')other.category=chosenCat;
     }
   });
 }
 if(r.type==='expense'){
   r.category=$('impEditCat').value;
   delete r.goalId;
 }else if(r.type==='saving'||r.type==='saving_withdraw'){
   r.goalId=$('impEditGoal').value||'';
 }else{
   delete r.goalId;
 }
 r.isDup=isDuplicateMovement(r);
 renderCsvPreview();
}

$('impEditType').onchange=()=>{
 const tp=$('impEditType').value;
 $('impEditCatWrap').hidden=tp!=='expense';
 $('impEditGoalWrap').hidden=tp!=='saving'&&tp!=='saving_withdraw';
 updateLearnRuleCheckbox();
};
$('impEditCat').onchange=updateLearnRuleCheckbox;
$('impEditDesc').oninput=updateLearnRuleCheckbox;
$('closeImportModalBtn').onclick=()=>{$('importDetailModal').hidden=true;};
$('saveImportDetailBtn').onclick=()=>{
 saveCurrentImportModal();
 $('importDetailModal').hidden=true;
};
$('impPrevBtn').onclick=()=>{
 const idx=Number($('impEditIdx').value);
 saveCurrentImportModal();
 if(idx>0)openImportDetailModal(idx-1);
};
$('impNextBtn').onclick=()=>{
 const idx=Number($('impEditIdx').value);
 saveCurrentImportModal();
 if(idx<parsedCsvRows.length-1)openImportDetailModal(idx+1);
};
$('importDetailModal').addEventListener('click',e=>{
 if(e.target===$('importDetailModal')){
   saveCurrentImportModal();
   $('importDetailModal').hidden=true;
 }
});

$('csvToggleAll').onchange=e=>{
 const checked=e.target.checked;
 parsedCsvRows.forEach(r=>r.selected=checked);
 renderCsvPreview();
};

$('csvPreviewList').addEventListener('click',e=>{
 const cb=e.target.closest('[data-csv-check]');
 if(cb){
   e.stopPropagation();
   const idx=+cb.dataset.csvCheck;
   parsedCsvRows[idx].selected=cb.checked;
   renderCsvPreview();
   return;
 }
 const card=e.target.closest('[data-imp-open]');
 if(card){
   openImportDetailModal(+card.dataset.impOpen);
 }
});

$('csvCancelImportBtn').onclick=()=>{parsedCsvRows=[];$('csvPreviewContainer').hidden=true;};
$('csvConfirmImportBtn').onclick=()=>{
 const toImport=parsedCsvRows.filter(r=>r.selected);
 if(!toImport.length){alert('Seleciona pelo menos um movimento para importar.');return;}
 const person=$('csvDefaultPerson').value||'Conta conjunta';
 const nowTs=Date.now();
 toImport.forEach((r,idx)=>{
   const entry={
     id:'imp-'+nowTs+'-'+idx+'-'+Math.random().toString(36).slice(2,5),
     date:r.date,
     type:r.type,
     description:r.description,
     amount:Number(r.amount.toFixed(2)),
     category:r.type==='expense'?r.category:r.type==='saving'?'Poupança':r.type==='saving_withdraw'?'Resgate de poupança':'Rendimento',
     person,
     updatedAt:nowTs
   };
   if(r.type==='income')entry.countsForCycle=true;
   if((r.type==='saving'||r.type==='saving_withdraw')&&r.goalId)entry.goalId=r.goalId;
   db.transactions.push(entry);
 });
 parsedCsvRows=[];
 $('csvPreviewContainer').hidden=true;
 const autoUpdated=runAutoBudgetAdjustment(true);
 persist();
 showToast(autoUpdated?`${toImport.length} movimento(s) importado(s) e orçamento ajustado à média real!`:`${toImport.length} movimento(s) importado(s) com sucesso!`,{type:'success'});
};

function drawChart(){
 const c=$('chart');if(!c)return;
 bindInteractiveCanvas('chart','chartTooltip');
 hideChartTooltip('chartTooltip');
 chartHitAreas.chart=[];

 const rect=c.getBoundingClientRect();
 const dpr=window.devicePixelRatio||1;
 const w=Math.max(300,Math.round(rect.width||c.parentElement?.clientWidth||680));
 const h=Math.max(180,Math.round(rect.height||200));
 c.width=w*dpr;
 c.height=h*dpr;
 const ctx=c.getContext('2d');
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,w,h);

 const cycles=buildCycles();
 let total=0;
 const series=cycles.map(cy=>{
   const delta=cycleTransactions(cy).filter(t=>isSavingTx(t)&&isPaid(t)).reduce((s,t)=>s+savingSigned(t),0);
   total=Math.max(0,total+delta);
   return {cycle:cy,value:total,delta};
 }).slice(-12);
 if(!series.length)return;

 const styles=getComputedStyle(document.documentElement);
 const lineCol=styles.getPropertyValue('--line').trim()||'#dce4ec';
 const goldCol=styles.getPropertyValue('--gold').trim()||'#c5a56b';
 const mutedCol=styles.getPropertyValue('--muted').trim()||'#68798a';
 const surfaceCol=styles.getPropertyValue('--surface').trim()||'#ffffff';
 const inkCol=styles.getPropertyValue('--ink').trim()||'#192838';

 const padLeft=48,padRight=24,padTop=22,padBottom=28;
 const plotW=w-padLeft-padRight,plotH=h-padTop-padBottom;
 const max=Math.max(100,...series.map(x=>x.value))*1.15;

 ctx.strokeStyle=lineCol;
 ctx.lineWidth=1;
 ctx.fillStyle=mutedCol;
 ctx.font='10.5px system-ui,sans-serif';
 ctx.textAlign='right';
 for(let i=0;i<=4;i++){
   const y=padTop+plotH*i/4;
   ctx.beginPath();ctx.moveTo(padLeft,y);ctx.lineTo(w-padRight,y);ctx.stroke();
   const val=Math.round(max*(1-i/4));
   ctx.fillText(val+'€',padLeft-6,y+3.5);
 }

 const pts=series.map((item,i)=>({
   x:padLeft+plotW*(series.length===1?0.5:i/(series.length-1)),
   y:padTop+plotH*(1-item.value/max),
   item
 }));

 if(pts.length>1){
   const grad=ctx.createLinearGradient(0,padTop,0,padTop+plotH);
   grad.addColorStop(0,'rgba(197,165,107,0.26)');
   grad.addColorStop(1,'rgba(197,165,107,0.0)');
   ctx.fillStyle=grad;
   ctx.beginPath();
   ctx.moveTo(pts[0].x,padTop+plotH);
   pts.forEach(p=>ctx.lineTo(p.x,p.y));
   ctx.lineTo(pts[pts.length-1].x,padTop+plotH);
   ctx.closePath();
   ctx.fill();
 }

 ctx.strokeStyle=goldCol;
 ctx.lineWidth=3;
 ctx.lineJoin='round';
 ctx.lineCap='round';
 ctx.beginPath();
 pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
 ctx.stroke();

 ctx.textAlign='center';
 pts.forEach((p,i)=>{
   ctx.fillStyle=surfaceCol;
   ctx.strokeStyle=goldCol;
   ctx.lineWidth=2.5;
   ctx.beginPath();
   ctx.arc(p.x,p.y,4,0,Math.PI*2);
   ctx.fill();
   ctx.stroke();

   const cycTitle=p.item.cycle.monthLabel||computeCycleReferenceMonth(p.item.cycle);
   const deltaSign=p.item.delta>0?'+':p.item.delta<0?'−':'';
   chartHitAreas.chart.push({
     shape:'circle',
     cx:p.x,
     cy:p.y,
     r:18,
     tipX:p.x,
     tipY:p.y,
     title:cycTitle,
     valText:eur(p.item.value),
     subText:`Variação no ciclo: ${deltaSign}${eur(Math.abs(p.item.delta))}`
   });

   const label=p.item.cycle.open?'Atual':fmtDate(p.item.cycle.end).replace(/ \d{4}$/,'');
   ctx.fillStyle=mutedCol;
   ctx.font='10.5px system-ui,sans-serif';
   ctx.fillText(label,p.x,h-8);

   if(i===pts.length-1){
     ctx.fillStyle=inkCol;
     ctx.font='700 11px system-ui,sans-serif';
     ctx.fillText(eur(p.item.value),Math.min(w-34,Math.max(padLeft+20,p.x)),Math.max(13,p.y-9));
   }
 });
}

// MOTOR DE ORÇAMENTO INTELIGENTE E EQUILÍBRIO RECEITA vs. DESPESA
function roundSmartBudget(val){
 if(!Number.isFinite(val)||val<=0)return 0;
 if(val<=25)return Math.ceil(val);
 if(val<=200)return Math.round(val/5)*5;
 return Math.round(val/10)*10;
}

function getReferenceMonthlyIncome(){
 const today=iso(now);
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
 const today=iso(now);
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
 let m=$('calendarMonth').value||cur,[y,mo]=m.split('-').map(Number),off=(new Date(y,mo-1,1).getDay()+6)%7,days=new Date(y,mo,0).getDate(),s=['2ª','3ª','4ª','5ª','6ª','Sáb','Dom'].map(x=>`<div class="dayname">${x}</div>`).join('');
 const today=iso(now);
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

$('calendarMonth').value=cur;$('calendarMonth').onchange=()=>{selected=$('calendarMonth').value+'-01';drawCalendar()};
$('date').value=iso(now);

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
function monthIndex(m){const [y,mo]=m.split('-').map(Number);return y*12+mo-1}
function dueDate(year,month,day){const last=new Date(year,month,0).getDate();return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`}
function generateDueOccurrences(){
 const today=iso(new Date()),current=today.slice(0,7);let changed=false;
 const deletedSet=new Set((db.deletedIds||[]).map(x=>String(x.id)));
 db.recurringExpenses.forEach(r=>{
  if(!r.active||!r.startMonth)return;
  const from=monthIndex(r.startMonth),to=Math.min(monthIndex(current),r.endMonth?monthIndex(r.endMonth):monthIndex(current));
  for(let idx=from;idx<=to;idx++){
   const year=Math.floor(idx/12),month=idx%12+1,date=dueDate(year,month,Number(r.day)||1),key=`${r.id}:${year}-${String(month).padStart(2,'0')}`;
   const occId='rec-'+key.replace(/[^a-zA-Z0-9_-]/g,'-');
   if(date>today)continue;
   if(deletedSet.has(occId))continue;
   if(db.transactions.some(t=>t.occurrenceKey===key||String(t.id)===occId))continue;
   db.transactions.push({id:occId,date,type:'expense',description:r.description,amount:Number(r.amount),category:r.category,person:r.person,status:'pending',recurrenceId:r.id,occurrenceKey:key,updatedAt:Date.now()});changed=true;
  }
 });
 if(changed){localStorage.setItem(KEY,JSON.stringify(db));queueCloudSave()}
 return changed;
}
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
function resetRecurrenceForm(){ $('recurrenceForm').reset();$('recurrenceId').value='';$('recurrenceDay').value='1';$('recurrenceStart').value=cur;$('recurrenceFormTitle').textContent='Nova despesa recorrente';$('recurrenceSave').textContent='Guardar recorrência';$('recurrenceCancel').hidden=true; }
$('recurrenceStart').value=cur;
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
  const nowBtn = e.target.closest('[data-alert-hide-now]');
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
function shift(n){let d=new Date(($('calendarMonth').value||cur)+'-02T12:00:00');d.setMonth(d.getMonth()+n);$('calendarMonth').value=iso(d).slice(0,7);selected=iso(d).slice(0,7)+'-01';drawCalendar()}
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

function bufToB64(buf){
  const bytes=new Uint8Array(buf);
  let bin='';
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBuf(b64){
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return bytes;
}
function randomBytes(len){
  const arr=new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}
async function hashPinWithSalt(pin,saltB64){
  const enc=new TextEncoder();
  const data=enc.encode(saltB64+':'+String(pin));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return bufToB64(digest);
}
async function deriveAesKey(passphrase,saltBytes,iterations=150000){
  const enc=new TextEncoder();
  const baseKey=await crypto.subtle.importKey('raw',enc.encode(String(passphrase)),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:saltBytes,iterations,hash:'SHA-256'},
    baseKey,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function encryptJsonAesGcm(obj,passphrase){
  const salt=randomBytes(16);
  const iv=randomBytes(12);
  const key=await deriveAesKey(passphrase,salt);
  const plaintext=new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
  return {
    __duofin_encrypted__:true,
    v:1,
    alg:'AES-256-GCM',
    kdf:'PBKDF2-SHA256',
    iter:150000,
    salt:bufToB64(salt),
    iv:bufToB64(iv),
    ct:bufToB64(ciphertext)
  };
}
async function decryptJsonAesGcm(envelope,passphrase){
  if(!envelope||envelope.__duofin_encrypted__!==true||!envelope.ct||!envelope.iv||!envelope.salt){
    throw new Error('Formato encriptado inválido.');
  }
  const salt=b64ToBuf(envelope.salt);
  const iv=b64ToBuf(envelope.iv);
  const ct=b64ToBuf(envelope.ct);
  const iter=Number(envelope.iter)||150000;
  const key=await deriveAesKey(passphrase,salt,iter);
  const plainBuf=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

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
    const n=normalizeDb(parsed);
    db=n.db;
    persist();
    showToast('Cópia de segurança importada com sucesso.',{type:'success'});
  }catch(_){
    alert('Ficheiro inválido ou palavra-passe incorreta.');
  }
  e.target.value='';
};
$('reset').onclick=()=>{if(confirm('Apagar todos os dados deste dispositivo?')){db=fresh();persist()}};
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

// Sincronização Supabase com Auto-Merge Inteligente (updatedAt + Tombstones + Rollovers)
const CLOUD_KEY='orcamento-plus-cloud-v1';
const E2EE_SECRET_KEY='duofin-e2ee-secret-v1';
let cloud={url:'',key:'',access_token:'',refresh_token:'',expires_at:0,user:null,household_id:null,revision:null,dirty:false};
function getE2eeSecret(){return localStorage.getItem(E2EE_SECRET_KEY)||'';}
function paintE2eeStatus(){
  const hasSec=!!getE2eeSecret();
  if($('disableE2eeBtn'))$('disableE2eeBtn').hidden=!hasSec;
  if($('e2eeStatusText')){
    $('e2eeStatusText').textContent=hasSec
      ?'Ativa (AES-256-GCM): todos os dados enviados para o Supabase são cifrados localmente antes de sair deste dispositivo. Usa exatamente a mesma chave secreta no outro telemóvel.'
      :'Desativada: os dados são enviados em JSON padrão protegidos por RLS. Se definirem a mesma chave secreta nos dois telemóveis, todo o payload é cifrado localmente em AES-256-GCM antes de sair do dispositivo.';
  }
}
if($('saveE2eeBtn'))$('saveE2eeBtn').onclick=async()=>{
  const val=($('e2eePassphrase')?.value||'').trim();
  if(val.length<6){alert('A chave secreta E2EE deve ter pelo menos 6 caracteres.');return;}
  localStorage.setItem(E2EE_SECRET_KEY,val);
  $('e2eePassphrase').value='';
  paintE2eeStatus();
  showToast('Chave E2EE guardada. A sincronizar dados cifrados...',{type:'success'});
  if(cloudConnected()&&cloud.household_id){cloud.dirty=true;saveCloud();await pushCloud(false).catch(()=>{});}
};
if($('disableE2eeBtn'))$('disableE2eeBtn').onclick=async()=>{
  if(!confirm('Desativar a encriptação ponta-a-ponta neste dispositivo?'))return;
  localStorage.removeItem(E2EE_SECRET_KEY);
  paintE2eeStatus();
  showToast('Encriptação ponta-a-ponta desativada.');
};
paintE2eeStatus();
async function encodeCloudPayload(plainDb){
  const sec=getE2eeSecret();
  if(!sec)return plainDb;
  return await encryptJsonAesGcm(plainDb,sec);
}
async function decodeCloudPayload(rawPayload){
  if(!rawPayload||rawPayload.__duofin_encrypted__!==true)return rawPayload;
  const sec=getE2eeSecret();
  if(!sec)throw new Error('Os dados na nuvem estão cifrados (E2EE). Introduz a Chave Secreta do Casal em Dados -> Sincronização.');
  try{
    return await decryptJsonAesGcm(rawPayload,sec);
  }catch(_){
    throw new Error('Não foi possível decifrar os dados da nuvem. Confirma se a Chave Secreta E2EE é idêntica nos dois telemóveis.');
  }
}
try{cloud={...cloud,...JSON.parse(localStorage.getItem(CLOUD_KEY)||'{}')}}catch(e){}
if(dbNeedsSync){cloud.dirty=true;localStorage.setItem(CLOUD_KEY,JSON.stringify(cloud));}
let cloudSaveTimer=null,cloudBusy=false;
function saveCloud(){localStorage.setItem(CLOUD_KEY,JSON.stringify(cloud))}
function cloudMessage(msg,kind='alert'){const el=$('cloudStatus');if(!el)return;el.className=kind;el.textContent=msg}
function cloudConfigured(){return /^https:\/\/[a-z0-9.-]+$/i.test(cloud.url)&&!!cloud.key}
function cloudConnected(){return cloudConfigured()&&!!cloud.access_token&&!!cloud.user}
function paintCloud(){
  if(!$('cloudStatus'))return;
  $('sbUrl').value=cloud.url||'';$('sbKey').value=cloud.key||'';
  $('cloudLogout').hidden=!cloudConnected();$('authPanel').hidden=cloudConnected();$('householdPanel').hidden=!cloudConnected();
  if(!cloudConfigured())cloudMessage('Ainda não configurada. Introduz o URL e a chave pública do projeto Supabase.');
  else if(!cloudConnected())cloudMessage('Projeto configurado. Inicia sessão ou cria uma conta para ativar a sincronização.','alert good');
  else if(!cloud.household_id)cloudMessage('Sessão iniciada. Cria um orçamento partilhado ou associa-te com um código de convite.','alert good');
  else cloudMessage(cloud.dirty?'Existem alterações locais por enviar.':'Conta ligada. Orçamento partilhado: '+cloud.household_id.slice(0,8)+'… · revisão '+(cloud.revision??'—'),'alert good');
  $('householdInfo').textContent=cloud.household_id?'Orçamento partilhado ativo. As alterações são sincronizadas automaticamente quando possível.':'Ainda não estás associado a um orçamento.';
}
function saveCloudConfig(){let u=$('sbUrl').value.trim().replace(/\/$/,'');let k=$('sbKey').value.trim();if(!/^https:\/\/[a-z0-9.-]+$/i.test(u)||!k){alert('Introduz um URL HTTPS válido e a chave pública do projeto.');return}if((u!==cloud.url||k!==cloud.key)&&cloud.access_token){if(!confirm('Alterar o projeto termina a sessão atual neste dispositivo. Continuar?'))return;cloud.access_token='';cloud.refresh_token='';cloud.expires_at=0;cloud.user=null;cloud.household_id=null;cloud.revision=null;cloud.dirty=false}cloud.url=u;cloud.key=k;saveCloud();paintCloud();}
$('saveCloudConfig').onclick=saveCloudConfig;
async function authFetch(path,body){const r=await fetch(cloud.url+'/auth/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json','apikey':cloud.key},body:JSON.stringify(body)});let j={};try{j=await r.json()}catch(e){}if(!r.ok)throw new Error(j.msg||j.message||j.error_description||j.error||('Erro de autenticação ('+r.status+')'));return j}
async function refreshToken(){if(!cloud.refresh_token)return;if(cloud.expires_at>Date.now()+60000)return;const j=await authFetch('token?grant_type=refresh_token',{refresh_token:cloud.refresh_token});setSession(j)}
function setSession(j){cloud.access_token=j.access_token;cloud.refresh_token=j.refresh_token||cloud.refresh_token;cloud.expires_at=Date.now()+(j.expires_in||3600)*1000;cloud.user=j.user||cloud.user;saveCloud()}
async function api(path,opts={}){await refreshToken();const headers={'apikey':cloud.key,'Authorization':'Bearer '+(cloud.access_token||cloud.key),'Content-Type':'application/json',...(opts.headers||{})};const r=await fetch(cloud.url+'/rest/v1/'+path,{...opts,headers});let j=null;try{j=await r.json()}catch(e){}if(!r.ok){let msg=j?.message||j?.details||j?.hint||('Erro do servidor ('+r.status+')');throw new Error(msg)}return j}
async function rpc(name,args){return api('rpc/'+name,{method:'POST',body:JSON.stringify(args)})}
function validPayload(p){return !!(p&&p.settings&&Array.isArray(p.transactions))}
function hasLocalData(){return JSON.stringify(db)!==JSON.stringify(fresh())}
function setLocalData(p){const n=normalizeDb(p);db=n.db;localStorage.setItem(KEY,JSON.stringify(db));render();return n.changed;}

function tryMergePayloads(localRaw, remoteRaw){
  const local=normalizeDb(JSON.parse(JSON.stringify(localRaw))).db;
  const remote=normalizeDb(JSON.parse(JSON.stringify(remoteRaw))).db;

  // União de tombstones (registos apagados recentemente)
  const delMap=new Map();
  [...(remote.deletedIds||[]),...(local.deletedIds||[])].forEach(d=>{
    if(d&&d.id){
      const id=String(d.id);
      const prev=delMap.get(id);
      if(!prev||(d.at||0)>(prev.at||0))delMap.set(id,{id,at:d.at||Date.now()});
    }
  });
  const deletedSet=new Set(delMap.keys());

  const txMap=new Map();
  remote.transactions.forEach(t=>{if(!deletedSet.has(String(t.id)))txMap.set(String(t.id),t);});
  for(const t of local.transactions){
    const id=String(t.id);
    if(deletedSet.has(id))continue;
    if(!txMap.has(id)){
      txMap.set(id,t);
    }else{
      const rTx=txMap.get(id);
      if(JSON.stringify(rTx)!==JSON.stringify(t)){
        if(rTx.status==='pending'&&t.status!=='pending')txMap.set(id,t);
        else if(t.status==='pending'&&rTx.status!=='pending')txMap.set(id,rTx);
        else{
          const lTime=Number(t.updatedAt)||0;
          const rTime=Number(rTx.updatedAt)||0;
          if(lTime>0||rTime>0)txMap.set(id,lTime>=rTime?t:rTx);
          else return null;
        }
      }
    }
  }

  const recMap=new Map();
  (remote.recurringExpenses||[]).forEach(r=>{if(!deletedSet.has(String(r.id)))recMap.set(String(r.id),r);});
  for(const r of (local.recurringExpenses||[])){
    const id=String(r.id);
    if(deletedSet.has(id))continue;
    if(!recMap.has(id))recMap.set(id,r);
    else{
      const rRec=recMap.get(id);
      if(JSON.stringify(rRec)!==JSON.stringify(r)){
        const lTime=Number(r.updatedAt)||0;
        const rTime=Number(rRec.updatedAt)||0;
        if(lTime>0||rTime>0)recMap.set(id,lTime>=rTime?r:rRec);
        else return null;
      }
    }
  }

  const goalMap=new Map();
  (remote.savingsGoals||[]).forEach(g=>{if(!deletedSet.has(String(g.id)))goalMap.set(String(g.id),g);});
  for(const g of (local.savingsGoals||[])){
    const id=String(g.id);
    if(deletedSet.has(id))continue;
    if(!goalMap.has(id))goalMap.set(id,g);
    else{
      const rGoal=goalMap.get(id);
      if(JSON.stringify(rGoal)!==JSON.stringify(g)){
        const lTime=Number(g.updatedAt)||0;
        const rTime=Number(rGoal.updatedAt)||0;
        if(lTime>0||rTime>0)goalMap.set(id,lTime>=rTime?g:rGoal);
        else return null;
      }
    }
  }

  // Fundir decisões de sobras de ciclo (handledCycleRollovers)
  const rollMap=new Map();
  [...(remote.handledCycleRollovers||[]),...(local.handledCycleRollovers||[])].forEach(h=>{
    if(h&&h.cycleKey){
      const prev=rollMap.get(h.cycleKey);
      if(!prev||(h.at||0)<(prev.at||0))rollMap.set(h.cycleKey,h);
    }
  });

  // Fundir regras aprendidas sem gerar conflito
  const rulesMap=new Map();
  [...(remote.settings.categoryRules||[]),...(local.settings.categoryRules||[])].forEach(rl=>{
    if(rl&&rl.keyword)rulesMap.set(rl.keyword.toUpperCase(),rl);
  });
  const mergedSettings={...remote.settings,categoryRules:[...rulesMap.values()]};

  // Fundir categorias por nome se não houver eliminação conflitante
  const catMap=new Map();
  (remote.settings.categories||[]).forEach(c=>catMap.set(c.name.toLocaleLowerCase('pt-PT'),{...c}));
  (local.settings.categories||[]).forEach(c=>{
    const k=c.name.toLocaleLowerCase('pt-PT');
    if(!catMap.has(k)){
      catMap.set(k,{...c});
    }else{
      const rCat=catMap.get(k);
      const lTime=Number(c.updatedAt)||0;
      const rTime=Number(rCat.updatedAt)||0;
      if(lTime>rTime)catMap.set(k,{...c});
    }
  });
  mergedSettings.categories=[...catMap.values()];

  return {
    settings:mergedSettings,
    transactions:[...txMap.values()],
    recurringExpenses:[...recMap.values()],
    savingsGoals:[...goalMap.values()],
    deletedIds:[...delMap.values()],
    handledCycleRollovers:[...rollMap.values()]
  };
}

async function memberships(){const rows=await api('household_members?select=household_id&user_id=eq.'+encodeURIComponent(cloud.user.id));return rows||[]}
async function afterLogin(){const ms=await memberships();let ids=ms.map(x=>x.household_id);if(cloud.household_id&&!ids.includes(cloud.household_id))cloud.household_id=null;if(!cloud.household_id&&ids.length)cloud.household_id=ids[0];saveCloud();paintCloud();if(cloud.household_id)await syncNow(false,true);if(generateDueOccurrences())render()}
async function loginOrSignup(signup){if(!saveCloudConfigIfNeeded())throw new Error('A configuração do projeto não foi alterada. Confirma o URL e a chave pública.');if(!cloudConfigured())throw new Error('Guarda primeiro o URL e a chave pública do Supabase.');const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6)throw new Error('Indica um email e uma palavra-passe com pelo menos 6 caracteres.');const j=await authFetch(signup?('signup?redirect_to='+encodeURIComponent(location.href)):'token?grant_type=password',{email,password});if(!j.access_token){cloudMessage('Conta criada. Confirma o email recebido e depois inicia sessão.','alert good');return}setSession(j);await afterLogin();}
function saveCloudConfigIfNeeded(){if($('sbUrl').value.trim()!==cloud.url||$('sbKey').value.trim()!==cloud.key){saveCloudConfig();return $('sbUrl').value.trim().replace(/\/$/,'')===cloud.url&&$('sbKey').value.trim()===cloud.key}return true}
$('cloudLogin').onclick=async()=>{try{await loginOrSignup(false);cloudMessage('Sessão iniciada.','alert good')}catch(e){cloudMessage(e.message,'alert red')}};
$('cloudSignup').onclick=async()=>{try{await loginOrSignup(true)}catch(e){cloudMessage(e.message,'alert red')}};
$('cloudLogout').onclick=async()=>{try{if(cloud.access_token)await fetch(cloud.url+'/auth/v1/logout',{method:'POST',headers:{'apikey':cloud.key,'Authorization':'Bearer '+cloud.access_token}})}catch(e){}cloud.access_token='';cloud.refresh_token='';cloud.expires_at=0;cloud.user=null;cloud.household_id=null;cloud.revision=null;cloud.dirty=false;saveCloud();paintCloud();cloudMessage('Sessão terminada. Os dados locais continuam neste telemóvel.','alert good')};
$('createHousehold').onclick=async()=>{try{const name=$('householdName').value.trim()||'Orçamento do casal';const id=await rpc('create_household',{p_name:name});cloud.household_id=typeof id==='string'?id:id?.id;cloud.revision=0;cloud.dirty=true;saveCloud();paintCloud();await pushCloud(false);cloudMessage('Orçamento criado e primeira cópia enviada. Agora gera um convite para o outro adulto.','alert good')}catch(e){cloudMessage(e.message,'alert red')}};
$('createInvite').onclick=async()=>{try{if(!cloud.household_id)throw new Error('Cria ou associa primeiro um orçamento.');const code=await rpc('create_invite',{p_household_id:cloud.household_id});$('inviteResult').hidden=false;$('inviteResult').textContent='Código de convite (válido durante 48 horas e para uma utilização): '+String(code).replace(/^"|"$/g,'');}catch(e){cloudMessage(e.message,'alert red')}};
$('joinHousehold').onclick=async()=>{try{const code=$('inviteCode').value.trim();if(!code)throw new Error('Introduz o código de convite.');const id=await rpc('join_household',{p_code:code});cloud.household_id=typeof id==='string'?id:id?.id;cloud.revision=null;cloud.dirty=false;saveCloud();paintCloud();await syncNow(true,true);cloudMessage('Telemóvel associado. Confirma o estado da sincronização acima.','alert good')}catch(e){cloudMessage(e.message,'alert red')}};

async function getCloudRow(){const rows=await api('household_data?select=household_id,payload,revision,updated_at&household_id=eq.'+encodeURIComponent(cloud.household_id));if(!rows||!rows.length)throw new Error('Não foi encontrado o registo do orçamento partilhado. Confirma a configuração SQL.');return rows[0]}

async function pushCloud(overwrite=false){
 if(!cloudConnected()||!cloud.household_id)return;
 if(cloudBusy)return;
 cloudBusy=true;
 try{
   const row=await getCloudRow();
   const remoteDecrypted=await decodeCloudPayload(row.payload);
   if(!overwrite&&cloud.revision!==null&&row.revision!==cloud.revision){
     const merged=validPayload(remoteDecrypted)?tryMergePayloads(db,remoteDecrypted):null;
     if(merged){
       setLocalData(merged);
       cloud.revision=row.revision;
     }else{
       cloud.dirty=true;saveCloud();
       cloudMessage('Conflito: o outro telemóvel alterou definições ou o mesmo registo. Escolhe “Carregar versão partilhada” ou “Enviar versão deste telemóvel”.','alert red');
       return;
     }
   }
   if(overwrite&&!confirm('Isto vai substituir a versão partilhada pela versão guardada neste telemóvel. Continuar?'))return;
   const expected=overwrite?row.revision:(cloud.revision===null?row.revision:cloud.revision);
   const wirePayload=await encodeCloudPayload(db);
   const result=await rpc('save_household_data',{p_household_id:cloud.household_id,p_payload:wirePayload,p_expected_revision:expected});
   const r=Array.isArray(result)?result[0]:result;
   if(!r?.ok){
     cloud.dirty=true;cloud.revision=r?.revision??row.revision;saveCloud();
     cloudMessage('Conflito de sincronização. Carrega a versão partilhada ou volta a enviar explicitamente.','alert red');
     return;
   }
   cloud.revision=r.revision;cloud.dirty=false;saveCloud();paintCloud();
 }finally{cloudBusy=false}
}

async function syncNow(forcePull=false,silent=false){
 if(!cloudConnected()||!cloud.household_id)return;
 try{
   const row=await getCloudRow();
   const remotePayload=await decodeCloudPayload(row.payload);
   if(!validPayload(remotePayload)){cloud.revision=row.revision;cloud.dirty=true;saveCloud();await pushCloud(false);return}
   if(forcePull){
     if(hasLocalData()&&!confirm('Carregar a versão partilhada vai substituir os dados locais deste telemóvel. Continuar?'))return;
     const migrated=setLocalData(remotePayload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(cloud.revision===null){
     if(hasLocalData()){cloud.revision=row.revision;cloud.dirty=true;saveCloud();cloudMessage('Este telemóvel já tem dados locais. Exporta uma cópia e escolhe qual versão deve prevalecer.','alert red');return}
     const migrated=setLocalData(remotePayload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(row.revision!==cloud.revision){
     if(cloud.dirty){
       const merged=tryMergePayloads(db,remotePayload);
       if(merged){
         setLocalData(merged);cloud.revision=row.revision;cloud.dirty=true;saveCloud();
         await pushCloud(false);
         if(!silent)cloudMessage('Alterações simultâneas fundidas com sucesso. Revisão '+cloud.revision+'.','alert good');
         return;
       }
       cloudMessage('Conflito: existem alterações incompatíveis neste telemóvel e na versão partilhada. Escolhe uma das duas ações.','alert red');
       return;
     }
     const migrated=setLocalData(remotePayload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(cloud.dirty)await pushCloud(false);
   else if(!silent)cloudMessage('Tudo sincronizado. Revisão '+cloud.revision+'.','alert good');
 }catch(e){if(!silent)cloudMessage('Não foi possível sincronizar: '+e.message,'alert red')}
}

$('syncNow').onclick=()=>syncNow(false,false);
$('cloudPull').onclick=()=>syncNow(true,false);
$('cloudPush').onclick=()=>pushCloud(true).catch(e=>cloudMessage(e.message,'alert red'));
function queueCloudSave(){if(!cloudConnected()||!cloud.household_id)return;cloud.dirty=true;saveCloud();paintCloud();clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>pushCloud(false).catch(e=>cloudMessage(e.message,'alert red')),1200)}
setInterval(()=>{if(document.visibilityState==='visible'&&cloudConnected()&&cloud.household_id)syncNow(false,true)},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudConnected()&&cloud.household_id)syncNow(false,true)});
paintCloud();
render();
if(!cloudConnected()&&generateDueOccurrences())render();
if(cloudConnected())refreshToken().then(afterLogin).catch(e=>cloudMessage('A sessão expirou. Inicia sessão novamente: '+e.message,'alert red'));

// Mostrar modal de novidades uma única vez após atualização para v6.6.0
if(!appLocked && localStorage.getItem(CHANGELOG_KEY)!==APP_VERSION){
  setTimeout(openChangelogModal, 450);
}

if('serviceWorker'in navigator&&location.protocol.startsWith('http'))addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
