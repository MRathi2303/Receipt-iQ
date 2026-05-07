const CURRENCY_SYMBOLS = {
  USD: '$',
  INR: 'Rs. ',
  EUR: 'EUR ',
  GBP: 'GBP ',
  AED: 'AED '
};

const SUPPORTED_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AED'];

function formatCurrency(value, currency = 'USD') {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${Number(value).toFixed(2)}`;
}

function extractNumericValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function compactText(value, maxLength = 80) {
  if (value == null) {
    return null;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function sanitizeDocId(docId) {
  if (!docId) {
    return null;
  }
  return String(docId)
    .replace(/[^a-zA-Z0-9\-_]/g, '')
    .slice(0, 128);
}

function sanitizeFileName(fileName) {
  if (!fileName) {
    return null;
  }
  return String(fileName)
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
    .slice(0, 255);
}

const ALLOWED_CATEGORIES = ['auto', 'food', 'travel', 'utilities', 'medical', 'entertainment', 'education', 'shopping', 'other'];

function isValidCategory(category) {
  return ALLOWED_CATEGORIES.includes(String(category).toLowerCase());
}

function normalizeCategory(category) {
  const normalized = String(category || 'auto').toLowerCase();
  return ALLOWED_CATEGORIES.includes(normalized) ? normalized : 'other';
}

module.exports = {
  formatCurrency,
  extractNumericValue,
  compactText,
  sanitizeDocId,
  sanitizeFileName,
  isValidCategory,
  normalizeCategory,
  ALLOWED_CATEGORIES,
  CURRENCY_SYMBOLS,
  SUPPORTED_CURRENCIES
};