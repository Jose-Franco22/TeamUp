// Matching resume text against the skills table.
//
// The matcher can only ever return a skill_id that already exists in the table
// it is given, so it cannot invent anything. Aliases are the whole trick: the
// table says "PostgreSQL", resumes say "Postgres"; the table says
// "scikit-learn", resumes say "sklearn".
//
// The table comes from the caller, which means the app passes the rows from
// Supabase and the Node tools pass the fixtures.

import { headingInfo } from './sections.js';

// Lowercase. Matching is case-insensitive. Keyed by skill name, so a skill
// keeps its aliases whatever its id is in a given database.
export const ALIASES = {
  React: ['react', 'reactjs', 'react.js'],
  JavaScript: ['javascript', 'js', 'es6', 'ecmascript'],
  Figma: ['figma'],
  'Node.js': ['node.js', 'nodejs', 'node'],
  PostgreSQL: ['postgresql', 'postgres', 'psql', 'postgre'],
  Express: ['express', 'express.js', 'expressjs'],
  Python: ['python', 'python3'],
  pandas: ['pandas'],
  OpenCV: ['opencv', 'cv2'],
  'scikit-learn': ['scikit-learn', 'scikit learn', 'sklearn'],
  Jest: ['jest'],
  Git: ['git', 'github', 'gitlab'],

  // From supabase/08_more_skills.sql. Deliberately no bare "spring" (a
  // semester), "next" or "rest" (ordinary words), or "ts" (too short).
  TypeScript: ['typescript'],
  HTML: ['html', 'html5'],
  CSS: ['css', 'css3', 'scss', 'sass'],
  'Tailwind CSS': ['tailwind css', 'tailwindcss', 'tailwind'],
  Bootstrap: ['bootstrap'],
  'Vue.js': ['vue.js', 'vuejs', 'vue'],
  Angular: ['angular', 'angularjs'],
  'Next.js': ['next.js', 'nextjs'],
  'React Native': ['react native'],
  Flutter: ['flutter'],
  Swift: ['swift', 'swiftui'],
  Kotlin: ['kotlin'],
  'Adobe XD': ['adobe xd'],
  Java: ['java'],
  C: ['c'],
  'C++': ['c++', 'cpp'],
  'C#': ['c#', 'csharp'],
  Go: ['go', 'golang'],
  Rust: ['rust'],
  PHP: ['php'],
  Ruby: ['ruby'],
  Django: ['django'],
  Flask: ['flask'],
  FastAPI: ['fastapi'],
  'Spring Boot': ['spring boot', 'springboot'],
  '.NET': ['.net', 'dotnet', 'asp.net'],
  MySQL: ['mysql'],
  SQLite: ['sqlite', 'sqlite3'],
  MongoDB: ['mongodb', 'mongo', 'mongoose'],
  Redis: ['redis'],
  Firebase: ['firebase', 'firestore'],
  Supabase: ['supabase'],
  GraphQL: ['graphql'],
  'REST APIs': ['rest api', 'rest apis', 'restful', 'restful api', 'restful apis'],
  SQL: ['sql', 't-sql', 'pl/sql'],
  R: ['r', 'rstudio'],
  NumPy: ['numpy'],
  Matplotlib: ['matplotlib'],
  TensorFlow: ['tensorflow', 'tf.keras'],
  PyTorch: ['pytorch'],
  Keras: ['keras'],
  Jupyter: ['jupyter', 'jupyter notebook', 'jupyter notebooks'],
  Tableau: ['tableau'],
  'Power BI': ['power bi', 'powerbi'],
  MATLAB: ['matlab'],
  Docker: ['docker', 'docker compose', 'docker-compose'],
  Kubernetes: ['kubernetes', 'k8s'],
  AWS: ['aws', 'amazon web services', 'ec2', 'aws lambda'],
  Azure: ['azure', 'microsoft azure'],
  'Google Cloud': ['google cloud', 'google cloud platform', 'gcp'],
  Linux: ['linux', 'ubuntu'],
  Bash: ['bash', 'shell scripting', 'zsh'],
  'GitHub Actions': ['github actions'],
  'CI/CD': ['ci/cd', 'ci-cd', 'continuous integration'],
  Jira: ['jira'],
  Postman: ['postman'],
  Agile: ['agile', 'scrum', 'kanban'],
  Cypress: ['cypress'],
  Selenium: ['selenium'],
  pytest: ['pytest'],
  JUnit: ['junit'],

  // From supabase/09_cs_skills.sql. Skills whose alias is just their
  // lowercased name ("Laravel" -> "laravel") are listed anyway, so this map
  // stays the one place to see what the importer recognizes.
  Dart: ['dart'],
  'Objective-C': ['objective-c', 'objective c', 'objc'],
  WebAssembly: ['webassembly', 'wasm'],
  Svelte: ['svelte'],
  SvelteKit: ['sveltekit'],
  SolidJS: ['solidjs', 'solid.js'],
  jQuery: ['jquery'],
  Redux: ['redux', 'redux toolkit'],
  Nuxt: ['nuxt', 'nuxt.js', 'nuxtjs'],
  Gatsby: ['gatsby', 'gatsbyjs', 'gatsby.js'],
  'Ember.js': ['ember.js', 'emberjs', 'ember'],
  'Backbone.js': ['backbone.js', 'backbonejs'],
  'Alpine.js': ['alpine.js', 'alpinejs'],
  'Material UI': ['material ui', 'material-ui', 'mui'],
  'Chakra UI': ['chakra ui', 'chakra-ui'],
  'shadcn/ui': ['shadcn/ui', 'shadcn'],
  'Styled Components': ['styled components', 'styled-components'],
  'Three.js': ['three.js', 'threejs'],
  'D3.js': ['d3.js', 'd3js', 'd3'],
  WebGL: ['webgl'],
  'React Router': ['react router', 'react-router'],
  'TanStack Query': ['tanstack query', 'react query', 'react-query'],
  Ionic: ['ionic'],
  Xamarin: ['xamarin'],
  Electron: ['electron', 'electron.js', 'electronjs'],
  Tauri: ['tauri'],
  'Jetpack Compose': ['jetpack compose'],
  Android: ['android', 'android sdk'],
  iOS: ['ios'],
  Qt: ['qt', 'qml'],
  Blazor: ['blazor'],
  Expo: ['expo'],
  Scala: ['scala'],
  Elixir: ['elixir'],
  Erlang: ['erlang'],
  Haskell: ['haskell'],
  Clojure: ['clojure', 'clojurescript'],
  OCaml: ['ocaml'],
  'F#': ['f#', 'fsharp'],
  Perl: ['perl'],
  Lua: ['lua'],
  Groovy: ['groovy'],
  'Visual Basic': ['visual basic', 'vb.net', 'vba'],
  Assembly: ['assembly', 'x86 assembly', 'arm assembly', 'x86', 'mips'],
  Fortran: ['fortran'],
  COBOL: ['cobol'],
  Zig: ['zig'],
  Nim: ['nim'],
  Crystal: ['crystal'],
  Lisp: ['lisp', 'common lisp'],
  Racket: ['racket'],
  Prolog: ['prolog'],
  Solidity: ['solidity'],
  Verilog: ['verilog', 'systemverilog'],
  VHDL: ['vhdl'],
  NestJS: ['nestjs', 'nest.js'],
  Koa: ['koa', 'koa.js'],
  Fastify: ['fastify'],
  Laravel: ['laravel'],
  Symfony: ['symfony'],
  CodeIgniter: ['codeigniter'],
  'Ruby on Rails': ['ruby on rails', 'rails', 'ror'],
  Phoenix: ['phoenix', 'phoenix framework'],
  Spring: ['spring framework', 'spring mvc', 'spring security', 'spring data'],
  Hibernate: ['hibernate'],
  'Entity Framework': ['entity framework', 'ef core'],
  Gin: ['gin', 'gin-gonic'],
  Actix: ['actix', 'actix-web'],
  Ktor: ['ktor'],
  Quarkus: ['quarkus'],
  Deno: ['deno'],
  Bun: ['bun', 'bun.js'],
  gRPC: ['grpc'],
  tRPC: ['trpc'],
  WebSockets: ['websockets', 'websocket'],
  'Socket.IO': ['socket.io', 'socketio'],
  Prisma: ['prisma'],
  Sequelize: ['sequelize'],
  TypeORM: ['typeorm'],
  SQLAlchemy: ['sqlalchemy'],
  Celery: ['celery'],
  RabbitMQ: ['rabbitmq'],
  'Apache Kafka': ['apache kafka', 'kafka'],
  Nginx: ['nginx'],
  Microservices: ['microservices', 'microservice'],
  OAuth: ['oauth', 'oauth2', 'oauth 2.0'],
  JWT: ['jwt', 'json web token', 'json web tokens'],
  Strapi: ['strapi'],
  MariaDB: ['mariadb'],
  'Oracle Database': ['oracle database', 'oracle db', 'oracle sql'],
  'SQL Server': ['sql server', 'microsoft sql server', 'mssql'],
  'Apache Cassandra': ['apache cassandra', 'cassandra'],
  DynamoDB: ['dynamodb'],
  Elasticsearch: ['elasticsearch', 'elastic search', 'elk stack'],
  Neo4j: ['neo4j', 'cypher query language'],
  CouchDB: ['couchdb'],
  'Cosmos DB': ['cosmos db', 'cosmosdb'],
  Julia: ['julia'],
  SAS: ['sas'],
  SciPy: ['scipy'],
  Seaborn: ['seaborn'],
  Plotly: ['plotly'],
  Statsmodels: ['statsmodels'],
  'Hugging Face': ['hugging face', 'huggingface'],
  LangChain: ['langchain'],
  spaCy: ['spacy'],
  NLTK: ['nltk'],
  XGBoost: ['xgboost'],
  LightGBM: ['lightgbm'],
  JAX: ['jax'],
  CUDA: ['cuda'],
  ONNX: ['onnx'],
  'Apache Spark': ['apache spark', 'pyspark', 'spark'],
  Hadoop: ['hadoop', 'hdfs', 'mapreduce'],
  'Apache Airflow': ['apache airflow', 'airflow'],
  dbt: ['dbt'],
  Snowflake: ['snowflake'],
  BigQuery: ['bigquery', 'google bigquery'],
  Redshift: ['redshift', 'amazon redshift'],
  Databricks: ['databricks'],
  Polars: ['polars'],
  Dask: ['dask'],
  MLflow: ['mlflow'],
  'Weights & Biases': ['weights & biases', 'weights and biases', 'wandb'],
  Streamlit: ['streamlit'],
  Gradio: ['gradio'],
  Looker: ['looker', 'looker studio'],
  'Google Colab': ['google colab', 'colab'],
  Conda: ['conda', 'anaconda', 'miniconda'],
  PowerShell: ['powershell'],
  npm: ['npm'],
  Yarn: ['yarn'],
  pnpm: ['pnpm'],
  Webpack: ['webpack'],
  Vite: ['vite', 'vitejs'],
  Babel: ['babel'],
  ESLint: ['eslint'],
  Prettier: ['prettier'],
  Storybook: ['storybook'],
  Maven: ['maven'],
  Gradle: ['gradle'],
  CMake: ['cmake', 'makefile', 'makefiles'],
  Terraform: ['terraform'],
  Ansible: ['ansible'],
  Jenkins: ['jenkins'],
  'GitLab CI': ['gitlab ci', 'gitlab ci/cd'],
  CircleCI: ['circleci', 'circle ci'],
  Helm: ['helm'],
  Prometheus: ['prometheus'],
  Grafana: ['grafana'],
  Datadog: ['datadog'],
  Sentry: ['sentry'],
  Heroku: ['heroku'],
  Vercel: ['vercel'],
  Netlify: ['netlify'],
  DigitalOcean: ['digitalocean', 'digital ocean'],
  Cloudflare: ['cloudflare'],
  Vagrant: ['vagrant'],
  Unix: ['unix'],
  Bitbucket: ['bitbucket'],
  Vim: ['vim', 'neovim'],
  'VS Code': ['vs code', 'vscode', 'visual studio code'],
  'Visual Studio': ['visual studio'],
  'IntelliJ IDEA': ['intellij idea', 'intellij'],
  Eclipse: ['eclipse'],
  'Android Studio': ['android studio'],
  Xcode: ['xcode'],
  Unity: ['unity', 'unity3d'],
  'Unreal Engine': ['unreal engine', 'unreal', 'ue4', 'ue5'],
  Godot: ['godot'],
  Playwright: ['playwright'],
  Mocha: ['mocha'],
  Chai: ['chai'],
  Vitest: ['vitest'],
  Jasmine: ['jasmine'],
  'Testing Library': ['testing library', 'react testing library'],
  JMeter: ['jmeter'],
  Swagger: ['swagger', 'openapi'],
  SonarQube: ['sonarqube'],
  TDD: ['tdd', 'test-driven development', 'test driven development'],
  Wireshark: ['wireshark'],
  'Burp Suite': ['burp suite', 'burpsuite'],
  Metasploit: ['metasploit'],
  Nmap: ['nmap'],
  'Kali Linux': ['kali linux', 'kali'],
  Confluence: ['confluence'],
  Trello: ['trello'],
  LaTeX: ['latex', 'overleaf'],
  UML: ['uml'],
};

