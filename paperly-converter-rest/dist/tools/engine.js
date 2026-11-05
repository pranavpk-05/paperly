const { PDFDocument, StandardFonts, rgb, degrees, TextRenderingMode } = PDFLib;
export const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));
const stem = name => (name || 'document').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
const pdfBlob = bytes => new Blob([bytes], {type:'application/pdf'});
const getFieldType=field=>['PDFTextField','PDFCheckBox','PDFDropdown','PDFOptionList','PDFRadioGroup','PDFSignature','PDFButton'].find(name=>PDFLib[name]&&field instanceof PDFLib[name])||'PDFField';
const out = (name, blob) => ({name,blob});
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export function parsePages(value, count, allowDuplicates = false) {
  if (!value || value.trim().toLowerCase() === 'all') return Array.from({length:count},(_,i)=>i);
  const result = [];
  for (const token of value.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers like 1, 3-5, 8. Page numbers start at 1.');
    const first=Number(match[1]), last=Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first<1 || last<1 || first>count || last>count) throw new Error(`Page numbers must be between 1 and ${count}.`);
    const direction=first<=last?1:-1;
    for(let i=first; ;i+=direction){if(allowDuplicates || !result.includes(i-1)) result.push(i-1);if(i===last)break;}
  }
  return result;
}
let rendererPromise;
export async function renderer() {
  if(!rendererPromise) rendererPromise=import('../assets/engines/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=new URL('../assets/engines/pdf.worker.mjs',import.meta.url).href;return lib;}).catch(error=>{rendererPromise=null;throw error;});
  return rendererPromise;
}
export async function openPdf(file,password='') {
  const lib=await renderer();
  const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),password, isEvalSupported:false});
  try{const pdf=await task.promise;pdf.destroy=()=>task.destroy();return pdf;}catch(error){await task.destroy().catch(()=>{});throw error;}
}
export async function renderPage(pdf,index=0,scale=1.3) {
  const page=await pdf.getPage(index+1);
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Your browser could not allocate space for this page. Close other tabs or use a lower resolution.');
  await page.render({canvas,canvasContext:context,viewport,background:'white'}).promise;
  return {canvas,viewport,page};
}
function canvasBlob(canvas,type='image/jpeg',quality=.9){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('This image is too large for your browser to export.')) ,type,quality));}
async function readPdf(file){return PDFDocument.load(await file.arrayBuffer());}
function abortCheck(signal){if(signal?.aborted)throw new DOMException('Processing canceled.','AbortError');}
async function copyDocument(source,indices){const doc=await PDFDocument.create();for(const page of await doc.copyPages(source,indices))doc.addPage(page);return doc;}
function color(hex='#7960d8'){const c=hex.replace('#','');return rgb(parseInt(c.slice(0,2),16)/255,parseInt(c.slice(2,4),16)/255,parseInt(c.slice(4,6),16)/255);}
function number(value,fallback){const n=Number(value);return value!=='' && Number.isFinite(n)?n:fallback;}
function ensureRange(value,min,max,label){if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} must be between ${min} and ${max}.`);return value;}
async function savePdf(doc,name){doc.setProducer('Paperly');return out(name,pdfBlob(await doc.save()));}
async function imageObject(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}}
export async function qpdf(file,mode,options={},signal){
  const bytes=await file.arrayBuffer();
  abortCheck(signal);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../assets/engines/qpdf-worker.js',import.meta.url));
    const abort=()=>{worker.terminate();reject(new DOMException('Processing canceled.','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    const finish=()=>{worker.terminate();signal?.removeEventListener('abort',abort);};
    worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(pdfBlob(data.bytes));};
    worker.onerror=()=>{finish();reject(new Error('The local PDF engine could not start. Reload the page and try again.'));};
    worker.postMessage({bytes,mode,password:options.password,ownerPassword:crypto.randomUUID()},[bytes]);
  });
}
async function pageText(pdf,index){
  const page=await pdf.getPage(index+1);const content=await page.getTextContent();const rows=[];
  for(const item of content.items){if(!('str'in item)||!item.str.trim())continue;const y=item.transform[5];let row=rows.find(row=>Math.abs(row.y-y)<3);if(!row){row={y,cells:[]};rows.push(row);}row.cells.push({x:item.transform[4],text:item.str});}
  return rows.sort((a,b)=>b.y-a.y).map(row=>row.cells.sort((a,b)=>a.x-b.x).map(cell=>cell.text));
}
async function textPages(file,progress,signal){const pdf=await openPdf(file);try{const pages=[];for(let i=0;i<pdf.numPages;i++){abortCheck(signal);progress(`Reading page ${i+1} of ${pdf.numPages}`,i/pdf.numPages);pages.push(await pageText(pdf,i));}return pages;}finally{await pdf.destroy();}}
function checkText(pages){if(!pages.some(rows=>rows.some(row=>row.some(text=>text.trim()))))throw new Error('No selectable text was found. Use OCR PDF first for scanned documents.');}
async function textPdf(pages,options={}){
  const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const fontSize=number(options.fontSize,11);
  for(const lines of pages){let page=doc.addPage([595.28,841.89]),y=790;for(const raw of lines){const words=String(raw).replace(/\t/g,'    ').split(/\s+/);let line='';for(const word of words){const candidate=line?line+' '+word:word;let width;try{width=font.widthOfTextAtSize(candidate,fontSize);}catch{throw new Error('This file contains characters the local PDF text font cannot represent. Use the original document’s Print → Save as PDF for this file.');}if(width>490 && line){page.drawText(line,{x:50,y,size:fontSize,font});y-=fontSize*1.6;line=word;}else line=candidate;if(y<50){page=doc.addPage([595.28,841.89]);y=790;}}if(line)page.drawText(line,{x:50,y,size:fontSize,font});y-=fontSize*1.6;if(y<50){page=doc.addPage([595.28,841.89]);y=790;}}}
  return doc;
}
const xml = text => new DOMParser().parseFromString(text,'application/xml');
const elements = (node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
function xmlText(node,name){return elements(node,name).map(el=>el.textContent).join('');}
async function zipFile(zip,name){const entry=zip.file(name);if(!entry)throw new Error(`This document is missing ${name}. It may be damaged or unsupported.`);return entry.async('string');}
function cleanZipPath(base,target){const parts=(target.startsWith('/')?target.slice(1):base+target).split('/');const out=[];for(const part of parts){if(part==='..')out.pop();else if(part!=='.'&&part)out.push(part);}return out.join('/');}
export function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw new Error('This CSV contains an unclosed quoted field.');if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
async function sheetRows(file){
  if(/\.csv$/i.test(file.name))return [{name:stem(file.name),rows:parseCsv(await file.text())}];
  const zip=await JSZip.loadAsync(file);let shared=[];
  if(zip.file('xl/sharedStrings.xml'))shared=elements(xml(await zipFile(zip,'xl/sharedStrings.xml')),'si').map(si=>xmlText(si,'t'));
  const workbook=xml(await zipFile(zip,'xl/workbook.xml'));
  const rels=elements(xml(await zipFile(zip,'xl/_rels/workbook.xml.rels')),'Relationship');
  const sheets=[];
  for(const sheet of elements(workbook,'sheet')){
    const id=sheet.getAttribute('r:id');const rel=rels.find(rel=>rel.getAttribute('Id')===id);if(!rel)continue;
    const path=cleanZipPath('xl/',rel.getAttribute('Target'));
    const doc=xml(await zipFile(zip,path));const rows=elements(doc,'row').map(row=>{
      const cells=[];for(const cell of elements(row,'c')){const ref=cell.getAttribute('r')||'A1';const col=ref.match(/^[A-Z]+/)?.[0]||'A';let index=0;for(const char of col)index=index*26+char.charCodeAt(0)-64;let value=xmlText(cell,'v');if(cell.getAttribute('t')==='s')value=shared[Number(value)]??'';else if(cell.getAttribute('t')==='inlineStr')value=xmlText(cell,'t');cells[index-1]=value;}return Array.from(cells,value=>value??'');
    });sheets.push({name:sheet.getAttribute('name')||'Sheet',rows});
  }return sheets;
}
function contentTypes(overrides){return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`;}
function relations(items){return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id,type,target])=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${escapeXml(target)}"/>`).join('')}</Relationships>`;}
async function makeDocx(pages){const zip=new JSZip();zip.file('[Content_Types].xml',contentTypes([['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml']]));zip.file('_rels/.rels',relations([['rId1','officeDocument','word/document.xml']]));zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pages.map((rows,i)=>`${i?'<w:p><w:r><w:br w:type="page"/></w:r></w:p>':''}${rows.map(row=>`<w:p><w:r><w:t xml:space="preserve">${escapeXml(row.join('  '))}</w:t></w:r></w:p>`).join('')}`).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`);return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}
async function makeXlsx(pages){
  const zip=new JSZip();const column=n=>{let name='';for(n++;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
  zip.file('[Content_Types].xml',contentTypes([['xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],...pages.map((_,i)=>[`xl/worksheets/sheet${i+1}.xml`,'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'])]));
  zip.file('_rels/.rels',relations([['rId1','officeDocument','xl/workbook.xml']]));
  zip.file('xl/workbook.xml',`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${pages.map((_,i)=>`<sheet name="Page ${i+1}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',relations(pages.map((_,i)=>[`rId${i+1}`,'worksheet',`worksheets/sheet${i+1}.xml`])));
  pages.forEach((rows,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,r)=>`<row r="${r+1}">${row.map((cell,c)=>`<c r="${column(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`));
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const scripts=new Map();
async function loadScript(path,globalName){if(window[globalName])return window[globalName];if(!scripts.has(path))scripts.set(path,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(path,import.meta.url).href;script.onload=()=>resolve(window[globalName]);script.onerror=()=>{scripts.delete(path);reject(new Error('A processing component could not load. Check your connection and retry.'));};document.head.append(script);}));return scripts.get(path);}
async function rasterPdf(file,options,progress,signal,kind){
  const pdf=await openPdf(file,options.password);const doc=await PDFDocument.create();const outputs=[];
  const indices=parsePages(options.pages,pdf.numPages);const selected=new Set(indices);
  let ocrWorker;
  try{
    if(kind==='ocr'){
      const Tesseract=await loadScript('../assets/engines/tesseract.min.js','Tesseract');
      progress('Downloading the local OCR engine…',0);
      ocrWorker=await Tesseract.createWorker('eng',1,{logger:message=>{if(message.status==='recognizing text')progress(`Recognizing text · ${Math.round(message.progress*100)}%`,message.progress);}});
    }
    const pageIndices=kind==='images'||kind==='ocr'?indices:Array.from({length:pdf.numPages},(_,i)=>i);
    let ocrFont;if(ocrWorker)ocrFont=await doc.embedFont(StandardFonts.Helvetica);
    for(let n=0;n<pageIndices.length;n++){
      abortCheck(signal);const i=pageIndices[n];progress(`Processing page ${n+1} of ${pageIndices.length}`,n/pageIndices.length);
      const scale=number(options.scale,kind==='compress'? (options.compression==='smallest'?1:1.5):2);
      const {canvas,viewport}=await renderPage(pdf,i,scale);const ctx=canvas.getContext('2d');
      if(kind==='redact'&&selected.has(i)){
        const x=ensureRange(number(options.x,10),0,100,'Left position'),y=ensureRange(number(options.y,10),0,100,'Top position');const w=ensureRange(number(options.width,40),.1,100,'Width'),h=ensureRange(number(options.height,10),.1,100,'Height');
        if(x+w>100||y+h>100)throw new Error('The redaction rectangle must stay inside the page.');
        ctx.fillStyle='#000';ctx.fillRect(Math.floor(x/100*canvas.width),Math.floor(y/100*canvas.height),Math.ceil(w/100*canvas.width),Math.ceil(h/100*canvas.height));
      }
      if(kind==='grayscale'){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let p=0;p<pixels.data.length;p+=4){const gray=Math.round(.2126*pixels.data[p]+.7152*pixels.data[p+1]+.0722*pixels.data[p+2]);pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=gray;}ctx.putImageData(pixels,0,0);}
      if(kind==='images'){
        const png=options.format==='png';outputs.push(out(`page-${String(i+1).padStart(3,'0')}.${png?'png':'jpg'}`,await canvasBlob(canvas,png?'image/png':'image/jpeg',number(options.quality,.9))));
      }else{
        const png=kind==='redact'||kind==='ocr';const blob=await canvasBlob(canvas,png?'image/png':'image/jpeg',kind==='compress'?(options.compression==='smallest'?.5:.75):.9);
        const image=png?await doc.embedPng(await blob.arrayBuffer()):await doc.embedJpg(await blob.arrayBuffer());
        const page=doc.addPage([viewport.width/scale,viewport.height/scale]);page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
        if(ocrWorker){
          const {data}=await ocrWorker.recognize(canvas,{}, {blocks:true,text:true});
          const words=(data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(line=>line.words||[])));
          for(const word of words){const text=word.text?.trim();if(!text)continue;try{const fontSize=Math.max(1,(word.bbox.y1-word.bbox.y0)/scale*.9);page.drawText(text,{x:word.bbox.x0/scale,y:page.getHeight()-word.bbox.y1/scale,size:fontSize,font:ocrFont,opacity:0});}catch{/* Unsupported OCR glyphs are excluded from the invisible text layer. */}}
          if(options.ocrFormat==='text')outputs.push(out(`page-${i+1}.txt`,new Blob([data.text],{type:'text/plain;charset=utf-8'})));
        }
      }
      canvas.width=canvas.height=0;await tick();
    }
    if(kind==='images'||kind==='ocr'&&options.ocrFormat==='text')return outputs;
    return [await savePdf(doc,`${stem(file.name)}-${kind}.pdf`)];
  }finally{if(ocrWorker)await ocrWorker.terminate();await pdf.destroy();}
}

