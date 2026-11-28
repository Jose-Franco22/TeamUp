import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/SessionContext';
import { ThemeProvider } from './theme/ThemeContext';
import { isMisconfigured } from './lib/mockMode';
import './styles.css';

// A build that runs against Supabase but wasn't given its address would
// otherwise fail on the first request with a blank page. Say what's missing.
function NotConfigured() {
  return (
    <main className="shell">
      <section className="card">
        <h1>TeamUp isn&apos;t configured</h1>
        <p>
          This build has no Supabase project to talk to. Set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> (or <code>VITE_USE_MOCKS=true</code> for a demo) and
          deploy again.
        </p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMisconfigured() ? (
      <NotConfigured />
    ) : (
      <ThemeProvider>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </ThemeProvider>
    )}
  </React.StrictMode>
);
