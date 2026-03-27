import { createLibp2p } from 'libp2p'
import { webRTC } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { createHelia } from 'helia'
import { dagCbor } from '@helia/dag-cbor'
import WebTorrent from 'webtorrent'
import { toString, fromString } from 'uint8arrays'
import { signData } from './wallet'

const BOOTSTRAP: string[] = [] // Backend public IP or domains, e.g. '/ip4/X.X.X.X/tcp/3000/p2p/PEER_ID' or similar WebRTC multiaddrs

export interface Block {
  height: number;
  prevHash: string;
  dataCid: string;
  timestamp: number;
  miner: string;
  chainId: number;
  signature: string;
  hash?: string;
}

export interface Transaction {
  id: string;
  senderPubKey: string;
  receiverPubKey: string;
  amount: number;
  timestamp: number;
  signature: string;
}

const BLOCK_TOPIC = '/taktaknew/blocks/1.0.0'
export const TX_TOPIC = '/taktaknew/tx/1.0.0'
let chain: Block[] = []
let node: any;
let helia: any;
let dag: any;
let wt: any;

export async function initBrowserNode() {
  node = await createLibp2p({
    transports: [webRTC()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: BOOTSTRAP.length ? [/* bootstrap setup goes here */] : [],
    services: {
      dht: kadDHT({ protocol: '/taktaknew/dht/1.0.0', clientMode: true }) as any,
      pubsub: gossipsub({ canRelayMessage: false }) as any
    }
  })
  
  await node.start()
  console.log('Taktaknew Browser Node - PeerID:', node.peerId.toString())

  helia = await createHelia({ libp2p: node })
  dag = dagCbor(helia)
  wt = new WebTorrent()

  // Subscribe to blocks
  node.services.pubsub.subscribe(BLOCK_TOPIC)
  node.services.pubsub.addEventListener('message', async (event: any) => {
    if (event.detail.topic !== BLOCK_TOPIC) return;
    try {
      const msg = event.detail
      const block: Block = JSON.parse(toString(msg.data))
      
      const lastBlock = chain.at(-1)
      if (lastBlock && await isValidBlock(block, chain) && block.height > lastBlock.height) {
        chain.push(block)
        console.log(`[Browser] Bloque #${block.height} aceptado`)
        
        // Try decoding block's payload to apply pending txs to balance
        try {
           const payload = await dag.get(helia.blockstore.fromString(block.dataCid));
           if(payload && payload.txs) {
              console.log("[Browser] Received block with TXs: ", payload.txs.length);
              // Store/UI logic goes here for txs execution
           }
        } catch(e) {}
      }
    } catch (err) {
      console.error('Error in browser block subscription', err)
    }
  })

  return { node, helia, dag, wt };
}

export async function broadcastTransaction(receiverPubKey: string, amount: number, senderPubKey: string, privateKeyHex: string) {
  if (!node) throw new Error("P2P Node is not initialized.");
  
  const txWithoutSig = {
    id: crypto.randomUUID(),
    senderPubKey,
    receiverPubKey,
    amount,
    timestamp: Date.now(),
  };

  const sigData = `${txWithoutSig.senderPubKey}:${txWithoutSig.receiverPubKey}:${txWithoutSig.amount}:${txWithoutSig.timestamp}`;
  const signature = await signData(sigData, privateKeyHex);
  
  const tx: Transaction = {
    ...txWithoutSig,
    signature
  };

  await node.services.pubsub.publish(TX_TOPIC, fromString(JSON.stringify(tx)));
  console.log('TX Broadcasted:', tx);
  return tx;
}

async function computeHash(obj: any): Promise<string> {
  const buf = fromString(JSON.stringify({ ...obj, hash: undefined }))
  const hash = await crypto.subtle.digest('SHA-256', buf as any)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
}

async function isValidBlock(b: Block, currentChain: Block[]): Promise<boolean> {
  const prev = currentChain.find(p => p.hash === b.prevHash)
  if (!prev) return false
  if (b.hash !== await computeHash(b)) return false
  if (b.chainId !== 8888) return false
  return true
}
