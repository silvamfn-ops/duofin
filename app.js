const $=id=>document.getElementById(id),KEY='orcamento-plus-v1',now=new Date(),iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),cur=iso(now).slice(0,7);
const defs=[['Habitação',850],['Supermercado',450],['Água, luz e gás',180],['Transportes',250],['Telecomunicações',70],['Saúde e farmácia',80],['Crianças e família',150],['Restaurantes e lazer',150],['Vestuário e pessoal',120],['Outros / imprevistos',300]];
const fresh=()=>({settings:{income:3200,target:6000,start:'2026-11-01',deadline:'2027-08-31',cycleGroupingDays:14,people:['Adulto 1','Adulto 2'],categories:defs.map(([name,budget])=>({name,budget}))},transactions:[],recurringExpenses:[],savingsGoals:[]});
let dbNeedsSync=false;

function normalizeDb(x){
 if(!x||!x.settings||!Array.isArray(x.transactions))return {db:fresh(),changed:false};
 let changed=false;
 if(!Array.isArray(x.recurringExpenses)){x.recurringExpenses=[];changed=true;}
 if(!Array.isArray(x.settings.categories)){x.settings.categories=defs.map(([name,budget])=>({name,budget}));changed=true;}
 if(!Array.isArray(x.settings.people)){x.settings.people=['Adulto 1','Adulto 2'];changed=true;}
 if(!Number.isFinite(Number(x.settings.cycleGroupingDays))){x.settings.cycleGroupingDays=14;changed=true;}
 x.settings.cycleGroupingDays=Math.max(0,Math.min(20,Math.round(Number(x.settings.cycleGroupingDays)||0)));
 if(!Array.isArray(x.savingsGoals)){
   const legacyIds=x.transactions.filter(t=>t&&(t.type==='saving'||t.type==='saving_withdraw')).map(t=>String(t.id));
   x.savingsGoals=[];
   if(Number(x.settings.target)>0)x.savingsGoals.push({id:'goal-legacy',name:'Objetivo anterior',target:Number(x.settings.target),deadline:x.settings.deadline||null,status:'active',legacy:true,legacyTransactionIds:legacyIds});
   changed=true;
 }
 x.savingsGoals.forEach(g=>{
   if(!Array.isArray(g.legacyTransactionIds)){g.legacyTransactionIds=[];changed=true;}
   if(!['active','paused','completed'].includes(g.status)){g.status='active';changed=true;}
 });
 return {db:x,changed};
}

function load(){try{const raw=JSON.parse(localStorage.getItem(KEY));if(raw?.settings&&Array.isArray(raw.transactions)){const n=normalizeDb(raw);dbNeedsSync=n.changed;if(n.changed)localStorage.setItem(KEY,JSON.stringify(n.db));return n.db;}}catch(e){}return fresh();}
let db=load(),selected=iso(now),selectedCycleKey=null,activeCycle=null,activeCycles=[];
const eur=n=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(+n||0),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((s,t)=>s+(Number(t.amount)||0),0),isPaid=t=>t.status!=='pending'&&t.status!=='skipped',mName=m=>new Date(m+'-02T12:00:00').toLocaleDateString('pt-PT',{month:'long',year:'numeric'});
const DAY_MS=86400000,dateMs=s=>Date.parse(s+'T00:00:00Z'),validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(dateMs(s)),addDays=(s,n)=>new Date(dateMs(s)+n*DAY_MS).toISOString().slice(0,10),daysBetween=(a,b)=>Math.round((dateMs(b)-dateMs(a))/DAY_MS),monthLast=m=>{const [y,mo]=m.split('-').map(Number);return `${m}-${String(new Date(y,mo,0).getDate()).padStart(2,'0')}`},fmtDate=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});
const isSavingTx=t=>t&&(t.type==='saving'||t.type==='saving_withdraw');
const savingSigned=t=>t.type==='saving_withdraw'?-(Number(t.amount)||0):(Number(t.amount)||0);

function buildCycles(){
 const today=iso(now),validTx=db.transactions.filter(t=>validDate(t.date)&&t.date<=today);
 // Apenas rendimentos marcados como definidores de ciclo (countsForCycle !== false) abrem/fecham ciclos
 const cycleIncomes=validTx.filter(t=>t.type==='income'&&isPaid(t)&&t.countsForCycle!==false).sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
 if(!cycleIncomes.length){
   const monthKeys=[...new Set([...validTx.map(t=>t.date.slice(0,7)),cur])].sort();
   return monthKeys.map(m=>({key:'month:'+m,start:m+'-01',end:monthLast(m),fallback:true,preCycle:false,open:false,incomeDates:[],label:mName(m)}));
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
 // Isola movimentos anteriores ao primeiro vencimento registado num período inicial próprio
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
     cycles.push({key:'open:'+start,start,end:today,anchor:g.lastDate,open:true,fallback:false,preCycle:false,incomeDates:g.items.map(t=>t.date),incomeCount:g.items.length});
   }
 }
 return cycles;
}

