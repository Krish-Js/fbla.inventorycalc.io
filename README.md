# FBLA Snack Budget Website

Responsive snack-business budget dashboard with editable inventory, point-sales calculator, built-in budgeting assistant, and product-page URL import.

## What's implemented
- Dashboard totals update as inventory changes.
- Editable inventory table with add/reset controls.
- Point calculator for students, points purchased, price per point, and estimated cost per point.
- Built-in deterministic budgeting assistant for common revenue, expense, and inventory questions.
- **Product URL import:** paste a public product page URL; the backend tries to extract product title, page price, and package count from JSON-LD and common page metadata/text. Review all extracted fields before adding the item.
- Supabase authentication UI can be configured separately.

## Run/deploy
This app uses a serverless API endpoint, so deploy to a platform that supports Node serverless functions, such as Vercel. Do not just open `index.html` as a local file if you want URL extraction to work.

1. Create a GitHub repository and upload `index.html`, `api/extract-product.js`, `package.json`, `config.example.js`, and this README.
2. Import the repository into Vercel and deploy.
3. The URL extractor will be available at `/api/extract-product`.

## Product URL import limitations
Extraction is best-effort. It works most reliably on public product pages that publish structured Product JSON-LD or common metadata. Retailers may block automated requests, require sign-in, render prices in client-side JavaScript, or omit the multipack count. The form displays a review step, and all fields remain editable. If extraction fails, use the manual **+ Add snack** button.

The extracted website price is assumed to be the pack price only as a starting point. Always confirm that it represents the full pack, not one unit, a sale price with membership, or a different variant. The suggested selling price is left for the team to set rather than guessed.

## Secure authorized access
The login UI in this starter is **not active security until configured**. For actual protection:
1. Create a Supabase project and enable Auth.
2. Copy `config.example.js` to `config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
3. Add/invite only authorized FBLA users and disable public sign-ups after invites, or enforce an admin approval process.
4. Add database Row Level Security (RLS) policies for any stored business data. Client-side login alone does not protect a static file or data embedded in it.
5. For confidential financial records, use authenticated server-side/database access. Do not put an AI provider secret key in frontend code.

## Real AI integration
The included assistant uses deterministic rules for predictable calculations; it does not call a large language model. For open-ended AI answers, add an authenticated serverless endpoint that calls the AI provider using a server-only environment secret.

## Financial assumptions
- Initial inventory uses the provided pack costs, quantities, and sell prices.
- Unit cost is calculated as pack cost / pack quantity.
- One pack of every listed product costs **$316.82**.
- Selling every unit at the stated price yields **$751.00** in revenue and **$434.18** in gross profit before taxes, waste, payment fees, or other overhead.
- The point calculator defaults to 30 students, 10 points each, $1 charged per point, and $0.45 estimated cost per redeemed point: $300 revenue, $135 estimated expenses, $165 gross profit.
- The supplied $315.95 inventory total and $700 revenue example conflict with the listed inputs, so the dashboard calculates from the itemized table.
