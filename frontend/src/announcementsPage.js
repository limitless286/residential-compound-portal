import './community.css';
import {
  button,
  el,
  formatDateTime,
  guarded,
  isoToLocalInput,
  localInputToIso,
  showMessage,
  statusBadge
} from './communityUi.js';

const PAGE_SIZE = 20;

export function mountAnnouncementsPage({ container, apiRequest, user, onUnauthorized }) {
  const isAdmin = user.role === 'ADMIN';
  const call = (path, options = {}) =>
    apiRequest(path, { ...options, service: 'community' });

  const root = el('div', undefined, 'community-page');
  container.append(root);

  let active = true;
  const handlers = { onUnauthorized: () => active && onUnauthorized() };
  let buildings = new Map();

  const heading = el('div', undefined, 'section-heading');
  const headingText = el('div');
  headingText.append(
    el('h2', 'Announcements'),
    el('p', isAdmin
      ? 'Draft, approve and schedule announcements for the whole compound or one building.'
      : 'Current announcements for your compound and building.', 'muted')
  );
  heading.append(headingText);
  root.append(heading);

  function buildingLabel(id) {
    if (!id) return 'Everyone';
    // Residents only ever see their own building's announcements.
    if (!isAdmin) return 'Your building';
    const building = buildings.get(id);
    return building ? `Building ${building.code} · ${building.name}` : 'One building';
  }

  // ---------- Admin: create draft ----------
  function mountCreatePanel(onCreated) {
    const panel = el('section', undefined, 'community-card');
    panel.innerHTML = `
      <h3>New announcement</h3>
      <p class="muted">Saved as a draft. Nothing is visible to residents until you approve it.</p>
      <form class="community-form community-form-wide" data-create-form novalidate>
        <div class="field">
          <label for="announcementTitle">Title</label>
          <input id="announcementTitle" name="title" minlength="3" maxlength="150" required />
        </div>
        <div class="field">
          <label for="announcementBody">Message</label>
          <textarea id="announcementBody" name="body" rows="4" minlength="10" maxlength="10000" required></textarea>
        </div>
        <div class="field">
          <label for="announcementAudience">Audience</label>
          <select id="announcementAudience" name="audience">
            <option value="ALL">Everyone in the compound</option>
          </select>
        </div>
        <button class="button primary" type="submit">Save draft</button>
      </form>
      <p data-message hidden></p>
    `;
    root.append(panel);

    const form = panel.querySelector('[data-create-form]');
    const message = panel.querySelector('[data-message]');

    function refreshAudienceOptions() {
      const select = form.audience;
      select.replaceChildren(el('option', 'Everyone in the compound'));
      select.firstChild.value = 'ALL';
      for (const building of buildings.values()) {
        const option = el('option', `Building ${building.code} · ${building.name}`);
        option.value = building.id;
        select.append(option);
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = form.title.value.trim();
      const body = form.body.value.trim();

      if (title.length < 3) return showMessage(message, 'The title needs at least 3 characters.', true);
      if (body.length < 10) return showMessage(message, 'The message needs at least 10 characters.', true);

      const audience = form.audience.value;
      const submit = form.querySelector('button');
      submit.disabled = true;

      await guarded(async () => {
        await call('/admin/announcements', {
          method: 'POST',
          body: audience === 'ALL'
            ? { title, body, audienceType: 'ALL', buildingId: null }
            : { title, body, audienceType: 'BUILDING', buildingId: audience }
        });
        if (!active) return;
        form.reset();
        showMessage(message, 'Draft saved. Review and approve it in the list below.');
        onCreated();
      }, { ...handlers, messageNode: message });

      submit.disabled = false;
    });

    return { refreshAudienceOptions };
  }

  // ---------- Admin: one announcement's actions ----------
  function adminActions(announcement, reload, message) {
    const box = el('div', undefined, 'community-announcement-actions');

    const windowForm = el('form', undefined, 'community-inline-form');
    windowForm.noValidate = true;
    const publishField = el('label', 'Publish at ');
    const publishInput = el('input');
    publishInput.type = 'datetime-local';
    publishInput.value = isoToLocalInput(announcement.publishAt);
    publishField.append(publishInput);
    const expiresField = el('label', 'Expires at ');
    const expiresInput = el('input');
    expiresInput.type = 'datetime-local';
    expiresInput.value = isoToLocalInput(announcement.expiresAt);
    expiresField.append(expiresInput);

    const run = (action) => guarded(async () => {
      await action();
      if (active) reload();
    }, { ...handlers, messageNode: message });

    if (announcement.status === 'DRAFT') {
      const publishNow = button('Approve and publish now', 'button primary');
      publishNow.addEventListener('click', () => run(() =>
        call(`/admin/announcements/${announcement.id}/publish`, {
          method: 'POST',
          body: { expiresAt: localInputToIso(expiresInput.value) }
        })));

      const schedule = button('Approve and schedule');
      schedule.addEventListener('click', () => {
        const publishAt = localInputToIso(publishInput.value);
        if (!publishAt) return showMessage(message, 'Choose when to publish.', true);
        return run(() => call(`/admin/announcements/${announcement.id}/publish`, {
          method: 'POST',
          body: { publishAt, expiresAt: localInputToIso(expiresInput.value) }
        }));
      });

      windowForm.append(publishField, expiresField);
      box.append(windowForm, publishNow, schedule);
    }

    if (announcement.status === 'SCHEDULED' || announcement.status === 'PUBLISHED') {
      const save = button('Save schedule');
      save.addEventListener('click', () => {
        const body = { expiresAt: localInputToIso(expiresInput.value) };
        if (announcement.status === 'SCHEDULED') body.publishAt = localInputToIso(publishInput.value);
        return run(() => call(`/admin/announcements/${announcement.id}`, { method: 'PATCH', body }));
      });

      if (announcement.status === 'SCHEDULED') windowForm.append(publishField);
      windowForm.append(expiresField);
      box.append(windowForm, save);
    }

    if (announcement.status === 'PUBLISHED') {
      const end = button('End now');
      end.addEventListener('click', () => run(() =>
        call(`/admin/announcements/${announcement.id}`, {
          method: 'PATCH',
          body: { expiresAt: new Date().toISOString() }
        })));
      box.append(end);
    }

    if (announcement.status !== 'DRAFT') {
      const reads = button(`Read by ${announcement.readCount}`, 'button table-button');
      const readList = el('ul', undefined, 'community-payments');
      readList.hidden = true;
      reads.addEventListener('click', () => guarded(async () => {
        const data = await call(`/admin/announcements/${announcement.id}/reads`);
        if (!active) return;
        readList.replaceChildren(...(data.reads.length
          ? data.reads.map((read) => el('li', `Resident ${read.userId.slice(0, 8)} · ${formatDateTime(read.readAt)}`))
          : [el('li', 'No residents have read this yet.', 'muted')]));
        readList.hidden = !readList.hidden;
      }, { ...handlers, messageNode: message }));
      box.append(reads, readList);
    }

    return box;
  }

  // ---------- List (both roles) ----------
  function mountList() {
    const panel = el('section', undefined, 'community-card');
    panel.append(el('h3', isAdmin ? 'All announcements' : 'Current announcements'));

    let statusFilter = null;
    if (isAdmin) {
      const filterField = el('div', undefined, 'field community-filters');
      const label = el('label', 'Status');
      label.htmlFor = 'announcementStatusFilter';
      statusFilter = el('select');
      statusFilter.id = 'announcementStatusFilter';
      for (const [value, text] of [['', 'Any'], ['DRAFT', 'Draft'], ['SCHEDULED', 'Scheduled'],
        ['PUBLISHED', 'Published'], ['EXPIRED', 'Expired']]) {
        const option = el('option', text);
        option.value = value;
        statusFilter.append(option);
      }
      filterField.append(label, statusFilter);
      panel.append(filterField);
    }

    const message = el('p');
    message.hidden = true;
    const list = el('div', undefined, 'community-announcements');
    const pager = el('div', undefined, 'pagination');
    const previous = button('Previous');
    const next = button('Next');
    pager.append(previous, next);
    panel.append(message, list, pager);
    root.append(panel);

    let offset = 0;
    let version = 0;

    function renderAnnouncement(announcement) {
      const card = el('article', undefined, 'community-announcement' +
        (!isAdmin && !announcement.isRead ? ' community-unread' : ''));

      const top = el('div', undefined, 'community-announcement-top');
      top.append(el('h4', announcement.title));
      if (isAdmin) top.append(statusBadge(announcement.status));
      else if (!announcement.isRead) top.append(el('span', 'NEW', 'badge community-new'));
      card.append(top);

      card.append(el('p', [
        buildingLabel(announcement.buildingId),
        announcement.publishAt ? 'from ' + formatDateTime(announcement.publishAt) : 'not scheduled',
        announcement.expiresAt ? 'until ' + formatDateTime(announcement.expiresAt) : null
      ].filter(Boolean).join(' · '), 'muted'));

      const text = el('p', announcement.body, 'community-announcement-body');
      card.append(text);

      if (isAdmin) {
        if (announcement.maintenanceRequestId) {
          card.append(el('p', 'Drafted from a maintenance request.', 'field-help'));
        }
        card.append(adminActions(announcement, reload, message));
      } else if (!announcement.isRead) {
        const markRead = button('Mark as read');
        markRead.addEventListener('click', () => guarded(async () => {
          await call(`/announcements/${announcement.id}/read`, { method: 'POST' });
          if (active) reload();
        }, { ...handlers, messageNode: message }));
        card.append(markRead);
      }

      return card;
    }

    async function reload() {
      const current = ++version;
      showMessage(message, '');

      await guarded(async () => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (statusFilter?.value) params.set('status', statusFilter.value);

        const data = await call('/announcements?' + params);
        if (!active || current !== version) return;

        list.replaceChildren(...(data.announcements.length
          ? data.announcements.map(renderAnnouncement)
          : [el('p', isAdmin ? 'No announcements yet.' : 'There are no current announcements.', 'muted')]));

        previous.disabled = offset === 0;
        next.disabled = data.nextOffset === null;
      }, { ...handlers, messageNode: message });
    }

    statusFilter?.addEventListener('change', () => { offset = 0; reload(); });
    previous.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); reload(); });
    next.addEventListener('click', () => { offset += PAGE_SIZE; reload(); });

    return { reload };
  }

  const list = mountList();

  if (isAdmin) {
    const creator = mountCreatePanel(() => list.reload());
    // Creation form above the list.
    root.insertBefore(root.lastChild, root.children[1]);

    guarded(async () => {
      const data = await apiRequest('/admin/buildings?limit=100');
      if (!active) return;
      buildings = new Map(data.buildings.map((building) => [building.id, building]));
      creator.refreshAudienceOptions();
      list.reload();
    }, handlers).then(() => {
      // Still show the list if buildings could not be loaded.
      if (active && buildings.size === 0) list.reload();
    });
  } else {
    list.reload();
  }

  return () => {
    active = false;
    root.remove();
  };
}
