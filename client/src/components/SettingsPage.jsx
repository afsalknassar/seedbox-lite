import React, { useState, useEffect } from 'react';
import { Settings, Trash2, Download, Globe, Shield, HardDrive, ExternalLink, LogOut, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { config } from '../config/environment';
import { useAuth } from '../context/AuthContext';
import progressService from '../services/progressService';
import '../assets/styles/SettingsPage.css';

const SettingsPage = () => {
  const { logout } = useAuth();
  const [settings, setSettings] = useState({
    downloadPath: '/tmp/seedbox-downloads',
    maxConnections: 50,
    autoStartDownload: true,
    preserveSubtitles: true,
    defaultQuality: '1080p',
    autoResume: true,
    bufferSize: 50
  });
  
  const [stats, setStats] = useState({});
  
  useEffect(() => {
    const loadSettings = () => {
      try {
        const saved = localStorage.getItem('seedbox-settings');
        if (saved) {
          setSettings(prevSettings => ({ ...prevSettings, ...JSON.parse(saved) }));
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    loadSettings();
  }, []);

  const loadStats = () => {
    const statistics = progressService.getStats();
    setStats(statistics);
  };

  const saveSettings = (newSettings) => {
    try {
      localStorage.setItem('seedbox-settings', JSON.stringify(newSettings));
      setSettings(newSettings);
      console.log('Settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleSettingChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  const clearAllData = () => {
    if (window.confirm('Clear all application data? This will remove all progress, settings, and cache. This cannot be undone.')) {
      localStorage.clear();
      progressService.clearAllProgress();
      setSettings({
        downloadPath: '/tmp/seedbox-downloads',
        maxConnections: 50,
        autoStartDownload: true,
        preserveSubtitles: true,
        defaultQuality: '1080p',
        autoResume: true,
        bufferSize: 50
      });
      loadStats();
      alert('All data cleared successfully');
    }
  };

  const clearWebTorrentCache = async () => {
    if (window.confirm('Clear WebTorrent cache? This will remove all downloaded torrent data and stop active torrents.')) {
      try {
        const response = await fetch(config.api.torrents, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          const result = await response.json();
          alert(`WebTorrent cache cleared: ${result.cleared || 0} torrents removed`);
        } else {
          alert('Failed to clear WebTorrent cache');
        }
      } catch (error) {
        console.error('Error clearing WebTorrent cache:', error);
        alert('Error clearing WebTorrent cache: ' + error.message);
      }
    }
  };

  const clearProgressData = () => {
    if (window.confirm('Clear all video progress data? Your watch history and resume points will be lost.')) {
      progressService.clearAllProgress();
      loadStats();
      alert('Progress data cleared successfully');
    }
  };

  const exportSettings = () => {
    const allData = {
      settings,
      progress: progressService.getAllProgress(),
      exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seedbox-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importSettings = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        if (data.settings) {
          saveSettings(data.settings);
        }
        
        if (data.progress) {
          localStorage.setItem('seedbox-video-progress', JSON.stringify(data.progress));
          loadStats();
        }
        
        alert('Settings imported successfully');
      } catch (error) {
        alert('Error importing settings: Invalid file format');
        console.error('Import error:', error);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset file input
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout? You will need to enter the password again to access the dashboard.')) {
      logout();
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>
          <Settings size={28} />
          Settings
        </h1>
        <p>Configure your SeedBox Lite experience</p>
      </div>

      {/* Application Statistics */}
      <div className="settings-section">
        <h2>📊 Statistics</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Total Videos Watched</span>
            <span className="stat-value">{stats.totalVideos || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Completed Videos</span>
            <span className="stat-value">{stats.completed || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Videos In Progress</span>
            <span className="stat-value">{stats.inProgress || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Watch Time</span>
            <span className="stat-value">{stats.totalWatchTime || '0:00'}</span>
          </div>
        </div>
      </div>

      {/* Video Settings */}
      <div className="settings-section">
        <h2>🎬 Video Settings</h2>
        <div className="settings-grid">
          <div className="setting-item">
            <label>
              <span>Auto Resume Videos</span>
              <p>Automatically ask to resume videos from last position</p>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.autoResume}
                onChange={(e) => handleSettingChange('autoResume', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span>Default Quality Preference</span>
              <p>Preferred video quality for streaming</p>
            </label>
            <select
              value={settings.defaultQuality}
              onChange={(e) => handleSettingChange('defaultQuality', e.target.value)}
              className="setting-select"
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4K">4K</option>
            </select>
          </div>

          <div className="setting-item">
            <label>
              <span>Buffer Size (MB)</span>
              <p>Video buffer size for smooth playback</p>
            </label>
            <input
              type="range"
              min="10"
              max="200"
              value={settings.bufferSize}
              onChange={(e) => handleSettingChange('bufferSize', parseInt(e.target.value))}
              className="setting-slider"
            />
            <span className="slider-value">{settings.bufferSize} MB</span>
          </div>
        </div>
      </div>

      {/* Download Settings */}
      <div className="settings-section">
        <h2>⬇️ Download Settings</h2>
        <div className="settings-grid">
          <div className="setting-item">
            <label>
              <span>Auto Start Downloads</span>
              <p>Automatically start downloading when torrent is added</p>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.autoStartDownload}
                onChange={(e) => handleSettingChange('autoStartDownload', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span>Preserve Subtitle Files</span>
              <p>Keep subtitle files when streaming videos</p>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.preserveSubtitles}
                onChange={(e) => handleSettingChange('preserveSubtitles', e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span>Max Connections</span>
              <p>Maximum concurrent connections per torrent</p>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={settings.maxConnections}
              onChange={(e) => handleSettingChange('maxConnections', parseInt(e.target.value))}
              className="setting-slider"
            />
            <span className="slider-value">{settings.maxConnections}</span>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="settings-section">
        <h2>🗃️ Data Management</h2>
        <div className="data-actions">
          <Link to="/search" className="action-button search-management">
            <Search size={16} />
            Manage Search Sources
            <ExternalLink size={14} />
          </Link>
        
          <Link to="/cache" className="action-button cache-management">
            <HardDrive size={16} />
            Detailed Cache Management
            <ExternalLink size={14} />
          </Link>
          
          <button onClick={exportSettings} className="action-button export">
            <Download size={16} />
            Export Settings & Progress
          </button>
          
          <label className="action-button import">
            <Globe size={16} />
            Import Settings & Progress
            <input
              type="file"
              accept=".json"
              onChange={importSettings}
              style={{ display: 'none' }}
            />
          </label>
          
          <button onClick={clearWebTorrentCache} className="action-button warning">
            <Trash2 size={16} />
            Clear WebTorrent Cache
          </button>
          
          <button onClick={clearProgressData} className="action-button warning">
            <Trash2 size={16} />
            Clear Progress Data
          </button>
          
          <button onClick={clearAllData} className="action-button danger">
            <Trash2 size={16} />
            Clear All Data
          </button>
        </div>
      </div>

      {/* Security */}
      <div className="settings-section">
        <h2>🔐 Security</h2>
        <div className="security-section">
          <div className="security-info">
            <p>Your authentication is stored locally on this device for convenience. You can logout to require password entry on next access.</p>
          </div>
          <div className="action-buttons">
            <button onClick={handleLogout} className="action-button danger">
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="settings-section">
        <h2>ℹ️ About</h2>
        <div className="about-info">
          <div className="app-info">
            <h3>SeedBox Lite</h3>
            <p>Version 1.0.0</p>
            <p>A lightweight torrent streaming client with video progress tracking and subtitle support.</p>
          </div>
          
          <div className="features-list">
            <h4>Features:</h4>
            <ul>
              <li>Stream-only torrent downloads (no seeding)</li>
              <li>Video progress tracking and resume</li>
              <li>Online subtitle search and support</li>
              <li>Modern responsive interface</li>
              <li>Local data storage and privacy</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
