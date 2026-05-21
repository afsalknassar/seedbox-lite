// Torrent history service for managing added torrents
class TorrentHistoryService {
  constructor() {
    this.storageKey = 'seedbox-torrent-history';
  }

  // Add a torrent to history
  addTorrent(torrentData) {
    try {
      const history = this.getHistory();
      const torrentEntry = {
        infoHash: torrentData.infoHash,
        name: torrentData.name || `Torrent ${torrentData.infoHash.substring(0, 8)}`,
        addedAt: new Date().toISOString(),
        source: torrentData.source || 'unknown', // 'magnet', 'file', 'url'
        originalInput: torrentData.originalInput || '',
        size: torrentData.size || 0,
        lastAccessed: new Date().toISOString()
      };

      // Remove if already exists (to update position)
      const filteredHistory = history.filter(t => t.infoHash !== torrentEntry.infoHash);

      // Add to beginning of list
      const newHistory = [torrentEntry, ...filteredHistory];

      // Keep only last 50 torrents
      const trimmedHistory = newHistory.slice(0, 50);

      localStorage.setItem(this.storageKey, JSON.stringify(trimmedHistory));
      console.log(`📝 Added torrent to history: ${torrentEntry.name}`);

      return torrentEntry;
    } catch (error) {
      console.error('Error adding torrent to history:', error);
      return null;
    }
  }

  // Update poster URL for a specific torrent
  updatePoster(infoHash, posterUrl) {
    if (!posterUrl || posterUrl === 'N/A') return;

    try {
      const history = this.getHistory();
      const torrentIndex = history.findIndex(t => t.infoHash === infoHash);

      // Only update if the torrent exists in history and the poster is actually new/different
      if (torrentIndex !== -1 && history[torrentIndex].poster !== posterUrl) {
        history[torrentIndex].poster = posterUrl;
        localStorage.setItem(this.storageKey, JSON.stringify(history));
        console.log(`🖼️ Updated poster in history for: ${infoHash}`);
      }
    } catch (error) {
      console.error('Error updating poster:', error);
    }
  }

  // Get all torrent history
  getHistory() {
    try {
      const history = localStorage.getItem(this.storageKey);
      return history ? JSON.parse(history) : [];
    } catch (error) {
      console.error('Error loading torrent history:', error);
      return [];
    }
  }

  // Update last accessed time
  updateLastAccessed(infoHash) {
    try {
      const history = this.getHistory();
      const torrentIndex = history.findIndex(t => t.infoHash === infoHash);

      if (torrentIndex !== -1) {
        history[torrentIndex].lastAccessed = new Date().toISOString();
        localStorage.setItem(this.storageKey, JSON.stringify(history));
      }
    } catch (error) {
      console.error('Error updating last accessed:', error);
    }
  }

  // Get torrent by infoHash
  getTorrentByInfoHash(infoHash) {
    try {
      const history = this.getHistory();
      return history.find(t => t.infoHash === infoHash);
    } catch (error) {
      console.error('Error getting torrent by infoHash:', error);
      return null;
    }
  }

  // Remove a torrent from history
  removeTorrent(infoHash) {
    try {
      const history = this.getHistory();
      const filteredHistory = history.filter(t => t.infoHash !== infoHash);
      localStorage.setItem(this.storageKey, JSON.stringify(filteredHistory));
      console.log(`🗑️ Removed torrent from history: ${infoHash}`);
    } catch (error) {
      console.error('Error removing torrent from history:', error);
    }
  }

  // Get recent torrents (last 10)
  getRecentTorrents(limit = 10) {
    const history = this.getHistory();
    return history.slice(0, limit);
  }

  // Search torrents by name
  searchTorrents(query) {
    const history = this.getHistory();
    const lowerQuery = query.toLowerCase();
    return history.filter(torrent =>
      torrent.name.toLowerCase().includes(lowerQuery) ||
      torrent.originalInput.toLowerCase().includes(lowerQuery)
    );
  }

  // Clear all history
  clearHistory() {
    try {
      localStorage.removeItem(this.storageKey);
      console.log('🧹 Cleared all torrent history');
    } catch (error) {
      console.error('Error clearing torrent history:', error);
    }
  }

  // Get statistics
  getStats() {
    const history = this.getHistory();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    return {
      total: history.length,
      addedToday: history.filter(t => new Date(t.addedAt) >= today).length,
      addedThisWeek: history.filter(t => new Date(t.addedAt) >= thisWeek).length,
      addedThisMonth: history.filter(t => new Date(t.addedAt) >= thisMonth).length,
      totalSize: history.reduce((sum, t) => sum + (t.size || 0), 0)
    };
  }
}

// Create and export singleton instance
const torrentHistoryService = new TorrentHistoryService();
export default torrentHistoryService;
