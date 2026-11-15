// Prueba de extremo a extremo del minado de TakCoin, sobre una EVM local
// (ganache). No toca ninguna red real: despliega el contrato, firma un vale con
// una clave de oráculo de prueba y comprueba que el contrato lo acepta, paga el
// importe correcto y rechaza los intentos de abuso.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ARTIFACT = path.join(__dirname, '..', 'artifacts', 'TakCoin.json');

// Pesos y factor idénticos a los del backend y el contrato.
const WEIGHTS = { relay: 5, store: 8, uptime: 1, call: 10, reputation: 3 };
const REWARD_FACTOR = 10n ** 15n; // 1e15

const TYPES = [
  'uint256', 'address', 'address', 'bytes32',
  'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256',
];

function scoreOf(u) {
  return (
    BigInt(u.relay) * BigInt(WEIGHTS.relay) +
    BigInt(u.store) * BigInt(WEIGHTS.store) +
    BigInt(u.uptime) * BigInt(WEIGHTS.uptime) +
    BigInt(u.call) * BigInt(WEIGHTS.call) +
    BigInt(u.reputation) * BigInt(WEIGHTS.reputation)
  );
}

function digestFor({ chainId, contract, user, reportHash, units, deadline }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(TYPES, [
      chainId, contract, user, reportHash,
      units.relay, units.store, units.uptime, units.call, units.reputation, deadline,
    ])
  );
}

async function main() {
  const ganache = require('ganache');
  const server = ganache.server({ logging: { quiet: true }, chain: { chainId: 1337 } });
  await server.listen(8546);
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8546');

  try {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
    const deployer = await provider.getSigner(0);
    const oracle = ethers.Wallet.createRandom().connect(provider);
    // El usuario es una wallet real: firma localmente (personal_sign no está en
    // ganache) y necesita gas, que le manda el deployer.
    const user = ethers.Wallet.createRandom().connect(provider);
    await (await deployer.sendTransaction({ to: user.address, value: ethers.parseEther('1') })).wait();

    const initialSupply = ethers.parseUnits('100000000', 18);
    const halvingSeconds = 365n * 24n * 60n * 60n;

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const token = await factory.deploy(oracle.address, initialSupply, halvingSeconds, REWARD_FACTOR);
    await token.waitForDeployment();
    const address = await token.getAddress();

    // --- Estado inicial ---
    assert.equal(await token.name(), 'TakCoin');
    assert.equal(await token.symbol(), 'TKC');
    assert.equal(await token.decimals(), 18);
    assert.equal(await token.reportSigner(), oracle.address);
    assert.equal(await token.totalSupply(), initialSupply, 'suministro inicial');
    assert.equal(await token.rewardPool(), initialSupply, 'todo va al fondo');
    assert.equal(await token.balanceOf(address), 0n, 'el contrato no se queda saldo propio');
    console.log('OK estado inicial: 100M TKC en el fondo, signer correcto');

    // --- El vale paga lo mismo que calculo el backend ---
    // 100.000 puntos = 100 TKC (con rewardFactor 1e15: 1.000 puntos = 1 TKC).
    const units = { relay: 0, store: 0, uptime: 100000, call: 0, reputation: 0 };
    const onChainReward = await token.rewardFor(units.relay, units.store, units.uptime, units.call, units.reputation);
    const expectedReward = (scoreOf(units) * REWARD_FACTOR) / 1n;
    assert.equal(onChainReward, expectedReward, 'rewardFor coincide con el backend');
    assert.equal(onChainReward, ethers.parseUnits('100', 18), '100.000 puntos = 100 TKC');
    console.log(`OK rewardFor coincide con el backend: ${ethers.formatUnits(onChainReward, 18)} TKC`);

    const chainId = (await provider.getNetwork()).chainId;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const reportHash = ethers.keccak256(ethers.toUtf8Bytes('test-report-1'));
    const digest = digestFor({ chainId, contract: address, user: user.address, reportHash, units, deadline });
    const signature = await oracle.signMessage(ethers.getBytes(digest));

    // staticCall: comprueba que el contrato aceptaria el vale, sin gastar gas.
    await token.connect(user).claimMiningReward.staticCall(
      reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, signature
    );
    console.log('OK staticCall acepta el vale valido');

    // --- Firma manipulada: rechazada ---
    const badSignature = await user.signMessage(ethers.getBytes(digest));
    let rejected = false;
    try {
      await token.connect(user).claimMiningReward.staticCall(
        reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, badSignature
      );
    } catch { rejected = true; }
    assert.ok(rejected, 'una firma ajena debe rechazarse');
    console.log('OK rechaza un vale con firma que no es del oraculo');

    // --- Cobro real ---
    const before = await token.balanceOf(user.address);
    const tx = await token.connect(user).claimMiningReward(
      reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, signature
    );
    await tx.wait();
    const after = await token.balanceOf(user.address);
    assert.equal(after - before, expectedReward, 'el usuario cobra exactamente la recompensa');
    assert.equal(await token.rewardPool(), initialSupply - expectedReward, 'el fondo baja lo pagado');
    assert.equal(await token.usedReport(reportHash), true, 'el informe queda marcado como usado');
    console.log(`OK cobro real: +${ethers.formatUnits(after - before, 18)} TKC, fondo reducido`);

    // --- Anti-replay: el mismo informe no se cobra dos veces ---
    let replayRejected = false;
    try {
      await token.connect(user).claimMiningReward.staticCall(
        reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, signature
      );
    } catch { replayRejected = true; }
    assert.ok(replayRejected, 'no se puede cobrar dos veces el mismo informe');
    console.log('OK anti-replay: el mismo informe no se cobra dos veces');

    // --- Vale caducado: rechazado ---
    const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 1);
    const oldHash = ethers.keccak256(ethers.toUtf8Bytes('test-report-old'));
    const oldDigest = digestFor({ chainId, contract: address, user: user.address, reportHash: oldHash, units, deadline: pastDeadline });
    const oldSignature = await oracle.signMessage(ethers.getBytes(oldDigest));
    let expiredRejected = false;
    try {
      await token.connect(user).claimMiningReward.staticCall(
        oldHash, units.relay, units.store, units.uptime, units.call, units.reputation, pastDeadline, oldSignature
      );
    } catch { expiredRejected = true; }
    assert.ok(expiredRejected, 'un vale caducado debe rechazarse');
    console.log('OK rechaza un vale caducado');

    // --- Quema: el suministro baja ---
    const burnAmount = after / 2n;
    await (await token.connect(user).burn(burnAmount)).wait();
    assert.equal(await token.totalSupply(), initialSupply - burnAmount, 'quemar reduce totalSupply');
    console.log('OK quema reduce totalSupply (deflacionario)');

    console.log('\nTODO OK: contrato desplegado, vale verificado on-chain y abusos rechazados.');
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error('FALLO:', e.message || e);
  process.exit(1);
});
