-- Fourth batch of the skills taxonomy: 1000 more skills across the same four
-- categories, covering frameworks, databases, cloud services, ML tooling,
-- design tools, testing, security and CS fundamentals. Run after
-- 09_cs_skills.sql. Skills without an entry in ALIASES
-- (frontend/src/lib/resume/skills.js) are matched on their exact name only.

insert into public.skills (name, category) values
  -- Frontend: Web frameworks and meta-frameworks
('Preact', 'Frontend'), ('Lit', 'Frontend'), ('Stencil', 'Frontend'),
('Qwik', 'Frontend'), ('Astro', 'Frontend'), ('Remix', 'Frontend'),
('SolidStart', 'Frontend'), ('Inferno', 'Frontend'), ('Mithril', 'Frontend'),
('Aurelia', 'Frontend'), ('Knockout.js', 'Frontend'), ('Polymer', 'Frontend'),
('Marko', 'Frontend'), ('Hyperapp', 'Frontend'), ('HTMX', 'Frontend'),
('Hotwire', 'Frontend'), ('Turbo', 'Frontend'), ('Stimulus', 'Frontend'),
('Livewire', 'Frontend'),

  -- Frontend: State, data fetching and forms
('Pinia', 'Frontend'), ('Vuex', 'Frontend'), ('MobX', 'Frontend'),
('Zustand', 'Frontend'), ('Jotai', 'Frontend'), ('Recoil', 'Frontend'),
('XState', 'Frontend'), ('Redux Toolkit', 'Frontend'), ('RTK Query', 'Frontend'),
('NgRx', 'Frontend'), ('RxJS', 'Frontend'), ('Apollo Client', 'Frontend'),
('Relay', 'Frontend'), ('urql', 'Frontend'), ('SWR', 'Frontend'),
('Axios', 'Frontend'), ('Formik', 'Frontend'), ('React Hook Form', 'Frontend'),
('Zod', 'Frontend'),

  -- Frontend: Languages that compile to the web
('Elm', 'Frontend'), ('ReScript', 'Frontend'), ('ReasonML', 'Frontend'),
('PureScript', 'Frontend'), ('CoffeeScript', 'Frontend'), ('ClojureScript', 'Frontend'),
('Flow', 'Frontend'), ('JSX', 'Frontend'), ('ActionScript', 'Frontend'),
('Haxe', 'Frontend'),

  -- Frontend: Styling
('Sass', 'Frontend'), ('Less', 'Frontend'), ('Stylus', 'Frontend'),
('PostCSS', 'Frontend'), ('CSS Modules', 'Frontend'), ('Emotion', 'Frontend'),
('Stitches', 'Frontend'), ('Vanilla Extract', 'Frontend'), ('UnoCSS', 'Frontend'),
('Windi CSS', 'Frontend'), ('Bulma', 'Frontend'), ('Foundation', 'Frontend'),
('Semantic UI', 'Frontend'), ('UIkit', 'Frontend'), ('Materialize', 'Frontend'),
('Tailwind UI', 'Frontend'), ('Flowbite', 'Frontend'), ('DaisyUI', 'Frontend'),
('NativeWind', 'Frontend'),

  -- Frontend: Component libraries
('Ant Design', 'Frontend'), ('Mantine', 'Frontend'), ('Radix UI', 'Frontend'),
('Headless UI', 'Frontend'), ('PrimeReact', 'Frontend'), ('PrimeVue', 'Frontend'),
('PrimeNG', 'Frontend'), ('Vuetify', 'Frontend'), ('Quasar', 'Frontend'),
('Element Plus', 'Frontend'), ('Naive UI', 'Frontend'), ('Angular Material', 'Frontend'),
('Blueprint', 'Frontend'), ('Fluent UI', 'Frontend'), ('Carbon Design System', 'Frontend'),
('React Bootstrap', 'Frontend'), ('BootstrapVue', 'Frontend'), ('Shoelace', 'Frontend'),
('Tamagui', 'Frontend'),

  -- Frontend: Animation, charts, maps and graphics
('Framer Motion', 'Frontend'), ('GSAP', 'Frontend'), ('Anime.js', 'Frontend'),
('Lottie', 'Frontend'), ('React Spring', 'Frontend'), ('Reanimated', 'Frontend'),
('Chart.js', 'Frontend'), ('Recharts', 'Frontend'), ('ECharts', 'Frontend'),
('Highcharts', 'Frontend'), ('Victory', 'Frontend'), ('Nivo', 'Frontend'),
('visx', 'Frontend'), ('Leaflet', 'Frontend'), ('Mapbox GL', 'Frontend'),
('OpenLayers', 'Frontend'), ('CesiumJS', 'Frontend'), ('Google Maps API', 'Frontend'),
('Babylon.js', 'Frontend'),

  -- Frontend: Rich text and editors
('Quill', 'Frontend'), ('TipTap', 'Frontend'), ('Draft.js', 'Frontend'),
('Slate', 'Frontend'), ('ProseMirror', 'Frontend'), ('CodeMirror', 'Frontend'),
('Monaco Editor', 'Frontend'),

  -- Frontend: Browser platform
