import { mountRequestCreation } from './createRequest.js';
const statusLabels = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed'
};

const eventLabels = {
  CREATED: 'Request submitted',
  STARTED: 'Work started',
  RESOLVED: 'Resolution recorded',
  CLOSED: 'Resolution confirmed',
  REOPENED: 'Request reopened',
  PRIORITY_CHANGED: 'Priority changed'
};

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Cairo'
});

function formatDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? dateFormatter.format(date)
    : '—';
}

function element(tag, text, className) {
  const node = document.createElement(tag);

  if (text !== undefined) {
    node.textContent = text;
  }

  if (className) {
    node.className = className;
  }

  return node;
}

function badge(value) {
  const allowed = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'HIGH', 'MEDIUM', 'LOW'];
  const className = allowed.includes(value) ? value.toLowerCase() : 'unknown';

  return element(
    'span',
    statusLabels[value] ?? value,
    `badge badge-${className}`
  );
}

export function mountMaintenanceWorkspace({ apiRequest, user, onUnauthorized }) {
  const root = element('section', undefined, 'maintenance-section');
  document.querySelector('.workspace').append(root);

  root.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>Maintenance requests</h2>
        <p class="muted" data-description></p>
      </div>
      <button class="button secondary" type="button" data-refresh>Refresh</button>
    </div>

    <p class="error-message" role="alert" data-error hidden></p>

    <div data-list-panel>
      <div class="request-filters">
        <label>
          Status
          <select data-status>
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          Priority
          <select data-priority>
            <option value="">All priorities</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
      </div>

      <p class="muted" role="status" data-list-message></p>

      <div class="table-scroll" data-table-wrapper hidden>
        <table class="requests-table" aria-label="Maintenance requests">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col">Target resolution · Cairo</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody data-rows></tbody>
        </table>
      </div>

      <div class="pagination">
        <button class="button secondary" type="button" data-previous>Previous</button>
        <span class="muted" data-page-number></span>
        <button class="button secondary" type="button" data-next>Next</button>
      </div>
    </div>

    <div data-details-panel hidden>
      <button class="button secondary" type="button" data-back>Back to requests</button>
      <div data-details></div>
    </div>
  `;

  const find = (selector) => root.querySelector(selector);
  const errorBox = find('[data-error]');
  const listPanel = find('[data-list-panel]');
  const detailsPanel = find('[data-details-panel]');
  const rows = find('[data-rows]');
  const previousButton = find('[data-previous]');
  const nextButton = find('[data-next]');

  let active = true;
  let viewVersion = 0;
  let offset = 0;
  const limit = 10;

  find('[data-description]').textContent = user.role === 'ADMIN'
    ? 'Manage and track requests across your community.'
    : 'Track your maintenance requests and repair progress.';

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  function handleError(error) {
    if (error.status === 401) {
      onUnauthorized();
      return;
    }

    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }

  async function loadList() {
    const version = ++viewVersion;
    clearError();

    listPanel.hidden = false;
    detailsPanel.hidden = true;
    find('[data-table-wrapper]').hidden = true;
    find('[data-list-message]').textContent = 'Loading requests…';
    previousButton.disabled = true;
    nextButton.disabled = true;
    find('[data-page-number]').textContent = '';

    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });

    const status = find('[data-status]').value;
    const priority = find('[data-priority]').value;

    if (status) query.set('status', status);
    if (priority) query.set('priority', priority);

    try {
      const data = await apiRequest(`/maintenance-requests?${query}`);

      if (!active || version !== viewVersion) return;

      rows.replaceChildren();

      for (const request of data.requests) {
        const row = element('tr');

        const titleCell = element('td');
        titleCell.append(
          element('strong', request.title),
          element('span', request.category, 'request-category')
        );

        const statusCell = element('td');
        statusCell.append(badge(request.status));

        const priorityCell = element('td');
        priorityCell.append(badge(request.priority));

        const dueCell = element('td', formatDate(request.dueAt));
        const actionCell = element('td');
        const viewButton = element('button', 'View', 'button table-button');
        viewButton.type = 'button';
        viewButton.setAttribute('aria-label', `View ${request.title}`);
        viewButton.addEventListener('click', () => loadDetails(request.id));
        actionCell.append(viewButton);

        row.append(titleCell, statusCell, priorityCell, dueCell, actionCell);
        rows.append(row);
      }

      find('[data-table-wrapper]').hidden = data.requests.length === 0;
      find('[data-list-message]').textContent = data.requests.length === 0
        ? 'No requests match these filters.'
        : `${data.requests.length} request${data.requests.length === 1 ? '' : 's'} shown`;

      previousButton.disabled = offset === 0;
      nextButton.disabled = !data.pagination.hasMore;
      find('[data-page-number]').textContent = `Page ${offset / limit + 1}`;
    } catch (error) {
      if (!active || version !== viewVersion) return;
      find('[data-list-message]').textContent = '';
      handleError(error);
    }
  }

  async function loadDetails(id) {
    const version = ++viewVersion;
    clearError();

    listPanel.hidden = true;
    detailsPanel.hidden = false;

    const container = find('[data-details]');
    container.replaceChildren(element('p', 'Loading request…', 'muted'));

    try {
      const data = await apiRequest(
        `/maintenance-requests/${encodeURIComponent(id)}`
      );

      if (!active || version !== viewVersion) return;

      const request = data.request;
      const card = element('article', undefined, 'request-detail-card');

      card.append(
        element('h3', request.title),
        badge(request.status),
        element('p', request.description, 'request-description')
      );

      const information = element('dl', undefined, 'request-information');

      const fields = [
        ['Category', request.category],
        ['Location', request.locationDescription],
        ['Priority', request.priority],
        ['Submitted · Cairo', formatDate(request.createdAt)],
        ['Target resolution · Cairo', formatDate(request.dueAt)],
        ['Resolved · Cairo', formatDate(request.resolvedAt)],
        ['Closed · Cairo', formatDate(request.closedAt)]
      ];

      for (const [label, value] of fields) {
        const field = element('div');
        field.append(element('dt', label), element('dd', value));
        information.append(field);
      }

      card.append(information, element('h3', 'Request history'));

      const history = element('ol', undefined, 'request-history');

      for (const event of data.history) {
        const item = element('li');
        item.append(
          element('strong', eventLabels[event.eventType] ?? event.eventType),
          element('span', formatDate(event.createdAt), 'history-date')
        );

        if (event.reason) {
          item.append(element('p', event.reason));
        }

        history.append(item);
      }

      card.append(history);
      container.replaceChildren(card);
    } catch (error) {
      if (!active || version !== viewVersion) return;
      container.replaceChildren();
      handleError(error);
    }
  }

  for (const selector of ['[data-status]', '[data-priority]']) {
    find(selector).addEventListener('change', () => {
      offset = 0;
      loadList();
    });
  }

  previousButton.addEventListener('click', () => {
    offset = Math.max(0, offset - limit);
    loadList();
  });

  nextButton.addEventListener('click', () => {
    offset += limit;
    loadList();
  });

  find('[data-refresh]').addEventListener('click', () => loadList());
  find('[data-back]').addEventListener('click', () => loadList());

  loadList();

  const cleanupRequestCreation = mountRequestCreation({
    anchor: root,
    apiRequest,
    user,
    onCreated: () => {
      offset = 0;
      return loadList();
    },
    onUnauthorized
  });

  return () => {
    cleanupRequestCreation();
    active = false;
    viewVersion++;
    root.remove();
  };
}