function currentCycle(cycles){
 const today=iso(now);
 return cycles.find(c=>c.start<=today&&c.end>=today&&!c.preCycle)||cycles.find(c=>c.start<=today&&c.end>=today)||cycles.slice(-1)[0];
}
function cycleName(c){
 if(c.fallback)return `${mName(c.key.slice(6))} · período mensal provisório`;
 if(c.preCycle)return `${fmtDate(c.start)} – ${fmtDate(c.end)} · anterior ao 1.º vencimento`;
 return `${fmtDate(c.start)} – ${fmtDate(c.end)}${c.open?' · em curso':' · fechado'}`;
}
function cycleTransactions(c){return db.transactions.filter(t=>validDate(t.date)&&t.date>=c.start&&t.date<=c.end);}
function getSelectedCycle(){
 const cycles=buildCycles();
 let c=cycles.find(x=>x.key===selectedCycleKey)||currentCycle(cycles);
 if(!c)c={key:'month:'+cur,start:cur+'-01',end:monthLast(cur),fallback:true,preCycle:false,open:false};
 selectedCycleKey=c.key;activeCycle=c;activeCycles=cycles;
 return {cycles,cycle:c};
}
function persist(skipCloud=false){localStorage.setItem(KEY,JSON.stringify(db));render();if(!skipCloud)queueCloudSave()}

function line(t){
 let state=t.status==='pending'?' · <strong>Pendente</strong>':t.status==='skipped'?' · <strong>Ignorada</strong>':'';
 if(t.type==='income'&&t.countsForCycle===false)state+=' · <em>Extra (não fecha ciclo)</em>';
 if(t.type==='saving_withdraw'){
   const g=(db.savingsGoals||[]).find(x=>x.id===t.goalId);
   state+=g?` · <em>Resgate: ${esc(g.name)}</em>`:' · <em>Resgate de poupança</em>';
 }
 let actions=t.status==='pending'?`<button class="secondary" data-confirm-rec="${esc(String(t.id))}">Confirmar</button><button class="danger" data-skip-rec="${esc(String(t.id))}">Ignorar</button>`:'';
 const cls=t.type==='income'?'plus':t.type==='saving_withdraw'?'neutral':'minus';
 const prefix=t.type==='income'?'+':t.type==='saving'?'↗':t.type==='saving_withdraw'?'↙':'−';
 return `<div class="item row"><div><b>${esc(t.description)}</b><div class="small">${t.date} · ${esc(t.category)} · ${esc(t.person)}${state}</div></div><div class="row"><b class="amount ${cls}">${prefix} ${eur(t.amount)}</b>${actions}<button class="danger" data-del="${esc(String(t.id))}">×</button></div></div>`;
}

