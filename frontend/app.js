const runtimeConfig = window.RECEIPTIQ_CONFIG || {};
const API_ROOT = normalizeApiRoot(runtimeConfig.apiBaseUrl || '/api');
const API_KEY = runtimeConfig.apiKey || '';
const TOKEN_KEY = 'receiptiq.auth.token';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;
const ALLOWED_TYPES = ['application/pdf','image/jpeg','image/png','image/webp'];

const state = { token: localStorage.getItem(TOKEN_KEY)||'', user: null, selectedFile: null, receipts: [], currentDocId: null, progressStep: -1, categoryChart: null, monthlyChart: null };

const PROGRESS_STEPS = [
  { id:'sc1', label:'Uploading your file to the API workspace', progress:14 },
  { id:'sc2', label:'Validating the authenticated request', progress:28 },
  { id:'sc3', label:'Saving the file into your user bucket path', progress:44 },
  { id:'sc4', label:'Lambda picked up the receipt', progress:62 },
  { id:'sc5', label:'Extracting structured receipt details', progress:79 },
  { id:'sc6', label:'Writing the result into your history', progress:92 },
  { id:'sc7', label:'Finalizing notification state', progress:100 }
];

const $ = id => document.getElementById(id);
const authShell=$('authShell'), workspaceShell=$('workspaceShell'), loginTab=$('loginTab'), signupTab=$('signupTab');
const loginForm=$('loginForm'), signupForm=$('signupForm'), authNote=$('authNote');
const loginSubmit=$('loginSubmit'), signupSubmit=$('signupSubmit'), logoutBtn=$('logoutBtn');
const dropZone=$('dropZone'), fileInput=$('fileInput'), chooseFileBtn=$('chooseFileBtn');
const filePreview=$('filePreview'), fileName=$('fileName'), clearFileBtn=$('clearFileBtn');
const categoryInput=$('categoryInput'), submitBtn=$('submitBtn'), submitText=$('submitText'), submitSpinner=$('submitSpinner');
const progressCard=$('progressCard'), progressTitle=$('progressTitle'), progressSubtitle=$('progressSubtitle');
const progressPct=$('progressPct'), progressBar=$('progressBar');
const resultCard=$('resultCard'), resultBadge=$('resultBadge'), resultTitle=$('resultTitle'), resultSubtitle=$('resultSubtitle'), processAnotherBtn=$('processAnotherBtn');
const userName=$('userName'), userEmail=$('userEmail'), notificationStatus=$('notificationStatus');
const incomingCount=$('incomingCount'), processingCount=$('processingCount'), completedCount=$('completedCount');
const latestReceiptPill=$('latestReceiptPill'), latestDocId=$('latestDocId'), latestMerchant=$('latestMerchant');
const latestDate=$('latestDate'), latestTotal=$('latestTotal'), latestCategory=$('latestCategory'), latestStatus=$('latestStatus');
const latestProducts=$('latestProducts'), latestProductTags=$('latestProductTags');
const historyEmpty=$('historyEmpty'), historyList=$('historyList');
const detailModal=$('detailModal'), detailBackdrop=$('detailBackdrop'), detailClose=$('detailClose');
const detailMerchant=$('detailMerchant'), detailSubtitle=$('detailSubtitle'), detailDocId=$('detailDocId');
const detailDate=$('detailDate'), detailTotal=$('detailTotal'), detailSubtotal=$('detailSubtotal');
const detailTax=$('detailTax'), detailCategory=$('detailCategory'), detailStatus=$('detailStatus');
const detailInvoiceId=$('detailInvoiceId'), detailNotification=$('detailNotification');
const detailLineItems=$('detailLineItems'), detailLineItemCount=$('detailLineItemCount');
const detailDownload=$('detailDownload'), detailDelete=$('detailDelete');

const apiClient = axios.create({ baseURL: API_ROOT, headers: API_KEY ? { 'x-api-key': API_KEY } : {} });
apiClient.interceptors.request.use(config => { if(state.token){ config.headers = config.headers||{}; config.headers.Authorization = `Bearer ${state.token}`; } return config; });

document.addEventListener('DOMContentLoaded', () => { bindAuthUi(); bindWorkspaceUi(); bindDetailUi(); bootstrap(); });

