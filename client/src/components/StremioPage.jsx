import React, { useState, useEffect, useCallback } from 'react';
import { Copy, CheckCheck, RefreshCw, WifiOff, ArrowRight, Shield } from 'lucide-react';
import { config } from '../config/environment';
import '../assets/styles/StremioPage.css';

// ─── Stremio Logo SVG ──────────────────────────────────────────────────────
const StremioLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="#7b5ea7" />
    <path d="M50 20C33.43 20 20 33.43 20 50s13.43 30 30 30 30-13.43 30-30S66.57 20 50 20zm12 32.5l-18 10a2.5 2.5 0 01-3.75-2.16V39.66a2.5 2.5 0 013.75-2.16l18 10a2.5 2.5 0 010 4.32z" fill="white" />
  </svg>
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
    <button className={`stremio-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
      {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────
const StremioPage = () => {
  const [addonInfo, setAddonInfo] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const infoRes = await fetch(config.getApiUrl('/stremio/info'));
      if (!infoRes.ok) throw new Error('Could not fetch addon info');
      const info = await infoRes.json();
      setAddonInfo(info);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stremio-page-modern">
      <div className="stremio-glass-card">
        <div className="stremio-card-header">
          <StremioLogo size={60} />
          <h1>Stremio Integration</h1>
          <p>Stream your seedbox torrents directly inside Stremio in high quality.</p>
        </div>

        <div className="stremio-card-content">
          {loading && !addonInfo ? (
            <div className="stremio-loading-state">
              <RefreshCw size={24} className="spin" />
              <span>Generating secure addon link...</span>
            </div>
          ) : error ? (
            <div className="stremio-error-state">
              <WifiOff size={24} />
              <span>Server not reachable: {error}</span>
              <button onClick={load} className="retry-btn">Retry</button>
            </div>
          ) : addonInfo ? (
            <div className="stremio-install-section">
              <a
                href={addonInfo.installUrl}
                className="stremio-install-btn"
                target="_blank"
                rel="noreferrer"
              >
                <span>Add to Stremio</span>
                <ArrowRight size={20} />
              </a>

              <div className="stremio-divider">
                <span>OR COPY URL MANUALLY</span>
              </div>

              <div className="stremio-url-box">
                <code className="stremio-url-text">{addonInfo.manifestUrl}</code>
                <CopyButton text={addonInfo.manifestUrl} />
              </div>
              <p className="stremio-url-hint">Paste this URL in Stremio → Add-ons → ⚙ Add via URL</p>

              <div className="stremio-security-note">
                <Shield size={14} />
                <span>Your URL is protected by a private token derived from your access password.</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default StremioPage;
