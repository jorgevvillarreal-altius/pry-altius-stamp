/* ====== PDF.js ya está cargado por CDN; solo usamos la API ====== */

/* ====== DOM ====== */
const pdfCanvas = document.getElementById('pdfCanvas');
const ctx = pdfCanvas.getContext('2d');

const pdfUpload = document.getElementById('pdfUpload');
const stampInput = document.getElementById('stampImage');
const nameField = document.getElementById('nameField');
const fontSelect = document.getElementById('fontSelect');
const fontSizeInput = document.getElementById('fontSize');
const fontColorInput = document.getElementById('fontColor');
const stampWInput = document.getElementById('stampW');

const insertBtn = document.getElementById('insertStamp');
const downloadBtn = document.getElementById('downloadPdf');

const logoUpload = document.getElementById('logoUpload');
const logoImg = document.getElementById('logo');

const pageBar = document.getElementById('pageBar');
const pageNum = document.getElementById('pageNum');
const pageCount = document.getElementById('pageCount');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');

/* ====== TRIGGERS PARA FILE DIALOG ====== */
document.getElementById('btnPdfPick').addEventListener('click', ()=> pdfUpload.click());
document.getElementById('btnStampPick').addEventListener('click', ()=> stampInput.click());
document.getElementById('btnLogoPick').addEventListener('click', ()=> logoUpload.click());

/* ====== STATE ====== */
let pdfDoc = null;
let pdfBytesOriginal = null;
let currentPage = 1;

let stampImage = null;
let stampX = 50, stampY = 50;
let stampWidth = 100, stampHeight = 100;
let dragging = false;
let stampLocked = false;

const PDF_SCALE = 1.5;

/* ====== HELPERS ====== */
function tzDateString(){
  return new Date().toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' });
}
function hexToRgb01(hex){
  const h = hex.replace('#','');
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r: r/255, g: g/255, b: b/255 };
}
function dataUrlToBytes(dataURL){
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function pickPdfFontName(option){
  switch(option){
    case 'times': return PDFLib.StandardFonts.TimesRoman;
    case 'courier': return PDFLib.StandardFonts.Courier;
    case 'helvetica':
    default: return PDFLib.StandardFonts.Helvetica;
  }
}

/* ====== RENDER PREVIEW ====== */
async function renderPage(num){
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: PDF_SCALE });
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  if (stampImage){
    stampWidth = parseInt(stampWInput.value || '100', 10);
    const ratio = stampImage.naturalHeight ? (stampImage.naturalWidth / stampImage.naturalHeight) : 1;
    stampHeight = Math.round(stampWidth / (ratio || 1));
    drawStampOnCanvas();
  }
}
function drawStampOnCanvas(){
  ctx.drawImage(stampImage, stampX, stampY, stampWidth, stampHeight);
  const nameText = (nameField.value || 'Usuario').trim();
  const dateText = tzDateString();

  const fontSize = parseInt(fontSizeInput.value || '14',10);
  ctx.fillStyle = fontColorInput.value;
  ctx.font = `${fontSize}px ${fontSelect.value === 'times' ? 'Times New Roman' :
    fontSelect.value === 'courier' ? 'Courier New' : 'Helvetica, Arial'}`;
  ctx.textBaseline = 'top';

  const lineGap = Math.max(4, Math.round(fontSize*0.3));
  const textX = stampX;
  const textY1 = stampY + stampHeight + 6;
  const textY2 = textY1 + fontSize + lineGap;

  ctx.fillText(nameText || '—', textX, textY1);
  ctx.fillText(dateText, textX, textY2);
}

/* ====== EVENTS: CARGA PDF ====== */
pdfUpload.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  pdfBytesOriginal = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytesOriginal }).promise;
  currentPage = 1;
  pageCount.textContent = pdfDoc.numPages;
  pageBar.hidden = pdfDoc.numPages <= 1;
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
});

