
import { classifySingle } from './detect.js';



const LS_KEY = 'stemwise-app-v1';

// ---------- UI status banner ----------
function ensureStatus(){
  let box = document.getElementById('csvStatusBox');
  if (!box){
    box = document.createElement('div');
    box.id = 'csvStatusBox';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;max-width:360px;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px 12px;font:12px/1.4 system-ui,Segoe UI,Roboto,Arial;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.24)';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Import status</div><div id="csvStatus" style="white-space:pre-wrap;max-height:180px;overflow:auto">Ready…</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button id="csvPasteBtn" style="padding:6px 8px;border-radius:8px;border:1px solid #475569;background:#1f2937;color:#fff;cursor:pointer">Paste CSV</button><button id="csvHideBtn" style="padding:6px 8px;border-radius:8px;border:1px solid #475569;background:#1f2937;color:#fff;cursor:pointer">Hide</button></div>';
    document.body.appendChild(box);
    document.getElementById('csvHideBtn').onclick = ()=> box.remove();
    document.getElementById('csvPasteBtn').onclick = ()=>{
      const text = prompt('Paste CSV text here'); if (text) tryImportText(text);
    };
  }
  return document.getElementById('csvStatus');
}
function logStatus(msg){
  const el = ensureStatus();
  el.textContent += '\\n' + msg;
  el.scrollTop = el.scrollHeight;
}

// ---------- State ----------
const state = {
  rows: [],
  vatRegisteredFrom: '2025-10-01',
  vatRate: 20,
  laborRate: 18,
  feeShareMode: 'byValue',
  globalFees: 0,
  arrangement: [],
  sundries: 0,
  wastagePct: 0,
  laborMinutes: 0,
  targetMarginPct: 60,
  photo: null,
  photoMarkers: [],
};

function uid(){ return Math.random().toString(36).slice(2,10); }
function money(n){ if (Number.isNaN(n)) return '£0.00'; return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(n); }
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){} }
function load(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const r1 = { id: uid(), variety: 'Rose Freedom', grade:'60cm', supplier:'DutchXpress', packSize:'20 stems', stemsPerPack: 20, packPrice: 15.6, invoiceDate:'2025-09-20', notes:'' };
      const r2 = { id: uid(), variety: 'Lisianthus White', grade:'XL', supplier:'Aalsmeer', packSize:'10 stems', stemsPerPack: 10, packPrice: 5.2, invoiceDate:'2025-09-22', notes:'' };
      state.rows = [r1, r2];
      state.arrangement = [{ rowId: r1.id, qty: 12 }];
      state.sundries = 1.1; state.wastagePct = 3; state.laborMinutes = 20;
      save();
    } else {
      Object.assign(state, JSON.parse(raw));
    }
  } catch(e) { console.warn(e); }
}
load();

