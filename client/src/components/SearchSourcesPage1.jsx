//just experimenting with the api not ready yet

import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PROXY   = "https://rich-clownfish-18.epaperhubdaily.deno.net";
const API_KEY = "tc_cc07d834fe3a9fb54d4343e379eec4d8c74f898c9d6048c1"; // replace with your real key

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (!b) return null;
  const n = typeof b === "string" ? parseInt(b, 10) : b;
  if (isNaN(n) || n === 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
};

const rating = (item) =>
  parseFloat(item?.ratingImdb || item?.ratingTmdb || item?.rating || 0) || 0;

const QUALITY_COLORS = {
  "2160p": { bg: "rgba(168,85,247,0.18)", text: "#c084fc", border: "rgba(168,85,247,0.35)" },
  "1080p": { bg: "rgba(59,130,246,0.18)", text: "#60a5fa", border: "rgba(59,130,246,0.35)" },
  "720p":  { bg: "rgba(16,185,129,0.18)", text: "#34d399", border: "rgba(16,185,129,0.35)" },
  "480p":  { bg: "rgba(245,158,11,0.18)", text: "#fbbf24", border: "rgba(245,158,11,0.35)" },
};

const SERVICES = ["netflix","prime","disney","apple","crunchyroll"];
const SERVICE_LABELS = { netflix:"Netflix", prime:"Prime", disney:"Disney+", apple:"Apple TV+", crunchyroll:"Crunchyroll" };
const SERVICE_COLORS = { netflix:"#e50914", prime:"#00a8e1", disney:"#113ccf", apple:"#555", crunchyroll:"#ff6400" };

// ─── ATOMS ───────────────────────────────────────────────────────────────────
const QBadge = ({ q }) => {
  if (!q) return null;
  const c = QUALITY_COLORS[q] || { bg: "rgba(100,100,100,0.18)", text: "#9ca3af", border: "rgba(100,100,100,0.35)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`, letterSpacing: "0.5px" }}>
      {q}
    </span>
  );
};

const Score = ({ s }) => {
  if (s == null) return null;
  const col = s >= 80 ? "#34d399" : s >= 55 ? "#60a5fa" : s >= 35 ? "#fbbf24" : "#f87171";
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: col, background: `${col}22`,
      border: `1px solid ${col}44`, borderRadius: 5, padding: "2px 6px" }}>
      {s}
    </span>
  );
};

const Stars = ({ val }) => {
  const v = parseFloat(val) || 0;
  const stars = Math.round((v / 10) * 5);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24"
          fill={i <= stars ? "#f59e0b" : "none"} stroke={i <= stars ? "#f59e0b" : "#4b5563"} strokeWidth="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
      {v > 0 && <span style={{ color: "#9ca3af", fontSize: 11, marginLeft: 3 }}>{v.toFixed(1)}</span>}
    </span>
  );
};

const Spinner = () => (
  <div style={{ display:"flex", justifyContent:"center", padding:"60px 0" }}>
    <div style={{ width:36, height:36, borderRadius:"50%",
      border:"3px solid rgba(255,255,255,0.07)", borderTopColor:"#3b82f6",
      animation:"spin 0.75s linear infinite" }} />
  </div>
);

const Empty = ({ icon, msg, sub }) => (
  <div style={{ textAlign:"center", padding:"64px 0", color:"#4b5563" }}>
    <div style={{ fontSize:40, marginBottom:12 }}>{icon}</div>
    <div style={{ color:"#9ca3af", fontSize:15, marginBottom:4 }}>{msg}</div>
    {sub && <div style={{ fontSize:13 }}>{sub}</div>}
  </div>
);

