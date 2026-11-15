// Compila TakCoin.sol con solc (optimizador 200 runs) y guarda el artifact
// (ABI + bytecode) en contracts/artifacts/. Así el despliegue no depende de
// Remix ni de tener conexión a la red.
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const SRC = path.join(__dirname, '..', 'TakCoin.sol');
const OUT_DIR = path.join(__dirname, '..', 'artifacts');
const OUT = path.join(OUT_DIR, 'TakCoin.json');

function main() {
  const source = fs.readFileSync(SRC, 'utf8');

  const input = {
    language: 'Solidity',
    sources: { 'TakCoin.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    process.exit(1);
  }
  for (const w of (output.errors || []).filter((e) => e.severity === 'warning')) {
    console.warn(w.formattedMessage);
  }

  const contract = output.contracts['TakCoin.sol'].TakCoin;
  const artifact = { contractName: 'TakCoin', abi: contract.abi, bytecode: contract.evm.bytecode.object };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2));
  console.log(`Artifact escrito en ${path.relative(process.cwd(), OUT)}`);
  console.log(`ABI: ${artifact.abi.length} entradas · bytecode: ${artifact.bytecode.length / 2} bytes`);
}

main();