// ---------- CSV parsing ----------
function stripBOM(s){ if (s && s.charCodeAt(0) === 0xFEFF) return s.slice(1); return s; }
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function stddev(arr){ const m = arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length); }
function detectDelimiter(sample){
  const candidates = [',',';','\t','|'];
  let best = ','; let bestScore = -1;
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 10);
  for (const d of candidates){
    const counts = lines.map(l => (l.match(new RegExp(escapeRegExp(d), 'g'))||[]).length);
    const variance = counts.length ? stddev(counts) : 0;
    const mean = counts.length ? counts.reduce((a,b)=>a+b,0)/counts.length : 0;
    const score = mean - variance*0.5;
    if (score > bestScore){ bestScore = score; best = d; }
  }
  return best;
}
function splitCSVLine(line, delim){
  const out = []; let cur = ''; let inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else { inQ = !inQ; }
      continue;
    }
    if (ch === delim && !inQ){ out.push(cur); cur=''; }
    else cur += ch;
  }
  out.push(cur); return out.map(s => s.trim());
}
function normaliseHeader(h){
  return h.toLowerCase().replace(/[\s_-]+/g,'').replace(/[^\w]/g,'');
}
function parseCSV(text){
  const clean = stripBOM(String(text||'').trim());
  if (!clean) return { header:[], rows:[], delim: ','};
  const lines = clean.split(/\r?\n/);
  const delim = detectDelimiter(lines.slice(0,10).join('\\n'));
  const header = splitCSVLine(lines.shift(), delim).map(normaliseHeader);
  const rows = [];
  for (const line of lines){
    if (!line.trim()) continue;
    const cells = splitCSVLine(line, delim);
    rows.push(cells);
  }
  return { header, rows, delim };
}
function idx(header, names){
  const aliases = Array.isArray(names) ? names : [names];
  for (const a of aliases){
    const i = header.indexOf(normaliseHeader(a));
    if (i !== -1) return i;
  }
  return -1;
}
function tryImportText(text){
  try{
    logStatus('Parsing text…');
    const parsed = parseCSV(text);
    const H = parsed.header;
    logStatus('Header: ' + JSON.stringify(H));
    const get = (cells, names) => { const i = idx(H, names); return i>=0 ? cells[i] : ''; };

    // helper to normalise numbers like "€1.234,50" or "£15.60"
    const toNum = (s) => {
      if (!s) return 0;
      let t = String(s).trim();
      t = t.replace(/[^\d,.\-]/g, ''); // drop currency symbols etc
      // if comma is decimal separator (and dot used as thousands), convert
      if (t.indexOf(',') > -1 && (t.lastIndexOf(',') > t.lastIndexOf('.'))) {
        t = t.replace(/\./g, '').replace(',', '.');
      } else {
        t = t.replace(/,/g, '');
      }
      const n = Number(t);
      return Number.isFinite(n) ? n : 0;
    };

    let added = 0;
    for (const line of parsed.rows){
      let r = {
        id: uid(),
        variety: get(line, ['variety','flower','name']),
        grade: get(line, ['grade','length','size']),
        supplier: get(line, ['supplier','vendor']),
        packSize: get(line, ['packsize','pack_size','pack']),
        stemsPerPack: toNum(get(line, ['stemsperpack','stems_per_pack','stems'])),
        packPrice: toNum(get(line, ['packprice','pack_price','price'])),
        invoiceDate: get(line, ['invoicedate','invoice_date','date']) || new Date().toISOString().slice(0,10),
        notes: get(line, ['notes','note','comment']),
      };

      // If nothing matched by header, try a positional fallback:
      // [0]=variety, [1]=grade, [2]=stemsPerPack, [3]=packPrice, [4]=invoiceDate
      const emptyByHeader = !r.variety && !r.grade && !r.supplier && !r.packSize && !r.stemsPerPack && !r.packPrice && !r.notes;
      if (emptyByHeader && line.length >= 4){
        r.variety = r.variety || line[0] || '';
        r.grade   = r.grade   || line[1] || '';
        r.stemsPerPack = r.stemsPerPack || toNum(line[2]);
        r.packPrice    = r.packPrice    || toNum(line[3]);
        if (!r.invoiceDate && line[4]) r.invoiceDate = line[4];
      }

      // Skip truly empty lines
      if (!r.variety && !r.packPrice && !r.stemsPerPack) continue;

      state.rows.push(r);
      added++;
    }

    save(); renderAll();
    logStatus(`Imported CSV rows: ${added} (delimiter "${parsed.delim === '\\t' ? 'TAB' : parsed.delim}")`);
    alert(`Imported CSV rows: ${added}`);
  }catch(err){
    console.error(err);
    logStatus('CSV import error: ' + (err?.message||String(err)));
    alert('CSV import error: ' + (err?.message||String(err)));
  }
}


// ---------- DOM refs ----------
const addRowBtn = document.getElementById('addRow');
const costTableBody = document.querySelector('#costTable tbody');
const importCSVEl = document.getElementById('importCSV');
const exportCSVBtn = document.getElementById('exportCSV');

const vatRegisteredFromEl = document.getElementById('vatRegisteredFrom');
const vatRateEl = document.getElementById('vatRate');
const laborRateEl = document.getElementById('laborRate');
const globalFeesEl = document.getElementById('globalFees');
const feeShareModeEl = document.getElementById('feeShareMode');

const arrangementList = document.getElementById('arrangementList');
const addItemBtn = document.getElementById('addItem');
const sundriesEl = document.getElementById('sundries');
const wastagePctEl = document.getElementById('wastagePct');
const laborMinutesEl = document.getElementById('laborMinutes');
const targetMarginPctEl = document.getElementById('targetMarginPct');
const breakdownListEl = document.getElementById('breakdownList');
const marginEl = document.getElementById('margin');
const retailExEl = document.getElementById('retailEx');
const retailIncEl = document.getElementById('retailInc');

