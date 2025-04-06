import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.prior.network";
const USDC_ADDRESS = "0x109694D75363A75317A8136D80f50F871E81044e";
const USDT_ADDRESS = "0x014397DaEa96CaC46DbEdcbce50A42D5e0152B2E";
const PRIOR_ADDRESS = "0xc19Ec2EEBB009b2422514C51F9118026f1cD89ba";
const routerAddress = "0x0f1DADEcc263eB79AE3e4db0d57c49a8b6178B0B";
const FAUCET_ADDRESS = "0xCa602D9E45E1Ed25105Ee43643ea936B8e2Fd6B7";
const NETWORK_NAME = "PRIOR TESTNET";

let walletInfos = [];
let transactionLogs = [];
let priorSwapRunning = false;
let priorSwapCancelled = false;
let globalWallets = [];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

const routerABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "varg0", "type": "uint256" }],
    "name": "swapPriorToUSDC",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "varg0", "type": "uint256" }],
    "name": "swapPriorToUSDT",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const FAUCET_ABI = [
  "function claimTokens() external",
  "function lastClaimTime(address) view returns (uint256)",
  "function claimCooldown() view returns (uint256)",
  "function claimAmount() view returns (uint256)"
];

class ProxyManager {
  constructor(proxyFilePath) {
    this.proxyFilePath = proxyFilePath;
    this.proxies = [];
    this.loadProxies();
  }

  loadProxies() {
    try {
      if (fs.existsSync(this.proxyFilePath)) {
        const proxyData = fs.readFileSync(this.proxyFilePath, 'utf8');
        this.proxies = proxyData.split('\n')
          .map(proxy => proxy.trim())
          .filter(proxy => proxy && !proxy.startsWith('#'));
        addLog(`Loaded ${this.proxies.length} proxies from ${this.proxyFilePath}`, "system");
      } else {
        addLog(`Proxy file ${this.proxyFilePath} not found. Proceeding without proxies.`, "warning");
      }
    } catch (error) {
      addLog(`Error loading proxies: ${error.message}`, "error");
    }
  }

  getProxy(index) {
    if (this.proxies.length === 0) return null;
    return this.proxies[index % this.proxies.length];
  }

  createProxyAgent(proxy) {
    if (!proxy) return null;
    const [auth, hostPort] = proxy.includes('@') ? proxy.split('@') : ['', proxy];
    const [username, password] = auth ? auth.replace('http://', '').split(':') : ['', ''];
    const [host, port] = hostPort ? hostPort.split(':') : ['', ''];
    const proxyUrl = username && password ? `http://${username}:${password}@${host}:${port}` : `http://${host}:${port}`;
    addLog(`Using proxy: ${host}:${port}`, "system");
    return new HttpsProxyAgent(proxyUrl);
  }
}

function loadWallets(proxyManager) {
  const walletFilePath = path.join(process.cwd(), "wallets.txt");
  try {
    if (fs.existsSync(walletFilePath)) {
      const walletData = fs.readFileSync(walletFilePath, 'utf8');
      walletInfos = walletData.split('\n')
        .map(key => key.trim())
        .filter(key => key && !key.startsWith('#'))
        .map((key, index) => ({
          address: "",
          balanceETH: "0.00",
          balancePrior: "0.00",
          balanceUSDC: "0.00",
          balanceUSDT: "0.00",
          network: NETWORK_NAME,
          status: "Initializing",
          privateKey: key,
          proxy: proxyManager.getProxy(index)
        }));
      addLog(`Loaded ${walletInfos.length} wallets from wallets.txt`, "system");
    } else if (process.env.PRIVATE_KEY) {
      walletInfos = [{
        address: "",
        balanceETH: "0.00",
        balancePrior: "0.00",
        balanceUSDC: "0.00",
        balanceUSDT: "0.00",
        network: NETWORK_NAME,
        status: "Initializing",
        privateKey: process.env.PRIVATE_KEY,
        proxy: proxyManager.getProxy(0)
      }];
      addLog("Using single wallet from .env PRIVATE_KEY", "system");
    } else {
      addLog("No wallets.txt or PRIVATE_KEY found. Please provide wallet data.", "error");
      process.exit(1);
    }

    if (proxyManager.proxies.length > 0 && walletInfos.length > proxyManager.proxies.length) {
      addLog(`Warning: Only ${proxyManager.proxies.length} proxies for ${walletInfos.length} wallets. Some wallets will reuse proxies.`, "warning");
    }
  } catch (error) {
    addLog(`Error loading wallets: ${error.message}`, "error");
    process.exit(1);
  }
}