('Responsive Design', 'Frontend'), ('Accessibility', 'Frontend'), ('SEO', 'Frontend'),
('Web Performance', 'Frontend'), ('Progressive Web Apps', 'Frontend'), ('Single-Page Applications', 'Frontend'),
('Server-Side Rendering', 'Frontend'), ('Cross-Browser Compatibility', 'Frontend'), ('DOM', 'Frontend'),
('Fetch API', 'Frontend'), ('IndexedDB', 'Frontend'), ('Web Storage', 'Frontend'),
('WebRTC', 'Frontend'), ('Web Workers', 'Frontend'), ('Service Workers', 'Frontend'),
('Web Audio API', 'Frontend'), ('Web Components', 'Frontend'), ('Shadow DOM', 'Frontend'),
('Micro Frontends', 'Frontend'),

  -- Frontend: Static sites and templating
('Hugo', 'Frontend'), ('Jekyll', 'Frontend'), ('Eleventy', 'Frontend'),
('Hexo', 'Frontend'), ('Docusaurus', 'Frontend'), ('VuePress', 'Frontend'),
('VitePress', 'Frontend'), ('Gridsome', 'Frontend'), ('Handlebars', 'Frontend'),
('Mustache', 'Frontend'), ('Pug', 'Frontend'), ('EJS', 'Frontend'),
('Jinja', 'Frontend'), ('Twig', 'Frontend'), ('Liquid', 'Frontend'),
('Thymeleaf', 'Frontend'), ('Razor', 'Frontend'), ('Remotion', 'Frontend'),

  -- Frontend: Apple platforms
('SwiftUI', 'Frontend'), ('AppKit', 'Frontend'), ('Cocoa', 'Frontend'),
('Core Data', 'Frontend'), ('Combine', 'Frontend'), ('ARKit', 'Frontend'),
('RealityKit', 'Frontend'), ('SpriteKit', 'Frontend'), ('SceneKit', 'Frontend'),
('TestFlight', 'Frontend'), ('App Store Connect', 'Frontend'), ('visionOS', 'Frontend'),
('watchOS', 'Frontend'),

  -- Frontend: Android and cross-platform mobile
('Android SDK', 'Frontend'), ('Android Jetpack', 'Frontend'), ('Room', 'Frontend'),
('Retrofit', 'Frontend'), ('Dagger', 'Frontend'), ('Hilt', 'Frontend'),
('Koin', 'Frontend'), ('Kotlin Coroutines', 'Frontend'), ('RxJava', 'Frontend'),
('Glide', 'Frontend'), ('Kotlin Multiplatform', 'Frontend'), ('Compose Multiplatform', 'Frontend'),
('NativeScript', 'Frontend'), ('Capacitor', 'Frontend'), ('Apache Cordova', 'Frontend'),
('.NET MAUI', 'Frontend'), ('Riverpod', 'Frontend'), ('Flutter Bloc', 'Frontend'),
('GetX', 'Frontend'),

  -- Frontend: Desktop GUI
('WPF', 'Frontend'), ('Windows Forms', 'Frontend'), ('WinUI', 'Frontend'),
('UWP', 'Frontend'), ('Avalonia', 'Frontend'), ('GTK', 'Frontend'),
('wxWidgets', 'Frontend'), ('JavaFX', 'Frontend'), ('Swing', 'Frontend'),
('Tkinter', 'Frontend'), ('PyQt', 'Frontend'), ('PySide', 'Frontend'),
('Kivy', 'Frontend'), ('Flet', 'Frontend'), ('Dear ImGui', 'Frontend'),

  -- Frontend: Design tools
('Sketch', 'Frontend'), ('InVision', 'Frontend'), ('Adobe Photoshop', 'Frontend'),
('Adobe Illustrator', 'Frontend'), ('Adobe After Effects', 'Frontend'), ('Adobe Premiere Pro', 'Frontend'),
('Adobe InDesign', 'Frontend'), ('Adobe Lightroom', 'Frontend'), ('Adobe Creative Cloud', 'Frontend'),
('Canva', 'Frontend'), ('Framer', 'Frontend'), ('Webflow', 'Frontend'),
('Wix', 'Frontend'), ('Squarespace', 'Frontend'), ('Balsamiq', 'Frontend'),
('Axure RP', 'Frontend'), ('Zeplin', 'Frontend'), ('Principle', 'Frontend'),
('ProtoPie', 'Frontend'),

  -- Frontend: 3D and media
('Blender', 'Frontend'), ('Cinema 4D', 'Frontend'), ('Autodesk Maya', 'Frontend'),
('3ds Max', 'Frontend'), ('ZBrush', 'Frontend'), ('Substance Painter', 'Frontend'),
('Houdini', 'Frontend'), ('DaVinci Resolve', 'Frontend'), ('Final Cut Pro', 'Frontend'),
('OBS Studio', 'Frontend'), ('Audacity', 'Frontend'), ('FL Studio', 'Frontend'),
('Ableton Live', 'Frontend'), ('Logic Pro', 'Frontend'), ('Pro Tools', 'Frontend'),

  -- Frontend: Design practice
