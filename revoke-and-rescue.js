/**
 * =====================================================================
 * EIP-7702 REVOCATION & RESCUE TOOL FOR BSC
 * =====================================================================
 */

const { createWalletClient, createPublicClient, http, zeroAddress, encodeFunctionData, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bsc } = require("viem/chains");
require("dotenv").config();

function formatPrivateKey(pk) {
  if (!pk) return pk;
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     🛡️ EIP-7702 DELEGATION REVOCATION & RESCUE 🛡️        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const compKey = formatPrivateKey(process.env.COMPROMISED_PRIVATE_KEY);
  const fundKey = formatPrivateKey(process.env.FUNDING_PRIVATE_KEY);
  const destAddress = process.env.DESTINATION_ADDRESS;
  const tokenAddress = process.env.TOKEN_CONTRACT || "0xa0a906bc6a38c8249e0d89f57f72ad12606b952e";
  const rpcUrl = process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";

  if (!compKey || !fundKey || !destAddress) {
    console.error("❌ Pastikan .env sudah diisi!");
    process.exit(1);
  }

  const compromisedAccount = privateKeyToAccount(compKey);
  const sponsorAccount = privateKeyToAccount(fundKey);

  console.log(`📍 Compromised Wallet: ${compromisedAccount.address}`);
  console.log(`📍 Sponsor/Funding:    ${sponsorAccount.address}`);
  console.log(`📍 Destination:        ${destAddress}\n`);

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });

  const sponsorClient = createWalletClient({
    account: sponsorAccount,
    chain: bsc,
    transport: http(rpcUrl),
  });

  const compromisedClient = createWalletClient({
    account: compromisedAccount,
    chain: bsc,
    transport: http(rpcUrl),
  });

  // 1. Check current code on compromised wallet
  const currentCode = await publicClient.getCode({ address: compromisedAccount.address });
  console.log(`🔍 Current Wallet Code: ${currentCode || "0x (Normal EOA)"}`);

  if (currentCode && currentCode.startsWith("0xef0100")) {
    const maliciousContract = "0x" + currentCode.slice(8);
    console.log(`🚨 TERDETEKSI MALICIOUS EIP-7702 DELEGATION!`);
    console.log(`   Contract Hacker: ${maliciousContract}\n`);

    console.log("⏳ STEP 1: REVOKING EIP-7702 DELEGATION...");
    console.log("   (Gas dibayar oleh sponsor wallet, compromised wallet gak butuh BNB)");

    let authorization;
    if (typeof compromisedClient.signAuthorization === "function") {
      authorization = await compromisedClient.signAuthorization({
        contractAddress: zeroAddress,
      });
    } else if (typeof compromisedAccount.signAuthorization === "function") {
      authorization = await compromisedAccount.signAuthorization({
        contractAddress: zeroAddress,
        chainId: 56,
      });
    } else if (typeof compromisedAccount.experimental_signAuthorization === "function") {
      authorization = await compromisedAccount.experimental_signAuthorization({
        contractAddress: zeroAddress,
        chainId: 56,
      });
    } else {
      throw new Error("signAuthorization method not available in this viem version");
    }

    console.log("   ✍️ Authorization signed successfully!");

    // Sponsor sends Type 4 transaction to clear code on compromised wallet
    const revokeTxHash = await sponsorClient.sendTransaction({
      authorizationList: [authorization],
      to: compromisedAccount.address,
      value: 0n,
    });

    console.log(`   🚀 Revoke TX sent: ${revokeTxHash}`);
    console.log("   ⏳ Menunggu konfirmasi di block BSC...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash: revokeTxHash });
    console.log(`   ✅ Revoke CONFIRMED di block ${receipt.blockNumber} (Status: ${receipt.status})!\n`);

    // Verify code is now cleared
    const updatedCode = await publicClient.getCode({ address: compromisedAccount.address });
    console.log(`🔍 Updated Wallet Code: ${updatedCode || "0x (CLEAN! Normal EOA kembali!)"}\n`);
  } else {
    console.log("ℹ️ Wallet tidak memiliki delegasi EIP-7702 atau sudah bersih.\n");
  }

  // STEP 2: RESCUE TOKEN
  console.log("⏳ STEP 2: RESCUE TOKEN AEM...");

  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [compromisedAccount.address],
  });

  const decimals = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });

  const symbol = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "symbol",
  });

  const formattedBalance = Number(tokenBalance) / 10 ** decimals;
  console.log(`💎 Sisa Balance Token: ${formattedBalance} ${symbol}`);

  if (tokenBalance === 0n) {
    console.log("⚠️ Token balance 0.");
    return;
  }

  console.log("\n🚀 Mengirim BNB secukupnya untuk gas fee token transfer...");
  const gasBnbNeeded = 300000000000000n; // 0.0003 BNB (~$0.20)

  const fundHash = await sponsorClient.sendTransaction({
    to: compromisedAccount.address,
    value: gasBnbNeeded,
  });
  console.log(`   ✅ Sent gas BNB: ${fundHash}`);
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  console.log("\n🚀 Mentransfer Token AEM ke wallet tujuan...");
  const transferHash = await compromisedClient.sendTransaction({
    to: tokenAddress,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [destAddress, tokenBalance],
    }),
  });

  console.log(`   ✅ Transfer TX: ${transferHash}`);
  console.log("   ⏳ Menunggu konfirmasi...");

  const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log(`   ✅ Confirmed di block ${transferReceipt.blockNumber} (Status: ${transferReceipt.status})!`);

  console.log("\n🎉 ========================================================");
  console.log(`   RESCUE BERHASIL 100%!`);
  console.log(`   ${formattedBalance} ${symbol} berhasil dikirim ke:`);
  console.log(`   ${destAddress}`);
  console.log("   ========================================================\n");
}

main().catch((e) => {
  console.error("\n💥 ERROR:", e.message || e);
  process.exit(1);
});
