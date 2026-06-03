const fs = require('fs').promises;

// Configuration node fetchTimings.js
const RECITER_ID = 174; 
const TOTAL_CHAPTERS = 114;
const OUTPUT_FILE = 'yasser_timings.json';

// Helper function to add a delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllSurahTimings() {
  const finalJson = {};

  console.log('Starting data fetch for all 114 Surahs...');

  for (let chapter = 1; chapter <= TOTAL_CHAPTERS; chapter++) {
    // FIX 1: Hit the backend api.quran.com directly instead of the proxy
    const url = `https://api.quran.com/api/qdc/audio/reciters/${RECITER_ID}/audio_files?chapter=${chapter}&segments=true`;

    try {
      console.log(`Fetching Surah ${chapter}...`);
      
      // FIX 2: Attach your exact browser headers to bypass bot detection
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.5',
          'referer': `https://quran.com/${chapter}`,
          'sec-ch-ua': '"Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"',
          'sec-ch-ua-mobile': '?1',
          'sec-ch-ua-platform': '"Android"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site', // Changed to same-site since we are hitting api.quran.com
          'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();

      // Structure the data according to your requested format
      finalJson[chapter.toString()] = {
        audio_files: data.audio_files
      };

      // Wait 800ms to be extra safe against rate limits
      await delay(800);

    } catch (error) {
      console.error(`Failed to fetch data for Surah ${chapter}:`, error.message);
    }
  }

  // Write the compiled JSON object to a file
  try {
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(finalJson, null, 2), 'utf8');
    console.log(`\nSuccess! All data saved to ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('Failed to write the JSON file:', error);
  }
}

// Execute the script
fetchAllSurahTimings();