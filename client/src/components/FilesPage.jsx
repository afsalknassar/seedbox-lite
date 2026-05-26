import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, Search, Folder, File, ChevronDown, ChevronUp, CloudUpload, Link as LinkIcon, CheckCircle, Send, AlertCircle, Activity, Users } from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import { config } from '../config/environment';
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
    <div className="fp-container">
      <div className="fp-header-glass">
        <div className="fp-title-group">
          <div className="fp-title-icon">
            <HardDrive size={24} color="#fff" />
          </div>
          <h2>Server Files</h2>
        </div>

        <div className="fp-search">
          <Search size={18} className="fp-search-icon" />
          <input
            type="text"
            placeholder="Search torrents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="fp-empty-state">
          <div className="fp-loading-spinner"></div>
          <p>Loading files...</p>
        </div>
      ) : filteredTorrents.length > 0 ? (
        <div className="fp-grid">
          {filteredTorrents.map((t) => {
            const percent = t.progress ? (t.progress * 100).toFixed(1) : 0;
            const isTorrentComplete = t.progress >= 1;

            return (
              <div key={t.infoHash} className="fp-card">
                <div 
                  className="fp-card-top" 
                  onClick={() => toggleTorrent(t.infoHash)}
                >
                  <div className="fp-poster">
                    {t.poster && t.poster !== 'N/A' ? (
                      <img src={t.poster} alt={t.name} referrerPolicy="no-referrer" />
                    ) : (
                      <div className="fp-poster-placeholder">No Img</div>
                    )}
                  </div>
                  
                  <div className="fp-main-info">
                    <h4 title={t.name}>{t.name}</h4>
                    <div className="fp-meta">
                      <div className="fp-meta-item">
                        <Activity size={14} />
                        <span>{formatBytes(t.downloadSpeed || 0)}/s</span>
                      </div>
                      <span className="fp-dot">•</span>
                      <div className="fp-meta-item">
                        <Users size={14} />
                        <span>{t.peers || 0} peers</span>
                      </div>
                      <span className="fp-dot">•</span>
                      <div className="fp-meta-item">
                        <HardDrive size={14} />
                        <span>{formatBytes(t.size)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <button className="fp-toggle-btn">
                    {expandedTorrents[t.infoHash] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>
                </div>
                
                {expandedTorrents[t.infoHash] && (
                  <div className="fp-files-list">
                    {!torrentFiles[t.infoHash] ? (
                      <div className="fp-loading-sm">Loading files...</div>
                    ) : torrentFiles[t.infoHash].length === 0 ? (
                      <div className="fp-empty-sm">No files found</div>
                    ) : (
                      torrentFiles[t.infoHash].map((file) => {
                        const driveStatus = uploadStatus[`${t.infoHash}-${file.index}`];
                        const tgStatus = uploadStatus[`tg-${t.infoHash}-${file.index}`];
                        
                        const tgNeedsDelay = !isTorrentComplete && file.size > 2 * 1024 * 1024 * 1024;

                        const renderDriveAction = () => {
                          if (driveStatus?.status === 'uploading' || driveStatus?.status === 'initializing') {
                            return (
                              <div className="fp-upload-progress">
                                <div className="fp-mini-progress-bar">
                                  <div className="fp-mini-progress-fill" style={{ width: `${driveStatus.progress || 0}%` }}></div>
                                </div>
                                <span>{driveStatus.progress || 0}%</span>
                              </div>
                            );
                          }
                          if (driveStatus?.status === 'completed') {
                            return (
                              <a href={driveStatus.link} target="_blank" rel="noopener noreferrer" className="fp-btn-success">
                                <CheckCircle size={16} /> Drive Link
                              </a>
                            );
                          }
                          if (driveStatus?.status === 'failed') {
                            return (
                              <div className="fp-upload-error">
                                <AlertCircle size={14} />
                                <span title={driveStatus.error || 'Upload failed'}>Failed</span>
                                <button 
                                  className="fp-btn-retry" 
                                  onClick={() => handleUploadClick(t.infoHash, file.index)}
                                >
                                  Retry
                                </button>
                              </div>
                            );
                          }
                          return (
                            <button 
                              className="fp-btn-drive" 
                              onClick={() => handleUploadClick(t.infoHash, file.index)}
                              title="Upload to Google Drive"
                            >
                              <CloudUpload size={16} /> Drive
                            </button>
                          );
                        };

                        const renderTgAction = () => {
                          if (tgStatus?.status === 'uploading' || tgStatus?.status === 'splitting' || tgStatus?.status === 'initializing') {
                            return (
                              <div className="fp-upload-progress">
                                <div className="fp-mini-progress-bar">
                                  <div className="fp-mini-progress-fill tg" style={{ width: `${tgStatus.progress || 0}%` }}></div>
                                </div>
                                <span>
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
                              <a href="https://web.telegram.org/" target="_blank" rel="noopener noreferrer" className="fp-btn-success" style={{ color: '#0ea5e9', borderColor: 'rgba(14, 165, 233, 0.3)', background: 'rgba(14, 165, 233, 0.1)' }}>
                                <CheckCircle size={16} /> Sent to TG
                              </a>
                            );
                          }
                          if (tgStatus?.status === 'failed') {
                            return (
                              <div className="fp-upload-error">
                                <AlertCircle size={14} />
                                <span title={tgStatus.error || 'Upload failed'}>Failed</span>
                                <button 
                                  className="fp-btn-retry" 
                                  onClick={() => startTelegramUpload(t.infoHash, file.index)}
                                >
                                  Retry
                                </button>
                              </div>
                            );
                          }
                          return (
                            <button 
                              className={`fp-btn-tg ${tgNeedsDelay ? 'fp-disabled' : ''}`}
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
                          <div key={file.index} className="fp-file-item">
                            <div className="fp-file-details">
                              <File size={18} className="fp-file-icon" />
                              <span className="fp-file-name" title={file.name}>{file.name}</span>
                              <span className="fp-file-size">{formatBytes(file.size)}</span>
                            </div>
                            <div className="fp-file-actions">
                              {renderDriveAction()}
                              {renderTgAction()}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                <div className="fp-progress-container">
                  <div className="fp-progress-fill" style={{ width: `${percent}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="fp-empty-state">
          <div className="fp-empty-icon">
            <HardDrive size={48} />
          </div>
          <h3>No Files Found</h3>
          <p>There are no active files currently hosted on the server.</p>
        </div>
      )}
    </div>
  );
};

export default FilesPage;