function render(){
 const {cycles,cycle}=getSelectedCycle();
 $('monthTitle').textContent=cycle.fallback?'Período provisório sem vencimentos':cycle.preCycle?'Período inicial anterior ao 1.º vencimento':cycle.open?'Ciclo financeiro em curso':'Ciclo financeiro';
 $('cycleRange').textContent=cycleName(cycle)+(cycle.fallback?' · regista um rendimento para começar a definir ciclos reais':'');
 $('cycleSelect').innerHTML=cycles.slice().reverse().map(c=>`<option value="${esc(c.key)}">${esc(cycleName(c))}</option>`).join('');
 $('cycleSelect').value=cycle.key;

 const tx=cycleTransactions(cycle),ex=tx.filter(t=>t.type==='expense'&&isPaid(t)),inc=tx.filter(t=>t.type==='income'&&isPaid(t));
 const svIn=tx.filter(t=>t.type==='saving'&&isPaid(t)),svOut=tx.filter(t=>t.type==='saving_withdraw'&&isPaid(t));
 const netSaving=sum(svIn)-sum(svOut);
 // Resgate de poupança devolve liquidez ao ciclo (+sum(svOut))
 const cycleBalance=sum(inc)+sum(svOut)-sum(ex)-sum(svIn);

 $('inc').textContent=eur(sum(inc));
 $('exp').textContent=eur(sum(ex));
 $('bal').textContent=eur(cycleBalance);
 $('savm').textContent=eur(netSaving);

 let alerts=[];
 db.settings.categories.forEach(c=>{
   let v=sum(ex.filter(t=>t.category===c.name));
   if(v>c.budget)alerts.push(`<div class="alert red">⚠ ${esc(c.name)} acima do limite em ${eur(v-c.budget)}.</div>`);
   else if(c.budget&&v>=c.budget*.85)alerts.push(`<div class="alert">Atenção: ${esc(c.name)} já consumiu ${Math.round(v/c.budget*100)}% do limite neste ciclo.</div>`);
 });
 $('alerts').innerHTML=alerts.join('')||'<div class="alert good">Despesas dentro dos limites definidos neste ciclo.</div>';

 $('cats').innerHTML=db.settings.categories.map(c=>{
   let v=sum(ex.filter(t=>t.category===c.name));
   return `<div class="barline"><span style="width:105px">${esc(c.name)}</span><div class="bar"><i style="width:${c.budget?Math.min(100,v/c.budget*100):0}%"></i></div><span>${eur(v)}</span></div>`;
 }).join('');

 $('persons').innerHTML=[...db.settings.people,'Conta conjunta'].map(p=>`<div class="item row">${esc(p)}<b>${eur(sum(ex.filter(t=>t.person===p)))}</b></div>`).join('');

 const recent=[...tx].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
 $('recent').innerHTML=recent.length?recent.map(line).join(''):'<div class="empty">Ainda sem movimentos neste ciclo.</div>';

 $('category').innerHTML=db.settings.categories.map(c=>`<option>${esc(c.name)}</option>`).join('');
 $('incomePlan').value=db.settings.income??0;
 $('adult1').value=db.settings.people[0];
 $('adult2').value=db.settings.people[1];
 $('cycleGroupingDays').value=db.settings.cycleGroupingDays??14;

 $('budgetFields').innerHTML=db.settings.categories.map((c,i)=>`<div class="grid"><div><label>${esc(c.name)}</label></div><div><input data-budget="${i}" type="number" min="0" step=".01" value="${c.budget}"></div></div>`).join('');
 updateBudget();

 $('categoryManager').innerHTML=db.settings.categories.map((c,i)=>`<div class="item" data-category-row="${i}"><div class="grid"><div><label>Nome da categoria</label><input data-cat-name="${i}" maxlength="50" value="${esc(c.name)}"></div><div><label>Limite por ciclo (€)</label><input data-cat-budget="${i}" type="number" min="0" step=".01" value="${Number(c.budget)||0}"></div></div><div class="actions"><button class="secondary" type="button" data-cat-save="${i}">Guardar alterações</button><button class="danger" type="button" data-cat-delete="${i}">Eliminar</button></div></div>`).join('')||'<div class="empty">Ainda não existem categorias.</div>';

 const move=$('movementCycle'),oldMove=move.value;
 move.innerHTML='<option value="selected">Ciclo selecionado</option><option value="all">Todos os movimentos</option>'+cycles.slice().reverse().map(c=>`<option value="${esc(c.key)}">${esc(cycleName(c))}</option>`).join('');
 move.value=oldMove&&[...move.options].some(o=>o.value===oldMove)?oldMove:'selected';
 renderTransactions();
 renderGoals();

 const activeGoals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 $('forecastText').innerHTML=activeGoals.length?activeGoals.map(g=>{
   const left=Math.max(0,Number(g.target)-goalTotal(g));
   return `<div class="item"><b>${esc(g.name)}</b><div class="small">Faltam ${eur(left)} de ${eur(g.target)}${g.deadline?' · prazo '+fmtDate(g.deadline):' · sem data-limite'}</div></div>`;
 }).join(''):'<div class="empty">Ainda não existem objetivos ativos.</div>';

 drawChart();
 drawCalendar();
 renderRecurrences();
 updateTxFormVisibility();
}

function renderTransactions(){
 const f=$('filter').value,period=$('movementCycle').value;
 let list=[...db.transactions];
 if(period==='selected'&&activeCycle)list=list.filter(t=>t.date>=activeCycle.start&&t.date<=activeCycle.end);
 else if(period!=='all'&&period!=='selected'){const c=activeCycles.find(x=>x.key===period);if(c)list=list.filter(t=>t.date>=c.start&&t.date<=c.end);}
 if(f!=='all')list=list.filter(t=>t.type===f);
 list.sort((a,b)=>b.date.localeCompare(a.date));
 $('transactions').innerHTML=list.length?list.map(line).join(''):'<div class="empty">Sem movimentos neste período.</div>';
}

