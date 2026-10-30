# استقرار خودکار BotForge با API

این سند توضیح می‌دهد دکمه «تأیید و استقرار خودکار» در ویزارد چه کاری انجام می‌دهد، چه کلیدهایی لازم است و اگر
دسترسی به API نبود چه گزینه‌هایی دارید. همه درخواست‌های توصیف‌شده در کد `apps/control-plane/src/routes/deploy.ts` و
`apps/control-plane/src/services/deployments.ts` پیاده‌سازی شده‌اند.

## نمای کلی

1. کاربر توکن ربات (تلگرام، بله یا روبیکا) را در ویزارد وارد می‌کند.
2. سایت با `POST /api/deploy/validate-token` توکن را به کنترل‌پلین می‌فرستد.
3. کنترل‌پلین با `getMe` پلتفرم، هویت ربات را تأیید می‌کند.
4. کاربر توکن میزبان (Cloudflare یا Railway) را وارد می‌کند و `POST /api/deploy/validate-provider` حساب را بررسی می‌کند.
5. با تأیید نهایی، ویزارد ابتدا `POST /api/bots` را برای ساخت ربات و سپس `POST /api/bots/:id/deploy` را صدا می‌زند.
6. سرور مراحل استقرار را در پس‌زمینه اجرا می‌کند و سایت با خواندن `GET /api/bots/:id/deployments/:deploymentId`
   پیشرفت را نمایش می‌دهد.

پاسخ آغاز استقرار کد `202` دارد و شامل `deployment.id` و `statusUrl` است.

## گام‌های واقعی استقرار

| گام | Cloudflare Workers | Railway |
| --- | --- | --- |
| `validate` | بررسی توکن و دسترسی‌ها با `GET /accounts` | بررسی توکن با کوئری GraphQL `me` |
| `database` / `project` | ساخت یا انتخاب D1 و اجرای طرح‌واره | ساخت یا انتخاب پروژه |
| `service` | — | ساخت سرویس از ایمیج یا مخزن متصل |
| `upload` / `variables` | `PUT` ماژول ورکر، رمزها، کرون و زیردامنه | تنظیم متغیرهای محیطی سرویس |
| `domain` | آدرس `https://<prefix>-<slug>.<subdomain>.workers.dev` | دامنه تولیدشده Railway |
| `wait` | — | انتظار برای رسیدن استقرار به وضعیت نهایی |
| `webhook` | ثبت آدرس روی پلتفرم پیام‌رسان | همان |
| `health` | درخواست `GET /health` و ثبت کد پاسخ و تأخیر | همان |

وضعیت‌های ممکن: `queued`، `validating`، `provisioning`، `uploading`، `deploying`، `registering`، `healthy`، `failed`.

## کلیدهای لازم

### توکن ربات

- تلگرام: `@BotFather` → `/newbot` → توکن با الگوی `123456789:AA...`
- بله: BotFather داخل بله → ساخت ربات
- روبیکا: BotFather داخل روبیکا → ساخت ربات

### Cloudflare

صفحه ساخت توکن: <https://dash.cloudflare.com/profile/api-tokens>

دسترسی‌های لازم:

- `Workers Scripts:Edit`
- `D1:Edit`
- `Account Settings:Read`

### Railway

صفحه ساخت توکن: <https://railway.com/account/tokens>

توکن Railway به پروژه‌های همان حساب دسترسی دارد. **توکن Railway معادل اتصال GitHub نیست**؛ برای استقرار مستقیم از
مخزن، باید یک بار مخزن را در داشبورد Railway متصل کنید. این عملیات از طریق مرورگر و با توکن API انجام نمی‌شود.

## نمونه درخواست‌ها

```bash
export CONTROL_PLANE="https://your-control-plane.example.com"
export ADMIN_TOKEN="<jwt یا کلید bf_...>"

curl -sS -X POST "$CONTROL_PLANE/api/deploy/validate-token" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"telegram","token":"123456789:AA..."}'

curl -sS -X POST "$CONTROL_PLANE/api/deploy/validate-provider" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"cloudflare","credentials":{"apiToken":"CLOUDFLARE_TOKEN"}}'

curl -sS -X POST "$CONTROL_PLANE/api/bots" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"gold-price","name":"قیمت طلا","slug":"gold-price-1a2b","platform":"telegram","token":"123456789:AA..."}'

curl -sS -X POST "$CONTROL_PLANE/api/bots/BOT_ID/deploy" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"cloudflare","credentials":{"apiToken":"CLOUDFLARE_TOKEN"},"integrationKeys":{}}'

curl -sS "$CONTROL_PLANE/api/bots/BOT_ID/deployments/DEPLOYMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## پیش‌نیاز سمت سرور

- `npm run build` باید انجام شده باشد تا `dist/cloudflare-worker/index.js` وجود داشته باشد.
- متغیر `DEPLOY_WORKER_BUNDLE` مسیر بسته را مشخص می‌کند (پیش‌فرض `dist/cloudflare-worker/index.js`).
- `DEPLOY_TIMEOUT_MS` و `DEPLOY_POLL_INTERVAL_MS` زمان انتظار و فاصله بررسی را کنترل می‌کنند.
- `SECRET_MASTER_KEY` برای رمزنگاری اعتبارنامه‌های ذخیره‌شده الزامی است.

## بسته استقرار دستی

اگر نمی‌خواهید توکن میزبان را به سرور بدهید، می‌توانید:

1. در ویزارد «دانلود نقشه استقرار (JSON)» را بزنید.
2. فایل `.env` و اسکریپت `botforge-deploy-*.sh` را دانلود کنید.
3. همان دو درخواست `POST /api/bots` و `POST /api/bots/:id/deploy` را با curl اجرا کنید.

از مسیر `GET /api/bots/:id/deployments/:id/package` نیز فایل‌های `.env`، `.env.secrets`، `deploy.sh` و `webhook.txt`
دریافت می‌شود؛ این فایل‌ها را محرمانه نگه دارید.

## محدودیت‌های شناخته‌شده

- **GitHub Pages نمی‌تواند کد سمت سرور اجرا کند.** سایت فقط آدرس کنترل‌پلین را ذخیره می‌کند و درخواست‌ها را به آن
  می‌فرستد. بدون کنترل‌پلین، اعتبارسنجی زنده و استقرار خودکار ممکن نیست و ویزارد فقط قالب را بررسی و بسته می‌سازد.
- **پردازش رسانه روی Workers** پشتیبانی نمی‌شود؛ ربات‌های دسته C باید روی Railway مستقر شوند.
- **اتصال مخزن GitHub به Railway** نیاز به تأیید در داشبورد Railway دارد و با توکن API انجام نمی‌شود.
- توکن‌های واردشده در ویزارد فقط در حافظه و `sessionStorage` همان تب می‌مانند و با بستن تب پاک می‌شوند.

## عیب‌یابی سریع

| نشانه | بررسی |
| --- | --- |
| `402` یا خطای اعتبارنامه | دسترسی‌های توکن Cloudflare/Railway را بررسی کنید |
| خطای «بسته ورکر پیدا نشد» | `npm run build` را اجرا و `DEPLOY_WORKER_BUNDLE` را بررسی کنید |
| توقف در `webhook` | آدرس عمومی و HTTPS سرویس را بررسی کنید؛ توکن ربات باید معتبر باشد |
| `health` ناموفق | مسیر `/health` سرویس را با مرورگر باز کنید و لاگ‌های سرویس را ببینید |
| خطای CORS در سایت | دامنه Pages را در `CORS_ORIGINS` اضافه کنید |