async function bootstrap() {
  setAuthMode('login');
  if (!state.token) { showAuthShell(); return; }
  try {
    const { data } = await apiClient.get('/auth/me');
    completeLogin(data.user, { silent:true, notification:data.notification, message:`Welcome back, ${data.user.name.split(' ')[0]}.` });
  } catch(e) { clearSession(); showAuthShell(); }
}

function bindAuthUi() {
  loginTab.addEventListener('click', () => setAuthMode('login'));
  signupTab.addEventListener('click', () => setAuthMode('signup'));
  loginForm.addEventListener('submit', async e => { e.preventDefault(); await login(); });
  signupForm.addEventListener('submit', async e => { e.preventDefault(); await signup(); });
  logoutBtn.addEventListener('click', () => { clearSession(); resetReceiptComposer(); renderDashboard([]); showAuthShell(); showToast('You have been logged out.','info'); });
}

function bindWorkspaceUi() {
  chooseFileBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if(e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', e => { if(e.target.files[0]) handleFileSelect(e.target.files[0]); });
  clearFileBtn.addEventListener('click', () => clearFile());
  submitBtn.addEventListener('click', async () => await submitReceipt());
  processAnotherBtn.addEventListener('click', () => { resetReceiptComposer(); resultCard.classList.add('hidden'); });
}

function bindDetailUi() {
  const close = () => detailModal.classList.remove('is-open');
  detailBackdrop.addEventListener('click', close);
  detailClose.addEventListener('click', close);
  document.addEventListener('keydown', e => { if(e.key==='Escape') close(); });
  detailDownload.addEventListener('click', () => downloadReceipt(detailDocId.textContent));
  detailDelete.addEventListener('click', () => deleteReceipt(detailDocId.textContent));
}

async function signup() {
  const name=$('signupName').value.trim(), email=$('signupEmail').value.trim(), password=$('signupPassword').value;
  if(name.length<2){ showToast('Please enter your full name.','error'); return; }
  if(!isValidEmail(email)){ showToast('Please enter a valid email address.','error'); return; }
  if(password.length<8){ showToast('Password must be at least 8 characters long.','error'); return; }
  setButtonLoading(signupSubmit, true);
  try {
    const { data } = await apiClient.post('/auth/signup', { name, email, password });
    completeLogin(data.user, { token:data.token, notification:data.notification, message:'Account created. Your personal receipt workspace is ready.' });
    signupForm.reset();
  } catch(e) { showToast(normalizeApiError(e,'Could not create your account.'),'error'); }
  finally { setButtonLoading(signupSubmit, false); }
}

async function login() {
  const email=$('loginEmail').value.trim(), password=$('loginPassword').value;
  if(!isValidEmail(email)){ showToast('Please enter a valid email address.','error'); return; }
  if(!password){ showToast('Please enter your password.','error'); return; }
  setButtonLoading(loginSubmit, true);
  try {
    const { data } = await apiClient.post('/auth/login', { email, password });
    completeLogin(data.user, { token:data.token, message:`Welcome back, ${data.user.name.split(' ')[0]}.` });
    loginForm.reset();
  } catch(e) { showToast(normalizeApiError(e,'Could not log you in.'),'error'); }
  finally { setButtonLoading(loginSubmit, false); }
}

function completeLogin(user, opts={}) {
  state.user = user;
  if(opts.token){ state.token=opts.token; localStorage.setItem(TOKEN_KEY, opts.token); }
  renderUser(); showWorkspaceShell(); updateNotificationUi(opts.notification); loadReceipts();
  if(!opts.silent && opts.message) showToast(opts.message,'success');
}

function clearSession() { state.token=''; state.user=null; localStorage.removeItem(TOKEN_KEY); }

async function loadReceipts() {
  try {
    const { data } = await apiClient.get('/receipts', { params:{limit:50} });
    const items = Array.isArray(data.items)?data.items:[];
    state.receipts = items;
    renderDashboard(items);
  } catch(e) { showToast(normalizeApiError(e,'Could not load your receipt history.'),'error'); }
}

async function submitReceipt() {
  if(!state.user){ showToast('Please log in before uploading a receipt.','error'); return; }
  if(!state.selectedFile){ showToast('Choose a receipt file first.','error'); return; }
  setSubmitting(true); startProgress();
  const formData = new FormData();
  formData.append('file', state.selectedFile);
  formData.append('category', categoryInput.value || 'auto');
  try {
    const { data } = await apiClient.post('/receipts/upload', formData);
    state.currentDocId = data.docId;
    setProgressStep(2,'Receipt uploaded successfully','The file is now in your secure user path and the processing job is underway.');
    const receipt = await pollForReceipt(data.docId);
    if(receipt.status==='failed'){ showReceiptFailure(receipt); return; }
    showReceiptSuccess(receipt); await loadReceipts();
  } catch(e) {
    if(e.response?.status===409 && e.response?.data?.duplicate){
      showToast(`Duplicate detected — this receipt was already uploaded (${e.response.data.existingDocId}).`,'error');
      resetProgress();
    } else {
      showToast(normalizeApiError(e,'Receipt upload failed.'),'error'); resetProgress();
    }
  } finally { setSubmitting(false); }
}

async function pollForReceipt(docId) {
  for(let attempt=0; attempt<MAX_POLL_ATTEMPTS; attempt++){
    if(attempt>0) await wait(POLL_INTERVAL_MS);
    const { data } = await apiClient.get(`/receipts/${encodeURIComponent(docId)}`);
    syncProgressWithReceipt(data, attempt);
    if(data.status==='processed'||data.status==='failed') return data;
  }
  throw new Error('Processing is still running. Check your history panel again in a moment.');
}

function syncProgressWithReceipt(receipt, attempt) {
  if(receipt.status==='failed'){ setProgressStep(5,'Processing stopped',receipt.errorMessage||'The file could not be completed successfully.'); return; }
  if(receipt.status==='processed'){ setProgressStep(6,'Receipt processed successfully','Your history has been updated with the extracted result.'); return; }
  const step = Math.min(3+attempt,5);
  const descs = ['Lambda accepted the file and is starting the document pass.','The processor is pulling structured text and table data.','The extracted values are being written into your receipt history.'];
  setProgressStep(step,'Processing your receipt',descs[Math.min(attempt,descs.length-1)]);
}

function handleFileSelect(file) {
  if(!ALLOWED_TYPES.includes(file.type)){ showToast('Only PDF and image files (JPG, PNG, WebP) are allowed.','error'); return; }
  if(file.size>10*1024*1024){ showToast('File size must stay under 10 MB.','error'); return; }
  state.selectedFile = file;
  fileName.textContent = file.name;
  filePreview.classList.remove('hidden');
}

function clearFile() { state.selectedFile=null; fileInput.value=''; filePreview.classList.add('hidden'); }
function resetReceiptComposer() { clearFile(); categoryInput.value=''; state.currentDocId=null; resetProgress(); }

function startProgress() { resultCard.classList.add('hidden'); progressCard.classList.remove('hidden'); state.progressStep=-1; progressBar.style.width='0%'; setProgressStep(0,'Starting your receipt flow','We are moving the file from your account workspace into the backend pipeline.'); }
function resetProgress() { progressCard.classList.add('hidden'); progressBar.style.width='0%'; progressPct.textContent='0%'; state.progressStep=-1; PROGRESS_STEPS.forEach(s=>$(s.id).classList.remove('active','done')); }

function setProgressStep(index, title, subtitle) {
  if(index<state.progressStep) return;
  state.progressStep=index; progressTitle.textContent=title; progressSubtitle.textContent=subtitle;
  progressPct.textContent=`${PROGRESS_STEPS[index].progress}%`; progressBar.style.width=`${PROGRESS_STEPS[index].progress}%`;
  PROGRESS_STEPS.forEach((s,i)=>{ const el=$(s.id); el.classList.remove('active','done'); if(i<index) el.classList.add('done'); else if(i===index) el.classList.add('active'); });
}

function showReceiptSuccess(receipt) {
  setProgressStep(6,'Receipt processed successfully','Your account history now includes the latest extracted result.');
  resultBadge.textContent='✓'; resultTitle.textContent='Receipt processed';
  resultSubtitle.textContent=describeEmailStatus(receipt.emailDeliveryStatus);
  $('resMerchant').textContent=formatMerchant(receipt); $('resDate').textContent=receipt.date||'—';
  $('resTotal').textContent=receipt.total||'—'; $('resCategory').textContent=formatCategory(receipt.category);
  resultCard.classList.remove('hidden'); processAnotherBtn.focus();
  showToast('Receipt processed and added to your workspace.','success');
}

function showReceiptFailure(receipt) {
  setProgressStep(5,'Receipt processing failed',receipt.errorMessage||'The processor could not complete this file.');
  resultBadge.textContent='!'; resultTitle.textContent='Receipt failed';
  resultSubtitle.textContent=receipt.errorMessage||'Try another file or inspect the processor logs later.';
  $('resMerchant').textContent=formatMerchant(receipt)||'Unavailable'; $('resDate').textContent=receipt.date||'Unavailable';
  $('resTotal').textContent=receipt.total||'Unavailable'; $('resCategory').textContent=formatCategory(receipt.category);
  resultCard.classList.remove('hidden'); showToast(resultSubtitle.textContent,'error');
}

function renderUser() { if(!state.user) return; userName.textContent=state.user.name; userEmail.textContent=state.user.email; updateNotificationUi(); }

function updateNotificationUi(notification) {
  const status = notification?.status || state.user?.notificationStatus || 'pending_verification';
  const statusText = { pending_verification:'Notification verification pending', verified:'Notifications verified', disabled:'Notifications disabled' }[status]||'Notification setup pending';
  notificationStatus.textContent = statusText;
  authNote.textContent = notification?.message || 'Email notifications will use your account address after the AWS notification step is connected.';
}

function renderDashboard(items) {
  const total=items.length, processing=items.filter(i=>i.status==='processing').length, completed=items.filter(i=>i.status==='processed').length;
  const latest = items[0]||null;
  incomingCount.textContent=String(total); processingCount.textContent=String(processing); completedCount.textContent=String(completed);

  if(!latest){
    latestReceiptPill.textContent='No data yet'; latestDocId.textContent='No records yet';
    latestMerchant.textContent='—'; latestDate.textContent='—'; latestTotal.textContent='—';
    latestCategory.textContent='—'; latestStatus.textContent='—';
    latestProducts.classList.add('hidden');
  } else {
    latestReceiptPill.textContent=prettifyStatus(latest.status); latestDocId.textContent=latest.docId;
    latestMerchant.textContent=formatMerchant(latest); latestDate.textContent=latest.date||'—';
    latestTotal.textContent=latest.total||'—'; latestCategory.textContent=formatCategory(latest.category);
    latestStatus.textContent=prettifyStatus(latest.status);
    renderProductTags(latestProductTags, latest.lineItems, 4);
    latestProducts.classList.toggle('hidden', !(latest.lineItems&&latest.lineItems.length));
  }
  renderHistory(items);
  renderAnalytics(items);
}

function renderProductTags(container, lineItems, max) {
  container.innerHTML = '';
  const items = (lineItems||[]).slice(0, max);
  items.forEach(item => {
    const tag = document.createElement('span');
    tag.className = 'product-tag';
    tag.textContent = compactText(item.name||'Item', 30);
    container.appendChild(tag);
  });
  if((lineItems||[]).length > max) {
    const more = document.createElement('span');
    more.className = 'product-tag product-tag-more';
    more.textContent = `+${lineItems.length - max} more`;
    container.appendChild(more);
  }
}

function renderHistory(items) {
  historyList.innerHTML = '';
  if(!items.length){ historyEmpty.classList.remove('hidden'); return; }
  historyEmpty.classList.add('hidden');
  items.forEach(item => {
    const article = document.createElement('article');
    article.className = 'history-item';
    article.setAttribute('role','button');
    article.setAttribute('tabindex','0');
    const productNames = (item.lineItems||[]).slice(0,3).map(li=>escapeHtml(compactText(li.name||'',24))).filter(Boolean).join(', ');
    article.innerHTML = `
      <div class="history-main">
        <strong>${escapeHtml(formatMerchant(item))}</strong>
        ${productNames ? `<div class="history-products">${productNames}</div>` : ''}
        <div class="history-meta">
          <span>${escapeHtml(item.docId||'Unknown ID')}</span>
          <span>${escapeHtml(item.date||'No date')}</span>
          <span>${escapeHtml(formatCategory(item.category))}</span>
        </div>
      </div>
      <div class="history-side">
        <strong>${escapeHtml(item.total||'—')}</strong>
        <span class="status-pill">${escapeHtml(prettifyStatus(item.status))}</span>
      </div>
    `;
    article.addEventListener('click', () => openReceiptDetail(item.docId));
    article.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openReceiptDetail(item.docId); } });
    historyList.appendChild(article);
  });
}

