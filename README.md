# 🎬 SeedBox Lite

Stream Torrents Instantly & Export to Cloud

<div align="center">

![SeedBox Lite](https://img.shields.io/badge/SeedBox-Lite-green?style=for-the-badge&logo=leaf)
![Docker](https://img.shields.io/badge/Docker-Enabled-blue?style=for-the-badge&logo=docker)
![React](https://img.shields.io/badge/React-19.1.1-61dafb?style=for-the-badge&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js)

**A modern, lightweight torrent streaming and cloud-export application**

<img src="https://raw.githubusercontent.com/hotheadhacker/seedbox-lite/refs/heads/main/screenshots/details-screen.png" alt="SeedBox Lite Screenshot" width="80%"/>

[View all screenshots](https://github.com/hotheadhacker/seedbox-lite/tree/main/screenshots)

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation)

</div>

## 🚀 Overview

SeedBox Lite is a cutting-edge torrent streaming platform that brings the power of a seedbox straight to your browser. Watch movies and TV shows instantly with a beautiful Netflix-like experience, manage active downloads, and seamlessly export your files directly to **Google Drive** or **Telegram**.

### ✨ Key Highlights

- **🎯 Instant Streaming** - Start watching immediately while the torrent downloads in the background.
- **☁️ Cloud Export** - Push downloaded files directly to your Google Drive or Telegram bot.
- **🎥 Smart Video Player** - Advanced player with subtitles and native fullscreen support.
- **🔐 Password Protection** - Secure access with authentication.
- **📱 Mobile Optimized** - A perfect responsive design that feels like a native app.
- **⚡ Fast Setup** - Deploy in minutes with Docker or PM2.

## 🎯 Features

### Core Streaming & Cloud Integration
- **Torrent to Stream** - Convert any movie/TV torrent into an instant stream.
- **Google Drive Export** - Upload completed files directly to a specific Google Drive folder.
- **Telegram Integration** - Send files straight to a Telegram chat using bot integration.
- **Live Progress Tracking** - Real-time metrics for download speeds, seeders, leechers, and upload progress.
- **Smart Caching** - Intelligent caching system to manage storage and clear old files.

### User Experience
- **Netflix-Style Interface** - Familiar, intuitive, and visually stunning design.
- **Rich Metadata** - Integrates with TMDB, OMDb, and custom search sources for high-quality posters and metadata.
- **Mobile-First Design** - Touch-optimized with gesture controls and native fullscreen on iOS and Android.

### Technical Features
- **Docker Support** - Easy containerized deployment.
- **PM2 Integration** - Process management for Node.js applications.
- **Health Monitoring** - Built-in health checks and monitoring.
- **CORS Enabled** - Cross-origin resource sharing for flexible deployment.

## 📸 Screenshots

[View all screenshots](https://github.com/hotheadhacker/seedbox-lite/tree/main/screenshots)

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/hotheadhacker/seedbox-lite.git
cd seedbox-lite

# Start with Docker Compose
docker-compose up -d

# Access the application
open http://localhost:5174
```

## 📋 Prerequisites

- **Node.js** 18+ 
- **npm** 8+
- **Docker** 20+ (for Docker deployment)
- **PM2** (for PM2 deployment)

## 🛠 Installation

### Method 1: Docker Deployment (Recommended)

#### Step 1: Clone Repository
```bash
git clone https://github.com/hotheadhacker/seedbox-lite.git
cd seedbox-lite
```

#### Step 2: Configure Environment
```bash
# Copy and edit environment variables
cp .env.example .env
nano .env
```

**Key Environment Variables (`server/.env`):**
```env
# Server Configuration
NODE_ENV=production
SERVER_PORT=3001
ACCESS_PASSWORD=your_secure_password

# Integrations
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
TMDB_API_KEY=your_tmdb_api_key
```

#### Step 3: Deploy
```bash
# Start all services
docker-compose up -d
```

#### Step 4: Access Application
- **Frontend**: http://localhost:5174
- **Backend API**: http://localhost:3001

### Method 2: PM2 Deployment

```bash
# System Setup
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pm2

# Clone repository
git clone https://github.com/hotheadhacker/seedbox-lite.git
cd seedbox-lite

# Install dependencies and build
cd server && npm install
cd ../client && npm install && npm run build

# Start services
cd ../server
pm2 start ecosystem.config.js
cd ../client/dist
pm2 start "npx serve -s . -l 5174" --name "seedbox-frontend"
```

## 📚 API Configuration & Services

SeedBox Lite supports several external services for enhanced functionality:
- **Telegram Export:** Requires `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_BOT_TOKEN`.
- **Google Drive Export:** Requires frontend Google OAuth configuration (`GOOGLE_CLIENT_ID`) and backend drive support.
- **Metadata:** Requires `TMDB_API_KEY` and `OPENSUBTITLES_API_KEY`.

## ⚠️ Legal Disclaimer

**IMPORTANT: Please read this disclaimer carefully before using SeedBox Lite.**

SeedBox Lite is an open-source project provided for educational and personal use only. We do not endorse, promote, or facilitate copyright infringement, illegal streaming, or piracy in any form. This software is designed to be used with legal content only.

- We do not host, store, or distribute any content. All torrents and media are accessed through your own connections.
- This application is intended for use with content that you have the legal right to access and stream.
- Users are solely responsible for how they use this software and for ensuring compliance with all applicable laws in their jurisdiction.

## 📄 License

This project is licensed under the **Custom Non-Commercial License** - see the [LICENSE](LICENSE) file for details.

- This software is provided for personal, educational, and non-commercial use only.
- Commercial use is strictly prohibited without explicit written permission.

---

<div align="center">
**Made with ❤️ by [hotheadhacker](https://github.com/hotheadhacker)**

⭐ Star this repo if you find it useful!
</div>
