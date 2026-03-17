/* =========================================================
   ReceiptIQ — Frontend JavaScript
   Handles upload, progress, API calls, dashboard
   ========================================================= */

// ╔══════════════════════════════════════════════════════════╗
// ║  🔧 CLOUD CONFIG — FILL IN THESE VALUES                 ║
// ╚══════════════════════════════════════════════════════════╝

// ⚠️  HIGHLIGHT: Replace with your deployed backend URL
const API_BASE_URL = "https://YOUR_API_GATEWAY_URL.execute-api.us-east-1.amazonaws.com/prod";

// ⚠️  HIGHLIGHT: Your API key (if using API Gateway API Key auth)
const API_KEY = "YOUR_API_GATEWAY_API_KEY";

// =========================================================

let selectedFile = null;

// ── DRAG & DROP SETUP ─────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) {
    showToast('Please upload a JPG, PNG, WEBP, or PDF file.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File must be under 10 MB.', 'error');
    return;
  }
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('filePreview').style.display = 'block';
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  document.getElementById('filePreview').style.display = 'none';
}

// ── SUBMIT RECEIPT ────────────────────────────────────────
async function submitReceipt() {
  const email = document.getElementById('emailInput').value.trim();
  const category = document.getElementById('categoryInput').value;

  if (!selectedFile) {
    showToast('Please select a receipt file.', 'error');
    return;
  }
  if (!email || !isValidEmail(email)) {
    showToast('Please enter a valid email address.', 'error');
    return;
  }

  setSubmitting(true);

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('email', email);
  formData.append('category', category || 'auto');

  showProgressCard();

  try {
    const response = await fetch(`${API_BASE_URL}/receipts/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Server error: ${response.status}`);
    }

    const data = await response.json();
    finishProgress();
    showResult(data, email);

  } catch (error) {
    console.error('Upload error:', error);
    hideProgressCard();
    // In demo mode, simulate a successful result
    if (API_BASE_URL.includes('YOUR_API_GATEWAY_URL')) {
      simulateDemo(email);
    } else {
      showToast(error.message || 'Upload failed. Please try again.', 'error');
      setSubmitting(false);
    }
  }
}

// ── DEMO SIMULATION (until backend is deployed) ───────────
function simulateDemo(email) {
  showProgressCard();
  const steps = ['step-upload','step-ocr','step-classify','step-store','step-email'];
  const percentages = [20, 40, 65, 85, 100];
  let i = 0;

  const interval = setInterval(() => {
    if (i > 0) {
      document.getElementById(steps[i-1]).querySelector('.step-dot').className = 'step-dot done';
      document.getElementById(steps[i-1]).classList.add('done');
    }
    if (i < steps.length) {
      document.getElementById(steps[i]).querySelector('.step-dot').className = 'step-dot active';
      document.getElementById('progressBar').style.width = percentages[i] + '%';
      i++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        finishProgress();
        showResult({
          merchant: 'Starbucks Coffee',
          date: new Date().toISOString().split('T')[0],
          total: '$12.50',
          tax: '$1.10',
          category: '🍕 Food & Dining',
          confidence: '97.3%',
          docId: 'DEMO-' + Math.random().toString(36).substr(2, 8).toUpperCase()
        }, email);
      }, 500);
    }
  }, 900);
}

// ── PROGRESS CARD ─────────────────────────────────────────
function showProgressCard() {
  document.getElementById('progressCard').style.display = 'block';
  document.getElementById('resultCard').style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.querySelectorAll('.step-dot').forEach(d => d.className = 'step-dot');
  document.getElementById('steps-track') && document.querySelectorAll('.step-item').forEach(s => s.classList.remove('done'));
  // Activate first step
  document.getElementById('step-upload').querySelector('.step-dot').className = 'step-dot active';
  document.getElementById('progressBar').style.width = '10%';
}

function hideProgressCard() {
  document.getElementById('progressCard').style.display = 'none';
}

function finishProgress() {
  document.getElementById('progressBar').style.width = '100%';
  document.querySelectorAll('.step-dot').forEach(d => d.className = 'step-dot done');
  setSubmitting(false);
}

// ── RESULT CARD ───────────────────────────────────────────
function showResult(data, email) {
  setTimeout(() => {
    document.getElementById('progressCard').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resMerchant').textContent  = data.merchant || '—';
    document.getElementById('resDate').textContent      = data.date     || '—';
    document.getElementById('resTotal').textContent     = data.total    || '—';
    document.getElementById('resCategory').textContent  = data.category || '—';
    document.getElementById('resTax').textContent       = data.tax      || '—';
    document.getElementById('resConfidence').textContent= data.confidence || '—';
    document.getElementById('resEmail').textContent     = email;
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 600);
}

function resetForm() {
  clearFile();
  document.getElementById('emailInput').value = '';
  document.getElementById('categoryInput').value = '';
  document.getElementById('resultCard').style.display = 'none';
  document.getElementById('progressCard').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── HELPERS ───────────────────────────────────────────────
function setSubmitting(loading) {
  const btn = document.getElementById('submitBtn');
  const txt = document.getElementById('submitText');
  const spn = document.getElementById('submitSpinner');
  btn.disabled = loading;
  txt.style.display = loading ? 'none' : 'inline';
  spn.style.display = loading ? 'inline-block' : 'none';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: ${type === 'error' ? '#E8553A' : '#2BBFA5'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    animation: slideIn .3s ease; max-width: 360px;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── DASHBOARD: Load receipts from API ─────────────────────
async function loadDashboard() {
  try {
    const resp = await fetch(`${API_BASE_URL}/receipts`, {
      headers: { 'x-api-key': API_KEY }
    });
    if (!resp.ok) return; // Fall through to static demo data
    const data = await resp.json();
    if (data.items && data.items.length > 0) {
      renderTable(data.items);
    }
  } catch {
    // Backend not deployed yet — static demo data shown in HTML
  }
}

function renderTable(items) {
  const tbody = document.getElementById('receiptTableBody');
  tbody.innerHTML = items.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.merchant)}</strong></td>
      <td>${escapeHtml(r.date)}</td>
      <td><span class="badge badge-${r.category.toLowerCase()}">${escapeHtml(r.category)}</span></td>
      <td>${escapeHtml(r.total)}</td>
      <td>${escapeHtml(r.confidence)}</td>
      <td><span class="badge badge-done">Done</span></td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
