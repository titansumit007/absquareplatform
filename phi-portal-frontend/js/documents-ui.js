// Shared document status pill HTML for dashboard tables.
const DocumentsUI = (() => {
  const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed' };

  function statusPill(status) {
    return `<span class="pill status-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  return { statusPill, STATUS_LABELS };
})();
