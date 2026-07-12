import React, { useState, useEffect, useCallback } from 'react';
import {
  Tv2, Copy, CheckCheck, RefreshCw, Wifi, WifiOff, Play,
  ChevronRight, Download, ExternalLink, Zap, Shield, Globe,
  HardDrive, Layers, ArrowRight
} from 'lucide-react';
import { config } from '../config/environment';
import '../assets/styles/StremioPage.css';

// ─── Stremio Logo SVG ──────────────────────────────────────────────────────
const StremioLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="#7b5ea7" />
    <path d="M50 20C33.43 20 20 33.43 20 50s13.43 30 30 30 30-13.43 30-30S66.57 20 50 20zm12 32.5l-18 10a2.5 2.5 0 01-3.75-2.16V39.66a2.5 2.5 0 013.75-2.16l18 10a2.5 2.5 0 010 4.32z" fill="white" />
  </svg>
);

// ─── Torrent Card ───────────────────────────────────────────────────────────
const TorrentCard = ({ torrent }) => {
  const progress = Math.round((torrent.progress || 0) * 100);
  const videoCount = torrent.videoFileCount || 0;
  const isStreamable = videoCount > 0;

  return (
    <div className={`stremio-torrent-card ${isStreamable ? 'streamable' : 'no-video'}`}>
      <div className="stremio-torrent-status">
        {isStreamable
          ? <span className="status-dot green" />
          : <span className="status-dot grey" />}
        <span className="status-label">
          {isStreamable ? `${videoCount} video file${videoCount !== 1 ? 's' : ''}` : 'No video files'}
        </span>
      </div>

      <p className="stremio-torrent-name" title={torrent.name}>{torrent.name}</p>

      <div className="stremio-torrent-meta">
        <span>{torrent.sizeFormatted}</span>
        <span className="dot">•</span>
        <span>{torrent.numPeers || 0} peers</span>
      </div>

      <div className="stremio-progress-bar">
        <div className="stremio-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="stremio-progress-label">{progress}% downloaded</p>
    </div>
  );
};

// ─── Install Step ───────────────────────────────────────────────────────────
const InstallStep = ({ number, title, description, children }) => (
  <div className="install-step">
    <div className="install-step-number">{number}</div>
    <div className="install-step-content">
      <h4>{title}</h4>
      <p>{description}</p>
      {children}
    </div>
  </div>
);

