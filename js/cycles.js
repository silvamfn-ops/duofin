// js/cycles.js — Motor de ciclos de rendimento, rollover de sobras e projeção de fecho
let ctx = null;
export function initCyclesModule(context) {
  ctx = context;
}

export function addMonthsClamp(dateStr, monthsToAdd){
 const [y,m,d]=dateStr.split('-').map(Number);
 const totalM=(y*12+(m-1))+monthsToAdd;
 const ny=Math.floor(totalM/12),nm=(totalM%12)+1;
 const lastDay=new Date(ny,nm,0).getDate();
 return `${ny}-${String(nm).padStart(2,'0')}-${String(Math.min(d,lastDay)).padStart(2,'0')}`;
}

export function computeCycleReferenceMonth(c){
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

export function assignCycleMonthLabels(cycles){
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

export function buildCycles(){
 const today=ctx.iso(ctx.now()),validTx=ctx.db.transactions.filter(t=>validDate(t.date)&&t.date<=today);
 const cycleIncomes=validTx.filter(t=>t.type==='income'&&isPaid(t)&&t.countsForCycle!==false).sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 if(!cycleIncomes.length){
   const monthKeys=[...new Set([...validTx.map(t=>t.date.slice(0,7)),ctx.cur()])].sort();
   return assignCycleMonthLabels(monthKeys.map(m=>({key:'month:'+m,start:m+'-01',end:monthLast(m),fallback:true,preCycle:false,open:false,incomeDates:[],label:mName(m)})));
 }
 const maxGap=Math.max(0,Math.min(20,Math.round(Number(ctx.db.settings.cycleGroupingDays??14))));
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
     const futureDates=ctx.db.transactions.filter(t=>validDate(t.date)&&t.date>today).map(t=>t.date).sort();
     const maxEnd=futureDates.length?futureDates[futureDates.length-1]:today;
     cycles.push({key:'open:'+start,start,end:maxEnd,anchor:g.lastDate,open:true,fallback:false,preCycle:false,incomeDates:g.items.map(t=>t.date),incomeCount:g.items.length});
   }
 }
 return assignCycleMonthLabels(cycles);
}

// CÁLCULO DE SALDO DE UM CICLO ESPECÍFICO
export function computeCycleBalance(c, upToDate=ctx.iso(ctx.now())){
 const tx=cycleTransactions(c).filter(t=>t.date<=upToDate);
 const ex=tx.filter(t=>t.type==='expense'&&isPaid(t));
 const inc=tx.filter(t=>t.type==='income'&&isPaid(t));
 const svIn=tx.filter(t=>t.type==='saving'&&isPaid(t));
 const svOut=tx.filter(t=>t.type==='saving_withdraw'&&isPaid(t));
 return sum(inc)+sum(svOut)-sum(ex)-sum(svIn);
}

// GESTÃO INTERATIVA DE SOBRA DO CICLO ANTERIOR
let pendingRolloverCandidate=null;

export function detectPreviousCycleRollover(cycles, selectedCycle){
 const curCyc=currentCycle(cycles);
 if(!curCyc||selectedCycle.key!==curCyc.key)return null;
 const idx=cycles.findIndex(c=>c.key===curCyc.key);
 if(idx<=0)return null;
 const prevCycle=cycles[idx-1];
 if(!prevCycle||prevCycle.fallback)return null;

 const handled=Array.isArray(ctx.db.handledCycleRollovers)?ctx.db.handledCycleRollovers:[];
 if(handled.some(h=>h&&h.cycleKey===prevCycle.key))return null;

 const prevBal=Number(computeCycleBalance(prevCycle,prevCycle.end).toFixed(2));
 if(prevBal<=0.009)return null;

 return {
   prevCycle,
   currentCycle:curCyc,
   amount:prevBal
 };
}