('Game Design', 'Frontend'), ('3D Modeling', 'Frontend'), ('Mobile App Design', 'Frontend'),
('Design Thinking', 'Frontend'), ('UI Design', 'Frontend'), ('UX Design', 'Frontend'),
('UX Research', 'Frontend'), ('Wireframing', 'Frontend'), ('Prototyping', 'Frontend'),
('Design Systems', 'Frontend'), ('Typography', 'Frontend'), ('Color Theory', 'Frontend'),
('Interaction Design', 'Frontend'), ('Motion Design', 'Frontend'), ('Usability Testing', 'Frontend'),
('User Personas', 'Frontend'), ('User Journey Mapping', 'Frontend'), ('Information Architecture', 'Frontend'),
('Visual Design', 'Frontend'),

  -- Backend: Languages
('Ada', 'Backend'), ('Pascal', 'Backend'), ('Delphi', 'Backend'),
('Smalltalk', 'Backend'), ('Scheme', 'Backend'), ('Common Lisp', 'Backend'),
('Tcl', 'Backend'), ('AWK', 'Backend'), ('D', 'Backend'),
('Hack', 'Backend'), ('Apex', 'Backend'), ('ABAP', 'Backend'),
('PL/SQL', 'Backend'), ('T-SQL', 'Backend'), ('PL/pgSQL', 'Backend'),
('Vyper', 'Backend'), ('Move', 'Backend'), ('Cairo', 'Backend'),
('Ballerina', 'Backend'),

  -- Backend: JVM frameworks
('Micronaut', 'Backend'), ('Vert.x', 'Backend'), ('Dropwizard', 'Backend'),
('Play Framework', 'Backend'), ('Akka', 'Backend'), ('Spring MVC', 'Backend'),
('Spring Security', 'Backend'), ('Spring Data JPA', 'Backend'), ('Spring Cloud', 'Backend'),
('Spring WebFlux', 'Backend'), ('Spring Batch', 'Backend'), ('JPA', 'Backend'),
('JDBC', 'Backend'), ('MyBatis', 'Backend'), ('jOOQ', 'Backend'),
('Java Servlets', 'Backend'), ('JSP', 'Backend'), ('Apache Tomcat', 'Backend'),
('Jetty', 'Backend'),

  -- Backend: .NET
('ASP.NET', 'Backend'), ('ASP.NET Core', 'Backend'), ('ASP.NET MVC', 'Backend'),
('ASP.NET Web API', 'Backend'), ('SignalR', 'Backend'), ('Dapper', 'Backend'),
('LINQ', 'Backend'), ('IIS', 'Backend'),

  -- Backend: Node.js
('Hapi', 'Backend'), ('Sails.js', 'Backend'), ('AdonisJS', 'Backend'),
('LoopBack', 'Backend'), ('Feathers', 'Backend'), ('Meteor', 'Backend'),
('Restify', 'Backend'), ('Hono', 'Backend'), ('Elysia', 'Backend'),
('Mongoose', 'Backend'), ('Knex.js', 'Backend'), ('Drizzle ORM', 'Backend'),
('Objection.js', 'Backend'), ('MikroORM', 'Backend'), ('Passport.js', 'Backend'),
('NextAuth.js', 'Backend'), ('BullMQ', 'Backend'), ('PM2', 'Backend'),
('Nodemailer', 'Backend'),

  -- Backend: Python
('Django REST Framework', 'Backend'), ('Django Channels', 'Backend'), ('Pyramid', 'Backend'),
('Tornado', 'Backend'), ('Bottle', 'Backend'), ('Falcon', 'Backend'),
('Sanic', 'Backend'), ('Starlette', 'Backend'), ('Litestar', 'Backend'),
('aiohttp', 'Backend'), ('asyncio', 'Backend'), ('Pydantic', 'Backend'),
('Alembic', 'Backend'), ('Peewee', 'Backend'), ('Tortoise ORM', 'Backend'),
('Gunicorn', 'Backend'), ('Uvicorn', 'Backend'), ('uWSGI', 'Backend'),
('Dramatiq', 'Backend'),

  -- Backend: Ruby and PHP
('Sinatra', 'Backend'), ('Hanami', 'Backend'), ('Grape', 'Backend'),
('Sidekiq', 'Backend'), ('Puma', 'Backend'), ('Active Record', 'Backend'),
('Slim Framework', 'Backend'), ('Lumen', 'Backend'), ('CakePHP', 'Backend'),
('Yii', 'Backend'), ('Laminas', 'Backend'), ('Phalcon', 'Backend'),
('Doctrine', 'Backend'), ('Eloquent', 'Backend'), ('Drupal', 'Backend'),
('WordPress', 'Backend'), ('Joomla', 'Backend'), ('Magento', 'Backend'),
('WooCommerce', 'Backend'),

  -- Backend: Go, Rust, Elixir, Haskell, Swift, C++
