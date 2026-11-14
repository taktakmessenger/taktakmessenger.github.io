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
  137: {
    chainName: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  80002: {
    chainName: 'Polygon Amoy (pruebas)',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com'],
    blockExplorerUrls: ['https://amoy.polygonscan.com'],
  },
};

// Carteras compatibles con TakCoin (cualquier cartera EVM sirve: el token vive
// en Polygon). `deepLink` abre ESTA misma web dentro de la app de la cartera,
// que es la única forma de conectar en móvil (no hay extensiones). Los esquemas
// son los oficiales de cada cartera; si cambian, solo hay que tocar aquí.
export const WALLETS = [
  {
    id: 'metamask',
    name: 'MetaMask',
    emoji: '🦊',
    installUrl: 'https://metamask.io/download/',
    deepLink: (host, path) => `https://metamask.app.link/dapp/${host}${path}`,
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    emoji: '🛡️',
    installUrl: 'https://trustwallet.com/download',
    // coin_id 966 = Polygon en el catálogo de Trust.
    deepLink: (host, path) =>
      `https://link.trustwallet.com/open_url?coin_id=966&url=${encodeURIComponent(`https://${host}${path}`)}`,
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    emoji: '🔵',
    installUrl: 'https://www.coinbase.com/wallet/downloads',
    deepLink: (host, path) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${host}${path}`)}`,
  },
];

// Ruta a la que vuelven los enlaces directos: la tienda, donde está el minado.
const STORE_PATH = '/?view=tienda';

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

/// Navegador de móvil. En escritorio la cartera se instala como extensión; en
/// móvil hay que abrir la web DENTRO de la app de la cartera, porque el móvil no
/// tiene extensiones y `window.ethereum` no existe hasta entonces. Se le puede
/// pasar un `userAgent` para probarla sin navegador.
export function isMobile(userAgent) {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /android|iphone|ipad|ipod/i.test(ua || '');
}

/// Enlace directo para abrir esta misma web dentro de la app de una cartera.
/// Se apunta a la tienda (`?view=tienda`) para que, tras conectar, el usuario
/// caiga donde estaba. Se puede forzar host/path para probarlo sin navegador.
export function walletDeepLink(walletId, host, path = STORE_PATH) {
  const wallet = WALLETS.find((w) => w.id === walletId);
  if (!wallet) return null;
  const h = host ?? (typeof window !== 'undefined' ? window.location.host : '');
  if (!h) return wallet.installUrl;
  return wallet.deepLink(h, path);
}

/// Compatibilidad: enlace directo de MetaMask (el más usado).
export function metamaskDeepLink(host) {
  return walletDeepLink('metamask', host);
}

// Cartera elegida por el usuario cuando tiene varias instaladas. Si no hay
// ninguna elegida se usa la que inyecta el navegador (`window.ethereum`), que
// es el comportamiento de siempre.
let activeProvider = null;

/// Proveedor con el que opera la app. Prioriza la cartera que el usuario eligió
/// (detección EIP-6963) y, si no hay, la inyectada de toda la vida.
export function provider() {
  if (activeProvider) return activeProvider;
  return typeof window !== 'undefined' ? window.ethereum : undefined;
}

export function setActiveProvider(p) {
  activeProvider = p || null;
}

/// Carteras disponibles en ESTE navegador. Escucha los anuncios EIP-6963 (así se
/// descubren varias extensiones a la vez) y cae a `window.ethereum` si ninguna
/// anuncia. Devuelve una lista de `{ id, name, icon, provider }`.
export function detectWallets(timeoutMs = 300) {
  if (typeof window === 'undefined') return Promise.resolve([]);
  const found = new Map();
  const onAnnounce = (event) => {
    const detail = event?.detail;
    if (detail?.info?.uuid && detail.provider) {
      found.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name || 'Cartera',
        icon: detail.info.icon || '',
        provider: detail.provider,
      });
    }
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return new Promise((resolve) => {
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const list = [...found.values()];
      if (list.length === 0 && window.ethereum) {
        list.push({ id: 'injected', name: 'Cartera del navegador', icon: '', provider: window.ethereum });
      }
      resolve(list);
    }, timeoutMs);
  });
}

