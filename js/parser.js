import { $, esc, eur, fmtDate, validDate, now } from './utils.js';
// js/parser.js — Importação e parsing inteligente de extratos PDF (PDF.js) e CSV bancários
let ctx = null;

let parsedCsvRows=[];
const PDFJS_CDN_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfJsLoadingPromise=null;

export function extractKeywordFromDesc(desc){
 return String(desc||'')
   .replace(/\b(compra|pagamento|serviços|servicos|transf\.?|trf\.?|mb\s*way|mbway|debito|direto|dd|pos|tpa)\b/gi,' ')
   .replace(/[0-9€$.,\/\-*]+/g,' ')
   .replace(/\s+/g,' ')
   .trim()
   .slice(0,26)
   .toUpperCase();
}

export function saveLearnedCategoryRule(keyword, category, type='expense'){
 const cleanKey=String(keyword||'').trim().toUpperCase();
 if(cleanKey.length<3)return;
 if(!Array.isArray(ctx.db.settings.categoryRules))ctx.db.settings.categoryRules=[];
 const catVal=type==='saving'?'Poupança':type==='saving_withdraw'?'Resgate de poupança':type==='income'?'Rendimento':category;
 if(!catVal)return;
 const existing=ctx.db.settings.categoryRules.find(r=>r.keyword.toUpperCase()===cleanKey);
 if(existing){existing.category=catVal;existing.type=type;}
 else ctx.db.settings.categoryRules.unshift({keyword:cleanKey,category:catVal,type});
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

export function guessMovementTypeAndCategory(desc, rawAmount){
 const d=desc.toLocaleLowerCase('pt-PT');
 const avail=new Set(ctx.db.settings.categories.map(c=>c.name));

 // 1. Regras personalizadas aprendidas (podem guardar type e category)
 for(const rule of (ctx.db.settings.categoryRules||[])){
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

export function guessCategory(desc){
 const d=desc.toLocaleLowerCase('pt-PT');
 const avail=new Set(ctx.db.settings.categories.map(c=>c.name));

 // 1. Verificar primeiro regras personalizadas aprendidas pelo utilizador
 for(const rule of (ctx.db.settings.categoryRules||[])){
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
 return avail.has('Outros / imprevistos')?'Outros / imprevistos':(ctx.db.settings.categories[0]?.name||'Outros / imprevistos');
}

export function parseStatementTextLines(lines){
 const fullText=lines.join('\n');
 const yearMatches=fullText.match(/\b(20\d{2})\b/g);
 const fallbackYear=yearMatches&&yearMatches.length?yearMatches[0]:String(now().getFullYear());

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

export function parseCsvContent(text){
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

function isDuplicateMovement(row){
 const amt=Number(row.amount);
 return ctx.db.transactions.some(t=>t.date===row.date&&Math.abs((Number(t.amount)||0)-amt)<0.005&&t.type===row.type);
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
 $('impEditCat').innerHTML=ctx.db.settings.categories.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
 if([...$('impEditCat').options].some(o=>o.value===r.category))$('impEditCat').value=r.category;
 $('impEditCatWrap').hidden=r.type!=='expense';
 const isSavImp=r.type==='saving'||r.type==='saving_withdraw';
 $('impEditGoalWrap').hidden=!isSavImp;
 const activeGoals=(ctx.db.savingsGoals||[]).filter(g=>g.status==='active');
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


export function initParserModule(context) {
  ctx = context;
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
     ctx.haptic([12,25,18]);
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
     ctx.db.transactions.push(entry);
   });
   parsedCsvRows=[];
   $('csvPreviewContainer').hidden=true;
   const autoUpdated=ctx.runAutoBudgetAdjustment(true);
   ctx.persist();
   ctx.showToast(autoUpdated?`${toImport.length} movimento(s) importado(s) e orçamento ajustado à média real!`:`${toImport.length} movimento(s) importado(s) com sucesso!`,{type:'success'});
  };
}