function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function addLog(message, type) {
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message;
  if (type === "prior") coloredMessage = `{bright-magenta-fg}${message}{/bright-magenta-fg}`;
  else if (type === "system") coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
  else if (type === "error") coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
  else if (type === "success") coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
  else if (type === "warning") coloredMessage = `{bright-yellow-fg}${message}{/bright-yellow-fg}`;
  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getRandomDelay() {
  return Math.random() * (60000 - 30000) + 30000;
}

function getRandomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function updateLogs() {
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}

function clearTransactionLogs() {
  transactionLogs = [];
  updateLogs();
  addLog("Transaction logs cleared.", "system");
}

async function waitWithCancel(delay, type) {
  return Promise.race([
    new Promise(resolve => setTimeout(resolve, delay)),
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (type === "prior" && priorSwapCancelled) { clearInterval(interval); resolve(); }
      }, 100);
    })
  ]);
}

const screen = blessed.screen({
  smartCSR: true,
  title: "Prior Swap",
  fullUnicode: true,
  mouse: true
});

let renderTimeout;
function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => { screen.render(); }, 50);
}

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  tags: true,
  style: { fg: "white", bg: "default" }
});

figlet.text("NT EXHAUST".toUpperCase(), { font: "ANSI Shadow" }, (err, data) => {
  if (err) headerBox.setContent("{center}{bold}NT Exhaust{/bold}{/center}");
  else headerBox.setContent(`{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`);
  safeRender();
});

const descriptionBox = blessed.box({
  left: "center",
  width: "100%",
  content: "{center}{bold}{bright-yellow-fg}« ✮  P̳̿͟͞R̳̿͟͞I̳̿͟͞O̳̿͟͞R̳̿͟͞ A̳̿͟͞U̳̿͟͞T̳̿͟͞O̳̿͟͞ B̳̿͟͞O̳̿͟͞T̳̿͟͞ ✮ »{/bright-yellow-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white", bg: "default" }
});

const logsBox = blessed.box({
  label: " Transaction Logs ",
  left: 0,
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  content: "",
  style: { border: { fg: "bright-cyan" }, bg: "default" }
});

const walletBox = blessed.box({
  label: " Wallet Info ",
  border: { type: "line" },
  tags: true,
  style: { border: { fg: "magenta" }, fg: "white", bg: "default" }
});

const mainMenu = blessed.list({
  label: " Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "green", fg: "black" } },
  items: getMainMenuItems()
});

const priorSubMenu = blessed.list({
  label: " Prior Swap Sub Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "cyan", fg: "black" } },
  items: getPriorMenuItems()
});
priorSubMenu.hide();

