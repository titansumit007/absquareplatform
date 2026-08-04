// Shared notification bell + panel rendering for dashboard pages.
const Notifications = (() => {
  let previousUnreadCount = 0;

  async function load() {
    try {
      const res = await Auth.apiFetch('/notifications');
      if (!res || !res.ok) return;
      const data = await res.json();
      const unread = data.notifications.filter((n) => !n.read);
      const countEl = document.getElementById('notifCount');
      if (countEl) countEl.textContent = unread.length || '';

      if (unread.length > previousUnreadCount) {
        const bell = document.getElementById('notifBell');
        if (bell) {
          bell.classList.remove('ring');
          void bell.offsetWidth;
          bell.classList.add('ring');
        }
      }
      previousUnreadCount = unread.length;

      const panel = document.getElementById('notifPanel');
      if (panel) {
        panel.innerHTML = data.notifications.map((n) =>
          `<div class="notif ${n.read ? '' : 'unread'}">${Utils.escapeHtml(n.message)} <span class="ts">${Utils.escapeHtml(Utils.formatDate(n.createdAt))}</span></div>`
        ).join('') || '<div class="notif">No notifications yet</div>';
      }
    } catch {
      // Non-critical — retried on next poll.
    }
  }

  function bindBell() {
    const bell = document.getElementById('notifBell');
    const panel = document.getElementById('notifPanel');
    if (bell && panel) {
      bell.onclick = () => panel.classList.toggle('hidden');
    }
  }

  return { load, bindBell };
})();
