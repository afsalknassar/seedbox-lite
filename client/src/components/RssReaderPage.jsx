import React, { useState, useEffect } from 'react';
import { Rss, Plus, ExternalLink, Trash2, Link as LinkIcon, RefreshCw } from 'lucide-react';
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
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedName, setNewFeedName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    localStorage.setItem('rss_feeds', JSON.stringify(feeds));
  }, [feeds]);

  const loadFeed = async (feed) => {
    setActiveFeed(feed);
    setLoading(true);
    setFeedItems([]);
    try {
      const response = await fetch(config.getApiUrl(`/api/rss/fetch?url=${encodeURIComponent(feed.url)}`));
      if (!response.ok) throw new Error('Failed to fetch RSS feed');
      const data = await response.json();

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data.contents, "text/xml");

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
      setFeedItems(items);
    } catch (error) {
      console.error("Error loading RSS:", error);
      alert("Failed to load RSS feed. It might be invalid or unreachable.");
    } finally {
      setLoading(false);
    }
  };

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
      setFeedItems([]);
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
                <h2>{activeFeed.name}</h2>
                <button className="refresh-btn" onClick={() => loadFeed(activeFeed)} disabled={loading}>
                  <RefreshCw size={16} className={loading ? 'spinning' : ''} /> Refresh
                </button>
              </div>

              {loading ? (
                <div className="loading-state">Loading feed items...</div>
              ) : feedItems.length === 0 ? (
                <div className="empty-state">No items found in this feed.</div>
              ) : (
                <div className="feed-items">
                  {feedItems.map((item, index) => (
                    <div key={index} className="feed-article">
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
