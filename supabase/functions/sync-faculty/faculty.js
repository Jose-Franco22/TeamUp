// Turns the UTRGV faculty directory's JSON into a list of emails.
//
// The CS faculty page (https://www.utrgv.edu/cecs/departments/csci/faculty/)
// has no emails in its HTML. Its script fetches DIRECTORY_URL and prints each
// record as `<username>@utrgv.edu`, so that is the rule here too. Kept free of
// Deno so `node --test` can cover it.

export const DEPARTMENT = 'Department of Computer Science';
export const DIRECTORY_URL =
  'https://webapps.utrgv.edu/aa/dm/api/DMUser/GetDMList?search=' + encodeURIComponent(DEPARTMENT);

const USERNAME = /^[a-z0-9._-]+$/i;

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// The endpoint sometimes answers with a JSON string wrapping the JSON, which
// the page's own script also unwraps.
function unwrap(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The faculty directory did not return valid JSON');
  }
}

function departmentsOf(record) {
  return asArray(record['dmd:IndexEntry'])
    .filter((e) => e?.['@indexKey'] === 'DEPARTMENT')
    .map((e) => e['@text'] ?? e['@entryKey']);
}

// Sorted, lowercased, unique emails of the records in `department`. The
// search parameter already narrows the response, but it is a text search, so
// the department is checked again on each record rather than trusted.
//
// A department record whose username can't be stored (anything outside
// USERNAME, which matches faculty_directory's check) is left out and logged,
// so a faculty member who silently can't be invited shows up in the logs.
export function facultyEmails(body, department = DEPARTMENT, { log = console.warn } = {}) {
  const data = unwrap(body);
  const records = data?.Data?.Record;
  if (records === undefined) throw new Error('The faculty directory response has no Data.Record');

  const emails = new Set();
  for (const record of asArray(records)) {
    const username = String(record?.['@username'] ?? '').trim();
    if (!departmentsOf(record).includes(department)) continue;
    if (!USERNAME.test(username)) {
      log(`sync-faculty: skipped a ${department} record whose username can't be stored: ${JSON.stringify(username)}`);
      continue;
    }
    emails.add(`${username.toLowerCase()}@utrgv.edu`);
  }
  return [...emails].sort();
}
