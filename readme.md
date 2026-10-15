npm run build
npx wrangler pages deploy dist --project-name notigram-app

npm run deploy

npm install --no-save @cloudflare/workerd-linux-64
npx wrangler login

PROJECT_URL|SERVICE_ROLE_KEY|NAMA_BUCKET
https://akun1.supabase.co|eyJhbG...kunci1|media,https://akun2.supabase.co|eyJhbG...kunci2|media,https://akun3.supabase.co|eyJhbG...kunci3|media
npx wrangler secret put SUPABASE_CONFIGS