function goalTransactions(g){
 const legacy=new Set((g.legacyTransactionIds||[]).map(String));
 return db.transactions.filter(t=>isSavingTx(t)&&isPaid(t)&&(t.goalId===g.id||(!t.goalId&&legacy.has(String(t.id)))));
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
  return `<div class="card"><div class="row"><div><h2>${esc(g.name)}</h2><span class="pill">${goalStatusLabel(g.status)}</span></div><b>${Math.round(pct)}%</b></div><div class="row"><b>${eur(total)} / ${eur(g.target)}</b><span class="small">${g.deadline?'Prazo: '+fmtDate(g.deadline):'Sem data-limite'}</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="small">${left>0?'Faltam '+eur(left):'Montante-alvo atingido.'}</div><div class="actions"><button class="secondary" type="button" data-goal-edit="${esc(g.id)}">Editar</button>${g.status!=='completed'?`<button class="secondary" type="button" data-goal-toggle="${esc(g.id)}">${g.status==='paused'?'Retomar':'Pausar'}</button>`:''}<button class="secondary" type="button" data-goal-complete="${esc(g.id)}">${g.status==='completed'?'Reabrir':'Concluir'}</button></div>${g.status==='active'?`<div class="grid"><div><label>Atribuir movimento de poupança existente</label><select data-goal-assign-select="${esc(g.id)}"><option value="">Selecionar movimento…</option>${options}</select></div><div style="display:flex;align-items:end"><button class="secondary" type="button" data-goal-assign="${esc(g.id)}">Atribuir movimento</button></div></div>`:''}<h3 style="font-size:14px;margin:14px 0 4px">Reforços e resgates atribuídos</h3>${history||'<div class="empty">Ainda sem movimentos associados.</div>'}</div>`;
 }).join(''):'<div class="card empty">Ainda não existem objetivos. Usa o formulário acima para criar um.</div>';
}

function updateSavingGoalOptions(){
 const sel=$('savingGoal');if(!sel)return;
 const old=sel.value,goals=(db.savingsGoals||[]).filter(g=>g.status==='active');
 sel.innerHTML='<option value="">Sem objetivo</option>'+goals.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 if([...sel.options].some(o=>o.value===old))sel.value=old;
}

function updateTxFormVisibility(){
 const t=$('type').value;
 $('categoryField').hidden=t!=='expense';
 $('incomeCycleField').hidden=t!=='income';
 const isSav=t==='saving'||t==='saving_withdraw';
 $('savingGoalField').hidden=!isSav;
 if(isSav){
   $('savingGoalLabel').textContent=t==='saving_withdraw'?'Objetivo de onde sai o valor':'Associar a objetivo (opcional)';
   $('savingGoalHelp').textContent=t==='saving_withdraw'?'O valor resgatado é abatido ao progresso do objetivo selecionado e fica disponível no saldo do ciclo.':'Só os movimentos de poupança associados contam para o progresso do objetivo.';
   updateSavingGoalOptions();
 }
}