// Aliases too short or too common to trust on their own. They only count
// inside a skills list, where "R, Go, C" means languages rather than words —
// and "Ruby, Swift, Rust" are names and adjectives elsewhere on a resume.
export const CONTEXT_ONLY = new Set([
  'r', 'go', 'c', 'js', 'ml', 'ai', 'cv',
  'ruby', 'rails', 'swift', 'rust', 'vue', 'mongo', 'agile', 'bootstrap',
  // People's names, places and everyday words that are also skills.
  'julia', 'jenkins', 'jasmine', 'crystal', 'phoenix', 'gatsby', 'cassandra',
  'kafka', 'celery', 'chai', 'mocha', 'helm', 'electron', 'ionic', 'groovy',
  'racket', 'nim', 'dart', 'elixir', 'ember', 'koa', 'gin', 'bun', 'yarn',
  'expo', 'spark', 'airflow', 'assembly', 'unity', 'eclipse', 'sentry',
  'babel', 'prettier', 'snowflake', 'redshift', 'looker', 'maven', 'kali',
  'sas', 'jax', 'mui', 'd3', 'ror', 'x86', 'mips', 'unreal', 'colab',
  'vagrant', 'swagger', 'confluence', 'latex', 'polars', 'hibernate',
  'prometheus', 'makefile', 'makefiles',
]);

