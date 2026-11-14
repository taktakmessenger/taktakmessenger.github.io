import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers';

// Puente entre la app y la wallet del usuario para cobrar el minado de TakCoin
// (TKC).
//
// Todo lo que toca dinero pasa por aquí y por el contrato: la app no firma
// nada, solo pide al usuario que firme con su propia wallet. Si no hay wallet
// inyectada (MetaMask, Trust…), se avisa con un mensaje claro en vez de fallar
// en silencio.

// Redes donde se puede desplegar TKC. Los parámetros de `wallet_addEthereumChain`
// tienen que ser exactos: si falta uno, la wallet rechaza la petición.
//
// Los RPC son públicos y gratuitos. `rpc-amoy.polygon.technology` (el oficial)
// devolvía respuestas vacías al comprobarlo, así que se usa el nodo público de
// publicnode, que sí responde.
export const KNOWN_CHAINS = {
  56: {
    chainName: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
  97: {
    chainName: 'BNB Smart Chain (pruebas)',
    nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
    rpcUrls: ['https://bsc-testnet.publicnode.com'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
  80002: {
    chainName: 'Polygon Amoy (pruebas)',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com'],
    blockExplorerUrls: ['https://amoy.polygonscan.com'],
  },
};

// ABI mínimo: solo lo que usa la app. Menos superficie, menos que pueda cambiar
// por accidente al sincronizar con el artifact completo.
export const TAKCOIN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function rewardPool() view returns (uint256)',
  'function rewardFor(uint256,uint256,uint256,uint256,uint256) view returns (uint256)',
  'function claimMiningReward(bytes32,uint256,uint256,uint256,uint256,uint256,uint256,bytes)',
];

export function hasWallet() {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

/// Pide acceso a la wallet y devuelve su proveedor. Lanza con un mensaje útil
/// si no hay wallet instalada.
export async function connectWallet() {
  if (!hasWallet()) {
    throw new Error('No hay ninguna cartera instalada. Abre la app en MetaMask o instala su extensión.');
  }
  const provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  return provider;
}

/// Cambia a la red del token, añadiéndola si la wallet no la conoce. En un móvil
/// el usuario confirma el cambio en su propia app de wallet.
export async function ensureChain(chainId) {
  const target = KNOWN_CHAINS[chainId];
  if (!target) return;
  const provider = new BrowserProvider(window.ethereum);
  const current = Number((await provider.getNetwork()).chainId);
  if (current === chainId) return;
  const hex = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    // 4902 = la wallet no tiene esa red dada de alta; se añade y ya.
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, ...target }],
      });
    } else {
      throw err;
    }
  }
}

/// Saldo de TKC del usuario, ya formateado a texto.
export async function getTokenBalance(contractAddress) {
  if (!contractAddress) return null;
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const token = new Contract(contractAddress, TAKCOIN_ABI, provider);
  const [raw, decimals] = await Promise.all([token.balanceOf(signer.address), token.decimals()]);
  return formatUnits(raw, decimals);
}

/// Cobra un vale firmado por el backend.
///
/// El vale trae el hash del informe, las unidades, el vencimiento y la firma del
/// oráculo. El contrato vuelve a comprobar la firma antes de pagar: aunque este
/// código mintiera, no pagaría sin una firma válida.
export async function claimReward(contractAddress, voucher) {
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const token = new Contract(contractAddress, TAKCOIN_ABI, signer);
  const u = voucher.units;
  const tx = await token.claimMiningReward(
    voucher.reportHash,
    u.relay,
    u.store,
    u.uptime,
    u.call,
    u.reputation,
    voucher.deadline,
    voucher.signature
  );
  const receipt = await tx.wait();
  return { hash: receipt.hash, receipt };
}

/// Añade TKC a la lista de tokens de la wallet, para que el saldo se vea sin
/// tener que importarlo a mano. Es una comodidad, no un paso obligatorio.
export async function watchToken(contractAddress) {
  if (!hasWallet() || !contractAddress) return false;
  await window.ethereum.request({
    method: 'wallet_watchAsset',
    params: { type: 'ERC20', options: { address: contractAddress, symbol: 'TKC', decimals: 18 } },
  });
  return true;
}

export { parseUnits, formatUnits };