// ---------- Settings ----------
function bindSettings(){
  if (vatRegisteredFromEl) vatRegisteredFromEl.value = state.vatRegisteredFrom;
  if (vatRateEl) vatRateEl.value = state.vatRate;
  if (laborRateEl) laborRateEl.value = state.laborRate;
  if (globalFeesEl) globalFeesEl.value = state.globalFees;
  if (feeShareModeEl) feeShareModeEl.value = state.feeShareMode;
  if (vatRegisteredFromEl) vatRegisteredFromEl.oninput = ()=>{ state.vatRegisteredFrom = vatRegisteredFromEl.value; save(); renderAll(); };
  if (vatRateEl) vatRateEl.oninput = ()=>{ state.vatRate = Number(vatRateEl.value)||0; save(); renderAll(); };
  if (laborRateEl) laborRateEl.oninput = ()=>{ state.laborRate = Number(laborRateEl.value)||0; save(); renderAll(); };
  if (globalFeesEl) globalFeesEl.oninput = ()=>{ state.globalFees = Number(globalFeesEl.value)||0; save(); renderAll(); };
  if (feeShareModeEl) feeShareModeEl.onchange = ()=>{ state.feeShareMode = feeShareModeEl.value; save(); renderAll(); };
}

// ---------- Costing helpers ----------
function isAfterReg(d){ return d >= state.vatRegisteredFrom; }
function costPerStemExVAT(r){ const packEx = isAfterReg(r.invoiceDate) ? r.packPrice : (r.packPrice/(1+state.vatRate/100)); return packEx/(r.stemsPerPack||1); }
function totalRowValueExVAT(r){ return costPerStemExVAT(r)*(r.stemsPerPack||0); }
function totalInvoiceValueExVAT(){ return state.rows.reduce((a,r)=>a+totalRowValueExVAT(r),0); }
function feePerStemExVAT(r){ if(state.feeShareMode==='none') return 0; const total=totalInvoiceValueExVAT(); if(!total) return 0; const share=(totalRowValueExVAT(r)/total)*(state.globalFees||0); return share/(r.stemsPerPack||1); }
function displayCostPerStemExVAT(r){ return costPerStemExVAT(r)+feePerStemExVAT(r); }

