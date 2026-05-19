import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Star, Calendar, Clock, Users, Award, Info, Share, Plus, ThumbsUp, Volume2 } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import './TorrentPageNetflix.css';

const TorrentPageNetflix = () => {
  const { torrentHash } = useParams();
  const navigate = useNavigate();
  const [torrent, setTorrent] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [recentProgress, setRecentProgress] = useState({});
  const [imdbData, setImdbData] = useState(null);

  const fetchIMDBData = useCallback(async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}/imdb`);
      const data = await response.json();
      
      if (data.success && data.imdb) {
        setImdbData(data.imdb);
        console.log('📺 IMDB data loaded:', data.imdb.Title || data.imdb.title || 'No title found');
        console.log('📺 IMDB data object:', data.imdb);
      } else {
        console.log('❌ No IMDB data found');
        setImdbData(null);
      }
    } catch (err) {
      console.error('Error fetching IMDB data:', err);
      setImdbData(null);
    }
  }, [torrentHash]);

  const fetchTorrentDetails = useCallback(async () => {
    try {
      setLoading(true);
      
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

  useEffect(() => {
    if (torrentHash) {
      fetchTorrentDetails();
      fetchIMDBData();
      
      // Load progress only once on mount
      const allProgress = progressService.getAllProgress();
      console.log('📊 All progress data:', allProgress);
      
      const torrentProgress = {};
      Object.values(allProgress).forEach(progress => {
        if (progress.torrentHash === torrentHash) {
          torrentProgress[progress.fileIndex] = progress;
        }
      });
      console.log('📊 Filtered progress for torrent:', torrentHash, torrentProgress);
      
      // Also test direct progress retrieval for file 0
      const directProgress = progressService.getProgress(torrentHash, 0);
      console.log('📊 Direct progress for file 0:', directProgress);
      
      setRecentProgress(torrentProgress);
      
      // Only run progress fetching if no video is selected
      const progressInterval = setInterval(() => {
        if (!selectedVideo) {
          fetchTorrentProgress();
        }
      }, 2000);
      
      return () => clearInterval(progressInterval);
    }
  }, [torrentHash, fetchTorrentDetails, fetchIMDBData, fetchTorrentProgress, selectedVideo]);

  const formatFileSize = (bytes) => {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    if (isNaN(i) || i < 0) return '0 B';
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond) => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

  if (loading) {
    return (
      <div className="netflix-page">
        <div className="netflix-loading">
          <div className="netflix-spinner"></div>
          <p>Loading content...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="netflix-page">
        <div className="netflix-error">
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button 
            className="netflix-retry-btn"
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchTorrentDetails();
              fetchIMDBData();
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (selectedVideo) {

    const videoKey = `${torrentHash}-${selectedVideo.index}-${selectedVideo.name}`;
    
    // Try multiple methods to get progress
    const progressFromState = recentProgress[selectedVideo.index]?.currentTime || 0;
    const progressFromService = progressService.getProgress(torrentHash, selectedVideo.index);
    const directServiceTime = progressFromService?.currentTime || 0;
    
    // Use the direct service method as primary
    const initialProgress = directServiceTime || progressFromState;
    
    console.log('🎬 Video selected:', selectedVideo.name, 'Resume from:', initialProgress + 's');
    
    return (
      <div className="video-overlay">
        <VideoPlayer
          key={videoKey}
          src={`${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${selectedVideo.index}/stream`}
          title={selectedVideo.name}
          onClose={() => setSelectedVideo(null)}
          onTimeUpdate={() => {
            // The VideoPlayer itself handles saving progress with correct duration
            // We don't need to save it here since VideoPlayer saves every 5 seconds
          }}
          initialTime={initialProgress}
          torrentHash={torrentHash}
          fileIndex={selectedVideo.index}
        />
      </div>
    );
  }

  const mainVideoFile = files.find(file => 
    /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)
  );

  const videoFiles = files.filter(file => 
    /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)
  );

  const otherFiles = files.filter(file => 
    !/\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)
  );

  return (
    <div className="netflix-page">
      {/* Hero Section */}
      <div className="netflix-hero" style={{
        backgroundImage: (() => {
          // Prefer backdrop for header, fallback to poster, then default gradient
          if (imdbData?.Backdrop) {
            return `linear-gradient(to right, rgba(0,0,0,0.7) 40%, rgba(0,0,0,0.3) 100%), url(${imdbData.Backdrop})`;
          } else if (imdbData?.Poster && imdbData.Poster !== 'N/A') {
            return `linear-gradient(to right, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.2) 100%), url(${imdbData.Poster})`;
          } else {
            return 'linear-gradient(135deg, #0f0f23 0%, #1a1a3a 50%, #2d2d5f 100%)';
          }
        })()
      }}>
        <div className="netflix-hero-content">
          <button 
            className="netflix-back-btn"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={20} />
            Back
          </button>

          <div className="netflix-title-section">
            <h1 className="netflix-title">
              {imdbData?.Title || torrent?.name || 'Unknown Title'}
            </h1>
            
            {imdbData && (
              <div className="netflix-meta">
                <div className="netflix-rating">
                  <Star size={16} className="star-icon" />
                  <span>{imdbData.imdbRating}/10</span>
                  <span className="netflix-votes">({imdbData.imdbVotes} votes)</span>
                </div>
                
                <div className="netflix-info-row">
                  <span className="netflix-year">{imdbData.Year}</span>
                  <span className="netflix-rated">{imdbData.Rated}</span>
                  <span className="netflix-runtime">{imdbData.Runtime}</span>
                  <span className="netflix-genre">{imdbData.Genre}</span>
                </div>
              </div>
            )}

            <div className="netflix-action-buttons">
              {mainVideoFile && (
                <button 
                  className="netflix-play-btn"
                  onClick={() => setSelectedVideo(mainVideoFile)}
                >
                  <Play size={20} />
                  {recentProgress[mainVideoFile.index] ? 'Resume' : 'Play'}
                </button>
              )}
              
              {mainVideoFile && (
                <button 
                  className="netflix-secondary-btn"
                  onClick={() => handleDownload(mainVideoFile.index)}
                  title="Download video"
                >
                  <Download size={20} />
                  Download
                </button>
              )}
              
            </div>

            {imdbData?.Plot && (
              <p className="netflix-description">
                {imdbData.Plot}
              </p>
            )}
          </div>

          {imdbData?.Poster && imdbData.Poster !== 'N/A' && (
            <div className="netflix-poster">
              <img src={imdbData.Poster} alt={imdbData.Title} />
            </div>
          )}
        </div>
      </div>

      {/* Content Details */}
      <div className="netflix-content">
        <div className="netflix-main-content">
          {/* Episodes/Files Section */}
          <div className="netflix-section">
            <h2>Episodes & Files</h2>
            <div className="netflix-episodes">
              {videoFiles.map((file, index) => {
                const progress = recentProgress[file.index];
                const progressPercentage = progress ? (progress.currentTime / progress.duration) * 100 : 0;
                
                return (
                  <div key={file.index} className="netflix-episode">
                    <div className="netflix-episode-thumbnail">
                      <button 
                        className="netflix-episode-play"
                        onClick={() => setSelectedVideo(file)}
                      >
                        <Play size={16} />
                      </button>
                      {progress && (
                        <div className="netflix-progress-bar">
                          <div 
                            className="netflix-progress-fill"
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>
                      )}
                    </div>
                    
                    <div className="netflix-episode-info">
                      <div className="netflix-episode-header">
                        <h4>Episode {index + 1}</h4>
                        <span className="netflix-episode-duration">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                      <p className="netflix-episode-title">{file.name}</p>
                      {progress && progress.currentTime != null && progress.duration != null && (
                        <p className="netflix-episode-progress">
                          {progressService.formatTime(progress.currentTime)} / {progressService.formatTime(progress.duration)}
                        </p>
                      )}
                    </div>
                    
                    <div className="netflix-episode-actions">
                      <button 
                        className="netflix-episode-download"
                        onClick={() => handleDownload(file.index)}
                        title="Download episode"
                      >
                        <Download size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Additional Files */}
          {otherFiles.length > 0 && (
            <div className="netflix-section">
              <h2>Additional Files</h2>
              <div className="netflix-files">
                {otherFiles.map(file => (
                  <div key={file.index} className="netflix-file">
                    <div 
                      className="netflix-file-icon"
                      onClick={() => handleDownload(file.index)}
                      style={{ cursor: 'pointer' }}
                      title="Download file"
                    >
                      <Download size={16} />
                    </div>
                    <div className="netflix-file-info">
                      <span className="netflix-file-name">{file.name}</span>
                      <span className="netflix-file-size">{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Info */}
        <div className="netflix-sidebar">
         

          {/* Torrent Stats */}
          <div className="netflix-info-card">
            <h3>Download Info</h3>
            <div className="netflix-torrent-stats">
              <div className="netflix-stat">
                <span>Size</span>
                <span>{formatFileSize(torrent?.size || 0)}</span>
              </div>
              <div className="netflix-stat">
                <span>Progress</span>
                <span>{Math.round(torrent?.progress * 100 || 0)}%</span>
              </div>
              <div className="netflix-stat">
                <span>Speed</span>
                <span>{formatSpeed(torrent?.downloadSpeed || 0)}</span>
              </div>
              <div className="netflix-stat">
                <span>Peers</span>
                <span>{torrent?.peers || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TorrentPageNetflix;
