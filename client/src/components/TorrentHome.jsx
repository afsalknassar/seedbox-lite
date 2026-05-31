import React, { useState, useEffect, useCallback, useRef } from "react";
import "../assets/styles/TorrentHome.css";
import DetailPage from "./DetailPage";

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
const fmtSeeds = (n) => {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
};

const getRating = (item) =>
  parseFloat(item?.ratingImdb || item?.ratingTmdb || item?.rating || 0) || 0;

const Spinner = () => (
  <div className="t-spinner-wrap"><div className="t-spinner" /></div>
);

const Empty = ({ icon, msg, sub }) => (
  <div className="t-empty">
    <div className="t-empty-icon">{icon}</div>
    <div className="t-empty-msg">{msg}</div>
    {sub && <div className="t-empty-sub">{sub}</div>}
  </div>
);

const Stars = ({ val }) => {
  const v = parseFloat(val) || 0;
  const filled = Math.round((v / 10) * 5);
  return (
    <span className="t-stars">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24"
          fill={i <= filled ? "#f59e0b" : "none"}
          stroke={i <= filled ? "#f59e0b" : "#64748b"}
          strokeWidth="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </span>
  );
};

const MovieCard = ({ item, onClick, layout }) => {
  const r = getRating(item);
  const title = item.title || item.name || "Untitled";
  const poster = item.posterUrl || item.localPosterUrl || null;

  const seeds = item.maxSeeders ?? item.totalSeeders ?? 0;
  const isMissingTorrents = item.hasTorrents === false || item.maxSeeders === 0;

  return (
    <div className={`t-card ${layout === 'list' ? 't-card-list' : ''}`} onClick={() => onClick(item)}>
      <div className="t-card-poster">
        {poster ? (
          <img src={poster} alt={title} loading="lazy" />
        ) : (
          <div className="t-card-ph">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2" /><path d="m7 2 .01 20M17 2v20M2 12h20" />
            </svg>
          </div>
        )}

        {/* Floating Badges */}
        {r > 0 && (
          <div className="t-card-rating">
            ★ {r.toFixed(1)}
          </div>
        )}
        {isMissingTorrents && <div className="t-no-torrent">NO TORRENTS</div>}
      </div>

      <div className="t-card-info">
        <h3 className="t-card-title">{title}</h3>
        <div className="t-card-meta">
          <span className="t-card-year">{item.year || "—"}</span>
          {seeds > 0 && <span className="t-card-seeds">▲ {fmtSeeds(seeds)}</span>}
        </div>
        {layout === 'list' && (
          <div className="t-card-list-desc">
            {item.overview ? (item.overview.length > 150 ? item.overview.substring(0, 150) + "..." : item.overview) : ""}
          </div>
        )}
      </div>
    </div>
  );
};

const MovieGrid = ({ items, onSelect, loading, emptyMsg, isExpanded, layout }) => {
  if (loading) return <Spinner />;
  if (!items?.length) return <Empty icon="🎬" msg={emptyMsg || "Nothing here yet"} />;

  let gridClass = "t-row";
  if (layout === "list") gridClass = "t-list";
  else if (isExpanded || layout === "grid") gridClass = "t-grid";

  return (
    <div className={gridClass}>
      {items.map(it => (
        <MovieCard
          key={it.id || it.tmdbId || it.imdbId}
          item={it}
          onClick={onSelect}
          layout={layout}
        />
      ))}
    </div>
  );
};

const Section = ({ title, action, items, onSelect, loading, emptyMsg }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="t-section">
      <div className="t-section-hd">
        <h2 className="t-section-title">{title}</h2>
        <div className="t-section-actions">
          {action}
          {items?.length > 0 && (
            <button className="t-view-all" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? "Show Less" : "View All"}
            </button>
          )}
        </div>
      </div>
      <MovieGrid items={items} onSelect={onSelect} loading={loading} emptyMsg={emptyMsg} isExpanded={isExpanded} />
    </div>
  );
};

// ─── SEARCH COMPONENTS ────────────────────────────────────────

