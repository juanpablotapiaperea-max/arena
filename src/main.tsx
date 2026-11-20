import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { APP_NAME } from '@shared/config';
import { AuthProvider } from '@/lib/auth';
import { A11yProvider, useA11y } from '@/lib/a11y';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { ErrorBoundary, reloadForNewVersion } from '@/components/ErrorBoundary';
import { UpdateBanner } from '@/components/UpdateBanner';
import './styles/index.css';

document.title = APP_NAME;

// Si se publicó una versión nueva mientras la app estaba abierta, los archivos
// viejos ya no existen: se recarga sola para traer la nueva en vez de quedar en negro.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Motion({ children }: { children: React.ReactNode }) {
  const { prefs } = useA11y();
  return <MotionConfig reducedMotion={prefs.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <A11yProvider>
        <Motion>
          <AuthProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <UpdateBanner />
            </BrowserRouter>
          </AuthProvider>
        </Motion>
      </A11yProvider>
    </QueryClientProvider>
  </StrictMode>,
);
