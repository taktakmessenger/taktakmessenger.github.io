import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { kadDHT } from "@libp2p/kad-dht";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
// We use yamux as it's already in package.json
import { yamux } from "@chainsafe/libp2p-yamux";

const WHATAKA_TOPIC = "whataka-messages";

export async function createTakTakNode({ listenAddrs = [] }: { listenAddrs?: string[] } = {}) {
  const node = await createLibp2p({
    addresses: { listen: listenAddrs },
    transports: [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    services: {
      pubsub: gossipsub() as any,
      dht: kadDHT({ kBucketSize: 20 }) as any
    }
  } as any);

  await node.start();
  console.log("Nodo TakTak iniciado:", node.peerId.toString());
  return node as any;
}

export async function createWhaTakaP2P() {
  // Use default listen address for local
  const node = await createTakTakNode({
    listenAddrs: ["/ip4/0.0.0.0/tcp/0"]
  });

  let onMessageHandler: ((from: string, payload: Uint8Array) => void) | null = null;

  node.pubsub.subscribe(WHATAKA_TOPIC);

  node.pubsub.addEventListener("message", (evt: any) => {
    const msg = evt.detail;
    if (msg.topic !== WHATAKA_TOPIC) return;

    try {
      const data = JSON.parse(new TextDecoder().decode(msg.data));
      const { to, from, payload } = data;

      const myId = node.peerId.toString();
      if (to !== myId) return;

      if (onMessageHandler) {
        const payloadBytes = Buffer.from(payload, "base64");
        onMessageHandler(from, payloadBytes);
      }
    } catch (e) {
      console.error("Error parsing message", e);
    }
  });

  async function sendToPeer(peerId: string, payloadBytes: Uint8Array) {
    const msg = {
      to: peerId,
      from: node.peerId.toString(),
      payload: Buffer.from(payloadBytes).toString("base64")
    };
    await node.services.pubsub.publish(
      WHATAKA_TOPIC,
      new TextEncoder().encode(JSON.stringify(msg))
    );
  }

  return {
    node,
    getMyPeerId: () => node.peerId.toString(),
    sendToPeer,
    setOnMessageListener: (fn: (from: string, payload: Uint8Array) => void) => (onMessageHandler = fn)
  };
}

export async function createP2PClient() {
  const p2p = await createWhaTakaP2P();

  return {
    getMyPeerId: () => p2p.getMyPeerId(),
    sendToPeer: (peerId: string, payloadBytes: Uint8Array) => p2p.sendToPeer(peerId, payloadBytes),
    setOnMessageListener: (listener: (from: string, payload: Uint8Array) => void) => p2p.setOnMessageListener(listener)
  };
}
