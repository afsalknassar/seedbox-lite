import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, Search, Folder, File, ChevronDown, ChevronUp, CloudUpload, Link as LinkIcon, CheckCircle, Send, AlertCircle } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { config } from '../config/environment';
import '../assets/styles/HomePage.css';
import '../assets/styles/FilesPage.css';

const FilesPage = () => {
  const [torrents, setTorrents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
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
    return () => {
      activeEventSources.current.forEach(source => source.close());
      activeEventSources.current.clear();
    };
  }, []);

  useEffect(() => {
    loadTorrents();
    loadActiveUploads();
  }, []);

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

  const loadTorrents = async () => {
    try {
      setLoading(true);
      const response = await fetch(config.api.torrents);
      if (response.ok) {
        const data = await response.json();
        setTorrents(data.torrents || []);
      }
    } catch (error) {
      console.error('Error loading torrents:', error);
    } finally {
      setLoading(false);
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
      
      if (state.status === 'not_found') {
        eventSource.close();
        activeEventSources.current.delete(uploadId);
        return;
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

  const formatBytes = (bytes) => {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredTorrents = torrents.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="home-container files-container" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="history-section server-cache-section" style={{ marginTop: 0 }}>
        <div className="section-header-glass">
          <div className="header-title-group">
            <div className="history-title">
              <HardDrive size={22} />
            </div>
            <h2>Server Files</h2>
          </div>
        </div>

        <div className="history-search">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search torrents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-helper-text">Loading files...</div>
        ) : filteredTorrents.length > 0 ? (
          <div className="modern-cache-grid" style={{ gridTemplateColumns: '1fr' }}>
            {filteredTorrents.map((t) => {
              const percent = t.progress ? (t.progress * 100).toFixed(1) : 0;
              const isTorrentComplete = t.progress >= 1;

              return (
                <div 
                  key={t.infoHash} 
                  className="modern-cache-card" 
                  // CRITICAL FIX: position relative added for absolute progress bar
                  style={{ position: 'relative', height: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: expandedTorrents[t.infoHash] ? '0' : '16px' }}
                >
                  <div 
                    className="card-top-row" 
                    onClick={() => toggleTorrent(t.infoHash)}
                    style={{ cursor: 'pointer', marginBottom: expandedTorrents[t.infoHash] ? '16px' : '0' }}
                  >
                    <div className="card-poster">
                      {t.poster && t.poster !== 'N/A' ? (
                        <img src={t.poster} alt={t.name} referrerPolicy="no-referrer" />
                      ) : (
                        <div className="poster-placeholder">
                          <span>No Img</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="card-main-info">
                      <h4 title={t.name}>{t.name}</h4>
                      <div className="card-meta1 ">
                        <span className="progress-text">{formatBytes(t.downloadSpeed || 0)}/s</span>
                        <span className="dot-separator">•</span>
                        <span className="progress-text">{t.peers || 0} peers</span>
                      </div>
                      <div className="card-meta">
                        <span className="total-text">{formatBytes(t.size)}</span>
                      </div>
                    </div>
                    
                    <button className="btn-remove" style={{ padding: '8px' }}>
                      {expandedTorrents[t.infoHash] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                  </div>
                  
                  {expandedTorrents[t.infoHash] && (
                    <div className="torrent-files-list" style={{ margin: '0 -16px', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', paddingBottom: '24px' }}>
                      {!torrentFiles[t.infoHash] ? (
                        <div className="loading-sm">Loading files...</div>
                      ) : torrentFiles[t.infoHash].length === 0 ? (
                        <div className="empty-sm">No files found</div>
                      ) : (
                        torrentFiles[t.infoHash].map((file) => {
                          const driveStatus = uploadStatus[`${t.infoHash}-${file.index}`];
                          const tgStatus = uploadStatus[`tg-${t.infoHash}-${file.index}`];
                          
                          const tgNeedsDelay = !isTorrentComplete && file.size > 2 * 1024 * 1024 * 1024;

                          // Helper to render the correct UI state without overlapping
                          const renderFileActions = () => {
                            // Helper for Drive
                            const renderDriveAction = () => {
                              if (driveStatus?.status === 'uploading' || driveStatus?.status === 'initializing') {
                                return (
                                  <div className="upload-progress">
                                    <div className="progress-bar-sm">
                                      <div className="progress-fill-sm" style={{ width: `${driveStatus.progress || 0}%` }}></div>
                                    </div>
                                    <span>{driveStatus.progress || 0}%</span>
                                  </div>
                                );
                              }
                              if (driveStatus?.status === 'completed') {
                                return (
                                  <a href={driveStatus.link} target="_blank" rel="noopener noreferrer" className="btn-success-sm">
                                    <CheckCircle size={14} /> Drive Link
                                  </a>
                                );
                              }
                              if (driveStatus?.status === 'failed') {
                                return (
                                  <div className="upload-error" style={{ color: '#ff4d4f', fontSize: '0.85rem', display: 'flex', alignItems: 'center' }}>
                                    <AlertCircle size={14} style={{ marginRight: '4px' }} />
                                    <span title={driveStatus.error || 'Upload failed'}>Failed</span>
                                    <button 
                                      className="btn-upload-drive" 
                                      style={{ marginLeft: '8px', padding: '4px 8px', background: 'rgba(255, 77, 79, 0.2)', border: '1px solid #ff4d4f' }}
                                      onClick={() => handleUploadClick(t.infoHash, file.index)}
                                    >
                                      Retry
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <button 
                                  className="btn-upload-drive" 
                                  onClick={() => handleUploadClick(t.infoHash, file.index)}
                                  title="Upload to Google Drive"
                                >
                                  <CloudUpload size={16} /> Drive
                                </button>
                              );
                            };

                            // Helper for Telegram
                            const renderTgAction = () => {
                              if (tgStatus?.status === 'uploading' || tgStatus?.status === 'splitting' || tgStatus?.status === 'initializing') {
                                return (
                                  <div className="upload-progress">
                                    <div className="progress-bar-sm">
                                      <div className="progress-fill-sm" style={{ background: '#0088cc', width: `${tgStatus.progress || 0}%` }}></div>
                                    </div>
                                    <span style={{ minWidth: '45px' }}>
                                      {tgStatus.status === 'splitting' || tgStatus.status === 'initializing'
                                        ? 'Preparing' 
                                        : `Pt ${tgStatus.currentPart}/${tgStatus.totalParts}`
                                      }
                                    </span>
                                  </div>
                                );
                              }
                              if (tgStatus?.status === 'completed') {
                                return (
                                  <a href="https://web.telegram.org/" target="_blank" rel="noopener noreferrer" className="btn-success-sm" style={{ borderColor: '#0088cc', color: '#0088cc' }}>
                                    <CheckCircle size={14} /> Sent to TG
                                  </a>
                                );
                              }
                              if (tgStatus?.status === 'failed') {
                                return (
                                  <div className="upload-error" style={{ color: '#ff4d4f', fontSize: '0.85rem', display: 'flex', alignItems: 'center' }}>
                                    <AlertCircle size={14} style={{ marginRight: '4px' }} />
                                    <span title={tgStatus.error || 'Upload failed'}>Failed</span>
                                    <button 
                                      className="btn-upload-tg" 
                                      style={{ marginLeft: '8px', padding: '4px 8px', background: 'rgba(255, 77, 79, 0.2)', border: '1px solid #ff4d4f' }}
                                      onClick={() => startTelegramUpload(t.infoHash, file.index)}
                                    >
                                      Retry
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <button 
                                  className={`btn-upload-tg ${tgNeedsDelay ? 'disabled' : ''}`}
                                  onClick={() => {
                                    if (tgNeedsDelay) {
                                      alert('Files larger than 2GB can only be sent to Telegram after the torrent is 100% downloaded.');
                                      return;
                                    }
                                    startTelegramUpload(t.infoHash, file.index);
                                  }}
                                  title={tgNeedsDelay ? ">2GB files require full download first" : "Send to Telegram"}
                                >
                                  <Send size={16} /> TG
                                </button>
                              );
                            };

                            return (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {renderDriveAction()}
                                {renderTgAction()}
                              </div>
                            );
                          };

                          return (
                            <div key={file.index} className="file-item">
                              <div className="file-details">
                                <File size={16} className="file-icon" />
                                <span className="file-name" title={file.name}>{file.name}</span>
                                <span className="file-size">{formatBytes(file.size)}</span>
                              </div>
                              <div className="file-actions">
                                {renderFileActions()}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Visual Progress Bar */}
                  <div className="progress-bar-container" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                    <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-glass-state mt-4">
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

export default FilesPage;