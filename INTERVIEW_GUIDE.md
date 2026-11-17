# Authentix — Interview Guide

## 30-second introduction

Authentix is a web-based event ticketing platform built with React, TypeScript, and Vite. Users can discover events, select seats from an event-specific seat map, and book tickets. Supabase provides authentication, PostgreSQL storage, row-level security, and server-side Edge Functions. The app also supports time-limited QR verification, an optional MetaMask/Sepolia blockchain integration, and a streaming AI help assistant.

> In an interview, be clear about which parts you personally designed or implemented and which were contributed by teammates.

## What problem it addresses

Traditional ticketing workflows can make seat availability, ticket validation, and entry control difficult to coordinate. Authentix brings event discovery, seat selection, booking, ticket display, and entry verification into one app. The database remains the main source of truth for bookings; blockchain functionality is an optional additional record.

## Main features

- Browse, search, and view events.
- Select seats using layouts tailored to sports, concerts, and conferences.
- Choose from Standard (base price), Premium (+30%), and VIP (+50%) seat tiers.
- Book up to five seats in one booking.
- Sign up and sign in with Supabase Auth; the project also supports Google OAuth.
- View tickets and their rotating QR codes.
- Connect MetaMask and optionally record tickets on Ethereum Sepolia.
- Provide admin event and ticket management.
- Ask the integrated AI assistant questions; responses stream into the UI.
- Switch between light and dark themes.

## Technology stack

| Area | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 |
| UI and styling | Tailwind CSS, shadcn/ui, Radix UI, Framer Motion, Lucide |
| Routing and data | React Router, TanStack Query |
| Authentication and database | Supabase Auth, PostgreSQL, Row-Level Security |
| Server-side operations | Supabase Edge Functions (Deno) and PostgreSQL RPC functions |
| Blockchain | Solidity, ethers.js, MetaMask, Ethereum Sepolia |
| QR codes | `qrcode.react`; server-generated HMAC-SHA256 tokens |
| AI assistant | Supabase Edge Function, Lovable AI Gateway, Gemini, streamed responses |
| Hosting | Vercel for the Vite frontend; Supabase hosts backend services |

## High-level architecture

```text
Browser (React SPA)
  ├─ Supabase client ── Auth, PostgreSQL (RLS), RPCs, Edge Functions
  ├─ MetaMask + ethers.js ── Sepolia contract (optional)
  └─ Chat UI ── Supabase chat function ── Lovable AI Gateway

Vercel hosts the built frontend. Supabase hosts the database, authentication,
Edge Functions, and SQL RPC functions.
```

The browser uses the Supabase publishable key to identify the project. Authorization is enforced by user sessions, database policies, and server-side checks; the browser must not receive the service-role key.

## Key workflows

### Booking a ticket

1. The user views an event and the app loads its details and booked seats.
2. The user chooses a quantity and seats. Pricing is calculated from the selected seat tiers.
3. The user signs in. If they choose blockchain minting and have connected MetaMask, the app requests a transaction on Sepolia.
4. The frontend calls the `book-ticket` Edge Function with the event, seat, and optional wallet/token details.
5. The function validates the user's Supabase session and calls the `book_ticket` database RPC.
6. The RPC locks the event row, checks availability, decreases the available-seat count, and creates a ticket record. A unique database index on `(event_id, seat_number)` protects against two users booking the same seat.
7. The ticket appears in the user's My Tickets page.

### QR verification

1. An authenticated ticket owner requests a QR token.
2. The `generate-qr-token` function checks ticket ownership and whether it has already been used.
3. The server signs a ticket identifier and 30-second time window with HMAC-SHA256.
4. The QR refreshes periodically. The verifier sends the token to `verify-ticket`, which checks its signature and expiry and looks up the ticket.
5. An authorized entry action can mark the ticket as used.

### Blockchain connection

- The user connects their own MetaMask wallet; the app asks the wallet to use Sepolia.
- With a connected wallet, the app calls the configured contract and stores the resulting on-chain ticket identifier alongside the database ticket.
- Without a wallet, the user can still book using the database-backed ticket flow.
- The current Solidity contract is a minimal custom ticket registry. It stores a ticket ID, event name, and owner address; it is **not a full ERC-721 implementation** (for example, it does not implement standard NFT transfer or metadata methods). Describe it accurately as an on-chain ticket record/prototype rather than claiming standards-compliant NFTs.

### AI assistant

The chat Edge Function keeps the Lovable API credential on the server, sends the conversation to the Gemini model through the Lovable AI Gateway, and returns a streamed response. The frontend reads the stream and progressively renders the assistant's text.

## Database concepts

| Table / function | Purpose |
|---|---|
| `events` | Event details, dates, prices, capacity, and available seats |
| `tickets` | Ticket owner, event, seat, use status, and optional wallet/token references |
| `profiles` | User profile and wallet information linked to Supabase Auth |
| `user_roles` | Separate `admin` / `user` roles |
| `has_role(...)` | Database function used to check a user's role |
| `book_ticket(...)` | Transaction-safe booking operation that decrements availability and creates a ticket |
| `get_booked_seats(...)` | Returns booked seat identifiers without exposing other ticket-owner details |

Row-Level Security is enabled for the main tables. Admin authorization is represented in `user_roles`, rather than trusting a role value supplied by the browser.

