// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * TakCoin (TKC) — la moneda del ecosistema TakTak.
 *
 * Es un ERC-20 de suministro FIJO. Todo el suministro se acuña una sola vez en
 * el constructor y va al fondo de recompensas del propio contrato: no hay
 * `mint` posterior, así que la oferta nunca se diluye.
 *
 * Tres usos, todos pagados del fondo (el contrato nunca confía en el cliente):
 *
 *  1. `claimMiningReward` — el minado por ver vídeos. El backend (oráculo) firma
 *     un "vale" con las unidades verificadas en servidor; el contrato comprueba
 *     la firma con `ecrecover` antes de pagar. El importe sale del fondo, no de
 *     un saldo del usuario, así que minar no infla la oferta: la mueve del fondo
 *     a la wallet del minero.
 *
 *  2. `burn` (heredado de ERC20Burnable) — quema de monedas, la palanca
 *     deflacionaria. Quien quema destruye saldo propio; el admin quema su 40%
 *     de los regalos para que la oferta neta baje con el uso.
 *
 *  3. `rewardPool()` / `rewardFor()` — vistas para que cualquiera pueda auditar
 *     cuánto queda por repartir y cuánto vale un informe antes de cobrarlo.
 *
 * Regla de oro: el contrato NUNCA acepta las unidades que dice el cliente. Solo
 * paga si el digest reconstruido con SUS propios datos (chainId, dirección del
 * contrato, usuario, hash del informe, unidades y deadline) coincide con la
 * firma del oráculo. Un `reportHash` solo se puede cobrar una vez (anti-replay).
 */
