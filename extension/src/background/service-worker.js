/* ==========================================================================
   service-worker.js — Background Service Worker (StudyFlow v2.1.0)
   --------------------------------------------------------------------------
   Minimal, event-driven Manifest V3 service worker.
   Configures the Chrome Side Panel to open when the toolbar action is clicked.
   ========================================================================== */

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