## Environment variables and keys

### Frontend variables

These are configured in the local `.env` file and in Vercel's project environment settings:

| Variable | Purpose | Safe to expose in the browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | URL of the Supabase project | Yes; it identifies the project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public client key used by the Supabase browser client | Yes, when database access is protected by RLS and server-side authorization |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project identifier present in the project configuration | It is an identifier, not a secret; the current frontend source does not directly read it |

Vite embeds variables prefixed with `VITE_` into client-side assets. **Never put a password, private API key, or Supabase service-role key in a `VITE_` variable.** Keep `.env` out of Git.

### Supabase Edge Function secrets

These belong in Supabase's server-side function environment, not in the frontend or Vercel `VITE_` variables:

- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_ANON_KEY` — used by functions when validating a user's session.
- `SUPABASE_SERVICE_ROLE_KEY` — privileged server-side database access; must remain secret.
- `LOVABLE_API_KEY` — credentials for the AI Gateway, used only by the chat function.

The QR functions currently use the service-role key as the HMAC signing key. A production hardening step would use a dedicated, separately rotatable QR signing secret instead.

### Other blockchain configuration

The Sepolia chain ID and contract address are configured in the blockchain service source, rather than as Vercel environment variables. Before a live demo, confirm that the configured address and ABI match the deployed contract.

## Security and reliability decisions

- **RLS:** Database policies restrict users to permitted records and operations.
- **Server-side authorization:** Edge Functions validate the Supabase user session; privileged operations use server-only credentials.
- **Seat uniqueness:** The booking RPC locks the event row while decrementing availability, and a unique index provides an additional guard against duplicate event-seat bookings.
- **QR expiry:** Short-lived HMAC tokens reduce the usefulness of copied screenshots.
- **Role separation:** Admin/user roles are stored separately and checked through database/server-side logic.
- **Wallet custody:** MetaMask signs transactions from the user's wallet; the app does not custody a user's private key.

## Trade-offs and improvements to discuss

These are useful interview talking points; distinguish existing behavior from proposed improvements.

1. **Database and blockchain are separate systems.** In the current booking flow, an on-chain transaction can complete before the database booking fails. That could leave an on-chain record without a matching app booking. A stronger design would reserve the seat first, use an idempotent booking state machine, and add reconciliation or compensating actions.
2. **The QR signing key should be separate.** Use a dedicated high-entropy secret, rotate it independently, and compare signatures in constant time.
3. **Entry checks should be atomic.** Checking a ticket and marking it used should be combined in a transaction/RPC so two scanners cannot both admit the same ticket at once.
4. **Contract scope should be explicit.** If the product requires transferable, standards-compatible NFTs, implement and test ERC-721 (or another suitable standard), including metadata and ownership handling.
5. **Validate deployment configuration.** Keep frontend and Supabase function configuration separate, and verify the configured contract address and network before a production demo.

## Interview questions and sample answers

### “How do you prevent double-booking?”

“The UI shows the current booked seats, but I don't rely on that for correctness because two users can act at the same time. The booking Edge Function validates the user and calls a database RPC. The RPC locks the event row while checking and decrementing availability, and a unique index on event and seat is a second line of defense.”

### “Why use Supabase?”

“It gives the project managed PostgreSQL, authentication, row-level security, and serverless Edge Functions in one backend. That let us focus on the product while still keeping privileged booking and verification logic server-side.”

### “How does the QR code help prevent replay?”

“The server signs the ticket identifier and a short time window using HMAC-SHA256. The verifier checks the signature and expiry on the server and checks ticket state. Short expiry limits how long a copied code remains useful. I would further harden this by using a dedicated QR secret and making the consume/mark-used operation atomic.”

### “Why is blockchain optional?”

“The database-backed ticket flow is enough for users who do not have a wallet. For users who opt in, MetaMask signs a Sepolia transaction. That avoids making wallet setup and test-network gas a requirement for using the core app.”

### “What is one difficult engineering trade-off?”

“A booking touches both PostgreSQL and an external blockchain, and they cannot share one transaction. The current flow can mint on-chain before the database booking completes. A production version should model booking states explicitly and add idempotency and reconciliation so failures across the two systems are handled safely.”

### “What would you improve next?”

“I would make QR check-and-consume atomic, separate the QR signing secret from the Supabase service-role key, and upgrade the contract if standard NFT behavior is a requirement. I would also add end-to-end tests for concurrent bookings and scanner retries.”

## Running and validating locally

Prerequisites: Node.js 20+ and a configured Supabase project.

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
```

Vercel builds the Vite frontend with `npm run build` and serves the `dist` output. The repository's `vercel.json` rewrites routes to `index.html` for React Router. Supabase database migrations and Edge Functions are backend deployments and are not deployed by Vercel.

## Demo checklist

- Confirm the deployed frontend has the correct Supabase URL and publishable key.
- Confirm the Supabase project has the required schema, RLS policies, RPCs, and Edge Functions deployed.
- Test signup/sign-in, event browsing, seat selection, booking, and My Tickets.
- For the optional blockchain demo, connect MetaMask on Sepolia and ensure the wallet has test ETH.
- Verify a live QR, then test the already-used/expired behavior.
- Confirm admin access is assigned through the backend role table, not by a client-side toggle.
- Be ready to explain your own contributions and the prototype limitations above.
