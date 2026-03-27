import { Libp2p } from 'libp2p';
import { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { fromString, toString } from 'uint8arrays';

export class P2PResolver {
  private node: Libp2p;
  private namespace = '/taktak/resolver/1.0.0';

  constructor(node: Libp2p) {
    this.node = node;
  }

  /**
   * Registers a name in the DHT
   * @param name The human-readable name (e.g., 'taktak.tak')
   * @param peerId The PeerID it resolves to
   */
  async registerName(name: string, peerId: PeerId): Promise<void> {
    const key = fromString(`${this.namespace}/${name}`);
    const value = fromString(peerId.toString());
    
    try {
      // @ts-expect-error - kadDHT types can be tricky
      await this.node.services.dht.put(key, value);
      console.log(`✅ [Resolver] Registrado: ${name} -> ${peerId.toString()}`);
    } catch (err) {
      console.error(`❌ [Resolver] Error al registrar ${name}:`, err);
    }
  }

  /**
   * Looks up a name in the DHT
   * @param name The name to resolve
   */
  async resolveName(name: string): Promise<string | null> {
    const key = fromString(`${this.namespace}/${name}`);
    
    try {
      // @ts-expect-error
      const value = await this.node.services.dht.get(key);
      const resolvedPeerId = toString(value);
      console.log(`🔍 [Resolver] Result for ${name}: ${resolvedPeerId}`);
      return resolvedPeerId;
    } catch (err) {
      console.log(`🔍 [Resolver] No se pudo resolver: ${name}`);
      return null;
    }
  }
}
