# TakCoin (TKC)

Token ERC-20 de suministro fijo para el ecosistema TakTak.

## Qué es

- **Nombre/símbolo:** TakCoin / TKC · 18 decimales.
- **Suministro:** 100.000.000 TKC, acuñado **una sola vez** en el constructor.
  No hay `mint` después, así que la oferta nunca se diluye.
- **Todo el suministro va al fondo del propio contrato** (`rewardPool`). Las
  recompensas de minado se pagan **de ese fondo**, no creando monedas: minar
  mueve TKC del fondo a la wallet del usuario.
- **Deflacionario:** `burn` y `burnFromPool` reducen `totalSupply`. La palanca de
  escasez es la quema, no la emisión.

## Cómo funciona el minado (sin confiar en el cliente)

1. El usuario ve vídeos en la app. El servidor guarda `WatchEvent` verificados.
2. Al reclamar, el backend (oráculo) calcula las unidades y **firma un vale**.
3. El usuario envía el vale al contrato. El contrato reconstruye el digest con
   sus propios datos (`block.chainid`, `address(this)`, `msg.sender`), recupera
   el firmante con `ecrecover` y **solo paga si es el oráculo**.
4. Cada `reportHash` se marca como usado: un vale no se cobra dos veces.

Regla de seguridad: el contrato **nunca** acepta las unidades que dice el
cliente. Un vale firmado para otra red o para otro contrato no cuela.

## Compilar y desplegar

```bash
cd contracts
npm install
npm run compile      # genera artifacts/TakCoin.json (ABI + bytecode)

# Despliegue (todo por variables de entorno, sin claves en el código):
RPC_URL=https://rpc-amoy.polygon.technology \
DEPLOYER_KEY=0x... \
REPORT_SIGNER_ADDRESS=0x... \
npm run deploy
```

Variables: `INITIAL_SUPPLY` (por defecto 100000000), `HALVING_SECONDS` (365 días),
`REWARD_FACTOR` (1e15 = 0,001 TKC por punto). El resultado se guarda en
`deployments/<chainId>.json`.

## Prueba

```bash
npm test   # levanta una EVM local (ganache) y comprueba el cobro y los abusos
```

Cubre: estado inicial, que el contrato paga lo mismo que calculó el backend,
rechazo de firma ajena, cobro real, anti-replay, vale caducado y quema.

## Parámetros que deben coincidir en los tres sitios

El score de un informe es `relay*5 + store*8 + uptime*1 + call*10 + reputation*3`,
y 1 punto paga `REWARD_FACTOR` wei. Estos valores están en el contrato, en
`backend/src/lib/voucher.js` y (los pesos) en la config del backend. Si se cambia
uno, hay que cambiar los otros: si divergen, `ecrecover` falla y no paga nadie.
