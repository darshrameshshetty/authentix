import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Contract, JsonRpcProvider, isAddress, verifyMessage } from "https://esm.sh/ethers@6.16.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const contractAddress = "0x0f427d1e17A1C7D74d3604F4762e551AC1982e6D";
const contractAbi = [
  "function getTicket(uint256 _id) view returns (string, address)",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createLinkMessage(
  userId: string,
  ticketRowId: string,
  eventId: string,
  tokenId: string,
  walletAddress: string,
  timestamp: number,
) {
  return [
    "Authentix: link an existing Sepolia ticket",
    `user:${userId}`,
    `ticket:${ticketRowId}`,
    `event:${eventId}`,
    `token:${tokenId}`,
    `wallet:${walletAddress.toLowerCase()}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const { ticketRowId, tokenId, walletAddress, signature, timestamp } = await req.json();
    if (
      typeof ticketRowId !== "string" ||
      typeof tokenId !== "string" ||
      !/^[1-9]\d{0,77}$/.test(tokenId) ||
      typeof walletAddress !== "string" ||
      !isAddress(walletAddress) ||
      typeof signature !== "string" ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > 5 * 60 * 1000
    ) {
      return jsonResponse({ error: "Invalid or expired link request." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: ticket, error: ticketError } = await adminClient
      .from("tickets")
      .select("id, event_id, user_id, nft_token_id, events(title)")
      .eq("id", ticketRowId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (ticketError) throw ticketError;
    if (!ticket) return jsonResponse({ error: "Ticket not found for this account." }, 404);
    if (ticket.nft_token_id) {
      if (String(ticket.nft_token_id) === tokenId) {
        return jsonResponse({ linked: true, tokenId, alreadyLinked: true });
      }
      return jsonResponse({ error: "This app ticket is already linked to an NFT." }, 409);
    }

    const eventRelation = Array.isArray(ticket.events) ? ticket.events[0] : ticket.events;
    const eventTitle = eventRelation?.title;
    if (!eventTitle) return jsonResponse({ error: "Ticket event was not found." }, 404);

    let signerAddress: string;
    try {
      signerAddress = verifyMessage(
        createLinkMessage(user.id, ticket.id, ticket.event_id, tokenId, walletAddress, timestamp),
        signature,
      );
    } catch {
      return jsonResponse({ error: "Wallet signature is invalid." }, 401);
    }
    if (signerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return jsonResponse({ error: "Wallet signature does not match the connected wallet." }, 401);
    }

    const { data: existingLink, error: existingLinkError } = await adminClient
      .from("tickets")
      .select("id")
      .eq("nft_token_id", tokenId)
      .maybeSingle();

    if (existingLinkError) throw existingLinkError;
    if (existingLink && existingLink.id !== ticketRowId) {
      return jsonResponse({ error: "This on-chain ticket is already linked to an app ticket." }, 409);
    }

    const rpcUrl = Deno.env.get("SEPOLIA_RPC_URL") || "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new JsonRpcProvider(rpcUrl, 11155111);
    const contract = new Contract(contractAddress, contractAbi, provider);
    const [onChainEvent, onChainOwner] = await contract.getTicket(BigInt(tokenId));

    if (String(onChainEvent).trim().toLowerCase() !== eventTitle.trim().toLowerCase()) {
      return jsonResponse({ error: "The on-chain ticket is for a different event." }, 409);
    }
    if (String(onChainOwner).toLowerCase() !== walletAddress.toLowerCase()) {
      return jsonResponse({ error: "The connected wallet does not own this on-chain ticket." }, 403);
    }

    const { data: updatedTicket, error: updateError } = await adminClient
      .from("tickets")
      .update({ nft_token_id: tokenId, wallet_address: walletAddress })
      .eq("id", ticketRowId)
      .eq("user_id", user.id)
      .is("nft_token_id", null)
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedTicket) {
      return jsonResponse({ error: "Ticket changed while linking. Refresh and try again." }, 409);
    }

    return jsonResponse({ linked: true, tokenId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