const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: 5,
  width: "60%",
  top: "center",
  left: "center",
  label: "{bright-blue-fg}Swap Prompt{/bright-blue-fg}",
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  style: { fg: "bright-red", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(priorSubMenu);

function getMainMenuItems() {
  let items = ["Prior Swap", "Claim Faucet", "Clear Transaction Logs", "Refresh", "Exit"];
  if (priorSwapRunning) items.unshift("Stop All Transactions");
  return items;
}

function getPriorMenuItems() {
  let items = ["Auto Swap Prior & USDC/USDT", "Clear Transaction Logs", "Back To Main Menu", "Refresh"];
  if (priorSwapRunning) items.splice(1, 0, "Stop Transaction");
  return items;
}

function updateWallet() {
  const content = walletInfos.map((info, index) => {
    const shortAddress = info.address ? getShortAddress(info.address) : "N/A";
    const prior = Number(info.balancePrior).toFixed(2);
    const usdc = Number(info.balanceUSDC).toFixed(2);
    const usdt = Number(info.balanceUSDT).toFixed(2);
    const eth = Number(info.balanceETH).toFixed(4);
    const proxy = info.proxy || "None";
    return `Wallet ${index + 1}:\n┌── Address : {bright-yellow-fg}${shortAddress}{/bright-yellow-fg}\n│   ├── ETH     : {bright-green-fg}${eth}{/bright-green-fg}\n│   ├── PRIOR   : {bright-green-fg}${prior}{/bright-green-fg}\n│   ├── USDC    : {bright-green-fg}${usdc}{/bright-green-fg}\n│   └── USDT    : {bright-green-fg}${usdt}{/bright-green-fg}\n│   └── Proxy   : {bright-cyan-fg}${proxy}{/bright-cyan-fg}\n└── Network     : {bright-cyan-fg}${NETWORK_NAME}{/bright-cyan-fg}\n`;
  }).join("\n");
  walletBox.setContent(content);
  safeRender();
}

async function updateWalletData(proxyManager) {
  globalWallets = [];
  for (let i = 0; i < walletInfos.length; i++) {
    const providerOptions = { url: RPC_URL };
    if (walletInfos[i].proxy) {
      providerOptions.agent = proxyManager.createProxyAgent(walletInfos[i].proxy);
    }
    const provider = new ethers.JsonRpcProvider(providerOptions);
    const wallet = new ethers.Wallet(walletInfos[i].privateKey, provider);
    globalWallets.push(wallet);

    try {
      walletInfos[i].address = wallet.address;
      const [ethBalance, balancePrior, balanceUSDC, balanceUSDT] = await Promise.all([
        provider.getBalance(wallet.address),
        new ethers.Contract(PRIOR_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address),
        new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address),
        new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address)
      ]);

      walletInfos[i].balanceETH = ethers.formatEther(ethBalance);
      walletInfos[i].balancePrior = ethers.formatEther(balancePrior);
      walletInfos[i].balanceUSDC = ethers.formatUnits(balanceUSDC, 6);
      walletInfos[i].balanceUSDT = ethers.formatUnits(balanceUSDT, 6);
    } catch (error) {
      addLog(`Wallet ${getShortAddress(wallet.address)}: Failed to update data: ${error.message}`, "error");
    }
  }
  updateWallet();
  addLog("Wallet balances updated!", "system");
}

function stopAllTransactions() {
  if (priorSwapRunning) {
    priorSwapCancelled = true;
    addLog("Stop All Transactions command received.", "system");
  }
}

async function autoClaimFaucet(proxyManager) {
  for (let i = 0; i < globalWallets.length; i++) {
    const wallet = globalWallets[i];
    const shortAddress = getShortAddress(wallet.address);
    const providerOptions = { url: RPC_URL };
    if (walletInfos[i].proxy) {
      providerOptions.agent = proxyManager.createProxyAgent(walletInfos[i].proxy);
    }
    const provider = new ethers.JsonRpcProvider(providerOptions);
    const signer = wallet.connect(provider);
    const faucetContract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, signer);

    try {
      const lastClaim = await faucetContract.lastClaimTime(wallet.address);
      const cooldown = await faucetContract.claimCooldown();
      const currentTime = Math.floor(Date.now() / 1000);
      const nextClaimTime = Number(lastClaim) + Number(cooldown);

      if (currentTime < nextClaimTime) {
        const waitTime = nextClaimTime - currentTime;
        const waitHours = Math.floor(waitTime / 3600);
        const waitMinutes = Math.floor((waitTime % 3600) / 60);
        addLog(`Wallet ${shortAddress}: Wait ${waitHours}h ${waitMinutes}m before next claim.`, "warning");
        continue;
      }

      addLog(`Wallet ${shortAddress}: Starting Claim Faucet PRIOR...`, "system");
      const tx = await faucetContract.claimTokens();
      addLog(`Wallet ${shortAddress}: Tx Sent. Hash: ${getShortHash(tx.hash)}`, "warning");
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        addLog(`Wallet ${shortAddress}: Claim Faucet Successful!`, "success");
      } else {
        addLog(`Wallet ${shortAddress}: Claim Faucet Failed.`, "error");
      }
    } catch (error) {
      addLog(`Wallet ${shortAddress}: Error claiming faucet: ${error.message}`, "error");
    }
  }
  await updateWalletData(proxyManager);
}

