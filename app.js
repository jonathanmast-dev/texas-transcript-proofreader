/* Texas Transcript Proofreader
 * Frontend workflow + OpenAI proxy integration (odysgo-proxy pattern).
 */

const ACCEPTED_EXTENSIONS = ['docx', 'pdf', 'txt', 'ascii'];
const PRICE_PER_PAGE = 0.5;
const LINES_PER_PAGE = 25;

const STYLE_NOTES = {
  'Texas UFM - Official Reporter': 'Applies Texas Uniform Format Manual rules for official court reporters.',
  'Texas UFM - Deputy Reporter': 'Applies Texas UFM rules tuned for deputy reporter transcripts.',
  'Texas UFM - Freelance Reporter': 'Applies Texas UFM rules for freelance / deposition work.',
  'General Proofreading': 'Standard punctuation, spelling, and capitalization checks.'
};

const ROADMAP = [
  'Texas Uniform Format Manual rule engine',
  'Morson court reporter style guide',
  'Name checker',
  'Date consistency checker',
  'Legal terminology checker',
  'Medical terminology checker',
  'Case law citation checker',
  'CAT imports (Eclipse, CaseCAT)',
  'State Bar of Texas lawyer lookup',
  'Secure login',
  'Encrypted file storage',
  'Corrected transcript export',
  'Clean copy export',
  'Marked-up copy export',
  'PDF export',
  'Line-by-line correction report'
];

const state = {
  file: null,
  style: 'Texas UFM - Official Reporter',
  transcriptText: '',
  transcriptReady: false,
  summary: '',
  corrections: [],
  editingId: null,
  pages: null,
  pagesEstimated: false,
  isRunning: false
};

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('file-input'),
  dropzone: $('dropzone'),
  fileSummary: $('file-summary'),
  fileName: $('file-name'),
  fileSub: $('file-sub'),
  clearFile: $('clear-file'),
  styleSelect: $('style-select'),
  styleNote: $('style-note'),
  runBtn: $('run-btn'),
  runHint: $('run-hint'),
  costLine: $('cost-line'),
  pageValue: $('page-value'),
  costValue: $('cost-value'),
  costNote: $('cost-note'),
  resultsEmpty: $('results-empty'),
  resultsContent: $('results-content'),
  summaryText: $('summary-text'),
  statTotal: $('stat-total'),
  statAccepted: $('stat-accepted'),
  statRejected: $('stat-rejected'),
  statPending: $('stat-pending'),
  cardsList: $('cards-list'),
  applySafeBtn: $('apply-safe-btn'),
  exportFinalBtn: $('export-final-btn'),
  roadmapGrid: $('roadmap-grid'),
  editModal: $('edit-modal'),
  editLocation: $('edit-location'),
  editTextarea: $('edit-textarea'),
  editCancel: $('edit-cancel'),
  editSave: $('edit-save'),
  toast: $('toast')
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getExtension(name) {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getProxyUrl() {
  return (window.APP_CONFIG && window.APP_CONFIG.PROXY_URL) || '/api/proofread';
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 200);
  }, 2600);
}

function formatCurrency(amount) {
  return '$' + amount.toFixed(2);
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) {
    throw new Error('PDF text extraction library is not loaded');
  }
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(groupPdfItemsIntoLines(content.items).join('\n'));
  }
  return pages.join('\f');
}

function groupPdfItemsIntoLines(items) {
  const rows = new Map();
  items.forEach((item) => {
    if (!item.str) return;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], text: item.str });
  });

  return [...rows.keys()]
    .sort((a, b) => b - a)
    .map((y) =>
      rows
        .get(y)
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join('')
        .trimEnd()
    )
    .filter((line) => line.length > 0);
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function extractDocxText(file) {
  if (!window.mammoth) {
    throw new Error('DOCX text extraction library is not loaded');
  }
  const buf = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || '';
}

async function extractTranscriptText(file) {
  const ext = getExtension(file.name);
  if (ext === 'txt' || ext === 'ascii') {
    return (await file.text()).replace(/\r\n/g, '\n');
  }
  if (ext === 'pdf') {
    return extractPdfText(file);
  }
  if (ext === 'docx') {
    return extractDocxText(file);
  }
  throw new Error('Unsupported file type');
}

async function countPages(file, transcriptText = '') {
  const ext = getExtension(file.name);
  try {
    if (ext === 'pdf' && window.pdfjsLib) {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      return { pages: pdf.numPages, estimated: false };
    }
    if (ext === 'txt' || ext === 'ascii' || ext === 'docx') {
      const text = transcriptText || (await extractTranscriptText(file));
      const formFeeds = (text.match(/\f/g) || []).length;
      if (formFeeds > 0) {
        const trailing = /\f\s*$/.test(text) ? 0 : 1;
        return { pages: formFeeds + trailing, estimated: ext === 'docx' };
      }
      const lines = text.replace(/\s+$/, '').split(/\n/).length;
      return { pages: Math.max(1, Math.ceil(lines / LINES_PER_PAGE)), estimated: ext === 'docx' };
    }
  } catch (err) {
    console.warn('Page count failed, falling back to estimate:', err);
  }
  return { pages: Math.max(1, Math.round(file.size / 3000)), estimated: true };
}

async function handleFile(file) {
  if (!file) return;
  const ext = getExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    showToast('Unsupported file type. Use .docx, .pdf, .txt, or .ascii');
    return;
  }

  state.file = file;
  state.transcriptText = '';
  state.transcriptReady = false;
  state.summary = '';
  state.corrections = [];
  state.pages = null;
  state.pagesEstimated = false;

  els.fileName.textContent = file.name;
  els.fileSub.textContent = `${ext.toUpperCase()} · ${formatBytes(file.size)} · extracting text…`;
  els.fileSummary.classList.remove('hidden');
  els.dropzone.classList.add('hidden');
  els.costLine.classList.remove('hidden');
  els.pageValue.textContent = 'Counting…';
  els.costValue.textContent = '—';
  els.resultsEmpty.classList.remove('hidden');
  els.resultsContent.classList.add('hidden');
  updateRunState();

  try {
    const transcriptText = await extractTranscriptText(file);
    if (state.file !== file) return;

    state.transcriptText = transcriptText.trim();
    state.transcriptReady = Boolean(state.transcriptText);
    if (!state.transcriptReady) {
      throw new Error('No readable text was found in this file');
    }

    els.fileSub.textContent = `${ext.toUpperCase()} · ${formatBytes(file.size)} · ${state.transcriptText.length.toLocaleString()} chars`;

    const { pages, estimated } = await countPages(file, state.transcriptText);
    if (state.file !== file) return;
    state.pages = pages;
    state.pagesEstimated = estimated;
    renderCost();
    updateRunState();
  } catch (err) {
    if (state.file !== file) return;
    clearFile();
    showToast(err instanceof Error ? err.message : 'Could not read this file');
  }
}

function renderCost() {
  if (!state.pages) return;
  const cost = state.pages * PRICE_PER_PAGE;
  els.pageValue.textContent =
    `${state.pages} page${state.pages === 1 ? '' : 's'}${state.pagesEstimated ? ' (est.)' : ''}`;
  els.costValue.textContent = formatCurrency(cost);
  els.costNote.textContent = state.pagesEstimated
    ? `Billed at ${formatCurrency(PRICE_PER_PAGE)} per page. Page count for .docx is estimated. No payment required for this test.`
    : `Billed at ${formatCurrency(PRICE_PER_PAGE)} per page. No payment required for this test.`;
}

function clearFile() {
  state.file = null;
  state.transcriptText = '';
  state.transcriptReady = false;
  state.summary = '';
  state.corrections = [];
  state.pages = null;
  state.pagesEstimated = false;
  els.fileInput.value = '';
  els.fileSummary.classList.add('hidden');
  els.dropzone.classList.remove('hidden');
  els.costLine.classList.add('hidden');
  els.resultsEmpty.classList.remove('hidden');
  els.resultsContent.classList.add('hidden');
  updateRunState();
}

function updateRunState() {
  const ready = Boolean(state.file && state.transcriptReady && !state.isRunning);
  els.runBtn.disabled = !ready;
  els.runHint.textContent = !state.file
    ? 'Upload a file to enable proofreading.'
    : !state.transcriptReady
      ? 'Reading transcript text…'
      : state.isRunning
        ? 'Running proofread…'
        : 'Ready. Click to send the transcript to OpenAI for review.';
}

