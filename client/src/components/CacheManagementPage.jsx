import React, { useState, useEffect } from 'react';
import { Trash2, HardDrive, Activity, File, Calendar, ArrowLeft, RefreshCw, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { config } from '../config/environment';
import '../assets/styles/CacheManagementPage.css';

const CacheManagementPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheStats, setCacheStats] = useState({
    totalSize: 0,
    totalSizeFormatted: '0 B',
    fileCount: 0,
    activeTorrents: 0,
    torrents: []
  });

  useEffect(() => {
    loadCacheStats();
  }, []);

  const loadCacheStats = async () => {
    try {
      setRefreshing(true);
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
      setLoading(false);
      setRefreshing(false);
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
    if (!window.confirm(`Remove "${name}" from cache? This will stop the torrent and clear its data.`)) {
      return;
    }

    try {
      const response = await fetch(config.getTorrentUrl(infoHash), {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Torrent "${name}" removed successfully. Freed: ${result.freedSpaceFormatted || '0 B'}`);
        loadCacheStats();
      } else {
        alert('Failed to remove torrent');
      }
    } catch (error) {
      console.error('Error removing torrent:', error);
      alert('Error removing torrent: ' + error.message);
    }
  };

  const clearAllCache = async () => {
    if (!window.confirm('Clear ALL cache data? This will remove all torrents and downloaded data. This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(config.api.torrents, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        alert(`All cache cleared! Freed: ${result.totalFreedFormatted || '0 B'}`);
        loadCacheStats();
      } else {
        alert('Failed to clear cache');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      alert('Error clearing cache: ' + error.message);
    }
  };

  const clearOldCache = async (days) => {
    if (!window.confirm(`Clear cache older than ${days} days? This will remove old torrent data.`)) {
      return;
    }

    try {
      const response = await fetch(config.getApiUrl('/api/cache/clear-old'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ days })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Old cache cleared! Removed ${result.deletedFiles || 0} files, freed: ${formatBytes(result.freedSpace || 0)}`);
        loadCacheStats();
      } else {
        alert('Failed to clear old cache');
      }
    } catch (error) {
      console.error('Error clearing old cache:', error);
      alert('Error clearing old cache: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="cache-page">
        <div className="page-header">
          <button onClick={() => navigate(-1)} className="back-button">
            <ArrowLeft size={20} />
            Back
          </button>
          <h1>
            <HardDrive size={28} />
            Cache Management
          </h1>
        </div>
        <div className="loading">Loading cache information...</div>
      </div>
    );
  }

  return (
    <div className="cache-page">
      <div className="page-header">
        <button onClick={() => navigate(-1)} className="back-button">
          <ArrowLeft size={20} />
          Back
        </button>
        <div className="header-content">
          <h1>
            <HardDrive size={28} />
            Cache Management
          </h1>
          <p>Manage your torrent cache and disk space</p>
        </div>
        <button 
          onClick={loadCacheStats} 
          className="refresh-button"
          disabled={refreshing}
        >
          <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
          Refresh
        </button>
      </div>

      {/* Cache Usage Overview */}
      <div className="cache-section">
        <h2>🌪️ WebTorrent Cache Usage</h2>
        <div className="disk-usage">
          <div className="disk-stats">
            <div className="disk-stat">
              <span>Cache Size</span>
              <span>{cacheStats.totalSizeFormatted}</span>
            </div>
            <div className="disk-stat">
              <span>Cache Limit</span>
              <span>{cacheStats.cacheLimitFormatted || '5 GB'}</span>
            </div>
            <div className="disk-stat">
              <span>Active Torrents</span>
              <span>{cacheStats.activeTorrents}</span>
            </div>
          </div>
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${cacheStats.usagePercentage || 0}%` }}
              ></div>
            </div>
            <span className="progress-text">{cacheStats.usagePercentage || 0}% cache used</span>
          </div>
          <div className="cache-info">
            <p>This shows only WebTorrent cache data, not system-wide disk usage.</p>
          </div>
        </div>
      </div>

      {/* Cache Overview */}
      <div className="cache-section">
        <h2>📊 Cache Overview</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <HardDrive size={24} />
            <div>
              <span className="stat-value">{cacheStats.totalSizeFormatted}</span>
              <span className="stat-label">Cache Size</span>
            </div>
          </div>
          <div className="stat-card">
            <File size={24} />
            <div>
              <span className="stat-value">{cacheStats.fileCount}</span>
              <span className="stat-label">Cached Files</span>
            </div>
          </div>
          <div className="stat-card">
            <Activity size={24} />
            <div>
              <span className="stat-value">{cacheStats.activeTorrents}</span>
              <span className="stat-label">Active Torrents</span>
            </div>
          </div>
          <div className="stat-card">
            <Download size={24} />
            <div>
              <span className="stat-value">{cacheStats.totalDownloadedFormatted || '0 B'}</span>
              <span className="stat-label">Downloaded</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      <div className="cache-section">
        <h2>🧹 Bulk Actions</h2>
        <div className="bulk-actions">
          <button 
            onClick={() => clearOldCache(7)} 
            className="action-button warning"
          >
            <Calendar size={16} />
            Clear 7+ Day Old Files
          </button>
          <button 
            onClick={() => clearOldCache(30)} 
            className="action-button warning"
          >
            <Calendar size={16} />
            Clear 30+ Day Old Files
          </button>
          <button 
            onClick={clearAllCache} 
            className="action-button danger"
          >
            <Trash2 size={16} />
            Clear All Cache
          </button>
        </div>
      </div>

      {/* Individual Torrents */}
      {cacheStats.torrents.length > 0 && (
        <div className="cache-section">
          <h2>🎬 Individual Torrents ({cacheStats.torrents.length})</h2>
          <div className="torrents-list">
            {cacheStats.torrents.map((torrent) => (
              <div key={torrent.infoHash} className="torrent-item">
                <div className="torrent-info">
                  <h3>{torrent.name}</h3>
                  <div className="torrent-stats">
                    <span>{formatBytes(torrent.size || 0)} total</span>
                    <span>{formatBytes(torrent.downloaded || 0)} downloaded</span>
                    <span>{(torrent.progress * 100).toFixed(1)}% ready</span>
                    <span>{torrent.files?.length || 0} files</span>
                    <span>{torrent.peers || 0} peers</span>
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${(torrent.progress || 0) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="torrent-actions">
                  <button 
                    onClick={() => navigate(`/torrent/${torrent.infoHash}`)}
                    className="view-button"
                  >
                    View
                  </button>
                  <button 
                    onClick={() => clearSingleTorrent(torrent.infoHash, torrent.name)}
                    className="remove-button"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cacheStats.torrents.length === 0 && (
        <div className="cache-section">
          <div className="empty-state">
            <HardDrive size={48} />
            <h3>No Active Torrents</h3>
            <p>Add some torrents to see cache management options</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CacheManagementPage;
