// Esperar a que PDF.js (ESM) esté listo
await window.__pdfjsReady;

// Asegurar pdf-lib (fallback si cdnjs falla)
if (!window.PDFLib) {
  await new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ====== DOM ====== */
const pdfCanvas = document.getElementById('pdfCanvas');
const ctx = pdfCanvas.getContext('2d');
const pdfUpload = document.getElementById('pdfUpload');
const nameField = document.getElementById('nameField');
const fontSelect = document.getElementById('fontSelect');
const fontSizeInput = document.getElementById('fontSize');
const fontColorInput = document.getElementById('fontColor');
const stampWInput = document.getElementById('stampW');
const insertBtn = document.getElementById('insertStamp');
const downloadBtn = document.getElementById('downloadPdf');
const pageBar = document.getElementById('pageBar');
const pageCountEl = document.getElementById('pageCount');
const pageInput = document.getElementById('pageInput');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
document.getElementById('btnPdfPick').addEventListener('click', ()=> pdfUpload.click());

/* ====== STATE ====== */
let pdfDoc = null;                         // Preview (pdf.js)
let pdfBytesMaster = null;                 // Uint8Array maestro (no se transfiere al worker)
let pdfBytesForPdfjs = null;               // Copia para pdf.js
let currentPage = 1;

// Imagen base del sello y sello unificado
const baseStampImg = new Image();
baseStampImg.src = 'images/cnt-altius-revisado.png';
let unifiedStampCanvas = null;             // canvas compuesto (imagen + textos)
let stampX = 50, stampY = 50;              // posición en preview
let dragging = false;
let stampLocked = false;

// Canvas de fondo para el PDF (evita re-render al arrastrar)
const pdfBgCanvas = document.createElement('canvas');
const pdfBgCtx = pdfBgCanvas.getContext('2d');
let renderTask = null;                     // render de pdf.js en curso

const PDF_SCALE = 1.5;

/* ====== HELPERS ====== */
function tzDateString(){
  // Fecha local GMT-5 (America/Guayaquil) - NO editable
  return new Date().toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' });
}
function dataUrlToBytes(dataURL){
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Construye el sello unificado (imagen + textos en una sola pieza)
 * - Texto izquierda: nombre (editable)
 * - Texto derecha: fecha (auto GMT-5)
 * - Una línea bajo la imagen
 */
function buildUnifiedStamp(){
  if (!baseStampImg.complete || !baseStampImg.naturalWidth) return null;

  const desiredW = Math.max(40, parseInt(stampWInput.value || '160', 10));
  const scale = desiredW / baseStampImg.naturalWidth;
  const imgW = Math.round(baseStampImg.naturalWidth * scale);
  const imgH = Math.round(baseStampImg.naturalHeight * scale);

  const fontSize = Math.max(8, parseInt(fontSizeInput.value || '14', 10));
  const fontCss = fontSelect.value === 'times' ? 'Times New Roman' :
                  fontSelect.value === 'courier' ? 'Courier New' : 'Helvetica, Arial';
  const color = fontColorInput.value;

  const nameText = (nameField.value || 'Usuario').trim() || '—';
  const dateText = tzDateString();

  const paddingX = Math.max(6, Math.round(imgW * 0.04));
  const paddingTop = 6;
  const paddingBottom = 6;
  const textHeight = fontSize;
  const totalW = imgW;
  const totalH = imgH + paddingTop + textHeight + paddingBottom;

  const c = document.createElement('canvas');
  c.width = totalW;
  c.height = totalH;
  const cx = c.getContext('2d');

  // Imagen base
  cx.drawImage(baseStampImg, 0, 0, imgW, imgH);

  // Texto
  cx.fillStyle = color;
  cx.textBaseline = 'top';
  cx.font = `${fontSize}px ${fontCss}`;

  // Nombre (izquierda)
  cx.textAlign = 'left';
  cx.fillText(nameText, paddingX, imgH + paddingTop);

  // Fecha (derecha)
  cx.textAlign = 'right';
  cx.fillText(dateText, totalW - paddingX, imgH + paddingTop);

  return c;
}

/* ====== COMPOSICIÓN (sin re-render al mover) ====== */
function composite(){
  if (!pdfBgCanvas.width || !pdfBgCanvas.height) return;
  if (pdfCanvas.width !== pdfBgCanvas.width) pdfCanvas.width = pdfBgCanvas.width;
  if (pdfCanvas.height !== pdfBgCanvas.height) pdfCanvas.height = pdfBgCanvas.height;

  ctx.clearRect(0,0,pdfCanvas.width,pdfCanvas.height);
  ctx.drawImage(pdfBgCanvas, 0,0);
  if (unifiedStampCanvas){
    ctx.drawImage(unifiedStampCanvas, stampX, stampY);
  }
}

/* ====== RENDER PÁGINA PDF ====== */
async function renderPage(num){
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: PDF_SCALE });

  pdfBgCanvas.width = Math.floor(viewport.width);
  pdfBgCanvas.height = Math.floor(viewport.height);

  if (renderTask && renderTask.cancel) {
    try { renderTask.cancel(); } catch {}
  }

  renderTask = page.render({ canvasContext: pdfBgCtx, viewport });
  try { await renderTask.promise; } catch(e) {} finally { renderTask = null; }

  composite();
}