export async function inspectForms(file){
  const doc=await readPdf(file);return doc.getForm().getFields().map(field=>{
    const type=getFieldType(field);
    return {name:field.getName(),type,value:type==='PDFTextField'?field.getText()||'':type==='PDFCheckBox'?field.isChecked():type==='PDFDropdown'||type==='PDFOptionList'||type==='PDFRadioGroup'?field.getSelected():null,options:typeof field.getOptions==='function'?field.getOptions():[]};
  });
}

export async function runTool(id,files,options={},progress=()=>{},signal){
  abortCheck(signal);const first=files[0];if(!first)throw new Error('Choose a file first.');
  progress('Getting everything ready…',0);
  const name=stem(options.filename||first.name);
  let outputs=[];let note='';
  if(['protect','unlock','repair'].includes(id)||id==='compress'&&options.compression==='lossless'){
    if(['protect','unlock'].includes(id)&&!options.password)throw new Error('Enter a password first.');
    if(id==='protect'&&options.password!==options.confirmPassword)throw new Error('The passwords do not match.');
    if(id==='protect'&&options.password.length<8)throw new Error('Use at least 8 characters for a stronger document password.');
    outputs=[out(`${name}-${id}.pdf`,await qpdf(first,id,options,signal))];
    if(id==='repair')note='The structure was rewritten. Open and inspect the recovered document; missing content cannot be recreated.';
  }else if(['pdf-jpg','grayscale','redact','ocr','compress'].includes(id)){
    outputs=await rasterPdf(first,options,progress,signal,id==='pdf-jpg'?'images':id);
  }else if(['text','markdown','pdf-word','pdf-excel','compare'].includes(id)){
    const pages=await textPages(first,progress,signal);checkText(pages);
    if(id==='text'||id==='markdown')outputs=[out(`${name}.${id==='text'?'txt':'md'}`,new Blob([pages.map((rows,i)=>(id==='markdown'?`## Page ${i+1}\n\n`:'')+rows.map(row=>row.join(' ')).join('\n')).join('\n\n')],{type:'text/plain;charset=utf-8'}))];
    if(id==='pdf-word')outputs=[out(`${name}.docx`,await makeDocx(pages))];
    if(id==='pdf-excel')outputs=[out(`${name}.xlsx`,await makeXlsx(pages))];
    if(id==='compare'){
      if(files.length!==2)throw new Error('Choose exactly two PDF documents to compare.');
      const other=await textPages(files[1],progress,signal);checkText(other);
      const a=pages.flatMap(rows=>rows.map(row=>row.join(' '))),b=other.flatMap(rows=>rows.map(row=>row.join(' ')));
      const setA=new Set(a),setB=new Set(b);const changed=a.filter(line=>!setB.has(line)).length+b.filter(line=>!setA.has(line)).length;
      const side=(lines,set)=>lines.map(line=>`<p class="${set.has(line)?'same':'changed'}">${escapeXml(line)}</p>`).join('');
      const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paperly — PDF comparison</title><style>body{font:15px/1.7 system-ui;background:#faf8fc;color:#36303e;margin:30px}h1{font-size:28px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{background:white;border:1px solid #e5dcec;border-radius:12px;padding:24px;min-width:0}p{white-space:pre-wrap;overflow-wrap:anywhere}.changed{background:#fff0b9;padding:5px}small{color:#8d8097}@media(max-width:600px){main{grid-template-columns:1fr}}</style><h1>Every change, a little clearer.</h1><p>${changed} text lines differ between these documents.</p><small>Text-only comparison. Repeated lines and line reordering may require manual review. Images, graphics, and page layout are not compared.</small><main><section><h2>${escapeXml(first.name)}</h2>${side(a,setB)}</section><section><h2>${escapeXml(files[1].name)}</h2>${side(b,setA)}</section></main>`;
      outputs=[out(`${name}-comparison.html`,new Blob([html],{type:'text/html;charset=utf-8'}))];note=`${changed} text lines differ. Open the HTML report to review both documents.`;
    }
  }else if(id==='pdf-powerpoint'){
    const PptxGen=await loadScript('../assets/engines/pptxgen.bundle.js','PptxGenJS');const presentation=new PptxGen();const pdf=await openPdf(first);
    try{const firstPage=await pdf.getPage(1);const firstView=firstPage.getViewport({scale:1});const slideWidth=firstView.width/72,slideHeight=firstView.height/72;presentation.defineLayout({name:'PAPERLY',width:slideWidth,height:slideHeight});presentation.layout='PAPERLY';for(let i=0;i<pdf.numPages;i++){abortCheck(signal);progress(`Creating slide ${i+1} of ${pdf.numPages}`,i/pdf.numPages);const {canvas}=await renderPage(pdf,i,1.6);const data=canvas.toDataURL('image/jpeg',.9),fit=Math.min(slideWidth/canvas.width,slideHeight/canvas.height),w=canvas.width*fit,h=canvas.height*fit;presentation.addSlide().addImage({data,x:(slideWidth-w)/2,y:(slideHeight-h)/2,w,h});canvas.width=canvas.height=0;}outputs=[out(`${name}.pptx`,await presentation.write({outputType:'blob',compression:true}))];}finally{await pdf.destroy();}
  }else if(['word-pdf','powerpoint-pdf','excel-pdf','html-pdf'].includes(id)){
    let pages=[];
    if(id==='word-pdf'){const zip=await JSZip.loadAsync(first);const doc=xml(await zipFile(zip,'word/document.xml'));pages=[elements(doc,'p').map(p=>xmlText(p,'t'))];}
    if(id==='powerpoint-pdf'){const zip=await JSZip.loadAsync(first);const slides=Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));if(!slides.length)throw new Error('This presentation has no readable slides.');for(const path of slides){abortCheck(signal);const doc=xml(await zipFile(zip,path));pages.push(elements(doc,'p').map(p=>xmlText(p,'t')));}}
    if(id==='excel-pdf')pages=(await sheetRows(first)).map(sheet=>[sheet.name,'',...sheet.rows.map(row=>row.join('    |    '))]);
    if(id==='html-pdf'){const doc=new DOMParser().parseFromString(await first.text(),'text/html');doc.querySelectorAll('script,style,noscript,template').forEach(node=>node.remove());doc.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));doc.querySelectorAll('p,div,h1,h2,h3,h4,li,tr,section,article').forEach(node=>node.append('\n'));pages=[doc.body.textContent.split(/\n/).map(text=>text.trim()).filter(Boolean)];}
    if(!pages.some(lines=>lines.some(line=>line.trim())))throw new Error('No readable text or cell values were found in this file.');
    outputs=[await savePdf(await textPdf(pages),`${name}.pdf`)];
  }else if(id==='image-pdf'||id==='scan'){
    const doc=await PDFDocument.create();for(let i=0;i<files.length;i++){abortCheck(signal);progress(`Adding image ${i+1} of ${files.length}`,i/files.length);const img=await imageObject(files[i]);const canvas=document.createElement('canvas');const scale=Math.min(1,4096/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);if(id==='scan'&&options.scanMode==='grayscale'){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let p=0;p<pixels.data.length;p+=4){const gray=Math.round(.299*pixels.data[p]+.587*pixels.data[p+1]+.114*pixels.data[p+2]);pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=gray;}ctx.putImageData(pixels,0,0);}const image=await doc.embedJpg(await (await canvasBlob(canvas,'image/jpeg',.95)).arrayBuffer());let dims=options.pageSize==='letter'?[612,792]:options.pageSize==='original'?[canvas.width*.75,canvas.height*.75]:[595.28,841.89];if(options.pageSize!=='original'&&canvas.width>canvas.height)dims.reverse();const page=doc.addPage(dims),margin=number(options.margin,24),fit=Math.min((dims[0]-margin*2)/canvas.width,(dims[1]-margin*2)/canvas.height);if(fit<=0)throw new Error('Margins are too large for this image. Choose a larger page size or smaller margins.');page.drawImage(image,{x:(dims[0]-canvas.width*fit)/2,y:(dims[1]-canvas.height*fit)/2,width:canvas.width*fit,height:canvas.height*fit});canvas.width=canvas.height=0;await tick();}outputs=[await savePdf(doc,`${name}.pdf`)];
  }else if(id==='merge'||id==='workflow'){
    const doc=await PDFDocument.create();for(let i=0;i<files.length;i++){abortCheck(signal);progress(`Combining document ${i+1} of ${files.length}`,i/files.length);const source=await readPdf(files[i]);for(const page of await doc.copyPages(source,source.getPageIndices()))doc.addPage(page);}
    if(id==='workflow'){
      const font=await doc.embedFont(StandardFonts.Helvetica);doc.getPages().forEach((page,i)=>{if(options.workflowRotate)page.setRotation(degrees((page.getRotation().angle+90)%360));if(options.workflowNumbers)page.drawText(`${i+1} / ${doc.getPageCount()}`,{x:page.getWidth()/2-12,y:20,size:10,font,color:rgb(.4,.4,.4)});if(options.workflowWatermark){const label=options.text||'DRAFT';const size=Math.min(44,page.getWidth()/Math.max(5,label.length)*1.5);page.drawText(label,{x:30,y:page.getHeight()/2,size,font,color:color(options.color),opacity:.25,rotate:degrees(25)});}});
    }outputs=[await savePdf(doc,`${name}-${id==='merge'?'merged':'workflow'}.pdf`)];
  }else{
    const doc=await readPdf(first);const count=doc.getPageCount();const indices=parsePages(options.pages,count);const selected=new Set(indices);
    if(id==='split'){
      const groups=options.splitMode==='ranges'?(options.ranges||'').split(';').filter(Boolean).map(range=>parsePages(range,count)):options.splitMode==='every'?Array.from({length:Math.ceil(count/Math.max(1,number(options.every,1)))},(_,i)=>Array.from({length:Math.min(number(options.every,1),count-i*number(options.every,1))},(_,j)=>i*number(options.every,1)+j)):Array.from({length:count},(_,i)=>[i]);
      if(!groups.length)throw new Error('Enter at least one range, for example 1-3; 4-6.');
      if(options.splitMode==='every'&&(!Number.isInteger(Number(options.every))||Number(options.every)<1))throw new Error('Pages per file must be a positive whole number.');
      for(let i=0;i<groups.length;i++){abortCheck(signal);outputs.push(await savePdf(await copyDocument(doc,groups[i]),`${name}-${String(i+1).padStart(3,'0')}.pdf`));}
    }else if(['extract','remove','organize'].includes(id)){
      let keep=id==='remove'?doc.getPageIndices().filter(i=>!selected.has(i)):id==='organize'?parsePages(options.order||options.pages,count,true):indices;
      if(!keep.length)throw new Error('Keep at least one page in the document.');
      const result=await copyDocument(doc,keep);if(id==='organize'&&options.pageRotations)result.getPages().forEach((page,i)=>{page.setRotation(degrees((page.getRotation().angle+number(options.pageRotations[i],0))%360));});outputs=[await savePdf(result,`${name}-${id}.pdf`)];
    }else{
      let font;
      if(['edit','numbers','watermark','forms','sign'].includes(id))font=await doc.embedFont(StandardFonts.Helvetica);
      if(id==='forms'){
        const form=doc.getForm();for(const [fieldName,value] of Object.entries(options.formValues||{})){const field=form.getField(fieldName),type=getFieldType(field);if(type==='PDFTextField')field.setText(String(value));else if(type==='PDFCheckBox')value?field.check():field.uncheck();else if(['PDFDropdown','PDFOptionList','PDFRadioGroup'].includes(type)&&value!=='')field.select(Array.isArray(value)?value:String(value));}
        if(options.newFieldName){const page=doc.getPage(ensureRange(number(options.fieldPage,1),1,count,'Field page')-1);const box={x:page.getWidth()*number(options.x,10)/100,y:page.getHeight()*(1-number(options.y,10)/100)-26,width:page.getWidth()*number(options.width,40)/100,height:26};const field=options.fieldType==='checkbox'?form.createCheckBox(options.newFieldName):form.createTextField(options.newFieldName);if(options.fieldType==='checkbox'){box.width=box.height=20;}else{field.setText(options.fieldValue||'');}field.addToPage(page,{...box,borderWidth:1,borderColor:color('#7960d8'),font});if(options.fieldType!=='checkbox')field.setFontSize(12);}
        form.updateFieldAppearances(font);
      }
      if(id==='flatten'){const form=doc.getForm();if(!form.getFields().length)throw new Error('This PDF has no standard interactive form fields to flatten.');form.flatten();}
      if(id==='metadata'){doc.setTitle(options.title||'');doc.setAuthor(options.author||'');doc.setSubject(options.subject||'');doc.setKeywords((options.keywords||'').split(',').map(v=>v.trim()).filter(Boolean));}
      let addedImage;
      if(id==='sign'){if(!options.signature)throw new Error('Draw your signature before saving.');addedImage=await doc.embedPng(options.signature);}
      if(id==='edit'&&options.annotation==='image'){if(!options.annotationImage)throw new Error('Choose an image to add to the page.');const img=await imageObject(options.annotationImage);const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);addedImage=await doc.embedPng(await (await canvasBlob(canvas,'image/png')).arrayBuffer());canvas.width=canvas.height=0;}
      for(let i=0;i<count;i++){
        abortCheck(signal);const page=doc.getPage(i);if(!selected.has(i))continue;
        const width=page.getWidth(),height=page.getHeight();
        if(['edit','sign','crop','numbers','watermark','forms'].includes(id)&&page.getRotation().angle%360!==0 && ['edit','sign','crop'].includes(id))throw new Error('This page has a stored rotation. Rotate it to 0° with Rotate PDF first, or use an unrotated copy for precise positioning.');
        if(id==='rotate')page.setRotation(degrees((page.getRotation().angle+number(options.rotation,90))%360));
        if(id==='numbers'){const text=options.numberFormat==='simple'?String(i+number(options.start,1)):`${i+number(options.start,1)} / ${count+number(options.start,1)-1}`;const size=number(options.fontSize,11),textWidth=font.widthOfTextAtSize(text,size);page.drawText(text,{x:options.position==='left'?24:options.position==='right'?width-textWidth-24:(width-textWidth)/2,y:options.numberPosition==='top'?height-28:22,size,font,color:color(options.color||'#6b6475')});}
        if(id==='watermark'){const text=options.text||'DRAFT',size=number(options.fontSize,44),textWidth=font.widthOfTextAtSize(text,size);page.drawText(text,{x:Math.max(15,(width-textWidth)/2),y:height/2,size,font,color:color(options.color),opacity:ensureRange(number(options.opacity,.2),.01,1,'Opacity'),rotate:degrees(number(options.angle,0))});}
        if(id==='crop'){const amount=ensureRange(number(options.crop,24),0,Math.min(width,height)/2-1,'Crop amount');page.setCropBox(amount,amount,width-amount*2,height-amount*2);}
        if(id==='resize'){const [w,h]=options.pageSize==='letter'?[612,792]:options.pageSize==='custom'?[ensureRange(number(options.pageWidth,595),10,14400,'Page width'),ensureRange(number(options.pageHeight,842),10,14400,'Page height')]:[595.28,841.89];const embedded=await doc.embedPage(page);const replacement=doc.insertPage(i,[w,h]);const scale=Math.min(w/width,h/height);replacement.drawPage(embedded,{x:(w-width*scale)/2,y:(h-height*scale)/2,width:width*scale,height:height*scale});doc.removePage(i+1);}
        if(id==='sign'||id==='edit'){
          const x=ensureRange(number(options.x,10),0,100,'Left position')/100*width,yTop=ensureRange(number(options.y,10),0,100,'Top position')/100*height;const annotation=options.annotation||'text';const size=number(options.fontSize,18);const w=number(options.width,30)/100*width,h=number(options.height,10)/100*height;
          if(id==='sign'||annotation==='image'){const drawWidth=Math.min(w,width-x);const drawHeight=drawWidth/addedImage.width*addedImage.height;page.drawImage(addedImage,{x,y:height-yTop-drawHeight,width:drawWidth,height:drawHeight});}
          else if(annotation==='text'){if(!options.text?.trim())throw new Error('Enter the text you want to add.');page.drawText(options.text,{x,y:height-yTop-size,size,font,color:color(options.color)});}
          else if(annotation==='rectangle')page.drawRectangle({x,y:height-yTop-h,width:w,height:h,borderColor:color(options.color),borderWidth:2,opacity:0,borderOpacity:1});
          else if(annotation==='ellipse')page.drawEllipse({x:x+w/2,y:height-yTop-h/2,xScale:w/2,yScale:h/2,borderColor:color(options.color),borderWidth:2,opacity:0,borderOpacity:1});
        }
        await tick();
      }
      outputs=[await savePdf(doc,`${name}-${id}.pdf`)];
    }
  }
  abortCheck(signal);
  if(id==='compress'&&outputs[0]){const difference=first.size-outputs[0].blob.size;note=difference>0?`${Math.round(difference/first.size*100)}% smaller · ${(difference/1024).toFixed(1)} KB saved.`:'This PDF was already compact. The processed version is larger; your original file is unchanged.';}
  progress('All wrapped up.',1);
  return {outputs,note};
}

export async function zipOutputs(outputs){const zip=new JSZip();for(const file of outputs)zip.file(file.name,file.blob);return zip.generateAsync({type:'blob',compression:'DEFLATE'});}