async function runAutoSwap(proxyManager) {
  promptBox.setFront();
  promptBox.readInput("Masukkan Jumlah Swap per Wallet:", "", async (err, value) => {
    promptBox.hide();
    safeRender();
    if (err || !value) {
      addLog("Prior Swap: Invalid input or cancelled.", "prior");
      return;
    }
    const loopCount = parseInt(value);
    if (isNaN(loopCount)) {
      addLog("Prior Swap: Input must be a number.", "prior");
      return;
    }
    addLog(`Prior Swap: Set to run ${loopCount} swaps per wallet.`, "prior");

    if (priorSwapRunning) {
      addLog("Prior Swap: Transaction already running. Stop it first.", "prior");
      return;
    }

    priorSwapRunning = true;
    priorSwapCancelled = false;
    mainMenu.setItems(getMainMenuItems());
    priorSubMenu.setItems(getPriorMenuItems());
    priorSubMenu.show();
    safeRender();

    for (let i = 0; i < globalWallets.length; i++) {
      if (priorSwapCancelled) break;

      const wallet = globalWallets[i];
      const shortAddress = getShortAddress(wallet.address);
      addLog(`Wallet ${shortAddress}: Starting auto swap...`, "prior");

      const providerOptions = { url: RPC_URL };
      if (walletInfos[i].proxy) {
        providerOptions.agent = proxyManager.createProxyAgent(walletInfos[i].proxy);
      }
      const provider = new ethers.JsonRpcProvider(providerOptions);
      const signer = wallet.connect(provider);
      const priorToken = new ethers.Contract(PRIOR_ADDRESS, ERC20_ABI, signer);

      for (let j = 1; j <= loopCount; j++) {
        if (priorSwapCancelled) {
          addLog(`Wallet ${shortAddress}: Auto swap stopped at cycle ${j}.`, "prior");
          break;
        }

        const randomAmount = getRandomNumber(0.001, 0.01);
        const amountPrior = ethers.parseEther(randomAmount.toFixed(6));
        const isUSDC = j % 2 === 1;
        const functionSelector = isUSDC ? "0xf3b68002" : "0x03b530a3";
        const swapTarget = isUSDC ? "USDC" : "USDT";

        try {
          const approveTx = await priorToken.approve(routerAddress, amountPrior);
          addLog(`Wallet ${shortAddress}: Approval Tx Sent. Hash: ${getShortHash(approveTx.hash)}`, "prior");
          const approveReceipt = await approveTx.wait();
          if (approveReceipt.status !== 1) {
            addLog(`Wallet ${shortAddress}: Approval failed. Skipping cycle ${j}.`, "prior");
            await waitWithCancel(getRandomDelay(), "prior");
            continue;
          }
          addLog(`Wallet ${shortAddress}: Approval successful.`, "prior");
        } catch (error) {
          addLog(`Wallet ${shortAddress}: Approval error: ${error.message}`, "prior");
          await waitWithCancel(getRandomDelay(), "prior");
          continue;
        }

        const paramHex = ethers.zeroPadValue(ethers.toBeHex(amountPrior), 32);
        const txData = functionSelector + paramHex.slice(2);
        try {
          addLog(`Wallet ${shortAddress}: Swapping ${ethers.formatEther(amountPrior)} PRIOR → ${swapTarget}`, "prior");
          const tx = await signer.sendTransaction({
            to: routerAddress,
            data: txData,
            gasLimit: 500000
          });
          addLog(`Wallet ${shortAddress}: Tx Sent. Hash: ${getShortHash(tx.hash)}`, "prior");
          const receipt = await tx.wait();
          if (receipt.status === 1) {
            addLog(`Wallet ${shortAddress}: Swap PRIOR → ${swapTarget} successful.`, "prior");
          } else {
            addLog(`Wallet ${shortAddress}: Swap failed.`, "prior");
          }
        } catch (error) {
          addLog(`Wallet ${shortAddress}: Swap error: ${error.message}`, "prior");
        }

        if (j < loopCount) {
          const delay = getRandomDelay();
          const minutes = Math.floor(delay / 60000);
          const seconds = Math.floor((delay % 60000) / 1000);
          addLog(`Wallet ${shortAddress}: Waiting ${minutes}m ${seconds}s before next swap`, "prior");
          await waitWithCancel(delay, "prior");
        }
      }
      await updateWalletData(proxyManager);
    }

    priorSwapRunning = false;
    mainMenu.setItems(getMainMenuItems());
    priorSubMenu.setItems(getPriorMenuItems());
    safeRender();
    addLog("Prior Swap: Auto swap completed.", "prior");
  });
}

