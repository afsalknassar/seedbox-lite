import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, SkipBack, SkipForward,
  Settings, Download, Loader2, Users, Activity, Wifi, WifiOff,
  TrendingUp, TrendingDown, Subtitles, Languages, Search, Globe, X, Minimize2
} from 'lucide-react';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import './VideoPlayer.css';

const VideoPlayer = ({
  src, title, onTimeUpdate, initialTime = 0, torrentHash = null, fileIndex = null, onClose = null
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
  const [showTorrentStats, setShowTorrentStats] = useState(true);
  const [bufferHealth, setBufferHealth] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [bufferRanges, setBufferRanges] = useState([]);
  
  // Subtitles
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);

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
          if (isPlaying && !isScrubbing) setShowControls(false);
        }, 3000);
      }}
      onMouseLeave={() => !isScrubbing && isPlaying && setShowControls(false)}
    >
      {onClose && (
        <button className="video-close-button" onClick={onClose} title="Close video"><X size={24} /></button>
      )}

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
      />

      {swipeIndicator && <div className="swipe-indicator">{swipeIndicator}</div>}

      {isLoading && (
        <div className="video-loading">
          <Loader2 className="loading-spinner spinning" />
          <span>Buffering...</span>
        </div>
      )}

      {/* Buffer Health Overlay */}
      {(isLoading || (!isPlaying && bufferHealth < 100)) && (
        <div className={`buffer-status-overlay ${(isLoading || (!isPlaying && bufferHealth < 100)) ? 'visible' : ''}`}>
          <div className="buffer-status-title">Video Buffer</div>
          <div className="buffer-status-content">
            <div className="buffer-info-row">
              <span className="buffer-info-label">Buffer Level:</span>
              <span className="buffer-info-value">{Math.round(bufferHealth)}%</span>
            </div>
            <div className="buffer-health-display">
              <div className="buffer-health-label">Health</div>
              <div className="buffer-health-bar">
                <div 
                  className={`buffer-health-fill ${bufferHealth > 70 ? 'good' : bufferHealth > 30 ? 'medium' : 'poor'}`} 
                  style={{ width: `${Math.max(bufferHealth, 5)}%` }} 
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Torrent Stats Overlay */}
      {showTorrentStats && torrentHash && (
        <div className="torrent-stats-overlay">
          <div className="stats-header">
            <div className="network-status">
              {networkStatus === 'connected' ? <Wifi size={16} className="status-icon connected" /> : <Activity size={16} className="status-icon seeking" />}
              <span className={`status-text ${networkStatus}`}>{networkStatus}</span>
            </div>
            <button className="stats-minimize" onClick={() => setShowTorrentStats(false)}><Minimize2 size={14} /></button>
          </div>
          <div className="stats-grid">
            <div className="stat-item"><Users size={14} /><span className="stat-value">{torrentStats.peers}</span></div>
            <div className="stat-item"><TrendingDown size={14} /><span className="stat-value">{(torrentStats.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s</span></div>
            <div className="stat-item"><TrendingUp size={14} /><span className="stat-value">{(torrentStats.uploadSpeed / 1024 / 1024).toFixed(1)} MB/s</span></div>
          </div>
        </div>
      )}

      {!showTorrentStats && torrentHash && (
        <button className="stats-show-button" onClick={() => setShowTorrentStats(true)}><Activity size={16} /></button>
      )}

      <div className={`video-controls ${showControls ? 'visible' : 'hidden'}`}>
        <div className="controls-background" />

        {/* Safe Scrubbing Progress Bar */}
        <div 
          className="progress-container" 
          onMouseDown={handleSeekStart}
          onMouseMove={handleSeekMove}
          onMouseUp={handleSeekEnd}
          onMouseLeave={handleSeekEnd}
        >
          <div className="progress-bar">
            {/* Render Multiple Buffered Ranges visually */}
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

        <div className="controls-main">
          <div className="controls-left">
            <button onClick={togglePlay} className="control-button">
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button onClick={() => skip(-10)} className="control-button"><SkipBack size={20} /></button>
            <button onClick={() => skip(10)} className="control-button"><SkipForward size={20} /></button>
            
            {/* Volume Control Restored */}
            <div className="volume-control">
              <button onClick={toggleMute} className="control-button">
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input type="range" min="0" max="1" step="0.1" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="volume-slider" />
            </div>

            <div className="time-display">{formatTime(displayTime)} / {formatTime(duration)}</div>
          </div>
          
          <div className="controls-center">
            <div className="video-title">{title}</div>
          </div>

          <div className="controls-right">
            {/* Subtitles Toggle Restored */}
            <div className="subtitle-menu">
              <button onClick={() => setShowSubtitleMenu(!showSubtitleMenu)} className={`control-button ${subtitlesEnabled ? 'active' : ''}`}>
                <Subtitles size={20} />
              </button>
              {showSubtitleMenu && (
                <div className="subtitle-dropdown">
                  <div className="subtitle-section">
                    <span>Options (API Coming Soon)</span>
                    <button className="subtitle-option" onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}>
                      <Languages size={16} /> {subtitlesEnabled ? 'Disable' : 'Enable'} Subtitles
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Settings & Speed Control Restored */}
            <div className="settings-menu">
              <button onClick={() => setShowSettings(!showSettings)} className="control-button">
                <Settings size={20} />
              </button>
              {showSettings && (
                <div className="settings-dropdown">
                  <div className="settings-section">
                    <span>Playback Speed</span>
                    {[0.5, 1, 1.25, 1.5, 2].map(rate => (
                      <button key={rate} onClick={() => changePlaybackRate(rate)} className={`settings-option ${playbackRate === rate ? 'active' : ''}`}>
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <a href={src} download className="control-button download-button" title="Download video"><Download size={20} /></a>
            <button onClick={toggleFullscreen} className="control-button"><Maximize size={20} /></button>
          </div>
        </div>
      </div>

      {/* Resume Dialog */}
      {showResumeDialog && resumeData && (
        <div className="resume-dialog-overlay">
          <div className="resume-dialog">
            <h3>Resume Video</h3>
            <p>Continue from {formatTime(resumeData.currentTime)}?</p>
            <div className="resume-actions">
              <button onClick={() => { videoRef.current.currentTime = 0; setShowResumeDialog(false); }} className="resume-button secondary">Start Over</button>
              <button onClick={() => { videoRef.current.currentTime = resumeData.currentTime; setShowResumeDialog(false); }} className="resume-button primary">Resume</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;