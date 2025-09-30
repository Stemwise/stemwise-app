
import { classifySingle } from './detect.js';

const LS_KEY = 'stemwise-app-v1';

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
function money(n){ if (Number.isNaN(n)) return '£0.00'; return new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP', maximumFractionDigits:2 }).format(n); }
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load(){
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const r1 = { id: uid(), variety: 'Rose Freedom', grade:'60cm', supplier:'DutchXpress', packSize:'20 stems', stemsPerPack: 20, packPrice: 15.6, invoiceDate:'2025-09-20', notes:'High head size' };
    const r2 = { id: uid(), variety: 'Lisianthus White', grade:'XL', supplier:'Aalsmeer', packSize:'10 stems', stemsPerPack: 10, packPrice: 5.2, invoiceDate:'2025-09-22', notes:'' };
    const r3 = { id: uid(), variety: 'Eucalyptus Parvifolia', grade:'Mix', supplier:'UK Wholesaler', packSize:'10 stems', stemsPerPack: 10, packPrice: 2.8, invoiceDate:'2025-09-18', notes:'' };
    state.rows = [r1, r2, r3];
    state.arrangement = [{ rowId: r1.id, qty: 12 }, { rowId: r2.id, qty: 6 }, { rowId: r3.id, qty: 8 }];
    state.sundries = 1.1; state.wastagePct = 3; state.laborMinutes = 20;
    save();
  } else {
    const obj = JSON.parse(raw);
    Object.assign(state, obj);
  }
}
load();

// Elements
const vatRegisteredFromEl = document.getElementById('vatRegisteredFrom');
const vatRateEl = document.getElementById('vatRate');
const laborRateEl = document.getElementById('laborRate');
const globalFeesEl = document.getElementById('globalFees');
const feeShareModeEl = document.getElementById('feeShareMode');

const addRowBtn = document.getElementById('addRow');
const exportCSVBtn = document.getElementById('exportCSV');
const importCSVEl = document.getElementById('importCSV');
const costTableBody = document.querySelector('#costTable tbody');

const addItemBtn = document.getElementById('addItem');
const arrangementList = document.getElementById('arrangementList');

const sundriesEl = document.getElementById('sundries');
const wastagePctEl = document.getElementById('wastagePct');
const laborMinutesEl = document.getElementById('laborMinutes');
const targetMarginPctEl = document.getElementById('targetMarginPct');

const breakdownListEl = document.getElementById('breakdownList');
const marginEl = document.getElementById('margin');
const retailExEl = document.getElementById('retailEx');
const retailIncEl = document.getElementById('retailInc');

const photoInput = document.getElementById('photoInput');
const photoCanvas = document.getElementById('photoCanvas');
const photoCtx = photoCanvas.getContext('2d');
const photoVarietySelect = document.getElementById('photoVarietySelect');
const clearMarkersBtn = document.getElementById('clearMarkers');

function bindSettings(){
  vatRegisteredFromEl.value = state.vatRegisteredFrom;
  vatRateEl.value = state.vatRate;
  laborRateEl.value = state.laborRate;
  globalFeesEl.value = state.globalFees;
  feeShareModeEl.value = state.feeShareMode;

  vatRegisteredFromEl.oninput = () => { state.vatRegisteredFrom = vatRegisteredFromEl.value; save(); renderAll(); };
  vatRateEl.oninput = () => { state.vatRate = Number(vatRateEl.value)||0; save(); renderAll(); };
  laborRateEl.oninput = () => { state.laborRate = Number(laborRateEl.value)||0; save(); renderAll(); };
  globalFeesEl.oninput = () => { state.globalFees = Number(globalFeesEl.value)||0; save(); renderAll(); };
  feeShareModeEl.onchange = () => { state.feeShareMode = feeShareModeEl.value; save(); renderAll(); };
}

