import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, Clock, Film } from 'lucide-react';
import VideoModal from './VideoModal';
import progressService from '../services/progressService';
import '../assets/styles/RecentPage.css';

const RecentPage = () => {
  const navigate = useNavigate();
  const [recentVideos, setRecentVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [stats, setStats] = useState({});

  useEffect(() => {
    loadRecentVideos();
    loadStats();
  }, []);

  const loadRecentVideos = () => {
    const videos = progressService.getRecentVideos(20);
    setRecentVideos(videos);
  };

  const loadStats = () => {
    const statistics = progressService.getStats();
    setStats(statistics);
  };

  const handleVideoSelect = (video) => {
    setSelectedVideo({
      src: `/api/video/${video.torrentHash}/${video.fileIndex}`,
      title: video.fileName,
      torrentHash: video.torrentHash,
      fileIndex: video.fileIndex
    });
  };

  const handleRemoveProgress = (video) => {
    if (window.confirm('Remove this video from recent list?')) {
      progressService.removeProgress(video.torrentHash, video.fileIndex);
      loadRecentVideos();
      loadStats();
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Clear all video progress? This cannot be undone.')) {
      progressService.clearAllProgress();
      loadRecentVideos();
      loadStats();
    }
  };

  const goToTorrent = (torrentHash) => {
    navigate(`/torrent/${torrentHash}`);
  };

  return (
    <div className="recent-page">
      <div className="page-header">
        <div className="header-content">
          <h1>
            <Clock size={28} />
            Recent Videos
          </h1>
          <p>Continue watching where you left off</p>
        </div>
        
        {recentVideos.length > 0 && (
          <button onClick={handleClearAll} className="clear-all-button">
            <Trash2 size={16} />
            Clear All
          </button>
        )}
      </div>

      {/* Statistics */}
      {Object.keys(stats).length > 0 && (
        <div className="stats-section">
          <h2>Statistics</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.totalVideos}</div>
              <div className="stat-label">Total Videos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.completed}</div>
              <div className="stat-label">Completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.inProgress}</div>
              <div className="stat-label">In Progress</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalWatchTime}</div>
              <div className="stat-label">Watch Time</div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Videos */}
      <div className="videos-section">
        {recentVideos.length === 0 ? (
          <div className="empty-state">
            <Film size={48} />
            <h3>No recent videos</h3>
            <p>Start watching videos to see them here</p>
            <button onClick={() => navigate('/')} className="browse-button">
              Browse Torrents
            </button>
          </div>
        ) : (
          <div className="videos-grid">
            {recentVideos.map((video, index) => (
              <div key={`${video.torrentHash}-${video.fileIndex}`} className="video-card">
                <div className="video-progress-bg">
                  <div 
                    className="video-progress-fill" 
                    style={{ width: `${video.percentage}%` }}
                  ></div>
                </div>
                
                <div className="video-content">
                  <div className="video-info">
                    <h3 className="video-title" title={video.fileName}>
                      {video.fileName}
                    </h3>
                    <div className="video-meta">
                      <span className="progress-text">
                        {progressService.formatTime(video.currentTime)} / {progressService.formatTime(video.duration)}
                      </span>
                      <span className="watch-time">
                        {progressService.formatRelativeTime(video.lastWatched)}
                      </span>
                    </div>
                    <div className="progress-percentage">
                      {Math.round(video.percentage)}% completed
                      {video.isCompleted && <span className="completed-badge">✓</span>}
                    </div>
                  </div>
                  
                  <div className="video-actions">
                    <button 
                      onClick={() => handleVideoSelect(video)}
                      className="play-action"
                      title="Continue watching"
                    >
                      <Play size={16} />
                    </button>
                    <button 
                      onClick={() => goToTorrent(video.torrentHash)}
                      className="torrent-action"
                      title="View torrent"
                    >
                      <Film size={16} />
                    </button>
                    <button 
                      onClick={() => handleRemoveProgress(video)}
                      className="remove-action"
                      title="Remove from recent"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedVideo && (
        <VideoModal
          isOpen={true}
          onClose={() => setSelectedVideo(null)}
          src={selectedVideo.src}
          title={selectedVideo.title}
          torrentHash={selectedVideo.torrentHash}
          fileIndex={selectedVideo.fileIndex}
        />
      )}
    </div>
  );
};

export default RecentPage;