('Echo', 'Backend'), ('Fiber', 'Backend'), ('Chi', 'Backend'),
('Gorilla Mux', 'Backend'), ('Beego', 'Backend'), ('Buffalo', 'Backend'),
('GORM', 'Backend'), ('sqlx', 'Backend'), ('Axum', 'Backend'),
('Rocket', 'Backend'), ('Warp', 'Backend'), ('Tokio', 'Backend'),
('Diesel', 'Backend'), ('SeaORM', 'Backend'), ('Serde', 'Backend'),
('Hyper', 'Backend'), ('Tonic', 'Backend'), ('Ecto', 'Backend'),
('Absinthe', 'Backend'),

  -- Backend: APIs, protocols and messaging
('Load Balancing', 'Backend'), ('API Design', 'Backend'), ('Rate Limiting', 'Backend'),
('Protocol Buffers', 'Backend'), ('Apache Thrift', 'Backend'), ('JSON-RPC', 'Backend'),
('SOAP', 'Backend'), ('WSDL', 'Backend'), ('XML', 'Backend'),
('JSON', 'Backend'), ('YAML', 'Backend'), ('OpenAPI', 'Backend'),
('AsyncAPI', 'Backend'), ('JSON Schema', 'Backend'), ('HATEOAS', 'Backend'),
('Webhooks', 'Backend'), ('Server-Sent Events', 'Backend'), ('MQTT', 'Backend'),
('AMQP', 'Backend'),

  -- Backend: Serverless and backend platforms
('Serverless', 'Backend'), ('AWS Lambda', 'Backend'), ('Azure Functions', 'Backend'),
('Google Cloud Functions', 'Backend'), ('Cloudflare Workers', 'Backend'), ('Appwrite', 'Backend'),
('PocketBase', 'Backend'), ('Hasura', 'Backend'), ('PostGraphile', 'Backend'),
('Parse Platform', 'Backend'), ('AWS Amplify', 'Backend'), ('Convex', 'Backend'),
('Firebase Authentication', 'Backend'), ('Cloud Firestore', 'Backend'), ('Firebase Realtime Database', 'Backend'),

  -- Backend: Databases
('CockroachDB', 'Backend'), ('TiDB', 'Backend'), ('YugabyteDB', 'Backend'),
('PlanetScale', 'Backend'), ('Neon', 'Backend'), ('Vitess', 'Backend'),
('Amazon Aurora', 'Backend'), ('Amazon RDS', 'Backend'), ('Google Cloud SQL', 'Backend'),
('Cloud Spanner', 'Backend'), ('Couchbase', 'Backend'), ('RavenDB', 'Backend'),
('ArangoDB', 'Backend'), ('OrientDB', 'Backend'), ('JanusGraph', 'Backend'),
('Amazon Neptune', 'Backend'), ('TigerGraph', 'Backend'), ('Dgraph', 'Backend'),
('FaunaDB', 'Backend'),

  -- Backend: Auth and security
('Authentication', 'Backend'), ('Authorization', 'Backend'), ('RBAC', 'Backend'),
('OpenID Connect', 'Backend'), ('SAML', 'Backend'), ('LDAP', 'Backend'),
('Auth0', 'Backend'), ('Clerk', 'Backend'), ('Keycloak', 'Backend'),
('Okta', 'Backend'), ('AWS Cognito', 'Backend'), ('Single Sign-On', 'Backend'),
('Encryption', 'Backend'), ('Cryptography', 'Backend'), ('TLS', 'Backend'),
('HTTPS', 'Backend'), ('bcrypt', 'Backend'),

  -- Backend: Architecture and CS fundamentals
('Operating Systems', 'Backend'), ('Computer Networking', 'Backend'), ('HTTP', 'Backend'),
('TCP/IP', 'Backend'), ('Caching', 'Backend'), ('Compilers', 'Backend'),
('Parallel Computing', 'Backend'), ('Computer Architecture', 'Backend'), ('Memory Management', 'Backend'),
('Object-Oriented Programming', 'Backend'), ('Functional Programming', 'Backend'), ('Data Structures', 'Backend'),
('Algorithms', 'Backend'), ('System Design', 'Backend'), ('Distributed Systems', 'Backend'),
('Concurrency', 'Backend'), ('Multithreading', 'Backend'), ('Asynchronous Programming', 'Backend'),
('Design Patterns', 'Backend'),

  -- Backend: Embedded and hardware
('UART', 'Backend'), ('Bluetooth Low Energy', 'Backend'), ('Embedded Systems', 'Backend'),
('Embedded C', 'Backend'), ('Firmware', 'Backend'), ('RTOS', 'Backend'),
('FreeRTOS', 'Backend'), ('Zephyr', 'Backend'), ('Arduino', 'Backend'),
('Raspberry Pi', 'Backend'), ('ESP32', 'Backend'), ('STM32', 'Backend'),
('Microcontrollers', 'Backend'), ('FPGA', 'Backend'), ('IoT', 'Backend'),
('ROS', 'Backend'), ('ROS 2', 'Backend'), ('Device Drivers', 'Backend'),
('Linux Kernel', 'Backend'),

  -- Backend: Blockchain
('Blockchain', 'Backend'), ('Ethereum', 'Backend'), ('Web3.js', 'Backend'),
('Ethers.js', 'Backend'), ('Hardhat', 'Backend'), ('Truffle', 'Backend'),
('Foundry', 'Backend'), ('Smart Contracts', 'Backend'), ('Solana', 'Backend'),
('Hyperledger Fabric', 'Backend'), ('IPFS', 'Backend'),

  -- Backend: Third-party services and CMS
