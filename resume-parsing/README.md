# Resume parsing — PDF, DOCX and LaTeX, with no LLM

Turns a resume into **suggested skills with evidence**, using no model and no
upload. Everything here runs in the browser too, so a resume never has to leave
the student's machine, and the Gemini budget stays free for the matching
judge.

```bash
cd resume-parsing
npm install
npm run samples     # regenerate the sample resumes
npm run demo        # parse all four formats
npm run demo -- ~/my-resume.pdf    # your own file, stays local
npm test            # 15 tests
```

## The pipeline

```
file bytes -> toDocument -> sections -> skill matches -> evidence
              one shape     where a     only ids that    months,
              per format    skill sits  exist already    projects, quotes
```

**`toDocument()` is the conversion layer.** One reader per format, one shape
out (`{ kind, text, lines, warnings }`). Nothing downstream knows which format
it came from, so adding `.md` or `.rtf` later is one case in one file.

| Format | Reader | License |
| --- | --- | --- |
| PDF | `pdfjs-dist`, Firefox's engine | Apache-2.0 |
| DOCX | `mammoth` | BSD-2 |
| LaTeX | `src/latex.mjs`, a focused stripper | — |
| TXT / MD | read directly | — |

LaTeX gets its own pass rather than a full parser: resumes use a small set of
commands, unknown ones degrade to their argument, and the preamble, comments
and math are dropped.

## Why it cannot invent a skill

The matcher only ever returns a `skill_id` that already exists in the `skills`
table. Aliases do the work: `ReactJS` → React, `Postgres` → PostgreSQL,
`sklearn` → scikit-learn, `Node` → Node.js.

Two rules keep it honest:

- **No matches inside longer words.** "Java" never fires on "JavaScript", and
  "Git" never fires on "GitHub" (there is a separate `github` alias for that).
- **Short, ambiguous aliases only count in a skills list.** `JS`, `R`, `Go`
  and `C` are words as often as they are languages, so they are ignored in
  prose and read only where someone listed their skills.

Terms that match nothing are returned as `unknownTerms` — a resume saying
"Docker" is a signal worth showing, even though no project can ask for it yet.

## What the matching engine gets

Each suggestion carries the evidence `matching/` scores:

```json
{
  "skill_id": "s-react",
  "months": 7,
  "projects": 0,
  "matchedAs": ["reactjs"],
  "evidence": [{ "quote": "- Built an internal dashboard in ReactJS backed by a Node/Express REST API", "section": "experience" }]
}
```

- **months** comes from the date range on the job the skill was mentioned under
  (`chrono-node` reads "Jan 2025 - Aug 2025" and "Sep 2024 - Present").
- **projects** counts entries in the projects section where it appears.
- **quote** is the line it was found on, so the student can check each
  suggestion. A test asserts every quote really exists in the resume.

`toProfileRows()` shows what would be written on confirm: a `user_skills` row
with `source: 'resume'` and a `profile_evidence` row. Nothing is saved until
the student ticks the box, which is what the Profile page's "imported" tag
already promises.

## Samples

`fixtures/` holds the same invented resume as `.txt`, `.tex`, `.pdf` and
`.docx`, plus a text-free PDF that stands in for a scan. Real resumes are
personal data and never belong in the repo. A test parses all four formats and
asserts they produce **identical** skills, months and projects.

## Known limits

- **Scans need OCR.** A PDF with no text layer produces a warning telling the
  student to upload a text PDF. Browser OCR is slow and not worth it yet.
- **Aliases are hand-written.** Twelve skills today. A larger table needs a
  bigger alias list, and eventually a fuzzy fallback for typos.
- **Months can double-count.** A skill under two overlapping jobs adds both.
- **Entries split on dates.** A new job or project is detected by its date
  range, because bullet characters often are not in a PDF's text layer. A
  projects section with no dates at all reads as one entry.
- **Sections are heuristic.** Unusual headings fall back to "other", which only
  weakens evidence, never invents it.
- **Not wired into the app yet.** The next step is the Profile page flow:
  upload, review the suggestions, confirm, save.
