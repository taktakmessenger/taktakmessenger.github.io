# Desplegar TakCoin (TKC)

## Qué red usar

| Red | chainId | Gas | Faucet | Para qué |
|-----|---------|-----|--------|----------|
| **Polygon Amoy** (pruebas) | 80002 | POL gratis | sí | **Empezar aquí** |
| **BNB Smart Chain Testnet** (pruebas) | 97 | tBNB gratis | sí | Alternativa (misma familia que el cobro actual) |
| Polygon PoS (real) | 137 | POL de pago | no | Producción barata |
| BNB Smart Chain (real) | 56 | BNB de pago | no | Producción |

**Recomendación: Polygon Amoy (80002).** Es la red de pruebas más usada y la que ya
trae el código por defecto (`CHAIN_ID=80002`). El gas de test es gratis, así que se
puede desplegar y probar el minado entero sin gastar dinero. Cuando funcione, se
despliega igual en Polygon PoS o BNB Chain cambiando solo `RPC_URL`.

> No uses "redes" raras o faucets desconocidos: suelen ser cadenas privadas donde la
> gente prueba y pierde el rastro del contrato.

## 1. Faucets (monedas gratis para pagar el gas)

Un faucet es una web que te regala cripto de prueba. Necesitas una cartera
(MetaMask) y pegar en el faucet su dirección.

**Polygon Amoy (POL de prueba)**
- Alchemy: https://www.alchemy.com/faucets/polygon-amoy (pide cuenta gratis)
- QuickNode: https://faucet.quicknode.com/polygon/amoy
- Faucet oficial: https://faucet.polygon.technology

**BNB Smart Chain Testnet (tBNB)**
- https://www.bnbchain.org/en/testnet-faucet
- Alternativa: https://testnet.bnbchain.org/faucet-smart

Si un faucet no da nada, prueba otro: cambian de límites a menudo.

## 2. RPC (nodo para hablar con la red)

Los que se usan por defecto (comprobados y respondiendo):
- Amoy: `https://polygon-amoy-bor-rpc.publicnode.com` (respaldo: `https://polygon-amoy.drpc.org`)
- BSC testnet: `https://bsc-testnet.publicnode.com`
- BSC mainnet: `https://bsc-dataseed.binance.org`

## 3. Desplegar

Hace falta la **dirección pública del oráculo** (el backend firma los vales con su
clave privada; el contrato solo guarda la dirección pública).

```bash
cd contracts
npm install
npm run compile

RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com \
DEPLOYER_KEY=0x...tu_clave_privada... \
REPORT_SIGNER_ADDRESS=0x...direccion_del_oraculo... \
npm run deploy
```

Al terminar, imprime la dirección del contrato y la guarda en
`deployments/<chainId>.json`. **Esa dirección es `MINING_CONTRACT`.**

Generar un par de claves nuevo para el oráculo (guarda la privada en el gestor de
secretos, nunca en el repositorio):

```bash
node -e "const{Wallet}=require('ethers');const w=Wallet.createRandom();console.log('address',w.address);console.log('key',w.privateKey)"
```

## 4. Enchufarlo al backend (Render)

En las variables de entorno del servicio:

```
MINING_CONTRACT=0x...        # la del paso 3
REPORT_SIGNER_KEY=0x...      # la privada del oráculo (SECRETO)
CHAIN_ID=80002               # 137 Polygon, 56 BSC
RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
```

Sin `MINING_CONTRACT` y `REPORT_SIGNER_KEY` el minado queda apagado y
`/api/mining/*` responde 503. `RPC_URL` solo hace falta para la quema del fondo.

## 5. Comprobar

- `GET /api/mining/config` debe responder `"configured": true`.
- En la app: tienda → panel de minado → conectar cartera → ver vídeos → cobrar.
- El explorador de bloques de la red (p. ej. https://amoy.polygonscan.com) muestra la
  transacción y el contrato.