// ---------- Renderers ----------
function renderCostTable(){
  if (!costTableBody) return;
  costTableBody.innerHTML = '';
  state.rows.forEach((r)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input value="${r.variety || ''}"/></td>
      <td><input value="${r.grade||''}"/></td>
      <td><input value="${r.supplier||''}"/></td>
      <td><input value="${r.packSize||''}"/></td>
      <td><input type="number" value="${r.stemsPerPack||0}"/></td>
      <td><input type="number" step="0.01" value="${r.packPrice||0}"/></td>
      <td><input type="date" value="${r.invoiceDate||''}"/></td>
      <td class="muted">£${displayCostPerStemExVAT(r).toFixed(2)}</td>
      <td><input value="${r.notes||''}"/></td>
      <td><button class="btn danger">Del</button></td>`;

    // ✅ Get elements explicitly (8 inputs + 1 button)
    const inputs = tr.querySelectorAll('input');
    const delBtn = tr.querySelector('button');
    const [v, g, s, ps, sp, pp, id, n] = inputs;

    v.oninput  = ()=>{ r.variety      = v.value;  save(); renderAll(); };
    g.oninput  = ()=>{ r.grade        = g.value;  save(); renderAll(); };
    s.oninput  = ()=>{ r.supplier     = s.value;  save(); renderAll(); };
    ps.oninput = ()=>{ r.packSize     = ps.value; save(); renderAll(); };
    sp.oninput = ()=>{ r.stemsPerPack = Number(sp.value)||0; save(); renderAll(); };
    pp.oninput = ()=>{ r.packPrice    = Number(pp.value)||0; save(); renderAll(); };
    id.oninput = ()=>{ r.invoiceDate  = id.value; save(); renderAll(); };
    n.oninput  = ()=>{ r.notes        = n.value;  save(); };

    delBtn.onclick = ()=>{ state.rows = state.rows.filter(x => x !== r); save(); renderAll(); };

    costTableBody.appendChild(tr);
  });
}


function renderArrangement(){
  if (!arrangementList) return;
  arrangementList.innerHTML='';
  state.arrangement.forEach((a,i)=>{
    const row=state.rows.find(r=>r.id===a.rowId);
    const div=document.createElement('div'); div.className='item-row';
    const options=state.rows.map(r=>`<option value="${r.id}" ${r.id===a.rowId?'selected':''}>${r.variety} ${r.grade?`(${r.grade})`:''}</option>`).join('');
    div.innerHTML=`<select>${options}</select><input type="number" value="${a.qty||0}"/><div class="readonly">${row?money(displayCostPerStemExVAT(row)):'-'}</div><div class="del"><button class="btn danger">×</button></div>`;
    const [sel,qty,,del]=div.querySelectorAll('select,input,div,button');
    sel.onchange=()=>{a.rowId=sel.value;save();renderAll();};
    qty.oninput=()=>{a.qty=Number(qty.value)||0;save();renderAll();};
    del.onclick=()=>{state.arrangement=state.arrangement.filter((_,j)=>j!==i);save();renderAll();};
    arrangementList.appendChild(div);
  });
}

function calcBreakdown(){
  const items=state.arrangement.map(a=>{ const r=state.rows.find(x=>x.id===a.rowId); if(!r)return null; const cps=displayCostPerStemExVAT(r); const line=cps*(a.qty||0); return {label:`${r.variety} ${r.grade||''}`.trim(),qty:a.qty||0,lineEx:line}; }).filter(Boolean);
  const stemsEx=items.reduce((s,i)=>s+i.lineEx,0);
  const wastage=stemsEx*((state.wastagePct||0)/100);
  const laborEx=(state.laborRate/60)*(state.laborMinutes||0);
  const sundriesEx=state.sundries||0;
  const totalEx=stemsEx+wastage+sundriesEx+laborEx;
  const margin=totalEx*((state.targetMarginPct||0)/100);
  const retailEx=totalEx+margin;
  const retailInc=retailEx*(1+(state.vatRate||0)/100);
  return {items,stemsEx,wastage,sundriesEx,laborEx,totalEx,margin,retailEx,retailInc};
}
function renderBreakdown(){
  if (!breakdownListEl) return;
  const b=calcBreakdown(); breakdownListEl.innerHTML='';
  b.items.forEach(i=>{ const row=document.createElement('div'); row.innerHTML=`<span>${i.label} × ${i.qty}</span><strong>£${i.lineEx.toFixed(2)}</strong>`; breakdownListEl.appendChild(row); });
  const add=(k,v)=>{ const row=document.createElement('div'); row.innerHTML=`<span>${k}</span><strong>£${v.toFixed(2)}</strong>`; breakdownListEl.appendChild(row); };
  breakdownListEl.appendChild(document.createElement('hr')); add('Stems subtotal',b.stemsEx); add('Wastage',b.wastage); add('Sundries',b.sundriesEx); add('Labour',b.laborEx); breakdownListEl.appendChild(document.createElement('hr')); add('Total ex-VAT',b.totalEx);
  marginEl.textContent=`£${b.margin.toFixed(2)}`; retailExEl.textContent=`£${b.retailEx.toFixed(2)}`; retailIncEl.textContent=`£${b.retailInc.toFixed(2)}`;
}

// ---------- Actions ----------
if (addRowBtn) addRowBtn.onclick = ()=>{
  state.rows.push({ id: uid(), variety:'', grade:'', supplier:'', packSize:'', stemsPerPack:0, packPrice:0, invoiceDate:new Date().toISOString().slice(0,10), notes:'' });
  save(); renderAll();
};

function toCSV(rows){
  const header=['variety','grade','supplier','packSize','stemsPerPack','packPrice','invoiceDate','notes'];
  const body=rows.map(r=>[r.variety,r.grade||'',r.supplier||'',r.packSize||'',r.stemsPerPack||0,r.packPrice||0,r.invoiceDate||'',r.notes||''].map(v=>String(v).includes(',')?`"${String(v).replace(/"/g,'""')}"`:String(v)).join(','));
  return [header.join(','),...body].join('\n');
}
if (exportCSVBtn) exportCSVBtn.onclick=()=>{ const csv=toCSV(state.rows); const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='flower_costs.csv'; a.click(); URL.revokeObjectURL(url); };

