-- Grows the skills taxonomy past the original twelve. Run after
-- 06_seed_skills.sql. The resume importer can only suggest skills that exist
-- here, so a student listing Java, Docker or SQL used to get nothing for them.
--
-- Keep ALIASES in frontend/src/lib/resume/skills.js in step with this list: a
-- skill without an entry there is matched on its exact name only. Categories
-- stay the four the check constraint allows, which is also what
-- roles.skill_categories maps against.

insert into public.skills (name, category) values
  -- Frontend: web UI, mobile, design
  ('TypeScript',    'Frontend'),
  ('HTML',          'Frontend'),
  ('CSS',           'Frontend'),
  ('Tailwind CSS',  'Frontend'),
  ('Bootstrap',     'Frontend'),
  ('Vue.js',        'Frontend'),
  ('Angular',       'Frontend'),
  ('Next.js',       'Frontend'),
  ('React Native',  'Frontend'),
  ('Flutter',       'Frontend'),
  ('Swift',         'Frontend'),
  ('Kotlin',        'Frontend'),
  ('Adobe XD',      'Frontend'),

  -- Backend: languages, frameworks, databases, APIs
  ('Java',          'Backend'),
  ('C',             'Backend'),
  ('C++',           'Backend'),
  ('C#',            'Backend'),
  ('Go',            'Backend'),
  ('Rust',          'Backend'),
  ('PHP',           'Backend'),
  ('Ruby',          'Backend'),
  ('Django',        'Backend'),
  ('Flask',         'Backend'),
  ('FastAPI',       'Backend'),
  ('Spring Boot',   'Backend'),
  ('.NET',          'Backend'),
  ('MySQL',         'Backend'),
  ('SQLite',        'Backend'),
  ('MongoDB',       'Backend'),
  ('Redis',         'Backend'),
  ('Firebase',      'Backend'),
  ('Supabase',      'Backend'),
  ('GraphQL',       'Backend'),
  ('REST APIs',     'Backend'),

  -- Data: analysis, ML, visualization
  ('SQL',           'Data'),
  ('R',             'Data'),
  ('NumPy',         'Data'),
  ('Matplotlib',    'Data'),
  ('TensorFlow',    'Data'),
  ('PyTorch',       'Data'),
  ('Keras',         'Data'),
  ('Jupyter',       'Data'),
  ('Tableau',       'Data'),
  ('Power BI',      'Data'),
  ('MATLAB',        'Data'),

  -- Tools: infrastructure, testing, process
  ('Docker',          'Tools'),
  ('Kubernetes',      'Tools'),
  ('AWS',             'Tools'),
  ('Azure',           'Tools'),
  ('Google Cloud',    'Tools'),
  ('Linux',           'Tools'),
  ('Bash',            'Tools'),
  ('GitHub Actions',  'Tools'),
  ('CI/CD',           'Tools'),
  ('Jira',            'Tools'),
  ('Postman',         'Tools'),
  ('Agile',           'Tools'),
  ('Cypress',         'Tools'),
  ('Selenium',        'Tools'),
  ('pytest',          'Tools'),
  ('JUnit',           'Tools')
on conflict (name) do nothing;