function toCSV(rows){
  const header = ['variety','grade','supplier','packSize','stemsPerPack','packPrice','invoiceDate','notes'];
  const body = rows.map(r=>[r.variety,r.grade,r.supplier,r.packSize,r.stemsPerPack,r.packPrice,r.invoiceDate, r.notes||''].join(','));
  return [header.join(','), ...body].join('\n');
}
function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const out = [];
  for (let i=1; i<lines.length; i++){
    const cells = lines[i].split(',').map(c=>c.trim());
    const row = {
      id: uid(),
      variety: cells[idx('variety')] || '',
      grade: cells[idx('grade')] || '',
      supplier: cells[idx('supplier')] || '',
      packSize: cells[idx('packsize')] || cells[idx('pack_size')] || '',
      stemsPerPack: Number(cells[idx('stemsperpack')] || cells[idx('stems_per_pack')] || 0),
      packPrice: Number(cells[idx('packprice')] || cells[idx('pack_price')] || 0),
      invoiceDate: cells[idx('invoicedate')] || cells[idx('invoice_date')] || new Date().toISOString().slice(0,10),
      notes: cells[idx('notes')] || ''
    };
    out.push(row);
  }
  return out;
}

// Cost math
function isAfterRegistration(dateStr){ return dateStr >= state.vatRegisteredFrom; }
function costPerStemExVAT(r){ const packEx = isAfterRegistration(r.invoiceDate) ? r.packPrice : (r.packPrice / (1 + state.vatRate/100)); return (packEx / (r.stemsPerPack || 1)); }
function totalRowValueExVAT(r){ return costPerStemExVAT(r) * (r.stemsPerPack || 0); }
function totalInvoiceValueExVAT(){ return state.rows.reduce((acc,r)=> acc + totalRowValueExVAT(r), 0); }
function feePerStemExVAT(r){
  if (state.feeShareMode === 'none') return 0;
  const total = totalInvoiceValueExVAT(); if (total === 0) return 0;
  const share = (totalRowValueExVAT(r) / total) * (state.globalFees || 0);
  return share / (r.stemsPerPack || 1);
}
function displayCostPerStemExVAT(r){ return costPerStemExVAT(r) + feePerStemExVAT(r); }

