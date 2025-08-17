// Esperar a que PDF.js (ESM) esté listo
await window.__pdfjsReady;

// Asegurar pdf-lib (fallback)
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
const pageNum = document.getElementById('pageNum');
const pageCount = document.getElementById('pageCount');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
document.getElementById('btnPdfPick').addEventListener('click', ()=> pdfUpload.click());

/* ====== STATE ====== */
let pdfDoc = null;                   // para preview
let pdfBytesOriginal = null;         // ArrayBuffer original
let currentPage = 1;

const baseStampImg = new Image();    // /images/cnt-altius-revisado.png
baseStampImg.src = 'images/cnt-altius-revisado.png';
let unifiedStampCanvas = null;       // canvas compuesto (imagen + textos)
let stampX = 50, stampY = 50;        // posición en preview
let dragging = false;
let stampLocked = false;

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
 * Construye el sello unificado (canvas) combinando:
 * - imagen base (/images/cnt-altius-revisado.png)
 * - texto izquierda: nombre (editable)
 * - texto derecha: fecha (auto GMT-5)
 * Debajo de la imagen, misma línea (izq nombre / der fecha)
 */
function buildUnifiedStamp(){
  if (!baseStampImg.complete || !baseStampImg.naturalWidth) return null;

  const desiredW = Math.max(40, parseInt(stampWInput.value || '160', 10));
  const scale = desiredW / baseStampImg.naturalWidth;
  const imgW = Math.round(baseStampImg.naturalWidth * scale);
  const imgH = Math.round(baseStampImg.naturalHeight * scale);

  // Tipografía para el sello (en la imagen compuesta)
  const fontSize = Math.max(8, parseInt(fontSizeInput.value || '14', 10));
  const fontCss = fontSelect.value === 'times' ? 'Times New Roman' :
                  fontSelect.value === 'courier' ? 'Courier New' : 'Helvetica, Arial';
  const color = fontColorInput.value;

  // Textos
  const nameText = (nameField.value || 'Usuario').trim() || '—';
  const dateText = tzDateString();

  // Layout texto (una línea bajo la imagen)
  const paddingX = Math.max(6, Math.round(imgW * 0.04));
  const paddingTop = 6;
  const paddingBottom = 6;
  const textHeight = fontSize; // una línea
  const totalW = imgW;
  const totalH = imgH + paddingTop + textHeight + paddingBottom;

  // Canvas resultado
  const c = document.createElement('canvas');
  c.width = totalW;
  c.height = totalH;
  const cx = c.getContext('2d');

  // Fondo transparente (no dibujar rect)
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

/* ====== RENDER PREVIEW ====== */
async function renderPage(num){
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: PDF_SCALE });
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Dibuja sello unificado si existe
  if (!unifiedStampCanvas){
    unifiedStampCanvas = buildUnifiedStamp();
  }
  if (unifiedStampCanvas){
    ctx.drawImage(unifiedStampCanvas, stampX, stampY);
  }
}

/* ====== INPUTS -> reconstruir sello + refrescar ====== */
function refreshStampAndRender(){
  unifiedStampCanvas = buildUnifiedStamp();
  if (pdfDoc) renderPage(currentPage);
}
[nameField, fontSelect, fontSizeInput, fontColorInput, stampWInput].forEach(el=>{
  el.addEventListener('input', refreshStampAndRender);
});

/* ====== CARGA PDF ====== */
pdfUpload.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  pdfBytesOriginal = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytesOriginal }).promise;
  currentPage = 1;
  pageCount.textContent = pdfDoc.numPages;
  pageBar.hidden = pdfDoc.numPages <= 1;

  // Construir sello si aún no existe (en caso de que la imagen ya cargó)
  if (!unifiedStampCanvas && baseStampImg.complete) {
    unifiedStampCanvas = buildUnifiedStamp();
  }
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
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
  renderPage(currentPage);
});
pdfCanvas.addEventListener('mousemove', (e)=>{
  if (!dragging || !unifiedStampCanvas || stampLocked) return;
  const rect = pdfCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  stampX = Math.round(mx - unifiedStampCanvas.width/2);
  stampY = Math.round(my - unifiedStampCanvas.height/2);
  renderPage(currentPage);
});
window.addEventListener('mouseup', ()=> dragging = false);

/* ====== BLOQUEAR POSICIÓN ====== */
insertBtn.addEventListener('click', ()=>{
  if (!unifiedStampCanvas){ alert('El sello aún no está listo.'); return; }
  stampLocked = true;
  insertBtn.textContent = 'Sello bloqueado ✔️';
  insertBtn.disabled = true;
});

/* ====== NAVEGACIÓN PÁGINAS ====== */
prevPageBtn?.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage<=1) return;
  currentPage--;
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
});
nextPageBtn?.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage>=pdfDoc.numPages) return;
  currentPage++;
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
});

/* ====== CUANDO CARGA LA IMAGEN BASE DEL SELLO ====== */
baseStampImg.onload = ()=>{
  unifiedStampCanvas = buildUnifiedStamp();
  if (pdfDoc) renderPage(currentPage);
};

/* ====== DESCARGA PDF (sello unificado como imagen) ====== */
downloadBtn.addEventListener('click', async ()=>{
  try{
    if (!pdfBytesOriginal){
      alert('Carga un PDF primero.'); return;
    }
    if (!unifiedStampCanvas){
      alert('El sello aún no está listo.'); return;
    }
    const { PDFDocument } = PDFLib;
    const pdfDocOut = await PDFDocument.load(pdfBytesOriginal);
    const pageIndex = Math.max(0, Math.min(pdfDocOut.getPageCount()-1, currentPage-1));
    const page = pdfDocOut.getPage(pageIndex);
    const { width: pageW, height: pageH } = page.getSize();

    // Bytes del sello unificado (PNG)
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