('Stripe', 'Backend'), ('PayPal API', 'Backend'), ('Twilio', 'Backend'),
('SendGrid', 'Backend'), ('Mailgun', 'Backend'), ('Plaid', 'Backend'),
('Slack API', 'Backend'), ('Telegram Bot API', 'Backend'), ('Contentful', 'Backend'),
('Sanity', 'Backend'), ('Ghost', 'Backend'), ('Directus', 'Backend'),
('Payload CMS', 'Backend'), ('Keystone.js', 'Backend'), ('Prismic', 'Backend'),
('Storyblok', 'Backend'), ('Shopify', 'Backend'), ('Shopify Liquid', 'Backend'),

  -- Data: Languages and statistical software
('Stata', 'Data'), ('SPSS', 'Data'), ('Minitab', 'Data'),
('EViews', 'Data'), ('Microsoft Excel', 'Data'), ('Google Sheets', 'Data'),
('Mathematica', 'Data'), ('Wolfram Language', 'Data'), ('Maple', 'Data'),
('GNU Octave', 'Data'), ('SymPy', 'Data'), ('Simulink', 'Data'),
('LabVIEW', 'Data'), ('RStudio', 'Data'), ('R Markdown', 'Data'),
('Quarto', 'Data'), ('Shiny', 'Data'),

  -- Data: R ecosystem
('ggplot2', 'Data'), ('dplyr', 'Data'), ('tidyr', 'Data'),
('tidyverse', 'Data'), ('data.table', 'Data'), ('caret', 'Data'),
('tidymodels', 'Data'),

  -- Data: BI and analytics platforms
('Alteryx', 'Data'), ('KNIME', 'Data'), ('RapidMiner', 'Data'),
('Orange', 'Data'), ('Weka', 'Data'), ('Qlik Sense', 'Data'),
('QlikView', 'Data'), ('Metabase', 'Data'), ('Apache Superset', 'Data'),
('Redash', 'Data'), ('Sisense', 'Data'), ('Domo', 'Data'),
('MicroStrategy', 'Data'), ('Looker Studio', 'Data'), ('LookML', 'Data'),
('Amplitude', 'Data'), ('Mixpanel', 'Data'), ('Google Analytics', 'Data'),
('Segment', 'Data'),

  -- Data: Analysis and statistics
('Optimization', 'Data'), ('Numerical Methods', 'Data'), ('Scientific Computing', 'Data'),
('Causal Inference', 'Data'), ('Data Analysis', 'Data'), ('Data Visualization', 'Data'),
('Data Cleaning', 'Data'), ('Data Wrangling', 'Data'), ('Exploratory Data Analysis', 'Data'),
('Statistics', 'Data'), ('Probability', 'Data'), ('Linear Algebra', 'Data'),
('Calculus', 'Data'), ('Discrete Mathematics', 'Data'), ('Bayesian Statistics', 'Data'),
('Hypothesis Testing', 'Data'), ('A/B Testing', 'Data'), ('Regression Analysis', 'Data'),
('Time Series Analysis', 'Data'),

  -- Data: Machine learning
('Neural Networks', 'Data'), ('Convolutional Neural Networks', 'Data'), ('Recurrent Neural Networks', 'Data'),
('Transformers', 'Data'), ('MLOps', 'Data'), ('Model Deployment', 'Data'),
('Decision Trees', 'Data'), ('Random Forests', 'Data'), ('Machine Learning', 'Data'),
('Deep Learning', 'Data'), ('Reinforcement Learning', 'Data'), ('Supervised Learning', 'Data'),
('Unsupervised Learning', 'Data'), ('Self-Supervised Learning', 'Data'), ('Transfer Learning', 'Data'),
('Natural Language Processing', 'Data'), ('Computer Vision', 'Data'), ('Speech Recognition', 'Data'),
('Recommender Systems', 'Data'),

  -- Data: Generative AI
('Pinecone', 'Data'), ('FAISS', 'Data'), ('LoRA', 'Data'),
('BERT', 'Data'), ('GPT', 'Data'), ('Large Language Models', 'Data'),
('Generative AI', 'Data'), ('Prompt Engineering', 'Data'), ('Retrieval-Augmented Generation', 'Data'),
('Fine-Tuning', 'Data'), ('RLHF', 'Data'), ('Embeddings', 'Data'),
('Vector Databases', 'Data'), ('AI Agents', 'Data'), ('OpenAI API', 'Data'),
('Claude API', 'Data'), ('Gemini API', 'Data'), ('LlamaIndex', 'Data'),
('Ollama', 'Data'),

  -- Data: Vision, NLP and speech
