/* ==========================================================================
   context-menu.js — Pure helpers for the browser context-menu integration
   --------------------------------------------------------------------------
   Framework-free, side-effect-free. Builds note payloads from untrusted page
   data (title / URL / selected text) as PLAIN TEXT only — never HTML — and
   validates internal StudyFlow deep-link URLs. Fully unit-testable in Node.
   ========================================================================== */

export const MENU_IDS = Object.freeze({
  PARENT: 'studyflow_root',
  SAVE_PAGE: 'studyflow_save_page',
  SAVE_SELECTION: 'studyflow_save_selection'
});

// The only origin we will ever open a tab to.
export const STUDYFLOW_ORIGIN = 'https://studyflow-productivity.netlify.app';

/** Coerces any value to a trimmed plain string (never HTML, never undefined). */
export function toPlainText(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Derives a human-friendly title, falling back to the page's hostname when the
 * tab title is unavailable (e.g. no tabs permission). Never returns empty.
 */
export function deriveTitle(pageTitle, url) {
  const title = toPlainText(pageTitle);
  if (title) return title;
  try {
    return new URL(url).hostname || 'Untitled Note';
  } catch {
    return 'Untitled Note';
  }
}

/**
 * Builds a note payload for "Save page as Note".
 * Matches the existing notes schema: { title, content, tags } (plain text).
 */
export function buildPageNotePayload({ title, url }) {
  const safeUrl = toPlainText(url);
  return {
    title: deriveTitle(title, safeUrl),
    content: `Source: ${safeUrl}`,
    tags: ['web-clip']
  };
}

/**
 * Builds a note payload for "Save selected text as Note".
 * Selected text and page metadata are treated as untrusted plain text.
 */
export function buildSelectionNotePayload({ selectionText, title, url }) {
  const text = toPlainText(selectionText);
  const safeUrl = toPlainText(url);
  const safeTitle = deriveTitle(title, safeUrl);
  return {
    title: safeTitle,
    content: `${text}\n\nSource:\n${safeTitle}\n${safeUrl}`,
    tags: ['web-clip']
  };
}

/**
 * True only for an https URL on the StudyFlow production origin.
 * Rejects javascript:, data:, other hosts, and malformed input — no open redirect.
 */
export function isSafeStudyFlowUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.origin === STUDYFLOW_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Builds a validated deep link to a created note. Returns null if anything is
 * unsafe (never fabricates a route on an untrusted origin).
 */
export function buildNoteDeepLink(noteId) {
  const id = toPlainText(noteId);
  if (!id) return null;
  const link = `${STUDYFLOW_ORIGIN}/pages/notes.html?noteId=${encodeURIComponent(id)}`;
  return isSafeStudyFlowUrl(link) ? link : null;
}

/** URL of the notes list page (fallback when no note id / deep link). */
export function notesPageUrl() {
  return `${STUDYFLOW_ORIGIN}/pages/notes.html`;
}

/** URL of the sign-in page for the signed-out flow. */
export function authPageUrl() {
  return `${STUDYFLOW_ORIGIN}/pages/auth.html`;
}

export default {
  MENU_IDS,
  STUDYFLOW_ORIGIN,
  toPlainText,
  deriveTitle,
  buildPageNotePayload,
  buildSelectionNotePayload,
  isSafeStudyFlowUrl,
  buildNoteDeepLink,
  notesPageUrl,
  authPageUrl
};