// A link is not evidence of a skill: github.io in a project URL says nothing
// about whether someone uses Git.
const withoutLinks = (line) =>
  line.replace(/https?:\/\/\S+|\b[\w.-]+\.(io|com|org|net|dev)\/\S*/gi, ' ');

// An alias is one token in the reader's eyes, so it must not match inside a
// longer word: "Java" must not fire on "JavaScript", "Git" must not fire on
// "GitHub". Plus signs and hashes count as part of a name (C++, C#).
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternFor = (alias) =>
  new RegExp(`(?<![A-Za-z0-9#+])${escape(alias)}(?![A-Za-z0-9#+])`, 'gi');

export function buildDictionary({ table, aliases = ALIASES } = {}) {
  if (!table?.length) return [];

  const entries = [];
  for (const skill of table) {
    const names = aliases[skill.name] ?? [skill.name.toLowerCase()];
    for (const alias of names) {
      entries.push({
        skill_id: skill.id,
        name: skill.name,
        category: skill.category,
        alias,
        contextOnly: CONTEXT_ONLY.has(alias),
        pattern: patternFor(alias),
      });
    }
  }
  // Longest alias first, so "react.js" wins over "react" on the same text.
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

// Finds every mention, with the line it came from. A skill found only through a
// context-only alias counts only when it appeared in a skills section.
export function findSkills(lines, dictionary, { sectionOf = () => 'other' } = {}) {
  const hits = [];
  lines.forEach((line, lineNumber) => {
    if (!line) return;
    const section = sectionOf(lineNumber);
    const searchable = withoutLinks(line);
    for (const entry of dictionary) {
      if (entry.contextOnly && section !== 'skills') continue;
      entry.pattern.lastIndex = 0;
      if (!entry.pattern.test(searchable)) continue;
      hits.push({
        skill_id: entry.skill_id,
        name: entry.name,
        category: entry.category,
        alias: entry.alias,
        line,
        lineNumber,
        section,
      });
    }
  });
  return hits;
}

// Category labels a resume uses to group its skills list. Not skills.
const LABELS =
  /^((technical|core|key|relevant|additional|other|web|data|ml)\s*[&and]*\s*)*(skills?|languages?|tools?|frameworks?|libraries|databases?|technologies|data|other)$/i;

// Words in the skills section that matched nothing. These are the candidates
// for growing the skills table — a resume saying "Docker" is a signal, even
// though no project can ask for it yet.
export function unmatchedTerms(lines, dictionary, sectionOf) {
  const found = new Set();

  lines.forEach((line, lineNumber) => {
    if (sectionOf(lineNumber) !== 'skills' || !line) return;

    // A heading on its own line has no terms to collect. A heading sharing its
    // line with content ("Technical Skills: Python, Git") does.
    const heading = headingInfo(line);
    if (heading && !heading.inline) return;

    // Split on the separators a skills list actually uses, the colon after a
    // category label included.
    for (const raw of line.split(/[,;|•·:]| - /)) {
      const term = raw.replace(/^[\s\-*]+|[\s.]+$/g, '').trim();
      if (!term || term.length > 28 || LABELS.test(term)) continue;
      if (term.split(/\s+/).length > 3) continue;

      // "Git/GitHub" is already covered by the git alias, so it is not unknown.
      const alreadyKnown = dictionary.some((entry) => {
        entry.pattern.lastIndex = 0;
        return entry.pattern.test(term);
      });
      if (!alreadyKnown) found.add(term);
    }
  });

  return [...found];
}