function drawChart(){
 const c=$('chart'),ctx=c.getContext('2d'),w=c.width,h=c.height;
 ctx.clearRect(0,0,w,h);
 const cycles=buildCycles();
 let total=0;
 const series=cycles.map(cy=>{
   const delta=cycleTransactions(cy).filter(t=>isSavingTx(t)&&isPaid(t)).reduce((s,t)=>s+savingSigned(t),0);
   total=Math.max(0,total+delta);
   return {cycle:cy,value:total};
 }).slice(-12);
 if(!series.length)return;
 const max=Math.max(1,...series.map(x=>x.value))*1.12;
 ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#dce4ec';
 ctx.lineWidth=1;
 for(let i=0;i<5;i++){const y=10+(h-48)*i/4;ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(w-8,y);ctx.stroke();}
 ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--gold').trim()||'#c5a56b';
 ctx.lineWidth=4;
 ctx.beginPath();
 series.forEach((item,i)=>{const px=40+(w-55)*i/Math.max(1,series.length-1),py=h-30-(h-45)*item.value/max;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
 ctx.stroke();
 ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#68798a';
 ctx.font='11px system-ui';
 series.forEach((item,i)=>{
   const px=40+(w-55)*i/Math.max(1,series.length-1);
   const label=item.cycle.open?'Atual':fmtDate(item.cycle.end).replace(/ \d{4}$/,'');
   ctx.fillText(label,Math.max(2,px-18),h-8);
 });
}

function updateBudget(){$('budgetTotal').textContent=eur([...document.querySelectorAll('[data-budget]')].reduce((s,x)=>s+(+x.value||0),0))}

function drawCalendar(){
 let m=$('calendarMonth').value||cur,[y,mo]=m.split('-').map(Number),off=(new Date(y,mo-1,1).getDay()+6)%7,days=new Date(y,mo,0).getDate(),s=['2ª','3ª','4ª','5ª','6ª','Sáb','Dom'].map(x=>`<div class="dayname">${x}</div>`).join('');
 for(let i=0;i<off;i++)s+='<div></div>';
 for(let d=1;d<=days;d++){let dt=m+'-'+String(d).padStart(2,'0'),v=sum(db.transactions.filter(t=>t.date===dt&&t.type==='expense'&&isPaid(t)));s+=`<button class="day ${dt===selected?'selected':''}" data-day="${dt}"><b>${d}</b>${v?`<em>${Math.round(v)} €</em>`:''}</button>`;}
 $('calendar').innerHTML=s;$('calTitle').textContent=mName(m);showDay(selected);
}

function showDay(d){
 selected=d;$('dayTitle').textContent='Movimentos · '+new Date(d+'T12:00:00').toLocaleDateString('pt-PT');
 let a=db.transactions.filter(t=>t.date===d);
 $('dayItems').innerHTML=a.length?a.map(line).join(''):'<div class="empty">Sem movimentos neste dia.</div>';
 document.querySelectorAll('[data-day]').forEach(b=>b.classList.toggle('selected',b.dataset.day===d));
}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===b.dataset.tab));
});

$('calendarMonth').value=cur;$('calendarMonth').onchange=()=>{selected=$('calendarMonth').value+'-01';drawCalendar()};
$('date').value=iso(now);
$('cycleSelect').onchange=()=>{selectedCycleKey=$('cycleSelect').value;render()};
$('filter').onchange=renderTransactions;
$('movementCycle').onchange=renderTransactions;
$('type').onchange=updateTxFormVisibility;

$('txForm').onsubmit=e=>{
 e.preventDefault();
 let a=+$('amount').value;if(a<=0)return;
 let t=$('type').value;
 const catLabel=t==='expense'?$('category').value:t==='saving'?'Poupança':t==='saving_withdraw'?'Resgate de poupança':'Rendimento';
 let entry={id:Date.now()+'-'+Math.random().toString(36).slice(2,6),date:$('date').value,type:t,description:$('desc').value.trim(),amount:a,category:catLabel,person:$('person').value};
 if(t==='income')entry.countsForCycle=$('incomeCountsForCycle').checked;
 if((t==='saving'||t==='saving_withdraw')&&$('savingGoal').value)entry.goalId=$('savingGoal').value;
 db.transactions.push(entry);
 e.target.reset();
 $('date').value=iso(now);
 $('incomeCountsForCycle').checked=true;
 updateTxFormVisibility();
 persist();
};

document.addEventListener('click',e=>{
 let b=e.target.closest('[data-del]');if(b&&confirm('Apagar este movimento?')){const target=db.transactions.find(t=>String(t.id)===b.dataset.del);if(target?.status==='pending'&&target.occurrenceKey)target.status='skipped';else db.transactions=db.transactions.filter(t=>String(t.id)!==b.dataset.del);persist()}
 let c=e.target.closest('[data-confirm-rec]');if(c){let t=db.transactions.find(x=>String(x.id)===c.dataset.confirmRec);if(t&&t.status==='pending'){t.status='confirmed';t.confirmedAt=iso(new Date());persist()}}
 let sk=e.target.closest('[data-skip-rec]');if(sk){let t=db.transactions.find(x=>String(x.id)===sk.dataset.skipRec);if(t&&t.status==='pending'&&confirm('Ignorar esta ocorrência? Não será contabilizada como despesa.')){t.status='skipped';persist()}}
 let d=e.target.closest('[data-day]');if(d)showDay(d.dataset.day);
});

