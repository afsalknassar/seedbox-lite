import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Rss, Plus, ExternalLink, Trash2, Link as LinkIcon, RefreshCw, Loader } from 'lucide-react';
import { config } from '../config/environment';
import '../assets/styles/RssReaderPage.css';

const RssReaderPage = () => {
  const [feeds, setFeeds] = useState(() => {
    const saved = localStorage.getItem('rss_feeds');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeFeed, setActiveFeed] = useState(null);
  const [feedItems, setFeedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedName, setNewFeedName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef(null);
  const feedItemsContainerRef = useRef(null);
  const activeFeedRef = useRef(null); // Track active feed for async safety

  useEffect(() => {
    localStorage.setItem('rss_feeds', JSON.stringify(feeds));
  }, [feeds]);

  /**
   * Parse RSS XML into an array of item objects.
   * Also extracts <atom:link rel="next"> if present.
   */
  const parseRSSItems = (xmlString) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    // Check for next page link in Atom namespace
    let nextPageUrl = null;
    const atomLinks = xmlDoc.querySelectorAll('link');
    atomLinks.forEach(link => {
      if (link.getAttribute('rel') === 'next') {
        nextPageUrl = link.getAttribute('href');
      }
    });

    const items = Array.from(xmlDoc.querySelectorAll("item")).map(item => {
      let link = item.querySelector("link")?.textContent || '';
      // Some feeds put magnet links in enclosure
      const enclosure = item.querySelector("enclosure");
      if (enclosure && enclosure.getAttribute("url")?.startsWith("magnet:")) {
        link = enclosure.getAttribute("url");
      }

      return {
        title: item.querySelector("title")?.textContent || 'No title',
        link: link,
        pubDate: item.querySelector("pubDate")?.textContent || '',
        description: item.querySelector("description")?.textContent || '',
      };
    });

    return { items, nextPageUrl };
  };

  /**
   * Build the paginated URL for a given feed and page number.
   * Tries common RSS pagination patterns: ?page=N, &page=N
   */
  const buildPageUrl = (baseUrl, page) => {
    if (page <= 1) return baseUrl;

    try {
      const url = new URL(baseUrl);
      url.searchParams.set('page', page.toString());
      return url.toString();
    } catch {
      // If URL parsing fails, just append ?page=N
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}page=${page}`;
    }
  };

  /**
   * Fetch a specific page of an RSS feed.
   */
  const fetchFeedPage = useCallback(async (feed, page) => {
    const pageUrl = buildPageUrl(feed.url, page);
    const response = await fetch(config.getApiUrl(`/api/rss/fetch?url=${encodeURIComponent(pageUrl)}`));
    if (!response.ok) throw new Error('Failed to fetch RSS feed');
    const data = await response.json();
    return parseRSSItems(data.contents);
  }, []);

  /**
   * Load the first page of a feed (resets everything).
   */
  const loadFeed = async (feed) => {
    setActiveFeed(feed);
    activeFeedRef.current = feed;
    setLoading(true);
    setFeedItems([]);
    setCurrentPage(1);
    setHasMore(true);

    try {
      const { items } = await fetchFeedPage(feed, 1);
      
      // Guard: make sure we're still on the same feed
      if (activeFeedRef.current?.id !== feed.id) return;

      setFeedItems(items);

      // If we got 0 items, no pagination needed
      if (items.length === 0) {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading RSS:", error);
      alert("Failed to load RSS feed. It might be invalid or unreachable.");
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load the next page (appends items).
   */
  const loadNextPage = useCallback(async () => {
    if (loadingMore || !hasMore || !activeFeedRef.current) return;

    const nextPage = currentPage + 1;
    setLoadingMore(true);

    try {
      const { items: newItems } = await fetchFeedPage(activeFeedRef.current, nextPage);

      // Guard: make sure we're still on the same feed
      if (!activeFeedRef.current) return;

      if (newItems.length === 0) {
        // No more items — this feed doesn't support pagination or we've reached the end
        setHasMore(false);
      } else {
        // Deduplicate by title+link combo to avoid repeats
        setFeedItems(prev => {
          const existingKeys = new Set(prev.map(i => `${i.title}|${i.link}`));
          const uniqueNew = newItems.filter(i => !existingKeys.has(`${i.title}|${i.link}`));
          
          if (uniqueNew.length === 0) {
            // All items were duplicates — feed doesn't actually paginate
            setHasMore(false);
            return prev;
          }
          
          return [...prev, ...uniqueNew];
        });
        setCurrentPage(nextPage);
      }
    } catch (error) {
      console.error("Error loading next page:", error);
      // Don't show alert for pagination failures, just stop trying
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [currentPage, loadingMore, hasMore, fetchFeedPage]);

  /**
   * IntersectionObserver: auto-load next page when sentinel is visible.
   */
  useEffect(() => {
    if (!sentinelRef.current || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, loadNextPage]);

  const handleAddFeed = (e) => {
    e.preventDefault();
    if (!newFeedUrl || !newFeedName) return;
    const newFeed = { id: Date.now().toString(), name: newFeedName, url: newFeedUrl };
    setFeeds([...feeds, newFeed]);
    setNewFeedName('');
    setNewFeedUrl('');
    setShowAddForm(false);
    loadFeed(newFeed);
  };

  const handleDeleteFeed = (id, e) => {
    e.stopPropagation();
    setFeeds(feeds.filter(f => f.id !== id));
    if (activeFeed?.id === id) {
      setActiveFeed(null);
      activeFeedRef.current = null;
      setFeedItems([]);
      setHasMore(false);
    }
  };

  return (
    <div className="rss-reader-page">
      <div className="page-header">
        <div className="fp-title-group">
          <div className="fp-title-icon">
            <Rss size={28} />
          </div>
          <h2>RSS Reader</h2>
        </div>
        <div className="fp-subtitle">
          Add RSS feeds to discover new torrents automatically
        </div>
      </div>

      <div className="rss-container">
        <div className="rss-sidebar">
          <div className="sidebar-header">
            <h2>Your Feeds</h2>
            <button
              className="add-feed-button"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus size={16} /> Add Feed
            </button>
          </div>

          {showAddForm && (
            <form className="add-feed-form" onSubmit={handleAddFeed}>
              <input
                type="text"
                placeholder="Feed Name"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                required
              />
              <input
                type="url"
                placeholder="RSS URL"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                required
              />
              <div className="form-actions">
                <button type="button" onClick={() => setShowAddForm(false)} className="cancel-btn">Cancel</button>
                <button type="submit" className="save-btn">Save</button>
              </div>
            </form>
          )}

          <div className="feeds-list">
            {feeds.length === 0 && !showAddForm ? (
              <div className="no-feeds">No feeds added yet.</div>
            ) : (
              feeds.map(feed => (
                <div
                  key={feed.id}
                  className={`feed-item ${activeFeed?.id === feed.id ? 'active' : ''}`}
                  onClick={() => loadFeed(feed)}
                >
                  <div className="feed-info">
                    <Rss size={16} className="feed-icon" />
                    <span>{feed.name}</span>
                  </div>
                  <button className="delete-btn" onClick={(e) => handleDeleteFeed(feed.id, e)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rss-content">
          {activeFeed ? (
            <div className="feed-view">
              <div className="feed-view-header">
                <div className="feed-header-left">
                  <h2>{activeFeed.name}</h2>
                  {feedItems.length > 0 && (
                    <span className="item-count">{feedItems.length} items loaded</span>
                  )}
                </div>
                <button className="refresh-btn" onClick={() => loadFeed(activeFeed)} disabled={loading}>
                  <RefreshCw size={16} className={loading ? 'spinning' : ''} /> Refresh
                </button>
              </div>

              {loading ? (
                <div className="loading-state">Loading feed items...</div>
              ) : feedItems.length === 0 ? (
                <div className="empty-state">No items found in this feed.</div>
              ) : (
                <div className="feed-items" ref={feedItemsContainerRef}>
                  {feedItems.map((item, index) => (
                    <div key={`${index}-${item.title}`} className="feed-article">
                      <h3>{item.title}</h3>
                      {item.pubDate && <span className="pub-date">{new Date(item.pubDate).toLocaleString()}</span>}
                      <div className="article-actions">
                        {item.link && !item.link.startsWith('magnet:') && (
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="link-btn">
                            <ExternalLink size={14} /> Open Link
                          </a>
                        )}
                        {item.link && (item.link.startsWith('magnet:') || item.link.includes('torrent')) && (
                          <button
                            className="copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(item.link);
                              alert('Link copied! You can paste it in the home page.');
                            }}
                          >
                            <LinkIcon size={14} /> Copy Link
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Infinite scroll sentinel */}
                  <div ref={sentinelRef} className="scroll-sentinel">
                    {loadingMore && (
                      <div className="loading-more">
                        <Loader size={18} className="spinning" />
                        <span>Loading more items...</span>
                      </div>
                    )}
                    {!hasMore && feedItems.length > 0 && (
                      <div className="end-of-feed">
                        — End of feed —
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="welcome-state">
              <Rss size={48} className="welcome-icon" />
              <h2>Select a feed</h2>
              <p>Choose a feed from the sidebar or add a new one to get started.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RssReaderPage;
