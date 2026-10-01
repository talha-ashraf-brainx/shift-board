import '@fontsource-variable/inter';
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ApiError } from './api/client';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Client errors (404, 409, ...) will not fix themselves.
        if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-right" theme="light" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  </StrictMode>,
);