function renderCostTable(){
  costTableBody.innerHTML = '';
  state.rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input value="${r.variety}" /></td>
      <td><input value="${r.grade}" /></td>
      <td><input value="${r.supplier}" /></td>
      <td><input value="${r.packSize}" /></td>
      <td><input type="number" value="${r.stemsPerPack}" /></td>
      <td><input type="number" step="0.01" value="${r.packPrice}" /></td>
      <td><input type="date" value="${r.invoiceDate}" /></td>
      <td class="muted">${money(displayCostPerStemExVAT(r))}</td>
      <td><input value="${r.notes||''}" /></td>
      <td><button class="btn danger">Del</button></td>
    `;
    const [vEl,gEl,sEl,psEl,spEl,ppEl,idEl,_,nEl,delBtn] = tr.querySelectorAll('input,button');
    vEl.oninput = ()=>{ r.variety = vEl.value; save(); renderAll(); };
    gEl.oninput = ()=>{ r.grade = gEl.value; save(); renderAll(); };
    sEl.oninput = ()=>{ r.supplier = sEl.value; save(); renderAll(); };
    psEl.oninput = ()=>{ r.packSize = psEl.value; save(); renderAll(); };
    spEl.oninput = ()=>{ r.stemsPerPack = Number(spEl.value)||0; save(); renderAll(); };
    ppEl.oninput = ()=>{ r.packPrice = Number(ppEl.value)||0; save(); renderAll(); };
    idEl.oninput = ()=>{ r.invoiceDate = idEl.value; save(); renderAll(); };
    nEl.oninput = ()=>{ r.notes = nEl.value; save(); };
    delBtn.onclick = ()=>{ state.rows = state.rows.filter(x=>x.id!==r.id); save(); renderAll(); };
    costTableBody.appendChild(tr);
  });
}

function renderArrangement(){
  arrangementList.innerHTML = '';
  state.arrangement.forEach((a, idx)=>{
    const row = state.rows.find(r=>r.id===a.rowId);
    const div = document.createElement('div');
    div.className = 'item-row';
    const options = state.rows.map(r=>`<option value="${r.id}" ${r.id===a.rowId?'selected':''}>${r.variety} ${r.grade?`(${r.grade})`:''}</option>`).join('');
    div.innerHTML = `
      <select>${options}</select>
      <input type="number" value="${a.qty}" />
      <div class="readonly">${row?money(displayCostPerStemExVAT(row)):'-'}</div>
      <div class="del"><button class="btn danger" title="Delete">×</button></div>
    `;
    const [sel, qtyEl, , delBtn] = div.querySelectorAll('select,input,div,button');
    sel.onchange = ()=>{ a.rowId = sel.value; save(); renderAll(); };
    qtyEl.oninput = ()=>{ a.qty = Number(qtyEl.value)||0; save(); renderAll(); };
    delBtn.onclick = ()=>{ state.arrangement = state.arrangement.filter((_,i)=>i!==idx); save(); renderAll(); };
    arrangementList.appendChild(div);
  });
  renderPhotoVarietyOptions();
}

function calcBreakdown(){
  const items = state.arrangement.map((a)=>{
    const r = state.rows.find(x=>x.id===a.rowId);
    if (!r) return null;
    const cpsEx = displayCostPerStemExVAT(r);
    const lineEx = cpsEx * (a.qty || 0);
    return { id:a.rowId, label: `${r.variety} ${r.grade||''}`.trim(), qty:a.qty||0, cpsEx, lineEx };
  }).filter(Boolean);

  const stemsEx = items.reduce((s,i)=> s + i.lineEx, 0);
  const wastage = stemsEx * ((state.wastagePct||0)/100);
  const laborEx = (state.laborRate/60) * (state.laborMinutes||0);
  const sundriesEx = state.sundries||0;
  const totalEx = stemsEx + wastage + sundriesEx + laborEx;
  const margin = totalEx * ((state.targetMarginPct||0)/100);
  const retailEx = totalEx + margin;
  const retailInc = retailEx * (1 + (state.vatRate||0)/100);

  return { items, stemsEx, wastage, laborEx, sundriesEx, totalEx, margin, retailEx, retailInc };
}

function renderBreakdown(){
  const b = calcBreakdown();
  breakdownListEl.innerHTML = '';
  b.items.forEach(i=>{
    const row = document.createElement('div');
    row.innerHTML = `<span>${i.label} × ${i.qty}</span><strong>${money(i.lineEx)}</strong>`;
    breakdownListEl.appendChild(row);
  });
  const addKV = (label, val)=>{
    const row = document.createElement('div');
    row.innerHTML = `<span>${label}</span><strong>${money(val)}</strong>`;
    breakdownListEl.appendChild(row);
  };
  breakdownListEl.appendChild(document.createElement('hr'));
  addKV('Stems subtotal', b.stemsEx);
  addKV('Wastage', b.wastage);
  addKV('Sundries', b.sundriesEx);
  addKV('Labour', b.laborEx);
  breakdownListEl.appendChild(document.createElement('hr'));
  addKV('Total ex-VAT', b.totalEx);

  marginEl.textContent = money(b.margin);
  retailExEl.textContent = money(b.retailEx);
  retailIncEl.textContent = money(b.retailInc);
}

function bindArrangementInputs(){
  sundriesEl.value = state.sundries;
  wastagePctEl.value = state.wastagePct;
  laborMinutesEl.value = state.laborMinutes;
  targetMarginPctEl.value = state.targetMarginPct;

  sundriesEl.oninput = ()=>{ state.sundries = Number(sundriesEl.value)||0; save(); renderAll(); };
  wastagePctEl.oninput = ()=>{ state.wastagePct = Number(wastagePctEl.value)||0; save(); renderAll(); };
  laborMinutesEl.oninput = ()=>{ state.laborMinutes = Number(laborMinutesEl.value)||0; save(); renderAll(); };
  targetMarginPctEl.oninput = ()=>{ state.targetMarginPct = Number(targetMarginPctEl.value)||0; save(); renderAll(); };
}

addRowBtn.onclick = ()=>{
  state.rows.push({ id: uid(), variety:'', grade:'', supplier:'', packSize:'', stemsPerPack:0, packPrice:0, invoiceDate: new Date().toISOString().slice(0,10), notes:'' });
  save(); renderAll();
};
addItemBtn.onclick = ()=>{
  if (state.rows.length === 0) return;
  state.arrangement.push({ rowId: state.rows[0].id, qty: 1 });
  save(); renderAll();
};
exportCSVBtn.onclick = ()=>{
  const csv = toCSV(state.rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'flower_costs.csv'; a.click();
  URL.revokeObjectURL(url);
};
importCSVEl.onchange = (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    const imported = parseCSV(text);
    state.rows = state.rows.concat(imported);
    save(); renderAll();
  };
  reader.readAsText(f);
};

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  btn.hidden = false;
  btn.onclick = async ()=>{
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  };
});

function renderPhotoVarietyOptions(){
  const select = document.getElementById('photoVarietySelect');
  select.innerHTML = '<option value=\"\">Select flower...</option>' + state.rows.map(r=>`<option value=\"${r.id}\">${r.variety} ${r.grade?`(${r.grade})`:''}</option>`).join('');
}

