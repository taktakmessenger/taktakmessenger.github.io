import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { createHelia } from 'helia'
import { dagCbor } from '@helia/dag-cbor'
// @ts-expect-error
import WebTorrent from 'webtorrent'
import { toString, fromString } from 'uint8arrays'
import * as ed from '@noble/ed25519'
import { P2PResolver } from './resolver.js'
import { User } from '../models/User.js'

const BOOTSTRAP: string[] = [] // Agrega multiaddrs públicos aquí después

// This interface represents the structure of a Taktak block
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

const BLOCK_TOPIC = '/taktak/blocks/72727/1.0.0'
const TX_TOPIC = '/taktak/tx/72727/1.0.0'

let chain: Block[] = []
let pendingTxs: Transaction[] = []
let node: any;
let helia: any;
let dag: any;
let wt: any;

export async function startP2PNode() {
  node = await createLibp2p({
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: BOOTSTRAP.length ? [/* bootstrap setup goes here */] : [],
    services: {
      dht: kadDHT({ protocol: '/taktak/dht/72727/1.0.0', clientMode: false }) as any,
      identify: identify() as any,
      ping: ping() as any,
      pubsub: gossipsub({ canRelayMessage: true }) as any
    }
  })
  
  await node.start()
  console.log('Taktak Node - PeerID:', node.peerId.toString())

  const resolver = new P2PResolver(node);
  // Register this node as the primary resolver for taktak.tak
  // In a multi-node setup, only the Master Node would do this
  await resolver.registerName('taktak.tak', node.peerId);

  helia = await createHelia({ libp2p: node })
  dag = dagCbor(helia)
  wt = new WebTorrent()

  const genesis: Block = {
    height: 0,
    prevHash: '0'.repeat(64),
    dataCid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    timestamp: 1710000000000,
    miner: 'genesis',
    chainId: 72727, // Taktak chain ID
    signature: 'genesis'
  }
  genesis.hash = await computeHash(genesis)
  chain = [genesis]

  // Subscribe to block updates
  node.services.pubsub.subscribe(BLOCK_TOPIC)
  
  // Subscribe to new transactions
  async function validateTransaction(tx: Transaction): Promise<boolean> {
    try {
      const user = await User.findOne({ publicKey: tx.senderPubKey });
      if (!user) {
        console.warn(`[Node] 🛑 Rechazada TX P2P: El usuario ${tx.senderPubKey} no existe.`);
        return false;
      }

      // Industrial Rule: P2P transfers are ONLY for mined/reward coins.
      // Purchased coins MUST be used via the Gifting system (centralized revenue).
      const coinsToTransfer = tx.amount; // amount is in coins for P2P
      if (user.minedCoins < coinsToTransfer) {
        console.warn(`[Node] 🛑 Rechazada TX P2P: El usuario ${tx.senderPubKey} intentó transferir ${coinsToTransfer} fichas, pero solo tiene ${user.minedCoins.toFixed(2)} fichas minadas. Las fichas compradas deben usarse con el sistema de Regalos.`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error validating transaction:', err);
      return false;
    }
  }

  node.services.pubsub.subscribe(TX_TOPIC)

  node.services.pubsub.addEventListener('message', async (event: any) => {
    
    // --- TX Messages ---
    if (event.detail.topic === TX_TOPIC) {
      try {
        const msg = event.detail
        const tx: Transaction = JSON.parse(toString(msg.data))
        
        // Validate transaction business rules (e.g., sender balance)
        if (!(await validateTransaction(tx))) {
          console.warn(`[Node] TX P2P ${tx.id} falló la validación de reglas de negocio.`);
          return;
        }

        // Prevent duplicate processing
        if (pendingTxs.find(p => p.id === tx.id)) return;
        
        // Verify ed25519 signature
        const sigData = `${tx.senderPubKey}:${tx.receiverPubKey}:${tx.amount}:${tx.timestamp}`;
        const messageBytes = new TextEncoder().encode(sigData);
        
        const isValid = await ed.verify(
          Buffer.from(tx.signature, 'hex'), 
          messageBytes, 
          Buffer.from(tx.senderPubKey, 'hex')
        );

        if (isValid) {
          pendingTxs.push(tx);
          console.log(`[Node] TX válida recibida de ${tx.senderPubKey.slice(0,6)}... por ${tx.amount} ₮`);
          // Relay the tx exactly as received if it's new and valid
          await node.services.pubsub.publish(TX_TOPIC, msg.data);
        } else {
          console.error('[Node] Invalid tx signature received:', tx.id);
        }

      } catch (err) {
        console.error('Error handling TX:', err)
      }
      return;
    }

    // --- Block Messages ---
    if (event.detail.topic === BLOCK_TOPIC) {
      try {
        const msg = event.detail
        const block: Block = JSON.parse(toString(msg.data))
        
        const lastBlock = chain.at(-1)
        if (lastBlock && await isValidBlock(block, chain) && block.height > lastBlock.height) {
          chain.push(block)
          await helia.pins.add(helia.blockstore.fromString(block.dataCid)) // PoS: pinning para rewards
          console.log(`[Node] Bloque #${block.height} aceptado remotamente`)
          
          // Determine if we need to prune our pending set (basic simplification)
          // In a real env, decode block.dataCid and remove exact matching txs from pendingTxs 
          pendingTxs = [];
          
          // Re-publish the block
          await node.services.pubsub.publish(BLOCK_TOPIC, msg.data)
        }
      } catch (err) {
        console.error('Error handling block topic message', err)
      }
    }
  })

  // Mining simulado (cada 30s) – upgrade a PoS real
  setInterval(async () => {
    const last = chain.at(-1)
    if (!last) return;
    
    // The node adds its pending transactions to IPFS
    const txsToInclude = [...pendingTxs]; 
    const cid = await dag.add({ txs: txsToInclude })
    
    const newBlock: Block = {
      height: last.height + 1,
      prevHash: last.hash || '',
      dataCid: cid.toString(),
      timestamp: Date.now(),
      miner: node.peerId.toString(),
    chainId: 72727,
      signature: 'simulada'
    }
    
    newBlock.hash = await computeHash(newBlock)
    
    try {
      await node.services.pubsub.publish(BLOCK_TOPIC, fromString(JSON.stringify(newBlock)))
      
      // We automatically append to our chain assuming it's valid if we just forged it
      chain.push(newBlock)
      console.log(`[Node] ⛏️ Minado Bloque #${newBlock.height} con ${txsToInclude.length} TXs`);
      
      // Reset pending transactions after successful forge 
      pendingTxs = pendingTxs.filter(ptx => !txsToInclude.find(included => included.id === ptx.id));

    } catch (e) {
      console.error('Publish error', e)
    }
  }, 30000)
}

async function computeHash(obj: any): Promise<string> {
  const buf = fromString(JSON.stringify({ ...obj, hash: undefined }))
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
}

async function isValidBlock(b: Block, currentChain: Block[]): Promise<boolean> {
  const prev = currentChain.find(p => p.hash === b.prevHash)
  if (!prev) return false
  if (b.hash !== await computeHash(b)) return false
  if (b.chainId !== 72727) return false
  return true
}

// Ensure Web crypto logic is available for computeHash
if (typeof crypto === 'undefined' || !crypto.subtle) {
  // Setup node.js native crypto runtime for hash operations
  const cryptoModule = await import('node:crypto');
  if(!globalThis.crypto) {
    (globalThis as any).crypto = cryptoModule.webcrypto;
  }
}
