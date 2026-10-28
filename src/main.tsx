import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Old tabs can outlive a deployment and then request a hashed lazy chunk that
// no longer exists in the new release. Refresh once so the tab picks up the
// current index.html and chunk manifest instead of leaving the section broken.
const chunkReloadKey = 'distropro:chunk-reload-at';
window.addEventListener('vite:preloadError', (event) => {
  const lastReload = Number(sessionStorage.getItem(chunkReloadKey) || 0);
  if (Date.now() - lastReload < 30_000) return;
  sessionStorage.setItem(chunkReloadKey, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
