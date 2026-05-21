import React, { useState, useEffect } from 'react';
import { Search, Plus, ExternalLink, Edit, Trash2, Download, Upload, Move, ArrowUp, ArrowDown } from 'lucide-react';
import searchSourcesService from '../services/searchSourcesService';
import './SearchSourcesPage.css';

const SearchSourcesPage = () => {
  const [sources, setSources] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [formData, setFormData] = useState({ name: '', url: '', description: '', icon: '🔍' });
  const [activeSourceId, setActiveSourceId] = useState(null);
  const [iframeUrl, setIframeUrl] = useState('');
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importJson, setImportJson] = useState('');

  // Available icons for sources
  const availableIcons = ['🔍', '🌐', '🔎', '📚', '🎬', '🎵', '📺', '💻', '📱', '🎮', '📖', '🧩', '🔬', '🔮', '📡'];

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = () => {
    const loadedSources = searchSourcesService.getSources();
    setSources(loadedSources);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    try {
      if (editingSource) {
        // Update existing source
        searchSourcesService.updateSource(editingSource.id, formData);
      } else {
        // Add new source
        searchSourcesService.addSource(formData);
      }
      
      // Reset form and reload sources
      setFormData({ name: '', url: '', description: '', icon: '🔍' });
      setEditingSource(null);
      setShowForm(false);
      loadSources();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleEdit = (source) => {
    setFormData({
      name: source.name,
      url: source.url,
      description: source.description || '',
      icon: source.icon || '🔍'
    });
    setEditingSource(source);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this search source?')) {
      try {
        searchSourcesService.removeSource(id);
        
        // Reset active source if it's being deleted
        if (activeSourceId === id) {
          setActiveSourceId(null);
          setIframeUrl('');
        }
        
        loadSources();
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    }
  };

  const handleOpenSource = (source) => {
    setActiveSourceId(source.id);
    setIframeUrl(source.url);
  };

  const handleMoveSource = (id, direction) => {
    const sourceIndex = sources.findIndex(s => s.id === id);
    if ((direction === 'up' && sourceIndex === 0) || 
        (direction === 'down' && sourceIndex === sources.length - 1)) {
      return; // Can't move further
    }
    
    const newSources = [...sources];
    const sourceToMove = newSources[sourceIndex];
    
    if (direction === 'up') {
      newSources[sourceIndex] = newSources[sourceIndex - 1];
      newSources[sourceIndex - 1] = sourceToMove;
    } else {
      newSources[sourceIndex] = newSources[sourceIndex + 1];
      newSources[sourceIndex + 1] = sourceToMove;
    }
    
    // Save the new order
    const sourceIds = newSources.map(s => s.id);
    try {
      searchSourcesService.reorderSources(sourceIds);
      loadSources();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleDragStart = (e, id) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Use a transparent image as drag ghost
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    e.dataTransfer.setDragImage(img, 0, 0);
    // Add styling to the dragged item
    e.currentTarget.classList.add('dragging');
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('dragging');
    setDraggedItemId(null);
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    if (id !== draggedItemId) {
      const draggedIndex = sources.findIndex(s => s.id === draggedItemId);
      const hoverIndex = sources.findIndex(s => s.id === id);
      
      if (draggedIndex !== -1 && hoverIndex !== -1) {
        const newSources = [...sources];
        const draggedItem = newSources[draggedIndex];
        
        // Remove the dragged item
        newSources.splice(draggedIndex, 1);
        // Insert it at the hover position
        newSources.splice(hoverIndex, 0, draggedItem);
        
        // Update the order in the UI without saving yet
        setSources(newSources);
      }
    }
  };

  const handleDragDrop = () => {
    // Save the new order after drop
    const sourceIds = sources.map(s => s.id);
    try {
      searchSourcesService.reorderSources(sourceIds);
    } catch (error) {
      // Revert to original order if there was an error
      loadSources();
      alert(`Error: ${error.message}`);
    }
  };

  const handleImportExport = (action) => {
    if (action === 'export') {
      const sourcesJson = searchSourcesService.exportSources();
      setImportJson(JSON.stringify(sourcesJson, null, 2));
    } else {
      setImportJson('');
    }
    setShowImportExport(true);
  };

  const handleImport = () => {
    try {
      const sourcesData = JSON.parse(importJson);
      searchSourcesService.importSources(sourcesData);
      setShowImportExport(false);
      setImportJson('');
      loadSources();
      alert('Search sources imported successfully!');
    } catch (error) {
      alert(`Import error: ${error.message}`);
    }
  };

  const closeIframe = () => {
    setIframeUrl('');
    setActiveSourceId(null);
  };

  return (
    <div className="search-sources-page">
      <div className="page-header">
        <h1>
          <Search size={28} />
          Torrent Search Sources
        </h1>
        <p>Add, manage, and use your own torrent search websites</p>
      </div>

      <div className="search-sources-container">
        <div className="sources-sidebar">
          <div className="sidebar-header">
            <h2>Your Search Sources</h2>
            <button 
              className="add-source-button" 
              onClick={() => { 
                setEditingSource(null); 
                setFormData({ name: '', url: '', description: '', icon: '🔍' });
                setShowForm(true); 
              }}
            >
              <Plus size={16} /> Add Source
            </button>
          </div>

          <div className="sources-list">
            {sources.length === 0 ? (
              <div className="no-sources">
                <p>No search sources added yet.</p>
                <p>Click "Add Source" to get started!</p>
              </div>
            ) : (
              sources.map((source) => (
                <div 
                  key={source.id} 
                  className={`source-item ${activeSourceId === source.id ? 'active' : ''} ${draggedItemId === source.id ? 'dragging' : ''}`}
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, source.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, source.id)}
                  onDrop={handleDragDrop}
                >
                  <div className="source-item-content">
                    <div className="source-icon">{source.icon || '🔍'}</div>
                    <div className="source-details">
                      <h3>{source.name}</h3>
                      {source.description && <p>{source.description}</p>}
                    </div>
                  </div>
                  <div className="source-actions">
                    <button onClick={() => handleMoveSource(source.id, 'up')} title="Move Up">
                      <ArrowUp size={16} />
                    </button>
                    <button onClick={() => handleMoveSource(source.id, 'down')} title="Move Down">
                      <ArrowDown size={16} />
                    </button>
                    <button onClick={() => handleOpenSource(source)} title="Open Search">
                      <ExternalLink size={16} />
                    </button>
                    <button onClick={() => handleEdit(source)} title="Edit">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => handleDelete(source.id)} title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="sources-footer">
            <button className="import-button" onClick={() => handleImportExport('import')}>
              <Upload size={16} /> Import Sources
            </button>
            <button 
              className="export-button" 
              onClick={() => handleImportExport('export')}
              disabled={sources.length === 0}
            >
              <Download size={16} /> Export Sources
            </button>
          </div>
        </div>

        <div className="sources-content">
          {showForm ? (
            <div className="source-form-container">
              <h2>{editingSource ? 'Edit Search Source' : 'Add New Search Source'}</h2>
              <form className="source-form" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="name">Name</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleFormChange}
                    placeholder="e.g., My Search Site"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="url">URL</label>
                  <input
                    type="url"
                    id="url"
                    name="url"
                    value={formData.url}
                    onChange={handleFormChange}
                    placeholder="https://example.com/search"
                    required
                  />
                  <small>Enter the full website URL where you search for torrents</small>
                </div>

                <div className="form-group">
                  <label htmlFor="description">Description (Optional)</label>
                  <input
                    type="text"
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleFormChange}
                    placeholder="e.g., Movie torrents search"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="icon">Icon</label>
                  <div className="icon-selector">
                    {availableIcons.map((icon) => (
                      <span 
                        key={icon}
                        className={`icon-option ${formData.icon === icon ? 'selected' : ''}`}
                        onClick={() => setFormData({ ...formData, icon })}
                      >
                        {icon}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" onClick={() => setShowForm(false)} className="cancel-button">
                    Cancel
                  </button>
                  <button type="submit" className="save-button">
                    {editingSource ? 'Update Source' : 'Add Source'}
                  </button>
                </div>
              </form>
            </div>
          ) : iframeUrl ? (
            <div className="iframe-container">
              <div className="iframe-header">
                <h2>
                  {sources.find(s => s.id === activeSourceId)?.name || 'Search'}
                </h2>
                <button onClick={closeIframe} className="close-iframe">
                  Close
                </button>
              </div>
              <iframe 
                src={iframeUrl} 
                title="Torrent Search" 
                className="search-iframe"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              />
              <div className="iframe-footer">
                <p>
                  <strong>Note:</strong> This is an external website. SeedBox Lite is not responsible for its content.
                </p>
              </div>
            </div>
          ) : (
            <div className="search-instructions">
              <div className="instructions-content">
                <div className="instructions-icon">🔍</div>
                <h2>Custom Torrent Search</h2>
                <p>Add your preferred torrent search websites and access them directly within SeedBox Lite.</p>
                
                <div className="instruction-steps">
                  <div className="step">
                    <div className="step-number">1</div>
                    <div className="step-content">
                      <h3>Add Search Sources</h3>
                      <p>Click "Add Source" to add your preferred torrent search websites.</p>
                    </div>
                  </div>
                  
                  <div className="step">
                    <div className="step-number">2</div>
                    <div className="step-content">
                      <h3>Access Your Sources</h3>
                      <p>Click on the external link icon to open any source in a secure iframe.</p>
                    </div>
                  </div>
                  
                  <div className="step">
                    <div className="step-number">3</div>
                    <div className="step-content">
                      <h3>Find & Download</h3>
                      <p>Search for content, copy magnet links, and paste them in the SeedBox Lite homepage.</p>
                    </div>
                  </div>
                </div>
                
                <div className="instructions-note">
                  <p><strong>Privacy Note:</strong> All your search sources are saved locally on your device. We don't store or promote any specific torrent websites.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showImportExport && (
        <div className="modal-overlay">
          <div className="import-export-modal">
            <h2>{importJson ? 'Export Search Sources' : 'Import Search Sources'}</h2>
            
            <div className="import-export-content">
              <textarea 
                value={importJson} 
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={importJson ? '' : 'Paste your search sources JSON here...'}
                readOnly={!!importJson && importJson.length > 0}
              />
              
              <div className="format-help">
                <h4>Format Example:</h4>
                <pre>{`[
  {
    "name": "Example Search",
    "url": "https://example.com/search",
    "description": "Example search site",
    "icon": "🔍"
  }
]`}</pre>
              </div>
            </div>
            
            <div className="modal-actions">
              <button onClick={() => setShowImportExport(false)} className="cancel-button">
                Close
              </button>
              
              {!importJson && (
                <button onClick={handleImport} className="import-button">
                  Import
                </button>
              )}
              
              {importJson && (
                <button 
                  onClick={() => {
                    // Copy to clipboard
                    navigator.clipboard.writeText(importJson)
                      .then(() => alert('Copied to clipboard!'))
                      .catch(err => alert('Failed to copy: ' + err));
                  }} 
                  className="copy-button"
                >
                  Copy to Clipboard
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchSourcesPage;