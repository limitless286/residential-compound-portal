export function mountRequestCreation({
  anchor,
  apiRequest,
  user,
  onCreated,
  onUnauthorized
}) {
  if (user.role !== 'RESIDENT') {
    return () => {};
  }

  const section = document.createElement('section');
  section.className = 'create-request-section';

  section.innerHTML = `
    <div class="create-request-heading">
      <div>
        <h2>Need something fixed?</h2>
        <p class="muted">Tell us what happened and where we can find it.</p>
      </div>
      <button class="button primary new-request-trigger" type="button" data-open>
        + New request
      </button>
    </div>

    <p class="submission-notice" role="status" data-notice hidden></p>

    <dialog class="request-dialog" aria-labelledby="createRequestTitle">
      <form data-form>
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">MAINTENANCE</span>
            <h2 id="createRequestTitle">New request</h2>
          </div>
          <button class="button secondary" type="button" data-close>
            Cancel
          </button>
        </div>

        <p class="muted">
          Describe the issue so the maintenance team can help.
          All fields are required.
        </p>

        <div class="field">
          <label for="requestTitle">Title</label>
          <input
            id="requestTitle"
            name="title"
            type="text"
            minlength="3"
            maxlength="150"
            placeholder="For example: Leaking kitchen tap"
            required
          />
        </div>

        <div class="field">
          <label for="requestCategory">Category</label>
          <select id="requestCategory" name="category" required>
            <option value="">Choose a category</option>
            <option value="PLUMBING">Plumbing</option>
            <option value="ELECTRICAL">Electrical</option>
            <option value="CLEANING">Cleaning</option>
            <option value="STRUCTURAL">Structural</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div class="field">
          <label for="requestLocation">Location</label>
          <input
            id="requestLocation"
            name="locationDescription"
            type="text"
            maxlength="200"
            placeholder="For example: Kitchen sink"
            required
          />
        </div>

        <div class="field">
          <label for="requestDescription">Description</label>
          <textarea
            id="requestDescription"
            name="description"
            rows="5"
            minlength="10"
            maxlength="5000"
            placeholder="Explain the problem and when you noticed it."
            required
          ></textarea>
        </div>

        <p class="error-message" role="alert" data-error hidden></p>

        <button class="button primary" type="submit" data-submit>
          Submit request
        </button>
      </form>
    </dialog>
  `;

  anchor.before(section);

  const find = (selector) => section.querySelector(selector);
  const dialog = find('dialog');
  const form = find('[data-form]');
  const openButton = find('[data-open]');
  const closeButton = find('[data-close]');
  const submitButton = find('[data-submit]');
  const errorBox = find('[data-error]');
  const notice = find('[data-notice]');

  let active = true;
  let submitting = false;

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  openButton.addEventListener('click', () => {
    clearError();
    dialog.showModal();
  });

  closeButton.addEventListener('click', () => {
    if (!submitting) {
      dialog.close();
    }
  });

  dialog.addEventListener('cancel', (event) => {
    if (submitting) {
      event.preventDefault();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (submitting) return;

    submitting = true;
    submitButton.disabled = true;
    closeButton.disabled = true;
    submitButton.textContent = 'Submitting…';
    clearError();

    const fields = new FormData(form);

    const body = {
      title: fields.get('title').trim(),
      category: fields.get('category'),
      locationDescription: fields.get('locationDescription').trim(),
      description: fields.get('description').trim()
    };

    try {
      const data = await apiRequest('/maintenance-requests', {
        method: 'POST',
        body
      });

      if (!active) return;

      const warnings = Array.isArray(data.warnings)
        ? data.warnings.map((warning) => warning.message).join(' ')
        : '';

      notice.textContent =
        `Request "${data.request.title}" submitted successfully.` +
        (warnings ? ` ${warnings}` : '');

      notice.className = warnings
        ? 'submission-notice submission-warning'
        : 'submission-notice';

      notice.hidden = false;

      form.reset();
      dialog.close();
      openButton.focus();

      await onCreated();
    } catch (error) {
      if (!active) return;

      if (error.status === 401) {
        onUnauthorized();
        return;
      }

      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      if (active) {
        submitting = false;
        submitButton.disabled = false;
        closeButton.disabled = false;
        submitButton.textContent = 'Submit request';
      }
    }
  });

  return () => {
    active = false;

    if (dialog.open) {
      dialog.close();
    }

    section.remove();
  };
}