const SearchBar = ({ query, onChange, onClear, onSelect, onSearch }) => {
  const inputRef = useRef(null);

  // Focus input on Ctrl/Cmd+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="t-searchbar-outer">
      <div className="t-searchbar">
        {/* Search icon */}
        <svg className="t-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>

        <input
          ref={inputRef}
          className="t-search-input"
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search movies, shows, collections…"
          onKeyDown={e => e.key === "Enter" && query.trim() && onSearch()}
          autoComplete="off"
          spellCheck="false"
        />

        {/* Right slot: clear btn OR keyboard hint */}
        {query ? (
          <button className="t-search-clear" onClick={onClear} aria-label="Clear search">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <kbd className="t-search-kbd">⌘ K</kbd>
        )}
      </div>

      <Autocomplete query={query} onSelect={s => { onChange(s.title || s.name); onSelect(s); }} />
    </div>
  );
};


const Autocomplete = ({ query, onSelect }) => {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef(null);
  const ref = useRef(null);

  // Reset dismissed state whenever query changes so new suggestions appear
  useEffect(() => {
    setDismissed(false);
  }, [query]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.length < 2) { setItems([]); return; }
    timer.current = setTimeout(() => {
      apiFetch("/api/v1/autocomplete", { q: query })
        .then(d => setItems(d.suggestions || []))
        .catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [query]);

  // Click outside to dismiss
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setDismissed(true);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Escape key to dismiss
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!items.length || dismissed) return null;

  return (
    <div className="t-autocomplete" ref={ref}>
      <div className="t-ac-header">
        <span className="t-ac-label">Suggestions</span>
        <button className="t-ac-dismiss" onClick={() => setDismissed(true)} title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {items.slice(0, 6).map(s => (
        <button key={s.id || s.tmdbId} className="t-ac-item" onClick={() => { onSelect(s); setItems([]); }}>
          {s.posterUrl && <img src={s.posterUrl} alt="" className="t-ac-thumb" />}
          <div>
            <div className="t-ac-name">{s.title || s.name}</div>
            <div className="t-ac-meta">{s.year || ""}{s.year ? " · " : ""}{s.contentType || s.type}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

const GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction", "Thriller", "TV Movie", "War", "Western"];

const Hero = ({ item, onSelect }) => {
  if (!item) return null;
  const r = getRating(item);
  const title = item.title || item.name || "Untitled";
  const rawBackdrop = item.backdropUrl || item.localBackdropUrl || item.posterUrl || item.localPosterUrl;
  const backdrop = rawBackdrop
    ? (rawBackdrop.startsWith("http") ? rawBackdrop : `${PROXY}${rawBackdrop}`)
    : null;

  // Grab a short snippet of the plot if it exists
  const overview = item.overview ? item.overview.slice(0, 120) + '...' : '';

  return (
    <div className="t-hero" onClick={() => onSelect(item)}>
      {backdrop && (
        <div className="t-hero-img-wrapper">
          <img src={backdrop} alt={title} className="t-hero-img"
            onError={e => { e.target.style.display = "none"; }} />
        </div>
      )}
      <div className="t-hero-overlay" />

      <div className="t-hero-content">
        <div className="t-hero-tag"><span className="t-hero-dot" /> Trending Today</div>
        <h1 className="t-hero-title">{title}</h1>

        <div className="t-hero-meta">
          {item.year && <span className="t-meta-year">{item.year}</span>}
          {item.contentType && <span className="t-type-badge">{item.contentType}</span>}
          {r > 0 && <span className="t-meta-rating"><Stars val={r} /></span>}
        </div>

        {overview && <p className="t-hero-desc">{overview}</p>}

        <div className="t-hero-actions">
          <button className="t-hero-btn-primary" onClick={e => { e.stopPropagation(); onSelect(item); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="m5 3 14 9-14 9V3z" /></svg>
            Play Now
          </button>
          <button className="t-hero-btn-secondary" onClick={e => { e.stopPropagation(); onSelect(item); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default function HomeTabCopy() {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("home");
  const [trendingPeriod, setTrendingPeriod] = useState("daily");

  const [data, setData] = useState({ trending: [], popular: [], recent: [], collections: [], userrequested: [] });
  
  // UPDATED: Initialize loading states to true so spinners show immediately
  const [loading, setLoading] = useState({
      trending: true, 
      popular: true, 
      recent: true, 
      collections: true, 
      userrequested: true 
  });
  
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

  // Search State
  const [query, setQuery] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [typeFilter, setTypeFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [qualFilter, setQualFilter] = useState("");
  const [sortFilter, setSortFilter] = useState("relevance");

  // UPDATED: Ref for aborting search calls
  const abortControllerRef = useRef(null);

  const fetchData = useCallback(async (key, path, params = {}, resKey = "items", mapFn) => {
    setLoad(key, true);
    try {
      const d = await apiFetch(path, params);
      let arr = d[resKey] || d.results || [];
      if (mapFn) arr = arr.map(mapFn);
      setData(p => ({ ...p, [key]: arr }));
    } catch {
      setData(p => ({ ...p, [key]: [] }));
    }
    setLoad(key, false);
  }, []);

  const loadTrending = useCallback(() => fetchData("trending", "/api/v1/trending", { period: trendingPeriod, limit: 50 }), [fetchData, trendingPeriod]);
  const loadPopular = useCallback(() => fetchData("popular", "/api/v1/popular", { limit: 24 }), [fetchData]);
  const loadRecent = useCallback(() => fetchData("recent", "/api/v1/recent", { limit: 24 }), [fetchData]);
  const loadCollections = useCallback(() => fetchData("collections", "/api/v1/collections", { limit: 48 }), [fetchData]);
  const loadUserRequested = useCallback(() => fetchData("userrequested", "/api/v1/requests/recently-found", { limit: 50 }, "items", (it) => {
    const content = it.content || {};
    return {
      ...it,
      ...content,
      id: content.id || it.id || it.title,
      posterUrl: content.poster || it.posterUrl || null,
      contentType: it.mediaType || content.type
    };
  }), [fetchData]);

  // UPDATED: Included AbortController logic to stop race conditions
  const doSearch = useCallback(async (q, page = 1, append = false) => {
    if (!q.trim()) return;
    
    // Cancel the previous request if it's still running
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    append ? setLoadingMore(true) : setSearching(true);
    try {
      const params = { q, limit: 20, page, sort: sortFilter };
      if (typeFilter) params.type = typeFilter;
      if (genreFilter) params.genre = genreFilter;
      if (qualFilter) params.quality = qualFilter;
      
      const d = await apiFetch("/api/v1/search", params, { signal });
      
      const res = d.results || [];
      append ? setSearchRes(prev => [...prev, ...res]) : setSearchRes(res);
      setSearchTotal(d.total || res.length);
      setHasMore(res.length === 20 && (d.total == null || page * 20 < (d.total || 0)));
      setSearchPage(page);
    } catch (err) {
      if (err.name === 'AbortError') return; // Ignore cancelled requests
      if (!append) setSearchRes([]);
      setHasMore(false);
    } finally {
      append ? setLoadingMore(false) : setSearching(false);
    }
  }, [typeFilter, genreFilter, sortFilter, qualFilter]);

  // UPDATED: Debounce effect isolated from the doSearch dependency loop
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        setView("search");
        setSearchPage(1);
        doSearch(query, 1);
      } else {
        setSearchRes([]);
        setSearchTotal(0);
        setHasMore(false);
        if (view === "search") setView("home");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]); // ONLY depend on the query string changing

  // UPDATED: re-search on filter change without eslint-disable
  useEffect(() => {
    if (!query.trim() || view !== "search") return;
    setSearchPage(1); 
    doSearch(query, 1);
  }, [typeFilter, genreFilter, sortFilter, qualFilter]);


  useEffect(() => { loadTrending(); }, [loadTrending]);
  useEffect(() => { loadPopular(); }, [loadPopular]);
  useEffect(() => { loadRecent(); }, [loadRecent]);
  useEffect(() => { loadCollections(); }, [loadCollections]);
  useEffect(() => { loadUserRequested(); }, [loadUserRequested]);

  if (selected) {
    return <DetailPage item={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="t-app">
      <div className="t-top-bar-container">
        <SearchBar
          query={query}
          onChange={setQuery}
          onClear={() => { setQuery(""); setView("home"); }}
          onSelect={(s) => setSelected(s)}
          onSearch={() => { setView("search"); doSearch(query, 1); }}
        />
      </div>

      {view === "home" && (
        <>
          <Hero item={data.trending[0]} onSelect={setSelected} />

          <div className="t-home-wrap">
            <Section
              title="🔥 Trending"
              action={
                <div className="t-control-bar" style={{ margin: 0, padding: '2px' }}>
                  <div className="t-type-seg">
                    {[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([v, l]) => (
                      <button
                        key={v}
                        className={`t-seg-btn ${trendingPeriod === v ? "active" : ""}`}
                        onClick={() => setTrendingPeriod(v)}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              }
              items={data.trending}
              onSelect={setSelected}
              loading={loading.trending}
            />

            <Section title="⭐ Most Popular" items={data.popular} onSelect={setSelected} loading={loading.popular} />
            <Section title="🕒 Recently Added" items={data.recent} onSelect={setSelected} loading={loading.recent} />
            <Section title="🎬 User Requested" items={data.userrequested} onSelect={setSelected} loading={loading.userrequested} />
            <Section title="📚 Collections" items={data.collections} onSelect={setSelected} loading={loading.collections} />
          </div>
        </>
      )}

      {view === "search" && (
        <>
          <div className="t-search-head">
            {/* Title row */}
            <div className="t-search-title-row">
              <div className="t-search-title-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="t-search-title-icon">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <h1 className="t-page-title">
                  {query ? <><span className="t-query-text">{query}</span></> : "Search"}
                </h1>
              </div>
              {searchTotal > 0 && (
                <span className="t-search-count">{searchTotal.toLocaleString()} results</span>
              )}
            </div>

            {/* Unified filter control bar */}
            <div className="t-control-bar">
              {/* Type segment */}
              <div className="t-type-seg">
                {[["", "All"], ["movie", "Movies"], ["show", "Shows"]].map(([v, l]) => (
                  <button
                    key={v}
                    className={`t-seg-btn ${typeFilter === v ? "active" : ""}`}
                    onClick={() => setTypeFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div className="t-bar-divider" />

              {/* Dropdowns */}
              <div className="t-filter-selects">
                <div className="t-select-wrap">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8l4 4-4 4"/></svg>
                  <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)} className="t-filter-select">
                    <option value="">Genre</option>
                    {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>

                <div className="t-select-wrap">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 8h10M7 12h6M7 16h4"/></svg>
                  <select value={qualFilter} onChange={e => setQualFilter(e.target.value)} className="t-filter-select">
                    <option value="">Quality</option>
                    {["480p", "720p", "1080p", "2160p"].map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>

                <div className="t-select-wrap">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
                  <select value={sortFilter} onChange={e => setSortFilter(e.target.value)} className="t-filter-select">
                    {[["relevance", "Relevance"], ["seeders", "Seeders"], ["year", "Year"], ["rating", "Rating"], ["added", "Added"]].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>


          <div className="t-section t-search-results">
            {searching && searchRes.length === 0 ? <Spinner />
              : searchRes.length > 0
                ? <>
                  <MovieGrid items={searchRes} layout="grid" onSelect={setSelected} loading={false} isExpanded={true} />
                  {hasMore && (
                    <div className="t-loadmore">
                      <button
                        className={`t-loadmore-btn ${loadingMore ? 'loading' : ''}`}
                        disabled={loadingMore}
                        onClick={() => doSearch(query, searchPage + 1, true)}
                      >
                        {loadingMore
                          ? <><span className="t-loadmore-spinner" /> Loading…</>
                          : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7" /></svg> Load More</>
                        }
                      </button>
                    </div>
                  )}
                </>
                : query
                  ? <Empty icon="🔍" msg={`No results for "${query}"`} sub="Try different keywords or remove filters" />
                  : <Empty icon="🔍" msg="Start typing to search" sub="Results appear automatically" />
            }
          </div>
        </>
      )}
    </div>
  );
}