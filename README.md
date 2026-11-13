# AutoBid AI Auctions

Car auction platform with AI (Groq), Razorpay payments, and live Node backend.

## Deploy on Render

1. Push this folder to GitHub (keep folder structure).
2. New Web Service on Render → connect repo.
3. Settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
4. Environment variables:
   - `GROQ_API_KEY` (required for AI)
   - Razorpay keys (optional for payments)
5. Deploy.

Do NOT set `NODE_ENV=production` in Environment Variables (the start script already sets it).

## Local

```bash
npm install
cp .env.example .env
# add GROQ_API_KEY
npm run dev
```
