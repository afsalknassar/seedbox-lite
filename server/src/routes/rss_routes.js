const express = require('express');
const router = express.Router();

router.get('/fetch', async (req, res) => {
    const feedUrl = req.query.url;
    if (!feedUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        if (typeof fetch === 'function') {
            const response = await fetch(feedUrl, {
                headers: { 'User-Agent': 'SeedboxLite/1.0' }
            });
            
            if (!response.ok) {
                return res.status(response.status).json({ error: `Remote server responded with status ${response.status}` });
            }
            
            const contents = await response.text();
            return res.json({ contents });
        } else {
            const client = feedUrl.startsWith('https') ? require('https') : require('http');
            client.get(feedUrl, { headers: { 'User-Agent': 'SeedboxLite/1.0' } }, (proxyRes) => {
                let data = '';
                proxyRes.on('data', chunk => data += chunk);
                proxyRes.on('end', () => res.json({ contents: data }));
            }).on('error', (err) => res.status(500).json({ error: err.message }));
        }
    } catch (error) {
        console.error('RSS proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch RSS feed' });
    }
});

module.exports = router;
