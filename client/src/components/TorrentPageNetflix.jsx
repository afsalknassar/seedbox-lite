import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Star, Calendar, Clock, Info, FileText } from 'lucide-react';
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
      } else {
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

      const allProgress = progressService.getAllProgress();
      const torrentProgress = {};
      Object.values(allProgress).forEach(progress => {
        if (progress.torrentHash === torrentHash) {
          torrentProgress[progress.fileIndex] = progress;
        }
      });
      setRecentProgress(torrentProgress);

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
    if (!bytesPerSecond || isNaN(bytesPerSecond) || bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    if (i < 0 || i >= sizes.length) return '0 B/s';
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleDownload = (e, fileIndex) => {
    e.stopPropagation();
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
    const progressFromState = recentProgress[selectedVideo.index]?.currentTime || 0;
    const progressFromService = progressService.getProgress(torrentHash, selectedVideo.index);
    const directServiceTime = progressFromService?.currentTime || 0;
    const initialProgress = directServiceTime || progressFromState;

    return (
      <div className="video-overlay">
        <VideoPlayer
          key={videoKey}
          src={`${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${selectedVideo.index}/stream`}
          title={selectedVideo.name}
          onClose={() => setSelectedVideo(null)}
          onTimeUpdate={() => { }}
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

  const heroBackground = imdbData?.Backdrop
    ? `url(${imdbData.Backdrop})`
    : (imdbData?.Poster && imdbData.Poster !== 'N/A'
      ? `url(${imdbData.Poster})`
      : 'linear-gradient(135deg, #111 0%, #333 100%)');

  return (
    <div className="netflix-page">
      <div className="netflix-hero" style={{ backgroundImage: heroBackground }}>
        <button className="netflix-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={24} color="#ffffff" />
          <span className="back-text">Back</span>
        </button>

        <div className="netflix-hero-content">
          <div className="netflix-title-section">
            <h1 className="netflix-title">
              {imdbData?.Title || torrent?.name || 'Unknown Title'}
            </h1>

            {imdbData && (
              <div className="netflix-meta">
                {imdbData.Year && <span className="netflix-year">{imdbData.Year}</span>}
                {imdbData.Genre && <span className="netflix-genre">{imdbData.Genre}</span>}
                {imdbData.Runtime && <span className="netflix-runtime">{imdbData.Runtime}</span>}

              </div>
            )}
            {imdbData && (
              <div className="netflix-meta">
                {imdbData.Rated && <span className="netflix-rating">{imdbData.Rated}</span>}
                {imdbData.imdbRating && (
                  <span className="netflix-imdb" style={{ fontSize: '18px' }} ><Star size={18} fill="#f5c518" color="#f5c518" style={{ display: 'inline', marginRight: '4px' }} />{imdbData.imdbRating}</span>
                )}

              </div>
            )}

            <p className="netflix-description">
              {imdbData?.Plot || 'No description available for this content.'}
            </p>

            <div className="netflix-action-buttons">
              {mainVideoFile && (
                <button
                  className="netflix-play-btn"
                  onClick={() => setSelectedVideo(mainVideoFile)}
                >
                  <Play size={24} fill="currentColor" strokeWidth={0} />
                  <span>{recentProgress[mainVideoFile.index] ? 'Resume' : 'Play'}</span>
                </button>
              )}

              <button
                className="netflix-secondary-btn"
                onClick={(e) => mainVideoFile ? handleDownload(e, mainVideoFile.index) : null}
              >
                <Download size={22} strokeWidth={2.5} color="#ffffff" />
                <span>Download</span>
              </button>
            </div>
          </div>

          {imdbData?.Poster && imdbData.Poster !== 'N/A' && (
            <img
              className="netflix-poster"
              src={imdbData.Poster}
              alt={imdbData.Title}
            />
          )}
        </div>
      </div>

      <div className="netflix-content">
        <div className="netflix-main-content">
          
            <div className="netflix-section">
              <h2>Episodes</h2>
              <div className="netflix-episodes">
                {videoFiles.map((file, index) => {
                  const progress = recentProgress[file.index];
                  const progressPercentage = progress ? (progress.currentTime / progress.duration) * 100 : 0;

                  return (
                    <div
                      key={file.index}
                      className="netflix-episode"
                      onClick={() => setSelectedVideo(file)}
                    >
                      <div className="netflix-episode-number">{index + 1}</div>

                      <div className="netflix-episode-thumbnail">
                        {imdbData?.Backdrop ? (
                          <img src={imdbData.Backdrop} alt="Thumbnail" />
                        ) : (
                          <div style={{ width: '100%', height: '100%', background: '#333' }}></div>
                        )}
                        <div className="netflix-episode-play">
                          <div className="netflix-episode-play-icon">
                            <Play size={20} fill="currentColor" strokeWidth={0} />
                          </div>
                        </div>
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
                          <h4>{file.name}</h4>
                          <span className="netflix-episode-duration">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <p className="netflix-episode-desc">
                          {progress && progress.currentTime != null && progress.duration != null
                            && `Progress: ${progressService.formatTime(progress.currentTime)} / ${progressService.formatTime(progress.duration)}`
                            
                          }
                        </p>
                      </div>

                      <div className="netflix-episode-actions">
                        <button
                          // className="netflix-action-icon"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevents clicking the button from also selecting the video
                            handleDownload(e, file.index);
                          }}
                          title="Download"
                        >
                          <Download size={18} strokeWidth={2} color="#ffffff" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
         

          {otherFiles.length > 0 && (
            <div className="netflix-section">
              <h2>Additional Files</h2>
              <div className="netflix-files">
                {otherFiles.map(file => (
                  <div key={file.index} className="netflix-file">
                    <div className="netflix-file-icon">
                      <FileText size={24} strokeWidth={2} color="#ffffff" />
                    </div>
                    <div className="netflix-file-info">
                      <span className="netflix-file-name" title={file.name}>{file.name}</span>
                      <span className="netflix-file-size">{formatFileSize(file.size)}</span>
                    </div>
                    <button

                      onClick={(e) => handleDownload(e, file.index)}
                      title="Download"
                    >
                      <Download size={18} strokeWidth={2} color="#ffffff" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="netflix-sidebar">
          <div className="netflix-info-card">
            <h3>Cache Status</h3>
            <div className="netflix-torrent-stats">
              <div className="netflix-stat">
                <span>Total Size</span>
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
