import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { DemoProvider } from './context/DemoContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DemoProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DemoProvider>
    </BrowserRouter>
  </StrictMode>,
);