/* ====== INPUTS -> reconstruir sello + refrescar ====== */
function refreshStampAndRender(){
  unifiedStampCanvas = buildUnifiedStamp();
  composite();
}
[nameField, fontSelect, fontSizeInput, fontColorInput, stampWInput].forEach(el=>{
  el.addEventListener('input', refreshStampAndRender);
});

/* ====== CARGA PDF ====== */
pdfUpload.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;

  const buf = await file.arrayBuffer();

  // Copia MAESTRA (no se transfiere) y copia para pdf.js (puede transferirse)
  pdfBytesMaster = new Uint8Array(buf);
  pdfBytesForPdfjs = pdfBytesMaster.slice();

  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytesForPdfjs }).promise;
  currentPage = 1;

  pageCountEl.textContent = pdfDoc.numPages;
  pageInput.min = 1;
  pageInput.max = pdfDoc.numPages;
  pageInput.value = '1';
  pageBar.hidden = pdfDoc.numPages <= 1; // mostrar solo si hay varias páginas

  if (!unifiedStampCanvas && baseStampImg.complete) {
    unifiedStampCanvas = buildUnifiedStamp();
  }
  await renderPage(currentPage);
});

/* ====== PAGE JUMP por teclado (Enter) ====== */
pageInput.addEventListener('keydown', async (e)=>{
  if (e.key !== 'Enter') return;
  if (!pdfDoc) return;
  const n = parseInt(pageInput.value, 10);
  if (!Number.isFinite(n)) { pageInput.value = String(currentPage); return; }
  const clamped = Math.min(Math.max(n, 1), pdfDoc.numPages);
  if (clamped === currentPage) { pageInput.value = String(currentPage); return; }
  currentPage = clamped;
  await renderPage(currentPage);
  pageInput.value = String(currentPage);
});

/* ====== Prev / Next ====== */
prevPageBtn?.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage<=1) return;
  currentPage--;
  await renderPage(currentPage);
  pageInput.value = String(currentPage);
});
nextPageBtn?.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage>=pdfDoc.numPages) return;
  currentPage++;
  await renderPage(currentPage);
  pageInput.value = String(currentPage);
});

/* ====== DRAG ====== */
pdfCanvas.addEventListener('mousedown', (e)=>{
  if (!unifiedStampCanvas || stampLocked) return;
  dragging = true;
  const rect = pdfCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  stampX = Math.round(mx - unifiedStampCanvas.width/2);
  stampY = Math.round(my - unifiedStampCanvas.height/2);
  composite();
});
pdfCanvas.addEventListener('mousemove', (e)=>{
  if (!dragging || !unifiedStampCanvas || stampLocked) return;
  const rect = pdfCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  stampX = Math.round(mx - unifiedStampCanvas.width/2);
  stampY = Math.round(my - unifiedStampCanvas.height/2);
  composite();
});
window.addEventListener('mouseup', ()=> dragging = false);

/* ====== BLOQUEAR POSICIÓN ====== */
insertBtn.addEventListener('click', ()=>{
  if (!unifiedStampCanvas){ alert('El sello aún no está listo.'); return; }
  stampLocked = true;
  insertBtn.textContent = 'Sello bloqueado ✔️';
  insertBtn.disabled = true;
});

/* ====== CUANDO CARGA LA IMAGEN BASE DEL SELLO ====== */
baseStampImg.onload = ()=>{
  unifiedStampCanvas = buildUnifiedStamp();
  composite();
};

/* ====== DESCARGA PDF (crear NUEVO PDF con sello) ====== */
downloadBtn.addEventListener('click', async ()=>{
  try{
    if (!pdfBytesMaster){
      alert('Carga un PDF primero.'); return;
    }
    if (!unifiedStampCanvas){
      alert('El sello aún no está listo.'); return;
    }
    const { PDFDocument } = PDFLib;

    // Usar SIEMPRE una copia fresca del maestro (evita "detached ArrayBuffer")
    const pdfDocOut = await PDFDocument.load(pdfBytesMaster.slice());

    const pageIndex = Math.max(0, Math.min(pdfDocOut.getPageCount()-1, currentPage-1));
    const page = pdfDocOut.getPage(pageIndex);
    const { width: pageW, height: pageH } = page.getSize();

    const pngBytes = dataUrlToBytes(unifiedStampCanvas.toDataURL('image/png'));
    const embedded = await pdfDocOut.embedPng(pngBytes);

    // Conversión coordenadas canvas->PDF
    const scaleX = pageW / pdfCanvas.width;
    const scaleY = pageH / pdfCanvas.height;

    const pdfW = unifiedStampCanvas.width * scaleX;
    const pdfH = unifiedStampCanvas.height * scaleY;
    const pdfX = stampX * scaleX;
    const pdfY = pageH - (stampY * scaleY) - pdfH;

    page.drawImage(embedded, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });

    // Guardar NUEVO archivo PDF
    const pdfBytes = await pdfDocOut.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'pdf-sellado.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }catch(err){
    console.error(err);
    alert('❗ Ocurrió un error al generar el PDF. Revisa la consola.');
  }
});
