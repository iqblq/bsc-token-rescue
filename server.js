/**
 * =====================================================================
 * BSC TOKEN RESCUE - WEB GUI SERVER
 * =====================================================================
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { createWalletClient, createPublicClient, http, zeroAddress, encodeFunctionData, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bsc } = require("viem/chains");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const VIEM_ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "function aggregate3(Call3[] calls) payable returns ((bool success, bytes returnData)[])",
]);

const DEFAULT_RPCS = [
  { name: "BNB Chain RPC", url: "https://bsc-dataseed.bnbchain.org", private: false },
  { name: "BNB Chain Public RPC", url: "https://bsc-dataseed-public.bnbchain.org", private: false },
  { name: "PublicNode BSC", url: "https://bsc-rpc.publicnode.com", private: false },
  { name: "bloXroute Protect RPC", url: "https://bsc.rpc.blxrbdn.com", private: true },
];

function getProvider(url) {
  return new ethers.JsonRpcProvider(url || "https://bsc-rpc.publicnode.com", 56, { staticNetwork: true });
}

async function getWorkingReadProvider(preferredUrl, stream = null) {
  const rpcUrls = [...new Set([preferredUrl, ...DEFAULT_RPCS.map((rpc) => rpc.url)].filter(Boolean))];
  const failures = [];

  for (const url of rpcUrls) {
    try {
      const provider = getProvider(url);
      let timeoutId;
      try {
        await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("RPC check timed out")), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }

      if (url !== preferredUrl) {
        stream?.log(`⚠️ Configured read RPC unavailable; switched to ${url}`);
      }
      return { provider, url };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(`No reachable BSC read RPC. ${failures.join(" | ")}`);
}

function formatPk(pk) {
  if (!pk) return "";
  let clean = pk.trim();
  return clean.startsWith("0x") ? clean : `0x${clean}`;
}

function maskKey(key) {
  if (!key || key.length < 12) return "";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// Read current config
app.get("/api/config", (req, res) => {
  const envComp = process.env.COMPROMISED_PRIVATE_KEY || "";
  const envFund = process.env.FUNDING_PRIVATE_KEY || "";
  const envDest = process.env.DESTINATION_ADDRESS || "";
  const envToken = process.env.TOKEN_CONTRACT || "0x8aab31fbc69c92fa53f600910cf0f215531f8239";
  const envRpc = process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";
  const envBloxRpc = process.env.BLOXROUTE_RPC || "https://bsc.rpc.blxrbdn.com";

  let compAddress = "";
  let fundAddress = "";

  try {
    if (envComp && envComp.length >= 64) {
      compAddress = new ethers.Wallet(formatPk(envComp)).address;
    }
  } catch (e) {}

  try {
    if (envFund && envFund.length >= 64) {
      fundAddress = new ethers.Wallet(formatPk(envFund)).address;
    }
  } catch (e) {}

  res.json({
    hasCompromisedKey: !!envComp && envComp !== "your_compromised_wallet_private_key_here",
    hasFundingKey: !!envFund && envFund !== "your_safe_wallet_private_key_here",
    compromisedKeyMasked: maskKey(envComp),
    fundingKeyMasked: maskKey(envFund),
    compromisedAddress: compAddress,
    fundingAddress: fundAddress,
    destinationAddress: envDest,
    tokenContract: envToken,
    bscRpc: envRpc,
    bloxrouteRpc: envBloxRpc,
    defaultRpcs: DEFAULT_RPCS,
  });
});

// Update .env configuration
app.post("/api/config", (req, res) => {
  try {
    const { compromisedKey, fundingKey, destinationAddress, tokenContract, bscRpc, bloxrouteRpc } = req.body;

    const envPath = path.join(__dirname, ".env");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    const setEnvVar = (content, key, value) => {
      if (!value && value !== "") return content;
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        return content.replace(regex, `${key}=${value}`);
      } else {
        return `${content}\n${key}=${value}`;
      }
    };

    if (compromisedKey) {
      process.env.COMPROMISED_PRIVATE_KEY = compromisedKey;
      envContent = setEnvVar(envContent, "COMPROMISED_PRIVATE_KEY", compromisedKey);
    }
    if (fundingKey) {
      process.env.FUNDING_PRIVATE_KEY = fundingKey;
      envContent = setEnvVar(envContent, "FUNDING_PRIVATE_KEY", fundingKey);
    }
    if (destinationAddress !== undefined) {
      process.env.DESTINATION_ADDRESS = destinationAddress;
      envContent = setEnvVar(envContent, "DESTINATION_ADDRESS", destinationAddress);
    }
    if (tokenContract !== undefined) {
      process.env.TOKEN_CONTRACT = tokenContract;
      envContent = setEnvVar(envContent, "TOKEN_CONTRACT", tokenContract);
    }
    if (bscRpc !== undefined) {
      process.env.BSC_RPC = bscRpc;
      envContent = setEnvVar(envContent, "BSC_RPC", bscRpc);
    }
    if (bloxrouteRpc !== undefined) {
      process.env.BLOXROUTE_RPC = bloxrouteRpc;
      envContent = setEnvVar(envContent, "BLOXROUTE_RPC", bloxrouteRpc);
    }

    fs.writeFileSync(envPath, envContent.trim() + "\n");
    res.json({ success: true, message: "Configuration saved to .env" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// RPC Latency Ping
app.post("/api/rpc-ping", async (req, res) => {
  const rpcs = req.body.rpcs || DEFAULT_RPCS.map((r) => r.url);
  const results = await Promise.all(
    rpcs.map(async (url) => {
      const start = Date.now();
      try {
        const p = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
        const block = await Promise.race([
          p.getBlockNumber(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000)),
        ]);
        const latency = Date.now() - start;
        return { url, online: true, block, latency };
      } catch (e) {
        return { url, online: false, error: e.message, latency: -1 };
      }
    })
  );
  res.json({ results });
});

// Full Wallet & Token Inspector
app.post("/api/inspect", async (req, res) => {
  try {
    const compKeyRaw = req.body.compromisedKey || process.env.COMPROMISED_PRIVATE_KEY;
    const fundKeyRaw = req.body.fundingKey || process.env.FUNDING_PRIVATE_KEY;
    const destAddress = req.body.destinationAddress || process.env.DESTINATION_ADDRESS;
    const tokenAddress = req.body.tokenContract || process.env.TOKEN_CONTRACT || "0x8aab31fbc69c92fa53f600910cf0f215531f8239";
    const rpcUrl = req.body.rpcUrl || process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";

    const { provider } = await getWorkingReadProvider(rpcUrl);

    let compWallet = null;
    let compAddress = "";
    if (compKeyRaw && compKeyRaw.length >= 64) {
      try {
        compWallet = new ethers.Wallet(formatPk(compKeyRaw), provider);
        compAddress = compWallet.address;
      } catch (e) {}
    }

    let fundWallet = null;
    let fundAddress = "";
    if (fundKeyRaw && fundKeyRaw.length >= 64) {
      try {
        fundWallet = new ethers.Wallet(formatPk(fundKeyRaw), provider);
        fundAddress = fundWallet.address;
      } catch (e) {}
    }

    // Inspect Compromised Wallet
    let compBnbBalance = "0";
    let compNonce = 0;
    let compCode = "0x";
    let isEip7702Delegated = false;
    let delegatedContract = null;

    if (compAddress) {
      const [bnbBal, nonce, code] = await Promise.all([
        provider.getBalance(compAddress),
        provider.getTransactionCount(compAddress, "latest"),
        provider.getCode(compAddress),
      ]);
      compBnbBalance = ethers.formatEther(bnbBal);
      compNonce = nonce;
      compCode = code;
      if (code && code.startsWith("0xef0100")) {
        isEip7702Delegated = true;
        delegatedContract = "0x" + code.slice(8);
      }
    }

    // Inspect Funding Wallet
    let fundBnbBalance = "0";
    let fundNonce = 0;
    if (fundAddress) {
      const [fBal, fNonce] = await Promise.all([
        provider.getBalance(fundAddress),
        provider.getTransactionCount(fundAddress, "latest"),
      ]);
      fundBnbBalance = ethers.formatEther(fBal);
      fundNonce = fNonce;
    }

    // Inspect Token
    let tokenData = null;
    if (tokenAddress && ethers.isAddress(tokenAddress)) {
      try {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [name, symbol, decimals] = await Promise.all([
          token.name().catch(() => "Unknown"),
          token.symbol().catch(() => "???"),
          token.decimals().catch(() => 18),
        ]);

        let compTokenBalance = "0";
        let compTokenRaw = "0";
        let destTokenBalance = "0";

        if (compAddress) {
          const b = await token.balanceOf(compAddress).catch(() => 0n);
          compTokenRaw = b.toString();
          compTokenBalance = ethers.formatUnits(b, decimals);
        }

        if (destAddress && ethers.isAddress(destAddress)) {
          const b = await token.balanceOf(destAddress).catch(() => 0n);
          destTokenBalance = ethers.formatUnits(b, decimals);
        }

        // Gas fee estimate
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
        const estimatedGasUnits = 75000n;
        const estimatedGasCostBnb = ethers.formatEther(estimatedGasUnits * gasPrice);
        const recommendedFundBnb = ethers.formatEther(estimatedGasUnits * gasPrice * 2n);

        tokenData = {
          address: tokenAddress,
          name,
          symbol,
          decimals: Number(decimals),
          compromisedBalance: compTokenBalance,
          compromisedBalanceRaw: compTokenRaw,
          destinationBalance: destTokenBalance,
          gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
          estimatedGasCostBnb,
          recommendedFundBnb,
        };
      } catch (err) {
        tokenData = { error: err.message };
      }
    }

    res.json({
      success: true,
      compromised: {
        address: compAddress,
        bnbBalance: compBnbBalance,
        nonce: compNonce,
        code: compCode,
        isEip7702Delegated,
        delegatedContract,
      },
      funding: {
        address: fundAddress,
        bnbBalance: fundBnbBalance,
        nonce: fundNonce,
      },
      destination: {
        address: destAddress,
        isValid: destAddress ? ethers.isAddress(destAddress) : false,
      },
      token: tokenData,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SSE Helper to stream logs
function createLogStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`);
  };

  return {
    log: (msg) => send("log", msg),
    success: (msg, details = {}) => send("success", { message: msg, ...details }),
    error: (msg, details = {}) => send("error", { message: msg, ...details }),
    step: (stepIndex, totalSteps, title) => send("step", { stepIndex, totalSteps, title }),
    tx: (hash, label, extra = {}) => send("tx", { hash, label, explorer: `https://bscscan.com/tx/${hash}`, ...extra }),
    done: (summary) => {
      send("done", summary);
      res.end();
    },
  };
}

// SSE Rescue Stream Endpoint
app.get("/api/rescue/stream", async (req, res) => {
  const stream = createLogStream(res);

  const strategy = req.query.strategy || "rapid-fire";
  const compKey = formatPk(req.query.compKey || process.env.COMPROMISED_PRIVATE_KEY);
  const fundKey = formatPk(req.query.fundKey || process.env.FUNDING_PRIVATE_KEY);
  const destAddress = req.query.destAddress || process.env.DESTINATION_ADDRESS;
  const tokenAddress = req.query.tokenAddress || process.env.TOKEN_CONTRACT || "0x8aab31fbc69c92fa53f600910cf0f215531f8239";
  const gasPriceMultiplier = BigInt(req.query.gasMultiplier || "2");
  const bscRpc = req.query.bscRpc || process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";
  const bloxRpc = req.query.bloxRpc || process.env.BLOXROUTE_RPC || "https://bsc.rpc.blxrbdn.com";

  if (!compKey || compKey === "0xyour_compromised_wallet_private_key_here") {
    stream.error("Missing Compromised Private Key!");
    return stream.done({ success: false, reason: "No compromised private key" });
  }

  if (!destAddress || !ethers.isAddress(destAddress)) {
    stream.error("Invalid Destination Address!");
    return stream.done({ success: false, reason: "Invalid destination" });
  }

  try {
    if (strategy === "rapid-fire") {
      await executeRapidFire({ stream, compKey, fundKey, destAddress, tokenAddress, bscRpc, bloxRpc, gasPriceMultiplier });
    } else if (strategy === "eip7702") {
      await executeEip7702({ stream, compKey, fundKey, destAddress, tokenAddress, bscRpc, bloxRpc });
    } else if (strategy === "direct-multirpc") {
      await executeDirectMultiRpc({ stream, compKey, destAddress, tokenAddress, gasPriceMultiplier });
    } else if (strategy === "sweep-bnb") {
      await executeSweepBnb({ stream, compKey, destAddress, bscRpc, gasPriceMultiplier });
    } else {
      stream.error(`Unknown strategy: ${strategy}`);
      stream.done({ success: false });
    }
  } catch (fatal) {
    stream.error(`Fatal Execution Error: ${fatal.message || fatal}`);
    stream.done({ success: false, error: fatal.message });
  }
});

// Strategy 1: bloXroute Rapid-Fire Private Mempool
async function executeRapidFire({ stream, compKey, fundKey, destAddress, tokenAddress, bscRpc, bloxRpc, gasPriceMultiplier }) {
  stream.step(1, 5, "Initializing Providers & Accounts");
  stream.log(`🛡️ Strategy: bloXroute Protect RPC (Private Mempool)`);
  stream.log(`🔒 Private RPC: ${bloxRpc}`);

  if (!fundKey || fundKey === "0xyour_safe_wallet_private_key_here") {
    stream.error("Funding Private Key is required for Rapid-Fire rescue!");
    return stream.done({ success: false, reason: "Funding key missing" });
  }

  const { provider: readProvider, url: activeReadRpc } = await getWorkingReadProvider(bscRpc, stream);
  stream.log(`🔗 Public RPC: ${activeReadRpc}`);
  const protectProvider = getProvider(bloxRpc);

  const fundingWallet = new ethers.Wallet(fundKey);
  const compromisedWallet = new ethers.Wallet(compKey);

  stream.log(`📍 Compromised Address: ${compromisedWallet.address}`);
  stream.log(`📍 Funding/Sponsor Address: ${fundingWallet.address}`);
  stream.log(`📍 Safe Destination: ${destAddress}`);

  stream.step(2, 5, "Inspecting Balances & Gas Estimation");
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);

  const [tokenBalance, symbol, decimals, compBnb, fundBnb, compNonce, fundNonce, feeData] = await Promise.all([
    tokenContract.balanceOf(compromisedWallet.address),
    tokenContract.symbol().catch(() => "TOKEN"),
    tokenContract.decimals().catch(() => 18),
    readProvider.getBalance(compromisedWallet.address),
    readProvider.getBalance(fundingWallet.address),
    readProvider.getTransactionCount(compromisedWallet.address, "latest"),
    readProvider.getTransactionCount(fundingWallet.address, "latest"),
    readProvider.getFeeData(),
  ]);

  const formattedTokenBal = ethers.formatUnits(tokenBalance, decimals);
  stream.log(`💎 Target Token Balance: ${formattedTokenBal} ${symbol}`);
  stream.log(`💰 Compromised BNB: ${ethers.formatEther(compBnb)} BNB (Nonce: ${compNonce})`);
  stream.log(`🏦 Funding BNB: ${ethers.formatEther(fundBnb)} BNB (Nonce: ${fundNonce})`);

  if (tokenBalance === 0n) {
    stream.error("Token balance is 0. Nothing to rescue.");
    return stream.done({ success: false, reason: "Balance is zero" });
  }

  const compromisedCode = await readProvider.getCode(compromisedWallet.address);
  if (compromisedCode && compromisedCode.startsWith("0xef0100")) {
    stream.error("EIP-7702 delegation detected. Rapid-Fire will not fund this wallet; select the EIP-7702 revoke strategy.");
    return stream.done({ success: false, reason: "EIP-7702 delegation detected" });
  }

  const baseGasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
  const urgentGasPrice = baseGasPrice * gasPriceMultiplier;
  const tokenGasLimit = 75000n;
  const tokenGasCost = tokenGasLimit * urgentGasPrice;
  const bnbToSend = tokenGasCost * 2n; // 2x safety margin

  stream.log(`⛽ Urgent Gas Price: ${ethers.formatUnits(urgentGasPrice, "gwei")} Gwei`);
  stream.log(`⛽ Calculated Gas funding needed: ${ethers.formatEther(bnbToSend)} BNB`);

  if (fundBnb < bnbToSend) {
    stream.error(`Funding wallet has insufficient BNB! Needs ${ethers.formatEther(bnbToSend)} BNB, has ${ethers.formatEther(fundBnb)} BNB`);
    return stream.done({ success: false, reason: "Insufficient funding BNB" });
  }

  stream.step(3, 5, "Signing Transactions Locally");
  // 1. Funding Tx
  const fundTx = {
    to: compromisedWallet.address,
    value: bnbToSend,
    gasLimit: 21000n,
    gasPrice: urgentGasPrice,
    nonce: fundNonce,
    chainId: 56,
    type: 0,
  };
  const signedFundTx = await fundingWallet.signTransaction(fundTx);
  stream.log(`✍️ Signed Gas Funding Tx`);

  // 2. Token Transfer Tx
  const tokenIface = new ethers.Interface(ERC20_ABI);
  const transferData = tokenIface.encodeFunctionData("transfer", [destAddress, tokenBalance]);

  const tokenTx = {
    to: tokenAddress,
    data: transferData,
    gasLimit: tokenGasLimit,
    gasPrice: urgentGasPrice,
    nonce: compNonce,
    chainId: 56,
    value: 0n,
    type: 0,
  };
  const signedTokenTx = await compromisedWallet.signTransaction(tokenTx);
  stream.log(`✍️ Signed Token Transfer Tx`);

  stream.step(4, 5, "Broadcasting Rapid-Fire to Private Mempool");
  const fundRes = await protectProvider.broadcastTransaction(signedFundTx);
  stream.tx(fundRes.hash, "Gas Funding Tx (bloXroute Protect)");

  let fundReceipt;
  try {
    fundReceipt = await readProvider.waitForTransaction(fundRes.hash, 1, 60000);
  } catch (error) {
    stream.error(`Gas funding was not confirmed; token transfer was not sent. ${error.message}`);
    return stream.done({ success: false, txHash: fundRes.hash, reason: "Gas funding not confirmed" });
  }
  if (!fundReceipt || fundReceipt.status !== 1) {
    stream.error("Gas funding failed; token transfer was not sent.");
    return stream.done({ success: false, txHash: fundRes.hash, reason: "Gas funding failed" });
  }

  const fundedCompBnb = await readProvider.getBalance(compromisedWallet.address);
  if (fundedCompBnb < tokenGasCost) {
    stream.error("Compromised wallet still has too little BNB for the token transfer; transfer was not sent.");
    return stream.done({ success: false, txHash: fundRes.hash, reason: "Insufficient funded balance" });
  }

  const tokenRes = await protectProvider.broadcastTransaction(signedTokenTx);
  stream.tx(tokenRes.hash, "Token Transfer Tx (bloXroute Protect)");

  stream.step(5, 5, "Tracking Block Confirmation");
  stream.log("⏳ Awaiting transaction confirmation on Binance Smart Chain...");

  let receipt = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      receipt = await readProvider.getTransactionReceipt(tokenRes.hash);
      if (receipt && receipt.status === 1) break;
    } catch (e) {}
  }

  if (receipt && receipt.status === 1) {
    const destBal = await tokenContract.balanceOf(destAddress);
    const formattedDest = ethers.formatUnits(destBal, decimals);
    stream.success(`RESCUE 100% SUCCESFUL!`, {
      rescuedAmount: `${formattedTokenBal} ${symbol}`,
      destination: destAddress,
      destinationTotalBalance: `${formattedDest} ${symbol}`,
      blockNumber: receipt.blockNumber,
      txHash: tokenRes.hash,
    });
    stream.done({ success: true, txHash: tokenRes.hash, blockNumber: receipt.blockNumber });
  } else {
    stream.log("⚠️ Transfer tx still pending or verification timed out. Please check BSCScan link above.");
    stream.done({ success: true, txHash: tokenRes.hash, checkExplorer: true });
  }
}

// Strategy 2: EIP-7702 Revoke & Rescue
async function executeEip7702({ stream, compKey, fundKey, destAddress, tokenAddress, bscRpc, bloxRpc }) {
  stream.step(1, 5, "Initializing Viem Clients & Inspecting Code");
  stream.log("🛡️ Strategy: EIP-7702 Revoke Delegation & Sponsor Rescue");

  if (!fundKey || fundKey === "0xyour_safe_wallet_private_key_here") {
    stream.error("Funding/Sponsor Private Key is required for EIP-7702 Revocation!");
    return stream.done({ success: false, reason: "Sponsor key missing" });
  }

  const compAccount = privateKeyToAccount(compKey);
  const sponsorAccount = privateKeyToAccount(fundKey);

  stream.log(`📍 Compromised Account: ${compAccount.address}`);
  stream.log(`📍 Sponsor Account:     ${sponsorAccount.address}`);
  stream.log(`📍 Safe Destination:    ${destAddress}`);

  const { url: activeReadRpc } = await getWorkingReadProvider(bscRpc, stream);
  stream.log(`🔗 BSC read RPC: ${activeReadRpc}`);
  const privateTxRpc = bloxRpc || process.env.BLOXROUTE_RPC || "https://bsc.rpc.blxrbdn.com";
  stream.log(`🛡️ Private transaction RPC: ${privateTxRpc}`);
  const publicClient = createPublicClient({ chain: bsc, transport: http(activeReadRpc) });

  const currentCode = await publicClient.getCode({ address: compAccount.address });
  stream.log(`🔍 Current Wallet Code: ${currentCode || "0x (Normal EOA)"}`);

  if (currentCode && currentCode.startsWith("0xef0100")) {
    const maliciousContract = "0x" + currentCode.slice(8);
    stream.log(`🚨 DETECTED MALICIOUS EIP-7702 DELEGATION! Contract: ${maliciousContract}`);
  }

  stream.step(2, 4, "Checking Token Balance & Preparing Payload");
  const [tokenBal, decimals, symbol] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: VIEM_ERC20_ABI, functionName: "balanceOf", args: [compAccount.address] }),
    publicClient.readContract({ address: tokenAddress, abi: VIEM_ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: tokenAddress, abi: VIEM_ERC20_ABI, functionName: "symbol" }),
  ]);

  const formattedBal = ethers.formatUnits(tokenBal, decimals);
  stream.log(`💎 Compromised Token Balance: ${formattedBal} ${symbol}`);

  if (tokenBal === 0n) {
    stream.error("Token balance is 0; no token transfer needed.");
    return stream.done({ success: false, reason: "Token balance is zero" });
  }

  const transferData = encodeFunctionData({
    abi: VIEM_ERC20_ABI,
    functionName: "transfer",
    args: [destAddress, tokenBal],
  });

  const multicallData = encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    args: [
      [
        {
          target: tokenAddress,
          allowFailure: false,
          callData: transferData,
        },
      ],
    ],
  });

  stream.step(3, 4, "Signing EIP-7702 Multicall3 Delegation");
  const compNonce = await publicClient.getTransactionCount({ address: compAccount.address });
  stream.log(`🔢 Compromised Nonce: ${compNonce}`);

  const authorization = await compAccount.signAuthorization({
    contractAddress: MULTICALL3_ADDRESS,
    chainId: 56,
    nonce: compNonce,
  });
  stream.log("✍️ Authorization signed: Delegating wallet to Multicall3");

  stream.step(4, 4, "Executing Atomic Rescue (Single Transaction)");
  const [estimatedGas, feeData] = await Promise.all([
    publicClient.estimateGas({
      account: sponsorAccount.address,
      authorizationList: [authorization],
      to: compAccount.address,
      data: multicallData,
      value: 0n,
    }),
    publicClient.estimateFeesPerGas(),
  ]);

  const gasLimit = (estimatedGas * 130n) / 100n;
  const maxFeePerGas = feeData.maxFeePerGas ? (feeData.maxFeePerGas * 150n) / 100n : 100000000n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 50000000n;
  const totalCost = gasLimit * maxFeePerGas;

  const sponsorBalance = await publicClient.getBalance({ address: sponsorAccount.address });
  stream.log(`⛽ Sponsor Balance: ${ethers.formatEther(sponsorBalance)} BNB (Needed: ~${ethers.formatEther(totalCost)} BNB)`);

  if (sponsorBalance < totalCost) {
    stream.error(`Sponsor wallet needs about ${ethers.formatEther(totalCost)} BNB for gas.`);
    return stream.done({ success: false, reason: "Insufficient sponsor BNB" });
  }

  let sponsorClient = createWalletClient({
    account: sponsorAccount,
    chain: bsc,
    transport: http(privateTxRpc),
  });

  let rescueTxHash;
  try {
    rescueTxHash = await sponsorClient.sendTransaction({
      type: "eip7702",
      authorizationList: [authorization],
      to: compAccount.address,
      data: multicallData,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (err) {
    stream.log(`⚠️ Private RPC failed (${err.message}). Trying via standard RPC...`);
    sponsorClient = createWalletClient({
      account: sponsorAccount,
      chain: bsc,
      transport: http(activeReadRpc),
    });
    rescueTxHash = await sponsorClient.sendTransaction({
      type: "eip7702",
      authorizationList: [authorization],
      to: compAccount.address,
      data: multicallData,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  }

  stream.tx(rescueTxHash, "Atomic EIP-7702 Rescue Tx (Sponsor Paid)");
  stream.log("⏳ Awaiting transaction confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: rescueTxHash });

  if (receipt.status !== "success") {
    stream.error("Atomic rescue transaction reverted.");
    return stream.done({ success: false, txHash: rescueTxHash, reason: "Rescue tx reverted" });
  }

  stream.log(`✅ Atomic Rescue CONFIRMED in block ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed})!`);

  stream.success(`EIP-7702 ATOMIC RESCUE COMPLETED!`, {
    amount: `${formattedBal} ${symbol}`,
    destination: destAddress,
    txHash: rescueTxHash,
  });
  stream.done({ success: true, txHash: rescueTxHash });
}

// Strategy 3: Direct Multi-RPC Parallel Broadcast
async function executeDirectMultiRpc({ stream, compKey, destAddress, tokenAddress, gasPriceMultiplier }) {
  stream.step(1, 4, "Connecting to Multiple BSC RPCs");
  stream.log("🚀 Strategy: Multi-RPC Simultaneous Parallel Broadcast");

  const rpcList = DEFAULT_RPCS.map((r) => r.url);
  const workingProviders = [];

  for (const url of rpcList) {
    try {
      const p = getProvider(url);
      const b = await p.getBlockNumber();
      stream.log(`📡 RPC Connected: ${url} (Block: ${b})`);
      workingProviders.push({ url, provider: p });
    } catch (e) {
      stream.log(`⚠️ RPC Failed: ${url}`);
    }
  }

  if (workingProviders.length === 0) {
    stream.error("No working RPC providers available!");
    return stream.done({ success: false });
  }

  const mainProvider = workingProviders[0].provider;
  const compWallet = new ethers.Wallet(compKey, mainProvider);

  stream.step(2, 4, "Fetching Token Balance & Nonce");
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, mainProvider);

  const [symbol, decimals, tokenBal, bnbBal, nonce, feeData] = await Promise.all([
    tokenContract.symbol().catch(() => "TOKEN"),
    tokenContract.decimals().catch(() => 18),
    tokenContract.balanceOf(compWallet.address),
    mainProvider.getBalance(compWallet.address),
    mainProvider.getTransactionCount(compWallet.address, "latest"),
    mainProvider.getFeeData(),
  ]);

  const formattedBal = ethers.formatUnits(tokenBal, decimals);
  stream.log(`💎 Balance: ${formattedBal} ${symbol}`);
  stream.log(`💰 Compromised Wallet BNB: ${ethers.formatEther(bnbBal)} BNB (Nonce: ${nonce})`);

  if (tokenBal === 0n) {
    stream.error("Token balance is 0!");
    return stream.done({ success: false });
  }

  stream.step(3, 4, "Signing & Parallel Broadcasting");
  const gasPrice = (feeData.gasPrice || ethers.parseUnits("3", "gwei")) * gasPriceMultiplier;
  const tokenIface = new ethers.Interface(ERC20_ABI);
  const data = tokenIface.encodeFunctionData("transfer", [destAddress, tokenBal]);

  const rawTx = {
    to: tokenAddress,
    data: data,
    gasLimit: 75000n,
    gasPrice: gasPrice,
    nonce: nonce,
    chainId: 56,
    value: 0n,
    type: 0,
  };

  const signedTx = await compWallet.signTransaction(rawTx);
  stream.log(`✍️ Signed Raw Tx (Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei)`);

  stream.log(`🚀 Broadcasting to ${workingProviders.length} RPCs at once...`);
  const broadcastResults = await Promise.all(
    workingProviders.map(async ({ url, provider }) => {
      try {
        const res = await provider.broadcastTransaction(signedTx);
        stream.log(`   ✅ Broadcasted via ${url}`);
        return res;
      } catch (err) {
        stream.log(`   ⚠️ Broadcast error (${url}): ${err.message}`);
        return null;
      }
    })
  );

  const validResponses = broadcastResults.filter(Boolean);
  if (validResponses.length === 0) {
    stream.error("Failed to broadcast on all RPCs! Wallet might have insufficient BNB for gas.");
    return stream.done({ success: false, reason: "Broadcast failed" });
  }

  const txHash = validResponses[0].hash;
  stream.tx(txHash, "Multi-RPC Transfer Tx");

  stream.step(4, 4, "Tracking Confirmation");
  let confirmed = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const receipt = await mainProvider.getTransactionReceipt(txHash);
      if (receipt && receipt.status === 1) {
        confirmed = true;
        stream.success(`TRANSFER SUCCESSFUL!`, {
          amount: `${formattedBal} ${symbol}`,
          destination: destAddress,
          txHash,
        });
        break;
      }
    } catch (e) {}
  }

  stream.done({ success: confirmed, txHash });
}

// Strategy 4: Direct BNB Sweep
async function executeSweepBnb({ stream, compKey, destAddress, bscRpc, gasPriceMultiplier }) {
  stream.step(1, 3, "Checking Compromised BNB Balance");
  const { provider } = await getWorkingReadProvider(bscRpc, stream);
  const wallet = new ethers.Wallet(compKey, provider);

  const [bnbBal, nonce, feeData] = await Promise.all([
    provider.getBalance(wallet.address),
    provider.getTransactionCount(wallet.address, "latest"),
    provider.getFeeData(),
  ]);

  stream.log(`💰 Compromised Wallet BNB Balance: ${ethers.formatEther(bnbBal)} BNB`);

  const gasLimit = 21000n;
  const gasPrice = (feeData.gasPrice || ethers.parseUnits("3", "gwei")) * gasPriceMultiplier;
  const gasCost = gasLimit * gasPrice;

  if (bnbBal <= gasCost) {
    stream.error(`Compromised wallet BNB (${ethers.formatEther(bnbBal)}) is less than gas cost (${ethers.formatEther(gasCost)})`);
    return stream.done({ success: false });
  }

  const amountToSend = bnbBal - gasCost;
  stream.step(2, 3, "Sending BNB Sweep Transaction");
  stream.log(`🚀 Sweeping ${ethers.formatEther(amountToSend)} BNB to ${destAddress}...`);

  const tx = await wallet.sendTransaction({
    to: destAddress,
    value: amountToSend,
    gasLimit,
    gasPrice,
    nonce,
  });

  stream.tx(tx.hash, "BNB Sweep Tx");
  stream.step(3, 3, "Awaiting Confirmation");
  const receipt = await tx.wait();

  stream.success(`BNB SWEEP COMPLETED!`, {
    amount: `${ethers.formatEther(amountToSend)} BNB`,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
  stream.done({ success: true, txHash: tx.hash });
}

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️  BSC TOKEN RESCUE GUI SERVER RUNNING`);
  console.log(`🌐  Local URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
