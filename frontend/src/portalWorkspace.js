import { mountMaintenanceWorkspace } from './maintenancePage.js';
import { mountResidentAdministration } from './residentsPage.js';
import { mountPropertiesPage } from './propertiesPage.js';
import { mountFeesPage } from './feesPage.js';
import { mountAnnouncementsPage } from './announcementsPage.js';

export function mountPortalWorkspace({ apiRequest, user, onUnauthorized }) {
  const root = document.createElement('div');
  root.className = 'portal-workspace-pages';

  const navigation = document.createElement('nav');
  navigation.className = 'workspace-navigation';
  navigation.setAttribute('aria-label', 'Workspace sections');
  root.append(navigation);

  document.querySelector('.workspace').append(root);

  const pages = new Map();
  const buttons = new Map();
  const cleanups = new Map();

  function registerPage(key, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-nav-button';
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');

    const page = document.createElement('div');
    page.hidden = true;

    navigation.append(button);
    root.append(page);
    pages.set(key, page);
    buttons.set(key, button);

    button.addEventListener('click', () => selectPage(key));
  }

  function selectPage(key) {
    for (const [pageKey, page] of pages) {
      page.hidden = pageKey !== key;
      buttons.get(pageKey).setAttribute(
        'aria-pressed',
        String(pageKey === key)
      );
    }

    if (cleanups.has(key)) return;

    const options = {
      container: pages.get(key),
      apiRequest,
      user,
      onUnauthorized
    };

    const mount = {
      maintenance: mountMaintenanceWorkspace,
      residents: mountResidentAdministration,
      properties: mountPropertiesPage,
      fees: mountFeesPage,
      announcements: mountAnnouncementsPage
    }[key];

    cleanups.set(key, mount(options));
  }

  registerPage('maintenance', 'Maintenance');
  registerPage('fees', 'Fees');
  registerPage('announcements', 'Announcements');

  if (user.role === 'ADMIN') {
    registerPage('residents', 'Residents');
    registerPage('properties', 'Buildings & units');
  }

  selectPage('maintenance');

  return () => {
    for (const cleanup of cleanups.values()) cleanup();
    root.remove();
  };
}