// ─── Copy Button ────────────────────────────────────────────────────────────
const CopyButton = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
      {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────
const StremioPage = () => {
  const [addonInfo, setAddonInfo] = useState(null);
  const [torrents, setTorrents]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const VIDEO_EXTS = new Set(['mkv','mp4','avi','mov','wmv','flv','webm','m4v','mpg','mpeg','ts','vob','3gp','ogv']);
  const isVideo = (name) => VIDEO_EXTS.has((name.split('.').pop() || '').toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [infoRes, torrentsRes] = await Promise.all([
        fetch(config.getApiUrl('/stremio/info')),
        fetch(config.api.torrents)
      ]);

      if (!infoRes.ok) throw new Error('Could not fetch addon info');
      const info    = await infoRes.json();
      const torData = await torrentsRes.json().catch(() => ({ torrents: [] }));

      setAddonInfo(info);
      setTorrents(
        (torData.torrents || []).map(t => ({
          ...t,
          sizeFormatted:  formatBytes(t.size || t.length || 0),
          videoFileCount: (t.files || []).filter(f => isVideo(f.name || '')).length
        }))
      );
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const streamableTorrents = torrents.filter(t => t.videoFileCount > 0);
  const totalTorrents      = torrents.length;

  return (
    <div className="stremio-page">
      {/* ── Hero Header ── */}
      <div className="stremio-hero">
        <div className="stremio-hero-bg" />
        <div className="stremio-hero-content">
          <div className="stremio-hero-badge">
            <Zap size={12} />
            <span>Personal Addon</span>
          </div>
          <div className="stremio-hero-title">
            <StremioLogo size={44} />
            <div>
              <h1>Stremio Integration</h1>
              <p>Stream your seedbox torrents directly inside Stremio</p>
            </div>
          </div>

          <div className="stremio-stats-row">
            <div className="stremio-stat">
              <Layers size={16} />
              <span><strong>{totalTorrents}</strong> torrents</span>
            </div>
            <div className="stremio-stat">
              <Play size={16} />
              <span><strong>{streamableTorrents.length}</strong> streamable</span>
            </div>
            <div className="stremio-stat">
              <Shield size={16} />
              <span>Token-secured</span>
            </div>
          </div>
        </div>
      </div>

      <div className="stremio-body">
        {/* ── Left Column ── */}
        <div className="stremio-left">

          {/* Addon URL Card */}
          <div className="stremio-card addon-url-card">
            <div className="card-header">
              <Globe size={18} />
              <h3>Addon Install URL</h3>
            </div>

            {loading && !addonInfo ? (
              <div className="stremio-loading-row">
                <RefreshCw size={16} className="spin" />
                <span>Loading addon info…</span>
              </div>
            ) : error ? (
              <div className="stremio-error">
                <WifiOff size={16} />
                <span>Server not reachable: {error}</span>
              </div>
            ) : addonInfo ? (
              <>
                <div className="url-block">
                  <label>Manifest URL</label>
                  <div className="url-row">
                    <code className="url-code">{addonInfo.manifestUrl}</code>
                    <CopyButton text={addonInfo.manifestUrl} />
                  </div>
                  <p className="url-hint">Use this in Stremio → Add-ons → ⚙ Add via URL</p>
                </div>

                <a
                  href={addonInfo.installUrl}
                  className="install-btn"
                  target="_blank"
                  rel="noreferrer"
                >
                  <StremioLogo size={18} />
                  <span>Install in Stremio</span>
                  <ArrowRight size={16} />
                </a>

                <div className="token-info">
                  <Shield size={13} />
                  <span>Your URL is protected by a private token derived from your access password.</span>
                </div>
              </>
            ) : null}
          </div>

          {/* How-to Card */}
          <div className="stremio-card howto-card">
            <div className="card-header">
              <Tv2 size={18} />
              <h3>How to Connect</h3>
            </div>

            <div className="install-steps">
              <InstallStep
                number="1"
                title="Copy the Manifest URL"
                description="Click the copy button next to the manifest URL above."
              />
              <InstallStep
                number="2"
                title="Open Stremio"
                description='Go to Add-ons (🧩) → click the 🔧 icon → paste the URL and hit "Add".'
              />
              <InstallStep
                number="3"
                title="Browse My Seedbox"
                description='A new "My Seedbox — Active Torrents" catalog will appear. Click any torrent to see its video files and stream them.'
              >
                <div className="step-note">
                  <Wifi size={13} />
                  <span>Both your device and this server must be on the same network, or the server must be port-forwarded.</span>
                </div>
              </InstallStep>
              <InstallStep
                number="4"
                title="Set Public URL (optional)"
                description="For remote access, add STREMIO_PUBLIC_URL=https://your-domain.com to your server .env file so Stremio can reach the stream URLs from anywhere."
              />
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className="stremio-right">
          <div className="stremio-card torrents-card">
            <div className="card-header">
              <HardDrive size={18} />
              <h3>Active Torrents</h3>
              <button className="refresh-btn" onClick={load} title="Refresh">
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
              </button>
            </div>

            {loading && torrents.length === 0 ? (
              <div className="stremio-loading-row">
                <RefreshCw size={16} className="spin" />
                <span>Loading torrents…</span>
              </div>
            ) : torrents.length === 0 ? (
              <div className="stremio-empty">
                <Download size={32} />
                <p>No active torrents</p>
                <span>Add torrents from the Home page to see them here and in Stremio.</span>
              </div>
            ) : (
              <div className="stremio-torrents-grid">
                {torrents.map(t => (
                  <TorrentCard key={t.infoHash || t.name} torrent={t} />
                ))}
              </div>
            )}

            {torrents.length > 0 && (
              <div className="last-refresh">
                Last updated: {new Date(lastRefresh).toLocaleTimeString()}
              </div>
            )}
          </div>

          <div className="stremio-card info-card">
            <div className="card-header">
              <Zap size={18} />
              <h3>How Streaming Works</h3>
            </div>
            <div className="info-flow">
              <div className="flow-step">
                <div className="flow-icon"><StremioLogo size={20} /></div>
                <span>Stremio App</span>
              </div>
              <ChevronRight size={16} className="flow-arrow" />
              <div className="flow-step">
                <div className="flow-icon"><Globe size={20} /></div>
                <span>Addon API</span>
              </div>
              <ChevronRight size={16} className="flow-arrow" />
              <div className="flow-step">
                <div className="flow-icon"><HardDrive size={20} /></div>
                <span>WebTorrent</span>
              </div>
              <ChevronRight size={16} className="flow-arrow" />
              <div className="flow-step">
                <div className="flow-icon"><Play size={20} /></div>
                <span>HTTP Stream</span>
              </div>
            </div>
            <p className="info-desc">
              Stremio queries your addon for a list of streams. Your seedbox returns
              direct HTTP URLs that point to its own WebTorrent streaming engine —
              the same one your browser video player uses. No P2P traffic leaves
              the server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StremioPage;
