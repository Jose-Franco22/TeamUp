-- Third batch of the skills taxonomy: languages, frameworks, libraries,
-- databases and developer tools, so the resume importer recognizes most of
-- what a CS student lists. Run after 08_more_skills.sql. As with 08, keep
-- ALIASES in frontend/src/lib/resume/skills.js in step with this list.

insert into public.skills (name, category) values
  -- Frontend: languages, frameworks, UI libraries, mobile and desktop
  ('Dart', 'Frontend'), ('Objective-C', 'Frontend'), ('WebAssembly', 'Frontend'),
  ('Svelte', 'Frontend'), ('SvelteKit', 'Frontend'), ('SolidJS', 'Frontend'),
  ('jQuery', 'Frontend'), ('Redux', 'Frontend'), ('Nuxt', 'Frontend'),
  ('Gatsby', 'Frontend'), ('Ember.js', 'Frontend'), ('Backbone.js', 'Frontend'),
  ('Alpine.js', 'Frontend'), ('Material UI', 'Frontend'), ('Chakra UI', 'Frontend'),
  ('shadcn/ui', 'Frontend'), ('Styled Components', 'Frontend'), ('Three.js', 'Frontend'),
  ('D3.js', 'Frontend'), ('WebGL', 'Frontend'), ('React Router', 'Frontend'),
  ('TanStack Query', 'Frontend'), ('Ionic', 'Frontend'), ('Xamarin', 'Frontend'),
  ('Electron', 'Frontend'), ('Tauri', 'Frontend'), ('Jetpack Compose', 'Frontend'),
  ('Android', 'Frontend'), ('iOS', 'Frontend'), ('Qt', 'Frontend'),
  ('Blazor', 'Frontend'), ('Expo', 'Frontend'),

  -- Backend: languages
  ('Scala', 'Backend'), ('Elixir', 'Backend'), ('Erlang', 'Backend'),
  ('Haskell', 'Backend'), ('Clojure', 'Backend'), ('OCaml', 'Backend'),
  ('F#', 'Backend'), ('Perl', 'Backend'), ('Lua', 'Backend'),
  ('Groovy', 'Backend'), ('Visual Basic', 'Backend'), ('Assembly', 'Backend'),
  ('Fortran', 'Backend'), ('COBOL', 'Backend'), ('Zig', 'Backend'),
  ('Nim', 'Backend'), ('Crystal', 'Backend'), ('Lisp', 'Backend'),
  ('Racket', 'Backend'), ('Prolog', 'Backend'), ('Solidity', 'Backend'),
  ('Verilog', 'Backend'), ('VHDL', 'Backend'),

  -- Backend: frameworks, runtimes, ORMs, messaging, auth
  ('NestJS', 'Backend'), ('Koa', 'Backend'), ('Fastify', 'Backend'),
  ('Laravel', 'Backend'), ('Symfony', 'Backend'), ('CodeIgniter', 'Backend'),
  ('Ruby on Rails', 'Backend'), ('Phoenix', 'Backend'), ('Spring', 'Backend'),
  ('Hibernate', 'Backend'), ('Entity Framework', 'Backend'), ('Gin', 'Backend'),
  ('Actix', 'Backend'), ('Ktor', 'Backend'), ('Quarkus', 'Backend'),
  ('Deno', 'Backend'), ('Bun', 'Backend'), ('gRPC', 'Backend'),
  ('tRPC', 'Backend'), ('WebSockets', 'Backend'), ('Socket.IO', 'Backend'),
  ('Prisma', 'Backend'), ('Sequelize', 'Backend'), ('TypeORM', 'Backend'),
  ('SQLAlchemy', 'Backend'), ('Celery', 'Backend'), ('RabbitMQ', 'Backend'),
  ('Apache Kafka', 'Backend'), ('Nginx', 'Backend'), ('Microservices', 'Backend'),
  ('OAuth', 'Backend'), ('JWT', 'Backend'), ('Strapi', 'Backend'),

  -- Backend: databases
  ('MariaDB', 'Backend'), ('Oracle Database', 'Backend'), ('SQL Server', 'Backend'),
  ('Apache Cassandra', 'Backend'), ('DynamoDB', 'Backend'), ('Elasticsearch', 'Backend'),
  ('Neo4j', 'Backend'), ('CouchDB', 'Backend'), ('Cosmos DB', 'Backend'),

  -- Data: languages, ML/NLP libraries, big data, warehouses, notebooks
  ('Julia', 'Data'), ('SAS', 'Data'), ('SciPy', 'Data'),
  ('Seaborn', 'Data'), ('Plotly', 'Data'), ('Statsmodels', 'Data'),
  ('Hugging Face', 'Data'), ('LangChain', 'Data'), ('spaCy', 'Data'),
  ('NLTK', 'Data'), ('XGBoost', 'Data'), ('LightGBM', 'Data'),
  ('JAX', 'Data'), ('CUDA', 'Data'), ('ONNX', 'Data'),
  ('Apache Spark', 'Data'), ('Hadoop', 'Data'), ('Apache Airflow', 'Data'),
  ('dbt', 'Data'), ('Snowflake', 'Data'), ('BigQuery', 'Data'),
  ('Redshift', 'Data'), ('Databricks', 'Data'), ('Polars', 'Data'),
  ('Dask', 'Data'), ('MLflow', 'Data'), ('Weights & Biases', 'Data'),
  ('Streamlit', 'Data'), ('Gradio', 'Data'), ('Looker', 'Data'),
  ('Google Colab', 'Data'), ('Conda', 'Data'),

  -- Tools: build and package tooling
  ('PowerShell', 'Tools'), ('npm', 'Tools'), ('Yarn', 'Tools'),
  ('pnpm', 'Tools'), ('Webpack', 'Tools'), ('Vite', 'Tools'),
  ('Babel', 'Tools'), ('ESLint', 'Tools'), ('Prettier', 'Tools'),
  ('Storybook', 'Tools'), ('Maven', 'Tools'), ('Gradle', 'Tools'),
  ('CMake', 'Tools'),

  -- Tools: infrastructure, CI, monitoring, hosting
  ('Terraform', 'Tools'), ('Ansible', 'Tools'), ('Jenkins', 'Tools'),
  ('GitLab CI', 'Tools'), ('CircleCI', 'Tools'), ('Helm', 'Tools'),
  ('Prometheus', 'Tools'), ('Grafana', 'Tools'), ('Datadog', 'Tools'),
  ('Sentry', 'Tools'), ('Heroku', 'Tools'), ('Vercel', 'Tools'),
  ('Netlify', 'Tools'), ('DigitalOcean', 'Tools'), ('Cloudflare', 'Tools'),
  ('Vagrant', 'Tools'), ('Unix', 'Tools'), ('Bitbucket', 'Tools'),

  -- Tools: editors, IDEs, game engines
  ('Vim', 'Tools'), ('VS Code', 'Tools'), ('Visual Studio', 'Tools'),
  ('IntelliJ IDEA', 'Tools'), ('Eclipse', 'Tools'), ('Android Studio', 'Tools'),
  ('Xcode', 'Tools'), ('Unity', 'Tools'), ('Unreal Engine', 'Tools'),
  ('Godot', 'Tools'),

  -- Tools: testing
  ('Playwright', 'Tools'), ('Mocha', 'Tools'), ('Chai', 'Tools'),
  ('Vitest', 'Tools'), ('Jasmine', 'Tools'), ('Testing Library', 'Tools'),
  ('JMeter', 'Tools'), ('Swagger', 'Tools'), ('SonarQube', 'Tools'),
  ('TDD', 'Tools'),

  -- Tools: security
  ('Wireshark', 'Tools'), ('Burp Suite', 'Tools'), ('Metasploit', 'Tools'),
  ('Nmap', 'Tools'), ('Kali Linux', 'Tools'),

  -- Tools: docs and process
  ('Confluence', 'Tools'), ('Trello', 'Tools'), ('LaTeX', 'Tools'),
  ('UML', 'Tools')
on conflict (name) do nothing;
