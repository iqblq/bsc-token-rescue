# BSC Token Rescue Tool 🛡️

A specialized Node.js tool designed to rescue BEP-20 tokens from compromised Binance Smart Chain (BSC) wallets targeted by sweeper bots.

---

## ⚡ Features

- **Private Mempool Bypass**: Uses **bloXroute Protect RPC** to broadcast transactions privately without revealing them to public mempool sweeper bots.
- **Rapid-Fire Execution**: Automates gas funding and token transfer in rapid succession.
- **NodeReal Bundle Support**: Optional atomic bundling strategy ensuring both gas funding and token transfer transactions are mined together.
- **EIP-7702 Delegation & Revocation Support**: Script to revoke malicious authorization and rescue assets.
- **Balance & Gas Checker**: Utilities to inspect token balances, BNB balances, and gas requirements.

---

## 🚀 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/iqblq/bsc-token-rescue.git
   cd bsc-token-rescue
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example `.env` file:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your actual wallet configurations:
   ```env
   COMPROMISED_PRIVATE_KEY=your_compromised_wallet_private_key_here
   FUNDING_PRIVATE_KEY=your_safe_wallet_private_key_here
   DESTINATION_ADDRESS=your_safe_destination_address_here
   TOKEN_CONTRACT=0x...
   BSC_RPC=https://bsc-rpc.publicnode.com
   BLOXROUTE_RPC=https://bsc.rpc.blxrbdn.com
   RESCUE_STRATEGY=bloxroute
   ```

---

## 🛠️ Usage

- **Interactive Web GUI Dashboard (Recommended):**
  ```bash
  npm run gui
  ```
  Buka browser di `http://localhost:3000` untuk monitoring wallet real-time, ping RPC, deteksi EIP-7702, dan eksekusi rescue visual.

- **Check Balances (CLI):**
  ```bash
  npm run check
  ```
- **Execute Rescue (CLI):**
  ```bash
  npm run rescue
  ```
- **Execute EIP-7702 Rescue/Revoke:**
  ```bash
  npm run rescue:7702
  ```
- **Direct Transfer:**
  ```bash
  npm run send
  ```

---

## ⚠️ Security Notice

- **Never share or commit your `.env` file or private keys.**
- Keep only the minimum required BNB in the funding wallet.
- Always verify token contract addresses before execution.

---

## 📄 License
ISC