('Object Detection', 'Data'), ('Image Segmentation', 'Data'), ('Image Classification', 'Data'),
('OCR', 'Data'), ('Tesseract', 'Data'), ('Pose Estimation', 'Data'),
('Sentiment Analysis', 'Data'), ('Named Entity Recognition', 'Data'), ('Topic Modeling', 'Data'),
('Machine Translation', 'Data'), ('Text Classification', 'Data'), ('Information Retrieval', 'Data'),
('Knowledge Graphs', 'Data'), ('YOLO', 'Data'), ('Detectron2', 'Data'),
('MediaPipe', 'Data'), ('Dlib', 'Data'), ('scikit-image', 'Data'),
('Pillow', 'Data'),

  -- Data: ML frameworks and tooling
('PyTorch Lightning', 'Data'), ('fastai', 'Data'), ('Theano', 'Data'),
('Caffe', 'Data'), ('Apache MXNet', 'Data'), ('PaddlePaddle', 'Data'),
('TensorFlow Lite', 'Data'), ('TensorFlow.js', 'Data'), ('Core ML', 'Data'),
('TensorRT', 'Data'), ('OpenVINO', 'Data'), ('TensorFlow Serving', 'Data'),
('TorchServe', 'Data'), ('Triton Inference Server', 'Data'), ('BentoML', 'Data'),
('CatBoost', 'Data'), ('Prophet', 'Data'), ('ARIMA', 'Data'),
('sktime', 'Data'),

  -- Data: Visualization and graphs
('Bokeh', 'Data'), ('Altair', 'Data'), ('NetworkX', 'Data'),
('igraph', 'Data'), ('Gephi', 'Data'), ('Folium', 'Data'),
('Dash', 'Data'),

  -- Data: Big data and streaming
('Kafka Streams', 'Data'), ('HDFS', 'Data'), ('MapReduce', 'Data'),
('Amazon Kinesis', 'Data'), ('AWS Glue', 'Data'), ('Big Data', 'Data'),
('PySpark', 'Data'), ('Spark SQL', 'Data'), ('Spark Streaming', 'Data'),
('Apache Flink', 'Data'), ('Apache Beam', 'Data'), ('Apache Storm', 'Data'),
('Apache Hive', 'Data'), ('Apache Pig', 'Data'), ('Apache Impala', 'Data'),
('Presto', 'Data'), ('Trino', 'Data'), ('Apache Iceberg', 'Data'),
('Delta Lake', 'Data'),

  -- Data: Data engineering and warehousing
('ETL', 'Data'), ('ELT', 'Data'), ('Data Pipelines', 'Data'),
('Data Engineering', 'Data'), ('Data Warehousing', 'Data'), ('Data Lakes', 'Data'),
('Data Lakehouse', 'Data'), ('Data Modeling', 'Data'), ('Dimensional Modeling', 'Data'),
('Data Governance', 'Data'), ('Data Quality', 'Data'), ('Data Mining', 'Data'),
('Web Scraping', 'Data'), ('Beautiful Soup', 'Data'), ('Scrapy', 'Data'),
('Fivetran', 'Data'), ('Airbyte', 'Data'), ('Stitch', 'Data'),
('Talend', 'Data'),

  -- Data: Domain data science
('Bioinformatics', 'Data'), ('Biopython', 'Data'), ('Computational Biology', 'Data'),
('Genomics', 'Data'), ('QGIS', 'Data'), ('ArcGIS', 'Data'),
('GeoPandas', 'Data'), ('Shapely', 'Data'), ('Remote Sensing', 'Data'),
('GIS', 'Data'), ('Gurobi', 'Data'), ('CPLEX', 'Data'),
('Quantum Computing', 'Data'), ('Qiskit', 'Data'), ('Cirq', 'Data'),

  -- Tools: Version control and hosting
('Code Review', 'Tools'), ('Pull Requests', 'Tools'), ('GitHub', 'Tools'),
('GitLab', 'Tools'), ('Mercurial', 'Tools'), ('Apache Subversion', 'Tools'),
('Perforce', 'Tools'), ('Git LFS', 'Tools'), ('GitKraken', 'Tools'),
('Sourcetree', 'Tools'), ('GitHub Desktop', 'Tools'), ('GitHub Copilot', 'Tools'),
('Cursor', 'Tools'), ('Claude Code', 'Tools'), ('GitHub Codespaces', 'Tools'),
('Gitpod', 'Tools'), ('Replit', 'Tools'), ('CodeSandbox', 'Tools'),
('StackBlitz', 'Tools'),

  -- Tools: Editors and IDEs
('Neovim', 'Tools'), ('Emacs', 'Tools'), ('Sublime Text', 'Tools'),
('Atom', 'Tools'), ('Notepad++', 'Tools'), ('Nano', 'Tools'),
('PyCharm', 'Tools'), ('WebStorm', 'Tools'), ('CLion', 'Tools'),
('GoLand', 'Tools'), ('Rider', 'Tools'), ('RubyMine', 'Tools'),
('PhpStorm', 'Tools'), ('DataGrip', 'Tools'), ('NetBeans', 'Tools'),
('Code::Blocks', 'Tools'), ('Spyder', 'Tools'), ('Zed', 'Tools'),
('DBeaver', 'Tools'),

  -- Tools: Command line and package managers
