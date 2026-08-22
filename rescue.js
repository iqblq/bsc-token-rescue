/**
 * =====================================================================
 * BSC TOKEN RESCUE TOOL
 * =====================================================================
 * 
 * Tool untuk rescue token BEP-20 dari wallet yang kena sweeper bot.
 * 
 * Strategi:
 * 1. bloXroute Protect RPC — kirim tx via private mempool, bot gak bisa
 *    liat tx lo di mempool publik. Kirim 2 tx rapid-fire:
 *    - Tx1: Kirim BNB gas dari funding wallet ke compromised wallet
 *    - Tx2: Transfer token dari compromised wallet ke destination
 * 
 * 2. NodeReal Bundle — kirim 2 tx sebagai atomic bundle, dijamin masuk
 *    di block yang sama. Butuh NodeReal API key.
 * 
 * =====================================================================
 * IMPORTANT SAFETY NOTES:
 * - JANGAN pernah share private key ke siapapun
 * - JANGAN run script ini di komputer yang tidak aman
 * - Pastikan funding wallet HANYA berisi BNB secukupnya
 * - Test dulu di testnet kalau bisa
 * =====================================================================
 */

const { ethers } = require("ethers");
require("dotenv").config();

// ===== CONSTANTS =====
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const BSC_CHAIN_ID = 56;
const GAS_MULTIPLIER = 3n; // Kirim 3x lipat gas buat safety margin
const GAS_PRICE_MULTIPLIER = 2n; // 2x gas price biar tx cepet masuk

