
require('dotenv').config();

// Environment Configuration with production optimizations
const config = {

    server: {
        port: process.env.SERVER_PORT || 3000,
        host: process.env.SERVER_HOST || 'localhost',
        protocol: process.env.SERVER_PROTOCOL || 'http'
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:5173'
    },
    omdb: {
        apiKey: process.env.OMDB_API_KEY || '8265bd1c' // Free API key for development
    },

    isDevelopment: process.env.NODE_ENV !== 'production',

    production: {
        streaming: {
            maxConnectionTime: 300000, // 5 minutes
            defaultChunkSize: 4 * 1024 * 1024, // 4MB (Excellent for instant playback)
            streamingUploadRate: 5120, // 5 KB/s (Enough to keep trackers happy, saves outbound bandwidth)
            optimizeForRemote: true
        },
        cache: {
            torrentListTTL: 5000, // 5 seconds
            torrentDetailsTTL: 8000, // 8 seconds
            imdbDataTTL: 3600000, // 1 hour (Good, IMDB data rarely changes)
            memoryCachePurgeThreshold: 800 // 800MB (Perfect buffer for a 1024MB hard limit)
        },
        system: {
            maxMemory: 1024, // 1GB
            monitoring: true,
            logLevel: parseInt(process.env.LOG_LEVEL || '1', 10)
        },
        network: {
            maxConns: 100, // Used for standard production VPS (DigitalOcean/Hetzner)
            defaultUploadLimit: 5120, // 5 KB/s
            apiTimeout: 15000 // 15 seconds
        }
    }
};

module.exports = config;