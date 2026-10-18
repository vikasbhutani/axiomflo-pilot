import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiProvider } from './auth/apiContext';
import { AuthProvider } from './auth/AuthContext';
import { createAuthSetup } from './auth/setup';
import { DemoProvider } from './context/DemoContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';

const auth = createAuthSetup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider client={auth.client} missingConfig={auth.missingConfig} membershipService={auth.membershipService}>
        <ApiProvider api={auth.api}>
          <DemoProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </DemoProvider>
        </ApiProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
