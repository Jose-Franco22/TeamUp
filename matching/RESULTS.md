# Matching engine — first results

A two-stage team recommender: a **point system** scores whole candidate teams
and shortlists the best few, then an **LLM judge** reviews that short list and
picks a winner. See [README.md](README.md) for the design; this file is what it
actually produced.

```bash
cd matching
node src/demo.mjs                 # jury only, no key needed
node src/demo.mjs --judge         # add the LLM review (needs .env)
node --test                       # 19 tests
```

Run on 4 projects and 26 unteamed students (10 from `mockData.js`, 24 synthetic
test students, 8 already on teams).

## A sample run

```
Campus parking tracker  [p-parking]
  2 seat(s) open · roles: React, React, Figma · pool: 26

  T1  970 pts <- pick
    coverage 1.00 · depth 1.00 · breadth 1.00 · hours 0.80
    Test Student 12 (12 hrs/wk) -> Figma
    Test Student 11 (10 hrs/wk) -> React

  T4  940 pts
    coverage 1.00 · depth 1.00 · breadth 1.00 · hours 0.60
    Test Student 12 (12 hrs/wk) -> Figma
    Test Student 13 (6 hrs/wk) -> React

  verdict: llm-judge
    T1: Covers all required roles with Student B bringing valuable OpenCV and
        React experience alongside Student A's Figma skills.
    T4: Ranked lowest because Student E's very low availability of 6 hours per
        week creates a high risk of project delays.
    risk: Several students have high months of experience with zero actual
          projects, indicating potentially inflated skill claims.
```

## Where it paid off

**The points caught what a keyword filter cannot.**

1. **Hours, not just skills.** On `p-parking`, T4 had perfect role coverage
   (1.00) and the most experienced React student (27 months) but still ranked
   4th: at 6 hrs/wk beside a 12 hrs/wk teammate, the availability part dropped
   to 0.60. Today's "Only show matches" toggle would have ranked it first.
2. **No duplicate roles.** Teams are scored as teams, so two React students
   score lower than a React plus the Figma the project still needs.
3. **Evidence beats a tag.** A skill with 27 months and 3 projects outscores the
   same skill typed in with nothing behind it, so claims are ranked by proof.

**The judge caught what the points cannot.**

4. **It read the project.** On the parking tracker, which estimates occupancy
   from camera feeds, the judge preferred the candidate with **OpenCV**
   experience. OpenCV is not in that project's roles, so the point system
   scored it as zero. This is the interest-overlap the README promises, without
   an interests table.
5. **It questioned the evidence.** On `p-degree` it demoted a team because the
   candidate showed **months of PostgreSQL but zero completed projects**, and
   warned that the pattern repeats across the cohort. That is a flaw in our own
   scoring: months and projects are added together, so time alone can inflate a
   score.
6. **It spotted a bottleneck.** In one run it flagged that the same student
   appeared on **all five** shortlisted teams.

**And one honest miss.** On `p-scam` the judge overruled the jury, picking a
927-point team over a 985-point one, because the higher-scoring candidate
"lists zero projects in Figma" — a skill that role does not need. The judge is
useful but not automatically right, which is exactly why the next step is
measuring it rather than trusting it.

## Guardrails worth knowing

- **The judge never sees names, emails or ids** — only "Student A, React (14
  months, 2 projects), 12 hrs/wk". A test asserts nothing else leaks.
- **It cannot invent a team.** Team ids are a fixed list in the response schema,
  and anything unrecognized is dropped.
- **It is optional.** No key, a 429, or an unparseable reply, and the jury's
  order stands with the reason recorded.
- **One call per project**, not per student, so the whole 4-project cohort cost
  4 requests against a free-tier limit of 15 a minute.
- **Nothing about people is committed.** `out/` and `.env` are gitignored.

## What it still needs

1. **Normalize `team_members.role` to a `skill_id`.** Roles are free text, so
   the engine assumes every listed role is still open. Until this is fixed,
   coverage is an estimate. This one blocks correctness.
2. **A diversity pass.** The top teams often repeat the same strongest
   candidate, so the short list offers less real choice than it looks.
3. **An evaluation harness.** Generated cohorts plus metrics (roles filled,
   students placed, how often the judge overrules the jury and whether it was
   right) so the weights and the judge are backed by numbers in the write-up.
4. **Real evidence.** Months and project counts come from seeded test fixtures.
   They need a `profile_evidence` table fed by resume parsing.
5. **Tighter judge input.** Send only role-relevant skills, so it stops
   penalizing gaps the role never asked for.
6. **A home in the app.** The jury belongs in a Postgres function reachable via
   `supabase.rpc`; the judge belongs in an Edge Function that holds the key.

## Status

Prototype on `feat/matching-engine`, branched from `Testing`. Not merged
anywhere and not wired into the frontend yet.