export function renderRolloverBanner(cycles, selectedCycle){
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

// PROJEÇÃO DE FECHO DE CICLO (SALDO REAL VS. PREVISTO INCLUINDO POUPANÇAS AGENDADAS)
export function computeCycleProjection(cycle, currentBalance){
 const today=ctx.iso(ctx.now());
 if(!cycle.open&&cycle.end<=today)return null;

 const estimatedCycleEnd=cycle.open?addDays(addMonthsClamp(cycle.start,1),-1):cycle.end;
 const horizonEnd=estimatedCycleEnd>today?estimatedCycleEnd:today;

 // 1. Despesas pendentes já geradas dentro do ciclo até hoje
 const pendingInCycle=cycleTransactions(cycle).filter(t=>t.type==='expense'&&t.status==='pending'&&t.date<=today);

 // 2. Despesas futuras já agendadas (ex.: prestações) dentro do horizonte do ciclo
 const scheduledFutureExp=ctx.db.transactions.filter(t=>t.type==='expense'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

 // 3. Transferências e resgates de poupança futuros já agendados no horizonte do ciclo
 const scheduledFutureSavOut=ctx.db.transactions.filter(t=>t.type==='saving'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);
 const scheduledFutureSavIn=ctx.db.transactions.filter(t=>t.type==='saving_withdraw'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

 // 4. Regras de despesas recorrentes ativas que ainda vão vencer entre amanhã e o fim estimado do ciclo
 const startYm=today.slice(0,7),endYm=horizonEnd.slice(0,7);
 const fromIdx=ctx.monthIndex(startYm),toIdx=ctx.monthIndex(endYm);
 let upcomingRulesTotal=0,upcomingRulesCount=0;
 (ctx.db.recurringExpenses||[]).forEach(r=>{
   if(!r.active||!r.startMonth)return;
   const rFrom=Math.max(fromIdx,ctx.monthIndex(r.startMonth));
   const rTo=r.endMonth?Math.min(toIdx,ctx.monthIndex(r.endMonth)):toIdx;
   for(let idx=rFrom;idx<=rTo;idx++){
     const y=Math.floor(idx/12),m=(idx%12)+1;
     const dStr=ctx.dueDate(y,m,Number(r.day)||1);
     const occKey=`${r.id}:${y}-${String(m).padStart(2,'0')}`;
     if(dStr>today&&dStr<=horizonEnd&&!ctx.db.transactions.some(t=>t.occurrenceKey===occKey)){
       upcomingRulesTotal+=(Number(r.amount)||0);
       upcomingRulesCount++;
     }
   }
 });

 // 5. Rendimentos futuros já agendados no mesmo horizonte
 const futureInc=ctx.db.transactions.filter(t=>t.type==='income'&&t.status!=='skipped'&&t.date>today&&t.date<=horizonEnd);

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

export function currentCycle(cycles){
 const today=ctx.iso(ctx.now());
 return cycles.find(c=>c.start<=today&&c.end>=today&&!c.preCycle)||cycles.find(c=>c.start<=today&&c.end>=today)||cycles.slice(-1)[0];
}
export function cycleName(c){
 const mTag=c.monthLabel||computeCycleReferenceMonth(c);
 if(c.fallback)return `${mTag} · período provisório`;
 if(c.preCycle)return `${mTag} (${fmtDate(c.start)} – ${fmtDate(c.end)})`;
 return `${mTag} (${fmtDate(c.start)} – ${fmtDate(c.end)})${c.open?' · em curso':''}`;
}
export function cycleTransactions(c){return ctx.db.transactions.filter(t=>validDate(t.date)&&t.date>=c.start&&t.date<=c.end);}
export function getSelectedCycle(){
 const cycles=buildCycles();
 let c=cycles.find(x=>x.key===ctx.getSelectedCycleKey())||currentCycle(cycles);
 if(!c){
   c={key:'month:'+ctx.cur(),start:cur+'-01',end:monthLast(cur),fallback:true,preCycle:false,open:false};
   c.monthLabel=computeCycleReferenceMonth(c);
 }
 ctx.setSelectedCycleState(c.key, c, cycles);
 return {cycles,cycle:c};
}
export function bindRolloverEvents() {
  const $ = id => document.getElementById(id);
  if ($('rolloverCarryBtn')) $('rolloverCarryBtn').onclick = () => {
    if (!pendingRolloverCandidate) return;
    const { prevCycle, currentCycle: curCyc, amount } = pendingRolloverCandidate;
    const prevName = prevCycle.monthLabel || computeCycleReferenceMonth(prevCycle);
    const nowTs = Date.now();
    const txId = 'rollover-in-' + nowTs.toString(36);
    ctx.db.transactions.push({
      id: txId,
      date: curCyc.start,
      type: 'income',
      description: `Saldo transitado · ${prevName}`,
      amount: Number(amount.toFixed(2)),
      category: 'Rendimento',
      person: 'Conta conjunta',
      countsForCycle: false,
      updatedAt: nowTs
    });
    if (!Array.isArray(ctx.db.handledCycleRollovers)) ctx.db.handledCycleRollovers = [];
    ctx.db.handledCycleRollovers.push({ cycleKey: prevCycle.key, action: 'carry_forward', amount, txId, at: nowTs });
    ctx.persist();
  };

  if ($('rolloverSaveStepBtn')) $('rolloverSaveStepBtn').onclick = () => {
    if (!pendingRolloverCandidate) return;
    const goals = (ctx.db.savingsGoals || []).filter(g => g.status === 'active');
    const sel = $('rolloverGoalSelect');
    sel.innerHTML = '<option value="">Poupança geral (sem objetivo específico)</option>' + goals.map(g => `<option value="${ctx.esc(g.id)}">${ctx.esc(g.name)}</option>`).join('');
    $('rolloverMainActions').hidden = true;
    $('rolloverGoalPicker').hidden = false;
  };

  if ($('rolloverCancelSaveBtn')) $('rolloverCancelSaveBtn').onclick = () => {
    $('rolloverGoalPicker').hidden = true;
    $('rolloverMainActions').hidden = false;
  };

  if ($('rolloverConfirmSaveBtn')) $('rolloverConfirmSaveBtn').onclick = () => {
    if (!pendingRolloverCandidate) return;
    const { prevCycle, amount } = pendingRolloverCandidate;
    const prevName = prevCycle.monthLabel || computeCycleReferenceMonth(prevCycle);
    const goalId = $('rolloverGoalSelect').value;
    const goalObj = goalId ? (ctx.db.savingsGoals || []).find(g => g.id === goalId) : null;
    const nowTs = Date.now();
    const txId = 'rollover-sav-' + nowTs.toString(36);
    const entry = {
      id: txId,
      date: prevCycle.end,
      type: 'saving',
      description: goalObj ? `Sobra de ${prevName} → ${goalObj.name}` : `Sobra de ${prevName} → Poupança`,
      amount: Number(amount.toFixed(2)),
      category: 'Poupança',
      person: 'Conta conjunta',
      updatedAt: nowTs
    };
    if (goalObj) entry.goalId = goalObj.id;
    ctx.db.transactions.push(entry);
    if (!Array.isArray(ctx.db.handledCycleRollovers)) ctx.db.handledCycleRollovers = [];
    ctx.db.handledCycleRollovers.push({ cycleKey: prevCycle.key, action: 'saving', goalId: goalId || null, amount, txId, at: nowTs });
    ctx.persist();
  };

  if ($('rolloverDismissBtn')) $('rolloverDismissBtn').onclick = () => {
    if (!pendingRolloverCandidate) return;
    const { prevCycle, amount } = pendingRolloverCandidate;
    if (!Array.isArray(ctx.db.handledCycleRollovers)) ctx.db.handledCycleRollovers = [];
    ctx.db.handledCycleRollovers.push({ cycleKey: prevCycle.key, action: 'dismissed', amount, at: Date.now() });
    ctx.persist();
  };
}

