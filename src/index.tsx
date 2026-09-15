import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';

import { AppRoutes } from './routes/AppRoutes';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { ActivityLogProvider } from './contexts/ActivityLogContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={clientId || ''}>
      <BrowserRouter>
        <AuthProvider>
          <OrganizationProvider>
            <ActivityLogProvider>
              <AppRoutes />
            </ActivityLogProvider>
          </OrganizationProvider>
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
