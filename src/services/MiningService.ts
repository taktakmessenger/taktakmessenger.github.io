import { createP2PClient } from '../libp2p/libp2pNode';
import { MiningTracker } from './MiningTracker';

class MiningService {
  private p2pClient: any = null;
  private tracker: MiningTracker | null = null;
  private initialized = false;

  async init(userId: string) {
    if (this.initialized) return;

    try {
      this.p2pClient = await createP2PClient();
      const nodeId = this.p2pClient.getMyPeerId();

      this.tracker = new MiningTracker({
        nodeId,
        userId,
        signer: (_payload) => {
          // In a real app, use the user's private key to sign
          // For now, returning a mock signature as in whataka.txt example
          return new Uint8Array(64); 
        },
        reportSender: (report) => {
          console.log("📤 Sending Mining Report:", report);
          // Send to server via API or P2P
          fetch('/api/payments/mining-report', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: report
          }).catch(err => console.error("Failed to send mining report:", err));
        }
      });

      this.tracker.startUptimeTracking();
      this.initialized = true;
      console.log("✅ MiningService initialized for node:", nodeId);
    } catch (error) {
      console.error("Failed to initialize MiningService:", error);
    }
  }

  getTracker() {
    return this.tracker;
  }

  stop() {
    if (this.tracker) {
      this.tracker.stopUptimeTracking();
    }
  }
}

export const miningService = new MiningService();