('SSH', 'Tools'), ('Shell Scripting', 'Tools'), ('Regular Expressions', 'Tools'),
('Cron', 'Tools'), ('Insomnia', 'Tools'), ('cURL', 'Tools'),
('HTTPie', 'Tools'), ('Charles Proxy', 'Tools'), ('Fiddler', 'Tools'),
('ngrok', 'Tools'), ('tmux', 'Tools'), ('Zsh', 'Tools'),
('Oh My Zsh', 'Tools'), ('Fish Shell', 'Tools'), ('WSL', 'Tools'),
('Homebrew', 'Tools'), ('Chocolatey', 'Tools'), ('APT', 'Tools'),
('pip', 'Tools'),

  -- Tools: Build tools and monorepos
('Make', 'Tools'), ('Ninja', 'Tools'), ('Bazel', 'Tools'),
('Apache Ant', 'Tools'), ('sbt', 'Tools'), ('Rollup', 'Tools'),
('esbuild', 'Tools'), ('SWC', 'Tools'), ('Parcel', 'Tools'),
('Turbopack', 'Tools'), ('Turborepo', 'Tools'), ('Nx', 'Tools'),
('Lerna', 'Tools'), ('Gulp', 'Tools'), ('Grunt', 'Tools'),

  -- Tools: Linters, formatters and debuggers
('Debugging', 'Tools'), ('Profiling', 'Tools'), ('Refactoring', 'Tools'),
('Stylelint', 'Tools'), ('Pylint', 'Tools'), ('Flake8', 'Tools'),
('Black', 'Tools'), ('isort', 'Tools'), ('mypy', 'Tools'),
('Ruff', 'Tools'), ('RuboCop', 'Tools'), ('Checkstyle', 'Tools'),
('SpotBugs', 'Tools'), ('Clippy', 'Tools'), ('rustfmt', 'Tools'),
('golangci-lint', 'Tools'), ('clang-format', 'Tools'), ('clang-tidy', 'Tools'),
('Valgrind', 'Tools'),

  -- Tools: Security
('Penetration Testing', 'Tools'), ('Vulnerability Assessment', 'Tools'), ('Threat Modeling', 'Tools'),
('Incident Response', 'Tools'), ('Digital Forensics', 'Tools'), ('Reverse Engineering', 'Tools'),
('Network Security', 'Tools'), ('Web Application Security', 'Tools'), ('OWASP Top 10', 'Tools'),
('Cloud Security', 'Tools'), ('Active Directory', 'Tools'), ('OWASP ZAP', 'Tools'),
('Nessus', 'Tools'), ('OpenVAS', 'Tools'), ('John the Ripper', 'Tools'),
('Hashcat', 'Tools'), ('Aircrack-ng', 'Tools'), ('Ghidra', 'Tools'),
('IDA Pro', 'Tools'), ('Radare2', 'Tools'),

  -- Tools: AWS
('Amazon EC2', 'Tools'), ('Amazon S3', 'Tools'), ('Amazon ECS', 'Tools'),
('Amazon EKS', 'Tools'), ('AWS Fargate', 'Tools'), ('AWS CloudFormation', 'Tools'),
('AWS CDK', 'Tools'), ('AWS IAM', 'Tools'), ('Amazon CloudWatch', 'Tools'),
('Amazon Route 53', 'Tools'), ('Amazon CloudFront', 'Tools'), ('AWS Elastic Beanstalk', 'Tools'),
('Amazon VPC', 'Tools'), ('AWS Step Functions', 'Tools'), ('AWS CodePipeline', 'Tools'),
('AWS SAM', 'Tools'), ('Amazon API Gateway', 'Tools'), ('Amazon ECR', 'Tools'),

  -- Tools: Azure, Google Cloud and other hosts
('Azure DevOps', 'Tools'), ('Azure App Service', 'Tools'), ('Azure Kubernetes Service', 'Tools'),
('Azure Blob Storage', 'Tools'), ('Azure Pipelines', 'Tools'), ('ARM Templates', 'Tools'),
('Bicep', 'Tools'), ('Google Kubernetes Engine', 'Tools'), ('Google Cloud Run', 'Tools'),
('Google App Engine', 'Tools'), ('Google Compute Engine', 'Tools'), ('Google Cloud Storage', 'Tools'),
('Firebase Hosting', 'Tools'), ('Oracle Cloud', 'Tools'), ('IBM Cloud', 'Tools'),
('Alibaba Cloud', 'Tools'), ('Linode', 'Tools'), ('Vultr', 'Tools'),
('Render', 'Tools'), ('Railway', 'Tools'),

  -- Tools: Virtualization and containers
('OpenStack', 'Tools'), ('VMware', 'Tools'), ('vSphere', 'Tools'),
('Proxmox', 'Tools'), ('VirtualBox', 'Tools'), ('Hyper-V', 'Tools'),
('KVM', 'Tools'), ('QEMU', 'Tools'), ('Podman', 'Tools'),
('containerd', 'Tools'), ('Docker Compose', 'Tools'), ('Docker Swarm', 'Tools'),
('OpenShift', 'Tools'), ('Rancher', 'Tools'), ('k3s', 'Tools'),
('minikube', 'Tools'), ('Kustomize', 'Tools'),

  -- Tools: CI/CD and infrastructure as code
