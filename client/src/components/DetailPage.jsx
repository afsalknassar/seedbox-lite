import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { config } from "../config/environment";
import torrentHistoryService from "../services/torrentHistoryService";
import "../assets/styles/DetailPage.css";

// ─── CONFIG ──────────────────────────────────────────────────
const PROXY = "https://rich-clownfish-18.epaperhubdaily.deno.net";
const API_KEY = "tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1";

const apiFetch = async (path, params = {}) => {
    const url = new URL(`${PROXY}${path}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
};

// ─── HELPERS ─────────────────────────────────────────────────
const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const Spinner = () => (
    <div style={{ display: "flex", justifyContent: "center", padding: "4rem" }}>
        <div style={{ width: "50px", height: "50px", border: "3px solid rgba(6, 182, 212, 0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 1s ease-in-out infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
);

// ─── COMPONENT ───────────────────────────────────────────────
export default function DetailPage({ item, onBack }) {
    const navigate = useNavigate();
    const [details, setDetails] = useState(null);
    const [torrents, setTorrents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [openGroup, setOpenGroup] = useState(null);
    const [streamLoading, setStreamLoading] = useState(null);
    const [hasAutoOpened, setHasAutoOpened] = useState(false);
    
    // New states for filters, dropdowns, and expanding
    const [activeFilter, setActiveFilter] = useState("seeders");
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [expandedTorrentId, setExpandedTorrentId] = useState(null);

    const isCollection = item.movieCount !== undefined || item.partCount !== undefined;
    const title = item.title || item.name || "Details";
    const poster = item.posterUrl;
    const backdrop = item.backdropUrl || item.posterUrl;
    const rImdb = item.ratingImdb;
    const rTmdb = item.ratingTmdb;

    const loadData = useCallback(async () => {
        setLoading(true);
        setHasAutoOpened(false);
        try {
            if (isCollection) {
                const data = await apiFetch(`/api/v1/collections/${item.id}`);
                setDetails(data);
            } else {
                const data = await apiFetch("/api/v1/search", { q: title, availability: "all" });
                const exactMatch = data.results?.find((r) => r.id === item.id || r.title === title) || data.results?.[0];
                setDetails(exactMatch || item);
                setTorrents(exactMatch?.torrents || []);
            }
        } catch (err) {
            setError("Failed to load details.");
        }
        setLoading(false);
    }, [item, isCollection, title]);

    useEffect(() => { loadData(); }, [loadData]);

    // Group torrents by quality (e.g., '2160p', '1080p')
    const groupedTorrents = useMemo(() => {
        if (!torrents.length) return {};
        
        let filtered = torrents;
        if (verifiedOnly) {
            filtered = filtered.filter(t => t.threatLevel === 'clean' || t.seeders > 50);
        }

        const groups = filtered.reduce((acc, t) => {
            const q = t.quality || "Unknown";
            if (!acc[q]) acc[q] = [];
            acc[q].push(t);
            return acc;
        }, {});

        // Sort torrents inside each group based on activeFilter
        Object.keys(groups).forEach(k => {
            groups[k].sort((a, b) => {
                if (activeFilter === "size") {
                    return (b.sizeBytes || 0) - (a.sizeBytes || 0);
                } else {
                    // Default to seeders (even if "quality" is selected, inside group we sort by seeders)
                    return (b.seeders || 0) - (a.seeders || 0);
                }
            });
        });

        return groups;
    }, [torrents, activeFilter, verifiedOnly]);

    // Set default open accordion to highest quality available on load
    useEffect(() => {
        const keys = Object.keys(groupedTorrents);
        if (keys.length > 0 && !hasAutoOpened) {
            // Prioritize 2160p, then 1080p, etc.
            const best = keys.includes("2160p") ? "2160p" : keys.includes("1080p") ? "1080p" : keys[0];
            setOpenGroup(best);
            setHasAutoOpened(true);
        }
    }, [groupedTorrents, hasAutoOpened]);

    const handleStream = async (torrent) => {
        const torrentId = torrent.magnetUrl || torrent.infoHash;
        setStreamLoading(torrentId);
        try {
            const response = await fetch(config.api.torrents, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ torrentId })
            });

            const data = await response.json();

            if (response.ok) {
                if (data.isBackground) {
                    torrentHistoryService.addTorrent({
                        infoHash: data.infoHash,
                        name: data.name || title,
                        source: 'magnet',
                        originalInput: torrentId,
                        size: 0
                    });
                    alert("This magnet link is a bit slow. We added it to your Background Queue to keep searching!");
                    setStreamLoading(null);
                    return;
                }

                const existingInHistory = torrentHistoryService.getTorrentByInfoHash(data.infoHash);
                if (existingInHistory) {
                    torrentHistoryService.updateLastAccessed(data.infoHash);
                } else {
                    torrentHistoryService.addTorrent({
                        infoHash: data.infoHash,
                        name: data.name || title,
                        source: 'magnet',
                        originalInput: torrentId,
                        size: data.size || 0
                    });
                }
                navigate(`/torrent/${data.infoHash}`);
            } else {
                alert('Failed to add torrent: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            alert('Error adding torrent: ' + error.message);
        } finally {
            setStreamLoading(null);
        }
    };

    return (
        <div className="dp-container">

            {/* ─── BACKGROUND HERO IMAGE ─── */}
            {backdrop && (
                <>
                    <div className="dp-hero-bg"
                        style={{ backgroundImage: `url(${backdrop.startsWith("http") ? backdrop : `${PROXY}${backdrop}`})` }}
                    />
                    <div className="dp-hero-gradient"></div>
                </>
            )}

            {/* ─── TOP NAV (BACK BUTTON) ─── */}
            <div className="dp-top-nav">
                <button onClick={onBack} className="dp-back-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                    Back to Browse
                </button>
            </div>

            {loading ? <Spinner /> : error ? <div style={{ color: "#ef4444", padding: "2rem", textAlign: "center" }}>{error}</div> : (
                <>
                    {/* ─── HERO CONTENT ─── */}
                    <div className="dp-hero">
                        <div className="dp-poster-wrap">
                            {rImdb && (
                                <div className="dp-poster-rating glass-badge">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#f5c518"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
                                    {rImdb}
                                </div>
                            )}
                            {poster ? <img src={poster} alt={title} className="dp-poster" /> : <div className="dp-poster-placeholder" />}
                        </div>

                        <div className="dp-info">
                            <h1 className="dp-title">{title} <span className="dp-year">({item.year || details?.year})</span></h1>

                            {details?.partOf && (
                                <div className="dp-collection-link">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /></svg>
                                    Part of: {details.partOf}
                                </div>
                            )}

                            <div className="dp-badge-row">
                                {details?.contentType && <span className="dp-badge type-badge">{details.contentType}</span>}
                                {rImdb && <span className="dp-badge imdb">IMDb {rImdb}</span>}
                                {rTmdb && <span className="dp-badge tmdb">TMDB {rTmdb}</span>}

                                {details?.genres?.map(g => (
                                    <span key={g} className="dp-badge genre">{g}</span>
                                ))}
                            </div>

                            <p className="dp-overview">{details?.overview || item.overview || "No overview available."}</p>

                            <div className="dp-actions">
                                <button className="dp-btn dp-btn-primary">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="m5 3 14 9-14 9V3z" /></svg>
                                    Smart Torrent
                                </button>
                                <button className="dp-btn dp-btn-outline">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                                    Add to list
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ─── TORRENTS SECTION ─── */}
                    {/* ─── TORRENTS SECTION ─── */}
                    {!isCollection && (
                        <div className="dp-content">
                            {/* Filters Row (Visually matching the image) */}
                            <div className="dp-list-top">
                                <div className="dp-list-title-row">
                                    <h2>Torrents ({torrents.length})</h2>
                                    <span className="dp-showing">— showing {torrents.length}</span>
                                </div>

                                <div className="dp-filters-row">
                                    <button className={`dp-f-btn ${activeFilter === 'quality' ? 'active' : ''}`} onClick={() => setActiveFilter('quality')}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 15l5 5 5-5M7 9l5-5 5 5" /></svg>
                                        Quality
                                    </button>
                                    <button className={`dp-f-btn ${activeFilter === 'seeders' ? 'active' : ''}`} onClick={() => setActiveFilter('seeders')}>Seeders</button>
                                    <button className={`dp-f-btn ${activeFilter === 'size' ? 'active' : ''}`} onClick={() => setActiveFilter('size')}>Size</button>
                                    <button className={`dp-f-btn verified ${verifiedOnly ? 'active' : ''}`} style={verifiedOnly ? { backgroundColor: 'rgba(234, 179, 8, 0.2)' } : {}} onClick={() => setVerifiedOnly(!verifiedOnly)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
                                        TrueSpec Verified
                                    </button>
                                    <button className="dp-f-link" onClick={() => { setActiveFilter('seeders'); setVerifiedOnly(false); }}>Clear filters</button>
                                    
                                </div>
                            </div>

                            {Object.keys(groupedTorrents).length === 0 ? (
                                <div className="dp-no-torrents">No torrents found for this title.</div>
                            ) : (
                                <div className="dp-torrents-container">
                                    {Object.entries(groupedTorrents).map(([quality, items]) => {
                                        const isOpen = openGroup === quality;
                                        const totalSeeders = items.reduce((acc, curr) => acc + (curr.seeders || 0), 0);
                                        // Get largest size in group for the header
                                        const maxSize = items.reduce((max, curr) => curr.sizeBytes > max ? curr.sizeBytes : max, 0);

                                        return (
                                            <div key={quality} className={`dp-t-group ${isOpen ? 'open' : ''}`}>
                                                <div className="dp-t-header" onClick={() => setOpenGroup(isOpen ? null : quality)}>
                                                    <div className="dp-th-left">
                                                        <span className="dp-th-title">
                                                            {quality === "2160p" ? "4K / UHD" : quality}
                                                        </span>
                                                        <span className="dp-th-count">({items.length} torrents)</span>
                                                    </div>

                                                    <div className="dp-th-right">
                                                        <span className="dp-th-seeders">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                                                            {totalSeeders} seeders
                                                        </span>
                                                        <span className="dp-th-size">{formatBytes(maxSize)}</span>
                                                        <div className={`dp-t-chevron ${isOpen ? 'open' : ''}`}>
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                                                        </div>
                                                    </div>
                                                </div>

                                                {isOpen && (
                                                    <div className="dp-t-list">
                                                        {items.map((t, idx) => {
                                                            const tId = t.magnetUrl || t.infoHash;
                                                            const isStreaming = streamLoading === tId;
                                                            const isExpanded = expandedTorrentId === tId;

                                                            return (
                                                                <div key={tId || idx} className={`dp-t-row ${isExpanded ? 'expanded' : ''}`} onClick={() => setExpandedTorrentId(isExpanded ? null : tId)} style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch' }}>
                                                                    <div className="dp-t-row-main">
                                                                        <div className="dp-t-info">
                                                                            {/* Verified Shield */}
                                                                            {t.threatLevel === 'clean' || t.seeders > 50 ? (
                                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
                                                                            ) : (
                                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                                                                            )}

                                                                            {/* Tech Badges (first 3 only) */}
                                                                            <span className="dp-badge-mini quality">{t.quality?.toUpperCase() || 'UNKNOWN'}</span>
                                                                            <span className="dp-badge-mini">{t.codec?.toUpperCase() || t.videoInfo?.codec?.toUpperCase() || 'HEVC'}</span>
                                                                            
                                                                            <span className="dp-badge-mini audio">{t.audioCodec?.toUpperCase() || (t.audioTracks?.length > 0 ? t.audioTracks[0].codec?.toUpperCase() : 'AC3')}</span>
                                                                        </div>

                                                                        <div className="dp-t-controls">

                                                                    {/* Stats Row */}
                                                                    <div className="dp-tr-stats">
                                                                        <span className="dp-tr-size">{formatBytes(t.sizeBytes)}</span>
                                                                        <span className="dp-tr-seed">↑ {t.seeders}</span>
                                                                        <span className="dp-tr-leech">↓ {t.leechers}</span>
                                                                        <span className="dp-tr-source">{t.source || t.releaseGroup || 'solidtorrents'}</span>
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                                                                        <span className="dp-tr-score">Score: {t.score || 66}</span>
                                                                    </div>

                                                                    {/* Actions */}
                                                                    <div className="dp-magnet-action" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <button className="dp-icon-btn" title="Comments/Info" onClick={(e) => { e.stopPropagation(); setExpandedTorrentId(isExpanded ? null : tId); }}>
                                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                                                        </button>

                                                                        <div className="dp-btn-group" style={{ display: 'flex', alignItems: 'center' }}>
                                                                            <button
                                                                                className="dp-btn-magnet"
                                                                                onClick={(e) => { e.stopPropagation(); handleStream(t); }}
                                                                                disabled={isStreaming}
                                                                                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: '1px solid rgba(255,255,255,0.1)' }}
                                                                            >
                                                                                {isStreaming ? (
                                                                                    <div className="dp-mini-spinner" style={{ width: '14px', height: '14px' }} />
                                                                                ) : (
                                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                                                                )}
                                                                                <span className="dp-btn-text">Stream</span>
                                                                            </button>
                                                                            <button 
                                                                                className="dp-btn-magnet" 
                                                                                title="Copy Magnet Link"
                                                                                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '6px 10px' }}
                                                                                onClick={(e) => { 
                                                                                    e.stopPropagation(); 
                                                                                    navigator.clipboard.writeText(t.magnetUrl || t.infoHash);
                                                                                    alert("Magnet link copied to clipboard!"); 
                                                                                }}
                                                                            >
                                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    </div>
                                                                    </div>
                                                                    
                                                                    {/* Expandable Details */}
                                                                    {isExpanded && (
                                                                        <div className="dp-t-row-details" style={{ 
                                                                            marginTop: '12px', 
                                                                            paddingTop: '12px', 
                                                                            borderTop: '1px solid rgba(255,255,255,0.05)',
                                                                            display: 'flex',
                                                                            gap: '32px',
                                                                            fontSize: '0.85rem',
                                                                            color: '#94a3b8',
                                                                            cursor: 'default'
                                                                        }} onClick={(e) => e.stopPropagation()}>
                                                                            {/* Audio Info */}
                                                                            <div className="dp-td-section" style={{ flex: 1 }}>
                                                                                <h4 style={{ color: '#cbd5e1', marginBottom: '8px', fontSize: '0.85rem', fontWeight: '600' }}>Audio Tracks</h4>
                                                                                {t.audioTracks && t.audioTracks.length > 0 ? (
                                                                                    <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                        {t.audioTracks.map((track, i) => (
                                                                                            <li key={i}>{track.lang || track.language || 'Unknown Language'} - {track.codec || 'Unknown Codec'} ({track.channels || '2.0'}) {track.title ? `- ${track.title}` : ''}</li>
                                                                                        ))}
                                                                                    </ul>
                                                                                ) : (
                                                                                    <p style={{ margin: 0 }}>{t.audioCodec || 'Unknown audio codec'}</p>
                                                                                )}
                                                                            </div>
                                                                            
                                                                            {/* Subtitles Info */}
                                                                            <div className="dp-td-section" style={{ flex: 1 }}>
                                                                                <h4 style={{ color: '#cbd5e1', marginBottom: '8px', fontSize: '0.85rem', fontWeight: '600' }}>Subtitles</h4>
                                                                                {t.subtitleTracks && t.subtitleTracks.length > 0 ? (
                                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                                        {t.subtitleTracks.map((sub, i) => (
                                                                                            <span key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                                                                {sub.lang || sub.language || 'Unknown'}{sub.title ? ` (${sub.title})` : ''}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : t.subtitles && t.subtitles.length > 0 ? (
                                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                                        {t.subtitles.map((sub, i) => (
                                                                                            <span key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                                                                {typeof sub === 'string' ? sub : (sub.lang || sub.language || 'Unknown')}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : t.subtitleLanguages && t.subtitleLanguages.length > 0 ? (
                                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                                        {t.subtitleLanguages.map((lang, i) => (
                                                                                            <span key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                                                                {lang}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : (
                                                                                    <p style={{ margin: 0 }}>No subtitles specified</p>
                                                                                )}
                                                                            </div>
                                                                            
                                                                            {/* Video Info */}
                                                                            <div className="dp-td-section" style={{ flex: 1 }}>
                                                                                <h4 style={{ color: '#cbd5e1', marginBottom: '8px', fontSize: '0.85rem', fontWeight: '600' }}>Video</h4>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                    <div><span style={{ color: '#64748b' }}>Codec:</span> {t.videoInfo?.codec || t.codec || 'Unknown'}</div>
                                                                                    <div><span style={{ color: '#64748b' }}>Bit Depth:</span> {t.videoInfo?.bitDepth || 'Unknown'}</div>
                                                                                    <div><span style={{ color: '#64748b' }}>Resolution:</span> {t.resolution || t.quality || 'Unknown'}</div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
