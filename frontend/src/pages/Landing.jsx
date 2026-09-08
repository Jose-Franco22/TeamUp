import { Link } from 'react-router-dom';

const STEPS = [
  {
    title: 'List your skills',
    body: 'Add skills to your profile manually, or import them from your resume.',
  },
  {
    title: 'Browse open projects',
    body: 'See what every team is building and which roles they still need — no sign-in required.',
  },
  {
    title: 'Request to join',
    body: 'Send a request to a project that needs what you have. The creator accepts or declines.',
  },
  {
    title: 'The team locks in',
    body: 'Once a roster fills its target size, the project closes to new requests and the team is formed.',
  },
];

export default function Landing() {
  return (
    <>
      <section className="hero">
        <h1>Find a senior project team by skill, not by who you already know.</h1>
        <p>
          CSCI 4390 teams usually form through whoever's already in your group chat — not
          whoever actually has the skills the project needs. TeamUp lists what every project is
          building, what roles are still open, and lets you request to join the ones that match
          what you can bring.
        </p>
        <div className="hero-cta">
          <Link className="btn" to="/browse">
            Browse open projects
          </Link>
          <Link className="btn ghost" to="/login">
            Sign in
          </Link>
        </div>
      </section>

      <section>
        <h2 className="section">How it works</h2>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <span className="step-num">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section">About</h2>
        <div className="card about">
          {/* TODO: replace with real copy — the actual story (how the four
              of us ended up forming this team through CSCI 4390 group
              chats and existing friend groups, which is exactly the
              coordination problem TeamUp is meant to fix) should go here
              instead of this placeholder. Do this before showing the site
              to Erik or anyone else. */}
          <p>
            TeamUp is a senior project for CSCI 4390 at UTRGV, built by Adan Barrera, Nicolas
            Guerra, Jose Franco Garza, and Alexis Covarrubias, advised by Erik Enriquez. We built
            it because forming a project team usually comes down to who you already know, not who
            actually fits the project — and we wanted a way to match on skills instead.
          </p>
          <div className="about-people">
            <div>
              <b>Team</b>
              <span>Adan Barrera · Nicolas Guerra · Jose Franco Garza · Alexis Covarrubias</span>
            </div>
            <div>
              <b>Adviser</b>
              <span>Erik Enriquez</span>
            </div>
            <div>
              <b>Course</b>
              <span>CSCI 4390, UTRGV</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
