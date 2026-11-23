import { mountResidentEditor } from './residentEditor.js';
export function mountResidentAdministration({
  container,
  apiRequest,
  onUnauthorized
}) {
  const section = document.createElement('section');

  section.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>Residents</h2>
        <p class="muted">Manage resident access to your community.</p>
      </div>
      <button class="button secondary" type="button" data-refresh>
        Refresh
      </button>
    </div>

    <div class="request-filters">
      <label>
        Account status
        <select data-status>
          <option value="">All accounts</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>
    </div>

    <p class="error-message" role="alert" data-error hidden></p>
    <p class="submission-notice" role="status" data-notice hidden></p>
    <p class="muted" role="status" data-message></p>

    <div class="table-scroll" data-table hidden>
      <table class="requests-table" aria-label="Resident accounts">
        <thead>
          <tr>
            <th scope="col">Resident</th>
            <th scope="col">Building / unit</th>
            <th scope="col">Status</th>
            <th scope="col">Account access</th>
          </tr>
        </thead>
        <tbody data-rows></tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="button secondary" type="button" data-previous>Previous</button>
      <span class="muted" data-page></span>
      <button class="button secondary" type="button" data-next>Next</button>
    </div>
  `;

  container.append(section);

  const find = (selector) => section.querySelector(selector);
  const errorBox = find('[data-error]');
  const notice = find('[data-notice]');
  const rows = find('[data-rows]');
  const previous = find('[data-previous]');
  const next = find('[data-next]');

  const limit = 20;
  let offset = 0;
  let active = true;
  let version = 0;
  let residentEditor = null;

  function makeElement(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function handleError(error) {
    if (error.status === 401) {
      onUnauthorized();
      return;
    }

    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }

  async function changeStatus(resident, button) {
    button.disabled = true;
    errorBox.hidden = true;
    notice.hidden = true;

    const status = resident.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';

    try {
      await apiRequest(
        `/admin/residents/${encodeURIComponent(resident.id)}/status`,
        {
          method: 'PATCH',
          body: { status }
        }
      );

      if (!active) return;

      notice.textContent = status === 'ACTIVE'
        ? `${resident.fullName}'s account is now active.`
        : `${resident.fullName}'s account is now disabled.`;

      notice.hidden = false;
      await loadResidents();
    } catch (error) {
      if (active) handleError(error);
    } finally {
      if (active) button.disabled = false;
    }
  }

  async function loadResidents() {
    const currentVersion = ++version;

    errorBox.hidden = true;
    previous.disabled = true;
    next.disabled = true;
    find('[data-table]').hidden = true;
    find('[data-message]').textContent = 'Loading residents…';
    find('[data-page]').textContent = '';

    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });

    const status = find('[data-status]').value;
    if (status) query.set('status', status);

    try {
      const data = await apiRequest(`/admin/residents?${query}`);

      if (!active || currentVersion !== version) return;

      rows.replaceChildren();

      for (const resident of data.residents) {
        const row = makeElement('tr');

        const person = makeElement('td');
        person.append(
          makeElement('strong', resident.fullName),
          makeElement('span', resident.email, 'resident-email')
        );

        const unit = makeElement(
          'td',
          `${resident.buildingCode} / ${resident.unitNumber}`
        );

        const statusCell = makeElement('td');
        statusCell.append(makeElement(
          'span',
          resident.status === 'ACTIVE' ? 'Active' : 'Disabled',
          resident.status === 'ACTIVE'
            ? 'badge badge-resolved'
            : 'badge badge-closed'
        ));

        const actions = makeElement('td', undefined, 'resident-actions-cell');
        const button = makeElement(
          'button',
          resident.status === 'ACTIVE' ? 'Disable account' : 'Activate account',
          'button table-button'
        );

        button.type = 'button';
        button.setAttribute(
          'aria-label',
          `${button.textContent}: ${resident.fullName}`
        );

        button.addEventListener('click', () => changeStatus(resident, button));
        const editButton = makeElement('button', 'Edit', 'button table-button');
        editButton.type = 'button';
        editButton.setAttribute('aria-label', `Edit ${resident.fullName}`);
        editButton.addEventListener('click', () => {
          residentEditor.openEdit(resident);
        });

        actions.append(editButton, button);

        row.append(person, unit, statusCell, actions);
        rows.append(row);
      }

      find('[data-table]').hidden = data.residents.length === 0;
      find('[data-message]').textContent = data.residents.length === 0
        ? 'No residents match this filter.'
        : `${data.residents.length} resident${data.residents.length === 1 ? '' : 's'} shown`;

      previous.disabled = offset === 0;
      next.disabled = !data.pagination.hasMore;
      find('[data-page]').textContent = `Page ${offset / limit + 1}`;
    } catch (error) {
      if (!active || currentVersion !== version) return;
      find('[data-message]').textContent = '';
      handleError(error);
    }
  }

  find('[data-status]').addEventListener('change', () => {
    offset = 0;
    notice.hidden = true;
    loadResidents();
  });

  find('[data-refresh]').addEventListener('click', loadResidents);

  previous.addEventListener('click', () => {
    offset = Math.max(0, offset - limit);
    loadResidents();
  });

  next.addEventListener('click', () => {
    offset += limit;
    loadResidents();
  });

  loadResidents();

  residentEditor = mountResidentEditor({
    container: section,
    apiRequest,
    onUnauthorized,
    onSaved: () => {
      offset = 0;
      return loadResidents();
    }
  });

  return () => {
    active = false;
    residentEditor?.destroy();
    version++;
    section.remove();
  };
}

