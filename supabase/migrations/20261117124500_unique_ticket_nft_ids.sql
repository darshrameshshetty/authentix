CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_unique_nft_token_id
ON public.tickets (nft_token_id)
WHERE nft_token_id IS NOT NULL;