// Despesas recorrentes
if(!Array.isArray(db.recurringExpenses))db.recurringExpenses=[];
function monthIndex(m){const [y,mo]=m.split('-').map(Number);return y*12+mo-1}
function dueDate(year,month,day){const last=new Date(year,month,0).getDate();return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`}
function generateDueOccurrences(){
 const today=iso(new Date()),current=today.slice(0,7);let changed=false;
 db.recurringExpenses.forEach(r=>{
  if(!r.active||!r.startMonth)return;
  const from=monthIndex(r.startMonth),to=Math.min(monthIndex(current),r.endMonth?monthIndex(r.endMonth):monthIndex(current));
  for(let idx=from;idx<=to;idx++){
   const year=Math.floor(idx/12),month=idx%12+1,date=dueDate(year,month,Number(r.day)||1),key=`${r.id}:${year}-${String(month).padStart(2,'0')}`;
   if(date>today)continue;
   if(db.transactions.some(t=>t.occurrenceKey===key))continue;
   db.transactions.push({id:'rec-'+key.replace(/[^a-zA-Z0-9_-]/g,'-'),date,type:'expense',description:r.description,amount:Number(r.amount),category:r.category,person:r.person,status:'pending',recurrenceId:r.id,occurrenceKey:key});changed=true;
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
 $('recurrenceRules').innerHTML=rules.length?rules.map(r=>`<div class="item"><div class="row"><div><b>${esc(r.description)}</b><div class="small">${eur(r.amount)} · dia ${r.day} · ${esc(r.category)} · ${esc(r.person)}</div><div class="small">Desde ${r.startMonth}${r.endMonth?' até '+r.endMonth:''} · ${r.active?'Ativa':'Suspensa'}</div></div><span class="pill">${r.active?'Ativa':'Pausada'}</span></div><div class="actions"><button type="button" class="secondary" data-recurrence-edit="${esc(r.id)}">Editar</button><button type="button" class="secondary" data-recurrence-toggle="${esc(r.id)}">${r.active?'Suspender':'Retomar'}</button><button type="button" class="danger" data-recurrence-delete="${esc(r.id)}">Eliminar regra</button></div></div>`).join(''):'<div class="empty">Ainda não existem despesas recorrentes.</div>';
 $('recurrenceRules').onclick=e=>{
  const edit=e.target.closest('[data-recurrence-edit]');
  const toggle=e.target.closest('[data-recurrence-toggle]');
  const del=e.target.closest('[data-recurrence-delete]');
  if(edit){const r=db.recurringExpenses.find(x=>String(x.id)===edit.dataset.recurrenceEdit);if(r){loadRecurrenceForm(r);$('recurrenceFormTitle').scrollIntoView({behavior:'smooth',block:'start'});$('recurrenceDescription').focus({preventScroll:true});}return;}
  if(toggle){const r=db.recurringExpenses.find(x=>String(x.id)===toggle.dataset.recurrenceToggle);if(r){r.active=!r.active;persist();}return;}
  if(del){const r=db.recurringExpenses.find(x=>String(x.id)===del.dataset.recurrenceDelete);if(r&&confirm('Eliminar esta regra? Os movimentos já criados serão preservados.')){db.recurringExpenses=db.recurringExpenses.filter(x=>x.id!==r.id);persist();}}
 };
 const pending=db.transactions.filter(t=>t.status==='pending'&&t.recurrenceId).sort((a,b)=>a.date.localeCompare(b.date));
 $('pendingRecurring').innerHTML=pending.length?pending.map(line).join(''):'<div class="empty">Não há despesas recorrentes pendentes.</div>';
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
 const data={description,amount,day,startMonth,endMonth:endMonth||null,category:$('recurrenceCategory').value,person:$('recurrencePerson').value,active:true};
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
    if(previous!==name){db.transactions.forEach(t=>{if(t.category===previous)t.category=name;});db.recurringExpenses?.forEach(r=>{if(r.category===previous)r.category=name;});}
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
  persist();alert('Categoria adicionada.');
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
    if(previous!==name){db.transactions.forEach(t=>{if(t.category===previous)t.category=name;});db.recurringExpenses?.forEach(r=>{if(r.category===previous)r.category=name;});}
    persist();alert('Categoria atualizada.');
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
$('budgetForm').onsubmit=e=>{e.preventDefault();document.querySelectorAll('[data-budget]').forEach(x=>db.settings.categories[+x.dataset.budget].budget=Math.max(0,+x.value||0));persist();alert('Limites guardados.')};
$('saveIncome').onclick=()=>{db.settings.income=+$('incomePlan').value||0;persist();alert('Rendimento guardado.')};
$('savePeople').onclick=()=>{
  let old=db.settings.people;
  db.settings.people=[$('adult1').value.trim()||'Adulto 1',$('adult2').value.trim()||'Adulto 2'];
  db.transactions.forEach(t=>{if(t.person===old[0])t.person=db.settings.people[0];if(t.person===old[1])t.person=db.settings.people[1]});
  $('person').innerHTML=db.settings.people.map(p=>`<option>${esc(p)}</option>`).join('')+'<option>Conta conjunta</option>';
  updateSavingGoalOptions();persist();alert('Nomes guardados.');
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
 if(editingGoalId){const g=db.savingsGoals.find(x=>x.id===editingGoalId);if(!g)return;Object.assign(g,{name,target,deadline:deadline||null});}
 else{db.savingsGoals.push({id:'goal-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name,target,deadline:deadline||null,status:'active',legacyTransactionIds:[]});}
 resetGoalForm();persist();
};
$('goalCancel').onclick=resetGoalForm;
$('goalList').addEventListener('click',e=>{
 const edit=e.target.closest('[data-goal-edit]'),toggle=e.target.closest('[data-goal-toggle]'),complete=e.target.closest('[data-goal-complete]'),assign=e.target.closest('[data-goal-assign]'),remove=e.target.closest('[data-goal-remove-tx]');
 if(edit){const g=db.savingsGoals.find(x=>x.id===edit.dataset.goalEdit);if(g)editGoal(g);return;}
 if(toggle){const g=db.savingsGoals.find(x=>x.id===toggle.dataset.goalToggle);if(g){g.status=g.status==='paused'?'active':'paused';persist();}return;}
 if(complete){const g=db.savingsGoals.find(x=>x.id===complete.dataset.goalComplete);if(g){g.status=g.status==='completed'?'active':'completed';persist();}return;}
 if(assign){
   const g=db.savingsGoals.find(x=>x.id===assign.dataset.goalAssign);
   const select=$('goalList').querySelector(`[data-goal-assign-select="${g?.id||''}"]`);
   const tx=db.transactions.find(t=>String(t.id)===String(select?.value));
   if(!g||!tx||!isSavingTx(tx))return;
   const old=db.savingsGoals.find(x=>x.id===tx.goalId)||db.savingsGoals.find(x=>(x.legacyTransactionIds||[]).map(String).includes(String(tx.id))&&!tx.goalId);
   if(old&&old.id!==g.id&&!confirm('Este movimento será retirado do objetivo «'+old.name+'» e atribuído a «'+g.name+'». Continuar?'))return;
   if(old&&old.id!==g.id&&!tx.goalId)old.legacyTransactionIds=(old.legacyTransactionIds||[]).filter(id=>String(id)!==String(tx.id));
   tx.goalId=g.id;persist();return;
 }
 if(remove){
   const g=db.savingsGoals.find(x=>x.id===remove.dataset.goalRemoveFrom),tx=db.transactions.find(t=>String(t.id)===remove.dataset.goalRemoveTx);
   if(!g||!tx)return;
   if(!confirm('Retirar este movimento do objetivo? O movimento será preservado no histórico.'))return;
   if(tx.goalId===g.id)delete tx.goalId;
   g.legacyTransactionIds=(g.legacyTransactionIds||[]).filter(id=>String(id)!==String(tx.id));
   persist();
 }
});

$('saveCycleGrouping').onclick=()=>{const n=Number($('cycleGroupingDays').value);if(!Number.isInteger(n)||n<0||n>20){alert('Indica um número inteiro entre 0 e 20 dias.');return;}db.settings.cycleGroupingDays=n;selectedCycleKey=null;persist();alert('Definição dos ciclos guardada.');};
function shift(n){let d=new Date(($('calendarMonth').value||cur)+'-02T12:00:00');d.setMonth(d.getMonth()+n);$('calendarMonth').value=iso(d).slice(0,7);selected=iso(d).slice(0,7)+'-01';drawCalendar()}
$('prev').onclick=()=>shift(-1);$('next').onclick=()=>shift(1);
$('export').onclick=()=>{let a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.href=u;a.download='duofin-backup.json';a.click();URL.revokeObjectURL(u)};
$('import').onchange=async e=>{try{let x=JSON.parse(await e.target.files[0].text());if(!x.settings||!Array.isArray(x.transactions))throw 0;const n=normalizeDb(x);db=n.db;persist();alert('Cópia importada.')}catch(_){alert('Ficheiro inválido.')}e.target.value=''};
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
  if(uiPrefs.theme==='dark'||(uiPrefs.theme==='auto'&&systemDark))root.classList.add('theme-dark');
  if(uiPrefs.density==='compact')root.classList.add('density-compact');
  if(uiPrefs.density==='detailed')root.classList.add('density-detailed');
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

// Sincronização Supabase com Auto-Merge inteligente de transações e regras
const CLOUD_KEY='orcamento-plus-cloud-v1';
let cloud={url:'',key:'',access_token:'',refresh_token:'',expires_at:0,user:null,household_id:null,revision:null,dirty:false};
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

// Fusão não-destrutiva quando ambos os dispositivos criaram movimentos em simultâneo
function tryMergePayloads(localRaw, remoteRaw){
  const local=normalizeDb(JSON.parse(JSON.stringify(localRaw))).db;
  const remote=normalizeDb(JSON.parse(JSON.stringify(remoteRaw))).db;
  // Se definições estruturais (nomes, categorias, janela de ciclo) diferirem, exige resolução manual
  if(JSON.stringify(local.settings)!==JSON.stringify(remote.settings))return null;
  const txMap=new Map();
  remote.transactions.forEach(t=>txMap.set(String(t.id),t));
  for(const t of local.transactions){
    const id=String(t.id);
    if(!txMap.has(id)){txMap.set(id,t);}
    else{
      const rTx=txMap.get(id);
      if(JSON.stringify(rTx)!==JSON.stringify(t)){
        // Se uma recorrência foi confirmada/ignorada num dispositivo e noutro ainda está pendente, prevalece o estado confirmado/ignorado
        if(rTx.status==='pending'&&t.status!=='pending')txMap.set(id,t);
        else if(t.status==='pending'&&rTx.status!=='pending')txMap.set(id,rTx);
        else return null; // Edição conflitante no mesmo registo
      }
    }
  }
  const recMap=new Map();
  (remote.recurringExpenses||[]).forEach(r=>recMap.set(String(r.id),r));
  for(const r of (local.recurringExpenses||[])){
    const id=String(r.id);
    if(!recMap.has(id))recMap.set(id,r);
    else if(JSON.stringify(recMap.get(id))!==JSON.stringify(r))return null;
  }
  const goalMap=new Map();
  (remote.savingsGoals||[]).forEach(g=>goalMap.set(String(g.id),g));
  for(const g of (local.savingsGoals||[])){
    const id=String(g.id);
    if(!goalMap.has(id))goalMap.set(id,g);
    else if(JSON.stringify(goalMap.get(id))!==JSON.stringify(g))return null;
  }
  return {
    settings:remote.settings,
    transactions:[...txMap.values()],
    recurringExpenses:[...recMap.values()],
    savingsGoals:[...goalMap.values()]
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
   if(!overwrite&&cloud.revision!==null&&row.revision!==cloud.revision){
     const merged=validPayload(row.payload)?tryMergePayloads(db,row.payload):null;
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
   const result=await rpc('save_household_data',{p_household_id:cloud.household_id,p_payload:db,p_expected_revision:expected});
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
   if(!validPayload(row.payload)){cloud.revision=row.revision;cloud.dirty=true;saveCloud();await pushCloud(false);return}
   if(forcePull){
     if(hasLocalData()&&!confirm('Carregar a versão partilhada vai substituir os dados locais deste telemóvel. Continuar?'))return;
     const migrated=setLocalData(row.payload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(cloud.revision===null){
     if(hasLocalData()){cloud.revision=row.revision;cloud.dirty=true;saveCloud();cloudMessage('Este telemóvel já tem dados locais. Exporta uma cópia e escolhe qual versão deve prevalecer.','alert red');return}
     const migrated=setLocalData(row.payload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(row.revision!==cloud.revision){
     if(cloud.dirty){
       const merged=tryMergePayloads(db,row.payload);
       if(merged){
         setLocalData(merged);cloud.revision=row.revision;cloud.dirty=true;saveCloud();
         await pushCloud(false);
         if(!silent)cloudMessage('Alterações simultâneas fundidas com sucesso. Revisão '+cloud.revision+'.','alert good');
         return;
       }
       cloudMessage('Conflito: existem alterações incompatíveis neste telemóvel e na versão partilhada. Escolhe uma das duas ações.','alert red');
       return;
     }
     const migrated=setLocalData(row.payload);cloud.revision=row.revision;cloud.dirty=migrated;saveCloud();paintCloud();
     if(migrated)await pushCloud(false);
     if(generateDueOccurrences())render();
     return;
   }
   if(cloud.dirty)await pushCloud(false);
   else if(!silent)cloudMessage('Tudo sincronizado. Revisão '+row.revision+'.','alert good');
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

if('serviceWorker'in navigator&&location.protocol.startsWith('http'))addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