function adjustLayout() {
  const screenHeight = screen.height;
  const screenWidth = screen.width;
  const headerHeight = Math.max(8, Math.floor(screenHeight * 0.15));
  headerBox.top = 0;
  headerBox.height = headerHeight;
  headerBox.width = "100%";
  descriptionBox.top = "25%";
  descriptionBox.height = Math.floor(screenHeight * 0.05);
  logsBox.top = headerHeight + descriptionBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(screenWidth * 0.6);
  logsBox.height = screenHeight - (headerHeight + descriptionBox.height);
  walletBox.top = headerHeight + descriptionBox.height;
  walletBox.left = Math.floor(screenWidth * 0.6);
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  mainMenu.top = headerHeight + descriptionBox.height + walletBox.height;
  mainMenu.left = Math.floor(screenWidth * 0.6);
  mainMenu.width = Math.floor(screenWidth * 0.4);
  mainMenu.height = screenHeight - (headerHeight + descriptionBox.height + walletBox.height);
  priorSubMenu.top = mainMenu.top;
  priorSubMenu.left = mainMenu.left;
  priorSubMenu.width = mainMenu.width;
  priorSubMenu.height = mainMenu.height;
  safeRender();
}

screen.on("resize", adjustLayout);
adjustLayout();

const proxyManager = new ProxyManager(path.join(process.cwd(), "proxies.txt"));
loadWallets(proxyManager);
updateWalletData(proxyManager);

mainMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Stop All Transactions") {
    stopAllTransactions();
    mainMenu.setItems(getMainMenuItems());
    mainMenu.focus();
    safeRender();
  } else if (selected === "Prior Swap") {
    priorSubMenu.show();
    priorSubMenu.focus();
    safeRender();
  } else if (selected === "Claim Faucet") {
    autoClaimFaucet(proxyManager);
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Refresh") {
    updateWalletData(proxyManager);
    addLog("Refreshed", "system");
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

priorSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Swap Prior & USDC/USDT") {
    runAutoSwap(proxyManager);
  } else if (selected === "Stop Transaction") {
    if (priorSwapRunning) {
      priorSwapCancelled = true;
      addLog("Prior Swap: Stop Transaction command received.", "prior");
    } else {
      addLog("Prior Swap: No transactions running.", "prior");
    }
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    priorSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Refresh") {
    updateWalletData(proxyManager);
    addLog("Refreshed", "system");
  }
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => { logsBox.scroll(-1); safeRender(); });
screen.key(["C-down"], () => { logsBox.scroll(1); safeRender(); });

safeRender();
mainMenu.focus();
updateLogs();
