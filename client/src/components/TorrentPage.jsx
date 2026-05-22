import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Star, Calendar, Clock, Users, Award, Info, Share, Plus, ThumbsUp, Volume2 } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import '../assets/styles/TorrentPage.css';

const TorrentPage = () => {
  const { torrentHash } = useParams();
  const navigate = useNavigate();
  const [torrent, setTorrent] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [recentProgress, setRecentProgress] = useState({});
  const [imdbData, setImdbData] = useState(null);
  const [imdbLoading, setImdbLoading] = useState(true);

  const fetchIMDBData = useCallback(async () => {
    try {
      setImdbLoading(true);
      const response = await fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}/imdb`);
      const data = await response.json();
      
      if (data.success && data.imdb) {
        setImdbData(data.imdb);
        console.log('📺 IMDB data loaded:', data.imdb.Title);
      } else {
        console.log('❌ No IMDB data found');
        setImdbData(null);
      }
    } catch (err) {
      console.error('Error fetching IMDB data:', err);
      setImdbData(null);
    } finally {
      setImdbLoading(false);
    }
  }, [torrentHash]);

  const fetchTorrentDetails = useCallback(async () => {
    try {
      setLoading(true);
      
      // Use the Universal API endpoint that returns both torrent info and files
      const response = await fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch torrent data`);
      }
      
      const data = await response.json();
      
      setTorrent(data.torrent);
      setFiles(data.files || []);
      
    } catch (err) {
      console.error('Error fetching torrent details:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [torrentHash]);

  const fetchTorrentProgress = useCallback(async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}`);
      if (response.ok) {
        const data = await response.json();
        setTorrent(prev => ({ ...prev, ...data.torrent }));
      }
    } catch (err) {
      console.error('Error fetching progress:', err);
    }
  }, [torrentHash]);

  const loadRecentProgress = useCallback(() => {
    const allProgress = progressService.getAllProgress();
    const torrentProgress = {};
    
    Object.values(allProgress).forEach(progress => {
      if (progress.torrentHash === torrentHash) {
        torrentProgress[progress.fileIndex] = progress;
      }
    });
    
    setRecentProgress(torrentProgress);
  }, [torrentHash]);

  useEffect(() => {
    if (torrentHash) {
      fetchTorrentDetails();
      fetchIMDBData(); // Add IMDB data fetching
      loadRecentProgress();
      
      // Set up periodic updates for dynamic progress
      const progressInterval = setInterval(() => {
        fetchTorrentProgress();
      }, 2000); // Update every 2 seconds
      
      return () => clearInterval(progressInterval);
    }
  }, [torrentHash, fetchTorrentDetails, fetchIMDBData, fetchTorrentProgress, loadRecentProgress]);

  const handleVideoSelect = (file, index) => {
    setSelectedVideo({
      file,
      index,
      torrentHash,
      src: config.getStreamUrl(torrentHash, index),
      title: file.name
    });
  };

  const handleDownload = (fileIndex) => {
    const downloadUrl = config.getDownloadUrl(torrentHash, fileIndex);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = files[fileIndex]?.name || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatFileSize = (bytes) => {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond) => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName) => {
    const ext = fileName.toLowerCase().split('.').pop();
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
      return <Film size={20} className="file-icon video" />;
    }
    if (['txt', 'nfo', 'md', 'readme'].includes(ext)) {
      return <FileText size={20} className="file-icon text" />;
    }
    return <FileText size={20} className="file-icon" />;
  };

  const getProgressInfo = (fileIndex) => {
    const progress = recentProgress[fileIndex];
    if (!progress) return null;
    
    return {
      percentage: Math.round(progress.percentage),
      currentTime: progressService.formatTime(progress.currentTime),
      duration: progressService.formatTime(progress.duration),
      lastWatched: progressService.formatRelativeTime(progress.lastWatched)
    };
  };

  if (loading) {
    return (
      <div className="torrent-page">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading torrent details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="torrent-page">
        <div className="error">
          <h2>Error loading torrent</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')} className="back-button">
            <ArrowLeft size={20} />
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="torrent-page">
      <div className="torrent-header">
        <button onClick={() => navigate('/')} className="back-button">
          <ArrowLeft size={20} />
          Back
        </button>
        
        <div className="torrent-info">
          <h1>{torrent?.name || 'Unknown Torrent'}</h1>
          <div className="torrent-overview">
            <div className="torrent-stats">
              <div className="stat-item">
                <Folder className="stat-icon" size={16} />
                <span className="stat-label">Files:</span>
                <span className="stat-value">{files.length}</span>
              </div>
              <div className="stat-item">
                <Download className="stat-icon" size={16} />
                <span className="stat-label">Size:</span>
                <span className="stat-value">{formatFileSize(torrent?.length || 0)}</span>
              </div>
              <div className="stat-item">
                <Wifi className="stat-icon" size={16} />
                <span className="stat-label">Peers:</span>
                <span className="stat-value">{torrent?.peers || 0}</span>
              </div>
              <div className="stat-item">
                <Clock className="stat-icon" size={16} />
                <span className="stat-label">Speed:</span>
                <span className="stat-value">{formatSpeed(torrent?.downloadSpeed || 0)}</span>
              </div>
            </div>
            
            {torrent?.progress !== undefined && (
              <div className="progress-section">
                <div className="progress-header">
                  <span className="progress-label">Download Progress</span>
                  <span className="progress-percentage">{Math.round(torrent.progress * 100)}%</span>
                </div>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${Math.round(torrent.progress * 100)}%` }}
                  ></div>
                </div>
                <div className="progress-details">
                  <span>{formatFileSize(torrent?.downloaded || 0)} / {formatFileSize(torrent?.length || 0)}</span>
                  {torrent?.ready && (
                    <span className="ready-indicator">
                      <RotateCcw size={12} className={torrent.progress > 0 ? 'spinning' : ''} />
                      {torrent.progress > 0 ? 'Downloading...' : 'Ready to stream'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="files-container">
        <h2>Files</h2>
        <div className="files-list">
          {files.map((file, index) => {
            const progress = getProgressInfo(index);
            const isVideo = file.name.match(/\.(mp4|avi|mkv|mov|wmv|flv|webm)$/i);
            
            return (
              <div key={index} className={`file-item ${isVideo ? 'video-file' : ''}`}>
                <div className="file-main">
                  <div className="file-info">
                    {getFileIcon(file.name)}
                    <div className="file-details">
                      <div className="file-name">{file.name}</div>
                      <div className="file-meta">
                        {formatFileSize(file.length)}
                        {progress && (
                          <span className="progress-info">
                            • {progress.percentage}% watched • {progress.lastWatched}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="file-actions">
                    {isVideo && (
                      <button 
                        onClick={() => handleVideoSelect(file, index)}
                        className="play-button"
                      >
                        <Play size={16} />
                        Stream
                      </button>
                    )}
                    <button 
                      onClick={() => handleDownload(index)}
                      className="download-button"
                    >
                      <Download size={16} />
                      Download
                    </button>
                  </div>
                </div>
                
                {progress && (
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${progress.percentage}%` }}
                    ></div>
                    <div className="progress-text">
                      {progress.currentTime} / {progress.duration}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedVideo && (
        <div className="video-overlay">
          <VideoPlayer
            src={selectedVideo.src}
            title={selectedVideo.title}
            torrentHash={selectedVideo.torrentHash}
            fileIndex={selectedVideo.index}
            onClose={() => setSelectedVideo(null)}
          />
        </div>
      )}
    </div>
  );
};

export default TorrentPage;
