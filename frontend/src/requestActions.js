function makeElement(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function mountRequestActions({
  container,
  request,
  user,
  apiRequest,
  onUpdated,
  onUnauthorized
}) {
  const actions = [];

  if (user.role === 'ADMIN') {
    if (request.status === 'OPEN') {
      actions.push({
        action: 'start',
        title: 'Start maintenance work',
        label: 'Start work'
      });
    }

    if (request.status === 'IN_PROGRESS') {
      actions.push({
        action: 'resolve',
        title: 'Record the resolution',
        label: 'Mark as resolved',
        reasonLabel: 'What was repaired?',
        reasonRequired: true
      });
    }

    if (['OPEN', 'IN_PROGRESS'].includes(request.status)) {
      actions.push({
        action: 'priority',
        title: 'Change priority',
        label: 'Update priority',
        reasonLabel: 'Reason for changing priority',
        reasonRequired: true,
        choosePriority: true
      });
    }
  }

  if (user.role === 'RESIDENT' &&
      request.userId === user.id &&
      request.status === 'RESOLVED') {
    actions.push({
      action: 'confirm',
      title: 'Has the issue been fixed?',
      description: 'Confirming the repair closes this request.',
      label: 'Confirm issue is fixed'
    });

    const resolvedAt = Date.parse(request.resolvedAt);
    const reopeningDeadline = resolvedAt + 48 * 60 * 60 * 1000;

    if (Number.isFinite(resolvedAt) && Date.now() <= reopeningDeadline) {
      actions.push({
        action: 'reopen',
        title: 'Is the problem still happening?',
        description: 'You can reopen a resolved request within 48 hours of resolution.',
        label: 'Reopen request',
        reasonLabel: 'Explain why the request needs to be reopened',
        reasonRequired: true
      });
    }
  }

  if (actions.length === 0) {
    return () => {};
  }

  const section = makeElement('section', undefined, 'request-actions');
  section.append(makeElement('h3', 'Available actions'));

  const grid = makeElement('div', undefined, 'request-action-grid');
  const errorBox = makeElement('p', '', 'error-message');
  errorBox.setAttribute('role', 'alert');
  errorBox.hidden = true;

  section.append(grid, errorBox);
  container.append(section);

  let active = true;
  let submitting = false;

  for (const action of actions) {
    const form = makeElement('form', undefined, 'request-action-card');
    form.append(makeElement('h4', action.title));

    if (action.description) {
      form.append(makeElement('p', action.description, 'muted'));
    }

    let priorityInput = null;
    let reasonInput = null;

    if (action.choosePriority) {
      const field = makeElement('label', undefined, 'field');
      field.append(makeElement('span', 'New priority'));

      priorityInput = document.createElement('select');
      priorityInput.required = true;
      priorityInput.name = 'priority';

      const placeholder = makeElement('option', 'Choose a priority');
      placeholder.value = '';
      placeholder.disabled = true;
      placeholder.selected = true;
      priorityInput.append(placeholder);

      for (const priority of ['HIGH', 'MEDIUM', 'LOW']) {
        if (priority === request.priority) continue;

        const option = makeElement('option', priority);
        option.value = priority;
        priorityInput.append(option);
      }

      field.append(priorityInput);
      form.append(field);
    }

    if (action.reasonRequired) {
      const field = makeElement('label', undefined, 'field');
      field.append(makeElement('span', action.reasonLabel));

      reasonInput = document.createElement('textarea');
      reasonInput.name = 'reason';
      reasonInput.required = true;
      reasonInput.minLength = 3;
      reasonInput.maxLength = 1000;
      reasonInput.rows = 3;

      field.append(reasonInput);
      form.append(field);
    }

    const button = makeElement('button', action.label, 'button primary');
    button.type = 'submit';
    form.append(button);
    grid.append(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting) return;

      const body = {};

      if (reasonInput) body.reason = reasonInput.value.trim();
      if (priorityInput) body.priority = priorityInput.value;

      if (reasonInput && Array.from(body.reason).length < 3) {
        errorBox.textContent = 'Please provide a reason with at least 3 characters.';
        errorBox.hidden = false;
        reasonInput.focus();
        return;
      }

      submitting = true;
      errorBox.hidden = true;
      errorBox.textContent = '';

      for (const control of section.querySelectorAll('button, textarea, select')) {
        control.disabled = true;
      }

      button.textContent = 'Saving…';

      try {
        await apiRequest(
          `/maintenance-requests/${encodeURIComponent(request.id)}/${action.action}`,
          { method: 'PATCH', body }
        );

        if (!active) return;
        await onUpdated();
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
          button.textContent = action.label;

          for (const control of section.querySelectorAll('button, textarea, select')) {
            control.disabled = false;
          }
        }
      }
    });
  }

  return () => {
    active = false;
    section.remove();
  };
}
