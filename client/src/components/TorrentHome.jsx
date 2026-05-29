import React, { useState, useEffect, useCallback } from "react";
import "../assets/styles/TorrentHome.css";
import DetailPage from "./DetailPage";

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

const MovieCard = ({ item, onClick }) => {
  const r = getRating(item);
  const title = item.title || item.name || "Untitled";
  const poster = item.posterUrl || item.localPosterUrl || null;

  // FIX: Collections use 'totalSeeders', movies/shows use 'maxSeeders'.
  const seeds = item.maxSeeders ?? item.totalSeeders ?? 0;

  // FIX: The API does not send 'hasTorrents'. We assume torrents exist 
  // unless maxSeeders is explicitly 0 or hasTorrents is strictly false.
  const isMissingTorrents = item.hasTorrents === false || item.maxSeeders === 0;

  return (
    <div className="t-card" onClick={() => onClick(item)}>
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
      </div>
    </div>
  );
};

const MovieGrid = ({ items, onSelect, loading, emptyMsg }) => {
  if (loading) return <Spinner />;
  if (!items?.length) return <Empty icon="🎬" msg={emptyMsg || "Nothing here yet"} />;
  return (
    <div className="t-grid">
      {items.map(it => (
        <MovieCard
          key={it.id || it.tmdbId || it.imdbId}
          item={it}
          onClick={onSelect}
        />
      ))}
    </div>
  );
};

const Section = ({ title, action, children }) => (
  <div className="t-section">
    <div className="t-section-hd">
      <h2 className="t-section-title">{title}</h2>
      {action && <div className="t-section-action">{action}</div>}
    </div>
    {children}
  </div>
);

// ─── BOTTOM NAV ───────────────────────────────────────────────
const NAV = [
  { id: "home", label: "Home", icon: (a) => <svg width="21" height="21" viewBox="0 0 24 24" fill={a ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
  { id: "search", label: "Search", icon: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg> },
  { id: "streaming", label: "Streaming", icon: (a) => <svg width="21" height="21" viewBox="0 0 24 24" fill={a ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" /></svg> },
];

const BottomNav = ({ view, onNav }) => (
  <nav className="t-nav">
    <div className="t-nav-inner">
      {NAV.map(({ id, label, icon }) => {
        const active = view === id;
        return (
          <button key={id} className={`t-nav-btn${active ? " active" : ""}`} onClick={() => onNav(id)}>
            {icon(active)}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

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
  const [loading, setLoading] = useState({});
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

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
      // FIX: Ensure we always have an ID for React's key prop
      id: content.id || it.id || it.title,
      // FIX: The poster is nested inside 'content.poster'
      posterUrl: content.poster || it.posterUrl || null,
      contentType: it.mediaType || content.type
    };
  }), [fetchData]);

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
      <Hero item={data.trending[0]} onSelect={setSelected} />

      <div className="t-home-wrap">
        <Section
          title="🔥 Trending"
          action={
            <select className="t-select" value={trendingPeriod} onChange={(e) => setTrendingPeriod(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          }
        >
          <MovieGrid items={data.trending} onSelect={setSelected} loading={loading.trending} />
        </Section>

        <Section title="⭐ Most Popular">
          <MovieGrid items={data.popular} onSelect={setSelected} loading={loading.popular} />
        </Section>

        <Section title="🕒 Recently Added">
          <MovieGrid items={data.recent} onSelect={setSelected} loading={loading.recent} />
        </Section>

        <Section title="🎬 User Requested">
          <MovieGrid items={data.userrequested} onSelect={setSelected} loading={loading.userrequested} />
        </Section>

        <Section title="📚 Collections">
          <MovieGrid items={data.collections} onSelect={setSelected} loading={loading.collections} />
        </Section>
      </div>

      <BottomNav view={view} onNav={(id) => { if (id === "search") { setView("search"); } else { setView(id); } }} />
    </div>
  );
}