// ── Analytics ──────────────────────────────────────────────
function renderAnalytics(items) {
  const processed = items.filter(i => i.status === 'processed');
  renderCategoryChart(processed);
  renderMonthlyChart(processed);
}

function renderCategoryChart(items) {
  const catTotals = {};
  const COLORS = { food:'#ef4444', travel:'#3b82f6', utilities:'#eab308', shopping:'#8b5cf6', medical:'#06b6d4', entertainment:'#f97316', education:'#10b981', other:'#6b7280' };
  items.forEach(item => {
    const cat = (item.category||'other').toLowerCase();
    const val = extractNumericFromDisplay(item.total);
    catTotals[cat] = (catTotals[cat]||0) + val;
  });
  const labels = Object.keys(catTotals).map(c => c.charAt(0).toUpperCase()+c.slice(1));
  const data = Object.values(catTotals);
  const colors = Object.keys(catTotals).map(c => COLORS[c]||'#6b7280');

  const canvas = $('categoryChart');
  if(state.categoryChart) state.categoryChart.destroy();
  if(!data.length) return;
  state.categoryChart = new Chart(canvas, {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ padding:12, usePointStyle:true, font:{family:'Outfit',size:12} } } } }
  });
}

function renderMonthlyChart(items) {
  const monthTotals = {};
  items.forEach(item => {
    const d = item.date||item.createdAt||'';
    const m = d.slice(0,7); // YYYY-MM
    if(!m||m.length<7) return;
    monthTotals[m] = (monthTotals[m]||0) + extractNumericFromDisplay(item.total);
  });
  const sorted = Object.entries(monthTotals).sort((a,b)=>a[0].localeCompare(b[0])).slice(-6);
  const labels = sorted.map(([m])=>{ const [y,mo]=m.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1]} ${y.slice(2)}`; });
  const data = sorted.map(([,v])=>v);

  const canvas = $('monthlyChart');
  if(state.monthlyChart) state.monthlyChart.destroy();
  if(!data.length) return;
  state.monthlyChart = new Chart(canvas, {
    type:'bar',
    data:{ labels, datasets:[{ label:'Spending', data, backgroundColor:'rgba(49,87,255,0.7)', borderRadius:6, borderSkipped:false }] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true, ticks:{font:{family:'Outfit'}} }, x:{ ticks:{font:{family:'Outfit'}} } }, plugins:{ legend:{display:false} } }
  });
}

function extractNumericFromDisplay(val) {
  if(!val||val==='—') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g,''));
  return isFinite(n)?n:0;
}

// ── Receipt detail + actions ──────────────────────────────
async function openReceiptDetail(docId) {
  if(!docId) return;
  detailModal.classList.add('is-open');
  detailMerchant.textContent='Loading...'; detailSubtitle.textContent='';
  detailLineItems.innerHTML=''; detailLineItemCount.textContent='0';
  try {
    const { data } = await apiClient.get(`/receipts/${docId}`);
    const receipt = data.receipt||data||{};
    renderReceiptDetail(receipt);
  } catch(e) { detailMerchant.textContent='Error loading receipt'; detailSubtitle.textContent=normalizeApiError(e,'Could not load this receipt.'); }
}

function renderReceiptDetail(receipt) {
  detailMerchant.textContent = formatMerchant(receipt)||'Receipt';
  detailSubtitle.textContent = receipt.originalName||'';
  detailDocId.textContent = receipt.docId||'—';
  detailDate.textContent = receipt.date||'—';
  detailTotal.textContent = receipt.total||'—';
  detailSubtotal.textContent = receipt.subtotal||'—';
  detailTax.textContent = receipt.tax||'—';
  detailCategory.textContent = formatCategory(receipt.category);
  detailStatus.textContent = prettifyStatus(receipt.status);
  detailInvoiceId.textContent = receipt.invoiceId||'—';
  const emailStatus = receipt.emailDeliveryStatus||receipt.notificationStatus||'pending';
  detailNotification.textContent = describeEmailStatus(emailStatus);
  detailLineItems.innerHTML = '';
  const items = receipt.lineItems||[];
  detailLineItemCount.textContent = String(items.length);
  if(!items.length){ const empty=document.createElement('div'); empty.textContent='No line items detected.'; empty.style.color='#6b7280'; detailLineItems.appendChild(empty); return; }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'line-item';
    row.innerHTML = `<span>${escapeHtml(item.name||'Item')}</span><span>${item.quantity!=null?escapeHtml(String(item.quantity)):'—'}</span><span>${item.unitPrice?.display||item.unitPrice||'—'}</span><span>${item.totalPrice?.display||item.totalPrice||'—'}</span>`;
    detailLineItems.appendChild(row);
  });
}

async function downloadReceipt(docId) {
  if(!docId||docId==='—') return;
  try {
    const { data } = await apiClient.get(`/receipts/${docId}/download`);
    if(data.url) window.open(data.url, '_blank');
  } catch(e) { showToast(normalizeApiError(e,'Could not get download link.'),'error'); }
}

async function deleteReceipt(docId) {
  if(!docId||docId==='—') return;
  if(!confirm('Are you sure you want to delete this receipt? This cannot be undone.')) return;
  try {
    await apiClient.delete(`/receipts/${docId}`);
    detailModal.classList.remove('is-open');
    showToast('Receipt deleted.','success');
    await loadReceipts();
  } catch(e) { showToast(normalizeApiError(e,'Could not delete the receipt.'),'error'); }
}

// ── UI helpers ─────────────────────────────────────────────
function setAuthMode(mode) { const l=mode==='login'; loginTab.classList.toggle('is-active',l); signupTab.classList.toggle('is-active',!l); loginForm.classList.toggle('hidden',!l); signupForm.classList.toggle('hidden',l); }
function showAuthShell() { authShell.classList.remove('hidden'); workspaceShell.classList.add('hidden'); }
function showWorkspaceShell() { authShell.classList.add('hidden'); workspaceShell.classList.remove('hidden'); }
function setSubmitting(v) { submitBtn.disabled=v; submitText.classList.toggle('hidden',v); submitSpinner.classList.toggle('hidden',!v); }
function setButtonLoading(btn,v) { btn.disabled=v; const o=btn.dataset.label||btn.textContent; btn.dataset.label=o; btn.textContent=v?'Please wait...':o; }
function describeEmailStatus(s) { return { sent:'The receipt is processed and the notification email has been sent.', failed:'The receipt is processed, but notification delivery still needs one more AWS fix.', skipped:'The receipt is processed. Email delivery will start once notifications are configured.', pending:'The receipt is processed. Notification verification is still pending.' }[s]||'The receipt result is ready in your workspace.'; }
function prettifyStatus(s) { return { processing:'Processing', processed:'Processed', failed:'Failed' }[s]||'Unknown'; }
function formatCategory(v) { if(!v) return 'Auto'; return String(v).replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function formatMerchant(r) { const m=compactText(r?.merchant,56); if(m&&m!=='Unknown') return m; return compactText(r?.originalName,56)||'Receipt'; }
function compactText(v,max=60) { if(v==null) return ''; const t=String(v).replace(/\s+/g,' ').trim(); if(!t) return ''; return t.length<=max?t:`${t.slice(0,max).trimEnd()}...`; }
function normalizeApiError(e,f) { return e.response?.data?.error||e.response?.data?.message||e.message||f; }
function normalizeApiRoot(b) { const t=String(b||'').replace(/\/+$/,''); return t.endsWith('/api')?t:`${t}/api`; }
function wait(ms) { return new Promise(r=>setTimeout(r,ms)); }
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function showToast(msg,type='info') { const t=document.createElement('div'); t.className=`app-toast app-toast-${type}`; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.classList.add('is-visible'),20); setTimeout(()=>{ t.classList.remove('is-visible'); setTimeout(()=>t.remove(),220); },3200); }
function escapeHtml(v) { return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
