const DEFAULT_API_BASE_URL = 'https://YOUR_API_GATEWAY_URL.execute-api.us-east-1.amazonaws.com/prod';
const DEFAULT_API_KEY = 'YOUR_API_GATEWAY_API_KEY';

const runtimeConfig = window.RECEIPTIQ_CONFIG || {};
const API_BASE_URL = runtimeConfig.apiBaseUrl || DEFAULT_API_BASE_URL;
const API_KEY = runtimeConfig.apiKey || DEFAULT_API_KEY;
const DEMO_MODE = API_BASE_URL.includes('YOUR_API_GATEWAY_URL');
const API_ROOT = normalizeApiRoot(API_BASE_URL);

const PROGRESS_STEPS = [
  { circleId: 'sc1', fillId: null, progress: 12 },
  { circleId: 'sc2', fillId: 'cf1', progress: 26 },
  { circleId: 'sc3', fillId: 'cf2', progress: 40 },
  { circleId: 'sc4', fillId: 'cf3', progress: 55 },
  { circleId: 'sc5', fillId: 'cf4', progress: 72 },
  { circleId: 'sc6', fillId: 'cf5', progress: 88 },
  { circleId: 'sc7', fillId: 'cf6', progress: 100 }
];

let selectedFile = null;
let demoIntervalId = null;
let currentScreen = 'landing';

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) {
    handleFileSelect(file);
  }
});

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    handleFileSelect(file);
  }
});

function handleFileSelect(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  if (!allowedTypes.includes(file.type)) {
    showToast('Please upload a JPG, PNG, WEBP, or PDF file.', 'error');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('File must be under 10 MB.', 'error');
    return;
  }

  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('filePreview').style.display = 'flex';
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  document.getElementById('filePreview').style.display = 'none';
}

async function submitReceipt() {
  const email = document.getElementById('emailInput').value.trim();
  const category = document.getElementById('categoryInput').value || 'Auto-detect later';

  if (!selectedFile) {
    showToast('Please select a receipt file.', 'error');
    return;
  }

  if (!email || !isValidEmail(email)) {
    showToast('Please enter a valid email address.', 'error');
    return;
  }

  setSubmitting(true);
  showProgressCard();

  if (DEMO_MODE) {
    simulateDemo(email, category);
    return;
  }

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('email', email);
  formData.append('category', category);

  try {
    const response = await fetch(buildApiUrl('/receipts/upload'), {
      method: 'POST',
      headers: buildApiHeaders(),
      body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || `Server error: ${response.status}`);
    }

    markAllStepsDone();
    showResult({
      merchant: data.merchant || 'Receipt uploaded',
      date: data.date || 'Pending OCR',
      total: data.total || 'Pending extraction',
      category: data.category || category
    }, email);
  } catch (error) {
    console.error('Upload error:', error);
    hideProgressCard();
    showToast(error.message || 'Upload failed. Please try again.', 'error');
    setSubmitting(false);
  }
}

function simulateDemo(email, category) {
  let currentStep = 0;

  demoIntervalId = window.setInterval(() => {
    activateStep(currentStep);
    currentStep += 1;

    if (currentStep === PROGRESS_STEPS.length) {
      window.clearInterval(demoIntervalId);
      demoIntervalId = null;

      window.setTimeout(() => {
        markAllStepsDone();
        showResult({
          merchant: 'Waiting for AWS extraction',
          date: 'Will be filled by Textract',
          total: 'Will be filled by Lambda',
          category
        }, email);
        showToast('Preview complete. The live version starts once AWS resources are connected.', 'info');
      }, 400);
    }
  }, 650);
}

function showProgressCard() {
  clearDemoInterval();
  document.getElementById('progressCard').style.display = 'block';
  document.getElementById('resultCard').style.display = 'none';
  updateProgress(0);

  PROGRESS_STEPS.forEach(({ circleId, fillId }) => {
    const circle = document.getElementById(circleId);
    circle.classList.remove('active', 'done');
    if (fillId) {
      document.getElementById(fillId).style.width = '0';
    }
  });

  document.getElementById(PROGRESS_STEPS[0].circleId).classList.add('active');
}

function hideProgressCard() {
  clearDemoInterval();
  document.getElementById('progressCard').style.display = 'none';
}

function clearDemoInterval() {
  if (demoIntervalId) {
    window.clearInterval(demoIntervalId);
    demoIntervalId = null;
  }
}

function activateStep(stepIndex) {
  PROGRESS_STEPS.forEach(({ circleId, fillId }, index) => {
    const circle = document.getElementById(circleId);

    circle.classList.remove('active');

    if (index < stepIndex) {
      circle.classList.add('done');
      if (fillId) {
        document.getElementById(fillId).style.width = '100%';
      }
      return;
    }

    if (index === stepIndex) {
      circle.classList.remove('done');
      circle.classList.add('active');
      if (fillId) {
        document.getElementById(fillId).style.width = '100%';
      }
      updateProgress(PROGRESS_STEPS[index].progress);
      return;
    }

    circle.classList.remove('done');
    if (fillId) {
      document.getElementById(fillId).style.width = '0';
    }
  });
}

