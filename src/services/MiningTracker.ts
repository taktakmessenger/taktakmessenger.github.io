/**
 * MiningTracker handles the accumulation and reporting of TTC mining units.
 * Based on the WhaTaka protocol.
 */
export class MiningTracker {
  private nodeId: string;
  private userId: string;
  private signer: (payload: Buffer) => Uint8Array;
  private reportSender: (report: string) => void;

  private relayUnits: number = 0;
  private storeUnits: number = 0;
  private uptimeUnits: number = 0;
  private callUnits: number = 0;
  private reputationUnits: number = 0;

  private periodStart: number;
  private uptimeInterval: NodeJS.Timeout | null = null;
  private feeRecipient: string | null = null;

  constructor({ nodeId, userId, signer, reportSender }: {
    nodeId: string;
    userId: string;
    signer: (payload: Buffer) => Uint8Array;
    reportSender: (report: string) => void;
  }) {
    this.nodeId = nodeId;
    this.userId = userId;
    this.signer = signer;
    this.reportSender = reportSender;

    this.periodStart = Math.floor(Date.now() / 1000);
  }

  setFeeRecipient(recipient: string | null) {
    this.feeRecipient = recipient;
  }

  startUptimeTracking() {
    if (this.uptimeInterval) clearInterval(this.uptimeInterval);
    this.uptimeInterval = setInterval(() => {
      this.uptimeUnits += 1;
    }, 60 * 1000);
  }

  stopUptimeTracking() {
    if (this.uptimeInterval) clearInterval(this.uptimeInterval);
    this.uptimeInterval = null;
  }

  addRelayUnits(u = 1) { this.relayUnits += u; }
  addStoreUnits(u = 1) { this.storeUnits += u; }
  addCallUnits(u = 1) { this.callUnits += u; }
  addReputationUnits(u = 1) { this.reputationUnits += u; }

  calculateScore() {
    return (
      this.relayUnits * 5 +
      this.storeUnits * 8 +
      this.uptimeUnits * 1 +
      this.callUnits * 10 +
      this.reputationUnits * 3
    );
  }

  buildAndSendReport() {
    const periodEnd = Math.floor(Date.now() / 1000);

    const report: any = {
      type: "MINING_REPORT",
      node_id: this.nodeId,
      user_id: this.userId,
      relay_units: this.relayUnits,
      store_units: this.storeUnits,
      uptime_units: this.uptimeUnits,
      call_units: this.callUnits,
      reputation_units: this.reputationUnits,
      period_start: this.periodStart,
      period_end: periodEnd,
      timestamp: periodEnd,
      fee_recipient: this.feeRecipient // Added for Malayaso policy
    };

    const payload = Buffer.from(JSON.stringify(report), "utf8");
    const signatureBytes = this.signer(payload);
    const signatureHex = Buffer.from(signatureBytes).toString("hex");

    report.signature = signatureHex;

    this.reportSender(JSON.stringify(report));
    this.reset(periodEnd);
  }

  private reset(newStart: number) {
    this.relayUnits = 0;
    this.storeUnits = 0;
    this.uptimeUnits = 0;
    this.callUnits = 0;
    this.reputationUnits = 0;
    this.periodStart = newStart;
  }
}
