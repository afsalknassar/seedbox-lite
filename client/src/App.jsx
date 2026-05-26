import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import HomePage from './components/HomePage';
import TorrentPageNetflix from './components/TorrentPageNetflix';
import RssReaderPage from './components/RssReaderPage';
import LoginScreen from './components/LoginScreen';
import FilesPage from './components/FilesPage';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './App.css';

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoading, authenticate } = useAuth();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#ffffff'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255, 255, 255, 0.2)',
            borderTop: '4px solid #e50914',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }}></div>
          <p>Loading Seedbox...</p>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen onAuthSuccess={authenticate} />;
  }

  // Show main app if authenticated
  return (
    <Router>
      <Routes>
        {/* Full-width Netflix-style page without sidebar */}
        <Route path="torrent/:torrentHash" element={<TorrentPageNetflix />} />
        
        {/* Main app with sidebar layout */}
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="rss" element={<RssReaderPage />} />
          <Route path="files" element={<FilesPage />} />
        </Route>
      </Routes>
    </Router>
  );
};

function App() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';
  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
