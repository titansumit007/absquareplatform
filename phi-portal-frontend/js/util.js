// Shared helpers used across index.html, client.html, company.html, callback.html.
const Utils = (() => {
  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Every place the app renders a user-supplied string (a filename, a
  // client/company-user name, an email address, a notification message)
  // via innerHTML MUST pass it through this first. Filenames in particular
  // are attacker-controlled (a client picks their own upload's name), so
  // without this a filename like `<img src=x onerror=alert(1)>.pdf` would
  // execute as script in whoever's dashboard renders it.
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    // toFixed always keeps a decimal place for values under 10 (e.g. "5.0"),
    // even when the value is a whole number -- strip a trailing ".0" so
    // "5 MB" doesn't render as "5.0 MB", while "1.5 KB" is left alone.
    const formatted = n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '');
    return `${formatted} ${units[i]}`;
  }

  function formatDate(isoString) {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString || '';
    }
  }

  // Mirrors the server-side allow-list in backend/src/lib/common.js. This is
  // a UX convenience only (fail fast, clear message) -- the server is the
  // real enforcement point and re-validates everything independently.
  const ALLOWED_UPLOAD_TYPES = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/tiff': ['tif', 'tiff'],
    'text/plain': ['txt'],
  };
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB, matches backend MAX_UPLOAD_BYTES

  function validateUploadFile(file) {
    if (!file) return 'Choose a file first.';
    if (file.size > MAX_UPLOAD_BYTES) {
      return `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const allowedExts = Object.values(ALLOWED_UPLOAD_TYPES).flat();
    if (!allowedExts.includes(ext)) {
      return `".${ext}" isn't a supported file type. Allowed: ${allowedExts.join(', ')}.`;
    }
    return null;
  }

  async function errorMessageFrom(res, fallback) {
    if (!res) return 'Not logged in.';
    const data = await res.json().catch(() => ({}));
    return data.message || fallback;
  }

  return { escapeHtml, formatBytes, formatDate, validateUploadFile, errorMessageFrom, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES };
})();

// Allows `require('./util.js')` from Jest (Node) while leaving the browser's
// `Utils` global untouched -- browsers never define `module`.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
