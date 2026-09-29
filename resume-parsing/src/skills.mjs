// Lives in the frontend so the app and these tools share one implementation.
//
// The only difference here: the app passes the skills table it loaded from
// Supabase, while these tools default to the fixtures in mockData.
import { buildDictionary as buildFromTable } from '../../frontend/src/lib/resume/skills.js';
import { skills } from '../../frontend/src/api/mockData.js';

export { ALIASES, CONTEXT_ONLY, findSkills, unmatchedTerms } from '../../frontend/src/lib/resume/skills.js';

export function buildDictionary(options = {}) {
  return buildFromTable({ table: skills, ...options });
}
