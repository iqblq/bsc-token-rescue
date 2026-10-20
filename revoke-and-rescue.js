/**
 * =====================================================================
 * EIP-7702 ATOMIC RESCUE TOOL FOR BSC
 * =====================================================================
 * 
 * Tool ini mengeksekusi penyelamatan token BEP-20 dari wallet yang terkena
 * bajak / sweeper bot via EIP-7702 Delegation secara ATOMIK (1 Transaksi):
 * 
 * 1. Compromised Wallet menandatangani otorisasi EIP-7702 yang mendelegasikan
 *    wallet ke Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11).
 * 2. Sponsor Wallet mengirim Transaksi Type-4 (EIP-7702) ke Compromised Wallet
 *    dengan payload `aggregate3` untuk mentransfer token ke Safe Destination.
 * 3. Keunggulan:
 *    - 100% ATOMIK: Selesai dalam 1 blok / 1 transaksi.
 *    - 0 BNB di Compromised Wallet: Sweeper bot tidak bisa mencuri gas fee.
 *    - Seluruh gas fee dibayar oleh Sponsor Wallet.
 *    - Transaksi dikirim via Private Mempool (bloXroute Protect RPC).
 * =====================================================================
 */

const {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  formatEther,
  formatUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bsc } = require("viem/chains");
require("dotenv").config();

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "function aggregate3(Call3[] calls) payable returns ((bool success, bytes returnData)[])",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

function formatPrivateKey(pk) {
  if (!pk) return pk;
  const clean = pk.trim();
  return clean.startsWith("0x") ? clean : `0x${clean}`;
}

const FALLBACK_RPCS = [
  process.env.BSC_RPC,
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed-public.bnbchain.org",
  "https://binance.llamarpc.com",
].filter(Boolean);

