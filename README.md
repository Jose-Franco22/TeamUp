# TeamUp

A skill-based team formation platform for CSCI 4390 senior projects. TeamUp helps students find and form senior project teams based on skills, interests, and availability — instead of the current ad-hoc process of GroupMe messages and word-of-mouth.

## Team

- Adan Barrera
- Nicolas Guerra
- Jose Franco Garza
- Alexis Covarrubias

Faculty Adviser: [TBD]

## Project Overview

Students currently have no structured way to find senior project teammates whose skills, interests, and availability complement their own. TeamUp solves this with:

1. **Student profiles** — skill tags, interests, and availability, populated manually or via resume parsing
2. **Project postings** — students with an idea can list needed roles and team size
3. **Matching engine** — recommends projects to people and people to projects based on skill-gap coverage and interest overlap
4. **Team formation workflow** — join requests, accept/decline, and a roster that locks once a team hits target size

See `/docs` for the full project proposal.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React Native |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Resume parsing | LLM-based extraction (Google Gemini API, free tier) |
| Auth | Supabase Auth / Firebase Auth |
| Hosting | Vercel (frontend), Render or Supabase (backend/DB) |

## Repo Structure

```
/frontend    React Native app
/backend     Node/Express API
/docs        Proposal, design notes, meeting notes
README.md
```

## Getting Started

### Prerequisites
- Node.js (LTS version)
- npm or yarn
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/<org-or-user>/teamup-csci4390.git
cd teamup-csci4390

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install
```

### Environment Variables

Copy `.env.example` to `.env` in `/backend` and fill in your own values (database URL, API keys). Never commit `.env` — it's already covered in `.gitignore`.

## Workflow

- Work happens on feature branches, merged into `main` via pull request (at least one teammate reviews before merging)
- Weekly sprints tracked on the GitHub Projects board
- Two weekly check-ins: a short blocker sync and a longer working session

## License

Coursework project for CSCI 4390 — not currently licensed for outside use.
