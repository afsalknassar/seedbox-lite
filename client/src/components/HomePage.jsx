import React, { useState, useEffect } from 'react';
import { Upload, Link as LinkIcon, Download, Leaf, Clock, Search, Trash2, HardDrive, Play, Activity, File, Calendar, RefreshCw } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { config } from '../config/environment';
import torrentHistoryService from '../services/torrentHistoryService';
import './HomePage.css';

const HomePage = () => {
  const navigate = useNavigate();
  const [torrentUrl, setTorrentUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentTorrents, setRecentTorrents] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [loadingText, setLoadingText] = useState('Syncing...');

  // Cache management state
  const [cacheStats, setCacheStats] = useState({
    totalSize: 0,
    totalSizeFormatted: '0 B',
    fileCount: 0,
    activeTorrents: 0,
    torrents: []
  });
  const [refreshingCache, setRefreshingCache] = useState(false);

  useEffect(() => {
    loadRecentTorrents();
    loadCacheStats();
  }, []);

  useEffect(() => {
    let interval;
    if (loading) {
      const messages = [
        "Connecting to swarm...",
        "Finding peers...",
        "Downloading metadata...",
        "Resolving files...",
        "Almost ready..."
      ];
      let step = 0;
      setLoadingText(messages[0]);

      interval = setInterval(() => {
        step++;
        if (step < messages.length) {
          setLoadingText(messages[step]);
        }
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const loadRecentTorrents = () => {
    const recent = torrentHistoryService.getRecentTorrents(8);
    setRecentTorrents(recent);
  };

  const addTorrent = async (torrentData) => {
    setLoading(true);
    try {
      const response = await fetch(config.api.torrents, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(torrentData)
      });

      const data = await response.json();

      if (response.ok) {
        if (data.isBackground) {
          torrentHistoryService.addTorrent({
            infoHash: data.infoHash,
            name: data.name,
            source: torrentData.torrentId.startsWith('magnet:') ? 'magnet' : 'url',
            originalInput: torrentData.torrentId,
            size: 0
          });
          loadRecentTorrents();
          alert("This magnet link is a bit slow. We added it to your Background Queue to keep searching!");
          setTorrentUrl('');
          return;
        }

        const existingInHistory = torrentHistoryService.getTorrentByInfoHash(data.infoHash);
        if (existingInHistory) {
          torrentHistoryService.updateLastAccessed(data.infoHash);
        } else {
          torrentHistoryService.addTorrent({
            infoHash: data.infoHash,
            name: data.name || 'Unknown Torrent',
            source: torrentData.torrentId.startsWith('magnet:') ? 'magnet' : 'url',
            originalInput: torrentData.torrentId,
            size: data.size || 0
          });
        }

        loadRecentTorrents();
        navigate(`/torrent/${data.infoHash}`);
      } else {
        alert('Failed to add torrent: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error adding torrent: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const addTorrentFile = async (file) => {
    const formData = new FormData();
    formData.append('torrentFile', file);

    setLoading(true);
    try {
      const response = await fetch(config.getApiUrl('/api/torrents/upload'), {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        const existingInHistory = torrentHistoryService.getTorrentByInfoHash(data.infoHash);
        if (existingInHistory) {
          torrentHistoryService.updateLastAccessed(data.infoHash);
        } else {
          torrentHistoryService.addTorrent({
            infoHash: data.infoHash,
            name: data.name || file.name.replace('.torrent', ''),
            source: 'file',
            originalInput: file.name,
            size: data.size || 0
          });
        }
        loadRecentTorrents();
        navigate(`/torrent/${data.infoHash}`);
      } else {
        alert('Failed to upload torrent: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error uploading torrent: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (torrentUrl.trim()) {
      addTorrent({ torrentId: torrentUrl.trim() });
      setTorrentUrl('');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.torrent')) {
      addTorrentFile(file);
    }
  };

  const goToTorrent = (infoHash) => {
    torrentHistoryService.updateLastAccessed(infoHash);
    navigate(`/torrent/${infoHash}`);
  };

  const removeTorrentFromHistory = (infoHash, e) => {
    e.stopPropagation();
    if (window.confirm('Remove this torrent from history?')) {
      torrentHistoryService.removeTorrent(infoHash);
      loadRecentTorrents();
    }
  };

  const clearAllHistory = () => {
    if (window.confirm('Clear all torrent history?')) {
      torrentHistoryService.clearHistory();
      loadRecentTorrents();
    }
  };

  // ==========================================
  // CACHE MANAGEMENT ACTIONS
  // ==========================================
  const loadCacheStats = async () => {
    try {
      setRefreshingCache(true);
      const [statsResponse, torrentsResponse] = await Promise.all([
        fetch(config.getApiUrl('/api/cache/stats')),
        fetch(config.api.torrents)
      ]);

      const stats = await statsResponse.json();
      const torrentsData = await torrentsResponse.json();

      setCacheStats({
        ...stats,
        torrents: torrentsData.torrents || [],
        activeTorrents: (torrentsData.torrents || []).length
      });
    } catch (error) {
      console.error('Error loading cache stats:', error);
    } finally {
      setRefreshingCache(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const clearSingleTorrent = async (infoHash, name) => {
    if (!window.confirm(`Remove "${name}" from server? This stops the stream and deletes downloaded data.`)) return;
    try {
      const response = await fetch(config.getTorrentUrl(infoHash), { method: 'DELETE' });
      if (response.ok) {
        const result = await response.json();
        loadCacheStats();
        loadRecentTorrents();
      } else {
        alert('Failed to remove torrent');
      }
    } catch (error) {
      alert('Error removing torrent: ' + error.message);
    }
  };

  const clearAllCache = async () => {
    if (!window.confirm('Clear ALL server files? This will remove all downloaded data. This cannot be undone.')) return;
    try {
      const response = await fetch(config.api.torrents, { method: 'DELETE' });
      if (response.ok) {
        const result = await response.json();
        alert(`All cache cleared! Freed: ${result.totalFreedFormatted || '0 B'}`);
        loadCacheStats();
        loadRecentTorrents();
      } else {
        alert('Failed to clear cache');
      }
    } catch (error) {
      alert('Error clearing cache: ' + error.message);
    }
  };

  const clearOldCache = async (days) => {
    if (!window.confirm(`Clear server files older than ${days} days?`)) return;
    try {
      const response = await fetch(config.getApiUrl('/api/cache/clear-old'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      if (response.ok) {
        const result = await response.json();
        alert(`Old cache cleared! Removed ${result.deletedFiles || 0} files, freed: ${formatBytes(result.freedSpace || 0)}`);
        loadCacheStats();
        loadRecentTorrents();
      } else {
        alert('Failed to clear old cache');
      }
    } catch (error) {
      alert('Error clearing old cache: ' + error.message);
    }
  };

  const filteredTorrents = searchQuery
    ? torrentHistoryService.searchTorrents(searchQuery)
    : recentTorrents.filter(torrent =>
      cacheStats.torrents.some(cachedTorrent => cachedTorrent.infoHash === torrent.infoHash)
    );

  return (
    <div className="home-container">
      {/* Hero Section */}
      <div className="hero-section">
        <div className="hero-badge">Next-Gen Streaming</div>
        <h1 className="hero-title">SeedBox <span>Lite</span></h1>
        <p className="hero-subtitle">Stream torrents instantly with perfect state synchronization. No seeding required.</p>
      </div>

      {/* Main Input Action Area */}
      <div className="action-glass-panel">
        <form onSubmit={handleUrlSubmit} className="magnet-form">
          <div className="magnet-input-wrapper">
            <Search size={20} className="input-icon" />
            <input
              type="text"
              value={torrentUrl}
              onChange={(e) => setTorrentUrl(e.target.value)}
              placeholder="Magnet link or infohash..."
              className="magnet-input"
              disabled={loading}
            />
            <button type="submit" className={`btn-primary ${loading ? 'syncing' : ''}`} disabled={loading || !torrentUrl.trim()}>
              {loading ? (
                <><div className="spinner-ring" /><span>{loadingText}</span></>
              ) : (
                <>Stream <Play size={20} /></>
              )}
            </button>
          </div>
          {loading && (
            <div className="loading-helper-text" style={{ fontSize: '0.8rem', color: '#888', marginTop: '8px', textAlign: 'center' }}>
              Magnet links can take up to 20 seconds to resolve.
            </div>
          )}
        </form>

        <div className="or-divider"><span>OR</span></div>

        <div className="file-upload-area">
          <input type="file" accept=".torrent" onChange={handleFileSelect} id="torrent-upload" disabled={loading} className="hidden-file-input" />
          <label htmlFor="torrent-upload" className={`drop-zone ${loading ? 'disabled' : ''}`}>
            <div className="drop-zone-text"><span className="highlight">Drop torrent file here</span> or click to browse</div>
            <div className="badge-limit">No size limit</div>
          </label>
        </div>

        <div className="panel-footer">
          <Link to="/search" className="footer-link">
            <Search size={16} /> Browse Custom Search Sources
          </Link>
        </div>
      </div>

      <div className="features-grid">
        <div className="feature-card"><div className="feature-icon-box"><Upload size={20} /></div><span>Instant Streaming</span></div>
        <div className="feature-card"><div className="feature-icon-box"><HardDrive size={20} /></div><span>Progress Tracking</span></div>
        <div className="feature-card"><div className="feature-icon-box"><Clock size={20} /></div><span>Perfect Sync</span></div>
      </div>




      {/* History Section */}
      {filteredTorrents.length > 0 && (
        <div className="history-section mt-4">
          <div className="history-header">
            <div className="history-title">
              <Clock size={22} />
              <h2>Recent Torrents</h2>
            </div>
            <div className="history-actions">
              <button onClick={() => setShowHistory(!showHistory)} className="btn-secondary">
                {showHistory ? 'Show Less' : `View All (${filteredTorrents.length})`}
              </button>
              {showHistory && (
                <button onClick={clearAllHistory} className="btn-danger">
                  <Trash2 size={16} />
                  <span className="desktop-only">Clear</span>
                </button>
              )}
            </div>
          </div>

          {showHistory && (
            <div className="history-search">
              <Search size={18} className="search-icon" />
              <input
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          <div className="history-grid">
            {(showHistory ? filteredTorrents : filteredTorrents.slice(0, 4)).map((torrent) => (
              <div
                key={torrent.infoHash}
                className="history-card"
                onClick={() => goToTorrent(torrent.infoHash)}
              >
                <div className="card-content">
                  <h3 title={torrent.name}>{torrent.name}</h3>
                  <p className="source-text" title={torrent.originalInput}>
                    {torrent.originalInput}
                  </p>
                  <div className="card-footer">
                    <span className={`tag ${torrent.source}`}>{torrent.source}</span>
                    <span className="date">{new Date(torrent.addedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button
                  className="btn-remove"
                  onClick={(e) => removeTorrentFromHistory(torrent.infoHash, e)}
                  title="Remove from history"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* SERVER FILES & CACHE UI */}

      <div className="history-section server-cache-section">
        {/* Modern Glass Header */}
        <div className="section-header-glass">
          <div className="header-title-group">
            <div className="icon-glow-wrapper">
              <HardDrive size={22} />
            </div>
            <h2>Server Cache</h2>
          </div>

          <div className="header-actions-group">
            <button onClick={loadCacheStats} className="btn-glass icon-only" title="Refresh Server Data" disabled={refreshingCache}>
              <RefreshCw size={18} className={refreshingCache ? 'spin-animation' : ''} />
            </button>
            <button onClick={() => clearOldCache(7)} className="btn-glass" title="Clear files older than 7 days">
              <Calendar size={16} />
              <span className="action-text">Clear Old</span>
            </button>
            <button onClick={clearAllCache} className="btn-glass danger" title="Wipe all server files">
              <Trash2 size={16} />
              <span className="action-text">Wipe Server</span>
            </button>
          </div>
        </div>

        {/* Modern Stats Grid */}
        <div className="modern-stats-grid">
          <div className="glass-stat-card">
            <div className="stat-icon-wrapper blue">
              <Activity size={20} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Cache Size</span>
              <span className="stat-value">{cacheStats.totalSizeFormatted}</span>
            </div>
          </div>
          <div className="glass-stat-card">
            <div className="stat-icon-wrapper purple">
              <Download size={20} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Downloaded</span>
              <span className="stat-value">{cacheStats.downloadedBytes}</span>
            </div>
          </div>
          <div className="glass-stat-card">
            <div className="stat-icon-wrapper green">
              <Play size={20} />
            </div>
            <div className="stat-content">
              <span className="stat-label">Active Items</span>
              <span className="stat-value">{cacheStats.activeTorrents}</span>
            </div>
          </div>
        </div>

        {/* Active Files Grid */}
        {cacheStats.torrents.length > 0 ? (
          <div className="modern-cache-grid">
            {cacheStats.torrents.map((t) => {
              const percent = t.progress ? (t.progress * 100).toFixed(1) : 0;
              return (
                <div key={t.infoHash} className="modern-cache-card" onClick={() => goToTorrent(t.infoHash)}>
                  <div className="card-top-row">
                    <div className="card-main-info">
                      <h4 title={t.name}>{t.name}</h4>
                      <div className="card-meta">
                        <span className="file-size">{formatBytes(t.length || 0)}</span>
                        <span className="dot-separator">•</span>
                        <span className="progress-text">{percent}% Cached</span>
                      </div>
                    </div>
                    <button
                      className="btn-remove"
                      onClick={(e) => { e.stopPropagation(); clearSingleTorrent(t.infoHash, t.name); }}
                      title="Delete from server"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-glass-state">
            <div className="empty-icon-wrapper">
              <HardDrive size={32} />
            </div>
            <p>No active files currently hosted on the server.</p>
          </div>
        )}
      </div>





    </div>
  );
};

export default HomePage;