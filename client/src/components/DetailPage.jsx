import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { config } from "../config/environment";
import torrentHistoryService from "../services/torrentHistoryService";
import "../assets/styles/DetailPage.css";
import "../assets/styles/HomePage.css"; // For modern-loader-overlay
import { ArrowLeft, Shield, ShieldOff, Play, Copy, ChevronDown, ChevronUp, Filter, Users, HardDrive, BadgeCheck, BadgeAlert } from 'lucide-react';

// ─── CONFIG ──────────────────────────────────────────────────
const PROXY = "https://rich-clownfish-18.epaperhubdaily.deno.net";
const API_KEY = "tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1";

const apiFetch = async (path, params = {}, options = {}) => {
    const url = new URL(`${PROXY}${path}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
        ...options,
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
};

// ─── HELPERS ─────────────────────────────────────────────────
const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "—";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const DetailSkeleton = () => (
    <div className="dp-skeleton-wrapper">
        <div className="dp-skeleton-hero">
            <div className="dp-skeleton-poster pulse" />
            <div className="dp-skeleton-meta">
                <div className="dp-skeleton-title pulse" />
                <div className="dp-skeleton-row pulse" style={{ width: '40%' }} />
                <div className="dp-skeleton-row pulse" style={{ width: '80%', marginTop: '1.5rem' }} />
                <div className="dp-skeleton-row pulse" style={{ width: '70%' }} />
                <div className="dp-skeleton-row pulse" style={{ width: '60%' }} />
                <div className="dp-skeleton-row pulse" style={{ width: '50%' }} />
            </div>
        </div>
        <div className="dp-skeleton-tabs">
            <div className="dp-skeleton-tab pulse" />
            <div className="dp-skeleton-tab pulse" />
            <div className="dp-skeleton-tab pulse" />
        </div>
        <div className="dp-skeleton-cards">
            {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="dp-skeleton-card pulse" />
            ))}
        </div>
    </div>
);

const qKey = (q) => {
    const valid = ["2160p", "1080p", "720p", "480p", "360p", "cam"];
    return valid.includes(q?.toLowerCase()) ? q.toLowerCase() : "other";
};

const QUALITY_ORDER = ["2160p", "1080p", "720p", "480p", "360p", "cam", "Other"];

const QUALITY_LABELS = {
    "2160p": "4K UHD",
    "1080p": "Full HD",
    "720p": "HD 720p",
    "480p": "SD 480p",
    "360p": "360p",
    "cam": "CAM",
    "Other": "Other",
};

// ─── FIREFOX COMPAT CHECK ─────────────────────────────────────
// Our server remuxes MKV→fMP4 (container fix), but Firefox still
// can't decode H.265/HEVC frames. H.264, AV1, VP9 all work fine.
const getFirefoxCompat = (codec) => {
    const c = (codec || '').toUpperCase();
    if (!c) return 'unknown';
    if (
        c.includes('X264') || c.includes('H264') || c.includes('H.264') ||
        c.includes('AVC')  || c.includes('AV1')  || c.includes('VP9')   ||
        c.includes('VP8')  || c.includes('MPEG-4')
    ) return 'yes';
    if (
        c.includes('X265') || c.includes('H265') || c.includes('H.265') ||
        c.includes('HEVC')
    ) return 'no';
    return 'unknown';
};

// ─── COMPONENT ───────────────────────────────────────────────
export default function DetailPage({ item: propItem, onBack }) {
    const navigate = useNavigate();
    const location = useLocation();

    const item = propItem || location.state?.item;
    const [history, setHistory] = useState([]);
    const currentItem = history.length > 0 ? history[history.length - 1] : item;

    if (!currentItem) {
        return <div className="dp-error-state">No item provided.</div>;
    }

    const [details, setDetails] = useState(null);
    const [torrents, setTorrents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeQuality, setActiveQuality] = useState(null);
    const [streamLoading, setStreamLoading] = useState(null);
    const [streamLoadingText, setStreamLoadingText] = useState("Syncing...");
    const [hasAutoSelected, setHasAutoSelected] = useState(false);
    const [activeFilter, setActiveFilter] = useState("seeders");
    const [sortOrder, setSortOrder] = useState("desc");
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [showFilters, setShowFilters] = useState(false);

    const isCollection = currentItem.movieCount !== undefined || currentItem.partCount !== undefined;
    const title = currentItem.title || currentItem.name || "Details";
    const poster = currentItem.posterUrl;
    const backdrop = currentItem.backdropUrl || currentItem.posterUrl;
    const rImdb = currentItem.ratingImdb;
    const rTmdb = currentItem.ratingTmdb;

    const handleBack = () => {
        if (history.length > 0) {
            setHistory(h => h.slice(0, -1));
        } else if (onBack) {
            onBack();
        } else {
            navigate(-1);
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setHasAutoSelected(false);
        try {
            if (isCollection) {
                const data = await apiFetch(`/api/v1/collections/${currentItem.id}`);
                setDetails(data);
            } else {
                const data = await apiFetch("/api/v1/search", { q: title, availability: "all" });
                const matches = (data.results || []).filter((r) => r.id === currentItem.id || r.title === title);
                if (matches.length === 0 && data.results?.[0]) matches.push(data.results[0]);
                const allTorrents = [];
                matches.forEach(m => { if (m.torrents) allTorrents.push(...m.torrents); });
                const exactMatch = matches[0] || currentItem;
                setDetails(exactMatch);
                setTorrents(allTorrents);
            }
        } catch (err) {
            setError("Failed to load details.");
        }
        setLoading(false);
    }, [currentItem?.id, isCollection, title]);

    useEffect(() => { loadData(); }, [loadData]);

    const groupedTorrents = useMemo(() => {
        if (!torrents.length) return {};
        let filtered = verifiedOnly
            ? torrents.filter(t => t.threatLevel === "clean" || t.seeders > 50)
            : torrents;
        const groups = filtered.reduce((acc, t) => {
            let q = t.quality || "Other";
            const key = qKey(q);
            q = key === "other" ? "Other" : key;
            if (!acc[q]) acc[q] = [];
            acc[q].push(t);
            return acc;
        }, {});
        Object.keys(groups).forEach(k => {
            groups[k].sort((a, b) => {
                const diff = activeFilter === "size"
                    ? (b.sizeBytes || 0) - (a.sizeBytes || 0)
                    : (b.seeders || 0) - (a.seeders || 0);
                return sortOrder === "asc" ? -diff : diff;
            });
        });
        return groups;
    }, [torrents, activeFilter, sortOrder, verifiedOnly]);

    const sortedQualities = useMemo(() =>
        Object.keys(groupedTorrents).sort((a, b) => {
            const ia = QUALITY_ORDER.indexOf(a), ib = QUALITY_ORDER.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        }),
        [groupedTorrents]
    );

    useEffect(() => {
        if (sortedQualities.length > 0 && !hasAutoSelected) {
            setActiveQuality(sortedQualities[0]);
            setHasAutoSelected(true);
        }
    }, [sortedQualities, hasAutoSelected]);

    useEffect(() => {
        let interval;
        if (streamLoading) {
            const messages = ["Connecting to swarm...", "Finding peers...", "Downloading metadata...", "Resolving files...", "Almost ready..."];
            let step = 0;
            setStreamLoadingText(messages[0]);
            interval = setInterval(() => {
                step++;
                if (step < messages.length) setStreamLoadingText(messages[step]);
            }, 3500);
        }
        return () => clearInterval(interval);
    }, [streamLoading]);

    const handleStream = async (torrent) => {
        const torrentId = torrent.magnetUrl || torrent.infoHash;
        
        const tmdbData = {
            Title: title,
            Year: currentItem?.year || currentItem?.first_air_date?.substring(0, 4) || currentItem?.release_date?.substring(0, 4) || null,
            imdbRating: currentItem?.rating || currentItem?.vote_average || 0,
            imdbVotes: currentItem?.vote_count || 0,
            Plot: currentItem?.plot || currentItem?.overview || currentItem?.summary || currentItem?.synopsis || "No description available.",
            Director: "N/A",
            Actors: "N/A",
            Poster: poster ? (poster.startsWith("http") ? poster : `${PROXY}${poster}`) : null,
            Backdrop: backdrop ? (backdrop.startsWith("http") ? backdrop : `${PROXY}${backdrop}`) : null,
            Genre: currentItem?.genres ? currentItem.genres.join(", ") : "Unknown",
            Runtime: currentItem?.runtime ? `${currentItem.runtime} min` : "0 min",
            Rated: "NR",
            imdbID: currentItem?.imdb_code || null,
            tmdbID: currentItem?.id || null,
            Type: isCollection ? "series" : "movie",
            source: "frontend-provided"
        };

        setStreamLoading(torrentId);
        try {
            const response = await fetch(config.api.torrents, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ torrentId, tmdbData }),
            });
            const data = await response.json();
            if (response.ok) {
                if (data.isBackground) {
                    torrentHistoryService.addTorrent({ infoHash: data.infoHash, name: data.name || title, source: "magnet", originalInput: torrentId, size: 0 });
                    alert("Added to Background Queue!");
                    setStreamLoading(null);
                    return;
                }
                const existing = torrentHistoryService.getTorrentByInfoHash(data.infoHash);
                if (existing) {
                    torrentHistoryService.updateLastAccessed(data.infoHash);
                } else {
                    torrentHistoryService.addTorrent({ infoHash: data.infoHash, name: data.name || title, source: "magnet", originalInput: torrentId, size: data.size || 0 });
                }
                navigate(`/torrent/${data.infoHash}`);
            } else {
                alert("Failed to add torrent: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            setStreamLoading(null);
        }
    };

    const backdropUrl = backdrop
        ? (backdrop.startsWith("http") ? backdrop : `${PROXY}${backdrop}`)
        : null;

    const activeTorrents = activeQuality ? (groupedTorrents[activeQuality] || []) : [];

    return (
        <main className="dp-wrapper">
            {/* ── Stream loading overlay ── */}
            {streamLoading && (
                <div className="modern-loader-overlay">
                    <div className="loader-content">
                        <div className="glowing-rings">
                            <div className="ring ring-1" />
                            <div className="ring ring-2" />
                            <div className="ring ring-3" />
                        </div>
                        <p className="shimmer-text">{streamLoadingText}</p>
                    </div>
                </div>
            )}

            {/* ── Backdrop ── */}
            {backdropUrl && (
                <div className="dp-backdrop" style={{ backgroundImage: `url(${backdropUrl})` }}>
                    <div className="dp-backdrop-fade" />
                </div>
            )}

            <div className="dp-page">
                {/* ── Back button ── */}
                <div className="dp-top-bar">
                    <button className="dp-back-btn" onClick={handleBack}>
                        <ArrowLeft size={15} />
                        Back
                    </button>
                </div>

                {loading ? <DetailSkeleton /> : error ? (
                    <div className="dp-error-state">{error}</div>
                ) : (
                    <>
                        {/* ══ HERO (original style) ══════════════════════════════ */}
                        <header className="dp-hero">
                            {/* Poster */}
                            <div className="dp-poster-wrap">
                                {rImdb && (
                                    <div className="dp-imdb-badge">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="#f5c518">
                                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                        </svg>
                                        {rImdb}
                                    </div>
                                )}
                                {poster
                                    ? <img src={poster} alt={title} className="dp-poster-img" />
                                    : <div className="dp-poster-empty" />
                                }
                            </div>

                            {/* Metadata */}
                            <div className="dp-meta">
                                <h1 className="dp-title">
                                    {title}
                                    {(item.year || details?.year) && (
                                        <span className="dp-year"> ({item.year || details?.year})</span>
                                    )}
                                </h1>

                                {/* Collection tag */}
                                {details?.partOf && (
                                    <div className="dp-collection-tag">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        Part of: {details.partOf}
                                    </div>
                                )}

                                {/* Ratings */}
                                {(rImdb || rTmdb) && (
                                    <div className="dp-ratings-row">
                                        {rImdb && (
                                            <span className="dp-rating imdb">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="#f5c518"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
                                                {rImdb}
                                                <span className="dp-rating-label">IMDb</span>
                                            </span>
                                        )}
                                        {rTmdb && (
                                            <span className="dp-rating tmdb">
                                                ★ {rTmdb}
                                                <span className="dp-rating-label">TMDB</span>
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Genre tags */}
                                {details?.genres?.length > 0 && (
                                    <div className="dp-genres">
                                        {details.genres.map(g => (
                                            <span key={g} className="dp-genre-tag">{g}</span>
                                        ))}
                                    </div>
                                )}

                                {/* Synopsis */}
                                <p className="dp-synopsis">
                                    {details?.overview || currentItem.overview || "No overview available."}
                                </p>
                            </div>
                        </header>

                        {/* ══ COLLECTION MOVIES ════════════════════════════════ */}
                        {isCollection && details?.movies && (
                            <section className="dp-collection-movies">
                                <div className="dp-torrents-hdr">
                                    <div className="dp-torrents-title">
                                        <span>Movies in Collection</span>
                                        <span className="dp-count-pill">{details.movies.length}</span>
                                    </div>
                                </div>
                                <div className="dp-movies-grid">
                                    {details.movies.map((movie) => (
                                        <div
                                            key={movie.id}
                                            className="dp-movie-card"
                                            onClick={() => setHistory(prev => [...prev, movie])}
                                        >
                                            <div className="dp-movie-poster">
                                                {movie.posterUrl ? (
                                                    <img src={movie.posterUrl} alt={movie.title} loading="lazy" />
                                                ) : (
                                                    <div className="dp-movie-empty">
                                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                                                            <line x1="7" y1="2" x2="7" y2="22" />
                                                            <line x1="17" y1="2" x2="17" y2="22" />
                                                            <line x1="2" y1="12" x2="22" y2="12" />
                                                            <line x1="2" y1="7" x2="7" y2="7" />
                                                            <line x1="2" y1="17" x2="7" y2="17" />
                                                            <line x1="17" y1="17" x2="22" y2="17" />
                                                            <line x1="17" y1="7" x2="22" y2="7" />
                                                        </svg>
                                                    </div>
                                                )}
                                                <div className="dp-movie-overlay">
                                                    {movie.year && <span className="dp-movie-year">{movie.year}</span>}
                                                    {movie.ratingTmdb && (
                                                        <span className="dp-movie-rating">★ {movie.ratingTmdb}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="dp-movie-info">
                                                <h4 className="dp-movie-title">{movie.title}</h4>
                                                <div className="dp-movie-stats">
                                                    <span className="dp-stat-seeders">↑ {movie.maxSeeders || 0} seeders</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* ══ TORRENTS (new card style) ═════════════════════════ */}
                        {!isCollection && (
                            <section className="dp2-section">

                                {/* ── Quality tab bar ── */}
                                {sortedQualities.length > 0 && (
                                    <div className="dp2-tab-bar">
                                        {/* Scrollable tabs */}
                                        <div className="dp2-tabs">
                                            {sortedQualities.map(q => {
                                                const group = groupedTorrents[q];
                                                const totalSeed = group.reduce((s, t) => s + (t.seeders || 0), 0);
                                                return (
                                                    <button
                                                        key={q}
                                                        className={`dp2-tab ${activeQuality === q ? "active" : ""} q-${qKey(q)}`}
                                                        onClick={() => { setActiveQuality(q); setExpandedId(null); }}
                                                    >
                                                        <span className="dp2-tab-label">{QUALITY_LABELS[q] || q}</span>
                                                        <span className="dp2-tab-sub">{group.length} · ↑{totalSeed.toLocaleString()}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Controls */}
                                        <div className="dp2-controls">
                                            <button
                                                className={`dp2-ctrl-btn ${verifiedOnly ? "active" : ""}`}
                                                onClick={() => setVerifiedOnly(!verifiedOnly)}
                                                title="Verified only"
                                            >
                                                {verifiedOnly ? <Shield size={13} /> : <ShieldOff size={13} />}
                                                <span className="dp2-ctrl-label">Verified</span>
                                            </button>
                                            <button
                                                className={`dp2-ctrl-btn ${showFilters ? "active" : ""}`}
                                                onClick={() => setShowFilters(!showFilters)}
                                                title="Sort options"
                                            >
                                                <Filter size={13} />
                                                <span className="dp2-ctrl-label">Sort</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ── Filter drawer ── */}
                                {showFilters && (
                                    <div className="dp2-filter-drawer">
                                        {["seeders", "size"].map(f => (
                                            <button
                                                key={f}
                                                className={`dp2-filter-btn ${activeFilter === f ? "active" : ""}`}
                                                onClick={() => {
                                                    if (activeFilter === f) {
                                                        setSortOrder(s => s === "desc" ? "asc" : "desc");
                                                    } else {
                                                        setActiveFilter(f);
                                                        setSortOrder("desc");
                                                    }
                                                }}
                                                title={`Sort by ${f}`}
                                            >
                                                {f === "seeders" ? <Users size={12} /> : <HardDrive size={12} />}
                                                <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
                                                {activeFilter === f && (
                                                    <span style={{ marginLeft: "2px", display: "flex" }}>
                                                        {sortOrder === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* ── Torrent cards ── */}
                                {Object.keys(groupedTorrents).length === 0 ? (
                                    <div className="dp2-empty">No torrents match your filters.</div>
                                ) : activeTorrents.length === 0 ? (
                                    <div className="dp2-empty">No results in this quality tier.</div>
                                ) : (
                                    <div className="dp2-card-grid">
                                        {activeTorrents.map((t, idx) => {
                                            const tId = t.magnetUrl || t.infoHash;
                                            const isStreaming = streamLoading === tId;
                                            const isExpanded = expandedId === tId;
                                            const isVerified = t.threatLevel === "clean" || t.seeders > 50;
                                            const resolution = (t.resolution || t.quality || "").toUpperCase();
                                            const codec = (t.codec || t.videoInfo?.codec || "").toUpperCase();
                                            const audio = (t.audioCodec || t.audioTracks?.[0]?.codec || "").toUpperCase();
                                            const ffCompat = getFirefoxCompat(codec);

                                            return (
                                                <div
                                                    key={tId || idx}
                                                    className={`dp2-card ${isExpanded ? "expanded" : ""}`}
                                                >
                                                    {/* Card top */}
                                                    <div className="dp2-card-top" onClick={() => setExpandedId(isExpanded ? null : tId)}>
                                                        {isVerified ? (
                                                            <div className="dp2-verified-icon" title="Verified">
                                                                <Shield size={16} color="#fbbf24" strokeWidth={2.5} />
                                                            </div>
                                                        ) : (
                                                            <div className="dp2-unverified-spacer" />
                                                        )}
                                                        <div className="dp2-card-info">
                                                            <div className="dp2-card-badges">
                                                                {resolution && resolution !== "OTHER" && <span className="dp2-badge dp2-badge--res">{resolution}</span>}
                                                                {codec && <span className="dp2-badge dp2-badge--codec">{codec}</span>}
                                                                {audio && <span className="dp2-badge dp2-badge--audio">{audio}</span>}
                                            
                                                                {ffCompat === 'no' && (
                                                                    <span title="Firefox: H.265/HEVC not supported natively"><BadgeAlert size={16} color="#d1471aff" strokeWidth={2.5} /></span>
                                                                )}
                                                            </div>
                                                            <p className="dp2-card-source">{t.source || t.releaseGroup || t.rawTitle?.slice(0, 40) || "Unknown release"}</p>
                                                        </div>
                                                        <div className="dp2-card-stats">
                                                            <div className="dp2-stat">
                                                                <span className="dp2-stat-val dp2-stat-val--size">{formatBytes(t.sizeBytes)}</span>
                                                            </div>
                                                            <div className="dp2-stat-row">
                                                                <span className="dp2-stat-val dp2-stat-val--seed">↑{t.seeders ?? "—"}</span>
                                                                <span className="dp2-stat-val dp2-stat-val--leech">↓{t.leechers ?? "—"}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="dp2-card-actions">
                                                        <button
                                                            className="dp2-btn-stream"
                                                            onClick={e => { e.stopPropagation(); handleStream(t); }}
                                                            disabled={isStreaming}
                                                        >
                                                            {isStreaming
                                                                ? <div className="dp2-spinner-sm" />
                                                                : <Play size={12} fill="currentColor" />
                                                            }
                                                            {isStreaming ? "Loading…" : "Stream"}
                                                        </button>
                                                        <button
                                                            className="dp2-btn-copy"
                                                            title="Copy magnet link"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(t.magnetUrl || t.infoHash);
                                                                alert("Copied!");
                                                            }}
                                                        >
                                                            <Copy size={13} />
                                                        </button>
                                                        <button
                                                            className="dp2-btn-expand"
                                                            onClick={() => setExpandedId(isExpanded ? null : tId)}
                                                            title="Show details"
                                                        >
                                                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                        </button>
                                                    </div>

                                                    {/* Expanded detail */}
                                                    {isExpanded && (
                                                        <div className="dp2-card-detail" onClick={e => e.stopPropagation()}>
                                                            <div className="dp2-detail-row">
                                                                <span className="dp2-detail-label">Title</span>
                                                                <span className="dp2-detail-val dp2-detail-val--break">{t.rawTitle || t.name || t.title || "—"}</span>
                                                            </div>
                                                            <div className="dp2-detail-row">
                                                                <span className="dp2-detail-label">Video</span>
                                                                <span className="dp2-detail-val">{t.videoInfo?.codec || t.codec || "—"} · {t.videoInfo?.bitDepth || "—"}bit · {t.resolution || t.quality || "—"}</span>
                                                            </div>
                                                            <div className="dp2-detail-row">
                                                                <span className="dp2-detail-label">Audio</span>
                                                                <span className="dp2-detail-val">
                                                                    {t.audioTracks?.length > 0
                                                                        ? t.audioTracks.map((tr) => `${tr.lang || tr.language || "?"} ${tr.codec || ""}`).join(" · ")
                                                                        : t.audioCodec || "—"
                                                                    }
                                                                </span>
                                                            </div>
                                                            {t.subtitleTracks?.length > 0 && (
                                                                <div className="dp2-detail-row">
                                                                    <span className="dp2-detail-label">Subs</span>
                                                                    <div className="dp2-sub-tags">
                                                                        {t.subtitleTracks.map((s, i) => (
                                                                            <span key={i} className="dp2-sub-tag">{s.lang || s.language || "?"}</span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}