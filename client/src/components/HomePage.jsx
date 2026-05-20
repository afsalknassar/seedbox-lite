import React, { useState, useEffect } from 'react';
import { Upload, Link as LinkIcon, Download, Leaf, Clock, Search, Trash2, HardDrive, Play } from 'lucide-react';
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
  
  // NEW: State for dynamic loading messages
  const [loadingText, setLoadingText] = useState('Syncing...');

  useEffect(() => {
    loadRecentTorrents();
  }, []);

  // NEW: Dynamic loading message cycler
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
        // Stop cycling if we reach the end, just hold on the last message
        if (step < messages.length) {
          setLoadingText(messages[step]);
        }
      }, 3500); // Change text every 3.5 seconds
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(torrentData)
      });

      const data = await response.json();

      if (response.ok) {
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

  const filteredTorrents = searchQuery
    ? torrentHistoryService.searchTorrents(searchQuery)
    : recentTorrents;

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
        {/* TOP: Magnet/URL Input Form */}
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
            <button
              type="submit"
              className={`btn-primary ${loading ? 'syncing' : ''}`}
              disabled={loading || !torrentUrl.trim()}
            >
              {loading ? (
                <>
                  <div className="spinner-ring" />
                  {/* CHANGED: Now uses the dynamic loadingText state */}
                  <span>{loadingText}</span>
                </>
              ) : (
                <>
                  Stream 
                 <Play size={20} />
                </>
              )}
            </button>
          </div>
          
          {/* NEW: Helper text that appears only during a long load */}
          {loading && (
            <div className="loading-helper-text" style={{ fontSize: '0.8rem', color: '#888', marginTop: '8px', textAlign: 'center' }}>
              Magnet links can take up to 20 seconds to resolve.
            </div>
          )}
        </form>

        {/* MIDDLE: "OR" Divider */}
        <div className="or-divider">
          <span>OR</span>
        </div>

        {/* BOTTOM: Dashed File Drop Zone */}
        <div className="file-upload-area">
          <input
            type="file"
            accept=".torrent"
            onChange={handleFileSelect}
            id="torrent-upload"
            disabled={loading}
            className="hidden-file-input"
          />
          <label
            htmlFor="torrent-upload"
            className={`drop-zone ${loading ? 'disabled' : ''}`}
          >
            <div className="drop-zone-text">
              <span className="highlight">Drop torrent file here</span> or click to browse
            </div>
            <div className="badge-limit">No size limit</div>
          </label>
        </div>

        {/* Footer Links */}
        <div className="panel-footer">
          <Link to="/search" className="footer-link">
            <Search size={16} /> Browse Custom Search Sources
          </Link>
        </div>
      </div>

      {/* Features Summary */}
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon-box"><Upload size={20} /></div>
          <span>Instant Streaming</span>
        </div>
        <div className="feature-card">
          <div className="feature-icon-box"><HardDrive size={20} /></div>
          <span>Progress Tracking</span>
        </div>
        <div className="feature-card">
          <div className="feature-icon-box"><Clock size={20} /></div>
          <span>Perfect Sync</span>
        </div>
      </div>

      {/* History Section (Unchanged) */}
      {recentTorrents.length > 0 && (
        <div className="history-section">
          {/* ... Keep your existing history section code here ... */}
          <div className="history-header">
            <div className="history-title">
              <Clock size={22} />
              <h2>Recent Torrents</h2>
            </div>
            <div className="history-actions">
              <button onClick={() => setShowHistory(!showHistory)} className="btn-secondary">
                {showHistory ? 'Show Less' : `View All (${recentTorrents.length})`}
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
            {(showHistory ? filteredTorrents : recentTorrents.slice(0, 4)).map((torrent) => (
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
    </div>
  );
};

export default HomePage;