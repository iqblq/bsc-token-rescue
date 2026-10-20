/**
 * =====================================================================
 * MULTI-RPC RESCUE TRANSFER
 * =====================================================================
 */

const { ethers } = require("ethers");
require("dotenv").config();

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const RPCS = [
  "https://1rpc.io/bnb",
  "https://bsc.rpc.blxrbdn.com",
  "https://bsc-rpc.publicnode.com",
];

async function getWorkingProvider() {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const num = await p.getBlockNumber();
      console.log(`📡 Connected to ${url} (Block: ${num})`);
      return p;
    } catch (e) {
      console.log(`⚠️ Failed to connect to ${url}: ${e.message}`);
    }
  }
  throw new Error("No working RPC found");
}

async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║     🚀 TRANSFERRING TOKEN TO SAFE WALLET ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  const provider = await getWorkingProvider();

  const compKey = process.env.COMPROMISED_PRIVATE_KEY;
  const fundKey = process.env.FUNDING_PRIVATE_KEY;
  const destAddress = process.env.DESTINATION_ADDRESS;
  const tokenAddress = process.env.TOKEN_CONTRACT || "0x8aab31fbc69c92fa53f600910cf0f215531f8239";

  const compromisedWallet = new ethers.Wallet(compKey, provider);
  const fundingWallet = new ethers.Wallet(fundKey, provider);

  console.log(`📍 Compromised Wallet: ${compromisedWallet.address}`);
  console.log(`📍 Destination Wallet: ${destAddress}\n`);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  const [symbol, decimals, tokenBalance, bnbBalance, nonce] = await Promise.all([
    token.symbol(),
    token.decimals(),
    token.balanceOf(compromisedWallet.address),
    provider.getBalance(compromisedWallet.address),
    provider.getTransactionCount(compromisedWallet.address, "latest"),
  ]);

  console.log(`🪙 Token: ${symbol}`);
  console.log(`💎 Token Balance: ${ethers.formatUnits(tokenBalance, decimals)} ${symbol}`);
  console.log(`💰 Compromised BNB Balance: ${ethers.formatEther(bnbBalance)} BNB`);
  console.log(`🔢 Current Nonce: ${nonce}`);

  if (tokenBalance === 0n) {
    console.log("⚠️ Token balance 0.");
    return;
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");

  // Transfer data
  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("transfer", [destAddress, tokenBalance]);

  // Sign transaction locally
  console.log("\n✍️ Signing transfer transaction locally...");
  const rawTx = {
    to: tokenAddress,
    data: data,
    gasLimit: 75000n,
    gasPrice: gasPrice * 2n, // 2x gas price to guarantee quick inclusion
    nonce: nonce,
    chainId: 56,
    value: 0n,
    type: 0,
  };

  const signedTx = await compromisedWallet.signTransaction(rawTx);

  console.log("🚀 Broadcasting to multiple RPCs simultaneously...");
  const broadcastPromises = RPCS.map(async (rpcUrl) => {
    try {
      const p = new ethers.JsonRpcProvider(rpcUrl);
      const res = await p.broadcastTransaction(signedTx);
      console.log(`   ✅ Broadcasted via ${rpcUrl}: ${res.hash}`);
      return res;
    } catch (err) {
      console.log(`   ⚠️ Broadcast on ${rpcUrl}: ${err.message}`);
      return null;
    }
  });

  const results = (await Promise.all(broadcastPromises)).filter(Boolean);

  if (results.length === 0) {
    console.error("❌ Failed to broadcast transaction on all RPCs.");
    return;
  }

  const txResponse = results[0];
  console.log(`\n⏳ Menunggu konfirmasi: https://bscscan.com/tx/${txResponse.hash} ...`);

  let confirmed = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const receipt = await provider.getTransactionReceipt(txResponse.hash);
      if (receipt && receipt.status === 1) {
        console.log(`\n✅ Confirmed di block ${receipt.blockNumber}! Status: SUCCESS`);
        confirmed = true;
        break;
      }
    } catch (e) {
      // retry
    }
  }

  const destBalance = await token.balanceOf(destAddress);
  console.log("\n🎉 ========================================================");
  console.log("   RESCUE 100% SUKSES! TOKEN SUDAH BERHASIL DIAMANKAN!");
  console.log("   ========================================================");
  console.log(`   Balance di Safe Wallet: ${ethers.formatUnits(destBalance, decimals)} ${symbol}`);
  console.log(`   Tx Explorer: https://bscscan.com/tx/${txResponse.hash}`);
  console.log("   ========================================================\n");
}

main().catch((e) => {
  console.error("\n💥 Error:", e);
});