async function runProofread() {
  if (!state.file || !state.transcriptReady || state.isRunning) return;

  state.isRunning = true;
  els.runBtn.classList.add('is-loading');
  els.runBtn.querySelector('.btn-label').textContent = 'Running Proofread…';
  updateRunState();

  try {
    const response = await fetch(getProxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptText: state.transcriptText,
        style: state.style,
        filename: state.file.name,
        pages: state.pages
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Proofread request failed');
    }

    state.summary = typeof payload.summary === 'string' ? payload.summary : '';
    state.corrections = Array.isArray(payload.corrections)
      ? payload.corrections.map((item, index) => ({
          id: index + 1,
          status: 'pending',
          page: item.page,
          line: item.line,
          original: item.original,
          suggested: item.suggested,
          issues: Array.isArray(item.issues) ? item.issues : ['proofreading'],
          safe: item.safe === true
        }))
      : [];

    if (!state.corrections.length) {
      showToast('Proofread completed with no suggested corrections');
    }

    renderResults();
    els.resultsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    showToast(err instanceof Error ? err.message : 'Proofread failed');
  } finally {
    state.isRunning = false;
    els.runBtn.classList.remove('is-loading');
    els.runBtn.querySelector('.btn-label').textContent = 'Run Proofread';
    updateRunState();
  }
}

function renderResults() {
  els.resultsEmpty.classList.add('hidden');
  els.resultsContent.classList.remove('hidden');

  const summaryLine = state.summary
    ? `<br><span class="muted">${escapeHtml(state.summary)}</span>`
    : '';

  els.summaryText.innerHTML =
    `Proofread complete for <strong>${escapeHtml(state.file.name)}</strong> ` +
    `using <strong>${escapeHtml(state.style)}</strong>.` +
    summaryLine;

  renderCards();
  updateStats();
}

function renderCards() {
  els.cardsList.innerHTML = '';

  if (!state.corrections.length) {
    els.cardsList.innerHTML = `
      <div class="card results-empty" style="padding: 28px;">
        <h3>No corrections suggested</h3>
        <p class="muted">OpenAI did not flag any issues for this transcript with the selected style.</p>
      </div>
    `;
    return;
  }

  state.corrections.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'correction-card';
    card.dataset.status = c.status;
    card.dataset.id = c.id;

    const issues = c.issues.map((i) => `<span class="issue-chip">${escapeHtml(i)}</span>`).join('');
    const safeFlag = c.safe ? '<span class="safe-flag">&#10003; Safe fix</span>' : '';

    card.innerHTML = `
      <div class="cc-head">
        <span class="cc-loc">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          Page ${c.page}, Line ${c.line}
        </span>
        <span class="status-tag ${c.status}">${c.status}</span>
      </div>
      <div class="cc-diff">
        <div class="diff-row"><span class="diff-label">Original</span><span class="diff-text original">${escapeHtml(c.original)}</span></div>
        <div class="diff-row"><span class="diff-label">Suggested</span><span class="diff-text suggested">${escapeHtml(c.suggested)}</span></div>
      </div>
      <div class="cc-issues">${issues}${safeFlag}</div>
      <div class="cc-actions">
        <button type="button" class="btn btn-accept" data-action="accept">Accept</button>
        <button type="button" class="btn btn-reject" data-action="reject">Reject</button>
        <button type="button" class="btn btn-edit" data-action="edit">Edit</button>
      </div>
    `;
    els.cardsList.appendChild(card);
  });
}

function updateStats() {
  const total = state.corrections.length;
  const accepted = state.corrections.filter((c) => c.status === 'accepted').length;
  const rejected = state.corrections.filter((c) => c.status === 'rejected').length;
  const pending = state.corrections.filter((c) => c.status === 'pending').length;
  els.statTotal.textContent = total;
  els.statAccepted.textContent = accepted;
  els.statRejected.textContent = rejected;
  els.statPending.textContent = pending;
}

function setStatus(id, status) {
  const c = state.corrections.find((x) => x.id === id);
  if (!c) return;
  c.status = status;
  renderCards();
  updateStats();
}

function applyAllSafeFixes() {
  let count = 0;
  state.corrections.forEach((c) => {
    if (c.safe && c.status !== 'accepted') {
      c.status = 'accepted';
      count++;
    }
  });
  renderCards();
  updateStats();
  showToast(count ? `Accepted ${count} safe fix${count > 1 ? 'es' : ''}` : 'No pending safe fixes');
}

function openEdit(id) {
  const c = state.corrections.find((x) => x.id === id);
  if (!c) return;
  state.editingId = id;
  els.editLocation.textContent = `Page ${c.page}, Line ${c.line}`;
  els.editTextarea.value = c.suggested;
  els.editModal.classList.remove('hidden');
  els.editTextarea.focus();
}

function closeEdit() {
  state.editingId = null;
  els.editModal.classList.add('hidden');
}

