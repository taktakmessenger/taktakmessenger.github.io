import WebTorrent from 'webtorrent';

class P2PEngine {
  private client: WebTorrent.Instance | null = null;
  private totalBytesUploaded = 0;
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private trackers = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
    `ws://${window.location.hostname}:3000` // Our own hybrid tracker
  ];

  constructor() {
    // Lazy initialize client to avoid SSR issues
    if (typeof window !== 'undefined') {
      this.client = new WebTorrent();
      this.startReporting();
    }
  }

  private startReporting() {
    this.reportInterval = setInterval(async () => {
      if (this.totalBytesUploaded > 0) {
        const mb = this.totalBytesUploaded / (1024 * 1024);
        try {
          const response = await fetch('/api/payments/mine', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}` 
            },
            body: JSON.stringify({ megabytesServed: mb })
          });
          if (response.ok) {
            console.log(`⛏️ Mined rewards for ${mb.toFixed(2)} MB served.`);
            this.totalBytesUploaded = 0; // Reset after successful report
          }
        } catch (error) {
          console.error('Failed to report mining contribution:', error);
        }
      }
    }, 60000); // Report every minute
    
    // This exists to prevent the 'reportInterval' is declared but its value is never read warning
    if (this.reportInterval) {
      // Just a reference
    }
  }

  /**
   * Streams a video from the P2P network into a video element
   */
  public async streamTo(magnetURI: string, videoElement: HTMLVideoElement): Promise<void> {
    if (!this.client) return;

    return new Promise((resolve, reject) => {
      // Check if already seeding/downloading
      const existing = this.client?.get(magnetURI);
      if (existing) {
        if (existing.files[0]) {
          existing.files[0].renderTo(videoElement, { autoplay: true });
          resolve();
        } else {
          reject(new Error('Torrent exists but has no files'));
        }
        return;
      }

      this.client?.add(magnetURI, { announce: this.trackers }, (torrent: WebTorrent.Torrent) => {
        console.log('🛰️ P2P Torrent joined:', torrent.infoHash);
        
        // Render the FIRST file (the video) to the provided element
        const file = torrent.files.find((f: any) => f.name.endsWith('.mp4') || f.name.endsWith('.webm'));
        if (file) {
          file.renderTo(videoElement, { autoplay: true });
          resolve();
        } else {
          reject(new Error('No video file found in torrent'));
        }

        torrent.on('upload', (bytes: number) => {
          this.totalBytesUploaded += bytes;
        });

        torrent.on('download', () => {
          // console.log(`⏬ Download progress: ${torrent.progress * 100}%`);
        });

        torrent.on('done', () => {
          console.log('✅ P2P Download complete, now seeding...');
        });
      });
    });
  }

  /**
   * Seeds a file to the P2P network and returns its magnet URI
   */
  public async seed(file: File): Promise<string> {
    if (!this.client) throw new Error('P2P Client not initialized');

    return new Promise((resolve) => {
      this.client?.seed(file, { announce: this.trackers }, (torrent: WebTorrent.Torrent) => {
        console.log('🌱 P2P Seeding started:', torrent.magnetURI);
        
        torrent.on('upload', (bytes: number) => {
          this.totalBytesUploaded += bytes;
        });

        resolve(torrent.magnetURI);
      });
    });
  }

  public getClient() {
    return this.client;
  }
}

export const p2pEngine = new P2PEngine();
