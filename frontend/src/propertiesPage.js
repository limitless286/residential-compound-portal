export function mountPropertiesPage({ container, apiRequest, onUnauthorized }) {
  const root = document.createElement('section');

  root.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>Buildings & units</h2>
        <p class="muted">Manage the buildings and units in your community.</p>
      </div>
      <button class="button primary new-request-trigger" type="button" data-add></button>
    </div>

    <nav class="property-tabs" aria-label="Property records">
      <button class="button secondary" type="button" data-buildings>Buildings</button>
      <button class="button secondary" type="button" data-units>Units</button>
      <button class="button secondary" type="button" data-refresh>Refresh</button>
    </nav>

    <div class="request-filters" data-unit-filters hidden>
      <label>
        Building
        <select data-building-filter></select>
      </label>
      <label>
        Unit status
        <select data-status-filter>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
    </div>

    <p class="error-message" role="alert" data-error hidden></p>
    <p class="submission-notice" role="status" data-notice hidden></p>
    <p class="muted" role="status" data-message></p>

    <div class="table-scroll" data-table hidden>
      <table class="requests-table" aria-label="Buildings and units">
        <thead data-head></thead>
        <tbody data-rows></tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="button secondary" type="button" data-previous>Previous</button>
      <span class="muted" data-page></span>
      <button class="button secondary" type="button" data-next>Next</button>
    </div>

    <dialog class="request-dialog" aria-labelledby="propertyEditorTitle">
      <form>
        <div class="dialog-heading">
          <h2 id="propertyEditorTitle"></h2>
          <button class="button secondary" type="button" data-close>Cancel</button>
        </div>
        <p class="muted" data-editor-description></p>
        <div data-fields></div>
        <p class="error-message" role="alert" data-editor-error hidden></p>
        <button class="button primary" type="submit" data-save>Save</button>
      </form>
    </dialog>
  `;

  container.append(root);

  const find = (selector) => root.querySelector(selector);
  const dialog = find('dialog');
  const form = find('form');
  const fields = find('[data-fields]');
  const errorBox = find('[data-error]');
  const editorError = find('[data-editor-error]');
  const notice = find('[data-notice]');
  const saveButton = find('[data-save]');
  const closeButton = find('[data-close]');
  const buildingFilter = find('[data-building-filter]');

  const limit = 20;
  let resource = 'buildings';
  let offset = 0;
  let active = true;
  let listVersion = 0;
  let editorVersion = 0;
  let submitting = false;
  let editing = null;
  let editorResource = 'buildings';

  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function handleError(error, target = errorBox) {
    if (error.status === 401) {
      onUnauthorized();
      return;
    }

    target.textContent = error.message;
    target.hidden = false;
  }

  async function allBuildings() {
    const buildings = [];
    let pageOffset = 0;

    while (true) {
      if (pageOffset > 10000) {
        throw new Error('The building list is too large to load.');
      }

      const data = await apiRequest(
        `/admin/buildings?limit=100&offset=${pageOffset}`
      );

      if (!active) return [];

      buildings.push(...data.buildings);

      if (!data.pagination.hasMore) return buildings;
      pageOffset += 100;
    }
  }

  function option(select, value, text) {
    const item = node('option', text);
    item.value = value;
    select.append(item);
  }

  function inputField(name, label, value, maximum, pattern) {
    const field = node('label', undefined, 'field');
    field.append(node('span', label));

    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.value = value ?? '';
    input.required = true;
    input.maxLength = maximum;
    input.autocomplete = 'off';

    if (pattern) input.pattern = pattern;

    field.append(input);
    fields.append(field);
    return input;
  }

  function selectField(name, label) {
    const field = node('label', undefined, 'field');
    field.append(node('span', label));

    const select = document.createElement('select');
    select.name = name;
    select.required = true;

    field.append(select);
    fields.append(field);
    return select;
  }

  async function loadList() {
    const version = ++listVersion;
    const currentResource = resource;

    errorBox.hidden = true;
    find('[data-table]').hidden = true;
    find('[data-message]').textContent = 'Loading records…';
    find('[data-page]').textContent = '';
    find('[data-previous]').disabled = true;
    find('[data-next]').disabled = true;

    find('[data-add]').textContent =
      currentResource === 'buildings' ? '+ Add building' : '+ Add unit';

    find('[data-unit-filters]').hidden = currentResource !== 'units';

    find('[data-buildings]').setAttribute(
      'aria-pressed', String(currentResource === 'buildings')
    );
    find('[data-units]').setAttribute(
      'aria-pressed', String(currentResource === 'units')
    );

    try {
      if (currentResource === 'units') {
        const selectedBuilding = buildingFilter.value;
        const buildings = await allBuildings();

        if (!active || version !== listVersion) return;

        buildingFilter.replaceChildren();
        option(buildingFilter, '', 'All buildings');

        for (const building of buildings) {
          option(buildingFilter, building.id, `${building.code} — ${building.name}`);
        }

        buildingFilter.value = buildings.some(
          (building) => building.id === selectedBuilding
        ) ? selectedBuilding : '';
      }

      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      });

      if (currentResource === 'units') {
        if (buildingFilter.value) {
          query.set('buildingId', buildingFilter.value);
        }

        const status = find('[data-status-filter]').value;
        if (status) query.set('status', status);
      }

      const data = await apiRequest(`/admin/${currentResource}?${query}`);

      if (!active || version !== listVersion) return;

      const records = data[currentResource];
      const head = find('[data-head]');
      const rows = find('[data-rows]');
      head.replaceChildren();
      rows.replaceChildren();

      const headerRow = node('tr');
      const headings = currentResource === 'buildings'
        ? ['Code', 'Building name', 'Actions']
        : ['Building', 'Unit number', 'Status', 'Actions'];

      for (const heading of headings) {
        const cell = node('th', heading);
        cell.scope = 'col';
        headerRow.append(cell);
      }

      head.append(headerRow);

      for (const record of records) {
        const row = node('tr');

        if (currentResource === 'buildings') {
          row.append(node('td', record.code), node('td', record.name));
        } else {
          const statusCell = node('td');
          statusCell.append(node(
            'span',
            record.status === 'ACTIVE' ? 'Active' : 'Inactive',
            record.status === 'ACTIVE'
              ? 'badge badge-resolved'
              : 'badge badge-closed'
          ));

          row.append(
            node('td', record.buildingCode),
            node('td', record.unitNumber),
            statusCell
          );
        }

        const actions = node('td');
        const editButton = node('button', 'Edit', 'button table-button');
        editButton.type = 'button';
        editButton.setAttribute(
          'aria-label',
          `Edit ${record.code ?? record.unitNumber}`
        );
        editButton.addEventListener('click', () => openEditor(record));
        actions.append(editButton);

        row.append(actions);
        rows.append(row);
      }

      find('[data-table]').hidden = records.length === 0;
      find('[data-message]').textContent = records.length === 0
        ? 'No records match your selection.'
        : `${records.length} record${records.length === 1 ? '' : 's'} shown`;

      find('[data-page]').textContent = `Page ${offset / limit + 1}`;
      find('[data-previous]').disabled = offset === 0;
      find('[data-next]').disabled = !data.pagination.hasMore;
    } catch (error) {
      if (!active || version !== listVersion) return;
      find('[data-message]').textContent = '';
      handleError(error);
    }
  }

  async function openEditor(record = null) {
    if (submitting || !active) return;

    const version = ++editorVersion;
    editing = record ? { ...record } : null;
    editorResource = resource;

    form.reset();
    fields.replaceChildren();
    editorError.hidden = true;
    saveButton.disabled = true;

    find('#propertyEditorTitle').textContent =
      `${record ? 'Edit' : 'Add'} ${resource === 'buildings' ? 'building' : 'unit'}`;

    find('[data-editor-description]').textContent =
      resource === 'buildings'
        ? 'Building codes must be unique.'
        : record
          ? 'A unit with active residents cannot be deactivated.'
          : 'New units are created as active.';

    dialog.showModal();

    try {
      if (resource === 'buildings') {
        const codeInput = inputField(
          'code', 'Building code', record?.code, 30,
          '[A-Za-z0-9][A-Za-z0-9_-]{0,29}'
        );
        codeInput.title = 'Letters, numbers, hyphens and underscores only.';
        inputField('name', 'Building name', record?.name, 100);
      } else {
        if (!record) {
          const select = selectField('buildingId', 'Building');
          option(select, '', 'Choose a building');

          const buildings = await allBuildings();
          if (!active || version !== editorVersion) return;

          for (const building of buildings) {
            option(select, building.id, `${building.code} — ${building.name}`);
          }

          if (buildings.length === 0) {
            throw new Error('Create a building before adding a unit.');
          }

          select.value = buildingFilter.value;
        } else {
          fields.append(node('p', `Building: ${record.buildingCode}`, 'muted'));
        }

        inputField('unitNumber', 'Unit number', record?.unitNumber, 30);

        if (record) {
          const select = selectField('status', 'Status');
          option(select, 'ACTIVE', 'Active');
          option(select, 'INACTIVE', 'Inactive');
          select.value = record.status;
        }
      }

      saveButton.disabled = false;
      fields.querySelector('input, select')?.focus();
    } catch (error) {
      if (active && version === editorVersion) {
        handleError(error, editorError);
      }
    }
  }

  function closeEditor() {
    editorVersion++;
    dialog.close();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || saveButton.disabled) return;

    const body = Object.fromEntries(
      [...new FormData(form).entries()].map(([key, value]) => [key, value.trim()])
    );

    if (Object.values(body).some((value) => value.length === 0)) {
      editorError.textContent = 'Complete all required fields.';
      editorError.hidden = false;
      return;
    }

    if (editing) {
      for (const key of Object.keys(body)) {
        if (body[key] === editing[key]) delete body[key];
      }

      if (Object.keys(body).length === 0) {
        closeEditor();
        return;
      }
    }

    submitting = true;
    saveButton.disabled = true;
    closeButton.disabled = true;
    saveButton.textContent = 'Saving…';
    editorError.hidden = true;

    try {
      const path = editing
        ? `/admin/${editorResource}/${encodeURIComponent(editing.id)}`
        : `/admin/${editorResource}`;

      await apiRequest(path, {
        method: editing ? 'PATCH' : 'POST',
        body
      });

      if (!active) return;

      notice.textContent = `${editorResource === 'buildings' ? 'Building' : 'Unit'} saved successfully.`;
      notice.hidden = false;
      closeEditor();
      find('[data-add]').focus();

      offset = 0;
      await loadList();
    } catch (error) {
      if (active) handleError(error, editorError);
    } finally {
      if (active) {
        submitting = false;
        saveButton.disabled = false;
        closeButton.disabled = false;
        saveButton.textContent = 'Save';
      }
    }
  });

  closeButton.addEventListener('click', () => {
    if (!submitting) closeEditor();
  });

  dialog.addEventListener('cancel', (event) => {
    if (submitting) event.preventDefault();
    else editorVersion++;
  });

  function switchResource(value) {
    resource = value;
    offset = 0;
    notice.hidden = true;
    loadList();
  }

  find('[data-buildings]').addEventListener('click', () => switchResource('buildings'));
  find('[data-units]').addEventListener('click', () => switchResource('units'));
  find('[data-refresh]').addEventListener('click', loadList);
  find('[data-add]').addEventListener('click', () => openEditor());

  for (const selector of ['[data-building-filter]', '[data-status-filter]']) {
    find(selector).addEventListener('change', () => {
      offset = 0;
      loadList();
    });
  }

  find('[data-previous]').addEventListener('click', () => {
    offset = Math.max(0, offset - limit);
    loadList();
  });

  find('[data-next]').addEventListener('click', () => {
    offset += limit;
    loadList();
  });

  loadList();

  return () => {
    active = false;
    listVersion++;
    editorVersion++;
    if (dialog.open) dialog.close();
    root.remove();
  };
}