async function getWorkingPublicClient() {
  for (const url of FALLBACK_RPCS) {
    try {
      const client = createPublicClient({ chain: bsc, transport: http(url) });
      await client.getBlockNumber();
      return { client, url };
    } catch {
      // try next
    }
  }
  throw new Error("Gagal terhubung ke RPC BSC publik manapun.");
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     🛡️ EIP-7702 ATOMIC TOKEN RESCUE FOR BSC 🛡️           ║");
  console.log("║     Bypass Sweeper Bot via Single Atomic Transaction    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const compKey = formatPrivateKey(process.env.COMPROMISED_PRIVATE_KEY);
  const fundKey = formatPrivateKey(process.env.FUNDING_PRIVATE_KEY);
  const destAddress = (process.env.DESTINATION_ADDRESS || "").trim();
  const tokenAddress = (process.env.TOKEN_CONTRACT || "0x8aab31fbc69c92fa53f600910cf0f215531f8239").trim();
  const privateRpcUrl = process.env.BLOXROUTE_RPC || "https://bsc.rpc.blxrbdn.com";

  if (!compKey || !fundKey || !destAddress || !tokenAddress) {
    console.error("❌ Pastikan file .env sudah diisi lengkap!");
    process.exit(1);
  }

  const compromisedAccount = privateKeyToAccount(compKey);
  const sponsorAccount = privateKeyToAccount(fundKey);

  console.log(`📍 Compromised Wallet: ${compromisedAccount.address}`);
  console.log(`📍 Sponsor Wallet:     ${sponsorAccount.address}`);
  console.log(`📍 Destination Wallet: ${destAddress}`);
  console.log(`🪙 Token Contract:     ${tokenAddress}\n`);

  const { client: publicClient, url: activeReadRpc } = await getWorkingPublicClient();
  console.log(`🔗 Active BSC RPC:    ${activeReadRpc}`);
  console.log(`🛡️ Private RPC:       ${privateRpcUrl}\n`);

  // 1. Cek status kode & delegasi saat ini
  const currentCode = await publicClient.getCode({ address: compromisedAccount.address });
  if (currentCode && currentCode.startsWith("0xef0100")) {
    const activeContract = "0x" + currentCode.slice(8);
    console.log(`🚨 STATUS: Terdeteksi EIP-7702 delegation aktif!`);
    console.log(`   Contract saat ini: ${activeContract}\n`);
  } else {
    console.log(`ℹ️ STATUS: Normal EOA atau belum ada delegasi (${currentCode || "0x"})\n`);
  }

  // 2. Cek saldo token yang akan diselamatkan
  const [tokenBalance, decimals, symbol, name] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [compromisedAccount.address],
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "name",
    }),
  ]);

  const formattedBalance = formatUnits(tokenBalance, decimals);
  console.log(`💎 Token Ditemukan: ${name} (${symbol})`);
  console.log(`💰 Saldo Tersedia: ${formattedBalance} ${symbol}`);

  if (tokenBalance === 0n) {
    console.log("\n⚠️ Saldo token 0. Tidak ada yang perlu di-rescue.");
    return;
  }

  // 3. Cek saldo BNB sponsor
  const sponsorBalance = await publicClient.getBalance({ address: sponsorAccount.address });
  console.log(`⛽ Sponsor Balance: ${formatEther(sponsorBalance)} BNB\n`);

  // 4. Siapkan calldata transfer token melalui Multicall3
  console.log("⚙️  Menyiapkan Atomic EIP-7702 Rescue payload...");
  const transferCalldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [destAddress, tokenBalance],
  });

  const multicallData = encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    args: [
      [
        {
          target: tokenAddress,
          allowFailure: false,
          callData: transferCalldata,
        },
      ],
    ],
  });

  // 5. Buat dan tandatangani EIP-7702 Authorization ke Multicall3
  const compNonce = await publicClient.getTransactionCount({
    address: compromisedAccount.address,
  });
  console.log(`🔢 Compromised Nonce: ${compNonce}`);

  const authorization = await compromisedAccount.signAuthorization({
    contractAddress: MULTICALL3_ADDRESS,
    chainId: 56,
    nonce: compNonce,
  });

  console.log("✍️ EIP-7702 Authorization signed (Delegasi ke Multicall3)!");

  // 6. Estimasi Gas & Fees untuk Transaksi Type-4
  console.log("📊 Mengestimasi gas fee transaksi Type-4...");
  const [estimatedGas, feeData] = await Promise.all([
    publicClient.estimateGas({
      account: sponsorAccount.address,
      authorizationList: [authorization],
      to: compromisedAccount.address,
      data: multicallData,
      value: 0n,
    }),
    publicClient.estimateFeesPerGas(),
  ]);

  const gasLimit = (estimatedGas * 130n) / 100n;
  const maxFeePerGas = feeData.maxFeePerGas
    ? (feeData.maxFeePerGas * 150n) / 100n
    : 100000000n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 50000000n;
  const totalGasCost = gasLimit * maxFeePerGas;

  console.log(`   Gas Estimate: ${estimatedGas.toString()} (Limit: ${gasLimit.toString()})`);
  console.log(`   Estimasi Biaya: ~${formatEther(totalGasCost)} BNB`);

  if (sponsorBalance < totalGasCost) {
    throw new Error(
      `Saldo Sponsor tidak cukup! Butuh ~${formatEther(totalGasCost)} BNB, saldo saat ini ${formatEther(sponsorBalance)} BNB.`
    );
  }

  // 7. Kirim Transaksi Atomic Rescue via BloXroute Protect RPC (Private Mempool)
  console.log("\n🚀 Mengirimkan Atomic Rescue Transaction via Private RPC...");
  let sponsorClient = createWalletClient({
    account: sponsorAccount,
    chain: bsc,
    transport: http(privateRpcUrl),
  });

  let txHash;
  try {
    txHash = await sponsorClient.sendTransaction({
      type: "eip7702",
      authorizationList: [authorization],
      to: compromisedAccount.address,
      data: multicallData,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (err) {
    console.warn(`⚠️ Private RPC gagal (${err.message}). Mencoba via Public BSC RPC...`);
    sponsorClient = createWalletClient({
      account: sponsorAccount,
      chain: bsc,
      transport: http(activeReadRpc),
    });
    txHash = await sponsorClient.sendTransaction({
      type: "eip7702",
      authorizationList: [authorization],
      to: compromisedAccount.address,
      data: multicallData,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  }

  console.log(`   ✅ Transaction Broadcasted!`);
  console.log(`   Hash: ${txHash}`);
  console.log("   ⏳ Menunggu konfirmasi di block BSC...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error(`Transaksi revert di block ${receipt.blockNumber}!`);
  }

  console.log(`   ✅ CONFIRMED di Block ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed})!\n`);

  // 8. Verifikasi saldo akhir di wallet tujuan
  const destFinalBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [destAddress],
  });

  console.log("🎉 ========================================================");
  console.log("   RESCUE 100% BERHASIL!");
  console.log(`   ${formattedBalance} ${symbol} berhasil diamankan ke:`);
  console.log(`   ${destAddress}`);
  console.log(`   Saldo Destination Saat Ini: ${formatUnits(destFinalBalance, decimals)} ${symbol}`);
  console.log(`   BscScan Explorer: https://bscscan.com/tx/${txHash}`);
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  process.exit(1);
});
