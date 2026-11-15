// Despliega TakCoin en la red que diga RPC_URL. Sin claves en el código: todo
// sale de variables de entorno.
//
//   RPC_URL                 endpoint de la red (p. ej. BSC mainnet o Polygon)
//   DEPLOYER_KEY            clave privada que paga el gas (necesita POL/BNB)
//   REPORT_SIGNER_ADDRESS   dirección pública del oráculo (la clave vive en el relé)
//   INITIAL_SUPPLY          opcional, por defecto 100000000 (100M TKC)
//   HALVING_SECONDS         opcional, por defecto 31536000 (365 días)
//   REWARD_FACTOR           opcional, por defecto 1e15 (0,001 TKC por punto)
//
// La dirección resultante se guarda en contracts/deployments/<chainId>.json.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ARTIFACT = path.join(__dirname, '..', 'artifacts', 'TakCoin.json');

async function main() {
  const { RPC_URL, DEPLOYER_KEY, REPORT_SIGNER_ADDRESS } = process.env;
  if (!RPC_URL) throw new Error('Falta RPC_URL');
  if (!DEPLOYER_KEY) throw new Error('Falta DEPLOYER_KEY');
  if (!REPORT_SIGNER_ADDRESS || !ethers.isAddress(REPORT_SIGNER_ADDRESS)) {
    throw new Error('Falta REPORT_SIGNER_ADDRESS (o no es una dirección válida)');
  }

  const initialSupply = ethers.parseUnits(String(process.env.INITIAL_SUPPLY || '100000000'), 18);
  const halvingSeconds = BigInt(process.env.HALVING_SECONDS || '31536000');
  const rewardFactor = BigInt(process.env.REWARD_FACTOR || '1000000000000000'); // 1e15

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  const net = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  console.log(`Red: chainId ${net.chainId}`);
  console.log(`Deployer: ${wallet.address} · gas disponible: ${ethers.formatEther(balance)}`);
  if (balance === 0n) throw new Error('La wallet del deployer no tiene gas (POL/BNB).');

  console.log('Desplegando TakCoin...');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(REPORT_SIGNER_ADDRESS, initialSupply, halvingSeconds, rewardFactor);
  const tx = contract.deploymentTransaction();
  console.log(`tx: ${tx.hash}`);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nTakCoin desplegado en: ${address}`);
  console.log(`  name:    ${await contract.name()}`);
  console.log(`  symbol:  ${await contract.symbol()}`);
  console.log(`  supply:  ${ethers.formatUnits(await contract.totalSupply(), 18)} TKC`);
  console.log(`  pool:    ${ethers.formatUnits(await contract.rewardPool(), 18)} TKC`);
  console.log(`  signer:  ${await contract.reportSigner()}`);

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${net.chainId}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        chainId: Number(net.chainId),
        address,
        reportSigner: REPORT_SIGNER_ADDRESS,
        initialSupply: initialSupply.toString(),
        halvingSeconds: halvingSeconds.toString(),
        rewardFactor: rewardFactor.toString(),
        deployer: wallet.address,
        txHash: tx.hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`Guardado en ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
