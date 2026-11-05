const $ = (selector) => document.querySelector(selector);
const state = { images: [], orientation: 'auto', margin: 24, busy: false, loading: false, dragId: null, pdfUrl: null, pdfName: null };
let toastTimer;

function icon(name) { return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function notify(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 4200);
}
function bytesLabel(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
function outputName() { return ($('#filename').value.trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100) || 'my-lovely-images') + '.pdf'; }

function render() {
  const count = state.images.length;
  $('#empty-state').hidden = count > 0;
  $('#image-grid').hidden = count === 0;
  $('#file-count').hidden = count === 0;
  $('#file-count').textContent = count;
  $('#clear-button').hidden = count === 0;
  $('#ready-label').hidden = count > 0;
  $('#sample-button').hidden = count > 0;
  $('#add-button').hidden = count === 0;
  $('#arrange-note').textContent = count ? 'Drag to rearrange. Make it your story.' : 'Your images, in exactly your order.';
  $('#page-summary').textContent = count ? `${count} image${count === 1 ? '' : 's'} → ${count} page${count === 1 ? '' : 's'}` : 'Your next great PDF';
  $('#size-summary').textContent = count ? `${bytesLabel(state.images.reduce((sum, image) => sum + image.file.size, 0))} of images` : 'Ready when you are';
  const locked = state.busy || state.loading;
  document.body.classList.toggle('busy', state.busy);
  $('#convert-button').disabled = !count || locked;
  $('#preview-button').disabled = !count || locked;
  $('#choose-button').disabled = locked;
  $('#sample-button').disabled = locked;
  $('#clear-button').disabled = locked;
  $('#add-button').disabled = locked;
  $('#file-input').disabled = locked;
  $('#page-size').disabled = locked;
  $('#filename').disabled = locked;
  $('#quality').disabled = locked;
  document.querySelectorAll('[data-orientation], [data-margin]').forEach(button => { button.disabled = locked; });
  $('#image-grid').replaceChildren();
  state.images.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'image-card';
    card.draggable = !locked;
    card.dataset.id = item.id;
    card.setAttribute('aria-label', `Page ${index + 1}: ${item.file.name}`);
    card.innerHTML = `<span class="page-index">${String(index + 1).padStart(2, '0')}</span><div class="image-thumb"></div><p class="image-name"></p><div class="image-meta"><span>${item.width} × ${item.height}</span><span>${bytesLabel(item.file.size)}</span></div><div class="image-tools"><button class="move-left" aria-label="Move page ${index + 1} earlier" ${index === 0 || locked ? 'disabled' : ''}>←</button><button class="move-right" aria-label="Move page ${index + 1} later" ${index === count - 1 || locked ? 'disabled' : ''}>→</button><button class="rotate-image" aria-label="Rotate page ${index + 1} clockwise" ${locked ? 'disabled' : ''}>${icon('rotate')}</button><button class="remove-image" aria-label="Remove page ${index + 1}" ${locked ? 'disabled' : ''}>${icon('trash')}</button></div>`;
    card.querySelector('.image-name').textContent = item.file.name;
    card.querySelector('.image-name').title = item.file.name;
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.file.name;
    img.style.transform = `rotate(${item.rotation}deg)`;
    img.classList.toggle('quarter-turn', item.rotation % 180 !== 0);
    card.querySelector('.image-thumb').append(img);
    card.querySelector('.move-left').onclick = () => moveImage(item.id, index - 1, '.move-left');
    card.querySelector('.move-right').onclick = () => moveImage(item.id, index + 1, '.move-right');
    card.querySelector('.rotate-image').onclick = () => { item.rotation = (item.rotation + 90) % 360; render(); focusAction(item.id, '.rotate-image'); };
    card.querySelector('.remove-image').onclick = () => { URL.revokeObjectURL(item.url); state.images.splice(index, 1); render(); };
    card.addEventListener('dragstart', event => {
      state.dragId = item.id;
      event.dataTransfer.setData('text/plain', item.id);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragover', event => { if (state.dragId && state.dragId !== item.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; card.classList.add('drop-target'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', event => { if (!state.dragId) return; event.preventDefault(); event.stopPropagation(); moveImage(state.dragId, index); state.dragId = null; });
    card.addEventListener('dragend', () => { state.dragId = null; document.querySelectorAll('.dragging, .drop-target').forEach(node => node.classList.remove('dragging', 'drop-target')); });
    $('#image-grid').append(card);
  });
}
function focusAction(id, selector) { document.querySelector(`[data-id="${id}"] ${selector}`)?.focus(); }
function moveImage(id, target, focusSelector) {
  if (state.busy || state.loading) return;
  const current = state.images.findIndex(item => item.id === id);
  if (current < 0 || target < 0 || target >= state.images.length || current === target) return;
  const [item] = state.images.splice(current, 1);
  state.images.splice(target, 0, item);
  render();
  if (focusSelector) focusAction(id, focusSelector);
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened. Try a different JPG, PNG, or WebP.'));
    img.src = url;
  });
}
async function addFiles(files) {
  if (state.busy || state.loading) return;
  const incoming = Array.from(files);
  if (!incoming.length) return;
  state.loading = true;
  render();
  const errors = [];
  let added = 0;
  for (const file of incoming) {
    if (!(file.type.match(/^image\/(jpeg|png|webp)$/i) || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name)))) { errors.push(`${file.name}: please use JPG, PNG, or WebP.`); continue; }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image could not be decoded by your browser.');
      state.images.push({ id: crypto.randomUUID(), file, url, width: image.naturalWidth, height: image.naturalHeight, rotation: 0 });
      added++;
    } catch (error) { URL.revokeObjectURL(url); errors.push(`${file.name}: ${error.message}`); }
  }
  state.loading = false;
  render();
  if (errors.length) notify(errors[0] + (errors.length > 1 ? ` (${errors.length} files skipped.)` : ''), true);
  else if (added) notify(`${added} image${added === 1 ? '' : 's'} added. Looking good already.`);
}

