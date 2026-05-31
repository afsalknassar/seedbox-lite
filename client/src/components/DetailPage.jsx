import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { config } from "../config/environment";
import torrentHistoryService from "../services/torrentHistoryService";
import "../assets/styles/DetailPage.css";
import "../assets/styles/HomePage.css"; // For modern-loader-overlay
import { ArrowLeft } from 'lucide-react';

// ─── CONFIG ──────────────────────────────────────────────────
const PROXY = "https://rich-clownfish-18.epaperhubdaily.deno.net";
const API_KEY = "tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1";

// UPDATED: Added options parameter to support AbortController
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

const Spinner = () => (
    <div className="modern-loader-container">
        <div className="modern-spinner"></div>
        <p>Loading Details…</p>
    </div>
);

// quality → CSS class key
const qKey = (q) =>
    q === "2160p" ? "2160p" : q === "1080p" ? "1080p" : q === "720p" ? "720p" : q === "480p" ? "480p" : "other";

// ─── COMPONENT ───────────────────────────────────────────────
export default function DetailPage({ item, onBack }) {
    const navigate = useNavigate();

    // Support nested navigation (e.g., clicking a movie within a collection)
    const [history, setHistory] = useState([]);
    const currentItem = history.length > 0 ? history[history.length - 1] : item;

    const [details, setDetails] = useState(null);
    const [torrents, setTorrents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [openGroup, setOpenGroup] = useState(null);
    const [streamLoading, setStreamLoading] = useState(null);
    const [streamLoadingText, setStreamLoadingText] = useState('Syncing...');
    const [hasAutoOpened, setHasAutoOpened] = useState(false);
    const [activeFilter, setActiveFilter] = useState("seeders");
    const [sortOrder, setSortOrder] = useState("desc");
    const [verifiedOnly, setVerifiedOnly] = useState(false);
    const [expandedTorrentId, setExpandedTorrentId] = useState(null);

    const isCollection = currentItem.movieCount !== undefined || currentItem.partCount !== undefined;
    const title = currentItem.title || currentItem.name || "Details";
    const poster = currentItem.posterUrl;
    const backdrop = currentItem.backdropUrl || currentItem.posterUrl;
    const rImdb = currentItem.ratingImdb;
    const rTmdb = currentItem.ratingTmdb;

    const handleBack = () => {
        if (history.length > 0) {
            setHistory(h => h.slice(0, -1));
        } else {
            onBack();
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setHasAutoOpened(false);
        try {
            if (isCollection) {
                const data = await apiFetch(`/api/v1/collections/${currentItem.id}`);
                setDetails(data);
            } else {
                const data = await apiFetch("/api/v1/search", { q: title, availability: "all" });
                const exactMatch = data.results?.find((r) => r.id === currentItem.id || r.title === title) || data.results?.[0];
                setDetails(exactMatch || currentItem);
                setTorrents(exactMatch?.torrents || []);
            }
        } catch (err) {
            setError("Failed to load details.");
        }
        setLoading(false);
        // UPDATED: Changed item to item?.id to prevent infinite re-renders
    }, [currentItem?.id, isCollection, title]);

    useEffect(() => { loadData(); }, [loadData]);

    const groupedTorrents = useMemo(() => {
        if (!torrents.length) return {};
        let filtered = verifiedOnly
            ? torrents.filter(t => t.threatLevel === "clean" || t.seeders > 50)
            : torrents;

        const groups = filtered.reduce((acc, t) => {
            const q = t.quality || "Unknown";
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

    useEffect(() => {
        const keys = Object.keys(groupedTorrents);
        if (keys.length > 0 && !hasAutoOpened) {
            setOpenGroup(keys[0]);
            setHasAutoOpened(true);
        }
    }, [groupedTorrents, hasAutoOpened]);

    useEffect(() => {
        let interval;
        if (streamLoading) {
            const messages = [
                "Connecting to swarm...",
                "Finding peers...",
                "Downloading metadata...",
                "Resolving files...",
                "Almost ready..."
            ];
            let step = 0;
            setStreamLoadingText(messages[0]);

            interval = setInterval(() => {
                step++;
                if (step < messages.length) {
                    setStreamLoadingText(messages[step]);
                }
            }, 3500);
        }
        return () => clearInterval(interval);
    }, [streamLoading]);

    const handleStream = async (torrent) => {
        const torrentId = torrent.magnetUrl || torrent.infoHash;
        setStreamLoading(torrentId);
        try {
            const response = await fetch(config.api.torrents, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ torrentId }),
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

    return (
        <main className="dp-wrapper">
            {streamLoading && (
                <div className="modern-loader-overlay">
                    <div className="loader-content">
                        <div className="glowing-rings">
                            <div className="ring ring-1"></div>
                            <div className="ring ring-2"></div>
                            <div className="ring ring-3"></div>
                        </div>
                        <p className="shimmer-text">{streamLoadingText}</p>
                    </div>
                </div>
            )}
            
            {/* Backdrop */}
            {backdropUrl && (
                <div className="dp-backdrop" style={{ backgroundImage: `url(${backdropUrl})` }}>
                    <div className="dp-backdrop-fade" />
                </div>
            )}

            <div className="dp-page">
                {/* ── Back button row ── */}
                <div className="dp-top-bar">
                    <button className="dp-back-btn" onClick={handleBack}>
                        <ArrowLeft size={15} />
                        Back
                    </button>
                </div>

                {loading ? <Spinner /> : error ? (
                    <div className="dp-error-state">{error}</div>
                ) : (
                    <>
                        {/* ══ HERO ══════════════════════════════════════════ */}
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

                        {/* ══ COLLECTION MOVIES ══════════════════════════════════════ */}
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

                        {/* ══ TORRENTS ══════════════════════════════════════ */}
                        {!isCollection && (
                            <section className="dp-torrents">
                                {/* Section header */}
                                <div className="dp-torrents-hdr">
                                    <div className="dp-torrents-title">
                                        <span>Torrents</span>
                                        <span className="dp-count-pill">{torrents.length}</span>
                                    </div>

                                    <div className="dp-filter-bar">
                                        {/* Sort pill group */}
                                        <div className="dp-sort-group">
                                            {["quality", "seeders", "size"].map(f => (
                                                <button
                                                    key={f}
                                                    className={`dp-sort-btn ${activeFilter === f ? "active" : ""}`}
                                                    onClick={() => {
                                                        if (activeFilter === f) {
                                                            setSortOrder(sortOrder === "desc" ? "asc" : "desc");
                                                        } else {
                                                            setActiveFilter(f);
                                                            setSortOrder("desc");
                                                        }
                                                    }}
                                                >
                                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                                    {activeFilter === f && (
                                                        <span style={{ marginLeft: "4px" }}>
                                                            {sortOrder === "desc" ? "↓" : "↑"}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Verified toggle */}
                                        <button
                                            className={`dp-verified-btn ${verifiedOnly ? "active" : ""}`}
                                            onClick={() => setVerifiedOnly(!verifiedOnly)}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                                <path d="M9 12l2 2 4-4" />
                                            </svg>
                                            Verified
                                        </button>
                                    </div>
                                </div>

                                {/* Accordion */}
                                {Object.keys(groupedTorrents).length === 0 ? (
                                    <div className="dp-empty">No torrents match your filters.</div>
                                ) : (
                                    <div className="dp-accordion">
                                        {Object.entries(groupedTorrents).map(([quality, items]) => {
                                            const isOpen = openGroup === quality;
                                            const totalSeeders = items.reduce((s, t) => s + (t.seeders || 0), 0);
                                            const maxSize = items.reduce((m, t) => t.sizeBytes > m ? t.sizeBytes : m, 0);

                                            return (
                                                <div key={quality} className={`dp-group ${isOpen ? "open" : ""}`}>
                                                    {/* Group header */}
                                                    <button
                                                        className="dp-group-hdr"
                                                        onClick={() => setOpenGroup(isOpen ? null : quality)}
                                                    >
                                                        <div className="dp-group-left">
                                                            <span className={`dp-q-badge q-${qKey(quality)}`}>
                                                                {quality === "2160p" ? "4K / UHD" : quality}
                                                            </span>
                                                            <span className="dp-group-count">
                                                                {items.length} {items.length === 1 ? "torrent" : "torrents"}
                                                            </span>
                                                        </div>
                                                        <div className="dp-group-right">
                                                            <span className="dp-seed-stat">
                                                                ↑ {totalSeeders.toLocaleString()} seeders
                                                            </span>
                                                            <span className="dp-size-stat">{formatBytes(maxSize)}</span>
                                                            <svg
                                                                className={`dp-chevron ${isOpen ? "open" : ""}`}
                                                                width="16" height="16" viewBox="0 0 24 24"
                                                                fill="none" stroke="currentColor" strokeWidth="2"
                                                            >
                                                                <path d="M6 9l6 6 6-6" />
                                                            </svg>
                                                        </div>
                                                    </button>

                                                    {/* Rows */}
                                                    {isOpen && (
                                                        <div className="dp-rows">
                                                            {items.map((t, idx) => {
                                                                const tId = t.magnetUrl || t.infoHash;
                                                                const isStreaming = streamLoading === tId;
                                                                const isExpanded = expandedTorrentId === tId;
                                                                const isVerified = t.threatLevel === "clean" || t.seeders > 50;

                                                                return (
                                                                    <div
                                                                        key={tId || idx}
                                                                        className={`dp-row ${isExpanded ? "expanded" : ""}`}
                                                                        onClick={() => setExpandedTorrentId(isExpanded ? null : tId)}
                                                                    >
                                                                        <div className="dp-row-main">
                                                                            {/* Left: specs */}
                                                                            <div className="dp-specs">
                                                                                {/* Verified icon */}
                                                                                {isVerified ? (
                                                                                    <svg className="dp-verified-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                                                                        <path d="M9 12l2 2 4-4" />
                                                                                    </svg>
                                                                                ) : (
                                                                                    <svg className="dp-unverified-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                        <circle cx="12" cy="12" r="10" />
                                                                                    </svg>
                                                                                )}

                                                                                <span className={`dp-badge q-${qKey(quality)}`}>
                                                                                    {(t.quality || "?").toUpperCase()}
                                                                                </span>
                                                                                <span className="dp-badge codec">
                                                                                    {(t.codec || t.videoInfo?.codec || "HEVC").toUpperCase()}
                                                                                </span>
                                                                                <span className="dp-badge audio">
                                                                                    {(t.audioCodec || t.audioTracks?.[0]?.codec || "AC3").toUpperCase()}
                                                                                </span>
                                                                                <span className="dp-source">
                                                                                    {t.source || t.releaseGroup || "—"}
                                                                                </span>
                                                                            </div>

                                                                            {/* Right: stats + actions */}
                                                                            <div className="dp-row-right">
                                                                                <div className="dp-stats">
                                                                                    <span className="dp-stat-size">{formatBytes(t.sizeBytes)}</span>
                                                                                    <span className="dp-stat-seed">↑ {t.seeders ?? "—"}</span>
                                                                                    <span className="dp-stat-leech">↓ {t.leechers ?? "—"}</span>
                                                                                </div>
                                                                                <div className="dp-actions">
                                                                                    <button
                                                                                        className="dp-btn-stream"
                                                                                        onClick={e => { e.stopPropagation(); handleStream(t); }}
                                                                                        disabled={isStreaming}
                                                                                    >
                                                                                        {isStreaming
                                                                                            ? <div className="dp-spinner-sm" />
                                                                                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                                                                        }
                                                                                        Stream
                                                                                    </button>
                                                                                    <button
                                                                                        className="dp-btn-copy"
                                                                                        title="Copy Magnet"
                                                                                        onClick={e => {
                                                                                            e.stopPropagation();
                                                                                            navigator.clipboard.writeText(t.magnetUrl || t.infoHash);
                                                                                            alert("Copied!");
                                                                                        }}
                                                                                    >
                                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                                                        </svg>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Expanded detail panel */}
                                                                        {isExpanded && (
                                                                            <div className="dp-detail-panel" onClick={e => e.stopPropagation()}>
                                                                                <div className="dp-detail-col" style={{ gridColumn: "1 / -1" }}>
                                                                                    <h4>Raw Title</h4>
                                                                                    <p style={{ wordBreak: "break-all" }}>{t.rawTitle || t.name || t.title || "—"}</p>
                                                                                </div>
                                                                                <div className="dp-detail-col">
                                                                                    <h4>Audio</h4>
                                                                                    {t.audioTracks?.length > 0
                                                                                        ? <ul>{t.audioTracks.map((tr, i) => <li key={i}>{tr.lang || tr.language || "Unknown"} · {tr.codec} · {tr.channels}</li>)}</ul>
                                                                                        : <p>{t.audioCodec || "Unknown"}</p>
                                                                                    }
                                                                                </div>
                                                                                <div className="dp-detail-col">
                                                                                    <h4>Subtitles</h4>
                                                                                    {t.subtitleTracks?.length > 0
                                                                                        ? <div className="dp-sub-list">{t.subtitleTracks.map((s, i) => <span key={i}>{s.lang || s.language || "?"}</span>)}</div>
                                                                                        : <p>None specified</p>
                                                                                    }
                                                                                </div>
                                                                                <div className="dp-detail-col">
                                                                                    <h4>Video</h4>
                                                                                    <p><span>Codec</span> {t.videoInfo?.codec || t.codec || "—"}</p>
                                                                                    <p><span>Depth</span> {t.videoInfo?.bitDepth || "—"}</p>
                                                                                    <p><span>Res</span> {t.resolution || t.quality || "—"}</p>
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
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}