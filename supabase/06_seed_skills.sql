-- Seeds the skills taxonomy. Per TODO-backend.md: skills has 0 rows on the
-- live project, which is a separate problem from the roles migration and
-- easy to miss behind that error — even once 04/05 land, the skill
-- dropdown and Browse's "Only show matches" filter have nothing to work
-- with until this runs. Mirrors frontend/src/api/mockData.js exactly so
-- mock and real mode show the same taxonomy; replace with a different real
-- set if preferred.

insert into public.skills (name, category) values
  ('React',        'Frontend'),
  ('JavaScript',    'Frontend'),
  ('Figma',         'Frontend'),
  ('Node.js',       'Backend'),
  ('PostgreSQL',    'Backend'),
  ('Express',       'Backend'),
  ('Python',        'Data'),
  ('pandas',        'Data'),
  ('OpenCV',        'Data'),
  ('scikit-learn',  'Data'),
  ('Jest',          'Tools'),
  ('Git',           'Tools')
on conflict (name) do nothing;