async function buildPdf() {
  if (!window.PDFLib) throw new Error('The PDF engine is unavailable. Please reload the page and try again.');
  const doc = await PDFLib.PDFDocument.create();
  const name = outputName();
  doc.setTitle(name.replace(/\.pdf$/i, ''));
  doc.setCreator('Paperly');
  const quality = $('#quality').checked;
  const size = $('#page-size').value;
  const margin = state.margin;
  for (let index = 0; index < state.images.length; index++) {
    const item = state.images[index];
    $('#convert-button span').textContent = `Creating page ${index + 1} of ${state.images.length}…`;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const image = await loadImage(item.url);
    const quarterTurn = item.rotation % 180 !== 0;
    const naturalW = quarterTurn ? item.height : item.width;
    const naturalH = quarterTurn ? item.width : item.height;
    const rasterScale = Math.min(1, (quality ? 4096 : 1800) / Math.max(naturalW, naturalH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalW * rasterScale));
    canvas.height = Math.max(1, Math.round(naturalH * rasterScale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image. Try a smaller image.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(item.rotation * Math.PI / 180);
    context.drawImage(image, -item.width * rasterScale / 2, -item.height * rasterScale / 2, item.width * rasterScale, item.height * rasterScale);
    const jpegBlob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This image could not be processed. Try a smaller image.')), 'image/jpeg', quality ? 0.94 : 0.72));
    const embedded = await doc.embedJpg(await jpegBlob.arrayBuffer());
    canvas.width = canvas.height = 0;
    let pageW, pageH;
    if (size === 'original') {
      pageW = Math.max(1, naturalW * 0.75) + margin * 2;
      pageH = Math.max(1, naturalH * 0.75) + margin * 2;
      // Fit-to-image honors an explicitly chosen paper orientation without cropping.
      if (state.orientation === 'portrait' && pageW > pageH || state.orientation === 'landscape' && pageW < pageH) [pageW, pageH] = [pageH, pageW];
      const maxScale = Math.min(1, 14400 / Math.max(pageW, pageH));
      pageW *= maxScale; pageH *= maxScale;
    } else {
      [pageW, pageH] = size === 'letter' ? [612, 792] : [595.28, 841.89];
      if (state.orientation === 'landscape' || state.orientation === 'auto' && naturalW > naturalH) [pageW, pageH] = [pageH, pageW];
    }
    const page = doc.addPage([pageW, pageH]);
    const effectiveMargin = Math.min(margin, pageW / 4, pageH / 4);
    const fit = Math.min((pageW - effectiveMargin * 2) / naturalW, (pageH - effectiveMargin * 2) / naturalH);
    const width = naturalW * fit, height = naturalH * fit;
    page.drawImage(embedded, { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height });
  }
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), name, pages: state.images.length };
}
function download(url, name) {
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
}
async function exportPdf(preview = false) {
  if (!state.images.length || state.busy || state.loading) return;
  state.busy = true;
  render();
  try {
    const result = await buildPdf();
    const url = URL.createObjectURL(result.blob);
    if (preview) {
      if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
      state.pdfUrl = url; state.pdfName = result.name;
      $('#pdf-preview').src = url;
      $('#preview-details').textContent = `${result.name} · ${result.pages} page${result.pages === 1 ? '' : 's'} · ${bytesLabel(result.blob.size)}`;
      $('#preview-dialog').showModal();
    } else {
      download(url, result.name);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify('All wrapped up! Your PDF has been downloaded.');
    }
  } catch (error) { console.error(error); notify(error.message || 'Something went wrong. Please try again.', true); }
  finally { state.busy = false; $('#convert-button span').textContent = 'Create PDF'; render(); }
}

