export function mountOverdueNotifications({ anchor, apiRequest, onUnauthorized, onOpenRequest, user }) {
  if (user.role !== 'ADMIN') return { refresh: async () => {}, destroy: () => {} };
  const section = document.createElement('section');
  section.className = 'overview-section';
  section.innerHTML = `
    <div class="section-heading"><div>
      <h2>Maintenance alerts</h2>
      <p class="muted">Recorded overdue alerts. The current request status is shown for context.</p>
    </div><button class="button secondary" type="button" data-alert-refresh>Refresh alerts</button></div>
    <p class="muted" role="status" data-alert-message></p>
    <p class="error-message" role="alert" data-alert-error hidden></p>
    <ul class="overdue-list" data-alert-list></ul>`;
  anchor.before(section);
  let active = true;
  let version = 0;
  const find = selector => section.querySelector(selector);
  const button = find('[data-alert-refresh]');
  function node(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo'
  });
  async function refresh() {
    const current = ++version;
    button.disabled = true;
    find('[data-alert-error]').hidden = true;
    find('[data-alert-message]').textContent = 'Loading alerts…';
    try {
      const data = await apiRequest('/admin/overdue-notifications?limit=20');
      if (!active || current !== version) return;
      const list = find('[data-alert-list]');
      list.replaceChildren();
      for (const alert of data.notifications) {
        const item = document.createElement('li');
        const information = document.createElement('div');
        information.append(
          node('strong', alert.title),
          node('span', `${alert.priority} at alert time · Now ${alert.requestStatus} · ` +
            formatter.format(new Date(alert.createdAt)) + ' Cairo', 'muted')
        );
        const view = node('button', 'View', 'button table-button');
        view.type = 'button';
        view.setAttribute('aria-label', `View ${alert.title}`);
        view.addEventListener('click', () => onOpenRequest(alert.requestId));
        item.append(information, view);
        list.append(item);
      }
      find('[data-alert-message]').textContent = data.notifications.length
        ? (data.pagination.hasMore ? 'Showing the latest 20 recorded alerts.' : 'Latest recorded alerts.')
        : 'No overdue alerts have been recorded.';
    } catch (error) {
      if (!active || current !== version) return;
      find('[data-alert-message]').textContent = '';
      if (error.status === 401) { onUnauthorized(); return; }
      find('[data-alert-error]').textContent = error.message;
      find('[data-alert-error]').hidden = false;
    } finally {
      if (active && current === version) button.disabled = false;
    }
  }
  button.addEventListener('click', refresh);
  refresh();
  return { refresh, destroy: () => { active = false; version++; section.remove(); } };
}