// ===== VALIDATION =====
function validateConfig() {
  const required = {
    COMPROMISED_PRIVATE_KEY: process.env.COMPROMISED_PRIVATE_KEY,
    FUNDING_PRIVATE_KEY: process.env.FUNDING_PRIVATE_KEY,
    DESTINATION_ADDRESS: process.env.DESTINATION_ADDRESS,
    TOKEN_CONTRACT: process.env.TOKEN_CONTRACT,
  };

  const missing = [];
  const placeholders = [
    "your_compromised_wallet_private_key_here",
    "your_safe_wallet_private_key_here",
    "your_safe_destination_address_here",
  ];

  for (const [key, value] of Object.entries(required)) {
    if (!value || placeholders.includes(value)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error("❌ Missing configuration in .env:");
    missing.forEach((k) => console.error(`   - ${k}`));
    console.error("\n📝 Copy .env.example ke .env dan isi semua value-nya.");
    process.exit(1);
  }

  // Validate addresses
  try {
    ethers.getAddress(required.DESTINATION_ADDRESS);
  } catch {
    console.error("❌ DESTINATION_ADDRESS bukan address yang valid!");
    process.exit(1);
  }

  try {
    ethers.getAddress(required.TOKEN_CONTRACT);
  } catch {
    console.error("❌ TOKEN_CONTRACT bukan address yang valid!");
    process.exit(1);
  }

  return required;
}

// ===== STRATEGY 1: bloXroute Protect RPC =====
async function rescueWithBloxroute(config) {
  console.log("\n🛡️  Strategy: bloXroute Protect RPC (Private Mempool)");
  console.log("   Tx lo gak akan keliatan di public mempool.\n");

  // Setup providers
  const readProvider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC || "https://bsc-rpc.publicnode.com"
  );
  const protectProvider = new ethers.JsonRpcProvider(
    process.env.BLOXROUTE_RPC || "https://bsc.rpc.blxrbdn.com"
  );

  // Setup wallets — funding wallet pake protect provider
  const fundingWallet = new ethers.Wallet(config.FUNDING_PRIVATE_KEY, protectProvider);
  const compromisedWallet = new ethers.Wallet(config.COMPROMISED_PRIVATE_KEY, protectProvider);
  const compromisedAddress = compromisedWallet.address;
  const destinationAddress = config.DESTINATION_ADDRESS;

  console.log(`📍 Compromised Wallet: ${compromisedAddress}`);
  console.log(`📍 Funding Wallet:     ${fundingWallet.address}`);
  console.log(`📍 Destination:        ${destinationAddress}`);

  // Token contract (read only, using public RPC)
  const tokenContract = new ethers.Contract(config.TOKEN_CONTRACT, ERC20_ABI, readProvider);
  const tokenWithSigner = new ethers.Contract(config.TOKEN_CONTRACT, ERC20_ABI, compromisedWallet);

  // Get token info
  const [name, symbol, decimals, balance] = await Promise.all([
    tokenContract.name(),
    tokenContract.symbol(),
    tokenContract.decimals(),
    tokenContract.balanceOf(compromisedAddress),
  ]);

  console.log(`\n🪙 Token: ${name} (${symbol})`);
  console.log(`💎 Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  if (balance === 0n) {
    console.log("\n⚠️  Token balance = 0. Gak ada yang bisa di-rescue.");
    return;
  }

  // Get current gas price & nonces
  const feeData = await readProvider.getFeeData();
  const currentGasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
  // Use higher gas price for faster inclusion
  const gasPrice = currentGasPrice * GAS_PRICE_MULTIPLIER;

  console.log(`\n⛽ Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei (2x normal)`);

  // Estimate gas for token transfer
  let gasEstimate = 65000n;
  try {
    gasEstimate = await tokenContract.transfer.estimateGas(
      destinationAddress,
      balance,
      { from: compromisedAddress }
    );
  } catch (e) {
    gasEstimate = 65000n;
  }

  // Calculate BNB needed (with safety multiplier)
  const bnbNeeded = gasEstimate * gasPrice * GAS_MULTIPLIER;

  console.log(`⛽ Gas Estimate: ${gasEstimate.toString()} units`);
  console.log(`💰 BNB Needed: ${ethers.formatEther(bnbNeeded)} BNB (3x safety margin)`);

  // Check funding wallet balance
  const fundingBalance = await readProvider.getBalance(fundingWallet.address);
  console.log(`💰 Funding Balance: ${ethers.formatEther(fundingBalance)} BNB`);

  if (fundingBalance < bnbNeeded) {
    console.error(`\n❌ Funding wallet butuh minimal ${ethers.formatEther(bnbNeeded)} BNB`);
    console.error(`   Sekarang cuma punya ${ethers.formatEther(fundingBalance)} BNB`);
    return;
  }

  // Get nonces
  const fundingNonce = await readProvider.getTransactionCount(fundingWallet.address, "pending");
  const compromisedNonce = await readProvider.getTransactionCount(compromisedAddress, "pending");

  console.log(`\n🔢 Funding Nonce: ${fundingNonce}`);
  console.log(`🔢 Compromised Nonce: ${compromisedNonce}`);

  console.log("\n🚀 ============================================");
  console.log("   MEMULAI RESCUE OPERATION!");
  console.log("   ============================================\n");

  console.log("⏳ Step 1: Kirim BNB gas via Protect RPC...");

  // TX1: Fund the compromised wallet with BNB (via Protect RPC)
  const fundTx = await fundingWallet.sendTransaction({
    to: compromisedAddress,
    value: bnbNeeded,
    gasPrice: gasPrice,
    gasLimit: 21000n,
    nonce: fundingNonce,
    chainId: BSC_CHAIN_ID,
  });

  console.log(`   ✅ Funding TX sent: ${fundTx.hash}`);
  console.log(`   ⏳ Menunggu konfirmasi...\n`);

  // Wait for funding tx to confirm
  const fundReceipt = await fundTx.wait(1);
  console.log(`   ✅ Funding TX confirmed di block ${fundReceipt.blockNumber}!`);

  // Tiny delay to ensure state propagation
  await new Promise((r) => setTimeout(r, 500));

  // TX2: Transfer token out (via Protect RPC - IMMEDIATELY after funding)
  console.log("\n⏳ Step 2: Transfer token via Protect RPC (SEGERA!)...");

  try {
    const transferTx = await tokenWithSigner.transfer(
      destinationAddress,
      balance,
      {
        gasPrice: gasPrice,
        gasLimit: gasEstimate * 2n, // Extra gas limit safety
        nonce: compromisedNonce,
        chainId: BSC_CHAIN_ID,
      }
    );

    console.log(`   ✅ Transfer TX sent: ${transferTx.hash}`);
    console.log(`   ⏳ Menunggu konfirmasi...\n`);

    const transferReceipt = await transferTx.wait(1);
    console.log(`   ✅ Transfer TX confirmed di block ${transferReceipt.blockNumber}!`);

    console.log("\n🎉 ============================================");
    console.log("   RESCUE BERHASIL!");
    console.log("   ============================================");
    console.log(`   ${ethers.formatUnits(balance, decimals)} ${symbol}`);
    console.log(`   dikirim ke ${destinationAddress}`);
    console.log("   ============================================\n");
  } catch (error) {
    console.error(`\n❌ Transfer GAGAL: ${error.message}`);
    console.error("   Sweeper bot mungkin udah drain BNB-nya.");
    console.error("   Coba lagi atau pake strategy NodeReal bundle.\n");
  }
}

// ===== STRATEGY 2: NodeReal Bundle (Atomic) =====
async function rescueWithNodeRealBundle(config) {
  console.log("\n🔗 Strategy: NodeReal Bundle (Atomic Transaction)");
  console.log("   Kedua TX dijamin masuk di block yang SAMA.\n");

  const apiKey = process.env.NODEREAL_API_KEY;
  if (!apiKey) {
    console.error("❌ NODEREAL_API_KEY belum diset di .env!");
    console.error("   Daftar gratis di https://nodereal.io");
    console.error("   Atau pake strategy 'bloxroute' yang gak butuh API key.");
    process.exit(1);
  }

  // Setup providers
  const readProvider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC || "https://bsc-rpc.publicnode.com"
  );
  const bundleProvider = new ethers.JsonRpcProvider(
    `https://bsc-mainnet.nodereal.io/v1/${apiKey}`
  );

  // Setup wallets
  const fundingWallet = new ethers.Wallet(config.FUNDING_PRIVATE_KEY, readProvider);
  const compromisedWallet = new ethers.Wallet(config.COMPROMISED_PRIVATE_KEY, readProvider);
  const compromisedAddress = compromisedWallet.address;
  const destinationAddress = config.DESTINATION_ADDRESS;

  console.log(`📍 Compromised Wallet: ${compromisedAddress}`);
  console.log(`📍 Funding Wallet:     ${fundingWallet.address}`);
  console.log(`📍 Destination:        ${destinationAddress}`);

  // Token contract
  const tokenContract = new ethers.Contract(config.TOKEN_CONTRACT, ERC20_ABI, readProvider);

  // Get token info
  const [name, symbol, decimals, balance] = await Promise.all([
    tokenContract.name(),
    tokenContract.symbol(),
    tokenContract.decimals(),
    tokenContract.balanceOf(compromisedAddress),
  ]);

  console.log(`\n🪙 Token: ${name} (${symbol})`);
  console.log(`💎 Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  if (balance === 0n) {
    console.log("\n⚠️  Token balance = 0. Gak ada yang bisa di-rescue.");
    return;
  }

  // Get gas info
  const feeData = await readProvider.getFeeData();
  const gasPrice = (feeData.gasPrice || ethers.parseUnits("3", "gwei")) * GAS_PRICE_MULTIPLIER;

  // Estimate gas for token transfer
  let gasEstimate = 65000n;
  try {
    gasEstimate = await tokenContract.transfer.estimateGas(
      destinationAddress,
      balance,
      { from: compromisedAddress }
    );
  } catch (e) {
    gasEstimate = 65000n;
  }

  const bnbNeeded = gasEstimate * gasPrice * 2n; // 2x safety

  console.log(`\n⛽ Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);
  console.log(`⛽ Gas Estimate: ${gasEstimate.toString()} units`);
  console.log(`💰 BNB Needed: ${ethers.formatEther(bnbNeeded)} BNB`);

  // Check funding balance
  const fundingBalance = await readProvider.getBalance(fundingWallet.address);
  if (fundingBalance < bnbNeeded) {
    console.error(`\n❌ Funding wallet butuh minimal ${ethers.formatEther(bnbNeeded)} BNB`);
    return;
  }

  // Get nonces
  const fundingNonce = await readProvider.getTransactionCount(fundingWallet.address, "pending");
  const compromisedNonce = await readProvider.getTransactionCount(compromisedAddress, "pending");

  // Get current block number
  const currentBlock = await readProvider.getBlockNumber();
  const targetBlock = currentBlock + 5; // Give 5 blocks window

  console.log(`\n🔢 Current Block: ${currentBlock}`);
  console.log(`🔢 Target Max Block: ${targetBlock}`);

  // ===== CREATE SIGNED TRANSACTIONS =====

  // TX1: Fund compromised wallet
  const fundTxData = {
    to: compromisedAddress,
    value: bnbNeeded,
    gasPrice: gasPrice,
    gasLimit: 21000n,
    nonce: fundingNonce,
    chainId: BSC_CHAIN_ID,
    type: 0, // Legacy tx
  };

  const signedFundTx = await fundingWallet.signTransaction(fundTxData);

  // TX2: Transfer token
  const tokenInterface = new ethers.Interface(ERC20_ABI);
  const transferData = tokenInterface.encodeFunctionData("transfer", [
    destinationAddress,
    balance,
  ]);

  const transferTxData = {
    to: config.TOKEN_CONTRACT,
    data: transferData,
    gasPrice: gasPrice,
    gasLimit: gasEstimate * 2n,
    nonce: compromisedNonce,
    chainId: BSC_CHAIN_ID,
    value: 0n,
    type: 0,
  };

  const signedTransferTx = await compromisedWallet.signTransaction(transferTxData);

  console.log("\n🚀 ============================================");
  console.log("   MENGIRIM BUNDLE KE NODEREAL!");
  console.log("   ============================================\n");

  // Submit bundle via eth_sendBundle
  try {
    const bundleResult = await bundleProvider.send("eth_sendBundle", [
      {
        txs: [signedFundTx, signedTransferTx],
        maxBlockNumber: `0x${targetBlock.toString(16)}`,
        revertingTxHashes: [],
      },
    ]);

    console.log(`✅ Bundle submitted!`);
    console.log(`   Response: ${JSON.stringify(bundleResult)}`);

    // Wait and check if transfer succeeded
    console.log("\n⏳ Menunggu bundle diproses (max ~15 detik)...\n");

    let rescued = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const newBalance = await tokenContract.balanceOf(compromisedAddress);
      if (newBalance === 0n) {
        rescued = true;
        break;
      }
      console.log(`   Checking... block ${await readProvider.getBlockNumber()}, token balance: ${ethers.formatUnits(newBalance, decimals)}`);
    }

    if (rescued) {
      // Verify destination received tokens
      const destBalance = await tokenContract.balanceOf(destinationAddress);
      console.log("\n🎉 ============================================");
      console.log("   RESCUE BERHASIL!");
      console.log("   ============================================");
      console.log(`   ${ethers.formatUnits(balance, decimals)} ${symbol}`);
      console.log(`   dikirim ke ${destinationAddress}`);
      console.log(`   Destination balance: ${ethers.formatUnits(destBalance, decimals)} ${symbol}`);
      console.log("   ============================================\n");
    } else {
      console.log("\n⚠️  Bundle mungkin belum masuk. Cek manual:");
      console.log(`   https://bscscan.com/address/${destinationAddress}`);
    }
  } catch (error) {
    console.error(`\n❌ Bundle submission GAGAL: ${error.message}`);
    console.error("   Coba lagi atau pake strategy 'bloxroute'.\n");
  }
}