$('#choose-button').onclick = $('#add-button').onclick = () => $('#file-input').click();
$('#file-input').onchange = async event => { await addFiles(event.target.files); event.target.value = ''; };
$('#clear-button').onclick = () => { state.images.forEach(item => URL.revokeObjectURL(item.url)); state.images = []; render(); notify('Fresh canvas. Ready for something new.'); };
$('#sample-button').onclick = async () => {
  if (state.loading || state.busy) return;
  state.loading = true; render();
  try {
    const files = await Promise.all(['mountains', 'lake', 'forest'].map(async name => {
      const response = await fetch(`./assets/${name}.jpg`);
      if (!response.ok) throw new Error('Sample images are unavailable. Choose your own images to get started.');
      return new File([await response.blob()], `${name}.jpg`, { type: 'image/jpeg' });
    }));
    state.loading = false;
    await addFiles(files);
  } catch (error) { state.loading = false; render(); notify(error.message, true); }
};
document.querySelectorAll('[data-orientation]').forEach(button => button.onclick = () => {
  state.orientation = button.dataset.orientation;
  document.querySelectorAll('[data-orientation]').forEach(node => { const active = node === button; node.classList.toggle('selected', active); node.setAttribute('aria-pressed', active); });
});
document.querySelectorAll('[data-margin]').forEach(button => button.onclick = () => {
  state.margin = Number(button.dataset.margin);
  document.querySelectorAll('[data-margin]').forEach(node => { const active = node === button; node.classList.toggle('selected', active); node.setAttribute('aria-pressed', active); });
});
$('#page-size').onchange = event => { $('#page-dimensions').textContent = { a4: '210 × 297 mm', letter: '8.5 × 11 in', original: 'Matches your image' }[event.target.value]; };
$('#convert-button').onclick = () => exportPdf();
$('#preview-button').onclick = () => exportPdf(true);
$('#preview-download').onclick = () => { if (state.pdfUrl) { download(state.pdfUrl, state.pdfName); notify('Your lovely PDF is on its way.'); } };
$('#how-button').onclick = () => $('#help-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
let dragDepth = 0;
const zone = $('#drop-zone');
zone.addEventListener('dragenter', event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragDepth++; if (!state.busy && !state.loading) zone.classList.add('drag-over'); } });
zone.addEventListener('dragover', event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = state.busy || state.loading ? 'none' : 'copy'; } });
zone.addEventListener('dragleave', event => { if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) zone.classList.remove('drag-over'); } });
zone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; zone.classList.remove('drag-over'); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
// Prevent files dropped outside the workspace from navigating away from the app.
window.addEventListener('dragover', event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer.files.length) event.preventDefault(); });
render();
