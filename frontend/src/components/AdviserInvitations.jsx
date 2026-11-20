import { useState } from 'react';
import { getMyAdviserRequests, respondToAdviserRequest } from '../api/client';
import useAsync from './useAsync';
import Avatar from './Avatar';

// Invitations to advise a project, on the Requests page (issue #54).
//
// Kept in its own section rather than mixed in with join requests, because
// they are not the same thing and the mistake would be expensive: a join
// request is somebody asking to take a seat on your team, this is somebody
// asking you to advise theirs, and accepting the wrong one in a hurry is
// exactly the error an undifferentiated list invites.
//
// The project's description is shown in full. The issue asks for "the project
// name, its owner and what it's building" so the answer can be given here,
// without going to look the project up and losing the page.
//
// Nothing renders when there is nothing waiting — most students are never
// asked to advise anything, and an empty "Adviser invitations" heading on
// every visit to Requests would be noise for all of them.
export default function AdviserInvitations({ onAnswered }) {
  const { data, loading, error, setData } = useAsync(getMyAdviserRequests, []);
  // request id -> 'accepting' | 'declining' | an error message
  const [busy, setBusy] = useState({});

  async function answer(id, accept) {
    setBusy((b) => ({ ...b, [id]: accept ? 'accepting' : 'declining' }));
    try {
      await respondToAdviserRequest(id, accept);
      // Drop the row rather than reloading: it is answered now, and the rest
      // of the list is unaffected by what happened to this one.
      setData((list) => list.filter((r) => r.id !== id));
      setBusy((b) => ({ ...b, [id]: undefined }));
      // The team page shows what you advise, so it is stale now.
      if (onAnswered) onAnswered();
    } catch (err) {
      setBusy((b) => ({ ...b, [id]: err.message || 'Something went wrong.' }));
    }
  }

  // A failure here must not take the join requests down with it: this is one
  // section of somebody else's page.
  if (loading || error) return null;
  const items = data || [];
  if (items.length === 0) return null;

  return (
    <>
      <h2 className="section">Adviser invitations</h2>
      <p className="hint">
        Advising a project means being its contact. It does not put you on the team, and it does not
        use up a seat — you can advise a project and still be on a team of your own.
      </p>
      <div className="rows">
        {items.map((r) => {
          const state = busy[r.id];
          const working = state === 'accepting' || state === 'declining';
          return (
            <div className="row adviser-invite" key={r.id}>
              <Avatar name={r.owner_name} size={34} />
              <div>
                <div className="nm">{r.project_title}</div>
                <div className="sub">{r.owner_name} asked you to advise this project</div>
                <p className="request-note">{r.project_description}</p>
                {state && !working && (
                  <span className="inline-error" role="alert">{state}</span>
                )}
              </div>
              <div className="acts">
                <button className="btn" disabled={working} onClick={() => answer(r.id, true)}>
                  {state === 'accepting' ? 'Accepting…' : 'Accept'}
                </button>
                <button className="btn quiet" disabled={working} onClick={() => answer(r.id, false)}>
                  {state === 'declining' ? 'Declining…' : 'Decline'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
