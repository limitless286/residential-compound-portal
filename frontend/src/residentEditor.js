export function mountResidentEditor({
  container,
  apiRequest,
  onSaved,
  onUnauthorized
}) {
  const heading = container.querySelector('.section-heading');
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'button primary new-request-trigger';
  addButton.textContent = '+ Add resident';
  heading.append(addButton);

  const notice = document.createElement('p');
  notice.className = 'submission-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  heading.after(notice);

  const dialog = document.createElement('dialog');
  dialog.className = 'request-dialog';
  dialog.setAttribute('aria-labelledby', 'residentEditorTitle');

  dialog.innerHTML = `
    <form>
      <div class="dialog-heading">
        <div>
          <span class="eyebrow">RESIDENT ADMINISTRATION</span>
          <h2 id="residentEditorTitle"></h2>
        </div>
        <button class="button secondary" type="button" data-editor-close>
          Cancel
        </button>
      </div>

      <p class="muted">Residents can access services for their assigned unit.</p>

      <div class="field">
        <label for="residentFullName">Full name</label>
        <input
          id="residentFullName"
          name="fullName"
          type="text"
          maxlength="150"
          autocomplete="off"
          required
        />
      </div>

      <div class="field">
        <label for="residentEmail">Email</label>
        <input
          id="residentEmail"
          name="email"
          type="email"
          maxlength="254"
          autocomplete="off"
          required
        />
      </div>

      <div class="field" data-password-field>
        <label for="residentPassword">Initial password</label>
        <input
          id="residentPassword"
          name="password"
          type="password"
          minlength="12"
          maxlength="128"
          autocomplete="new-password"
        />
        <span class="muted field-help">Use between 12 and 128 characters.</span>
      </div>

      <div class="field">
        <label for="residentUnit">Unit</label>
        <select id="residentUnit" name="unitId" required></select>
      </div>

      <p class="muted field-help" role="status" data-unit-message></p>
      <p class="error-message" role="alert" data-editor-error hidden></p>

      <button class="button primary" type="submit" data-editor-submit>
        Save
      </button>
    </form>
  `;

  container.append(dialog);

  const find = (selector) => dialog.querySelector(selector);
  const form = find('form');
  const nameInput = find('#residentFullName');
  const emailInput = find('#residentEmail');
  const passwordInput = find('#residentPassword');
  const unitInput = find('#residentUnit');
  const closeButton = find('[data-editor-close]');
  const submitButton = find('[data-editor-submit]');
  const errorBox = find('[data-editor-error]');
  const unitMessage = find('[data-unit-message]');

  let active = true;
  let submitting = false;
  let openVersion = 0;
  let original = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function addUnitOption(id, label) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    unitInput.append(option);
  }

  function closeEditor() {
    openVersion++;
    passwordInput.value = '';
    dialog.close();
  }

  async function openEditor(resident = null) {
    if (!active || submitting) return;

    const version = ++openVersion;
    original = resident ? { ...resident } : null;

    form.reset();
    showError('');
    notice.hidden = true;
    unitInput.replaceChildren();
    unitInput.disabled = true;
    submitButton.disabled = true;
    unitMessage.textContent = 'Loading active units…';

    find('#residentEditorTitle').textContent = resident
      ? 'Edit resident'
      : 'Add resident';

    submitButton.textContent = resident ? 'Save changes' : 'Create account';
    find('[data-password-field]').hidden = Boolean(resident);
    passwordInput.required = !resident;
    passwordInput.disabled = Boolean(resident);

    nameInput.value = resident?.fullName ?? '';
    emailInput.value = resident?.email ?? '';

    if (!dialog.open) dialog.showModal();

    try {
      const units = [];
      let offset = 0;

      while (true) {
        if (offset > 10000) {
          throw new Error('The unit list is too large to load in this form.');
        }

        const data = await apiRequest(
          `/admin/units?status=ACTIVE&limit=100&offset=${offset}`
        );

        if (!active || version !== openVersion) return;

        units.push(...data.units);

        if (!data.pagination.hasMore) break;
        offset += 100;
      }

      addUnitOption('', 'Choose a unit');

      for (const unit of units) {
        addUnitOption(
          unit.id,
          `${unit.buildingCode} / ${unit.unitNumber}`
        );
      }

      if (resident &&
          !units.some((unit) => unit.id === resident.unitId)) {
        addUnitOption(
          resident.unitId,
          `${resident.buildingCode} / ${resident.unitNumber} — current unit (inactive)`
        );
      }

      unitInput.value = resident?.unitId ?? '';
      unitInput.disabled = false;

      if (units.length === 0 && !resident) {
        unitMessage.textContent =
          'Create an active unit before adding a resident.';
        return;
      }

      unitMessage.textContent = resident
        ? 'Account status is managed separately using Activate or Disable.'
        : 'The new account will be created as an active resident.';

      submitButton.disabled = false;
      nameInput.focus();
    } catch (error) {
      if (!active || version !== openVersion) return;

      unitMessage.textContent = '';

      if (error.status === 401) {
        onUnauthorized();
      } else {
        showError(error.message);
      }
    }
  }

  addButton.addEventListener('click', () => openEditor());

  closeButton.addEventListener('click', () => {
    if (!submitting) closeEditor();
  });

  dialog.addEventListener('cancel', (event) => {
    if (submitting) {
      event.preventDefault();
    } else {
      openVersion++;
      passwordInput.value = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (submitting || submitButton.disabled) return;

    const fullName = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const unitId = unitInput.value;

    if (!fullName || !unitId) {
      showError('Enter a name and choose a unit.');
      return;
    }

    const editing = original !== null;
    const body = {};

    if (editing) {
      if (fullName !== original.fullName) body.fullName = fullName;
      if (email !== original.email) body.email = email;
      if (unitId !== original.unitId) body.unitId = unitId;

      if (Object.keys(body).length === 0) {
        notice.textContent = 'No changes to save.';
        notice.hidden = false;
        closeEditor();
        return;
      }
    } else {
      body.fullName = fullName;
      body.email = email;
      body.unitId = unitId;
      body.password = passwordInput.value;
    }

    submitting = true;
    submitButton.disabled = true;
    closeButton.disabled = true;
    submitButton.textContent = 'Saving…';
    showError('');

    try {
      const path = editing
        ? `/admin/residents/${encodeURIComponent(original.id)}`
        : '/admin/residents';

      const data = await apiRequest(path, {
        method: editing ? 'PATCH' : 'POST',
        body
      });

      if (!active) return;

      notice.textContent = editing
        ? `${data.resident.fullName}'s details were updated.`
        : `${data.resident.fullName}'s account was created.`;

      notice.hidden = false;

      form.reset();
      closeEditor();
      addButton.focus();

      await onSaved();
    } catch (error) {
      if (!active) return;

      if (error.status === 401) {
        onUnauthorized();
      } else {
        showError(error.message);
      }
    } finally {
      if (active) {
        submitting = false;
        submitButton.disabled = false;
        closeButton.disabled = false;
        submitButton.textContent = editing ? 'Save changes' : 'Create account';
      }
    }
  });

  return {
    openEdit: (resident) => openEditor(resident),
    destroy: () => {
      active = false;
      openVersion++;
      passwordInput.value = '';

      if (dialog.open) dialog.close();

      dialog.remove();
      notice.remove();
      addButton.remove();
    }
  };
}
