import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Star, Calendar, Clock, Info, FileText } from 'lucide-react';
import VideoPlayer from './VideoPlayer';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import './TorrentPageNetflix.css';
import torrentHistoryService from '../services/torrentHistoryService';

// 1. Move Regex OUTSIDE the component so it isn't recreated on every render
const VIDEO_REGEX = /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i;

const TorrentPageNetflix = () => {
  const { torrentHash } = useParams();

  console.log(torrentHash);
  const navigate = useNavigate();

  const [torrent, setTorrent] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [recentProgress, setRecentProgress] = useState({});
  const [imdbData, setImdbData] = useState(null);

  // 2. Use Refs to track current state without triggering re-renders in intervals
  const isVideoOpenRef = useRef(false);

  // Sync the ref with the state so the interval can read it without being a dependency
  useEffect(() => {
    isVideoOpenRef.current = !!selectedVideo;
  }, [selectedVideo]);

  // 3. Centralized, abortable fetch logic
  useEffect(() => {
    if (!torrentHash) return;

    const controller = new AbortController();
    const signal = controller.signal;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch IMDB and Torrent Details in parallel for speed
        const [imdbRes, torrentRes] = await Promise.all([
          fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}/imdb`, { signal }).catch(() => null),
          fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}`, { signal })
        ]);

        if (!torrentRes.ok) throw new Error('Failed to fetch torrent data');

        const torrentData = await torrentRes.json();
        setTorrent(torrentData.torrent);
        setFiles(torrentData.files || []);

        if (imdbRes && imdbRes.ok) {
          const imdbJson = await imdbRes.json();
          if (imdbJson.success)
            {
              setImdbData(imdbJson.imdb);
              // SAVE THE POSTER TO LOCAL STORAGE
              if (imdbJson.imdb.Poster) {
                // Assuming torrentHash is the infoHash in this context
                torrentHistoryService.updatePoster(torrentHash, imdbJson.imdb.Poster);
              }
            }


        }

        // Load local progress history
        const allProgress = progressService.getAllProgress();
        const torrentProgress = {};
        Object.values(allProgress).forEach(progress => {
          if (progress.torrentHash === torrentHash) {
            torrentProgress[progress.fileIndex] = progress;
          }
        });
        setRecentProgress(torrentProgress);

      } catch (err) {
        if (err.name === 'AbortError') return; // Ignore unmount aborts
        console.error('Error loading data:', err);
        setError(err.message);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };

    loadInitialData();

    return () => {
      controller.abort(); // Cleanup on unmount
    };
  }, [torrentHash]);

  // 4. Isolated Polling Effect
  useEffect(() => {
    if (!torrentHash) return;

    // We don't abort the polling requests on unmount to keep code clean, 
    // but we prevent state updates if unmounted using a flag.
    let isMounted = true;

    const fetchProgress = async () => {
      // Don't poll if a video is currently playing (saves bandwidth/CPU)
      if (isVideoOpenRef.current) return;

      try {
        const response = await fetch(`${config.apiBaseUrl}/api/torrents/${torrentHash}`);
        if (response.ok && isMounted) {
          const data = await response.json();
          // Only update specific fields to prevent massive re-renders
          setTorrent(prev => prev ? { ...prev, ...data.torrent } : data.torrent);

          // Optionally update file progress if your API returns it
          if (data.files) setFiles(data.files);
        }
      } catch (err) {
        // Silently fail polling - don't crash the UI for a missed heartbeat
        console.debug('Polling error:', err);
      }
    };

    const intervalId = setInterval(fetchProgress, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [torrentHash]); // Notice selectedVideo is NOT a dependency here anymore

  // 5. Memoize expensive array filtering
  const { videoFiles, otherFiles, subtitleFiles, mainVideoFile } = useMemo(() => {
    const videos = [];
    const others = [];
    const subtitles = [];

    files.forEach(file => {
      if (VIDEO_REGEX.test(file.name)) videos.push(file);
      else if (/\.(srt|vtt)$/i.test(file.name)) subtitles.push(file);
      else others.push(file);
    });

    return {
      videoFiles: videos,
      otherFiles: others,
      subtitleFiles: subtitles,
      mainVideoFile: videos.length > 0 ? videos[0] : null
    };
  }, [files]);

  // Formatters remain the same...
  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
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
      <div className="modern-loader-overlay">
        <div className="loader-content">
          <div className="glowing-rings">
            <div className="ring ring-1"></div>
            <div className="ring ring-2"></div>
            <div className="ring ring-3"></div>
          </div>
          <p className="shimmer-text">Loading Content...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="modern-error-overlay">
        <div className="error-content">
          <div className="error-icon-wrapper">
            <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeWidth="2"></circle>
              <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round"></line>
              <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3" strokeLinecap="round"></line>
            </svg>
          </div>

          <h2 className="error-title">Whoops, that's a cut.</h2>
          <p className="error-message1">{error || "Something went wrong behind the scenes."}</p>

          <button
            className="modern-retry-btn"
            onClick={() => navigate('/')}
          >
            Return to Home
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
          subtitleFiles={subtitleFiles}
        />
      </div>
    );
  }

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
                      ) : imdbData.Poster ? (
                        <img src={imdbData.Poster} alt="Thumbnail" />
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

           {subtitleFiles.length > 0 && (
            <div className="netflix-section">
              <h2>Subtitles</h2>
              <div className="netflix-files">
                {subtitleFiles.map(file => (
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