// ===== STRATEGY 3: Rapid-Fire (Aggressive, No Special RPC) =====
async function rescueRapidFire(config) {
  console.log("\n⚡ Strategy: Rapid-Fire (Aggressive Speed)");
  console.log("   Kirim 2 TX secepat mungkin dengan gas tinggi.");
  console.log("   Kurang reliable dibanding bundle, tapi gak butuh special RPC.\n");

  const provider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC || "https://bsc-rpc.publicnode.com"
  );

  const fundingWallet = new ethers.Wallet(config.FUNDING_PRIVATE_KEY, provider);
  const compromisedWallet = new ethers.Wallet(config.COMPROMISED_PRIVATE_KEY, provider);
  const compromisedAddress = compromisedWallet.address;
  const destinationAddress = config.DESTINATION_ADDRESS;

  const tokenContract = new ethers.Contract(config.TOKEN_CONTRACT, ERC20_ABI, provider);
  const tokenWithSigner = new ethers.Contract(config.TOKEN_CONTRACT, ERC20_ABI, compromisedWallet);

  const [name, symbol, decimals, balance] = await Promise.all([
    tokenContract.name(),
    tokenContract.symbol(),
    tokenContract.decimals(),
    tokenContract.balanceOf(compromisedAddress),
  ]);

  console.log(`🪙 Token: ${name} (${symbol})`);
  console.log(`💎 Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  if (balance === 0n) {
    console.log("\n⚠️  Token balance = 0.");
    return;
  }

  const feeData = await provider.getFeeData();
  // Use 5x gas price to prioritize
  const gasPrice = (feeData.gasPrice || ethers.parseUnits("3", "gwei")) * 5n;

  let gasEstimate = 65000n;
  try {
    gasEstimate = await tokenContract.transfer.estimateGas(
      destinationAddress,
      balance,
      { from: compromisedAddress }
    );
  } catch (e) {
    gasEstimate = 65000n;
  }

  const bnbNeeded = gasEstimate * gasPrice * 2n;

  // Get nonces
  const fundingNonce = await provider.getTransactionCount(fundingWallet.address, "pending");
  const compromisedNonce = await provider.getTransactionCount(compromisedAddress, "pending");

  console.log(`\n⛽ Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei (5x normal!)`);
  console.log(`💰 BNB Needed: ${ethers.formatEther(bnbNeeded)} BNB`);

  console.log("\n🚀 RAPID FIRE! Kirim kedua TX hampir bersamaan...\n");

  // Sign both transactions FIRST
  const signedFundTx = await fundingWallet.signTransaction({
    to: compromisedAddress,
    value: bnbNeeded,
    gasPrice: gasPrice,
    gasLimit: 21000n,
    nonce: fundingNonce,
    chainId: BSC_CHAIN_ID,
    type: 0,
  });

  const tokenInterface = new ethers.Interface(ERC20_ABI);
  const transferData = tokenInterface.encodeFunctionData("transfer", [
    destinationAddress,
    balance,
  ]);

  const signedTransferTx = await compromisedWallet.signTransaction({
    to: config.TOKEN_CONTRACT,
    data: transferData,
    gasPrice: gasPrice,
    gasLimit: gasEstimate * 2n,
    nonce: compromisedNonce,
    chainId: BSC_CHAIN_ID,
    value: 0n,
    type: 0,
  });

  // Send both TX as fast as possible
  const [fundResult, transferResult] = await Promise.all([
    provider.broadcastTransaction(signedFundTx),
    provider.broadcastTransaction(signedTransferTx),
  ]);

  console.log(`✅ Fund TX: ${fundResult.hash}`);
  console.log(`✅ Transfer TX: ${transferResult.hash}`);
  console.log("\n⏳ Menunggu konfirmasi...\n");

  try {
    const [fundReceipt, transferReceipt] = await Promise.all([
      fundResult.wait(1),
      transferResult.wait(1),
    ]);

    if (transferReceipt && transferReceipt.status === 1) {
      console.log("\n🎉 RESCUE BERHASIL!");
      console.log(`   ${ethers.formatUnits(balance, decimals)} ${symbol} → ${destinationAddress}`);
    } else {
      console.log("\n❌ Transfer TX reverted. Bot mungkin udah drain.");
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error("   Sweeper bot kemungkinan menang race.");
  }
}

// ===== MAIN =====
async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║     🚨 BSC TOKEN RESCUE TOOL 🚨              ║");
  console.log("║     Rescue tokens from compromised wallet     ║");
  console.log("║     with sweeper bot protection               ║");
  console.log("╚════════════════════════════════════════════════╝");

  const config = validateConfig();

  const strategy = process.env.RESCUE_STRATEGY || "bloxroute";

  switch (strategy.toLowerCase()) {
    case "bloxroute":
      await rescueWithBloxroute(config);
      break;
    case "nodereal":
      await rescueWithNodeRealBundle(config);
      break;
    case "rapidfire":
      await rescueRapidFire(config);
      break;
    default:
      console.error(`❌ Unknown strategy: ${strategy}`);
      console.error("   Pilih: bloxroute, nodereal, atau rapidfire");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n💥 FATAL ERROR:", error.message);
  console.error(error);
  process.exit(1);
});
