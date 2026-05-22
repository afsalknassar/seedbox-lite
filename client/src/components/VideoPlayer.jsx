import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, SkipBack, SkipForward,
  Settings, Download, Loader2, Users, Activity, Wifi, WifiOff,
  TrendingUp, TrendingDown, Subtitles, Languages, Search, Globe, X, Minimize2
} from 'lucide-react';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import '../assets/styles/VideoPlayer.css';

const VideoPlayer = ({
  src, title, onTimeUpdate, initialTime = 0, torrentHash = null, fileIndex = null, onClose = null, subtitleFiles = []
}) => {
  const videoRef = useRef(null);

  // Core Playback States
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // UI & Feature States
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  // Scrubbing & Touch Gestures
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const touchRef = useRef({ startX: 0, startY: 0, isSeeking: false, initialTime: 0 });
  const [swipeIndicator, setSwipeIndicator] = useState(null);

  // Buffer & Torrent Stats
  const [torrentStats, setTorrentStats] = useState({ peers: 0, downloadSpeed: 0, uploadSpeed: 0, progress: 0 });
  const [networkStatus, setNetworkStatus] = useState('connecting');
  const [showTorrentStats, setShowTorrentStats] = useState(false);
  const [bufferHealth, setBufferHealth] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [bufferRanges, setBufferRanges] = useState([]);

  // Subtitles
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState(0);

  // Resume State
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [resumeData, setResumeData] = useState(null);
  const [hasAppliedInitialTime, setHasAppliedInitialTime] = useState(false);

  // Throttling Refs
  const lastTimeUpdateRef = useRef(0);
  const progressSaveTimerRef = useRef(Date.now());
  const controlsTimeoutRef = useRef(null);

  // ==========================================
  // 1. SAFE POLLING & BUFFER HEALTH
  // ==========================================
  useEffect(() => {
    if (!torrentHash) return;
    let isMounted = true;

    const fetchStats = async () => {
      try {
        const response = await fetch(config.getTorrentUrl(torrentHash, 'stats'));
        if (response.ok && isMounted) {
          const stats = await response.json();
          setTorrentStats(stats);
          setNetworkStatus(stats.peers > 0 ? 'connected' : 'seeking');

          // Calculate Buffer Health
          if (videoRef.current && stats.downloadSpeed > 0) {
            const currentBitrate = videoRef.current.playbackRate * 1024 * 1024; // Rough estimate 1MB/s
            const health = Math.min(100, (stats.downloadSpeed / currentBitrate) * 100);
            setBufferHealth(health);
          }
        }
      } catch (error) {
        if (isMounted) setNetworkStatus('disconnected');
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [torrentHash]);

  // ==========================================
  // 2. NATIVE VIDEO EVENTS & VISUAL BUFFER
  // ==========================================
  const updateBufferedProgress = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    if (video.buffered.length > 0 && video.duration) {
      const ranges = [];
      let maxEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        ranges.push({ start, end });
        if (end > maxEnd) maxEnd = end;
      }
      setBufferRanges(ranges);
      setBufferedPercent((maxEnd / video.duration) * 100);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);

      // ❌ REMOVED: setIsLoading(false); <-- Do NOT turn off the spinner here!
      // The video hasn't actually downloaded the first visual frame yet.

      // Auto-resume logic
      if (initialTime > 0 && !hasAppliedInitialTime) {
        video.currentTime = initialTime;
        setCurrentTime(initialTime);
        setHasAppliedInitialTime(true);
      } else if (initialTime === 0 && !hasAppliedInitialTime) {
        const resumeInfo = progressService.shouldResumeVideo(torrentHash, fileIndex);
        if (resumeInfo) {
          setResumeData(resumeInfo);
          setShowResumeDialog(true);
        }
        setHasAppliedInitialTime(true);
      }

      // Try to autoplay
      video.play().catch((err) => {
        console.log('Autoplay blocked by browser:', err);
        // If autoplay is blocked, turn off the spinner so they can see the Play button
        setIsLoading(false);
      });
    };

    const handleTimeUpdate = () => {
      // ... (Keep your existing handleTimeUpdate logic exactly the same)
      const now = Date.now();
      if (now - lastTimeUpdateRef.current > 500) {
        if (!isScrubbing) setCurrentTime(video.currentTime);
        updateBufferedProgress();
        onTimeUpdate?.(video.currentTime);
        lastTimeUpdateRef.current = now;
      }
      if (torrentHash && fileIndex !== null && video.duration > 0) {
        if (now - progressSaveTimerRef.current > 5000) {
          progressService.saveProgress(torrentHash, fileIndex, video.currentTime, video.duration, title);
          progressSaveTimerRef.current = now;
        }
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);

    // ✅ NEW: Wait for the browser to say it has enough data to show a frame
    video.addEventListener('canplay', () => setIsLoading(false));

    video.addEventListener('waiting', () => setIsLoading(true));
    video.addEventListener('playing', () => {
      setIsLoading(false); // Ensure spinner is off when playing
      setIsPlaying(true);
    });
    video.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('canplay', () => setIsLoading(false));
      video.removeEventListener('waiting', () => setIsLoading(true));
      video.removeEventListener('playing', () => { setIsLoading(false); setIsPlaying(true); });
      video.removeEventListener('pause', () => setIsPlaying(false));
    };
  }, [initialTime, torrentHash, fileIndex, title, isScrubbing, hasAppliedInitialTime, updateBufferedProgress, onTimeUpdate]);



  // 1. Hook to manage subtitle visibility natively
  useEffect(() => {
    if (!videoRef.current) return;

    const tracks = videoRef.current.textTracks;

    for (let i = 0; i < tracks.length; i++) {
      // Show the track ONLY if subtitles are enabled AND the index matches the chosen track
      if (subtitlesEnabled && i === activeSubtitleIndex) {
        tracks[i].mode = 'showing';
      } else {
        tracks[i].mode = 'hidden';
      }
    }
  }, [subtitlesEnabled, activeSubtitleIndex, subtitleFiles]);

  // ==========================================
  // 3. SAFE SCRUBBING & GESTURES
  // ==========================================
  const handleSeekStart = (e) => {
    setIsScrubbing(true);
    updateScrubTime(e);
  };

  const handleSeekMove = (e) => {
    if (!isScrubbing) return;
    updateScrubTime(e);
  };

  const updateScrubTime = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setScrubTime((clickX / rect.width) * duration);
  };

  const handleSeekEnd = () => {
    if (!isScrubbing || !videoRef.current) return;
    videoRef.current.currentTime = scrubTime;
    setCurrentTime(scrubTime);
    setIsScrubbing(false);
  };

  // Touch Swipe for Mobile
  const handleTouchStart = (e) => {
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      isSeeking: false,
      initialTime: videoRef.current ? videoRef.current.currentTime : 0
    };
  };

  const handleTouchMove = (e) => {
    if (!videoRef.current || duration === 0) return;
    const deltaX = e.touches[0].clientX - touchRef.current.startX;

    // Horizontal swipe threshold
    if (Math.abs(deltaX) > 30) {
      setIsScrubbing(true);
      touchRef.current.isSeeking = true;
      const seekAmount = (deltaX / window.innerWidth) * 90; // 90 seconds max sweep
      const newTime = Math.max(0, Math.min(duration, touchRef.current.initialTime + seekAmount));

      setScrubTime(newTime);
      const diff = newTime - touchRef.current.initialTime;
      setSwipeIndicator(`${diff > 0 ? '+' : ''}${Math.round(diff)}s`);
    }
  };

  const handleTouchEnd = () => {
    if (touchRef.current.isSeeking && videoRef.current) {
      videoRef.current.currentTime = scrubTime;
      setCurrentTime(scrubTime);
      setSwipeIndicator(null);
      setTimeout(() => setIsScrubbing(false), 100); // Small delay to prevent jitter
    }
  };

  // ==========================================
  // 4. PLAYER CONTROLS
  // ==========================================
  const togglePlay = () => {
    if (videoRef.current.paused) videoRef.current.play();
    else videoRef.current.pause();
  };

  const skip = (seconds) => {
    const video = videoRef.current;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    setVolume(val);
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const changePlaybackRate = (rate) => {
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
  };

  const toggleFullscreen = () => {
    const container = videoRef.current.parentElement;
    if (!document.fullscreenElement) container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
    else document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    setIsFullscreen(!document.fullscreenElement);
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const displayTime = isScrubbing ? scrubTime : currentTime;

  return (
    <div
      className={`video-player-container ${isFullscreen ? 'fullscreen' : ''}`}
      onMouseMove={() => {
        setShowControls(true);
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
          if (isPlaying && !isScrubbing && !subtitlesEnabled) setShowControls(false);
        }, 3000);
      }}
      // onMouseLeave={() => !isScrubbing && isPlaying && setShowControls(false)}
      onClick={() => {
        if (isLoading) return;
        setShowControls(!showControls);
      }}
    >
      <video
        ref={videoRef}
        src={src}
        className="video-element"
        onDoubleClick={toggleFullscreen}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        playsInline
        crossOrigin="anonymous"
      >
        {subtitleFiles.map((sub, idx) => (
          <track
            key={sub.index}
            kind="subtitles"
            src={`${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${sub.index}/subtitle`}
            srcLang="en"
            label={sub.name}
            default={idx === 0}
          />
        ))}

      </video>

      <div className="controls-gradient-top" />

      {/* NEW TOP BAR: Title & Close Button are segregated here */}
      {/* TOP BAR */}
      <div className={`top-bar ${showControls ? 'visible' : ''}`}>
        <div className="video-title1">{title}</div>

        {/* Right Side Actions Container */}
        <div className="top-bar-actions">

          {onClose && (
            <div className="top-action-button video-close-button" onClick={onClose} title="Close">
              <X size={20} />
            </div>
          )}
        </div>
      </div>

      {/* CENTERED STATS MODAL (Placed outside the top-bar) */}
      {showTorrentStats && torrentHash && (
        <div className="torrent-stats-centered" onClick={(e) => e.stopPropagation()}>
          <div className="centered-stats-header">
            <span className="centered-stats-title">
              {networkStatus === 'connected' ? 'Network Connected' : 'Seeking Peers...'}
            </span>
            <button className="stats-close-btn" onClick={() => setShowTorrentStats(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="centered-stats-row">
            <div className="centered-stat-pill">
              <Users size={14} />
              <span>{torrentStats.peers} Peers</span>
            </div>
            <div className="centered-stat-pill">
              <TrendingDown size={14} />
              <span>{(torrentStats.downloadSpeed / 1024 / 1024).toFixed(1)} M/s</span>
            </div>
            <div className="centered-stat-pill">
              <TrendingUp size={14} />
              <span>{(torrentStats.uploadSpeed / 1024 / 1024).toFixed(1)} M/s</span>
            </div>
          </div>
        </div>
      )}

      {swipeIndicator && <div className="swipe-indicator">{swipeIndicator}</div>}

      {isLoading && (
        <div className="video-loading">
          {/* First Row: Spinner and Text */}
          <div className="loading-header">
            <Loader2 className="loading-spinner spinning" size={18} />
            <span>Buffering {Math.round(bufferHealth)}%</span>
          </div>

          {/* Second Row: Health Bar */}
          <div className="buffer-health-bar">
            <div
              className={`buffer-health-fill ${bufferHealth > 70 ? 'good' : bufferHealth > 30 ? 'medium' : 'poor'}`}
              style={{ width: `${Math.max(bufferHealth, 5)}%` }}
            />
          </div>
        </div>
      )}



      {/* FLOATING CONTROL PILL */}
      <div className={`video-controls ${showControls ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>

        {/* Progress Bar moved to the top of the pill */}
        <div
          className="progress-container"
          onMouseDown={handleSeekStart}
          onMouseMove={handleSeekMove}
          onMouseUp={handleSeekEnd}
          onMouseLeave={handleSeekEnd}
        >
          <div className="progress-bar">
            {bufferRanges.map((range, i) => (
              <div
                key={i}
                className="progress-buffered-range"
                style={{
                  left: `${(range.start / duration) * 100}%`,
                  width: `${((range.end - range.start) / duration) * 100}%`
                }}
              />
            ))}
            <div className="progress-played" style={{ width: `${(displayTime / duration) * 100}%` }} />
            <div className="progress-thumb" style={{ left: `${(displayTime / duration) * 100}%` }} />
            {torrentStats.progress > 0 && (
              <div className="progress-torrent" style={{ width: `${torrentStats.progress}%` }} />
            )}
          </div>
        </div>

        {/* Buttons Container */}
        <div className="controls-main">
          <div className="controls-left">
            <button onClick={togglePlay} className="control-button play-button" disabled={isLoading}>
              {isPlaying ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
            </button>
            <button onClick={() => skip(-10)} className="control-button hide-on-mobile"><SkipBack size={18} /></button>
            <button onClick={() => skip(10)} className="control-button hide-on-mobile"><SkipForward size={18} /></button>

            <div className="volume-control hide-on-mobile">
              <button onClick={toggleMute} className="control-button">
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input type="range" min="0" max="1" step="0.1" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="volume-slider" />
            </div>

            <div className="time-display">{formatTime(displayTime)} / {formatTime(duration)}</div>
          </div>

          <div className="controls-right">

            {/* Torrent stats */}
            <div className="subtitle-menu">
              {torrentHash && (
                <button className="control-button" onClick={() => setShowTorrentStats(!showTorrentStats)}><Activity size={14} /></button>
              )}
            </div>
            {/* Subtitles Menu */}
            {subtitleFiles.length > 0 && (
              <div className="subtitle-menu">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubtitleMenu(!showSubtitleMenu); }}
                  className={`control-button ${subtitlesEnabled ? 'active' : ''}`}
                >
                  <Subtitles size={18} />
                </button>

                {showSubtitleMenu && (
                  <div className="subtitle-dropdown" onClick={(e) => e.stopPropagation()}>
                    <div className="subtitle-section">
                      <span>Subtitles</span>

                      {/* The "OFF" Button */}
                      <button
                        className={`subtitle-option ${!subtitlesEnabled ? 'active' : ''}`}
                        onClick={() => {
                          setSubtitlesEnabled(false);
                          setShowSubtitleMenu(false);
                        }}
                      >
                       Disbale subtitles
                      </button>

                      {/* Loop through all files and create a button for each one */}
                      {subtitleFiles.map((sub, idx) => (
                        <button
                          key={sub.index}
                          className={`subtitle-option ${subtitlesEnabled && activeSubtitleIndex === idx ? 'active' : ''}`}
                          onClick={() => {
                            setActiveSubtitleIndex(idx);
                            setSubtitlesEnabled(true);
                            setShowSubtitleMenu(false);
                          }}
                        >
                          {sub.name || `Track ${idx + 1}`}
                        </button>
                      ))}

                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Settings Menu */}
            <div className="settings-menu">
              <button onClick={() => setShowSettings(!showSettings)} className="control-button">
                <Settings size={18} />
              </button>
              {showSettings && (
                <div className="settings-dropdown">
                  <div className="settings-section1">
                    <span>Speed</span>
                    {[0.5, 1, 1.25, 1.5, 2].map(r => (
                      <button
                        key={r}
                        onClick={() => changePlaybackRate(r)}
                        className={`settings-option ${playbackRate === r ? 'active' : ''}`}
                      >
                        {r === 1 ? 'Normal' : `${r}x`}
                      </button>
                    ))}
                  </div>

                  <div className="settings-section1 mobile-only-settings">
                    <span>Audio</span>
                    <button className="settings-option" onClick={toggleMute}>
                      {isMuted || volume === 0 ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <a href={src} download className="control-button " title="Download"><Download size={18} /></a>
            <button onClick={toggleFullscreen} className="control-button"><Maximize size={18} /></button>
          </div>
        </div>
      </div>

      {/* Resume Dialog */}
      {showResumeDialog && resumeData && (
        <div className="resume-dialog-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="resume-dialog">
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Resume Playback?</h3>
            <p style={{ margin: '0 0 16px 0', color: '#a1a1aa', fontSize: '14px' }}>Continue from {formatTime(resumeData.currentTime)}</p>
            <div className="resume-actions">
              <button onClick={() => { videoRef.current.currentTime = 0; setShowResumeDialog(false); }} className="resume-button secondary">Restart</button>
              <button onClick={() => { videoRef.current.currentTime = resumeData.currentTime; setShowResumeDialog(false); }} className="resume-button primary">Resume</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;