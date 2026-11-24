// The Export to Excel button (issue #40).
//
// Its own component rather than a few lines in Admin.jsx, because the issue
// asks for the same button twice: once on the admin pages and once on the
// Advising dashboard (#56), where it exports only the teams that adviser
// advises. Both call export_rosters(), which already narrows the rows by
// who is asking — so the second placement is this component again with a
// different label, and nothing else.
//
// The file is built in the browser rather than on a server. There is no
// server to build it on that would not also need the rows, and the rows are
// already here: export_rosters() returns them, rosterWorkbook.js turns them
// into a workbook, and the download never leaves the tab.
import { useState } from 'react';
import { exportRosters } from '../api/client';
import { buildRosterWorkbook, rosterFileName } from '../lib/rosterWorkbook';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Hands the browser a file to save.
 *
 * Exported so a test can watch the name without jsdom having to implement
 * downloading. The object URL is revoked straight after the click: it pins
 * the whole workbook in memory until it is, and an instructor exporting a
 * few times in a row should not accumulate copies.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExportRosters({ label = 'Export to Excel', className = 'btn ghost' }) {
  // null | 'working' | an error message
  const [state, setState] = useState(null);
  const working = state === 'working';

  async function run() {
    setState('working');
    try {
      const data = await exportRosters();
      const workbook = buildRosterWorkbook(data);
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: XLSX_TYPE }), rosterFileName());
      setState(null);
    } catch (error) {
      // The export is a dead end when it fails: there is no half-written
      // spreadsheet to show, so the only useful thing is to say why beside
      // the button that did nothing.
      setState(error?.message || 'The export failed. Try again.');
    }
  }

  return (
    <>
      <button className={className} type="button" disabled={working} onClick={run}>
        {working ? 'Preparing…' : label}
      </button>
      {state && state !== 'working' && (
        <span className="inline-error" role="alert">
          {state}
        </span>
      )}
    </>
  );
}
