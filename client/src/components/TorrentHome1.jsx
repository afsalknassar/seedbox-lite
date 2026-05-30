import { useState, useEffect, useCallback, useRef } from "react";
import "../assets/styles/TorrentHome.css";
import DetailPage from "./DetailPage";

// ─── CONFIG ──────────────────────────────────────────────────
const PROXY  = "https://rich-clownfish-18.epaperhubdaily.deno.net";
const API_KEY = "tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1";

export const apiFetch = async (path, params = {}) => {
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

export const PROXY_URL = PROXY;

// ─── HELPERS ─────────────────────────────────────────────────
export const fmtSeeds = (n) => {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
};

export const getRating = (item) =>
  parseFloat(item?.ratingImdb || item?.ratingTmdb || item?.rating || 0) || 0;

const SERVICES  = ["netflix","prime","disney","apple","crunchyroll"];
const SVC_LABELS = { netflix:"Netflix", prime:"Prime Video", disney:"Disney+", apple:"Apple TV+", crunchyroll:"Crunchyroll" };
const SVC_COLORS = { netflix:"#e50914", prime:"#00a8e1", disney:"#113ccf", apple:"#555", crunchyroll:"#ff6400" };
const GENRES    = ["Action","Adventure","Animation","Comedy","Crime","Documentary","Drama","Family","Fantasy","History","Horror","Mystery","Romance","Science Fiction","Thriller","War","Western"];
const MORE_VIEWS = ["popular","recent","upcoming","collections"];

// ─── ATOMS ───────────────────────────────────────────────────
export const Spinner = () => (
  <div className="t-spinner-wrap"><div className="t-spinner" /></div>
);

export const Empty = ({ icon, msg, sub }) => (
  <div className="t-empty">
    <div className="t-empty-icon">{icon}</div>
    <div className="t-empty-msg">{msg}</div>
    {sub && <div className="t-empty-sub">{sub}</div>}
  </div>
);

export const Stars = ({ val }) => {
  const v = parseFloat(val) || 0;
  const filled = Math.round((v / 10) * 5);
  return (
    <span className="t-stars">
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24"
          fill={i <= filled ? "#f59e0b" : "none"}
          stroke={i <= filled ? "#f59e0b" : "#3a4455"}
          strokeWidth="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
      {v > 0 && <span className="t-star-val">{v.toFixed(1)}</span>}
    </span>
  );
};

const LayoutIcon = ({ mode }) =>
  mode === "grid"
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;

// ─── AUTOCOMPLETE ─────────────────────────────────────────────
const Autocomplete = ({ query, onSelect }) => {
  const [items, setItems] = useState([]);
  const timer = useRef(null);

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

  if (!items.length) return null;
  return (
    <div className="t-autocomplete">
      {items.slice(0, 6).map(s => (
        <button key={s.id} className="t-ac-item" onClick={() => { onSelect(s); setItems([]); }}>
          {s.posterUrl && <img src={s.posterUrl} alt="" className="t-ac-thumb" />}
          <div>
            <div className="t-ac-name">{s.title}</div>
            <div className="t-ac-meta">{s.year || ""}{s.year ? " · " : ""}{s.contentType}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

// ─── SEARCH BAR ───────────────────────────────────────────────
const SearchBar = ({ query, onChange, onClear, onSelect, onSearch }) => (
  <div className="t-searchbar-outer">
    <div className="t-searchbar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        className="t-search-input"
        value={query}
        onChange={e => onChange(e.target.value)}
        placeholder="Search movies, shows…"
        onKeyDown={e => e.key === "Enter" && query.trim() && onSearch()}
      />
      {query && <button className="t-search-clear" onClick={onClear}>×</button>}
    </div>
    <Autocomplete query={query} onSelect={s => { onChange(s.title); onSelect(s); }} />
  </div>
);

// ─── MOVIE CARD ───────────────────────────────────────────────
const MovieCard = ({ item, layout, onClick }) => {
  const r = getRating(item);
  const title = item.title || item.name || "Untitled";
  const poster = item.posterUrl || item.localPosterUrl || null;
  const seeds  = item.maxSeeders ?? 0;
  const isList = layout === "list";

  return (
    <div className="t-card" onClick={() => onClick(item)}>
      <div className="t-card-poster">
        {poster
          ? <img src={poster} alt={title} loading="lazy" />
          : <div className="t-card-ph">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2"/><path d="m7 2 .01 20M17 2v20M2 12h20"/>
              </svg>
            </div>
        }
        {r > 0 && (
          <div className="t-card-rating">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
            </svg>
            {r.toFixed(1)}
          </div>
        )}
        {seeds > 0 && <div className="t-card-seeds">▲ {fmtSeeds(seeds)}</div>}
        {!item.hasTorrents && <div className="t-no-torrent">NO TORRENTS</div>}
      </div>
      <div className="t-card-info">
        <div className="t-card-title">{title}</div>
        <div className="t-card-meta">
          <span>{item.year || "—"}</span>
          {item.contentType && <span className="t-type-badge">{item.contentType}</span>}
        </div>
        {isList && item.overview && <div className="t-list-overview">{item.overview}</div>}
      </div>
      {isList && (
        <div className="t-list-right">
          {r > 0 && <Stars val={r} />}
          {seeds > 0 && <span className="t-card-seeds" style={{ position:"static", background:"none", backdropFilter:"none", padding:0 }}>▲ {fmtSeeds(seeds)}</span>}
        </div>
      )}
    </div>
  );
};

// ─── MOVIE GRID ───────────────────────────────────────────────
const MovieGrid = ({ items, layout, onSelect, loading, emptyMsg }) => {
  if (loading) return <Spinner />;
  if (!items?.length) return <Empty icon="🎬" msg={emptyMsg || "Nothing here yet"} />;
  return (
    <div className={`t-grid${layout === "list" ? " t-list" : ""}`}>
      {items.map(it => (
        <MovieCard
          key={it.id || it.tmdbId || it.imdbId}
          item={it} layout={layout}
          onClick={onSelect}
        />
      ))}
    </div>
  );
};

// ─── SECTION ─────────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div className="t-section">
    <div className="t-section-hd">
      <h2 className="t-section-title">{title}</h2>
    </div>
    {children}
  </div>
);

// ─── HERO ─────────────────────────────────────────────────────
const Hero = ({ item, onSelect }) => {
  if (!item) return null;
  const r = getRating(item);
  const title = item.title || item.name || "Untitled";
  const rawBackdrop = item.backdropUrl || item.localBackdropUrl || item.posterUrl || item.localPosterUrl;
  const backdrop = rawBackdrop
    ? (rawBackdrop.startsWith("http") ? rawBackdrop : `${PROXY}${rawBackdrop}`)
    : null;

  return (
    <div className="t-hero" onClick={() => onSelect(item)}>
      <div className="t-hero-bg" />
      {backdrop && (
        <img src={backdrop} alt={title} className="t-hero-img"
          onError={e => { e.target.style.display = "none"; }} />
      )}
      <div className="t-hero-overlay" />
      <div className="t-hero-content">
        <div className="t-hero-tag"><span className="t-hero-dot" /> Trending Today</div>
        <h1 className="t-hero-title">{title}</h1>
        <div className="t-hero-meta">
          {item.year && <span>{item.year}</span>}
          {item.contentType && <span className="t-type-badge">{item.contentType}</span>}
          {r > 0 && <Stars val={r} />}
        </div>
        <div className="t-hero-actions">
          <button className="t-hero-btn-primary" onClick={e => { e.stopPropagation(); onSelect(item); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="m5 3 14 9-14 9V3z"/></svg>
            View Torrents
          </button>
          {item.maxSeeders > 0 && (
            <span className="t-hero-btn-ghost">▲ {fmtSeeds(item.maxSeeders)} seeds</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── PAGE BAR ─────────────────────────────────────────────────
const PageBar = ({ title, onBack, layout, onToggleLayout, children }) => (
  <div className="t-pagebar">
    <div className="t-pagebar-left">
      <button className="t-back-btn" onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 className="t-page-title">{title}</h1>
    </div>
    <div className="t-pagebar-right">
      {children}
      {onToggleLayout && (
        <button className="t-layout-btn" onClick={onToggleLayout}>
          <LayoutIcon mode={layout} />
        </button>
      )}
    </div>
  </div>
);

// ─── PILLS ────────────────────────────────────────────────────
const Pill = ({ label, active, onClick }) => (
  <button className={`t-pill${active ? " active" : ""}`} onClick={onClick}>{label}</button>
);

// ─── BOTTOM NAV ───────────────────────────────────────────────
const NAV = [
  { id:"home",      label:"Home",
    icon:(a)=><svg width="21" height="21" viewBox="0 0 24 24" fill={a?"currentColor":"none"} stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
  { id:"search",    label:"Search",
    icon:()=><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> },
  { id:"streaming", label:"Streaming",
    icon:(a)=><svg width="21" height="21" viewBox="0 0 24 24" fill={a?"currentColor":"none"} stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> },
 
];

const BottomNav = ({ view, onNav }) => (
  <nav className="t-nav">
    {NAV.map(({ id, label, icon }) => {
      const active = view === id;
      return (
        <button key={id} className={`t-nav-btn${active ? " active" : ""}`} onClick={() => onNav(id)}>
          {icon(active)}
          <span>{label}</span>
        </button>
      );
    })}
  </nav>
);


// ─── STREAMING RANK CARD ──────────────────────────────────────
const RankCard = ({ item, rank, svc, onSelect }) => (
  <div className="t-rank-card" onClick={() => onSelect(item)}>
    <div className={`t-rank-num${rank <= 3 ? " gold" : ""}`}>{rank}</div>
    {(item.posterUrl || item.localPosterUrl) && (
      <img src={item.localPosterUrl || item.posterUrl} alt={item.title} className="t-rank-poster" />
    )}
    <div className="t-rank-info">
      <div className="t-rank-title">{item.title}</div>
      <div className="t-rank-meta">
        {item.year && <span>{item.year}</span>}
        {item.rating && <Stars val={item.rating} />}
        {item.hasTorrents
          ? <span style={{ color:"var(--green)", fontWeight:600 }}>▲ {(item.maxSeeders||0).toLocaleString()}</span>
          : <span style={{ color:"var(--faint)" }}>No torrents</span>
        }
      </div>
    </div>
    {item.streamingLink && (
      <a href={item.streamingLink} target="_blank" rel="noreferrer"
        className="t-watch-btn" style={{ background: SVC_COLORS[svc] || "#333" }}
        onClick={e => e.stopPropagation()}>
        Watch
      </a>
    )}
  </div>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function TorrentHome() {
  const [view, setView]       = useState("home");
  const [query, setQuery]     = useState("");
  const [layout, setLayout]   = useState("grid");
  const [selected, setSelected] = useState(null);

  // All browse data
  const [data, setData]       = useState({ trending:[], popular:[], recent:[], upcoming:[], collections:[], streamingTop:[] });
  const [loading, setLoading] = useState({});
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

  // Search state
  const [searchRes, setSearchRes]     = useState([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage]   = useState(1);
  const [hasMore, setHasMore]         = useState(false);
  const [searching, setSearching]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter state
  const [trendPeriod, setTrendPeriod]   = useState("daily");
  const [streamSvc, setStreamSvc]       = useState("netflix");
  const [streamType, setStreamType]     = useState("movie");
  const [streamCountry, setStreamCountry] = useState("IN");
  const [typeFilter, setTypeFilter]     = useState("");
  const [genreFilter, setGenreFilter]   = useState("");
  const [sortFilter, setSortFilter]     = useState("relevance");
  const [qualFilter, setQualFilter]     = useState("");
  const [upcomingType, setUpcomingType] = useState("");

  const searchTimer = useRef(null);

  // ── generic fetch ──
  const fetchData = useCallback(async (key, path, params = {}, resKey = "items") => {
    setLoad(key, true);
    try {
      const d = await apiFetch(path, params);
      setData(p => ({ ...p, [key]: d[resKey] || d.results || [] }));
    } catch {
      setData(p => ({ ...p, [key]: [] }));
    }
    setLoad(key, false);
  }, []);

  // ── loaders ──
  const loadTrending   = useCallback((p = trendPeriod) => fetchData("trending",   "/api/v1/trending",   { period:p, limit:24 }), [fetchData, trendPeriod]);
  const loadPopular    = useCallback(()                 => fetchData("popular",    "/api/v1/popular",    { limit:24 }), [fetchData]);
  const loadRecent     = useCallback(()                 => fetchData("recent",     "/api/v1/recent",     { limit:24 }), [fetchData]);
  const loadUpcoming   = useCallback((t = upcomingType) => fetchData("upcoming",   "/api/v1/upcoming",   { limit:24, type: t || "all" }, "results"), [fetchData, upcomingType]);
  const loadCollections= useCallback(()                 => fetchData("collections","/api/v1/collections",{ limit:24 }), [fetchData]);
  const loadStreaming   = useCallback((svc=streamSvc, type=streamType, country=streamCountry) => {
    setLoad("streaming", true);
    apiFetch("/api/v1/streaming-top", { service:svc, show_type:type, country })
      .then(d => setData(p => ({ ...p, streamingTop: Array.isArray(d) ? d : [] })))
      .catch(() => setData(p => ({ ...p, streamingTop:[] })))
      .finally(() => setLoad("streaming", false));
  }, [streamSvc, streamType, streamCountry]);

  // ── search (fires only after user stops typing 500ms) ──
  const doSearch = useCallback(async (q, page=1, append=false) => {
    if (!q.trim()) return;
    append ? setLoadingMore(true) : setSearching(true);
    try {
      const params = { q, limit:20, page, sort:sortFilter };
      if (typeFilter)  params.type    = typeFilter;
      if (genreFilter) params.genre   = genreFilter;
      if (qualFilter)  params.quality = qualFilter;
      const d = await apiFetch("/api/v1/search", params);
      const res = d.results || [];
      append ? setSearchRes(prev => [...prev, ...res]) : setSearchRes(res);
      setSearchTotal(d.total || res.length);
      setHasMore(res.length === 20 && (d.total == null || page * 20 < (d.total || 0)));
      setSearchPage(page);
    } catch {
      if (!append) setSearchRes([]);
      setHasMore(false);
    }
    append ? setLoadingMore(false) : setSearching(false);
  }, [typeFilter, genreFilter, sortFilter, qualFilter]);

  // debounce
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchRes([]); setSearchTotal(0); setHasMore(false); return; }
    searchTimer.current = setTimeout(() => {
      setView("search"); setSearchPage(1); doSearch(query, 1);
    }, 500);
    return () => clearTimeout(searchTimer.current);
  }, [query, doSearch]);

  // re-search on filter change
  useEffect(() => {
    if (!query.trim() || view !== "search") return;
    setSearchPage(1); doSearch(query, 1);
    // eslint-disable-next-line
  }, [typeFilter, genreFilter, sortFilter, qualFilter]);

  // view change triggers data load
  useEffect(() => {
    if (view === "trending")    loadTrending(trendPeriod);
    else if (view === "popular")     loadPopular();
    else if (view === "recent")      loadRecent();
    else if (view === "upcoming")    loadUpcoming(upcomingType);
    else if (view === "collections") loadCollections();
    else if (view === "streaming")   loadStreaming(streamSvc, streamType, streamCountry);
    else if (view === "home") {
      loadTrending("daily"); loadPopular(); loadRecent(); loadUpcoming(); loadCollections();
    }
    // eslint-disable-next-line
  }, [view]);

  const handleNav = (id) => {
    if (id === "search") { setView("search"); return; }
    setView(id);
  };

  const toggle = () => setLayout(l => l === "grid" ? "list" : "grid");

  // ── If detail page is open, render it ──
  if (selected) {
    return <DetailPage item={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="t-app">

      {/* ── PERSISTENT SEARCH ── */}
      <SearchBar
        query={query}
        onChange={setQuery}
        onClear={() => { setQuery(""); setSearchRes([]); }}
        onSelect={s => { setQuery(s.title); doSearch(s.title, 1); setView("search"); }}
        onSearch={() => { setView("search"); doSearch(query, 1); }}
      />

      {/* ══════════════ HOME ══════════════ */}
      {view === "home" && (
        <>
          <Hero item={data.trending[0]} onSelect={setSelected} />
          <div className="t-home-wrap">
            {[
              { key:"trending",    title:"🔥 Trending",      dest:"trending" },
              { key:"popular",     title:"⭐ Most Popular",   dest:"popular" },
              { key:"recent",      title:"🕒 Recently Added", dest:"recent" },
              { key:"collections", title:"🎬 Collections",    dest:"collections" },
            ].map(({ key, title, dest }) => (
              <Section key={key} title={title}>
                <MovieGrid items={data[key].slice(0,12)} layout={layout} onSelect={setSelected} loading={loading[key]} />
              </Section>
            ))}
          </div>
        </>
      )}

      {/* ══════════════ TRENDING ══════════════ */}
      {view === "trending" && (
        <>
          <PageBar title="🔥 Trending" onBack={() => setView("home")} layout={layout} onToggleLayout={toggle} />
          <div className="t-pill-row">
            {["daily","weekly","monthly"].map(p => (
              <Pill key={p} label={p[0].toUpperCase()+p.slice(1)} active={trendPeriod===p}
                onClick={() => { setTrendPeriod(p); loadTrending(p); }} />
            ))}
          </div>
          <div className="t-section" style={{ paddingTop:14 }}>
            <MovieGrid items={data.trending} layout={layout} onSelect={setSelected} loading={loading.trending} emptyMsg="No trending content" />
          </div>
        </>
      )}

      {/* ══════════════ POPULAR ══════════════ */}
      {view === "popular" && (
        <>
          <PageBar title="⭐ Most Popular" onBack={() => setView("home")} layout={layout} onToggleLayout={toggle} />
          <div className="t-section" style={{ paddingTop:14 }}>
            <MovieGrid items={data.popular} layout={layout} onSelect={setSelected} loading={loading.popular} emptyMsg="No popular content" />
          </div>
        </>
      )}

      {/* ══════════════ RECENT ══════════════ */}
      {view === "recent" && (
        <>
          <PageBar title="🕒 Recently Added" onBack={() => setView("home")} layout={layout} onToggleLayout={toggle} />
          <div className="t-section" style={{ paddingTop:14 }}>
            <MovieGrid items={data.recent} layout={layout} onSelect={setSelected} loading={loading.recent} emptyMsg="No recent content" />
          </div>
        </>
      )}

      {/* ══════════════ UPCOMING ══════════════ */}
      {view === "upcoming" && (
        <>
          <PageBar title="📅 Upcoming" onBack={() => setView("home")} layout={layout} onToggleLayout={toggle} />
          <div className="t-pill-row">
            {[["","All"],["movie","Movies"],["show","Shows"]].map(([v,l]) => (
              <Pill key={v} label={l} active={upcomingType===v}
                onClick={() => { setUpcomingType(v); loadUpcoming(v); }} />
            ))}
          </div>
          <div className="t-section" style={{ paddingTop:14 }}>
            <MovieGrid items={data.upcoming} layout={layout} onSelect={setSelected} loading={loading.upcoming} emptyMsg="No upcoming releases" />
          </div>
        </>
      )}

      {/* ══════════════ COLLECTIONS ══════════════ */}
      {view === "collections" && (
        <>
          <PageBar title="🎬 Collections" onBack={() => setView("home")} />
          {loading.collections ? <Spinner />
            : data.collections.length === 0 ? <Empty icon="🎬" msg="No collections found" />
            : (
              <div className="t-coll-grid">
                {data.collections.map(c => (
                  <div key={c.id} className="t-coll-card" onClick={() => setSelected(c)}>
                    {c.posterUrl
                      ? <img src={c.posterUrl} alt={c.name} className="t-coll-img" />
                      : <div className="t-coll-img t-coll-ph">🎬</div>
                    }
                    <div className="t-coll-info">
                      <div className="t-coll-name">{c.name}</div>
                      <div className="t-coll-meta">
                        <span>{c.movieCount} films</span>
                        <span style={{ color:"var(--green)" }}>▲ {(c.totalSeeders||0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </>
      )}

      {/* ══════════════ STREAMING ══════════════ */}
      {view === "streaming" && (
        <>
          <div className="t-streaming-head">
            <h1 className="t-page-title" style={{ marginBottom:14 }}>📺 Streaming Top 10</h1>
            <div className="t-svc-scroll">
              {SERVICES.map(s => (
                <button key={s}
                  className={`t-svc-pill${streamSvc===s ? " active":""}`}
                  style={streamSvc===s ? { background:SVC_COLORS[s], borderColor:SVC_COLORS[s] } : {}}
                  onClick={() => { setStreamSvc(s); loadStreaming(s, streamType, streamCountry); }}>
                  <span className="t-svc-dot" style={{ background:SVC_COLORS[s] }} />
                  {SVC_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="t-pill-row" style={{ padding:"8px 0 10px" }}>
              {[["movie","Movies"],["series","Series"]].map(([v,l]) => (
                <Pill key={v} label={l} active={streamType===v}
                  onClick={() => { setStreamType(v); loadStreaming(streamSvc, v, streamCountry); }} />
              ))}
              {["US","GB","IN","DE","FR","AU","CA","BR"].map(c => (
                <Pill key={c} label={c} active={streamCountry===c}
                  onClick={() => { setStreamCountry(c); loadStreaming(streamSvc, streamType, c); }} />
              ))}
            </div>
          </div>
          {loading.streaming ? <Spinner />
            : data.streamingTop.length === 0 ? <Empty icon="📺" msg="No data for this selection" />
            : (
              <div className="t-rank-list">
                {data.streamingTop.map((item, i) => (
                  <RankCard key={item.rank||i} item={item} rank={item.rank||i+1} svc={streamSvc} onSelect={setSelected} />
                ))}
              </div>
            )
          }
        </>
      )}

      {/* ══════════════ SEARCH ══════════════ */}
      {view === "search" && (
        <>
          <div className="t-search-head">
            <div className="t-search-title-row">
              <h1 className="t-page-title">
                {query ? `"${query}"` : "Search"}
                {searchTotal > 0 && <span className="t-search-count"> — {searchTotal.toLocaleString()} results</span>}
              </h1>
              <button className="t-layout-btn" onClick={toggle}><LayoutIcon mode={layout} /></button>
            </div>
            <div className="t-pill-row" style={{ padding:"0 0 10px" }}>
              {[["","All"],["movie","Movies"],["show","Shows"]].map(([v,l]) => (
                <Pill key={v} label={l} active={typeFilter===v} onClick={() => setTypeFilter(v)} />
              ))}
            </div>
            <div className="t-filter-row">
              <select className="t-select" value={genreFilter} onChange={e => setGenreFilter(e.target.value)}>
                <option value="">All Genres</option>
                {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select className="t-select" value={qualFilter} onChange={e => setQualFilter(e.target.value)}>
                <option value="">Any Quality</option>
                {["480p","720p","1080p","2160p"].map(q => <option key={q} value={q}>{q}</option>)}
              </select>
              <select className="t-select" value={sortFilter} onChange={e => setSortFilter(e.target.value)}>
                {["relevance","seeders","year","rating","added"].map(s => (
                  <option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="t-section" style={{ paddingTop:14 }}>
            {searching && searchRes.length === 0 ? <Spinner />
              : searchRes.length > 0
                ? <>
                    <MovieGrid items={searchRes} layout={layout} onSelect={setSelected} loading={false} />
                    {hasMore && (
                      <div className="t-loadmore">
                        <button className="t-loadmore-btn" disabled={loadingMore}
                          onClick={() => doSearch(query, searchPage + 1, true)}>
                          {loadingMore ? "Loading…" : "Load More"}
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

      {/* ── BOTTOM NAV ── */}
      <BottomNav view={view} onNav={handleNav} />
    </div>
  );
}