/**
 * =============================================
 * BSC TOKEN RESCUE - CHECK BALANCE
 * =============================================
 * Script ini untuk cek balance token AEM & BNB
 * di wallet compromised sebelum melakukan rescue.
 * =============================================
 */

const { ethers } = require("ethers");
require("dotenv").config();

// ERC20 ABI (minimal, cuma yang dibutuhin)
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function checkBalance() {
  console.log("\n🔍 ============================================");
  console.log("   BSC TOKEN RESCUE - BALANCE CHECKER");
  console.log("   ============================================\n");

  // Setup provider
  const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC || "https://bsc-rpc.publicnode.com");

  // Wallet addresses
  const compromisedKey = process.env.COMPROMISED_PRIVATE_KEY;
  const fundingKey = process.env.FUNDING_PRIVATE_KEY;

  if (!compromisedKey || compromisedKey === "your_compromised_wallet_private_key_here") {
    console.error("❌ Set COMPROMISED_PRIVATE_KEY di file .env dulu!");
    process.exit(1);
  }

  const compromisedWallet = new ethers.Wallet(compromisedKey);
  const compromisedAddress = compromisedWallet.address;

  console.log(`📍 Wallet Compromised: ${compromisedAddress}`);

  // Check BNB balance
  const bnbBalance = await provider.getBalance(compromisedAddress);
  console.log(`💰 BNB Balance: ${ethers.formatEther(bnbBalance)} BNB`);

  // Check token balance
  const tokenAddress = process.env.TOKEN_CONTRACT || "0xa0a906bc6a38c8249e0d89f57f72ad12606b952e";
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  try {
    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    const balance = await tokenContract.balanceOf(compromisedAddress);

    console.log(`\n🪙 Token: ${name} (${symbol})`);
    console.log(`📋 Contract: ${tokenAddress}`);
    console.log(`🔢 Decimals: ${decimals}`);
    console.log(`💎 Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

    if (balance === 0n) {
      console.log("\n⚠️  Token balance = 0. Gak ada yang bisa di-rescue.");
      process.exit(0);
    }

    // Estimate gas for transfer (fallback to 65000 if estimateGas fails due to 0 BNB balance)
    let gasEstimate = 65000n;
    try {
      gasEstimate = await tokenContract.transfer.estimateGas(
        "0x000000000000000000000000000000000000dEaD",
        balance,
        { from: compromisedAddress }
      );
    } catch (e) {
      // Normal on some RPCs when sender has 0 BNB
      gasEstimate = 65000n;
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
    const gasCost = gasEstimate * gasPrice;

    console.log(`\n⛽ Gas estimate untuk transfer:`);
    console.log(`   Gas units: ${gasEstimate.toString()}`);
    console.log(`   Gas price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);
    console.log(`   Total cost: ${ethers.formatEther(gasCost)} BNB`);

    // Check funding wallet
    if (fundingKey && fundingKey !== "your_safe_wallet_private_key_here") {
      const fundingWallet = new ethers.Wallet(fundingKey);
      const fundingBalance = await provider.getBalance(fundingWallet.address);
      console.log(`\n🏦 Funding Wallet: ${fundingWallet.address}`);
      console.log(`💰 Funding BNB Balance: ${ethers.formatEther(fundingBalance)} BNB`);

      const totalNeeded = gasCost * 2n; // 2x safety margin
      if (fundingBalance < totalNeeded) {
        console.log(`\n❌ Funding wallet butuh minimal ${ethers.formatEther(totalNeeded)} BNB`);
        console.log(`   (2x gas cost buat safety margin)`);
      } else {
        console.log(`\n✅ Funding wallet cukup BNB! Siap rescue.`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Error checking token: ${error.message}`);
  }

  console.log("\n============================================\n");
}

checkBalance().catch(console.error);
