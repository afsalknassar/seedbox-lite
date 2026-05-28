import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, Search, File,DownloadCloud, ChevronDown, ChevronRight, CloudUpload, CheckCircle, Send, AlertCircle, Activity, Users, Trash2, Calendar, RefreshCw, XCircle, Database } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { config } from '../config/environment';

// We now only import the specific FilesPage CSS, dropping HomePage styles.
import '../assets/styles/FilesPage.css';

const FilesPage = () => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Cache & Torrent State (Polled)
  const [cacheStats, setCacheStats] = useState({
    totalSize: 0,
    totalSizeFormatted: '0 B',
    fileCount: 0,
    activeTorrents: 0,
    torrents: []
  });
  const [refreshingCache, setRefreshingCache] = useState(false);
  const activeDownloadsRef = useRef(false);

  // File Expansion & Upload State
  const [expandedTorrents, setExpandedTorrents] = useState({});
  const [torrentFiles, setTorrentFiles] = useState({});
  const [uploadStatus, setUploadStatus] = useState(() => {
    try {
      const saved = localStorage.getItem('driveUploads');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [googleToken, setGoogleToken] = useState(null);
  const activeEventSources = useRef(new Map());

  useEffect(() => {
    loadCacheStats();
    loadActiveUploads();
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadCacheStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      activeEventSources.current.forEach(source => source.close());
      activeEventSources.current.clear();
    };
  }, []);

  useEffect(() => {
    if (cacheStats?.torrents) {
      activeDownloadsRef.current = cacheStats.torrents.some(t => (t.progress || 0) < 1);
    }
  }, [cacheStats.torrents]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;

    const fetchProgress = async () => {
      if (!activeDownloadsRef.current) {
        if (isMounted) timeoutId = setTimeout(fetchProgress, 2000);
        return;
      }

      try {
        const [statsResponse, torrentsResponse] = await Promise.all([
          fetch(config.getApiUrl('/api/cache/stats')),
          fetch(config.api.torrents)
        ]);

        if (statsResponse.ok && torrentsResponse.ok && isMounted) {
          const stats = await statsResponse.json();
          const torrentsData = await torrentsResponse.json();

          setCacheStats(prev => ({
            ...prev,
            ...stats,
            torrents: torrentsData.torrents || [],
            activeTorrents: (torrentsData.torrents || []).length
          }));
        }
      } catch (err) {
        console.debug('FilesPage Cache Polling error:', err);
      } finally {
        if (isMounted) {
          timeoutId = setTimeout(fetchProgress, 2000);
        }
      }
    };

    fetchProgress();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  const loadCacheStats = async () => {
    try {
      setLoading(true);
      setRefreshingCache(true);
      const [statsResponse, torrentsResponse] = await Promise.all([
        fetch(config.getApiUrl('/api/cache/stats')),
        fetch(config.api.torrents)
      ]);

      if (statsResponse.ok && torrentsResponse.ok) {
        const stats = await statsResponse.json();
        const torrentsData = await torrentsResponse.json();

        setCacheStats({
          ...stats,
          torrents: torrentsData.torrents || [],
          activeTorrents: (torrentsData.torrents || []).length
        });
      }
    } catch (error) {
      console.error('Error loading cache stats:', error);
    } finally {
      setRefreshingCache(false);
      setLoading(false);
    }
  };

  const clearSingleTorrent = async (infoHash, name) => {
    if (!window.confirm(`Remove "${name}" from server? This stops the stream and deletes downloaded data.`)) return;
    try {
      const response = await fetch(config.getTorrentUrl(infoHash), { method: 'DELETE' });
      if (response.ok) {
        loadCacheStats();
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
        alert(`Old cache cleared! Removed ${result.deletedFiles || 0} files`);
        loadCacheStats();
      } else {
        alert('Failed to clear old cache');
      }
    } catch (error) {
      alert('Error clearing old cache: ' + error.message);
    }
  };

  const toggleTorrent = async (infoHash) => {
    setExpandedTorrents(prev => ({ ...prev, [infoHash]: !prev[infoHash] }));
    
    if (!torrentFiles[infoHash]) {
      try {
        const response = await fetch(config.getApiUrl(`/api/torrents/${infoHash}/files`));
        if (response.ok) {
          const data = await response.json();
          setTorrentFiles(prev => ({ ...prev, [infoHash]: data.files }));
        }
      } catch (error) {
        console.error('Error loading files:', error);
      }
    }
  };

  const loadActiveUploads = async () => {
    try {
      const [driveRes, tgRes] = await Promise.all([
        fetch(config.getApiUrl('/api/drive/active')).catch(() => ({ ok: false })),
        fetch(config.getApiUrl('/api/telegram/active')).catch(() => ({ ok: false }))
      ]);

      let activeData = {};
      
      if (driveRes.ok) {
        const driveData = await driveRes.json();
        activeData = { ...activeData, ...driveData };
      }
      
      if (tgRes.ok) {
        const tgData = await tgRes.json();
        activeData = { ...activeData, ...tgData };
      }
        
      setUploadStatus(prev => {
        const newState = { ...prev };
        for (const [uploadId, state] of Object.entries(activeData)) {
          newState[uploadId] = {
            status: state.status,
            progress: state.progress,
            link: state.link,
            error: state.error,
            currentPart: state.currentPart,
            totalParts: state.totalParts
          };
        }
        return newState;
      });

      for (const [uploadId, state] of Object.entries(activeData)) {
        if (['uploading', 'starting', 'initializing', 'splitting'].includes(state.status)) {
           attachSSE(uploadId);
        }
      }
    } catch (err) {
      console.error('Failed to load active uploads', err);
    }
  };

  const loginAndUpload = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      setGoogleToken(tokenResponse.access_token);
      const { infoHash, fileIdx } = window.__pendingUpload || {};
      if (infoHash && fileIdx !== undefined) {
        startUpload(tokenResponse.access_token, infoHash, fileIdx);
        delete window.__pendingUpload;
      }
    },
    onError: (error) => {
      console.error('Google Login Failed:', error);
      delete window.__pendingUpload;
      alert('Google authentication failed or was cancelled. Please try again.');
    },
    scope: 'https://www.googleapis.com/auth/drive.file'
  });

  const handleUploadClick = (infoHash, fileIdx) => {
    if (googleToken) {
      startUpload(googleToken, infoHash, fileIdx);
    } else {
      window.__pendingUpload = { infoHash, fileIdx };
      loginAndUpload();
    }
  };

  const attachSSE = (uploadId) => {
    if (activeEventSources.current.has(uploadId)) return;

    const endpoint = uploadId.startsWith('tg-') 
      ? `/api/telegram/progress/${uploadId}` 
      : `/api/drive/progress/${uploadId}`;

    const eventSource = new EventSource(config.getApiUrl(endpoint));
    activeEventSources.current.set(uploadId, eventSource);
    
    eventSource.onmessage = (event) => {
      const state = JSON.parse(event.data);
      
      if (state.status === 'not_found' || state.status === 'failed') {
        eventSource.close();
        activeEventSources.current.delete(uploadId);
      }
      
      setUploadStatus(prev => {
        const newState = {
          ...prev,
          [uploadId]: { 
            status: state.status, 
            progress: state.progress,
            link: state.result?.webViewLink || state.link,
            error: state.error,
            currentPart: state.currentPart,
            totalParts: state.totalParts
          }
        };
        
        if (state.status === 'completed') {
          try { localStorage.setItem('driveUploads', JSON.stringify(newState)); } catch (e) {}
        }
        return newState;
      });

      if (state.status === 'completed' || state.status === 'failed') {
        if (state.status === 'failed' && state.error?.toLowerCase().includes('credential')) {
           setGoogleToken(null);
        }
        eventSource.close();
        activeEventSources.current.delete(uploadId);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      activeEventSources.current.delete(uploadId);
      setUploadStatus(prev => ({
        ...prev,
        [uploadId]: { ...prev[uploadId], status: 'failed', error: 'Connection lost to server' }
      }));
    };
  };

  const startUpload = async (accessToken, infoHash, fileIdx) => {
    const uploadId = `${infoHash}-${fileIdx}`;
    setUploadStatus(prev => ({ ...prev, [uploadId]: { status: 'initializing', progress: 0 } }));

    try {
      const response = await fetch(config.getApiUrl('/api/drive/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, infoHash, fileIdx })
      });
      if (!response.ok) throw new Error('Upload initialization failed');
      const data = await response.json();
      attachSSE(data.uploadId);
    } catch (error) {
      setGoogleToken(null); 
      setUploadStatus(prev => ({ ...prev, [uploadId]: { status: 'failed', error: error.message } }));
    }
  };

  const startTelegramUpload = async (infoHash, fileIdx) => {
    const uploadId = `tg-${infoHash}-${fileIdx}`;
    setUploadStatus(prev => ({ ...prev, [uploadId]: { status: 'initializing', progress: 0 } }));

    try {
      const response = await fetch(config.getApiUrl('/api/telegram/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoHash, fileIdx })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload initialization failed');
      attachSSE(data.uploadId);
    } catch (error) {
      setUploadStatus(prev => ({ ...prev, [uploadId]: { status: 'failed', error: error.message } }));
    }
  };

  const cancelUpload = async (uploadId, isTg = false) => {
    const endpoint = isTg ? '/api/telegram/cancel' : '/api/drive/cancel';
    try {
      setUploadStatus(prev => {
        const newState = { ...prev };
        delete newState[uploadId];
        try { localStorage.setItem('driveUploads', JSON.stringify(newState)); } catch (e) {}
        return newState;
      });
      
      const source = activeEventSources.current.get(uploadId);
      if (source) {
        source.close();
        activeEventSources.current.delete(uploadId);
      }

      await fetch(config.getApiUrl(`${endpoint}/${uploadId}`), { method: 'POST' });
    } catch (error) {
      console.error('Error cancelling upload:', error);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredTorrents = cacheStats.torrents.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getFileExtension = (filename) => {
    const ext = filename.split('.').pop();
    return ext === filename ? '' : ext.toUpperCase();
  };

  return (
    <div className="saas-container">
      
      <header className="saas-header">
        <div className="saas-header-title">
          <div className="saas-title-icon">
            <File size={24} />
          </div>
          <h1>Files</h1>
        </div>
        
        <div className="saas-header-actions">
          <div className="saas-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search datasets..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="saas-header-divider"></div>
          <button onClick={() => clearOldCache(7)} className="saas-btn-secondary">
            <Calendar size={16} /> Clean Old
          </button>
          <button onClick={clearAllCache} className="saas-btn-danger">
            <Trash2 size={16} /> Wipe Cache
          </button>
        </div>
      </header>

      <div className="saas-stats-bar">
        <div className="saas-stat">
          <div className="stat-icon-sm blue"><HardDrive size={16} /></div>
          <span className="stat-label">Total Allocated:</span>
          <span className="stat-value">{formatBytes(cacheStats.totalSize)}</span>
        </div>
        <div className="stat-divider"></div>
        <div className="saas-stat">
          <div className="stat-icon-sm purple"><DownloadCloud size={16} /></div>
          <span className="stat-label">Active Downloads:</span>
          <span className="stat-value">{cacheStats.activeTorrents || 0}</span>
        </div>
      </div>

      <div className="saas-table-container">
        {loading ? (
          <div className="saas-empty">
            <div className="saas-spinner"></div>
            <p>Syncing server state...</p>
          </div>
        ) : cacheStats.torrents.length === 0 ? (
          <div className="saas-empty">
            <Database size={32} />
            <p>No active data sets found on the server.</p>
          </div>
        ) : filteredTorrents.length === 0 ? (
          <div className="saas-empty">
            <Search size={32} />
            <p>No matches found for your query.</p>
          </div>
        ) : (
          <div className="saas-table">
            <div className="saas-table-header">
              <div className="col-name">Movie Name</div>
              <div className="col-size">Size</div>
              <div className="col-metrics">Metrics</div>
              <div className="col-status">Status</div>
              <div className="col-actions">Actions</div>
            </div>

            {filteredTorrents.map((t) => {
              const percent = t.progress ? (t.progress * 100).toFixed(1) : 0;
              const isTorrentComplete = t.progress >= 1;

              return (
                <div key={t.infoHash} className={`saas-row-group ${expandedTorrents[t.infoHash] ? 'expanded' : ''}`}>
                  <div className="saas-row" onClick={() => toggleTorrent(t.infoHash)}>
                    
                    <div className="col-name">
                      <button className="saas-expand-btn">
                        {expandedTorrents[t.infoHash] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div className="saas-poster-sm">
                        {t.poster && t.poster !== 'N/A' ? (
                          <img src={t.poster} alt={t.name} referrerPolicy="no-referrer" />
                        ) : (
                          <File size={16} />
                        )}
                      </div>
                      <span className="dataset-name" title={t.name}>{t.name}</span>
                    </div>

                    <div className="col-size">{formatBytes(t.size || 0)}</div>
                    
                    <div className="col-metrics">
                      <div className="metric-pill">
                        <Activity size={12}/> {formatBytes(t.downloadSpeed || 0)}/s
                      </div>
                      <div className="metric-pill">
                        <Users size={12}/> {t.peers || 0} peers
                      </div>
                    </div>

                    <div className="col-status">
                      <div className="saas-progress-track">
                        <div className={`saas-progress-fill ${isTorrentComplete ? 'complete' : ''}`} style={{ width: `${percent}%` }}></div>
                      </div>
                      <span className="saas-progress-text">{percent}%</span>
                    </div>

                    <div className="col-actions">
                      <button
                        className="saas-icon-btn danger"
                        onClick={(e) => { e.stopPropagation(); clearSingleTorrent(t.infoHash, t.name); }}
                        title="Delete from server"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Inner Files List */}
                  {expandedTorrents[t.infoHash] && (
                    <div className="saas-sub-table">
                      {!torrentFiles[t.infoHash] ? (
                        <div className="saas-sub-empty">Loading files...</div>
                      ) : torrentFiles[t.infoHash].length === 0 ? (
                        <div className="saas-sub-empty">No files found.</div>
                      ) : (
                        torrentFiles[t.infoHash].map((file) => {
                          const driveStatus = uploadStatus[`${t.infoHash}-${file.index}`];
                          const tgStatus = uploadStatus[`tg-${t.infoHash}-${file.index}`];
                          const tgNeedsDelay = !isTorrentComplete && file.size > 2 * 1024 * 1024 * 1024;
                          const fileExt = getFileExtension(file.name);

                          return (
                            <div key={file.index} className="saas-sub-row">
                              <div className="sub-row-content">
                                <div className="sub-col-name">
                                  <div className="file-icon-wrapper">
                                    <File size={16} className="text-muted" />
                                    {fileExt && <span className="file-type-badge">{fileExt}</span>}
                                  </div>
                                  <div className="file-name-meta">
                                    <span className="file-name" title={file.name}>{file.name}</span>
                                    <span className="file-size-meta">{formatBytes(file.size)}</span>
                                  </div>
                                </div>
                                
                                <div className="sub-col-actions">
                                  {/* Drive Actions */}
                                  {driveStatus?.status === 'uploading' || driveStatus?.status === 'initializing' ? (
                                    null /* handled in progress bar row */
                                  ) : driveStatus?.status === 'completed' ? (
                                    <div className="saas-success-group">
                                      <a href={driveStatus.link} target="_blank" rel="noopener noreferrer" className="saas-upload-success">
                                        <CheckCircle size={14} /> Drive
                                      </a>
                                      <div className="saas-success-divider"></div>
                                      <button onClick={() => handleUploadClick(t.infoHash, file.index)} className="saas-reupload-btn" title="Reupload">
                                        <RefreshCw size={14} />
                                      </button>
                                    </div>
                                  ) : driveStatus?.status === 'failed' ? (
                                    <div className="saas-upload-error">
                                      <AlertCircle size={14}/> Failed
                                      <button onClick={() => handleUploadClick(t.infoHash, file.index)} className="retry-txt">Retry</button>
                                      <button onClick={() => cancelUpload(`${t.infoHash}-${file.index}`, false)}><XCircle size={14}/></button>
                                    </div>
                                  ) : (
                                    <button className="saas-upload-btn drive" onClick={() => handleUploadClick(t.infoHash, file.index)}>
                                      <CloudUpload size={14} /> Drive
                                    </button>
                                  )}

                                  {/* Telegram Actions */}
                                  {tgStatus?.status === 'uploading' || tgStatus?.status === 'splitting' || tgStatus?.status === 'initializing' ? (
                                    null /* handled in progress bar row */
                                  ) : tgStatus?.status === 'completed' ? (
                                    <div className="saas-success-group">
                                      <a href="https://web.telegram.org/" target="_blank" rel="noopener noreferrer" className="saas-upload-success tg">
                                        <CheckCircle size={14} /> Sent
                                      </a>
                                      <div className="saas-success-divider"></div>
                                      <button 
                                        onClick={() => {
                                          if (tgNeedsDelay) {
                                            alert('Files larger than 2GB can only be sent to Telegram after the torrent is 100% downloaded.');
                                            return;
                                          }
                                          startTelegramUpload(t.infoHash, file.index);
                                        }} 
                                        className="saas-reupload-btn" 
                                        title="Reupload" 
                                      >
                                        <RefreshCw size={14} />
                                      </button>
                                    </div>
                                  ) : tgStatus?.status === 'failed' ? (
                                    <div className="saas-upload-error">
                                      <AlertCircle size={14}/> Failed
                                      <button onClick={() => startTelegramUpload(t.infoHash, file.index)} className="retry-txt">Retry</button>
                                      <button onClick={() => cancelUpload(`tg-${t.infoHash}-${file.index}`, true)}><XCircle size={14}/></button>
                                    </div>
                                  ) : (
                                    <button 
                                      className={`saas-upload-btn tg ${tgNeedsDelay ? 'disabled' : ''}`} 
                                      onClick={() => {
                                        if (tgNeedsDelay) {
                                          alert('Files larger than 2GB can only be sent to Telegram after the torrent is 100% downloaded.');
                                          return;
                                        }
                                        startTelegramUpload(t.infoHash, file.index);
                                      }}
                                    >
                                      <Send size={14} /> TG
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Separate Progress Bars Container */}
                              {(driveStatus?.status === 'uploading' || driveStatus?.status === 'initializing' || 
                                tgStatus?.status === 'uploading' || tgStatus?.status === 'splitting' || tgStatus?.status === 'initializing') && (
                                <div className="sub-row-progress-container">
                                  
                                  {/* Drive Progress Bar */}
                                  {(driveStatus?.status === 'uploading' || driveStatus?.status === 'initializing') && (
                                    <div className="detailed-progress drive">
                                      <div className="prog-header">
                                        <span>Drive Upload</span>
                                        <div className="prog-stats">
                                          <span>{driveStatus.progress || 0}%</span>
                                          <button onClick={() => cancelUpload(`${t.infoHash}-${file.index}`, false)}><XCircle size={14}/></button>
                                        </div>
                                      </div>
                                      <div className="saas-progress-track">
                                        <div className="saas-progress-fill drive" style={{ width: `${driveStatus.progress || 0}%` }}></div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Telegram Progress Bar */}
                                  {(tgStatus?.status === 'uploading' || tgStatus?.status === 'splitting' || tgStatus?.status === 'initializing') && (
                                    <div className="detailed-progress tg">
                                      <div className="prog-header">
                                        <span>
                                          Telegram {tgStatus.status === 'splitting' || tgStatus.status === 'initializing' 
                                            ? '(Preparing)' 
                                            : `(Part ${tgStatus.currentPart}/${tgStatus.totalParts})`}
                                        </span>
                                        <div className="prog-stats">
                                          <span>{tgStatus.progress || 0}%</span>
                                          <button onClick={() => cancelUpload(`tg-${t.infoHash}-${file.index}`, true)}><XCircle size={14}/></button>
                                        </div>
                                      </div>
                                      <div className="saas-progress-track">
                                        <div className="saas-progress-fill tg" style={{ width: `${tgStatus.progress || 0}%` }}></div>
                                      </div>
                                    </div>
                                  )}

                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FilesPage;