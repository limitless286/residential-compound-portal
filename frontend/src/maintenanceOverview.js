export function mountMaintenanceOverview({
  anchor,
  user,
  apiRequest,
  onUnauthorized,
  onOpenRequest
}) {
  if (user.role !== 'ADMIN') {
    return {
      refresh: async () => {},
      destroy: () => {}
    };
  }

  const section = document.createElement('section');
  section.className = 'overview-section';

  section.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>Maintenance overview</h2>
        <p class="muted">A live summary of your community's maintenance requests.</p>
      </div>
      <button class="button secondary" type="button" data-refresh-overview>
        Refresh summary
      </button>
    </div>

    <p class="error-message" role="alert" data-overview-error hidden></p>
    <p class="muted" role="status" data-overview-message></p>
    <div class="overview-cards" data-cards></div>
    <p class="priority-summary" data-priorities></p>

    <div class="overdue-panel" data-overdue-panel hidden>
      <h3>Overdue requests</h3>
      <p class="muted" data-overdue-description></p>
      <ul class="overdue-list" data-overdue-list></ul>
    </div>
  `;

  anchor.before(section);

  const find = (selector) => section.querySelector(selector);
  const button = find('[data-refresh-overview]');
  const errorBox = find('[data-overview-error]');
  const message = find('[data-overview-message]');

  let active = true;
  let version = 0;

  function makeElement(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  async function refresh() {
    const currentVersion = ++version;
    button.disabled = true;
    errorBox.hidden = true;
    message.textContent = 'Updating summary…';

    try {
      const data = await apiRequest('/admin/maintenance-overview');

      if (!active || currentVersion !== version) return;

      const cards = find('[data-cards]');
      cards.replaceChildren();

      const summaries = [
        ['All requests', data.total, 'neutral'],
        ['Open', data.byStatus.OPEN, 'amber'],
        ['In progress', data.byStatus.IN_PROGRESS, 'blue'],
        ['Resolved', data.byStatus.RESOLVED, 'green'],
        ['Closed', data.byStatus.CLOSED, 'neutral'],
        ['Overdue', data.overdue.count, 'red']
      ];

      for (const [label, count, tone] of summaries) {
        const card = makeElement('div', undefined, `overview-card overview-${tone}`);
        card.append(
          makeElement('span', label),
          makeElement('strong', String(count))
        );
        cards.append(card);
      }

      find('[data-priorities]').textContent =
        `Active requests by priority: ` +
        `High ${data.activeByPriority.HIGH} · ` +
        `Medium ${data.activeByPriority.MEDIUM} · ` +
        `Low ${data.activeByPriority.LOW}`;

      const overduePanel = find('[data-overdue-panel]');
      const overdueList = find('[data-overdue-list]');
      overdueList.replaceChildren();

      overduePanel.hidden = data.overdue.count === 0;

      find('[data-overdue-description]').textContent =
        data.overdue.hasMore
          ? `Showing the oldest ${data.overdue.requests.length} of ${data.overdue.count} overdue requests.`
          : `${data.overdue.count} overdue request${data.overdue.count === 1 ? '' : 's'}.`;

      for (const request of data.overdue.requests) {
        const item = makeElement('li');
        const information = makeElement('div');

        const duration = request.overdueMinutes < 1
          ? 'Less than a minute overdue'
          : `${request.overdueMinutes} minutes overdue`;

        information.append(
          makeElement('strong', request.title),
          makeElement('span', `${request.priority} · ${duration}`, 'muted')
        );

        const viewButton = makeElement('button', 'View', 'button table-button');
        viewButton.type = 'button';
        viewButton.setAttribute('aria-label', `View ${request.title}`);

        viewButton.addEventListener('click', () => {
          onOpenRequest(request.id);
        });

        item.append(information, viewButton);
        overdueList.append(item);
      }

      const updatedAt = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Cairo'
      }).format(new Date(data.asOf));

      message.textContent = `Updated ${updatedAt} · Cairo`;
    } catch (error) {
      if (!active || currentVersion !== version) return;

      message.textContent = '';

      if (error.status === 401) {
        onUnauthorized();
        return;
      }

      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      if (active && currentVersion === version) {
        button.disabled = false;
      }
    }
  }

  button.addEventListener('click', refresh);
  refresh();

  return {
    refresh,
    destroy: () => {
      active = false;
      version++;
      section.remove();
    }
  };
}
