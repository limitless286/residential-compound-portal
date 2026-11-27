// Shared helpers for the community pages (fees and announcements).
// All dynamic text is set with textContent, never innerHTML.

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function button(label, className = 'button secondary') {
  const node = el('button', label, className);
  node.type = 'button';
  return node;
}

const moneyFormat = new Intl.NumberFormat('en-EG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatMoney(amountMinor, currency = 'EGP') {
  return moneyFormat.format(amountMinor / 100) + ' ' + currency;
}

// "1500" or "1500.5" or "1500.50" -> 150050. Returns null when invalid.
export function parseMoneyToMinor(value) {
  const text = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const [pounds, piastres = ''] = text.split('.');
  return Number(pounds) * 100 + Number(piastres.padEnd(2, '0'));
}

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Cairo'
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'Africa/Cairo'
});

export function formatDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : '—';
}

// For YYYY-MM-DD calendar dates (no time zone shift).
export function formatCalendarDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return dateFormat.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

// datetime-local value (browser local time) -> UTC ISO string.
export function localInputToIso(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function isoToLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function statusBadge(status) {
  return el('span', status.replace('_', ' '), 'badge community-badge community-' + status.toLowerCase());
}

/**
 * Keeps one Idempotency-Key per logical submission. Retrying the same
 * payload after a failure reuses the key, so a lost response cannot create
 * a duplicate. A different payload, or a success, starts a new key.
 */
export function createIdempotentSubmitter() {
  let pending = null;

  return {
    keyFor(payload) {
      const fingerprint = JSON.stringify(payload);
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = { fingerprint, key: crypto.randomUUID() };
      }
      return pending.key;
    },
    succeeded() {
      pending = null;
    }
  };
}

export function showMessage(node, text, isError = false) {
  node.textContent = text || '';
  node.hidden = !text;
  node.className = isError ? 'error-message' : 'community-notice';
  node.setAttribute('role', isError ? 'alert' : 'status');
}

// Runs an action, routing 401 to the session-expiry handler.
export async function guarded(action, { onUnauthorized, messageNode }) {
  try {
    return await action();
  } catch (error) {
    if (error.status === 401) {
      onUnauthorized();
      return undefined;
    }
    if (messageNode) showMessage(messageNode, error.message, true);
    return undefined;
  }
}