('DevOps', 'Tools'), ('DevSecOps', 'Tools'), ('Site Reliability Engineering', 'Tools'),
('GitOps', 'Tools'), ('Argo CD', 'Tools'), ('Flux', 'Tools'),
('Tekton', 'Tools'), ('Spinnaker', 'Tools'), ('Travis CI', 'Tools'),
('TeamCity', 'Tools'), ('Bamboo', 'Tools'), ('Buildkite', 'Tools'),
('Pulumi', 'Tools'), ('Chef', 'Tools'), ('Puppet', 'Tools'),
('SaltStack', 'Tools'), ('Packer', 'Tools'), ('Nomad', 'Tools'),
('Terragrunt', 'Tools'), ('Serverless Framework', 'Tools'),

  -- Tools: Observability
('Logging', 'Tools'), ('Monitoring', 'Tools'), ('New Relic', 'Tools'),
('Dynatrace', 'Tools'), ('AppDynamics', 'Tools'), ('ELK Stack', 'Tools'),
('Logstash', 'Tools'), ('Kibana', 'Tools'), ('Fluentd', 'Tools'),
('Fluent Bit', 'Tools'), ('Grafana Loki', 'Tools'), ('Jaeger', 'Tools'),
('Zipkin', 'Tools'), ('OpenTelemetry', 'Tools'), ('PagerDuty', 'Tools'),
('Opsgenie', 'Tools'), ('Nagios', 'Tools'), ('Zabbix', 'Tools'),
('Honeycomb', 'Tools'), ('LogRocket', 'Tools'),

  -- Tools: Testing
('Unit Testing', 'Tools'), ('Integration Testing', 'Tools'), ('End-to-End Testing', 'Tools'),
('Test Automation', 'Tools'), ('Load Testing', 'Tools'), ('Quality Assurance', 'Tools'),
('Mockito', 'Tools'), ('NUnit', 'Tools'), ('xUnit', 'Tools'),
('Google Test', 'Tools'), ('Puppeteer', 'Tools'), ('TestCafe', 'Tools'),
('WebdriverIO', 'Tools'), ('Appium', 'Tools'), ('Espresso', 'Tools'),
('XCTest', 'Tools'), ('Detox', 'Tools'), ('Robot Framework', 'Tools'),
('Cucumber', 'Tools'), ('SpecFlow', 'Tools'),

  -- Tools: Documentation
('Markdown', 'Tools'), ('reStructuredText', 'Tools'), ('Sphinx', 'Tools'),
('MkDocs', 'Tools'), ('Javadoc', 'Tools'), ('JSDoc', 'Tools'),
('Doxygen', 'Tools'), ('Read the Docs', 'Tools'), ('GitBook', 'Tools'),
('Notion', 'Tools'), ('Obsidian', 'Tools'), ('Technical Writing', 'Tools'),
('API Documentation', 'Tools'),

  -- Tools: Collaboration and productivity
('Microsoft Office', 'Tools'), ('Microsoft Word', 'Tools'), ('Microsoft PowerPoint', 'Tools'),
('Google Workspace', 'Tools'), ('Slack', 'Tools'), ('Microsoft Teams', 'Tools'),
('Discord', 'Tools'), ('Asana', 'Tools'), ('Monday.com', 'Tools'),
('ClickUp', 'Tools'), ('Linear', 'Tools'), ('Basecamp', 'Tools'),
('Airtable', 'Tools'), ('Miro', 'Tools'), ('Lucidchart', 'Tools'),
('draw.io', 'Tools'), ('Microsoft Visio', 'Tools'), ('Microsoft Project', 'Tools'),
('Smartsheet', 'Tools'), ('ServiceNow', 'Tools'),

  -- Tools: Process
('Scrum', 'Tools'), ('Kanban', 'Tools'), ('Lean', 'Tools'),
('Waterfall', 'Tools'), ('SAFe', 'Tools'), ('Extreme Programming', 'Tools'),
('ITIL', 'Tools'), ('Project Management', 'Tools'), ('Product Management', 'Tools'),
('Sprint Planning', 'Tools'), ('User Stories', 'Tools'), ('Requirements Gathering', 'Tools'),
('Pair Programming', 'Tools'), ('Software Development Life Cycle', 'Tools'), ('Code Documentation', 'Tools'),

  -- Tools: CAD, electronics and game dev
('KiCad', 'Tools'), ('Eagle', 'Tools'), ('Altium Designer', 'Tools'),
('AutoCAD', 'Tools'), ('SolidWorks', 'Tools'), ('Fusion 360', 'Tools'),
('Onshape', 'Tools'), ('CATIA', 'Tools'), ('Ansys', 'Tools'),
('LTspice', 'Tools'), ('Multisim', 'Tools'), ('PCB Design', 'Tools'),
('3D Printing', 'Tools'), ('GameMaker', 'Tools'), ('Roblox Studio', 'Tools'),
('Unreal Blueprints', 'Tools'), ('Pygame', 'Tools'), ('LÖVE', 'Tools'),
('MonoGame', 'Tools'), ('libGDX', 'Tools')
on conflict (name) do nothing;
