const ABI = [{
    "inputs": [],
    "name": "mint",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
},
{
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
        {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
        }
    ],
    "stateMutability": "view",
    "type": "function"
},
{
  "inputs": [
      {
          "internalType": "address",
          "name": "owner",
          "type": "address"
      }
  ],
  "name": "balanceOf",
  "outputs": [
      {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
      }
  ],
  "stateMutability": "view",
  "type": "function"
},
{
  "inputs": [
      {
          "internalType": "address",
          "name": "owner",
          "type": "address"
      },
      {
          "internalType": "uint256",
          "name": "index",
          "type": "uint256"
      }
  ],
  "name": "tokenOfOwnerByIndex",
  "outputs": [
      {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
      }
  ],
  "stateMutability": "view",
  "type": "function"
}]

const ADDRESS_CONTRACT = "0xbec50923ac478b37AB28E09417BA8a6780F830F2";

let contract_interface;

 // Unpkg imports
const Web3Modal = window.Web3Modal.default;
const WalletConnectProvider = window.WalletConnectProvider.default;
let web3Modal
let provider;
let selectedAccount = 0;

const web3 = new Web3(window.ethereum);

function init() {
  // Tell Web3modal what providers we have available.
  // Built-in web browser provider (only one can exist as a time)
  // like MetaMask, Brave or Opera is added automatically by Web3modal
  const providerOptions = {
    walletconnect: {
      package: WalletConnectProvider,
      options: {
        infuraId: 'a6ca7a0157184aedbafef89ee4794dc2', //mock one, unused
        rpc: {
            137: 'https://speedy-nodes-nyc.moralis.io/ba37a27569098467ee18fad8/polygon/mainnet'
        },
        network: 'polygon'
      }
    }
  };

  web3Modal = new Web3Modal({
    cacheProvider: false, // optional
    providerOptions, // required
    disableInjectedProvider: false, // optional. For MetaMask / Brave / Opera.
  });

  contract_interface = new web3.eth.Contract(ABI, ADDRESS_CONTRACT);

  document.querySelector("#prepare").style.display = "block";
  document.querySelector("#connected").style.display = "none";

  minted();
}

async function minted() {
	try {
	  const left = await contract_interface.methods.totalSupply().call();
	  document.querySelector("#token-left").textContent = (left)+' / 10000';
  }

	catch(e) {
    document.querySelector("#token-left").textContent = '\o/';
		console.log("waiting provider");}
}

/**
 * Kick in the UI action after Web3modal dialog has chosen a provider
 */
async function fetchAccountData() {

  // Get a Web3 instance for the wallet
  const web3 = new Web3(provider);
  // Get list of accounts of the connected wallet
  const accounts = await web3.eth.getAccounts();
  selectedAccount = accounts[0];

  // Display fully loaded UI for wallet data
  document.querySelector("#prepare").style.display = "none";
  document.querySelector("#connected").style.display = "block";
}

/**
 * Fetch account data for UI when
 * - User switches accounts in wallet
 * - User switches networks in wallet
 * - User connects wallet initially
 */
async function refreshAccountData() {

  // If any current data is displayed when
  // the user is switching acounts in the wallet
  // immediate hide this data
  document.querySelector("#connected").style.display = "none";
  document.querySelector("#prepare").style.display = "block";

  // fetchAccountData() will take a while as it communicates
  // with Ethereum node via JSON-RPC and loads chain data
  // over an API call.
  //document.querySelector("#btn-buy").setAttribute("disabled", "disabled")
  await fetchAccountData(provider);
  //document.querySelector("#btn-buy").removeAttribute("disabled")
}

/**
 * Connect wallet button pressed.
 */
async function onClickBuy() {
  if(selectedAccount==0) {
    try {
      provider = await web3Modal.connect();
    } catch(e) {
      console.log(e);
      return;
    }

    // Subscribe to accounts change
    provider.on("accountsChanged", (accounts) => {
      fetchAccountData();
    });

    // Subscribe to chainId change
    provider.on("chainChanged", (chainId) => {
      fetchAccountData();
    });

    // Subscribe to networkId change
    provider.on("networkChanged", (networkId) => {
      fetchAccountData();
    });

    await refreshAccountData();
    }
  else {
        const quantity_asked = document.querySelector("#field-nb").innerText;
		const matic_to_send = quantity_asked * 800 * 10**18;
        contract_interface.methods.mint().send({from:selectedAccount, value:matic_to_send});
  }
}

window.addEventListener('load', async () => {
  init();
  document.querySelector("#btn-mint").addEventListener("click", onClickBuy);
	setInterval(function() { minted();},1000);
});