/* ====== EVENTS: CARGA IMAGEN SELLO ====== */
stampInput.addEventListener('change', (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    stampImage = new Image();
    stampImage.onload = ()=> renderPage(currentPage);
    stampImage.src = reader.result;
    stampLocked = false;
    insertBtn.textContent = 'Insertar sello (bloquear pos.)';
    insertBtn.disabled = false;
  };
  reader.readAsDataURL(file);
});

/* ====== DRAG ====== */
pdfCanvas.addEventListener('mousedown', (e)=>{
  if (!stampImage || stampLocked) return;
  dragging = true;
  const rect = pdfCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  stampX = Math.round(mx - stampWidth/2);
  stampY = Math.round(my - stampHeight/2);
  renderPage(currentPage);
});
pdfCanvas.addEventListener('mousemove', (e)=>{
  if (!dragging || !stampImage || stampLocked) return;
  const rect = pdfCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  stampX = Math.round(mx - stampWidth/2);
  stampY = Math.round(my - stampHeight/2);
  renderPage(currentPage);
});
window.addEventListener('mouseup', ()=> dragging = false);

/* ====== LOCK ====== */
insertBtn.addEventListener('click', ()=>{
  if (!stampImage){ alert('Primero carga una imagen de sello.'); return; }
  stampLocked = true;
  insertBtn.textContent = 'Sello bloqueado ✔️';
  insertBtn.disabled = true;
});

/* ====== NAVEGACIÓN PÁGINAS ====== */
prevPageBtn.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage<=1) return;
  currentPage--;
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
});
nextPageBtn.addEventListener('click', async ()=>{
  if (!pdfDoc || currentPage>=pdfDoc.numPages) return;
  currentPage++;
  await renderPage(currentPage);
  pageNum.textContent = String(currentPage);
});

/* ====== LOGO ====== */
logoUpload.addEventListener('change', (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ()=>{ logoImg.src = r.result; logoImg.style.display='block'; };
  r.readAsDataURL(f);
});

/* ====== DESCARGA CON PDF-LIB ====== */
downloadBtn.addEventListener('click', async ()=>{
  try{
    if (!pdfBytesOriginal){
      alert('Carga un PDF primero.'); return;
    }
    const { PDFDocument, rgb } = PDFLib;
    const pdfDocOut = await PDFDocument.load(pdfBytesOriginal);
    const pageIndex = Math.max(0, Math.min(pdfDocOut.getPageCount()-1, currentPage-1));
    const page = pdfDocOut.getPage(pageIndex);
    const { width: pageW, height: pageH } = page.getSize();

    if (stampImage){
      const isPng = stampImage.src.startsWith('data:image/png');
      const imgBytes = dataUrlToBytes(stampImage.src);
      const embedded = isPng ? await pdfDocOut.embedPng(imgBytes) : await pdfDocOut.embedJpg(imgBytes);

      const canvasToPdfScaleX = pageW / pdfCanvas.width;
      const canvasToPdfScaleY = pageH / pdfCanvas.height;

      const pdfW = stampWidth * canvasToPdfScaleX;
      const pdfH = stampHeight * canvasToPdfScaleY;

      const pdfX = stampX * canvasToPdfScaleX;
      const pdfY = pageH - (stampY * canvasToPdfScaleY) - pdfH;

      page.drawImage(embedded, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });

      const nameText = (nameField.value || 'Usuario').trim() || '—';
      const dateText = tzDateString();

      const fontName = pickPdfFontName(fontSelect.value);
      const font = await pdfDocOut.embedFont(fontName);
      const fontSize = parseInt(fontSizeInput.value || '14', 10);
      const { r, g, b } = hexToRgb01(fontColorInput.value);
      const color = rgb(r,g,b);

      const lineGap = Math.max(4, Math.round(fontSize*0.3));
      const textX = pdfX;
      const textY1 = pdfY - 6 - fontSize;
      const textY2 = textY1 - lineGap - fontSize;

      page.drawText(nameText, { x: textX, y: textY1, size: fontSize, font, color });
      page.drawText(dateText, { x: textX, y: textY2, size: fontSize, font, color });
    }

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
