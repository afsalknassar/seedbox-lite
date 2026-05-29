import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, '.', '');
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://localhost:3000';
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: apiBaseUrl,
          changeOrigin: true,
          secure: false
        }
      }
    },
    // Expose environment variables to the client
    define: {
      __DEV__: JSON.stringify(mode === 'development'),
      __API_BASE_URL__: JSON.stringify(apiBaseUrl)
    }
  }
})
