import { useEffect, useMemo, useRef, useState } from 'react';
import { addSkill, getSkills } from '../api/client';

// "Add a skill" button that opens a searchable dropdown of every skill in the
// taxonomy. Typing filters to skills whose name contains the query anywhere
// (case-insensitive). Skills already on the profile are left out.
export default function SkillPicker({ mySkills, onAdded }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  // Load the taxonomy the first time the dropdown opens.
  useEffect(() => {
    if (!open || all) return;
    getSkills().then(setAll, setLoadError);
  }, [open, all]);

  // Close when clicking anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!rootRef.current?.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    if (!all) return [];
    const owned = new Set((mySkills || []).map((s) => s.id));
    const q = query.trim().toLowerCase();
    return all
      .filter((s) => !owned.has(s.id) && s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, mySkills, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function close() {
    setOpen(false);
    setQuery('');
    setAddError(null);
  }

  async function pick(skill) {
    setAdding(true);
    setAddError(null);
    try {
      onAdded(await addSkill(skill.id));
      setQuery('');
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active] && !adding) pick(matches[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        className="btn ghost"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? close() : setOpen(true))}
      >
        Add a skill
      </button>

      {open && (
        <div className="picker-menu">
          <input
            autoFocus
            type="search"
            placeholder="Search skills"
            aria-label="Search skills"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {loadError ? (
            <p className="inline-error" role="alert">{loadError.message}</p>
          ) : !all ? (
            <p className="picker-note">Loading skills…</p>
          ) : matches.length === 0 ? (
            <p className="picker-note">No skills match “{query}”</p>
          ) : (
            <ul role="listbox" ref={listRef}>
              {matches.map((s, i) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !adding && pick(s)}
                >
                  {s.name}
                  <span>{s.category}</span>
                </li>
              ))}
            </ul>
          )}
          {addError && <p className="inline-error" role="alert">{addError}</p>}
        </div>
      )}
    </div>
  );
}
