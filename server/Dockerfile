FROM node:20-bullseye

# 1. Install necessary system media utilities
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

# 2. Match Hugging Face container user specifications
RUN useradd -m -u 1000 -o user
USER user

# ==========================================
# 3. SERVER ENVIRONMENT CONFIGURATION
# All custom variables injected here
# ==========================================
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    NODE_OPTIONS="--max-old-space-size=2048" \
    SERVER_PORT=3000 \
    SERVER_HOST=0.0.0.0 \
    SERVER_PROTOCOL=http \
    FRONTEND_URL="*" \
    OMDB_API_KEY="8265bd1c" \
    TMDB_API_KEY="9cc4c06822e95c201ce0ff3a0fbb20f6" \
    ACCESS_PASSWORD="afsal@123" \
    NODE_ENV="production" \
    LOG_LEVEL=1 \
    DEBUG=false \
    CLOUD_DEPLOYMENT=true \
    HOSTING=cloud

WORKDIR /home/user/app

# 4. Clone the target repository
RUN git clone -b development https://github.com/afsalknassar/seedbox-lite.git .

# 5. Strip out hardcoded port strings from raw client files
RUN find /home/user/app/client/src -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \) \
    -exec sed -i 's|http://localhost:3000||g; s|http://localhost:3001||g' {} +

# 6. Build backend architecture
WORKDIR /home/user/app/server
RUN npm install --legacy-peer-deps

# 7. Build frontend architecture with Vite fix
WORKDIR /home/user/app/client
RUN echo "VITE_API_BASE_URL=" > .env
# Force development mode just for this install so Vite is downloaded
RUN NODE_ENV=development npm install --legacy-peer-deps
RUN VITE_API_BASE_URL="" npm run build

# 8. Create the Node.js Proxy logic dynamically (Targeting Port 3000)
WORKDIR /home/user/app/hf-proxy
RUN npm init -y && npm install express@4 http-proxy-middleware
RUN echo "const express = require('express');" > proxy.js && \
    echo "const { createProxyMiddleware } = require('http-proxy-middleware');" >> proxy.js && \
    echo "const path = require('path');" >> proxy.js && \
    echo "const app = express();" >> proxy.js && \
    echo "const PORT = 7860;" >> proxy.js && \
    echo "app.get('/healthz', (req, res) => res.send('ok'));" >> proxy.js && \
    echo "app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));" >> proxy.js && \
    echo "app.use(createProxyMiddleware({" >> proxy.js && \
    echo "  target: 'http://127.0.0.1:3000'," >> proxy.js && \
    echo "  changeOrigin: true," >> proxy.js && \
    echo "  ws: true," >> proxy.js && \
    echo "  filter: (pathname) => pathname.startsWith('/api') || pathname.startsWith('/socket.io')," >> proxy.js && \
    echo "  on: {" >> proxy.js && \
    echo "    error: (err, req, res) => {" >> proxy.js && \
    echo "      console.error('Proxy error:', err.message);" >> proxy.js && \
    echo "      if (!res.headersSent) res.status(502).json({ error: 'Backend unavailable' });" >> proxy.js && \
    echo "    }" >> proxy.js && \
    echo "  }" >> proxy.js && \
    echo "}));" >> proxy.js && \
    echo "// Universal fallback route to prevent Express PathErrors" >> proxy.js && \
    echo "app.use((req, res) => {" >> proxy.js && \
    echo "  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));" >> proxy.js && \
    echo "});" >> proxy.js && \
    echo "app.listen(PORT, '0.0.0.0', () => { console.log(\`Proxy running on port \${PORT}\`); });" >> proxy.js

# 9. Create the startup script dynamically
WORKDIR /home/user/app
RUN echo "#!/bin/bash" > start.sh && \
    echo "echo '==> Starting backend on port 3000...'" >> start.sh && \
    echo "cd /home/user/app/server" >> start.sh && \
    echo "node src/index.js &" >> start.sh && \
    echo "sleep 6" >> start.sh && \
    echo "echo '==> Starting proxy on port 7860...'" >> start.sh && \
    echo "cd /home/user/app/hf-proxy" >> start.sh && \
    echo "node proxy.js" >> start.sh
RUN chmod +x start.sh

# 10. Expose port and launch
EXPOSE 7860
CMD ["./start.sh"]