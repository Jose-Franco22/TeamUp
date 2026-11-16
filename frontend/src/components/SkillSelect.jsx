import { useEffect, useMemo, useRef, useState } from 'react';

// A drop-in for the skill <select> on a roles-needed row, with a search box.
// The taxonomy runs to hundreds of skills, which a plain dropdown can only
// scroll. Typing filters to skills whose name or category contains the query
// anywhere (case-insensitive), the same match SkillPicker uses on the profile.
//
// `skills` is already narrowed to the ones that fit the row's role. The first
// option is always `placeholder` with value '' ("Any skill").
export default function SkillSelect({ label, value, skills, placeholder, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const selected = skills.find((s) => s.id === value);

  // Close when clicking anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!rootRef.current?.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = skills
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    // "Any skill" only while not searching — it's a reset, not a match.
    return q ? matches : [{ id: '', name: placeholder, category: '' }, ...matches];
  }, [skills, query, placeholder]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(id) {
    onChange(id);
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) pick(options[active].id);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  return (
    <div className="picker skill-select" ref={rootRef}>
      <button
        type="button"
        className="skill-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        data-value={value}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {selected ? selected.name : placeholder}
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
          {options.length === 0 ? (
            <p className="picker-note">No skills match “{query}”</p>
          ) : (
            <ul role="listbox" aria-label={label} ref={listRef}>
              {options.map((s, i) => (
                <li
                  key={s.id || 'any'}
                  role="option"
                  data-value={s.id}
                  aria-selected={s.id === (value || '')}
                  className={i === active ? 'active' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s.id)}
                >
                  {s.name}
                  {s.category && <span>{s.category}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
