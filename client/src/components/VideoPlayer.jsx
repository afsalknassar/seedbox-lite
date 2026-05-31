import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, SkipBack, SkipForward,
  Settings, Download, Loader2, Users, Activity, Wifi, WifiOff,
  TrendingUp, TrendingDown, Subtitles, Languages, Search, Globe, X, Minimize2,
  Server
} from 'lucide-react';
import { config } from '../config/environment';
import progressService from '../services/progressService';
import '../assets/styles/VideoPlayer.css';
import VLC_ICON from '../assets/vlc.webp';

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

  // Robust Buffering Reason State
  const [bufferingReason, setBufferingReason] = useState(null);
  const bufferingStartTimeRef = useRef(null);
  const lastSeekTimeRef = useRef(0);
  const bufferAheadHistoryRef = useRef([]); // [{time, bufferAhead}] for throughput measurement
  const prevBufferingReasonRef = useRef(null); // debounce: hold previous reason
  const reasonStableCountRef = useRef(0); // debounce: how many cycles the new reason has been stable

  // Subtitles
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState(0);
  const [onlineSubtitles, setOnlineSubtitles] = useState([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState(null);
  const [subtitleSearchQuery, setSubtitleSearchQuery] = useState('');

  // Resume State
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [resumeData, setResumeData] = useState(null);
  const [hasAppliedInitialTime, setHasAppliedInitialTime] = useState(false);

  // Throttling Refs
  const lastTimeUpdateRef = useRef(0);
  const progressSaveTimerRef = useRef(Date.now());
  const controlsTimeoutRef = useRef(null);

  // ==========================================
  // ROBUST BUFFERING REASON DIAGNOSTICS
  // ==========================================

  // Helper: get seconds of data buffered ahead of current playhead
  const getBufferAhead = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.buffered || video.buffered.length === 0) return 0;
    const ct = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= ct && video.buffered.end(i) > ct) {
        return video.buffered.end(i) - ct;
      }
    }
    return 0;
  }, []);

  // Helper: estimate real client throughput from buffer-ahead growth (Mbps)
  const estimateRealThroughput = useCallback(() => {
    const history = bufferAheadHistoryRef.current;
    if (history.length < 2) return null;
    const oldest = history[0];
    const newest = history[history.length - 1];
    const elapsedSec = (newest.time - oldest.time) / 1000;
    if (elapsedSec < 1) return null;
    const bufferGrowth = newest.bufferAhead - oldest.bufferAhead; // seconds of video gained
    // If buffer isn't growing, throughput ≈ 0
    if (bufferGrowth <= 0) return 0;
    // Rough: bufferGrowth seconds of video arrived in elapsedSec seconds of wall-clock
    // ratio > 1 means we're downloading faster than real-time
    return bufferGrowth / elapsedSec; // ratio, not Mbps — we use this comparatively
  }, []);

  // Core diagnostic function
  const diagnoseBufferingReason = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const now = Date.now();
    const bufferAhead = getBufferAhead();
    const timeSinceSeek = now - lastSeekTimeRef.current;
    const timeSinceBufferingStart = bufferingStartTimeRef.current ? now - bufferingStartTimeRef.current : 0;
    const torrentProgress = typeof torrentStats.progress === 'number' && !isNaN(torrentStats.progress) ? torrentStats.progress : 0;
    const torrentDlSpeed = typeof torrentStats.downloadSpeed === 'number' ? torrentStats.downloadSpeed : 0;
    const peers = typeof torrentStats.peers === 'number' ? torrentStats.peers : 0;
    const torrentDone = torrentProgress >= 0.999;
    const videoDuration = video.duration || 0;
    const fileSize = torrentStats.size || 0;

    // Record buffer-ahead for throughput estimation (keep last 10 samples, ~1s apart)
    const hist = bufferAheadHistoryRef.current;
    if (hist.length === 0 || now - hist[hist.length - 1].time >= 500) {
      hist.push({ time: now, bufferAhead });
      if (hist.length > 10) hist.shift();
    }

    // --- Priority 1: Initial load (no data at all yet) ---
    if (videoDuration === 0 || (video.readyState < 2 && timeSinceBufferingStart < 15000)) {
      return {
        type: 'initial',
        icon: 'loader',
        label: 'Loading Video...',
        detail: torrentHash ? (peers > 0 ? `Connected to ${peers} peers` : 'Connecting to peers...') : null,
        color: 'warning'
      };
    }

    // --- Priority 2: Post-seek buffering (normal, expected) ---
    if (timeSinceSeek < 5000) {
      return {
        type: 'seek',
        icon: 'loader',
        label: 'Seeking...',
        detail: bufferAhead > 0 ? `${bufferAhead.toFixed(1)}s buffered` : 'Loading new position',
        color: 'warning'
      };
    }

    // --- Priority 3: Torrent still downloading to server ---
    if (torrentHash && !torrentDone) {
      const playheadFraction = videoDuration > 0 ? video.currentTime / videoDuration : 0;
      const isPlayheadBeyondDownloaded = playheadFraction > torrentProgress + 0.02; // 2% margin

      if (isPlayheadBeyondDownloaded) {
        return {
          type: 'torrent_ahead',
          icon: 'download',
          label: 'Downloading',
          detail: 'Fetching video data...',
          color: 'download'
        };
      }

      return {
        type: 'torrent_downloading',
        icon: 'download',
        label: 'Buffering',
        detail: 'Downloading...',
        color: 'download'
      };
    }

    // --- Priority 4: Network analysis (torrent done or no torrent) ---
    const throughputRatio = estimateRealThroughput();
    const avgBitrateMbps = (fileSize > 0 && videoDuration > 0)
      ? (fileSize * 8) / (1024 * 1024) / videoDuration
      : 0;

    // Use Network Information API as a weak hint (not ground truth)
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const connDownlink = conn?.downlink; // Mbps, can be stale/inaccurate
    const connEffectiveType = conn?.effectiveType; // '4g', '3g', '2g', 'slow-2g'

    // Only flag slow network when the browser API explicitly reports it
    // Do NOT use throughputRatio here — it can't distinguish client vs server slowness
    const isBrowserReportingSlow = (
      (connEffectiveType && ['slow-2g', '2g', '3g'].includes(connEffectiveType)) ||
      (connDownlink != null && avgBitrateMbps > 0 && connDownlink < avgBitrateMbps * 0.8)
    );

    // Measure actual buffer fill rate as an independent signal
    const isBufferStarved = throughputRatio !== null && throughputRatio < 0.5;

    if (isBrowserReportingSlow) {
      return {
        type: 'slow_network',
        icon: 'wifi_off',
        label: 'Slow Connection',
        detail: 'Buffering...',
        color: 'network'
      };
    }

    // --- Priority 5: Data not arriving fast enough ---
    // Buffer isn't growing but the browser API doesn't report slow network.
    if (isBufferStarved || (timeSinceBufferingStart > 5000 && bufferAhead < 1)) {
      return {
        type: 'slow_network',
        icon: 'wifi_off',
        label: 'Slow Connection',
        detail: 'Data arriving slowly...',
        color: 'network'
      };
    }

    // --- Fallback ---
    return {
      type: 'generic',
      icon: 'loader',
      label: 'Buffering...',
      detail: bufferAhead > 0 ? `${bufferAhead.toFixed(1)}s buffered` : 'Waiting for data',
      color: 'warning'
    };
  }, [torrentStats, torrentHash, getBufferAhead, estimateRealThroughput]);

  // Effect: run diagnostics while buffering, with debouncing
  useEffect(() => {
    if (!isLoading) {
      // Reset when buffering stops
      bufferingStartTimeRef.current = null;
      bufferAheadHistoryRef.current = [];
      reasonStableCountRef.current = 0;
      prevBufferingReasonRef.current = null;
      setBufferingReason(null);
      return;
    }

    // Mark buffering start
    if (!bufferingStartTimeRef.current) {
      bufferingStartTimeRef.current = Date.now();
      bufferAheadHistoryRef.current = [];
    }

    // Run diagnostics on an interval while buffering
    const intervalId = setInterval(() => {
      const newReason = diagnoseBufferingReason();
      if (!newReason) return;

      // Debounce: only update the displayed reason if it's been stable for 2 cycles (1s)
      if (prevBufferingReasonRef.current?.type === newReason.type) {
        reasonStableCountRef.current++;
      } else {
        reasonStableCountRef.current = 0;
      }
      prevBufferingReasonRef.current = newReason;

      // Show immediately on first diagnosis, then debounce changes
      if (reasonStableCountRef.current >= 1 || !bufferingReason) {
        setBufferingReason(newReason);
      }
    }, 500);

    // Also run immediately
    const immediateReason = diagnoseBufferingReason();
    if (immediateReason && !bufferingReason) {
      setBufferingReason(immediateReason);
      prevBufferingReasonRef.current = immediateReason;
    }

    return () => clearInterval(intervalId);
  }, [isLoading, diagnoseBufferingReason]);

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

          // Calculate Buffer Health using actual video bitrate
          if (videoRef.current && stats.downloadSpeed > 0) {
            const videoDur = videoRef.current.duration;
            const fileSize = stats.size || 0;
            // Estimate actual bitrate from file size and duration (bytes/sec)
            const actualBitrate = (fileSize > 0 && videoDur > 0)
              ? (fileSize / videoDur) * videoRef.current.playbackRate
              : videoRef.current.playbackRate * 1024 * 1024; // Fallback: 1MB/s
            const health = Math.min(100, (stats.downloadSpeed / actualBitrate) * 100);
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


  // 2. Hook to load online subtitles
  const loadOnlineSubtitle = useCallback(async (subtitle) => {

    try {
      console.log(`📥 Loading online subtitle: ${subtitle.language} from ${subtitle.source}`);
      console.log('📥 Subtitle object:', subtitle);

      let downloadUrl;
      if (subtitle.fileId) {
        downloadUrl = `${config.apiBaseUrl}/api/subtitles/download?fileId=${encodeURIComponent(subtitle.fileId)}&language=${encodeURIComponent(subtitle.language)}&filename=${encodeURIComponent(subtitle.filename || 'subtitle.srt')}&torrentHash=${encodeURIComponent(torrentHash)}`;
      } else if (subtitle.url) {
        downloadUrl = `${config.apiBaseUrl}/api/subtitles/download?url=${encodeURIComponent(subtitle.url)}&language=${encodeURIComponent(subtitle.language)}&filename=${encodeURIComponent(subtitle.filename || 'subtitle.srt')}&torrentHash=${encodeURIComponent(torrentHash)}`;
      } else {
        throw new Error('No fileId or URL available for subtitle');
      }

      console.log('📥 Fetching subtitle from:', downloadUrl);
      const response = await fetch(downloadUrl, {
        headers: { Accept: 'text/vtt, text/plain, */*' }
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const subtitleContent = await response.text();
      console.log('📝 Subtitle content received, length:', subtitleContent.length);

      if (!subtitleContent || subtitleContent.length < 10) {
        throw new Error('Invalid subtitle content received');
      }

      // ✅ Ensure valid VTT format
      let vttContent = subtitleContent;
      if (!subtitleContent.startsWith('WEBVTT')) {
        console.log('⚠️ Content is not VTT format, adding header');
        vttContent = 'WEBVTT\n\n' + subtitleContent.replace(/,/g, '.'); // convert commas to periods
      }

      // ✅ Create Blob URL
      const blob = new Blob([vttContent], { type: 'text/vtt; charset=utf-8' });
      const subtitleUrl = URL.createObjectURL(blob);
      console.log('📝 Blob URL created:', subtitleUrl);

      const video = videoRef.current;
      if (!video) throw new Error('Video element not found');

      // ✅ Remove old subtitle tracks and revoke blob URLs
      const oldTracks = video.querySelectorAll('track');
      oldTracks.forEach(t => {
        if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src);
        t.remove();
      });

      // ✅ Create and add track
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = `${subtitle.language} (${subtitle.source})`;
      track.srclang = subtitle.languageCode || subtitle.language.toLowerCase().substring(0, 2);
      track.src = subtitleUrl;
      track.default = true;
      video.appendChild(track);

      // ✅ Ensure subtitles show up after the track loads
      track.addEventListener('load', () => {
        const tracks = video.textTracks;
        if (tracks.length > 0) {
          [...tracks].forEach(t => (t.mode = 'hidden'));
          tracks[tracks.length - 1].mode = 'showing';
          console.log('✅ Subtitles are now showing');
        }
      });

      setCurrentSubtitle({
        ...subtitle,
        url: subtitleUrl,
        isOnline: true
      });
      setShowSubtitleMenu(false);

    } catch (error) {
      console.error('❌ Error loading online subtitle:', error);
      alert(`Failed to load subtitle: ${error.message}`);
    }
  }, []);

  // 3. Hook to search for online subtitles
  const searchOnlineSubtitles = async (searchQuery) => {
    // Prevent searching if no title exists or already searching
    if (!searchQuery || isSearchingOnline) return;

    setIsSearchingOnline(true);
    setOnlineSubtitles([]); // Clear previous results

    try {
      console.log(`🔍 Searching for subtitles: ${searchQuery}`);

      const response = await fetch(`${config.apiBaseUrl}/api/subtitles/search?query=${encodeURIComponent(searchQuery)}`);

      if (!response.ok) throw new Error('Search failed');

      const results = await response.json();

      console.log(`✅ Found ${results.length} subtitles`);
      setOnlineSubtitles(results);

    } catch (error) {
      console.error('❌ Error searching subtitles:', error);
      alert('Failed to search for subtitles. Please check your connection or try again later.');
    } finally {
      setIsSearchingOnline(false);
    }
  };

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
    lastSeekTimeRef.current = Date.now(); // Mark seek for buffering diagnostics
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
      lastSeekTimeRef.current = Date.now(); // Mark seek for buffering diagnostics
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
    lastSeekTimeRef.current = Date.now(); // Mark seek for buffering diagnostics
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

  const toggleFullscreen = async () => {
    const container = videoRef.current.parentElement;
    if (!document.fullscreenElement) {
      try {
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        }
      } catch (e) {
        console.error('Fullscreen request error:', e);
      }

      try {
        if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
          await window.screen.orientation.lock('landscape');
        }
      } catch (e) {
        console.log('Orientation lock error:', e);
      }
      setIsFullscreen(true);
    } else {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } catch (e) {
        console.error('Fullscreen exit error:', e);
      }

      try {
        if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
          window.screen.orientation.unlock();
        }
      } catch (e) {
        console.log('Orientation unlock error:', e);
      }
      setIsFullscreen(false);
    }
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
          if (isPlaying && !isScrubbing && !showSubtitleMenu) setShowControls(false);
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
        {subtitleFiles.map((sub, idx) => {
          // 1. Conditionally build the URL based on the backend logic we set up
          const subtitleUrl = sub.isLocalSubtitle
            ? `${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${encodeURIComponent(sub.fileName)}/subtitle?isLocal=true`
            : `${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${sub.index}/subtitle`;

          return (
            <track
              // Use fileName as a fallback key just in case local subs share an index
              key={sub.index || sub.fileName}
              kind="subtitles"
              src={subtitleUrl}
              srcLang="en"
              label={sub.name}
              default={idx === 0}
            />
          );
        })}

      </video>

      <div className={`controls-gradient-top ${showControls ? 'visible' : ''}`} />

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
        <div className={`simple-center-loader text-${bufferingReason?.color || 'warning'}`}>
          <Loader2 size={48} className="spinning" />
        </div>
      )}

      {isLoading && (
        <div className={`minimal-buffering-indicator ${showControls ? 'above-controls' : 'bottom'}`}>
          {(!bufferingReason || bufferingReason.icon === 'loader') && <Loader2 size={16} className={`spinning text-${bufferingReason?.color || 'warning'}`} />}
          {bufferingReason?.icon === 'download' && <Download size={16} className={`text-${bufferingReason.color}`} />}
          {bufferingReason?.icon === 'wifi_off' && <WifiOff size={16} className={`text-${bufferingReason.color}`} />}
          {bufferingReason && (
            <span className="minimal-buffering-text">{bufferingReason.label}</span>
          )}
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
              <div className="progress-torrent" style={{ width: `${torrentStats.progress * 100}%` }} />
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

                    {/* Loop through all files and create a button for each one */}
                    {subtitleFiles.length > 0 && subtitleFiles.map((sub, idx) => (
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

                    <div className="subtitle-section">
                      <span>Online Search</span>

                      {/* Search input field */}
                      <div className="subtitle-search-input">
                        <input
                          type="text"
                          placeholder="Type to search subtitles..."
                          value={subtitleSearchQuery}
                          onChange={(e) => setSubtitleSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && subtitleSearchQuery.trim()) {
                              searchOnlineSubtitles(subtitleSearchQuery.trim());
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (subtitleSearchQuery.trim()) {
                              searchOnlineSubtitles(subtitleSearchQuery.trim());
                            }
                          }}
                          className="search-button"
                          disabled={isSearchingOnline || !subtitleSearchQuery.trim()}
                        >
                          {isSearchingOnline ? (
                            <Loader2 size={16} className="spinning" />
                          ) : (
                            <Search size={16} />
                          )}
                        </button>
                      </div>

                      {/* Online subtitle results */}
                      {onlineSubtitles.map((subtitle, index) => (
                        <button
                          key={`online-${index}`}
                          onClick={() => loadOnlineSubtitle(subtitle)}
                          className={`subtitle-option ${currentSubtitle?.url === subtitle.url ? 'active' : ''}`}
                          title={`${subtitle.language} (${subtitle.source})`}
                        >
                          <span className="online-subtitle-text">
                            <Globe size={16} />

                            {subtitle.language} ({subtitle.filename})
                          </span>
                        </button>
                      ))}
                    </div>

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



                  </div>
                </div>
              )}
            </div>


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

                  <div className="settings-section1 vlc-section">
                    <span>External Player</span>
                    <button
                      type="button"
                      className="settings-option"
                      onClick={() => {
                        const url = `${config.apiBaseUrl}/api/torrents/${torrentHash}/files/${fileIndex}/playlist`;
                        const element = document.createElement('a');
                        element.href = url;
                        element.download = 'playlist.m3u';
                        document.body.appendChild(element);
                        element.click();
                        document.body.removeChild(element);
                      }}
                    >
                      <img src={VLC_ICON} alt="VLC Icon" style={{ width: '20px', height: '20px' }} />
                    </button>
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
      </div >

      {/* Resume Dialog */}
      {
        showResumeDialog && resumeData && (
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
        )
      }
    </div >
  );
};

export default VideoPlayer;