contract TakCoin {
    // --- Metadatos ERC-20 ---
    string public constant name = "TakCoin";
    string public constant symbol = "TKC";
    uint8 public constant decimals = 18;

    uint256 public constant MAX_SUPPLY = 100_000_000 ether;

    // Pesos de minado. Tienen que ser IDÉNTICOS en el contrato, en el backend y
    // en el frontend: el score se calcula igual en los tres sitios.
    uint256 public constant W_RELAY = 5;
    uint256 public constant W_STORE = 8;
    uint256 public constant W_UPTIME = 1;
    uint256 public constant W_CALL = 10;
    uint256 public constant W_REPUTATION = 3;

    // Oráculo que firma los vales de minado. Es una dirección pública; la clave
    // privada vive SOLO en el servidor.
    address public immutable reportSigner;

    // Tamaño del bloque de halving, en segundos (p. ej. 365 días). Cada bloque
    // completo reduce a la mitad lo que paga un informe.
    uint256 public immutable halvingInterval;
    // Momento del despliegue: primer bloque de halving.
    uint256 public immutable deployedAt;

    // Recompensa de un informe con score 1e18, en wei de TKC. Con 1e15, un punto
    // de score paga 0,001 TKC.
    uint256 public immutable rewardFactor;

    // Saldo acumulado para recompensas de minado. Es la única fuente de la que
    // sale `claimMiningReward`, así que el pago siempre está respaldado.
    uint256 public rewardPool;

    // Oferta en circulación. Nace en el constructor y solo BAJA (al quemar):
    // nunca se acuña después, así que es deflacionaria por construcción.
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    // Informes ya cobrados. Un `reportHash` aquí no se vuelve a pagar.
    mapping(bytes32 => bool) public usedReport;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MiningReward(address indexed user, bytes32 indexed reportHash, uint256 amount, uint256 score);
    event RewardPoolFunded(address indexed from, uint256 amount);
    event RewardPoolBurned(address indexed from, uint256 amount);

    /**
     * @param _reportSigner     Oráculo que firma los vales.
     * @param _initialSupply    Suministro inicial (va al fondo de recompensas).
     * @param _halvingInterval  Segundos entre halvings (365 días = 31_536_000).
     * @param _rewardFactor     Wei de TKC por punto de score (1e15 = 0,001 TKC).
     */
    constructor(
        address _reportSigner,
        uint256 _initialSupply,
        uint256 _halvingInterval,
        uint256 _rewardFactor
    ) {
        require(_reportSigner != address(0), "signer cero");
        require(_initialSupply > 0 && _initialSupply <= MAX_SUPPLY, "suministro fuera de rango");
        require(_rewardFactor > 0, "factor cero");

        reportSigner = _reportSigner;
        halvingInterval = _halvingInterval == 0 ? 365 days : _halvingInterval;
        rewardFactor = _rewardFactor;
        deployedAt = block.timestamp;

        // Todo el suministro al fondo de recompensas del propio contrato.
        rewardPool = _initialSupply;
        totalSupply = _initialSupply;
        emit RewardPoolFunded(address(this), _initialSupply);
    }

    // --- ERC-20 ---

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance insuficiente");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "destino cero");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "saldo insuficiente");
        unchecked {
            balanceOf[from] = fromBalance - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // --- Quema (deflacionaria) ---

    /// Quema `value` TKC del propio saldo de quien llama.
    function burn(uint256 value) external {
        uint256 fromBalance = balanceOf[msg.sender];
        require(fromBalance >= value, "saldo insuficiente");
        unchecked {
            balanceOf[msg.sender] = fromBalance - value;
        }
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
        emit RewardPoolBurned(msg.sender, value);
    }

    /// Quema `value` TKC del fondo de recompensas. Solo el oráculo, que es quien
    /// administra el fondo: sirve para retirar de circulación lo que no se vaya
    /// a repartir y hacer la oferta neta más escasa.
    function burnFromPool(uint256 value) external {
        require(msg.sender == reportSigner, "solo oraculo");
        require(rewardPool >= value, "fondo insuficiente");
        unchecked {
            rewardPool -= value;
        }
        totalSupply -= value;
        emit RewardPoolBurned(address(this), value);
    }

    // --- Minado ---

    /// Score de un informe: suma ponderada de las unidades, en "puntos".
    /// 1 punto paga `rewardFactor` wei de TKC (con 1e15, 0,001 TKC).
    function scoreOf(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public pure returns (uint256) {
        return
            relayUnits * W_RELAY +
            storeUnits * W_STORE +
            uptimeUnits * W_UPTIME +
            callUnits * W_CALL +
            reputationUnits * W_REPUTATION;
    }

    /// Cuánto paga ahora mismo un informe, con halving aplicado. Público para
    /// que la UI (y los tests) puedan comparar con lo que calculó el backend.
    function rewardFor(
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits
    ) public view returns (uint256) {
        return _reward(scoreOf(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits));
    }

    /// Aplica el halving a un score ya calculado. Con divisor 0 (pasados ~64
    /// halvings) el pago es 0, no un revert por división por cero.
    function _reward(uint256 score) internal view returns (uint256) {
        uint256 divisor = _rewardDivisor();
        if (divisor == 0) return 0;
        return (score * rewardFactor) / divisor;
    }

    function _rewardDivisor() internal view returns (uint256) {
        uint256 halvings = (block.timestamp - deployedAt) / halvingInterval;
        // A partir de 64 halvings el pago ya sería 0; se corta para no desbordar
        // al calcular 2 ** halvings.
        if (halvings >= 64) return 0;
        return 2 ** halvings;
    }

    /**
     * Cobra la recompensa de minado de un informe firmado por el oráculo.
     *
     * El digest se reconstruye aquí con los datos REALES de esta cadena y este
     * contrato (`block.chainid` y `address(this)`), no con lo que mande el
     * cliente: un vale firmado para otra red o para otro contrato no cuela.
     */
    function claimMiningReward(
        bytes32 reportHash,
        uint256 relayUnits,
        uint256 storeUnits,
        uint256 uptimeUnits,
        uint256 callUnits,
        uint256 reputationUnits,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "vale caducado");
        require(!usedReport[reportHash], "informe ya cobrado");

        bytes32 digest = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                reportHash,
                relayUnits,
                storeUnits,
                uptimeUnits,
                callUnits,
                reputationUnits,
                deadline
            )
        );

        require(_recover(digest, signature) == reportSigner, "firma invalida");

        uint256 score = scoreOf(relayUnits, storeUnits, uptimeUnits, callUnits, reputationUnits);
        uint256 reward = _reward(score);
        require(reward > 0, "recompensa cero");
        require(rewardPool >= reward, "fondo agotado");

        usedReport[reportHash] = true;
        unchecked {
            rewardPool -= reward;
        }
        balanceOf[msg.sender] += reward;

        emit Transfer(address(this), msg.sender, reward);
        emit MiningReward(msg.sender, reportHash, reward, score);
    }

    /// Prefijo estándar EIP-191 ("\x19Ethereum Signed Message:\n32") sobre el
    /// digest, que es lo que firma ethers del lado del backend.
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "firma mal formada");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)), v, r, s);
    }
}
