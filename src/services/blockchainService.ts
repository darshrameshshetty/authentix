import { BrowserProvider, Contract } from 'ethers';

// Deployed on Sepolia Testnet via Remix
const CONTRACT_ADDRESS = '0x0f427d1e17A1C7D74d3604F4762e551AC1982e6D';
const SEPOLIA_CHAIN_ID = '0xaa36a7';
const SEPOLIA_NETWORK_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID,
  chainName: 'Sepolia Testnet',
  nativeCurrency: {
    name: 'SepoliaETH',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

const CONTRACT_ABI = [
  {
    inputs: [{ internalType: 'string', name: '_eventName', type: 'string' }],
    name: 'buyTicket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_id', type: 'uint256' }],
    name: 'getTicket',
    outputs: [
      { internalType: 'string', name: '', type: 'string' },
      { internalType: 'address', name: '', type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'ticketCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'tickets',
    outputs: [
      { internalType: 'uint256', name: 'id', type: 'uint256' },
      { internalType: 'string', name: 'eventName', type: 'string' },
      { internalType: 'address', name: 'owner', type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

function getProvider() {
  if (!window.ethereum) throw new Error('MetaMask is not installed');
  return new BrowserProvider(window.ethereum);
}

async function ensureSepoliaNetwork() {
  if (!window.ethereum) throw new Error('MetaMask is not installed');

  const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (currentChainId === SEPOLIA_CHAIN_ID) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
  } catch (switchError: any) {
    if (switchError?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [SEPOLIA_NETWORK_PARAMS],
      });
      return;
    }

    if (switchError?.code === 4001) {
      throw new Error('Please switch MetaMask to Sepolia to continue.');
    }

    throw switchError;
  }
}

async function getContract(withSigner = false) {
  await ensureSepoliaNetwork();
  const provider = getProvider();
  if (withSigner) {
    const signer = await provider.getSigner();
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }
  return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
}

/**
 * Buy a ticket on-chain. Calls the smart contract's buyTicket function.
 * Returns the on-chain ticket ID (ticketCount after tx).
 */
export async function buyTicketOnChain(eventName: string): Promise<number> {
  const contract = await getContract(true);
  const tx = await contract.buyTicket(eventName);
  await tx.wait(); // wait for confirmation
  const count = await contract.ticketCount();
  return Number(count);
}

/**
 * Get ticket details from the smart contract.
 */
export async function getTicketOnChain(ticketId: number): Promise<{ eventName: string; owner: string }> {
  const contract = await getContract(false);
  const [eventName, owner] = await contract.getTicket(ticketId);
  return { eventName, owner };
}

export async function findExistingTicketOnChain(
  eventName: string,
  walletAddress: string,
  excludedTokenIds: (string | null)[],
): Promise<number> {
  const contract = await getContract(false);
  const ticketCount = Number(await contract.ticketCount());
  const excludedIds = new Set(excludedTokenIds.filter(Boolean).map(Number));
  const maxScan = 500;
  const firstTokenId = Math.max(1, ticketCount - maxScan + 1);

  for (let tokenId = ticketCount; tokenId >= firstTokenId; tokenId--) {
    if (excludedIds.has(tokenId)) continue;

    let onChainTicket: { eventName: string; owner: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [onChainEventName, onChainOwner] = await contract.getTicket(tokenId);
        onChainTicket = {
          eventName: String(onChainEventName),
          owner: String(onChainOwner),
        };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/429|rate.?limit|-32005/i.test(message) || attempt === 2) {
          throw new Error(`Could not check Sepolia ticket #${tokenId}: ${message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }

    if (
      onChainTicket &&
      onChainTicket.eventName.trim().toLowerCase() === eventName.trim().toLowerCase() &&
      onChainTicket.owner.toLowerCase() === walletAddress.toLowerCase()
    ) {
      return tokenId;
    }
  }

  throw new Error('No unlinked Sepolia ticket matching this event and wallet was found in the latest 500 tickets.');
}

export function createTicketLinkMessage(
  userId: string,
  ticketRowId: string,
  eventId: string,
  tokenId: number,
  walletAddress: string,
  timestamp: number,
): string {
  return [
    'Authentix: link an existing Sepolia ticket',
    `user:${userId}`,
    `ticket:${ticketRowId}`,
    `event:${eventId}`,
    `token:${tokenId}`,
    `wallet:${walletAddress.toLowerCase()}`,
    `timestamp:${timestamp}`,
  ].join('\n');
}

export async function signTicketLinkMessage(message: string): Promise<string> {
  await ensureSepoliaNetwork();
  const signer = await getProvider().getSigner();
  return signer.signMessage(message);
}

/**
 * Get total ticket count from the contract.
 */
export async function getTicketCount(): Promise<number> {
  const contract = await getContract(false);
  const count = await contract.ticketCount();
  return Number(count);
}

/**
 * Verify that a wallet owns a specific on-chain ticket.
 */
export async function verifyOwnership(
  tokenId: number,
  walletAddress: string
): Promise<boolean> {
  try {
    const { owner } = await getTicketOnChain(tokenId);
    return owner.toLowerCase() === walletAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Connect to MetaMask wallet
 */
export async function connectWallet(): Promise<string | null> {
  if (!window.ethereum) {
    alert('MetaMask is not installed.');
    return null;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureSepoliaNetwork();
    return accounts[0] || null;
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    return null;
  }
}

/**
 * Get the current connected wallet address
 */
export async function getCurrentWallet(): Promise<string | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts[0] || null;
  } catch {
    return null;
  }
}

export { CONTRACT_ADDRESS };
