import { useRef, useState } from 'react';
import { addResumeSkills, getSkills } from '../api/client';
import { ACCEPTED, ResumeReadError, readResumeFile } from '../lib/resume/readFile';
import { parseDocument } from '../lib/resume/parse';

// "Import from resume" on the profile page.
//
// The file never leaves the browser: it is read from disk, parsed in this tab,
// and only the skill ids the student ticks are sent to Supabase. Suggestions
// can only ever be skills that already exist in the skills table, so an import
// cannot invent a skill.
//
// Stages: idle -> reading -> review -> saving -> idle (with a result note).
export default function ResumeImport({ mySkills = [], onImported }) {
  const fileInput = useRef(null);
  const [stage, setStage] = useState('idle');
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const mine = new Set(mySkills.map((skill) => skill.id));

  function reset() {
    setStage('idle');
    setParsed(null);
    setSelected(new Set());
    setError('');
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Let the same file be chosen twice in a row.
    event.target.value = '';
    if (!file) return;

    setError('');
    setNote('');
    setFileName(file.name);
    setStage('reading');

    try {
      // The skills table is the vocabulary: without it there is nothing to
      // match against, so it is fetched before parsing rather than assumed.
      const [doc, table] = await Promise.all([readResumeFile(file), getSkills()]);
      const result = parseDocument(doc, { table });
      setParsed(result);
      setSelected(new Set(result.skills.filter((s) => !mine.has(s.skill_id)).map((s) => s.skill_id)));
      setStage('review');
    } catch (err) {
      setError(err instanceof ResumeReadError ? err.message : `That file could not be read. ${err.message}`);
      setStage('idle');
    }
  }

  async function handleSave() {
    setStage('saving');
    setError('');
    try {
      const updated = await addResumeSkills([...selected]);
      const count = selected.size;
      setNote(`Added ${count} skill${count === 1 ? '' : 's'} from ${fileName}.`);
      reset();
      onImported?.(updated);
    } catch (err) {
      // Selections stay on screen so nothing has to be redone.
      setError(`Those skills could not be saved. ${err.message}`);
      setStage('review');
    }
  }

  function toggle(skillId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }

  const suggestions = parsed?.skills ?? [];
  const fresh = suggestions.filter((skill) => !mine.has(skill.skill_id));
  const known = suggestions.filter((skill) => mine.has(skill.skill_id));

  return (
    <>
      <button
        className="btn ghost"
        onClick={() => fileInput.current?.click()}
        disabled={stage === 'reading' || stage === 'saving'}
      >
        {stage === 'reading' ? 'Reading…' : 'Import from resume'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED}
        onChange={handleFile}
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />

      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}

      {stage !== 'idle' && stage !== 'reading' && parsed && (
        <div className="import">
          <div className="import-head">
            <p className="lbl">
              {fileName} · {parsed.characters.toLocaleString()} characters read in this browser
            </p>
            <button className="btn quiet" onClick={reset} disabled={stage === 'saving'}>
              Cancel
            </button>
          </div>

          {parsed.warnings.map((warning) => (
            <p className="note" key={warning}>{warning}</p>
          ))}

          {suggestions.length === 0 ? (
            <p className="note">
              Nothing to suggest from this file. Add skills by hand, or try a resume that lists
              them.
            </p>
          ) : (
            <>
              <p className="desc">
                Tick what is right. Nothing is saved until you choose Add.
              </p>

              {fresh.map((skill) => (
                <label className="suggestion" key={skill.skill_id}>
                  <input
                    type="checkbox"
                    checked={selected.has(skill.skill_id)}
                    onChange={() => toggle(skill.skill_id)}
                    disabled={stage === 'saving'}
                  />
                  <span>
                    <b>{skill.name}</b>
                    <em className="facts">
                      {skill.months ? ` ${skill.months} months` : ' listed only'}
                      {skill.projects ? ` · ${skill.projects} project${skill.projects === 1 ? '' : 's'}` : ''}
                    </em>
                    {skill.evidence[0] && <small>“{skill.evidence[0].quote}”</small>}
                  </span>
                </label>
              ))}

              {known.length > 0 && (
                <p className="note">
                  Already on your profile: {known.map((skill) => skill.name).join(', ')}.
                </p>
              )}

              {fresh.length === 0 && (
                <p className="note">Everything this resume mentions is already on your profile.</p>
              )}

              {parsed.unknownTerms.length > 0 && (
                <p className="note">
                  Not in TeamUp’s skill list, so they cannot be added yet:{' '}
                  {parsed.unknownTerms.slice(0, 12).join(', ')}.
                </p>
              )}
            </>
          )}

          <div className="foot">
            <button
              className="btn"
              onClick={handleSave}
              disabled={selected.size === 0 || stage === 'saving'}
            >
              {stage === 'saving' ? 'Adding…' : `Add ${selected.size} skill${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