function saveEdit() {
  const c = state.corrections.find((x) => x.id === state.editingId);
  if (c) {
    c.suggested = els.editTextarea.value;
    c.status = 'accepted';
    renderCards();
    updateStats();
    showToast('Suggestion updated');
  }
  closeEdit();
}

function applyAcceptedCorrections(transcriptText, corrections) {
  const accepted = corrections.filter((c) => c.status === 'accepted');
  if (!accepted.length) return transcriptText;

  const pages = transcriptText.split('\f');

  accepted.forEach((correction) => {
    const pageIdx = correction.page - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) return;

    const lines = pages[pageIdx].split('\n');
    const lineIdx = correction.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) return;

    const line = lines[lineIdx];
    if (correction.original && line.includes(correction.original)) {
      lines[lineIdx] = line.replace(correction.original, correction.suggested);
    } else if (correction.suggested) {
      lines[lineIdx] = correction.suggested;
    }
    pages[pageIdx] = lines.join('\n');
  });

  let result = pages.join('\f');

  // Fallback: replace any remaining accepted originals still in the text.
  accepted
    .sort((a, b) => b.original.length - a.original.length)
    .forEach((correction) => {
      if (correction.original && result.includes(correction.original)) {
        result = result.replace(correction.original, correction.suggested);
      }
    });

  return result;
}

function getCorrectedTranscriptText() {
  return applyAcceptedCorrections(state.transcriptText, state.corrections);
}

function writeCorrectedTextToPdf(text) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 72;
  const marginTop = 72;
  const marginBottom = 72;
  const lineHeight = 12;
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont('courier', 'normal');
  doc.setFontSize(10);

  let y = marginTop;
  const sourcePages = text.split('\f');

  sourcePages.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      doc.addPage();
      y = marginTop;
    }

    section.split('\n').forEach((line) => {
      if (y + lineHeight > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(line.length ? line : ' ', marginX, y);
      y += lineHeight;
    });
  });

  return doc;
}

function exportFinalTranscript() {
  if (!state.transcriptText || !state.file) {
    showToast('Upload a transcript before exporting');
    return;
  }

  const finalText = getCorrectedTranscriptText();
  const ext = getExtension(state.file.name);
  const baseName = state.file.name.replace(/\.[^.]+$/, '');

  // Text uploads: export the corrected file in the same format — exact layout preserved.
  if (ext === 'txt' || ext === 'ascii') {
    downloadTextFile(finalText, `${baseName}_final.${ext}`);
    showToast('Final transcript exported');
    return;
  }

  if (ext === 'docx') {
    downloadTextFile(finalText, `${baseName}_final.txt`);
    showToast('Final transcript exported');
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF library not loaded. Check your connection and retry.');
    return;
  }

  writeCorrectedTextToPdf(finalText).save(`${baseName}_final.pdf`);
  showToast('Final transcript exported (PDF)');
}

function renderRoadmap() {
  els.roadmapGrid.innerHTML = ROADMAP.map((item) => `
    <div class="roadmap-item">
      <span class="dot"></span>
      <span>${escapeHtml(item)}</span>
      <span class="soon">Soon</span>
    </div>
  `).join('');
}

function init() {
  renderRoadmap();
  els.styleNote.textContent = STYLE_NOTES[state.style];
  updateRunState();

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  ['dragover', 'drop'].forEach((evt) =>
    window.addEventListener(evt, (e) => e.preventDefault())
  );

  els.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  els.clearFile.addEventListener('click', clearFile);

  els.dropzone.addEventListener('click', () => els.fileInput.click());

  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('dragover');
    })
  );
  els.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  els.styleSelect.addEventListener('change', (e) => {
    state.style = e.target.value;
    els.styleNote.textContent = STYLE_NOTES[state.style] || '';
    if (state.corrections.length) {
      renderResults();
    }
  });

  els.runBtn.addEventListener('click', runProofread);
  els.applySafeBtn.addEventListener('click', applyAllSafeFixes);
  els.exportFinalBtn.addEventListener('click', exportFinalTranscript);

  els.cardsList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('.correction-card');
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;
    if (action === 'accept') setStatus(id, 'accepted');
    else if (action === 'reject') setStatus(id, 'rejected');
    else if (action === 'edit') openEdit(id);
  });

  els.editCancel.addEventListener('click', closeEdit);
  els.editSave.addEventListener('click', saveEdit);
  els.editModal.addEventListener('click', (e) => {
    if (e.target === els.editModal) closeEdit();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.editModal.classList.contains('hidden')) closeEdit();
  });
}

document.addEventListener('DOMContentLoaded', init);
