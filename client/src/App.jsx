import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import HomePage from './components/HomePage';
import TorrentPageNetflix from './components/TorrentPageNetflix';
import RssReaderPage from './components/RssReaderPage';
import LoginScreen from './components/LoginScreen';
import FilesPage from './components/FilesPage';
import SearchSourcesPage1 from './components/SearchSourcesPage1';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './App.css';
import { config } from './config/environment.js';

// 1. Reusable spinner component
const FullScreenLoader = ({ text }) => (
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
      <p>{text}</p>
    </div>
  </div>
);

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoading, authenticate } = useAuth();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return <FullScreenLoader text="Loading Seedbox..." />;
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen onAuthSuccess={authenticate} />;
  }

  // Show main app if authenticated
  return (
    <Router>
      <Routes>
        <Route path="torrent/:torrentHash" element={<TorrentPageNetflix />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="rss" element={<RssReaderPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="search-sources" element={<SearchSourcesPage1 />} />
        </Route>
      </Routes>
    </Router>
  );
};

function App() {
  const [configData, setConfigData] = useState(null);
  const [configError, setConfigError] = useState(false);

  // 2. Fetch the live runtime configuration from your Express backend
  useEffect(() => {
    fetch(config.apiBaseUrl + '/api/config')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load config');
        return res.json();
      })
      .then((data) => setConfigData(data))
      .catch((err) => {
        console.error("Config fetch error:", err);
        setConfigError(true);
      });
  }, []);

  // 3. Block rendering until the backend provides the variables
  if (configError) {
    return <div style={{ color: 'white', textAlign: 'center', marginTop: '50px' }}>Fatal Error: Could not load environment configuration.</div>;
  }

  if (!configData) {
    return <FullScreenLoader text="Initializing Environment..." />;
  }

  return (
    // 4. Inject the dynamically fetched client ID
    <GoogleOAuthProvider clientId={configData.googleClientId}>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;