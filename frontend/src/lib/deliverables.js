// Milestone deliverables (issue #57): what a team may hand in, and the
// words for each state. The same rules live in
// supabase/45_milestone_deliverables.sql — the bucket's limits, the upload
// policy, and submit_deliverable(). These are the browser's copy, so a wrong
// file is refused before it's uploaded; the database is still the boundary.
//
// The error strings are the database's, word for word. client.js's mock and
// real paths both throw them, so a component never has to know which ran.

export const DELIVERABLE_MAX_BYTES = 25 * 1024 * 1024;

// Extension → the MIME type the upload is sent with. The browser's own
// File.type isn't used: Windows without Office reports '' for a .docx, and
// the bucket would refuse it.
export const DELIVERABLE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// For <input accept>. A hint to the picker only — validateDeliverableFile()
// is the check, since "All files" is one click away in every OS dialog.
export const DELIVERABLE_ACCEPT = Object.entries(DELIVERABLE_TYPES)
  .flatMap(([ext, type]) => [`.${ext}`, type])
  .join(',');

export const FILE_NAME_MAX = 200;
export const LINK_MAX = 2000;
export const COMMENT_MAX = 2000;

export const WRONG_TYPE = 'Upload a PDF, DOCX or PPTX file';
export const TOO_LARGE = 'Files can be at most 25 MB';
export const EMPTY_FILE = "That file is empty or hasn't finished uploading";
export const BAD_LINK = 'Paste a full link that starts with http:// or https://';
export const LINK_TOO_LONG = `Keep the link to ${LINK_MAX} characters or fewer`;
export const NOTHING_CHOSEN = 'Choose a file or paste a link';
export const NAME_TOO_LONG = `Keep the file name to ${FILE_NAME_MAX} characters or fewer`;
export const BAD_NAME = "The file name can't contain hidden or control characters";
export const COMMENT_EMPTY = 'Write a comment first';
export const COMMENT_TOO_LONG = `Keep the comment to ${COMMENT_MAX} characters or fewer`;
export const BAD_COMMENT = "The comment can't contain hidden or control characters";

// Same character classes as the SQL: control characters, and the invisible
// ones (zero-width, bidirectional overrides) that make a name read
// differently from what's stored — "Report‮xcod.docx" shows as
// "Reportdocx.exe".
const CONTROL = /[\x00-\x1F\x7F]/;
const COMMENT_CONTROL = /[\x01-\x08\x0B-\x1F\x7F]/;
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/;

// Trimmed first: "Report.docx " must give 'docx', not 'docx ', or the upload
// path stops matching the policy's pattern and the content type is lost.
export function fileExtension(name) {
  const match = /\.([^./\\]+)$/.exec((name ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

// null when the file may be uploaded, otherwise the sentence to show. Type
// before size: a 40 MB .zip is wrong for being a .zip, and saying "too
// large" would send them off to shrink it.
export function validateDeliverableFile(file) {
  if (!file) return NOTHING_CHOSEN;
  const name = (file.name ?? '').trim();
  if (!Object.hasOwn(DELIVERABLE_TYPES, fileExtension(name))) return WRONG_TYPE;
  if (!(file.size > 0)) return EMPTY_FILE;
  if (file.size > DELIVERABLE_MAX_BYTES) return TOO_LARGE;
  if (name.length > FILE_NAME_MAX) return NAME_TOO_LONG;
  if (CONTROL.test(name) || INVISIBLE.test(name)) return BAD_NAME;
  return null;
}

// The SQL's pattern: a scheme, a host with a dot, no whitespace.
const LINK_PATTERN = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/i;

export function validateDeliverableLink(raw) {
  const link = (raw ?? '').trim();
  if (link === '') return NOTHING_CHOSEN;
  if (link.length > LINK_MAX) return LINK_TOO_LONG;
  if (!LINK_PATTERN.test(link)) return BAD_LINK;
  return null;
}

// Normalised as post_deliverable_comment() does it, so the length counted
// here is the length the database counts.
export function normaliseComment(raw) {
  return (raw ?? '').replace(/\r\n?/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

export function validateComment(raw) {
  const body = normaliseComment(raw);
  if (body === '') return COMMENT_EMPTY;
  if ([...body].length > COMMENT_MAX) return COMMENT_TOO_LONG;
  if (COMMENT_CONTROL.test(body) || INVISIBLE.test(body)) return BAD_COMMENT;
  return null;
}

// What each status reads as. 'not_submitted' isn't stored anywhere: it is a
// deliverable with no versions.
export const DELIVERABLE_STATUS = {
  not_submitted: { label: 'Not submitted', tone: 'quiet' },
  submitted: { label: 'Submitted', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
};

export function formatBytes(bytes) {
  if (!(bytes >= 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}