/// ¿Hay alguna cartera con la que conectar? Vale tanto la inyectada como una
/// anunciada por EIP-6963 (que no tiene por qué estar en `window.ethereum`).
export function hasWallet() {
  return Boolean(provider());
}

/// Cuenta ya autorizada en este navegador, sin abrir ninguna ventana.
/// `eth_accounts` no pide permiso: solo devuelve lo que el usuario ya concedió
/// a este sitio. Sirve para que el panel siga "conectado" al recargar o al
/// volver a la pantalla, en vez de pedir conectar otra vez.
export async function getConnectedAccount() {
  const p = provider();
  if (!p) return null;
  const ethProvider = new BrowserProvider(p);
  const accounts = await ethProvider.listAccounts();
  return accounts?.length ? accounts[0].address : null;
}

/// Avisa cuando el usuario cambia de cuenta o de red desde su cartera. Devuelve
/// una función para dejar de escuchar.
export function onWalletChange(handler) {
  const p = provider();
  if (!p || typeof p.on !== 'function') return () => {};
  const onChange = () => handler();
  p.on('accountsChanged', onChange);
  p.on('chainChanged', onChange);
  return () => {
    if (typeof p.removeListener === 'function') {
      p.removeListener('accountsChanged', onChange);
      p.removeListener('chainChanged', onChange);
    }
  };
}

/// Pide acceso a la wallet y devuelve su proveedor. Lanza con un mensaje útil
/// si no hay wallet instalada.
export async function connectWallet() {
  const p = provider();
  if (!p) {
    throw new Error('No hay ninguna cartera instalada. Abre la app en tu cartera o instala una extensión.');
  }
  const ethProvider = new BrowserProvider(p);
  await ethProvider.send('eth_requestAccounts', []);
  return ethProvider;
}

/// Cambia a la red del token, añadiéndola si la wallet no la conoce. En un móvil
/// el usuario confirma el cambio en su propia app de wallet. Al terminar
/// comprueba que el cambio surtió efecto: si el usuario lo cancela o la cartera
/// se queda en otra red, lanza en vez de operar contra la red equivocada.
export async function ensureChain(chainId) {
  const target = KNOWN_CHAINS[chainId];
  const p = provider();
  if (!target || !p) return;
  const ethProvider = new BrowserProvider(p);
  const current = Number((await ethProvider.getNetwork()).chainId);
  if (current === chainId) return;
  const hex = '0x' + chainId.toString(16);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    // 4902 = la wallet no tiene esa red dada de alta; se añade y ya.
    if (err?.code === 4902) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, ...target }],
      });
    } else {
      throw err;
    }
  }
  const after = Number((await new BrowserProvider(p).getNetwork()).chainId);
  if (after !== chainId) {
    throw new Error(
      `La cartera sigue en otra red (chainId ${after}). Cambia a ${target.chainName} para continuar.`
    );
  }
}

/// Saldo de TKC del usuario, ya formateado a texto.
export async function getTokenBalance(contractAddress) {
  if (!contractAddress) return null;
  const ethProvider = new BrowserProvider(provider());
  const signer = await ethProvider.getSigner();
  const token = new Contract(contractAddress, TAKCOIN_ABI, ethProvider);
  const [raw, decimals] = await Promise.all([token.balanceOf(signer.address), token.decimals()]);
  return formatUnits(raw, decimals);
}

/// Cobra un vale firmado por el backend.
///
/// El vale trae el hash del informe, las unidades, el vencimiento y la firma del
/// oráculo. El contrato vuelve a comprobar la firma antes de pagar: aunque este
/// código mintiera, no pagaría sin una firma válida.
export async function claimReward(contractAddress, voucher) {
  const ethProvider = new BrowserProvider(provider());
  const signer = await ethProvider.getSigner();
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
  const p = provider();
  if (!p || !contractAddress) return false;
  await p.request({
    method: 'wallet_watchAsset',
    params: { type: 'ERC20', options: { address: contractAddress, symbol: 'TKC', decimals: 18 } },
  });
  return true;
}

export { parseUnits, formatUnits };
