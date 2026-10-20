/**
 * =====================================================================
 * BSC TOKEN RESCUE - FRONTEND CONTROLLER
 * =====================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  // State
  const state = {
    config: {},
    selectedStrategy: "rapid-fire",
    isExecuting: false,
    rpcs: [],
    eventSource: null,
  };

  // DOM Elements
  const el = {
    // Header
    rpcStatusDot: document.getElementById("rpcStatusDot"),
    rpcSpeedText: document.getElementById("rpcSpeedText"),
    btnRefreshAll: document.getElementById("btnRefreshAll"),
    btnConfigModal: document.getElementById("btnConfigModal"),

    // Target Token
    tokenContractInput: document.getElementById("tokenContractInput"),
    btnCheckToken: document.getElementById("btnCheckToken"),
    tokenSymbolBadge: document.getElementById("tokenSymbolBadge"),
    tokenNameText: document.getElementById("tokenNameText"),
    tokenDecimalsText: document.getElementById("tokenDecimalsText"),
    compTokenBalText: document.getElementById("compTokenBalText"),

    // Wallets
    compAddressText: document.getElementById("compAddressText"),
    eip7702Badge: document.getElementById("eip7702Badge"),
    compBnbBalText: document.getElementById("compBnbBalText"),
    compNonceText: document.getElementById("compNonceText"),
    fundAddressText: document.getElementById("fundAddressText"),
    fundBnbBalText: document.getElementById("fundBnbBalText"),
    gasNeededText: document.getElementById("gasNeededText"),

    // Destination
    destAddressInput: document.getElementById("destAddressInput"),
    destTokenBalText: document.getElementById("destTokenBalText"),

    // RPC Nodes List
    rpcNodesList: document.getElementById("rpcNodesList"),
    btnPingRpcs: document.getElementById("btnPingRpcs"),

    // Strategy
    strategyItems: document.querySelectorAll(".strategy-item"),
    gasMultiplier: document.getElementById("gasMultiplier"),
    btnExecuteRescue: document.getElementById("btnExecuteRescue"),

    // Terminal
    btnClearTerminal: document.getElementById("btnClearTerminal"),
    stepProgressContainer: document.getElementById("stepProgressContainer"),
    stepTitleText: document.getElementById("stepTitleText"),
    stepCountText: document.getElementById("stepCountText"),
    progressBarFill: document.getElementById("progressBarFill"),
    terminalBody: document.getElementById("terminalBody"),
    txHistoryBox: document.getElementById("txHistoryBox"),
    txLinksList: document.getElementById("txLinksList"),

    // Config Modal
    configModalOverlay: document.getElementById("configModalOverlay"),
    btnCloseConfigModal: document.getElementById("btnCloseConfigModal"),
    btnCancelConfig: document.getElementById("btnCancelConfig"),
    btnSaveConfig: document.getElementById("btnSaveConfig"),
    cfgCompKey: document.getElementById("cfgCompKey"),
    cfgFundKey: document.getElementById("cfgFundKey"),
    cfgDestAddress: document.getElementById("cfgDestAddress"),
    cfgTokenContract: document.getElementById("cfgTokenContract"),
    cfgBscRpc: document.getElementById("cfgBscRpc"),
    cfgBloxRpc: document.getElementById("cfgBloxRpc"),

    // Success Modal
    successModalOverlay: document.getElementById("successModalOverlay"),
    btnCloseSuccessModal: document.getElementById("btnCloseSuccessModal"),
    successRescuedAmount: document.getElementById("successRescuedAmount"),
    successDestination: document.getElementById("successDestination"),
    btnSuccessBscScan: document.getElementById("btnSuccessBscScan"),
  };

  // ===== Helper Functions =====
  function logTerminal(text, type = "info") {
    const line = document.createElement("div");
    line.className = `log-line log-${type}`;

    const time = document.createElement("span");
    time.className = "log-time";
    const now = new Date();
    time.textContent = `[${now.toTimeString().split(" ")[0]}]`;

    const content = document.createElement("span");
    content.className = "log-text";
    content.textContent = text;

    line.appendChild(time);
    line.appendChild(content);
    el.terminalBody.appendChild(line);
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }

  function addTxLink(hash, label, explorer) {
    el.txHistoryBox.style.display = "block";
    const a = document.createElement("a");
    a.href = explorer;
    a.target = "_blank";
    a.className = "tx-pill-link";
    a.innerHTML = `<span>🔗</span> ${label || "Tx"}: ${hash.slice(0, 8)}...${hash.slice(-6)} ↗`;
    el.txLinksList.appendChild(a);
  }

  // ===== API Calls =====
  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      state.config = data;
      state.rpcs = data.defaultRpcs || [];

      if (data.tokenContract) el.tokenContractInput.value = data.tokenContract;
      if (data.destinationAddress) el.destAddressInput.value = data.destinationAddress;

      // Populate config modal
      el.cfgCompKey.value = "";
      el.cfgFundKey.value = "";
      el.cfgDestAddress.value = data.destinationAddress || "";
      el.cfgTokenContract.value = data.tokenContract || "";
      el.cfgBscRpc.value = data.bscRpc || "";
      el.cfgBloxRpc.value = data.bloxrouteRpc || "";

      renderRpcList();
      await inspectState();
    } catch (err) {
      logTerminal(`Failed to load server config: ${err.message}`, "error");
    }
  }

  async function inspectState() {
    try {
      const tokenContract = el.tokenContractInput.value.trim();
      const destAddress = el.destAddressInput.value.trim();

      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenContract, destinationAddress: destAddress }),
      });
      const data = await res.json();

      if (!data.success) {
        logTerminal(`Inspection error: ${data.error}`, "error");
        return;
      }

      // Compromised Wallet Info
      if (data.compromised.address) {
        el.compAddressText.textContent = data.compromised.address;
        el.compBnbBalText.textContent = `${parseFloat(data.compromised.bnbBalance).toFixed(6)} BNB`;
        el.compNonceText.textContent = `#${data.compromised.nonce}`;

        if (data.compromised.isEip7702Delegated) {
          el.eip7702Badge.textContent = "🚨 EIP-7702 HACKED";
          el.eip7702Badge.className = "status-pill status-danger";
          logTerminal(`🚨 PERINGATAN: Terdeteksi delegasi EIP-7702 ke hacker contract: ${data.compromised.delegatedContract}`, "error");
        } else {
          el.eip7702Badge.textContent = "Normal EOA (Clean)";
          el.eip7702Badge.className = "status-pill status-success";
        }
      } else {
        el.compAddressText.textContent = "Set Private Key in Config ⚙️";
      }

      // Funding Wallet Info
      if (data.funding.address) {
        el.fundAddressText.textContent = data.funding.address;
        el.fundBnbBalText.textContent = `${parseFloat(data.funding.bnbBalance).toFixed(6)} BNB`;
      } else {
        el.fundAddressText.textContent = "Set Private Key in Config ⚙️";
      }

      // Token Info
      if (data.token) {
        el.tokenSymbolBadge.textContent = data.token.symbol || "???";
        el.tokenNameText.textContent = data.token.name || "-";
        el.tokenDecimalsText.textContent = data.token.decimals || "18";
        el.compTokenBalText.textContent = `${parseFloat(data.token.compromisedBalance || 0).toLocaleString()} ${data.token.symbol}`;

        if (data.token.destinationBalance) {
          el.destTokenBalText.textContent = `${parseFloat(data.token.destinationBalance).toLocaleString()} ${data.token.symbol}`;
        }

        if (data.token.recommendedFundBnb) {
          el.gasNeededText.textContent = `~${parseFloat(data.token.recommendedFundBnb).toFixed(6)} BNB`;
        }
      }

      logTerminal("Wallet & balance data refreshed successfully.", "system");
    } catch (err) {
      logTerminal(`Error inspecting balances: ${err.message}`, "error");
    }
  }

  function renderRpcList() {
    el.rpcNodesList.innerHTML = "";
    state.rpcs.forEach((rpc, idx) => {
      const row = document.createElement("div");
      row.className = "rpc-node-row";
      row.id = `rpc-row-${idx}`;
      row.innerHTML = `
        <span class="rpc-node-name">
          <span class="status-dot dot-amber" id="rpc-dot-${idx}"></span>
          ${rpc.name} ${rpc.private ? "🔒" : ""}
        </span>
        <span class="rpc-node-latency" id="rpc-lat-${idx}">Testing...</span>
      `;
      el.rpcNodesList.appendChild(row);
    });
    pingAllRpcs();
  }

  async function pingAllRpcs() {
    try {
      const res = await fetch("/api/rpc-ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpcs: state.rpcs.map((r) => r.url) }),
      });
      const data = await res.json();

      let fastestLatency = 99999;
      let fastestUrl = "";

      data.results.forEach((resItem, idx) => {
        const dot = document.getElementById(`rpc-dot-${idx}`);
        const lat = document.getElementById(`rpc-lat-${idx}`);
        if (!dot || !lat) return;

        if (resItem.online) {
          dot.className = "status-dot dot-online";
          lat.textContent = `${resItem.latency}ms (Block #${resItem.block})`;
          lat.style.color = "var(--cyber-green)";

          if (resItem.latency < fastestLatency) {
            fastestLatency = resItem.latency;
            fastestUrl = resItem.url;
          }
        } else {
          dot.className = "status-dot dot-offline";
          lat.textContent = "Offline / Timed Out";
          lat.style.color = "var(--danger-red)";
        }
      });

      if (fastestLatency < 99999) {
        el.rpcStatusDot.className = "status-dot dot-online";
        el.rpcSpeedText.textContent = `Online (${fastestLatency}ms)`;
      } else {
        el.rpcStatusDot.className = "status-dot dot-offline";
        el.rpcSpeedText.textContent = "All RPCs Unreachable";
      }
    } catch (err) {
      console.error("RPC Ping error", err);
    }
  }

  // ===== Strategy Selection =====
  el.strategyItems.forEach((item) => {
    item.addEventListener("click", () => {
      if (state.isExecuting) return;
      el.strategyItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      state.selectedStrategy = item.dataset.strategy;
      logTerminal(`Strategi dipilih: ${item.querySelector("h4").textContent}`, "info");
    });
  });

  // ===== Rescue Execution with SSE Stream =====
  el.btnExecuteRescue.addEventListener("click", async () => {
    if (state.isExecuting) return;

    const destAddress = el.destAddressInput.value.trim();
    const tokenAddress = el.tokenContractInput.value.trim();
    const gasMultiplier = el.gasMultiplier.value;

    if (!destAddress) {
      alert("Masukkan Safe Destination Address terlebih dahulu!");
      el.destAddressInput.focus();
      return;
    }

    const confirmMsg = `PERINGATAN RESCUE 🛡️\n\nStrategi: ${state.selectedStrategy.toUpperCase()}\nDestination: ${destAddress}\nGas Multiplier: ${gasMultiplier}x\n\nLanjutkan eksekusi sekarang?`;
    if (!confirm(confirmMsg)) return;

    // Start Execution
    state.isExecuting = true;
    el.btnExecuteRescue.disabled = true;
    el.btnExecuteRescue.innerHTML = `
      <span class="btn-execute-glow"></span>
      <span class="btn-execute-icon">⏳</span>
      <span class="btn-execute-text">EXECUTING RESCUE...</span>
    `;

    // Clear / Reset Terminal
    el.stepProgressContainer.style.display = "block";
    el.txHistoryBox.style.display = "none";
    el.txLinksList.innerHTML = "";
    logTerminal(`\n🚀 ================= INITIATING RESCUE =================`, "step");
    logTerminal(`Strategi: ${state.selectedStrategy} | Multiplier: ${gasMultiplier}x`, "info");

    const queryParams = new URLSearchParams({
      strategy: state.selectedStrategy,
      destAddress: destAddress,
      tokenAddress: tokenAddress,
      gasMultiplier: gasMultiplier,
    });

    if (state.eventSource) {
      state.eventSource.close();
    }

    state.eventSource = new EventSource(`/api/rescue/stream?${queryParams.toString()}`);

    state.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { type, data } = payload;

        if (type === "step") {
          const { stepIndex, totalSteps, title } = data;
          const pct = Math.round((stepIndex / totalSteps) * 100);
          el.progressBarFill.style.width = `${pct}%`;
          el.stepTitleText.textContent = title;
          el.stepCountText.textContent = `Step ${stepIndex} of ${totalSteps}`;
          logTerminal(`[STEP ${stepIndex}/${totalSteps}] ${title}`, "step");
        } else if (type === "log") {
          logTerminal(data, "info");
        } else if (type === "tx") {
          logTerminal(`🚀 Broadcasted Tx: ${data.hash}`, "info");
          addTxLink(data.hash, data.label, data.explorer);
        } else if (type === "error") {
          logTerminal(`❌ ${data.message || data}`, "error");
        } else if (type === "success") {
          logTerminal(`🎉 ${data.message || "RESCUE SUCCESSFUL"}`, "success");
          if (data.rescuedAmount) {
            el.successRescuedAmount.textContent = data.rescuedAmount;
            el.successDestination.textContent = data.destination;
            el.btnSuccessBscScan.href = `https://bscscan.com/tx/${data.txHash}`;
            el.successModalOverlay.classList.add("active");
          }
        } else if (type === "done") {
          state.eventSource.close();
          state.isExecuting = false;
          el.btnExecuteRescue.disabled = false;
          el.btnExecuteRescue.innerHTML = `
            <span class="btn-execute-glow"></span>
            <span class="btn-execute-icon">⚡</span>
            <span class="btn-execute-text">EXECUTE RESCUE NOW</span>
          `;
          logTerminal(`🏁 Sesi eksekusi selesai.`, "system");
          inspectState();
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    state.eventSource.onerror = (err) => {
      logTerminal(`SSE Connection closed or error occurred.`, "error");
      state.eventSource.close();
      state.isExecuting = false;
      el.btnExecuteRescue.disabled = false;
      el.btnExecuteRescue.innerHTML = `
        <span class="btn-execute-glow"></span>
        <span class="btn-execute-icon">⚡</span>
        <span class="btn-execute-text">EXECUTE RESCUE NOW</span>
      `;
    };
  });

  // ===== Event Listeners =====
  el.btnRefreshAll.addEventListener("click", () => {
    inspectState();
    pingAllRpcs();
  });

  el.btnCheckToken.addEventListener("click", () => {
    inspectState();
  });

  el.btnPingRpcs.addEventListener("click", () => {
    pingAllRpcs();
  });

  el.btnClearTerminal.addEventListener("click", () => {
    el.terminalBody.innerHTML = "";
    logTerminal("Terminal cleared.", "system");
  });

  // Copy Buttons
  document.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (targetEl && targetEl.textContent) {
        navigator.clipboard.writeText(targetEl.textContent.trim());
        const originalText = btn.textContent;
        btn.textContent = "✅";
        setTimeout(() => (btn.textContent = originalText), 1500);
      }
    });
  });

  // Eye Toggle Buttons
  document.querySelectorAll(".btn-toggle-eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
      }
    });
  });

  // Config Modal
  el.btnConfigModal.addEventListener("click", () => {
    el.configModalOverlay.classList.add("active");
  });

  el.btnCloseConfigModal.addEventListener("click", () => {
    el.configModalOverlay.classList.remove("active");
  });

  el.btnCancelConfig.addEventListener("click", () => {
    el.configModalOverlay.classList.remove("active");
  });

  el.btnSaveConfig.addEventListener("click", async () => {
    const payload = {
      compromisedKey: el.cfgCompKey.value.trim(),
      fundingKey: el.cfgFundKey.value.trim(),
      destinationAddress: el.cfgDestAddress.value.trim(),
      tokenContract: el.cfgTokenContract.value.trim(),
      bscRpc: el.cfgBscRpc.value.trim(),
      bloxrouteRpc: el.cfgBloxRpc.value.trim(),
    };

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        alert("Konfigurasi berhasil disimpan ke .env!");
        el.configModalOverlay.classList.remove("active");
        loadConfig();
      } else {
        alert(`Gagal menyimpan: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  // Success Modal
  el.btnCloseSuccessModal.addEventListener("click", () => {
    el.successModalOverlay.classList.remove("active");
  });

  // Initial Load
  loadConfig();
});
