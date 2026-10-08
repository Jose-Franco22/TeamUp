// The whole pipeline, in one call, for the Node tools.
//
//   file bytes -> toDocument -> parseDocument
//
// The app calls the same parseDocument with its own reader and its own skills
// table; see frontend/src/lib/resume/.

import { skills } from '../../frontend/src/api/mockData.js';
import { parseDocument, toProfileRows } from '../../frontend/src/lib/resume/parse.js';
import { toDocument } from './toDocument.mjs';

export { toProfileRows };

export async function parseResume(input, { name = '', dictionary, now = new Date() } = {}) {
  const doc = await toDocument(input, { name });
  const parsed = parseDocument(doc, { table: skills, dictionary, now });
  return { file: name, ...parsed };
}
