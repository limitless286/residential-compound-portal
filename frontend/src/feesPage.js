import './community.css';
import {
  button,
  createIdempotentSubmitter,
  el,
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  guarded,
  localInputToIso,
  parseMoneyToMinor,
  showMessage,
  statusBadge
} from './communityUi.js';

const PAGE_SIZE = 20;

export function mountFeesPage({ container, apiRequest, user, onUnauthorized }) {
  const isAdmin = user.role === 'ADMIN';
  const call = (path, options = {}) =>
    apiRequest(path, { ...options, service: 'community' });

  const root = el('div', undefined, 'community-page');
  container.append(root);

  let active = true;
  const handlers = { onUnauthorized: () => active && onUnauthorized() };

  const heading = el('div', undefined, 'section-heading');
  const headingText = el('div');
  headingText.append(
    el('h2', 'Service fees'),
    el('p', isAdmin
      ? 'Configure monthly fees, generate invoices and record offline payments.'
      : 'Monthly service-fee invoices and payments for your unit.', 'muted')
  );
  heading.append(headingText);
  root.append(heading);

  // ---------- Admin: fee policy ----------
  function mountPolicyPanel() {
    const panel = el('section', undefined, 'community-card');
    panel.innerHTML = `
      <h3>Fee policy</h3>
      <p class="muted">The amount and due day used for newly generated invoices.</p>
      <form class="community-form" data-policy-form novalidate>
        <div class="field">
          <label for="feeAmount">Monthly amount (EGP)</label>
          <input id="feeAmount" name="amount" inputmode="decimal" required />
        </div>
        <div class="field">
          <label for="feeDueDay">Due day of month (1–28)</label>
          <input id="feeDueDay" name="dueDay" type="number" min="1" max="28" required />
        </div>
        <button class="button primary" type="submit">Save policy</button>
      </form>
      <p data-message hidden></p>
    `;
    root.append(panel);

    const form = panel.querySelector('[data-policy-form]');
    const message = panel.querySelector('[data-message]');

    guarded(async () => {
      try {
        const policy = await call('/admin/fee-policy');
        if (!active) return;
        form.amount.value = (policy.monthlyAmountMinor / 100).toFixed(2);
        form.dueDay.value = policy.dueDay;
        showMessage(message, 'Last updated ' + formatDateTime(policy.updatedAt) + ' · Cairo');
      } catch (error) {
        if (error.status !== 404) throw error;
        showMessage(message, 'No fee policy yet. Set one before generating invoices.');
      }
    }, { ...handlers, messageNode: message });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const amountMinor = parseMoneyToMinor(form.amount.value);
      const dueDay = Number(form.dueDay.value);

      if (amountMinor === null || amountMinor < 1) {
        showMessage(message, 'Enter an amount such as 1500 or 1500.50.', true);
        return;
      }
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
        showMessage(message, 'The due day must be between 1 and 28.', true);
        return;
      }

      const submit = form.querySelector('button');
      submit.disabled = true;
      await guarded(async () => {
        const saved = await call('/admin/fee-policy', {
          method: 'PUT',
          body: { monthlyAmountMinor: amountMinor, currency: 'EGP', dueDay }
        });
        if (active) showMessage(message, 'Saved: ' + formatMoney(saved.monthlyAmountMinor) + ', due on day ' + saved.dueDay + '.');
      }, { ...handlers, messageNode: message });
      submit.disabled = false;
    });
  }

  // ---------- Admin: invoice generation ----------
  function mountGenerationPanel() {
    const panel = el('section', undefined, 'community-card');
    panel.innerHTML = `
      <h3>Generate monthly invoices</h3>
      <p class="muted">Creates one invoice for every active unit. Units that already have an invoice for the month are skipped.</p>
      <form class="community-form" data-generation-form novalidate>
        <div class="field">
          <label for="billingPeriod">Billing month</label>
          <input id="billingPeriod" name="billingPeriod" type="month" required />
        </div>
        <button class="button primary" type="submit">Generate invoices</button>
      </form>
      <p data-message hidden></p>
    `;
    root.append(panel);

    const form = panel.querySelector('[data-generation-form]');
    const message = panel.querySelector('[data-message]');
    const submitter = createIdempotentSubmitter();
    form.billingPeriod.value = new Date().toISOString().slice(0, 7);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const billingPeriod = form.billingPeriod.value;

      if (!/^\d{4}-\d{2}$/.test(billingPeriod)) {
        showMessage(message, 'Choose a billing month.', true);
        return;
      }

      const payload = { billingPeriod };
      const submit = form.querySelector('button');
      submit.disabled = true;
      showMessage(message, 'Generating invoices…');

      await guarded(async () => {
        const result = await call('/admin/invoice-generations', {
          method: 'POST',
          body: payload,
          headers: { 'Idempotency-Key': submitter.keyFor(payload) }
        });
        submitter.succeeded();
        if (!active) return;
        showMessage(message,
          `${result.billingPeriod}: ${result.createdCount} created, ${result.skippedCount} already existed ` +
          `(${result.activeUnitCount} active units, ${formatMoney(result.monthlyAmountMinor, result.currency)} due ${formatCalendarDate(result.dueDate)}).`);
        invoices.reload();
      }, { ...handlers, messageNode: message });

      submit.disabled = false;
    });
  }

  // ---------- Admin: payment recording ----------
  let paymentPanel = null;

  function mountPaymentPanel() {
    const panel = el('section', undefined, 'community-card');
    panel.innerHTML = `
      <h3>Record offline payment</h3>
      <p class="muted">Cash or bank transfer only. Partial payments are allowed; overpayments are rejected.</p>
      <form class="community-form" data-payment-form novalidate>
        <div class="field">
          <label for="paymentInvoice">Invoice</label>
          <input id="paymentInvoice" name="invoiceId" readonly placeholder="Select an invoice below" required />
          <p class="field-help" data-invoice-summary></p>
        </div>
        <div class="field">
          <label for="paymentAmount">Amount (EGP)</label>
          <input id="paymentAmount" name="amount" inputmode="decimal" required />
        </div>
        <div class="field">
          <label for="paymentMethod">Method</label>
          <select id="paymentMethod" name="paymentMethod">
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </div>
        <div class="field">
          <label for="paymentReference">Receipt or transfer reference</label>
          <input id="paymentReference" name="paymentReference" maxlength="100" required />
        </div>
        <div class="field">
          <label for="paymentPaidAt">Paid at</label>
          <input id="paymentPaidAt" name="paidAt" type="datetime-local" required />
        </div>
        <button class="button primary" type="submit">Record payment</button>
      </form>
      <p data-message hidden></p>
    `;
    root.append(panel);

    const form = panel.querySelector('[data-payment-form]');
    const message = panel.querySelector('[data-message]');
    const summary = panel.querySelector('[data-invoice-summary]');
    const submitter = createIdempotentSubmitter();

    function select(invoice) {
      form.invoiceId.value = invoice.id;
      summary.textContent = `Unit ${invoice.unitId.slice(0, 8)} · ${invoice.billingPeriod} · remaining ${formatMoney(invoice.remainingAmountMinor, invoice.currency)}`;
      form.amount.value = (invoice.remainingAmountMinor / 100).toFixed(2);
      form.paidAt.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      showMessage(message, '');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.amount.focus();
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const amountMinor = parseMoneyToMinor(form.amount.value);
      const paidAt = localInputToIso(form.paidAt.value);
      const paymentReference = form.paymentReference.value.trim();

      if (!form.invoiceId.value) return showMessage(message, 'Select an invoice from the list below.', true);
      if (amountMinor === null || amountMinor < 1) return showMessage(message, 'Enter an amount such as 500 or 500.25.', true);
      if (!paymentReference) return showMessage(message, 'Enter the receipt or transfer reference.', true);
      if (!paidAt) return showMessage(message, 'Enter when the payment was made.', true);

      const payload = {
        invoiceId: form.invoiceId.value,
        amountMinor,
        paymentReference,
        paymentMethod: form.paymentMethod.value,
        paidAt
      };

      const submit = form.querySelector('button');
      submit.disabled = true;

      await guarded(async () => {
        const result = await call('/admin/payments', {
          method: 'POST',
          body: payload,
          headers: { 'Idempotency-Key': submitter.keyFor(payload) }
        });
        submitter.succeeded();
        if (!active) return;
        showMessage(message,
          `Recorded ${formatMoney(result.payment.amountMinor)}. Invoice is now ${result.invoice.status.replace('_', ' ')}, ` +
          `remaining ${formatMoney(result.invoice.remainingAmountMinor)}.`);
        form.paymentReference.value = '';
        invoices.reload();
        overdue?.reload();
      }, { ...handlers, messageNode: message });

      submit.disabled = false;
    });

    return { select };
  }

  // ---------- Admin: overdue summary ----------
  let overdue = null;

  function mountOverduePanel() {
    const panel = el('section', undefined, 'community-card');
    const title = el('h3', 'Overdue invoices');
    const totals = el('p', 'Loading…', 'muted');
    const list = el('ul', undefined, 'overdue-list');
    const message = el('p');
    message.hidden = true;
    panel.append(title, totals, list, message);
    root.append(panel);

    async function reload() {
      await guarded(async () => {
        const data = await call('/admin/overdue-invoices?limit=10');
        if (!active) return;
        totals.textContent = data.overdueCount === 0
          ? 'No overdue invoices.'
          : `${data.overdueCount} overdue · ${formatMoney(data.totalRemainingMinor)} outstanding`;
        list.replaceChildren(...data.invoices.map((invoice) => {
          const item = el('li');
          const info = el('div');
          info.append(
            el('strong', `${invoice.billingPeriod} · unit ${invoice.unitId.slice(0, 8)}`),
            el('span', `Due ${formatCalendarDate(invoice.dueDate)} · remaining ${formatMoney(invoice.remainingAmountMinor)}`, 'muted')
          );
          const pay = button('Record payment', 'button table-button');
          pay.addEventListener('click', () => paymentPanel.select(invoice));
          item.append(info, pay);
          return item;
        }));
      }, { ...handlers, messageNode: message });
    }

    reload();
    return { reload };
  }

  // ---------- Invoices list and detail (both roles) ----------
  function mountInvoices() {
    const panel = el('section', undefined, 'community-card');
    panel.append(el('h3', isAdmin ? 'All invoices' : 'Your invoices'));

    const filters = el('form', undefined, 'request-filters community-filters');
    if (isAdmin) {
      filters.innerHTML = `
        <div class="field"><label for="filterPeriod">Month</label><input id="filterPeriod" name="billingPeriod" type="month" /></div>
        <div class="field"><label for="filterStatus">Status</label>
          <select id="filterStatus" name="status">
            <option value="">Any</option><option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially paid</option><option value="PAID">Paid</option>
          </select></div>
        <div class="field"><label for="filterOverdue">Overdue</label>
          <select id="filterOverdue" name="overdue">
            <option value="">Any</option><option value="true">Overdue only</option><option value="false">Not overdue</option>
          </select></div>
        <button class="button secondary" type="submit">Apply</button>
      `;
      panel.append(filters);
    }

    const message = el('p');
    message.hidden = true;
    const tableWrap = el('div', undefined, 'table-scroll');
    const table = el('table', undefined, 'requests-table');
    table.innerHTML = `<thead><tr>
      <th>Month</th>${isAdmin ? '<th>Unit</th>' : ''}<th>Amount</th><th>Paid</th>
      <th>Remaining</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody></tbody>`;
    tableWrap.append(table);

    const pager = el('div', undefined, 'pagination');
    const previous = button('Previous');
    const next = button('Next');
    const pageInfo = el('span', '', 'muted');
    pager.append(previous, pageInfo, next);

    const detail = el('div', undefined, 'community-detail');
    detail.hidden = true;

    panel.append(message, tableWrap, pager, detail);
    root.append(panel);

    let offset = 0;
    let version = 0;

    function query() {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (isAdmin) {
        for (const name of ['billingPeriod', 'status', 'overdue']) {
          if (filters[name].value) params.set(name, filters[name].value);
        }
      }
      return params.toString();
    }

    async function reload() {
      const current = ++version;
      showMessage(message, '');

      await guarded(async () => {
        const data = await call('/invoices?' + query());
        if (!active || current !== version) return;

        const body = table.querySelector('tbody');
        body.replaceChildren(...data.invoices.map((invoice) => {
          const row = el('tr');
          const cells = [invoice.billingPeriod];
          if (isAdmin) cells.push(invoice.unitId.slice(0, 8));
          cells.push(
            formatMoney(invoice.amountMinor, invoice.currency),
            formatMoney(invoice.paidAmountMinor, invoice.currency),
            formatMoney(invoice.remainingAmountMinor, invoice.currency),
            formatCalendarDate(invoice.dueDate)
          );
          for (const value of cells) row.append(el('td', value));

          const status = el('td');
          status.append(statusBadge(invoice.status));
          if (invoice.isOverdue) status.append(' ', el('span', 'OVERDUE', 'badge community-overdue'));
          row.append(status);

          const actions = el('td', undefined, 'community-actions');
          const view = button('Details', 'button table-button');
          view.addEventListener('click', () => showDetail(invoice.id));
          actions.append(view);
          if (isAdmin && invoice.remainingAmountMinor > 0) {
            const pay = button('Pay', 'button table-button');
            pay.addEventListener('click', () => paymentPanel.select(invoice));
            actions.append(pay);
          }
          row.append(actions);
          return row;
        }));

        if (data.invoices.length === 0) {
          const row = el('tr');
          const cell = el('td', 'No invoices to show.', 'muted');
          cell.colSpan = isAdmin ? 8 : 7;
          row.append(cell);
          body.append(row);
        }

        previous.disabled = offset === 0;
        next.disabled = data.nextOffset === null;
        pageInfo.textContent = data.invoices.length
          ? `${offset + 1}–${offset + data.invoices.length}`
          : '';
      }, { ...handlers, messageNode: message });
    }

    async function showDetail(invoiceId) {
      await guarded(async () => {
        const invoice = await call('/invoices/' + encodeURIComponent(invoiceId));
        if (!active) return;

        detail.replaceChildren(
          el('h4', `Invoice ${invoice.billingPeriod}`),
          el('p', `${formatMoney(invoice.amountMinor, invoice.currency)} due ${formatCalendarDate(invoice.dueDate)} · paid ${formatMoney(invoice.paidAmountMinor)} · remaining ${formatMoney(invoice.remainingAmountMinor)}`, 'muted')
        );

        if (invoice.payments.length === 0) {
          detail.append(el('p', 'No payments recorded yet.', 'muted'));
        } else {
          const list = el('ul', undefined, 'community-payments');
          for (const payment of invoice.payments) {
            list.append(el('li',
              `${formatDateTime(payment.paidAt)} · ${formatMoney(payment.amountMinor)} · ` +
              `${payment.paymentMethod === 'CASH' ? 'Cash' : 'Bank transfer'} · ref ${payment.paymentReference}`));
          }
          detail.append(list);
        }

        const close = button('Close details');
        close.addEventListener('click', () => { detail.hidden = true; });
        detail.append(close);
        detail.hidden = false;
      }, { ...handlers, messageNode: message });
    }

    if (isAdmin) {
      filters.addEventListener('submit', (event) => {
        event.preventDefault();
        offset = 0;
        reload();
      });
    }

    previous.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); reload(); });
    next.addEventListener('click', () => { offset += PAGE_SIZE; reload(); });

    reload();
    return { reload };
  }

  if (isAdmin) {
    mountPolicyPanel();
    mountGenerationPanel();
    paymentPanel = mountPaymentPanel();
    overdue = mountOverduePanel();
  }

  const invoices = mountInvoices();

  return () => {
    active = false;
    root.remove();
  };
}