// ─── TORRENT ROW ─────────────────────────────────────────────────────────────
const TorrentRow = ({ t }) => {
  const size = fmtBytes(t.sizeBytes);
  return (
    <div style={{ padding:"12px 14px", borderRadius:10, background:"rgba(17,24,39,0.55)",
      border:"1px solid rgba(255,255,255,0.06)", display:"flex", flexDirection:"column", gap:7 }}>
      <div style={{ color:"#e5e7eb", fontSize:12, lineHeight:1.4, fontFamily:"'JetBrains Mono','Fira Mono',monospace", wordBreak:"break-all" }}>
        {t.rawTitle}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
        <QBadge q={t.quality} />
        <Score s={t.qualityScore} />
        {t.sourceType && <span style={{ color:"#8b5cf6", fontSize:10, background:"rgba(139,92,246,0.1)",
          border:"1px solid rgba(139,92,246,0.25)", borderRadius:5, padding:"2px 6px" }}>{t.sourceType}</span>}
        {t.codec && <span style={{ color:"#6b7280", fontSize:10 }}>{t.codec}</span>}
        {t.audioCodec && <span style={{ color:"#6b7280", fontSize:10 }}>{t.audioCodec}</span>}
        {t.hdrType && <span style={{ color:"#f59e0b", fontSize:10, background:"rgba(245,158,11,0.1)",
          border:"1px solid rgba(245,158,11,0.25)", borderRadius:5, padding:"2px 6px" }}>{t.hdrType}</span>}
        {t.verified && <span style={{ color:"#34d399", fontSize:10, background:"rgba(52,211,153,0.1)",
          border:"1px solid rgba(52,211,153,0.25)", borderRadius:5, padding:"2px 6px" }}>✓ TrueSpec</span>}
        {size && <span style={{ color:"#6b7280", fontSize:10, marginLeft:"auto" }}>{size}</span>}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <span style={{ color:"#34d399", fontSize:11 }}>▲ {t.seeders} seeds</span>
        <span style={{ color:"#f87171", fontSize:11 }}>▼ {t.leechers} leechers</span>
        {t.releaseGroup && <span style={{ color:"#6b7280", fontSize:11 }}>{t.releaseGroup}</span>}
        {t.isProper && <span style={{ color:"#a78bfa", fontSize:10 }}>PROPER</span>}
        {t.isRepack && <span style={{ color:"#a78bfa", fontSize:10 }}>REPACK</span>}
        <div style={{ marginLeft:"auto", display:"flex", gap:8, width: "100%", justifyContent: "flex-end", marginTop: 4 }} className="torrent-actions">
          {t.magnetUrl && (
            <a href={t.magnetUrl} title="Magnet" style={{ color:"#3b82f6", fontSize:11,
              background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.25)",
              borderRadius:6, padding:"4px 10px", textDecoration:"none", display:"flex", alignItems:"center", gap:4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
              </svg>
              Magnet
            </a>
          )}
          {t.torrentUrl && (
            <a href={`${PROXY}${t.torrentUrl}`} title=".torrent" style={{ color:"#8b5cf6", fontSize:11,
              background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)",
              borderRadius:6, padding:"4px 10px", textDecoration:"none" }}>
              .torrent
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── MOVIE CARD ───────────────────────────────────────────────────────────────
const MovieCard = ({ item, onClick, layout = "grid" }) => {
  const [hov, setHov] = useState(false);
  const r = rating(item);
  const title = item.title || item.name || "Untitled";
  const poster = item.posterUrl || item.localPosterUrl || null;
  const year = item.year;
  const seeds = item.maxSeeders ?? 0;

  if (layout === "list") {
    return (
      <div onClick={() => onClick(item)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display:"flex", gap:14, padding:12, borderRadius:12, cursor:"pointer",
          background: hov ? "rgba(31,41,55,0.7)" : "rgba(17,24,39,0.5)",
          border:"1px solid rgba(255,255,255,0.06)", transition:"background 0.18s", alignItems:"flex-start" }}>
        <div style={{ width:56, height:84, borderRadius:7, overflow:"hidden", flexShrink:0, background:"#111827" }}>
          {poster && <img src={poster} alt={title} style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:"#f3f4f6", fontWeight:600, fontSize:14, marginBottom:3,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
            {year && <span style={{ color:"#6b7280", fontSize:12 }}>{year}</span>}
            <span style={{ color:"#6b7280", fontSize:12, textTransform:"capitalize" }}>{item.contentType}</span>
            {seeds > 0 && <span style={{ color:"#34d399", fontSize:11 }}>▲ {seeds.toLocaleString()}</span>}
          </div>
          <Stars val={r} />
          {item.overview && (
            <p style={{ color:"#9ca3af", fontSize:12, marginTop:5, lineHeight:1.5,
              display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
              {item.overview}
            </p>
          )}
          {item.genres?.length > 0 && (
            <div style={{ display:"flex", gap:5, marginTop:6, flexWrap:"wrap" }}>
              {item.genres.slice(0,3).map(g => (
                <span key={g} style={{ fontSize:10, color:"#8b5cf6", background:"rgba(139,92,246,0.1)",
                  border:"1px solid rgba(139,92,246,0.2)", borderRadius:4, padding:"1px 6px" }}>{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div onClick={() => onClick(item)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderRadius:13, overflow:"hidden", cursor:"pointer",
        background:"rgba(17,24,39,0.5)", border:"1px solid rgba(255,255,255,0.06)",
        transition:"transform 0.22s cubic-bezier(0.25,0.8,0.25,1), box-shadow 0.22s",
        transform: hov ? "translateY(-4px) scale(1.02)" : "none",
        boxShadow: hov ? "0 16px 36px rgba(0,0,0,0.55)" : "none" }}>
      <div style={{ position:"relative", paddingTop:"152%", overflow:"hidden", background:"#0d1117" }}>
        {poster
          ? <img src={poster} alt={title} style={{ position:"absolute", inset:0, width:"100%", height:"100%",
              objectFit:"cover", transition:"transform 0.3s", transform: hov ? "scale(1.06)" : "scale(1)" }} />
          : <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <path d="m7 2 .01 20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>
              </svg>
            </div>
        }
        {r > 0 && (
          <div style={{ position:"absolute", top:7, right:7, background:"rgba(0,0,0,0.75)",
            backdropFilter:"blur(4px)", borderRadius:7, padding:"3px 7px",
            display:"flex", alignItems:"center", gap:3 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
            </svg>
            <span style={{ color:"#f9fafb", fontSize:11, fontWeight:700 }}>{r.toFixed(1)}</span>
          </div>
        )}
        {!item.hasTorrents && (
          <div style={{ position:"absolute", top:7, left:7, background:"rgba(0,0,0,0.65)",
            borderRadius:5, padding:"2px 6px" }}>
            <span style={{ color:"#6b7280", fontSize:9 }}>NO TORRENTS</span>
          </div>
        )}
        {hov && item.overview && (
          <div className="hover-overview" style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(3,7,18,0.96) 0%,transparent 55%)",
            display:"flex", flexDirection:"column", justifyContent:"flex-end", padding:"10px 10px 12px" }}>
            <p style={{ color:"#d1d5db", fontSize:11, lineHeight:1.5,
              display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
              {item.overview}
            </p>
          </div>
        )}
      </div>
      <div style={{ padding:"9px 11px 11px" }}>
        <div style={{ color:"#f3f4f6", fontWeight:600, fontSize:13, marginBottom:3,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#6b7280", fontSize:11 }}>{year || "—"}</span>
          {seeds > 0 && <span style={{ color:"#34d399", fontSize:10 }}>▲ {seeds >= 1000 ? `${(seeds/1000).toFixed(1)}k` : seeds}</span>}
        </div>
      </div>
    </div>
  );
};

// ─── MODAL ────────────────────────────────────────────────────────────────────
const Modal = ({ item, onClose }) => {
  const [tab, setTab]           = useState("torrents");
  const [comments, setComments] = useState([]);
  const [loadingC, setLoadingC] = useState(false);
  const r    = rating(item);
  const title = item.title || item.name || "Untitled";
  const torrents = item.torrents || [];

  useEffect(() => {
    if (tab !== "comments" || !item.id) return;
    setLoadingC(true);
    apiFetch("/api/v1/comments", { content_id: item.id, limit: 20 })
      .then(d => setComments(d?.comments || d?.results || []))
      .catch(() => setComments([]))
      .finally(() => setLoadingC(false));
  }, [tab, item.id]);

  const backdrop = item.backdropUrl || null;
  const poster   = item.posterUrl || item.localPosterUrl || null;
  const genres   = item.genres || [];
  const streaming = item.streaming;

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(3,7,18,0.88)", backdropFilter:"blur(10px)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#0c1322",
        borderRadius:20, border:"1px solid rgba(255,255,255,0.09)",
        width:"100%", maxWidth:900, maxHeight:"92vh", overflow:"hidden", display:"flex", flexDirection:"column" }}>

        {/* Backdrop hero */}
        <div style={{ position:"relative", height:240, flexShrink:0, overflow:"hidden" }}>
          {backdrop
            ? <img src={backdrop} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            : <div style={{ width:"100%", height:"100%", background:"linear-gradient(135deg,#1e3a5f 0%,#2d1b69 100%)" }} />
          }
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom,transparent 25%,#0c1322 100%)" }} />
          <button onClick={onClose} style={{ position:"absolute", top:14, right:14,
            background:"rgba(0,0,0,0.65)", border:"none", borderRadius:"50%",
            width:34, height:34, cursor:"pointer", color:"#fff", fontSize:20,
            display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
          {/* IMDB / TMDB badge */}
          {item.imdbId && (
            <a href={`https://www.imdb.com/title/${item.imdbId}`} target="_blank" rel="noreferrer"
              style={{ position:"absolute", top:14, left:14, background:"rgba(0,0,0,0.6)",
                border:"none", borderRadius:7, padding:"4px 10px", color:"#f59e0b",
                fontSize:11, fontWeight:700, textDecoration:"none" }}>IMDb ↗</a>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY:"auto", flex:1, padding:"0 26px 28px" }}>
          {/* Header */}
          <div className="modal-header" style={{ display:"flex", gap:18, alignItems:"flex-end", marginTop:-70, marginBottom:20 }}>
            {poster && (
              <img src={poster} alt={title} className="modal-poster" style={{ width:96, height:144, borderRadius:10,
                border:"2px solid rgba(255,255,255,0.13)", objectFit:"cover", flexShrink:0 }} />
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <h2 style={{ color:"#f9fafb", fontSize:22, fontWeight:800, lineHeight:1.2, marginBottom:6 }}>{title}</h2>
              {item.titleOriginal && item.titleOriginal !== title && (
                <div style={{ color:"#6b7280", fontSize:13, marginBottom:5 }}>{item.titleOriginal}</div>
              )}
              <div className="modal-meta" style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center", marginBottom:8 }}>
                {item.year && <span style={{ color:"#9ca3af", fontSize:13 }}>{item.year}</span>}
                {item.contentType && <span style={{ color:"#6b7280", fontSize:12, textTransform:"capitalize",
                  background:"rgba(255,255,255,0.05)", borderRadius:5, padding:"2px 7px" }}>{item.contentType}</span>}
                {r > 0 && <Stars val={r} />}
              </div>
              {genres.length > 0 && (
                <div className="modal-genres" style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {genres.map(g => (
                    <span key={g} style={{ fontSize:11, color:"#8b5cf6", background:"rgba(139,92,246,0.12)",
                      border:"1px solid rgba(139,92,246,0.22)", borderRadius:5, padding:"2px 8px" }}>{g}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Overview */}
          {item.overview && (
            <p style={{ color:"#9ca3af", fontSize:13, lineHeight:1.75, marginBottom:20, maxWidth:700 }}>
              {item.overview}
            </p>
          )}

          {/* Streaming availability */}
          {streaming && Object.values(streaming).some(a => a?.length > 0) && (
            <div style={{ marginBottom:20 }}>
              <div style={{ color:"#6b7280", fontSize:11, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Also on</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                {["flatrate","rent","buy","free"].flatMap(type =>
                  (streaming[type] || []).map(p => (
                    <a key={`${type}-${p.providerId}`} href={p.link || "#"} target="_blank" rel="noreferrer"
                      title={`${p.name} (${type})`} style={{ display:"flex", alignItems:"center", gap:5,
                        background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)",
                        borderRadius:7, padding:"4px 10px", textDecoration:"none", color:"#d1d5db", fontSize:12 }}>
                      {p.logo && <img src={p.logo} alt={p.name} style={{ height:14, borderRadius:2 }} />}
                      {p.name}
                    </a>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:"flex", gap:2, borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:18 }}>
            {[
              { id:"torrents", label:`Torrents (${torrents.length})` },
              { id:"comments", label:"Comments" },
            ].map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding:"8px 18px", background:"none", border:"none", cursor:"pointer", fontSize:13,
                color: tab === id ? "#3b82f6" : "#6b7280", fontWeight: tab === id ? 600 : 400,
                borderBottom: tab === id ? "2px solid #3b82f6" : "2px solid transparent",
                transition:"all 0.18s" }}>
                {label}
              </button>
            ))}
          </div>

          {/* Torrents tab */}
          {tab === "torrents" && (
            <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
              {torrents.length === 0
                ? <Empty icon="🌊" msg="No torrents found" sub="Try searching directly" />
                : torrents.sort((a,b) => (b.qualityScore||0) - (a.qualityScore||0)).map((t,i) => (
                    <TorrentRow key={t.infoHash || i} t={t} />
                  ))
              }
            </div>
          )}

          {/* Comments tab */}
          {tab === "comments" && (
            <div>
              {loadingC ? <Spinner /> : comments.length === 0
                ? <Empty icon="💬" msg="No comments yet" />
                : comments.map((c, i) => (
                    <div key={c.id || i} style={{ padding:"12px 0",
                      borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ display:"flex", gap:8, alignItems:"baseline", marginBottom:4 }}>
                        <span style={{ color:"#e5e7eb", fontSize:13, fontWeight:600 }}>{c.username || "Anonymous"}</span>
                        <span style={{ color:"#4b5563", fontSize:11 }}>{c.score != null ? `▲ ${c.score}` : ""}</span>
                      </div>
                      <p style={{ color:"#9ca3af", fontSize:13, lineHeight:1.6 }}>{c.body || c.text || ""}</p>
                    </div>
                  ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────
const Autocomplete = ({ query, onSelect }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [show, setShow] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.length < 2) { setSuggestions([]); setShow(false); return; }
    timerRef.current = setTimeout(() => {
      apiFetch("/api/v1/autocomplete", { q: query })
        .then(d => { setSuggestions(d.suggestions || []); setShow(true); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  if (!show || suggestions.length === 0) return null;

  return (
    <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:200,
      background:"#0f1623", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12,
      overflow:"hidden", boxShadow:"0 16px 40px rgba(0,0,0,0.6)" }}>
      {suggestions.map(s => (
        <button key={s.id} onClick={() => { onSelect(s); setShow(false); }} style={{
          display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 14px",
          background:"none", border:"none", cursor:"pointer", textAlign:"left",
          borderBottom:"1px solid rgba(255,255,255,0.04)",
          "&:hover": { background:"rgba(255,255,255,0.04)" }
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
        onMouseLeave={e => e.currentTarget.style.background = "none"}>
          {s.posterUrl && <img src={s.posterUrl} alt="" style={{ width:32, height:48, objectFit:"cover", borderRadius:4, flexShrink:0 }} />}
          <div>
            <div style={{ color:"#f3f4f6", fontSize:13, fontWeight:500 }}>{s.title}</div>
            <div style={{ color:"#6b7280", fontSize:11 }}>{s.year || ""} · {s.contentType}</div>
          </div>
          {s.contentType === "collection" && s.movieCount && (
            <span style={{ marginLeft:"auto", color:"#8b5cf6", fontSize:11 }}>{s.movieCount} films</span>
          )}
        </button>
      ))}
    </div>
  );
};

// ─── PILL ─────────────────────────────────────────────────────────────────────
const Pill = ({ children, active, onClick }) => (
  <button onClick={onClick} style={{
    padding:"6px 14px", borderRadius:20, fontSize:12, cursor:"pointer", border:"none",
    background: active ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "rgba(255,255,255,0.05)",
    color: active ? "#fff" : "#9ca3af", fontWeight: active ? 600 : 400,
    transition:"all 0.18s", whiteSpace:"nowrap" }}>{children}</button>
);

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const GENRES = ["Action","Adventure","Animation","Comedy","Crime","Documentary","Drama",
  "Family","Fantasy","History","Horror","Mystery","Romance","Science Fiction","Thriller","War","Western"];

export default function App() {
  const [view,         setView]         = useState("home");
  const [query,        setQuery]        = useState("");
  const [layout,       setLayout]       = useState("grid");
  const [selected,     setSelected]     = useState(null);

  // Data buckets
  const [trending,     setTrending]     = useState([]);
  const [popular,      setPopular]      = useState([]);
  const [recent,       setRecent]       = useState([]);
  const [upcoming,     setUpcoming]     = useState([]);
  const [collections,  setCollections]  = useState([]);
  const [streamingTop, setStreamingTop] = useState([]);
  const [searchRes,    setSearchRes]    = useState([]);
  const [stats,        setStats]        = useState(null);

  // Loading / pagination
  const [loading,      setLoading]      = useState(false);
  const [searching,    setSearching]    = useState(false);
  const [searchPage,   setSearchPage]   = useState(1);
  const [searchTotal,  setSearchTotal]  = useState(0);
  const [hasMore,      setHasMore]      = useState(false);

  // Filters
  const [typeFilter,   setTypeFilter]   = useState("");        // "" | "movie" | "show"
  const [genreFilter,  setGenreFilter]  = useState("");
  const [sortFilter,   setSortFilter]   = useState("relevance");
  const [qualFilter,   setQualFilter]   = useState("");
  const [trendPeriod,  setTrendPeriod]  = useState("daily");
  const [streamSvc,    setStreamSvc]    = useState("netflix");
  const [streamType,   setStreamType]   = useState("movie");
  const [streamCountry,setStreamCountry]= useState("US");

  const searchTimer = useRef(null);

  // ── fetch helpers ──
  const loadTrending = useCallback(async (period = trendPeriod) => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/trending", { period, limit:24 });
      setTrending(d.items || []);
    } catch(e) { setTrending([]); }
    setLoading(false);
  }, [trendPeriod]);

  const loadPopular = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/popular", { limit:24 });
      setPopular(d.items || []);
    } catch(e) { setPopular([]); }
    setLoading(false);
  }, []);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/recent", { limit:24 });
      setRecent(d.items || []);
    } catch(e) { setRecent([]); }
    setLoading(false);
  }, []);

  const loadUpcoming = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/upcoming", { limit:24, type: typeFilter || "all" });
      setUpcoming(d.results || d.items || []);
    } catch(e) { setUpcoming([]); }
    setLoading(false);
  }, [typeFilter]);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/collections", { limit:24 });
      setCollections(d.items || []);
    } catch(e) { setCollections([]); }
    setLoading(false);
  }, []);

  const loadStreamingTop = useCallback(async (svc = streamSvc, st = streamType, country = streamCountry) => {
    setLoading(true);
    try {
      const d = await apiFetch("/api/v1/streaming-top", { service:svc, show_type:st, country });
      setStreamingTop(Array.isArray(d) ? d : []);
    } catch(e) { setStreamingTop([]); }
    setLoading(false);
  }, [streamSvc, streamType, streamCountry]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch("/api/v1/stats"); setStats(d); }
    catch(e) { setStats(null); }
    setLoading(false);
  }, []);

  const doSearch = useCallback(async (q, page = 1, append = false) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const params = { q, limit:20, page, sort:sortFilter };
      if (typeFilter)  params.type    = typeFilter;
      if (genreFilter) params.genre   = genreFilter;
      if (qualFilter)  params.quality = qualFilter;
      const d = await apiFetch("/api/v1/search", params);
      const res = d.results || [];
      if (append) setSearchRes(prev => [...prev, ...res]);
      else        setSearchRes(res);
      setSearchTotal(d.total || res.length);
      setHasMore(res.length === 20);
    } catch(e) { if (!append) setSearchRes([]); }
    setSearching(false);
  }, [typeFilter, genreFilter, sortFilter, qualFilter]);

  // Trigger search on query / filter change
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchRes([]); return; }
    searchTimer.current = setTimeout(() => {
      setSearchPage(1);
      setView("search");
      doSearch(query, 1);
    }, 380);
    return () => clearTimeout(searchTimer.current);
  }, [query, typeFilter, genreFilter, sortFilter, qualFilter, doSearch]);

  // Load section on tab change
  useEffect(() => {
    if (view === "trending")    loadTrending(trendPeriod);
    if (view === "popular")     loadPopular();
    if (view === "recent")      loadRecent();
    if (view === "upcoming")    loadUpcoming();
    if (view === "collections") loadCollections();
    if (view === "streaming")   loadStreamingTop(streamSvc, streamType, streamCountry);
    if (view === "stats")       loadStats();
    if (view === "home") {
      Promise.all([
        loadTrending("daily"),
        loadPopular(),
        loadRecent(),
        loadUpcoming(),
        loadCollections()
      ]);
    }
  // eslint-disable-next-line
  }, [view]);

  // ── render sections ──
  const GridSection = ({ title, items, emptyMsg, onViewAll }) => (
    <div style={{ marginBottom:36 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <h2 style={{ color:"#f9fafb", fontSize:17, fontWeight:700, margin:0 }}>{title}</h2>
        {onViewAll && (
          <button onClick={onViewAll} style={{
            background:"none", border:"none", color:"#3b82f6", fontSize:13,
            fontWeight:600, cursor:"pointer", transition:"opacity 0.2s"
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            View All ↗
          </button>
        )}
      </div>
      {loading ? <Spinner /> : items.length === 0
        ? <Empty icon="🎬" msg={emptyMsg || "Nothing here yet"} />
        : <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ 
            display: "grid", gap: 13,
            gridTemplateColumns: layout === "grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr" 
          }}>
            {items.map(it => <MovieCard key={it.id} item={it} onClick={setSelected} layout={layout} />)}
          </div>
      }
    </div>
  );

  // ── header ──
  const Header = () => (
    <header style={{ position:"sticky", top:0, zIndex:100,
      background:"rgba(3,7,18,0.88)", backdropFilter:"blur(16px)",
      borderBottom:"1px solid rgba(255,255,255,0.055)", height:66,
      display:"flex", alignItems:"center", gap:12, padding:"0 22px" }}>
      
      {/* Back to Home Button */}
      {view !== "home" && (
        <button onClick={() => setView("home")} style={{
          background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:8, padding:"6px", color:"#9ca3af", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
      )}

      {/* Search */}
      <div style={{ flex:1, maxWidth:480, position:"relative" }}>
        <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search movies, TV shows…"
          style={{ width:"100%", padding:"8px 36px", borderRadius:10,
            border:"1px solid rgba(255,255,255,0.08)", background:"rgba(17,24,39,0.6)",
            color:"#f9fafb", fontSize:13, outline:"none", boxSizing:"border-box",
            transition:"border 0.18s", fontFamily:"inherit" }}
          onFocus={e => e.target.style.borderColor = "rgba(59,130,246,0.45)"}
          onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
        />
        {query && (
          <button onClick={() => { setQuery(""); setSearchRes([]); }}
            style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
              background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
        )}
        <Autocomplete query={query} onSelect={s => { setQuery(s.title); doSearch(s.title, 1); setView("search"); }} />
      </div>

      <div className="header-controls" style={{ display:"flex", gap:12, marginLeft:"auto" }}>
        {/* Type filter */}
        <div className="hide-on-mobile" style={{ display:"flex", gap:5 }}>
          {[["","All"],["movie","Movies"],["show","Shows"]].map(([v,l]) => (
            <Pill key={v} active={typeFilter===v} onClick={() => setTypeFilter(v)}>{l}</Pill>
          ))}
        </div>

        {/* Layout toggle */}
        <button onClick={() => setLayout(l => l==="grid"?"list":"grid")} style={{
          padding:"7px 9px", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)",
          background:"rgba(17,24,39,0.6)", color:"#9ca3af", cursor:"pointer" }}>
          {layout === "grid"
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
          }
        </button>
      </div>
    </header>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#030712", display:"flex",
      fontFamily:"'Outfit','Segoe UI',sans-serif", color:"#f9fafb", overflow:"hidden" }}>
      
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", height:"100vh" }}>
        <Header />
        <main className="main-content" style={{ flex:1, overflowY:"auto", padding:"22px 24px" }}>

          {/* ── HOME ── */}
          {view === "home" && (
            <>
              {/* Hero – first trending item */}
              {trending[0] && (() => {
                const hero = trending[0];
                const hr = rating(hero);
                return (
                  <div onClick={() => setSelected(hero)} style={{ position:"relative", borderRadius:18,
                    overflow:"hidden", marginBottom:32, height:300, cursor:"pointer" }}>
                    {hero.backdropUrl
                      ? <img src={hero.backdropUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      : <div style={{ width:"100%", height:"100%", background:"linear-gradient(135deg,#1e3a5f,#2d1b69)" }} />
                    }
                    <div style={{ position:"absolute", inset:0,
                      background:"linear-gradient(to right,rgba(3,7,18,0.92) 38%,transparent)" }} />
                    <div className="hero-content" style={{ position:"absolute", inset:0, padding:"0 36px", display:"flex",
                      flexDirection:"column", justifyContent:"center" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                        <div style={{ width:5, height:5, borderRadius:"50%", background:"#3b82f6" }} />
                        <span style={{ color:"#3b82f6", fontSize:11, fontWeight:600, letterSpacing:1, textTransform:"uppercase" }}>
                          Trending Today
                        </span>
                      </div>
                      <h1 className="hero-title" style={{ color:"#fff", fontSize:28, fontWeight:800, marginBottom:8, maxWidth:440, lineHeight:1.2 }}>
                        {hero.title}
                      </h1>
                      <Stars val={hr} />
                      <div style={{ display:"flex", gap:10, marginTop:16 }}>
                        <button onClick={e => { e.stopPropagation(); setSelected(hero); }} style={{
                          padding:"9px 20px", borderRadius:9, border:"none",
                          background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",
                          color:"#fff", fontWeight:600, fontSize:13, cursor:"pointer",
                          display:"flex", alignItems:"center", gap:6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="m5 3 14 9-14 9V3z"/></svg>
                          View Torrents
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <GridSection title="🔥 Trending Today"  items={trending.slice(0,12)} onViewAll={() => setView("trending")} />
              <GridSection title="⭐ Most Popular"     items={popular.slice(0,12)}  onViewAll={() => setView("popular")} />
              <GridSection title="🕒 Recently Added"   items={recent.slice(0,12)}   onViewAll={() => setView("recent")} />
              <GridSection title="📅 Upcoming"         items={upcoming.slice(0,12)} onViewAll={() => setView("upcoming")} />
              <GridSection title="🎬 Collections"      items={collections.slice(0,12)} onViewAll={() => setView("collections")} />
            </>
          )}

          {/* ── TRENDING ── */}
          {view === "trending" && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18, flexWrap:"wrap" }}>
                <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700 }}>🔥 Trending</h1>
                <div style={{ display:"flex", gap:5, marginLeft:8 }}>
                  {["daily","weekly","monthly"].map(p => (
                    <Pill key={p} active={trendPeriod===p} onClick={() => { setTrendPeriod(p); loadTrending(p); }}>
                      {p.charAt(0).toUpperCase()+p.slice(1)}
                    </Pill>
                  ))}
                </div>
              </div>
              {loading ? <Spinner /> : <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ display:"grid",
                gridTemplateColumns: layout==="grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr", gap:13 }}>
                {trending.map(it => <MovieCard key={it.id} item={it} onClick={setSelected} layout={layout} />)}
              </div>}
            </>
          )}

          {/* ── POPULAR ── */}
          {view === "popular" && (
            <>
              <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700, marginBottom:18 }}>⭐ Most Popular</h1>
              {loading ? <Spinner /> : <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ display:"grid",
                gridTemplateColumns: layout==="grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr", gap:13 }}>
                {popular.map(it => <MovieCard key={it.id} item={it} onClick={setSelected} layout={layout} />)}
              </div>}
            </>
          )}

          {/* ── RECENT ── */}
          {view === "recent" && (
            <>
              <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700, marginBottom:18 }}>🕒 Recently Added</h1>
              {loading ? <Spinner /> : <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ display:"grid",
                gridTemplateColumns: layout==="grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr", gap:13 }}>
                {recent.map(it => <MovieCard key={it.id} item={it} onClick={setSelected} layout={layout} />)}
              </div>}
            </>
          )}

          {/* ── UPCOMING ── */}
          {view === "upcoming" && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18, flexWrap:"wrap" }}>
                <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700 }}>📅 Upcoming Releases</h1>
                <div style={{ display:"flex", gap:5 }}>
                  {[["all","All"],["movie","Movies"],["show","Shows"]].map(([v,l]) => (
                    <Pill key={v} active={typeFilter===v} onClick={() => { setTypeFilter(v); loadUpcoming(); }}>
                      {l}
                    </Pill>
                  ))}
                </div>
              </div>
              {loading ? <Spinner /> : upcoming.length === 0
                ? <Empty icon="📅" msg="No upcoming releases found" />
                : <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ display:"grid",
                    gridTemplateColumns: layout==="grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr", gap:13 }}>
                    {upcoming.map(it => <MovieCard key={it.id || it.tmdbId} item={it} onClick={setSelected} layout={layout} />)}
                  </div>
              }
            </>
          )}

          {/* ── STREAMING TOP 10 ── */}
          {view === "streaming" && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
                <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700 }}>📺 Streaming Top 10</h1>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
                {SERVICES.map(s => (
                  <Pill key={s} active={streamSvc===s} onClick={() => { setStreamSvc(s); loadStreamingTop(s, streamType, streamCountry); }}>
                    {SERVICE_LABELS[s]}
                  </Pill>
                ))}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                {[["movie","Movies"],["series","Series"]].map(([v,l]) => (
                  <Pill key={v} active={streamType===v} onClick={() => { setStreamType(v); loadStreamingTop(streamSvc, v, streamCountry); }}>{l}</Pill>
                ))}
                {["US","GB","IN","DE","FR","AU","CA","BR"].map(c => (
                  <Pill key={c} active={streamCountry===c} onClick={() => { setStreamCountry(c); loadStreamingTop(streamSvc, streamType, c); }}>{c}</Pill>
                ))}
              </div>
              {loading ? <Spinner /> : streamingTop.length === 0
                ? <Empty icon="📺" msg="No data for this selection" />
                : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {streamingTop.map((item, i) => (
                      <div key={item.rank || i} onClick={() => item.contentId && setSelected(item)}
                        style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 16px", borderRadius:12,
                          background:"rgba(17,24,39,0.5)", border:"1px solid rgba(255,255,255,0.06)",
                          cursor: item.contentId ? "pointer" : "default",
                          transition:"background 0.18s", flexWrap: "wrap" }}
                        onMouseEnter={e => { if(item.contentId) e.currentTarget.style.background="rgba(31,41,55,0.65)"; }}
                        onMouseLeave={e => e.currentTarget.style.background="rgba(17,24,39,0.5)"}>
                        <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0,
                          background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#fff", fontWeight:800, fontSize:13 }}>{item.rank}</div>
                        {(item.posterUrl || item.localPosterUrl) && (
                          <img src={item.localPosterUrl || item.posterUrl} alt={item.title}
                            style={{ width:48, height:72, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
                        )}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:"#f3f4f6", fontWeight:600, fontSize:14, marginBottom:3,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                            {item.year && <span style={{ color:"#6b7280", fontSize:12 }}>{item.year}</span>}
                            {item.rating && <Stars val={item.rating} />}
                            {item.hasTorrents
                              ? <span style={{ color:"#34d399", fontSize:11 }}>▲ {(item.maxSeeders||0).toLocaleString()} seeds</span>
                              : <span style={{ color:"#4b5563", fontSize:11 }}>No torrents</span>
                            }
                          </div>
                          {item.genres?.length > 0 && (
                            <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                              {item.genres.slice(0,3).map(g => (
                                <span key={g} style={{ fontSize:10, color:"#8b5cf6",
                                  background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.2)",
                                  borderRadius:4, padding:"1px 6px" }}>{g}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {item.streamingLink && (
                          <a href={item.streamingLink} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()} style={{
                              background: SERVICE_COLORS[streamSvc] || "#333",
                              color:"#fff", fontSize:11, fontWeight:600, borderRadius:7,
                              padding:"5px 11px", textDecoration:"none", flexShrink:0 }}>
                            Watch ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
              }
            </>
          )}

          {/* ── COLLECTIONS ── */}
          {view === "collections" && (
            <>
              <h1 style={{ color:"#f9fafb", fontSize:20, fontWeight:700, marginBottom:18 }}>🎬 Movie Collections</h1>
              {loading ? <Spinner /> : collections.length === 0
                ? <Empty icon="🎬" msg="No collections found" />
                : <div className="collection-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
                    {collections.map(c => (
                      <div key={c.id} style={{ borderRadius:13, overflow:"hidden",
                        background:"rgba(17,24,39,0.5)", border:"1px solid rgba(255,255,255,0.06)",
                        transition:"transform 0.2s", cursor:"pointer" }}
                        onMouseEnter={e => e.currentTarget.style.transform="translateY(-3px)"}
                        onMouseLeave={e => e.currentTarget.style.transform="none"}>
                        {c.posterUrl
                          ? <img src={c.posterUrl} alt={c.name}
                              style={{ width:"100%", height:140, objectFit:"cover" }} />
                          : <div style={{ width:"100%", height:140,
                              background:"linear-gradient(135deg,#1e3a5f,#2d1b69)",
                              display:"flex", alignItems:"center", justifyContent:"center" }}>
                              <span style={{ fontSize:28 }}>🎬</span>
                            </div>
                        }
                        <div style={{ padding:"10px 12px 12px" }}>
                          <div style={{ color:"#f3f4f6", fontWeight:600, fontSize:13, marginBottom:4,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span style={{ color:"#6b7280", fontSize:11 }}>{c.movieCount} films</span>
                            <span style={{ color:"#34d399", fontSize:11 }}>▲ {(c.totalSeeders||0).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </>
          )}

          {/* ── SEARCH ── */}
          {view === "search" && (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                marginBottom:14, flexWrap:"wrap", gap:10 }}>
                <h1 style={{ color:"#f9fafb", fontSize:18, fontWeight:700 }}>
                  {query ? `Results for "${query}"` : "Search"}
                  {searchTotal > 0 && <span style={{ color:"#6b7280", fontSize:13, fontWeight:400 }}> — {searchTotal.toLocaleString()} found</span>}
                </h1>
              </div>

              {/* Advanced filters row */}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
                {/* Genre */}
                <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)",
                    background:"rgba(17,24,39,0.6)", color: genreFilter ? "#f9fafb" : "#6b7280",
                    fontSize:12, cursor:"pointer", outline:"none", fontFamily:"inherit" }}>
                  <option value="">All Genres</option>
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                {/* Quality */}
                <select value={qualFilter} onChange={e => setQualFilter(e.target.value)}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)",
                    background:"rgba(17,24,39,0.6)", color: qualFilter ? "#f9fafb" : "#6b7280",
                    fontSize:12, cursor:"pointer", outline:"none", fontFamily:"inherit" }}>
                  <option value="">Any Quality</option>
                  {["480p","720p","1080p","2160p"].map(q => <option key={q} value={q}>{q}</option>)}
                </select>
                {/* Sort */}
                <select value={sortFilter} onChange={e => setSortFilter(e.target.value)}
                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)",
                    background:"rgba(17,24,39,0.6)", color:"#f9fafb",
                    fontSize:12, cursor:"pointer", outline:"none", fontFamily:"inherit" }}>
                  {["relevance","seeders","year","rating","added"].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>
                  ))}
                </select>
              </div>

              {searching && searchRes.length === 0 ? <Spinner />
              : searchRes.length > 0 ? (
                <>
                  <div className={`movie-grid ${layout === 'grid' ? 'grid-layout' : 'list-layout'}`} style={{ display:"grid",
                    gridTemplateColumns: layout==="grid" ? "repeat(auto-fill,minmax(148px,1fr))" : "1fr", gap:13 }}>
                    {searchRes.map(it => <MovieCard key={it.id} item={it} onClick={setSelected} layout={layout} />)}
                  </div>
                  {hasMore && (
                    <div style={{ textAlign:"center", marginTop:28 }}>
                      <button onClick={() => { const p = searchPage+1; setSearchPage(p); doSearch(query, p, true); }}
                        style={{ padding:"9px 28px", borderRadius:9,
                          border:"1px solid rgba(59,130,246,0.4)", background:"rgba(59,130,246,0.1)",
                          color:"#60a5fa", fontSize:13, cursor:"pointer", fontWeight:600 }}>
                        {searching ? "Loading…" : "Load More"}
                      </button>
                    </div>
                  )}
                </>
              ) : query
                ? <Empty icon="🔍" msg={`No results for "${query}"`} sub="Try different keywords or remove filters" />
                : <Empty icon="🔍" msg="Start typing to search" />
              }
            </>
          )}

        </main>
      </div>

      {/* Modal */}
      {selected && <Modal item={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.09); border-radius:3px; }
        input, button, select { font-family:inherit; }
        select option { background:#0f1623; color:#f9fafb; }
        @keyframes spin { to { transform:rotate(360deg); } }

        /* --- RESPONSIVE MEDIA QUERIES --- */
        @media (max-width: 768px) {
          .main-content {
            padding: 16px 12px !important;
          }
          .movie-grid.grid-layout {
            grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
            gap: 10px !important;
          }
          .collection-grid {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important;
          }
          .hero-content {
            padding: 0 20px !important;
          }
          .hero-title {
            font-size: 20px !important;
          }
          .modal-header {
            flex-direction: column !important;
            align-items: center;
            text-align: center;
            margin-top: -50px !important;
          }
          .modal-poster {
            width: 80px !important;
            height: 120px !important;
          }
          .modal-meta, .modal-genres {
            justify-content: center !important;
          }
          .torrent-actions {
            width: 100%;
            justify-content: flex-start !important;
          }
          .hide-on-mobile {
            display: none !important;
          }
          .hover-overview {
            display: none !important; /* Disabling hover text on small touch devices */
          }
        }
      `}</style>
    </div>
  );
}