function markAllStepsDone() {
  PROGRESS_STEPS.forEach(({ circleId, fillId }) => {
    const circle = document.getElementById(circleId);
    circle.classList.remove('active');
    circle.classList.add('done');
    if (fillId) {
      document.getElementById(fillId).style.width = '100%';
    }
  });

  updateProgress(100);
  setSubmitting(false);
}

function updateProgress(percent) {
  document.getElementById('progressBar').style.width = `${percent}%`;
  document.getElementById('progressPct').textContent = `${percent}%`;
}

function showResult(data, email) {
  window.setTimeout(() => {
    document.getElementById('progressCard').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resMerchant').textContent = data.merchant || 'Pending';
    document.getElementById('resDate').textContent = data.date || 'Pending';
    document.getElementById('resTotal').textContent = data.total || 'Pending';
    document.getElementById('resCategory').textContent = data.category || 'Pending';
    document.getElementById('resEmail').textContent = email;
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);
}

function resetForm() {
  clearFile();
  document.getElementById('emailInput').value = '';
  document.getElementById('categoryInput').value = '';
  document.getElementById('progressCard').style.display = 'none';
  document.getElementById('resultCard').style.display = 'none';
}

function setSubmitting(loading) {
  const button = document.getElementById('submitBtn');
  const text = document.getElementById('submitText');
  const spinner = document.getElementById('submitSpinner');

  button.disabled = loading;
  text.style.display = loading ? 'none' : 'inline';
  spinner.style.display = loading ? 'inline-block' : 'none';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 9999;
    max-width: 360px;
    padding: 14px 16px;
    border-radius: 16px;
    background: ${type === 'error' ? '#b54141' : '#0d6f66'};
    color: #fff;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.18);
    font: 600 14px ${JSON.stringify(getComputedStyle(document.body).fontFamily)};
  `;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function buildApiUrl(pathname) {
  return `${API_ROOT}${pathname}`;
}

function buildApiHeaders() {
  return API_KEY && API_KEY !== DEFAULT_API_KEY
    ? { 'x-api-key': API_KEY }
    : {};
}

function normalizeApiRoot(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) {
    return '/api';
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function initializeExperience() {
  document.body.classList.add('screen-app');
  initializeScreenNavigation();
  applyExperienceMode();
  bindPlaceholderActions();
}

function applyExperienceMode() {
  const bannerPill = document.getElementById('setupPill');
  const bannerCopy = document.getElementById('setupCopy');
  const demoNote = document.getElementById('demoNote');
  const submitText = document.getElementById('submitText');

  if (DEMO_MODE) {
    bannerPill.textContent = 'Preview Mode';
    bannerCopy.textContent = 'The interface is complete to explore. AWS resources are the only remaining step before real upload, storage, OCR, and email delivery are live.';
    demoNote.style.display = 'block';
    submitText.textContent = 'Preview Receipt Flow';
    return;
  }

  bannerPill.textContent = 'Connected Mode';
  bannerCopy.textContent = 'Frontend and backend are connected. AWS-backed live receipt processing is now enabled through your configured environment.';
  demoNote.style.display = 'none';
  submitText.textContent = 'Process Receipt';
}

function bindPlaceholderActions() {
  document.querySelectorAll('[data-demo-action]').forEach((element) => {
    element.classList.add('is-disabled');
    element.addEventListener('click', (event) => {
      event.preventDefault();
      showToast(element.getAttribute('data-demo-action'), 'info');
    });
  });
}

function initializeScreenNavigation() {
  document.querySelectorAll('[data-screen-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetScreen = link.getAttribute('data-screen-link');
      if (!targetScreen) {
        return;
      }

      event.preventDefault();
      showScreen(targetScreen, true);
    });
  });

  const initialScreen = normalizeScreenFromHash(window.location.hash) || 'landing';
  showScreen(initialScreen, false);

  window.addEventListener('hashchange', () => {
    const targetScreen = normalizeScreenFromHash(window.location.hash);
    if (targetScreen && targetScreen !== currentScreen) {
      showScreen(targetScreen, false);
    }
  });
}

function showScreen(screenId, updateHash) {
  const nextScreen = document.querySelector(`[data-screen="${screenId}"]`);
  if (!nextScreen) {
    return;
  }

  document.querySelectorAll('.app-screen').forEach((screen) => {
    screen.classList.remove('active-screen');
  });

  nextScreen.classList.add('active-screen');
  nextScreen.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });
  currentScreen = screenId;

  document.querySelectorAll('[data-screen-link]').forEach((link) => {
    const isActive = link.getAttribute('data-screen-link') === screenId;
    link.classList.toggle('is-current-screen', isActive);
  });

  if (updateHash) {
    const targetHash = screenId === 'landing' ? '#landing' : `#${screenId}`;
    if (window.location.hash !== targetHash) {
      window.history.pushState(null, '', targetHash);
    }
  }
}

function normalizeScreenFromHash(hash) {
  const value = String(hash || '').replace(/^#/, '');
  return value || 'landing';
}

document.addEventListener('DOMContentLoaded', initializeExperience);
