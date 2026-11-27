import { mountPortalWorkspace } from './portalWorkspace.js';
import './style.css';

const loginView = document.querySelector('#loginView');
const portalView = document.querySelector('#portalView');
const loginForm = document.querySelector('#loginForm');
const loginButton = document.querySelector('#loginButton');
const logoutButton = document.querySelector('#logoutButton');
const loginError = document.querySelector('#loginError');
const portalError = document.querySelector('#portalError');

let accessToken = null;
let expiryTimer = null;
let cleanupMaintenanceWorkspace = null;

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function showLogin(message = '') {
  cleanupMaintenanceWorkspace?.();
  cleanupMaintenanceWorkspace = null;
  clearTimeout(expiryTimer);
  accessToken = null;

  document.querySelector('#welcomeTitle').textContent = '';
  document.querySelector('#profileEmail').textContent = '';
  document.querySelector('#profileRole').textContent = '';

  portalView.hidden = true;
  loginView.hidden = false;
  loginForm.reset();

  showError(portalError, '');
  showError(loginError, message);
  document.querySelector('#login').focus();
}

// Same-origin proxy prefixes for each backend. Requests never carry
// service credentials; only the signed-in user's in-memory token.
const API_BASES = {
  maintenance: '/maintenance-api',
  community: '/community-api'
};

async function apiRequest(path, {
  method = 'GET',
  body,
  service = 'maintenance',
  headers: extraHeaders = {}
} = {}) {
  const base = API_BASES[service];

  if (!base) {
    throw new Error('Unknown service.');
  }

  const headers = { Accept: 'application/json', ...extraHeaders };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response;

  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error('Cannot reach the service. Please try again.');
  }

  if (response.status === 204) {
    return null;
  }

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const message = response.status === 401
      ? 'Your sign-in details are incorrect or your session has expired.'
      : response.status === 429
        ? 'Too many attempts. Please try again later.'
        : result?.error?.message || 'The request could not be completed.';

    const error = new Error(message);
    error.status = response.status;
    error.code = result?.error?.code;
    throw error;
  }

  if (!result || !Object.hasOwn(result, 'data')) {
    throw new Error('The service returned an unexpected response.');
  }

  return result.data;
}

function showPortal(user) {
  document.querySelector('#welcomeTitle').textContent =
    `Hello, ${user.fullName}`;

  document.querySelector('#profileEmail').textContent = user.email;
  document.querySelector('#profileRole').textContent =
    user.role === 'ADMIN' ? 'Administrator' : 'Resident';

  showError(loginError, '');
  loginView.hidden = true;
  portalView.hidden = false;

  document.querySelector('#welcomeTitle').tabIndex = -1;
  document.querySelector('#welcomeTitle').focus();

  cleanupMaintenanceWorkspace?.();

  cleanupMaintenanceWorkspace = mountPortalWorkspace({
    apiRequest,
    user,
    onUnauthorized: () =>
      showLogin('Your session has expired. Please sign in again.')
  });
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (loginButton.disabled) {
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';
  showError(loginError, '');

  try {
    const session = await apiRequest('/auth/login', {
      method: 'POST',
      body: {
        login: document.querySelector('#login').value.trim(),
        password: document.querySelector('#password').value
      }
    });

    if (typeof session.accessToken !== 'string' ||
        !/^[a-f0-9]{64}$/.test(session.accessToken)) {
      throw new Error('The service returned an invalid session.');
    }

    const expiresAt = Date.parse(session.expiresAt);

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
        expiresAt - Date.now() > 2147483647) {
      throw new Error('The service returned an invalid session expiry.');
    }

    accessToken = session.accessToken;
    document.querySelector('#password').value = '';

    const user = await apiRequest('/auth/me');

    if (!user || !['ADMIN', 'RESIDENT'].includes(user.role)) {
      throw new Error('The service returned an invalid user profile.');
    }

    showPortal(user);

    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(
      () => showLogin('Your session has expired. Please sign in again.'),
      Math.max(0, expiresAt - Date.now())
    );
  } catch (error) {
    accessToken = null;
    document.querySelector('#password').value = '';
    showError(loginError, error.message);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  showError(portalError, '');

  try {
    await apiRequest('/auth/logout', { method: 'POST' });
    showLogin();
  } catch (error) {
    if (error.status === 401) {
      showLogin('Your session has expired. Please sign in again.');
    } else {
      showError(portalError, error.message);
    }
  } finally {
    logoutButton.disabled = false;
  }
});


