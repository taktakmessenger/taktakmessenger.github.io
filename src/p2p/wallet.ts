import * as ed from '@noble/ed25519';

export async function generateWallet() {
  const privateKeyRaw = ed.utils.randomSecretKey();
  const publicKeyRaw = await ed.getPublicKey(privateKeyRaw);

  const privateKey = Buffer.from(privateKeyRaw).toString('hex');
  const publicKey = Buffer.from(publicKeyRaw).toString('hex');

  return { privateKey, publicKey };
}

export async function signData(data: string, privateKeyHex: string) {
  const messageBytes = new TextEncoder().encode(data);
  const sig = await ed.sign(messageBytes, Buffer.from(privateKeyHex, 'hex'));
  return Buffer.from(sig).toString('hex');
}

export async function verifySignature(data: string, signatureHex: string, publicKeyHex: string) {
  const messageBytes = new TextEncoder().encode(data);
  const isValid = await ed.verify(Buffer.from(signatureHex, 'hex'), messageBytes, Buffer.from(publicKeyHex, 'hex'));
  return isValid;
}
