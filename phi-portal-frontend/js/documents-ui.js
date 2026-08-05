// Shared document UI: status pills, retention copy, in-layout preview + activity footprints.
const DocumentsUI = (() => {
  const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed' };
  const ACTION_LABELS = {
    upload: 'Uploaded',
    preview: 'Previewed',
    download: 'Downloaded',
    status_change: 'Status changed',
  };
  const PREVIEWABLE = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'text/plain',
  ]);

  let activeDoc = null;
  let getClientId = () => null;
  let onActivityUpdated = null;

  function statusPill(status) {
    return `<span class="pill status-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  function retentionBannerHtml() {
    return `
      <div class="retention-banner" role="note">
        <div class="icon" aria-hidden="true">⏳</div>
        <div>
          <strong>30-day document retention</strong>
          <p>
            Documents are kept for <b>30 days</b> from upload, then automatically deleted.
            After that they are unavailable to clients and AB Square users. Download anything you need to keep before the expiry date.
          </p>
        </div>
      </div>`;
  }

  function expiresLabel(doc) {
    if (!doc?.expiresAt) {
      const uploaded = doc?.uploadedAt ? new Date(doc.uploadedAt) : null;
      if (!uploaded || Number.isNaN(uploaded.getTime())) return '';
      const expires = new Date(uploaded.getTime() + 30 * 24 * 60 * 60 * 1000);
      return `<span class="expires-chip">Expires ${Utils.formatDate(expires.toISOString())}</span>`;
    }
    return `<span class="expires-chip">Expires ${Utils.escapeHtml(Utils.formatDate(doc.expiresAt))}</span>`;
  }

  function formatActivity(entries) {
    const list = Array.isArray(entries) ? [...entries].reverse() : [];
    if (!list.length) {
      return '<p class="preview-empty">No activity yet. Previews and status changes will appear here.</p>';
    }
    return list.map((e) => {
      const who = Utils.escapeHtml(e.byEmail || e.bySub || 'Unknown user');
      const what = Utils.escapeHtml(e.detail || ACTION_LABELS[e.action] || e.action || 'Activity');
      const when = Utils.escapeHtml(Utils.formatDate(e.at));
      return `<div class="activity-item">
        <div class="who">${who}</div>
        <div class="what">${what}</div>
        <div class="when">${when}</div>
      </div>`;
    }).join('');
  }

  function canPreview(doc) {
    return PREVIEWABLE.has(doc?.contentType);
  }

  function bindPreviewShell({ clientIdFn, onUpdated } = {}) {
    if (typeof clientIdFn === 'function') getClientId = clientIdFn;
    if (typeof onUpdated === 'function') onActivityUpdated = onUpdated;
    const closeBtn = document.getElementById('previewCloseBtn');
    if (closeBtn) closeBtn.onclick = closePreview;
  }

  function setPreviewLayout(open) {
    document.querySelectorAll('.docs-layout').forEach((el) => {
      el.classList.toggle('has-preview', open);
    });
  }

  function closePreview() {
    activeDoc = null;
    const panel = document.getElementById('previewPanel');
    if (panel) panel.classList.add('hidden');
    setPreviewLayout(false);
  }

  function renderActivity(log) {
    const el = document.getElementById('activityList');
    if (el) el.innerHTML = formatActivity(log);
  }

  async function openPreview(doc, triggerBtn) {
    const panel = document.getElementById('previewPanel');
    const title = document.getElementById('previewTitle');
    const meta = document.getElementById('previewMeta');
    const body = document.getElementById('previewBody');
    if (!panel || !body) return;

    activeDoc = doc;
    panel.classList.remove('hidden');
    setPreviewLayout(true);    if (title) title.textContent = doc.fileName || 'Document';
    if (meta) {
      meta.innerHTML = `${statusPill(doc.status)} ${expiresLabel(doc)}`;
    }
    renderActivity(doc.activityLog);
    body.innerHTML = '<p class="preview-empty">Loading secure preview…</p>';

    if (triggerBtn) triggerBtn.disabled = true;
    try {
      if (!canPreview(doc)) {
        body.innerHTML = `<div class="preview-unsupported">
          In-app preview is available for PDF, images, and plain text.<br>
          Use <b>Download</b> for Word/Excel files.
        </div>`;
        return;
      }

      const qs = new URLSearchParams({ documentId: doc.documentId, preview: '1' });
      const clientId = getClientId();
      if (clientId) qs.set('clientId', clientId);

      const res = await Auth.apiFetch(`/documents/download-url?${qs}`);
      if (!res || !res.ok) {
        const msg = await Utils.errorMessageFrom(res, 'Could not open preview.');
        throw new Error(msg);
      }
      const data = await res.json();
      if (data.activityLog) {
        doc.activityLog = data.activityLog;
        renderActivity(data.activityLog);
        if (onActivityUpdated) onActivityUpdated(doc);
      }

      if ((doc.contentType || '').startsWith('image/')) {
        body.innerHTML = `<img src="${data.downloadUrl}" alt="${Utils.escapeHtml(doc.fileName || 'Preview')}">`;
      } else {
        body.innerHTML = `<iframe title="Document preview" src="${data.downloadUrl}"></iframe>`;
      }
    } catch (err) {
      body.innerHTML = `<p class="preview-empty error-text">${Utils.escapeHtml(err.message || 'Preview failed.')}</p>`;
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  function refreshActivityFor(doc) {
    if (activeDoc && activeDoc.documentId === doc.documentId) {
      activeDoc = doc;
      renderActivity(doc.activityLog);
      const meta = document.getElementById('previewMeta');
      if (meta) meta.innerHTML = `${statusPill(doc.status)} ${expiresLabel(doc)}`;
    }
  }

  return {
    statusPill,
    STATUS_LABELS,
    retentionBannerHtml,
    expiresLabel,
    formatActivity,
    canPreview,
    bindPreviewShell,
    openPreview,
    closePreview,
    refreshActivityFor,
  };
})();
