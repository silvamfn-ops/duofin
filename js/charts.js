// js/charts.js — Gráficos interativos Canvas (Evolução da Poupança + Análise de Ciclos)
let ctx = null;
export function initChartsModule(context) {
  ctx = context;
  const $ = id => document.getElementById(id);
  if ($('analyticsCycleSelect')) $('analyticsCycleSelect').onchange = drawAnalyticsChart;
  if ($('analyticsMetric')) $('analyticsMetric').onchange = drawAnalyticsChart;
  if ($('analyticsChartType')) $('analyticsChartType').onchange = drawAnalyticsChart;
  if ($('analyticsTrendCategory')) $('analyticsTrendCategory').onchange = drawAnalyticsChart;
}

// ============================================================================
// TOOLTIPS INTERATIVOS PARA GRÁFICOS CANVAS (v6.5.0)
// ============================================================================
const chartHitAreas={chart:[],analyticsCanvas:[]};

export function hideChartTooltip(tipId){
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
 const today=ctx.iso(ctx.now());

 if(metric==='cycles_compare'){
   const recentCycles=ctx.buildCycles().filter(c=>!c.preCycle).slice(-6);
   const items=recentCycles.map(c=>{
     const tx=ctx.cycleTransactions(c).filter(t=>t.date<=today&&isPaid(t));
     const incVal=sum(tx.filter(t=>t.type==='income'));
     const expVal=sum(tx.filter(t=>t.type==='expense'));
     const savVal=sum(tx.filter(t=>t.type==='saving'))-sum(tx.filter(t=>t.type==='saving_withdraw'));
     return {
       label:(c.monthLabel||ctx.computeCycleReferenceMonth(c)).replace(/ de \d{4}$/,''),
       fullLabel:ctx.cycleName(c),
       income:incVal,
       expense:expVal,
       saving:savVal,
       value:expVal
     };
   });
   return {title:'Comparação últimos ciclos (Rendimentos vs. Despesas)',items,supportsDonut:false,isGroupedCycles:true};
 }

 if(metric==='category_trend'){
   const catName=$('analyticsTrendCategory').value||(ctx.db.settings.categories[0]?.name||'');
   const catObj=ctx.db.settings.categories.find(c=>c.name===catName);
   const targetBudget=Number(catObj?.budget)||0;
   const recentCycles=ctx.buildCycles().filter(c=>!c.preCycle).slice(-6);
   const items=recentCycles.map(c=>{
     const tx=ctx.cycleTransactions(c).filter(t=>t.date<=today&&isPaid(t)&&t.type==='expense'&&t.category===catName);
     return {
       label:(c.monthLabel||ctx.computeCycleReferenceMonth(c)).replace(/ de \d{4}$/,''),
       fullLabel:ctx.cycleName(c),
       value:sum(tx),
       budget:targetBudget,
       color:'#173653'
     };
   });
   return {title:`Evolução: ${catName}`,items,supportsDonut:false,isComparison:false,targetBudget,catName};
 }

 const tx=ctx.cycleTransactions(cycle).filter(t=>t.date<=today&&isPaid(t));
 const exp=tx.filter(t=>t.type==='expense');
 const inc=tx.filter(t=>t.type==='income');
 const svIn=tx.filter(t=>t.type==='saving');
 const svOut=tx.filter(t=>t.type==='saving_withdraw');

 if(metric==='categories'){
   const items=ctx.db.settings.categories.map((c,idx)=>({
     label:c.name,
     value:sum(exp.filter(t=>t.category===c.name)),
     budget:Number(c.budget)||0,
     color:CHART_PALETTE[idx%CHART_PALETTE.length]
   })).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
   return {title:'Despesas por categoria',items,supportsDonut:true,isComparison:false};
 }

 if(metric==='budget_vs_actual'){
   const items=ctx.db.settings.categories.map((c,idx)=>({
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
   const people=[...ctx.db.settings.people,'Conta conjunta'];
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

export function drawAnalyticsChart(){
 const canvas=$('analyticsCanvas');
 if(!canvas)return;
 bindInteractiveCanvas('analyticsCanvas','analyticsTooltip');
 hideChartTooltip('analyticsTooltip');
 chartHitAreas.analyticsCanvas=[];
 syncAnalyticsControlsVisibility();

 const cycleKey=$('analyticsCycleSelect')?.value||ctx.getSelectedCycleKey();
 const cycle=ctx.getActiveCycles().find(x=>x.key===cycleKey)||ctx.getActiveCycle();
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
   $('analyticsCycleSubtitle').textContent=ctx.cycleName(cycle);
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







export function drawChart(){
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

 const cycles=ctx.buildCycles();
 let total=0;
 const series=cycles.map(cy=>{
   const delta=ctx.cycleTransactions(cy).filter(t=>isSavingTx(t)&&isPaid(t)).reduce((s,t)=>s+savingSigned(t),0);
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

   const cycTitle=p.item.cycle.monthLabel||ctx.computeCycleReferenceMonth(p.item.cycle);
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