photoInput.onchange = async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const blobURL = URL.createObjectURL(file);
  const img = await createImageBitmap(await (await fetch(blobURL)).blob());
  state.photo = img;
  drawPhoto();
  state.photoMarkers = [];
  document.getElementById('clearMarkers').disabled = true;
};

function drawPhoto(){
  const img = state.photo;
  const canvas = photoCanvas;
  const ctx = photoCtx;
  if (!img){
    canvas.width = 1000; canvas.height = 600;
    ctx.fillStyle = '#f3f4f6'; ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.fillStyle = '#64748b'; ctx.fillText('Load a photo to start', 20, 30);
    return;
  }
  const maxW = canvas.parentElement.clientWidth - 2;
  const scale = Math.min(maxW / img.width, 1);
  canvas.width = Math.floor(img.width * scale);
  canvas.height = Math.floor(img.height * scale);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const m of state.photoMarkers){
    const x = m.x * scale, y = m.y * scale;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI*2);
    ctx.fillStyle = '#0EA5E9aa';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0EA5E9';
    ctx.stroke();
  }
}

photoCanvas.addEventListener('click', (e)=>{
  if (!state.photo) return;
  const sel = document.getElementById('photoVarietySelect').value;
  if (!sel) { alert('Select a flower variety first'); return; }
  const rect = photoCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const scale = photoCanvas.width / state.photo.width;
  const ix = x / scale;
  const iy = y / scale;
  state.photoMarkers.push({ x: ix, y: iy, rowId: sel });
  document.getElementById('clearMarkers').disabled = false;
  const idx = state.arrangement.findIndex(a=>a.rowId===sel);
  if (idx >= 0) state.arrangement[idx].qty = (state.arrangement[idx].qty||0) + 1;
  else state.arrangement.push({ rowId: sel, qty: 1 });
  save();
  drawPhoto();
  renderAll();
});
document.getElementById('clearMarkers').onclick = ()=>{
  state.photoMarkers = [];
  document.getElementById('clearMarkers').disabled = true;
  drawPhoto();
};

function renderAll(){
  bindSettings();
  renderCostTable();
  renderArrangement();
  bindArrangementInputs();
  renderBreakdown();
  renderPhotoVarietyOptions();
  drawPhoto();
}
renderAll();