if (importCSVEl){
  importCSVEl.onchange=(e)=>{
    const f=e.target.files?.[0];
    if(!f){ logStatus('No file selected'); return; }
    logStatus('Selected: ' + f.name + ' (' + (f.type||'unknown type') + ')');
    const reader=new FileReader();
    reader.onload=()=>{ logStatus('Read ' + String(reader.result||'').length + ' chars'); tryImportText(String(reader.result||'')); };
    reader.onerror=()=>{ logStatus('FileReader error: ' + reader.error); alert('Read error: ' + reader.error); };
    reader.readAsText(f);
  };
} else {
  logStatus('Import input not found (id="importCSV").');
}

// Drag & drop anywhere
document.addEventListener('dragover',(e)=>{ e.preventDefault(); });
document.addEventListener('drop',(e)=>{
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f){ logStatus('Drop: no file'); return; }
  logStatus('Dropped: ' + f.name);
  const reader=new FileReader();
  reader.onload=()=>{ tryImportText(String(reader.result||'')); };
  reader.readAsText(f);
});

// ---------- Photo Assist minimal (unchanged renderPhotoVarietyOptions/drawPhoto) ----------
const photoInput=document.getElementById('photoInput'); const photoCanvas=document.getElementById('photoCanvas'); const ctx=photoCanvas?photoCanvas.getContext('2d'):null; const photoVarietySelect=document.getElementById('photoVarietySelect'); const clearBtn=document.getElementById('clearMarkers');
function renderPhotoVarietyOptions(){ if (!photoVarietySelect) return; photoVarietySelect.innerHTML='<option value=\"\">Select flower...</option>'+state.rows.map(r=>`<option value=\"${r.id}\">${r.variety} ${r.grade?`(${r.grade})`:''}</option>`).join(''); }
if (photoInput) photoInput.onchange=async (e)=>{ const f=e.target.files?.[0]; if(!f)return; const reader=new FileReader(); reader.onload=(evt)=>{ const img=new Image(); img.onload=()=>{ state.photo=img; state.photoMarkers=[]; if(clearBtn) clearBtn.disabled=true; drawPhoto(); }; img.src=evt.target.result; }; reader.readAsDataURL(f); };
function drawPhoto(){ if(!photoCanvas||!ctx){ return; } const img=state.photo; if(!img){ photoCanvas.width=1000; photoCanvas.height=600; ctx.fillStyle='#f3f4f6'; ctx.fillRect(0,0,photoCanvas.width,photoCanvas.height); ctx.fillStyle='#64748b'; ctx.fillText('Load a photo to start',20,30); return; } const maxW=photoCanvas.parentElement.clientWidth-2; const scale=Math.min(maxW/img.width,1); photoCanvas.width=Math.floor(img.width*scale); photoCanvas.height=Math.floor(img.height*scale); ctx.clearRect(0,0,photoCanvas.width,photoCanvas.height); ctx.drawImage(img,0,0,photoCanvas.width,photoCanvas.height); for(const m of state.photoMarkers){ const x=m.x*scale,y=m.y*scale; ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fillStyle='#0EA5E9aa'; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#0EA5E9'; ctx.stroke(); } }
if (photoCanvas) photoCanvas.addEventListener('click',(e)=>{ if(!state.photo)return; const sel=photoVarietySelect.value; if(!sel){ alert('Select a flower first'); return; } const rect=photoCanvas.getBoundingClientRect(); const x=e.clientX-rect.left; const y=e.clientY-rect.top; const scale=photoCanvas.width/state.photo.width; const ix=x/scale, iy=y/scale; state.photoMarkers.push({x:ix,y:iy,rowId:sel}); if(clearBtn) clearBtn.disabled=false; const idx=state.arrangement.findIndex(a=>a.rowId===sel); if(idx>=0) state.arrangement[idx].qty=(state.arrangement[idx].qty||0)+1; else state.arrangement.push({rowId:sel,qty:1}); save(); drawPhoto(); renderAll(); });
if (clearBtn) clearBtn.onclick=()=>{ state.photoMarkers=[]; clearBtn.disabled=true; drawPhoto(); };

// ---------- Boot ----------
function renderAll(){ bindSettings(); renderCostTable(); renderArrangement(); renderBreakdown(); renderPhotoVarietyOptions(); drawPhoto(); }
renderAll();
logStatus('Diagnostics ready. Use Import, drag a CSV onto the page, or click "Paste CSV".');
