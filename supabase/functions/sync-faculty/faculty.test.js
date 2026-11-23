// The CS faculty directory → the emails sync_faculty_directory() is given.
// Run with `node --test supabase/functions/*/*.test.js`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORY_URL, facultyEmails } from './faculty.js';

const record = (username, ...departments) => ({
  '@userId': '1',
  '@username': username,
  'dmd:IndexEntry': [
    { '@indexKey': 'COLLEGE', '@text': 'College of Engineering and Computer Science' },
    ...departments.map((d) => ({ '@indexKey': 'DEPARTMENT', '@text': d })),
    { '@indexKey': 'RANK', '@text': 'Professor' },
  ],
  PCI: { FNAME: 'Test', LNAME: 'Person' },
});

const CS = 'Department of Computer Science';

test('each record becomes <username>@utrgv.edu, lowercased and sorted', () => {
  const body = { Data: { Record: [record('Zed.Prof', CS), record('ada.prof01', CS)] } };
  assert.deepEqual(facultyEmails(body), ['ada.prof01@utrgv.edu', 'zed.prof@utrgv.edu']);
});

test('a JSON string wrapping the JSON is unwrapped, as the page does', () => {
  const body = JSON.stringify({ Data: { Record: [record('ada.prof01', CS)] } });
  assert.deepEqual(facultyEmails(body), ['ada.prof01@utrgv.edu']);
});

test('a single record that is not in an array still counts', () => {
  assert.deepEqual(facultyEmails({ Data: { Record: record('solo', CS) } }), ['solo@utrgv.edu']);
});

test('only the Computer Science department, even if the search lets others through', () => {
  const body = {
    Data: {
      Record: [
        record('cs.prof', CS),
        record('ee.prof', 'Department of Electrical and Computer Engineering'),
        record('joint.prof', 'Department of Mathematics', CS),
      ],
    },
  };
  assert.deepEqual(facultyEmails(body), ['cs.prof@utrgv.edu', 'joint.prof@utrgv.edu']);
});

test('duplicates and unusable usernames are dropped', () => {
  const body = {
    Data: { Record: [record('ada', CS), record('ADA', CS), record('', CS), record('a b', CS), record('x@y', CS)] },
  };
  const logged = [];
  assert.deepEqual(facultyEmails(body, CS, { log: (m) => logged.push(m) }), ['ada@utrgv.edu']);
  assert.equal(logged.length, 3, 'each unusable username is logged, so a missing faculty member is noticed');
  assert.match(logged[1], /"a b"/);
});

test('records from other departments are skipped without a log line', () => {
  const logged = [];
  const body = { Data: { Record: [record('ee prof', 'Department of Mathematics')] } };
  assert.deepEqual(facultyEmails(body, CS, { log: (m) => logged.push(m) }), []);
  assert.deepEqual(logged, []);
});

test('a response without Data.Record is an error, not an empty list', () => {
  assert.throws(() => facultyEmails({ Data: {} }), /no Data.Record/);
  assert.throws(() => facultyEmails('<html>'), /valid JSON/);
});

test('it asks the directory for the CS department', () => {
  assert.match(DIRECTORY_URL, /GetDMList\?search=Department%20of%20Computer%20Science$/);
});
