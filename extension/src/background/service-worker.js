/* ==========================================================================
   service-worker.js — Background Service Worker (StudyFlow v2.1.0)
   --------------------------------------------------------------------------
   Minimal, event-driven Manifest V3 service worker.
   - Configures the Chrome Side Panel to open when the toolbar action is clicked.
   - Registers the StudyFlow right-click context menu (Save page / selection as
     Note) and handles clicks by delegating cloud writes to the shared API.

   Reusable cloud operations stay in src/shared/api.js; this worker only routes
   click events, checks auth, and opens tabs.
   ========================================================================== */

import * as api from '../shared/api.js';
import * as cm from '../shared/context-menu.js';

/**
 * Configure default side panel behavior on installation / startup.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[StudyFlow] Extension installed / updated:', details.reason);

  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: true
      });
      console.log('[StudyFlow] Side panel configured to open on action click.');
    } catch (err) {
      console.warn('[StudyFlow] Could not set side panel behavior:', err);
    }
  }

  registerContextMenus();
});

/**
 * Fallback action click handler for Chrome versions or environments
 * where openPanelOnActionClick behavior needs explicit triggering.
 */
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') {
      return;
    }

    try {
      if (tab && tab.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch (err) {
      console.warn('[StudyFlow] Failed to open side panel on action click:', err);
    }
  });
}

/* ==========================================================================
   Context Menu Integration
   ========================================================================== */

/**
 * (Re)creates the StudyFlow parent menu and its two children. removeAll first
 * so re-install / update never produces duplicate items. The contextMenus API
 * does not support per-item icons on the stable channel, so none is set; Chrome
 * shows the parent grouping natively.
 */
function registerContextMenus() {
  if (!chrome.contextMenus || typeof chrome.contextMenus.create !== 'function') {
    return;
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: cm.MENU_IDS.PARENT,
      title: 'StudyFlow',
      contexts: ['page', 'selection']
    });
    chrome.contextMenus.create({
      id: cm.MENU_IDS.SAVE_PAGE,
      parentId: cm.MENU_IDS.PARENT,
      title: 'Save page as Note',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: cm.MENU_IDS.SAVE_SELECTION,
      parentId: cm.MENU_IDS.PARENT,
      title: 'Save selected text as Note',
      contexts: ['selection']
    });
  });
}

// Duplicate-click guard: ignore an identical click fired within this window.
const DUPLICATE_WINDOW_MS = 1500;
let _lastClickKey = null;
let _lastClickAt = 0;

function isDuplicateClick(key, now = Date.now()) {
  if (key === _lastClickKey && (now - _lastClickAt) < DUPLICATE_WINDOW_MS) {
    return true;
  }
  _lastClickKey = key;
  _lastClickAt = now;
  return false;
}

/** Opens a URL in a new tab, but only if it is a validated StudyFlow URL. */
async function openStudyFlowUrl(url) {
  if (!cm.isSafeStudyFlowUrl(url)) return;
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.warn('[StudyFlow] Failed to open tab:', err);
  }
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    handleContextMenuClick(info, tab).catch((err) => {
      console.error('[StudyFlow] Context menu action failed:', err);
    });
  });
}

async function handleContextMenuClick(info, tab) {
  const menuId = info && info.menuItemId;
  if (menuId !== cm.MENU_IDS.SAVE_PAGE && menuId !== cm.MENU_IDS.SAVE_SELECTION) {
    return;
  }

  // info.pageUrl is the untrusted source URL; tab.title may be undefined
  // without the "tabs" permission, so deriveTitle falls back to the hostname.
  const pageUrl = (info && info.pageUrl) || (tab && tab.url) || '';
  const pageTitle = (tab && tab.title) || '';
  const selectionText = (info && info.selectionText) || '';

  // One intentional note per user action.
  const key = `${menuId}|${pageUrl}|${selectionText}`;
  if (isDuplicateClick(key)) {
    console.log('[StudyFlow] Ignoring duplicate context-menu click.');
    return;
  }

  // Auth gate: signed out → route to the web auth page, never a cloud write.
  let user = null;
  try {
    user = await api.getCurrentUser();
  } catch {
    user = null;
  }
  if (!user || !user.id) {
    await openStudyFlowUrl(cm.authPageUrl());
    return;
  }

  // Offline: keep the write-blocking policy; do not pretend success.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await openStudyFlowUrl(cm.notesPageUrl());
    return;
  }

  const payload = menuId === cm.MENU_IDS.SAVE_PAGE
    ? cm.buildPageNotePayload({ title: pageTitle, url: pageUrl })
    : cm.buildSelectionNotePayload({ selectionText, title: pageTitle, url: pageUrl });

  try {
    const created = await api.createNote(payload);
    const deepLink = created && created.id ? cm.buildNoteDeepLink(created.id) : null;
    // TEMPORARY diagnostics: confirm the real returned DB id and the exact deep
    // link opened. Remove once the Chrome context-menu flow is verified.
    console.log('[StudyFlow] createNote returned id:', created && created.id, '→ deep link:', deepLink);
    await openStudyFlowUrl(deepLink || cm.notesPageUrl());
  } catch (err) {
    console.error('[StudyFlow] createNote failed:', err);
    // Surface the failure by opening the notes page rather than silently losing it.
    await openStudyFlowUrl(cm.notesPageUrl());
  }
}
