# Dejoiy OrbitDesk — Deployment Guide

## Environment Variables Required

Set these before deploying to any platform:

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/orbitdesk` |
| `SESSION_SECRET` | Secret for JWT signing (min 32 chars) | `your-super-secret-key-min-32-chars` |
| `PORT` | API server port (optional, defaults to 8080) | `8080` |
| `NODE_ENV` | Environment | `production` |

---

## Option 1: Vercel (Frontend) + Render/Railway (API)

### API Server (Render, Railway, Fly.io, or any Node host)
1. Deploy `artifacts/api-server` as a Node.js service
2. Set environment variables above
3. Build command: `pnpm install && pnpm --filter @workspace/api-server run build`
4. Start command: `node artifacts/api-server/dist/index.js`

### Frontend (Vercel)
1. Connect your GitHub repo to Vercel
2. Set **Root Directory** to `artifacts/orbitdesk`
3. Set **Build Command** to `pnpm run build`
4. Set **Output Directory** to `dist`
5. Add env var: `VITE_API_URL=https://your-api-server.railway.app`

---

## Option 2: Docker (AWS ECS, Google Cloud Run, Hostinger VPS)

```bash
# Build the image
docker build -t dejoiy-orbitdesk .

# Run with environment variables
docker run -d \
  -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  -e SESSION_SECRET="your-secret" \
  -e NODE_ENV=production \
  dejoiy-orbitdesk
```

### AWS ECS
1. Push image to ECR: `aws ecr get-login-password | docker login --username AWS --password-stdin <ecr-url>`
2. Tag and push: `docker tag dejoiy-orbitdesk:latest <ecr-url>/dejoiy-orbitdesk:latest && docker push`
3. Create ECS task definition pointing to your ECR image
4. Set environment variables in the task definition
5. Attach an RDS PostgreSQL instance for `DATABASE_URL`

### Hostinger VPS (Ubuntu)
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone your repo
git clone https://github.com/your-org/orbitdesk.git
cd orbitdesk

# Create .env file
cat > .env << EOF
DATABASE_URL=postgresql://user:pass@localhost:5432/orbitdesk
SESSION_SECRET=your-super-secret-key-at-least-32-characters
NODE_ENV=production
PORT=8080
EOF

# Build and run
docker build -t orbitdesk .
docker run -d --env-file .env -p 8080:8080 --restart always orbitdesk

# Set up nginx reverse proxy
apt install nginx -y
# Configure nginx to proxy port 80 → 8080
```

---

## Option 3: Traditional Node.js (PM2 on VPS)

```bash
# Install dependencies
npm install -g pnpm pm2

# Clone and install
git clone https://github.com/your-org/orbitdesk.git && cd orbitdesk
pnpm install

# Build
pnpm --filter @workspace/orbitdesk run build
pnpm --filter @workspace/api-server run build

# Set environment variables
export DATABASE_URL="postgresql://..."
export SESSION_SECRET="your-secret"
export NODE_ENV=production

# Start with PM2
pm2 start artifacts/api-server/dist/index.js --name orbitdesk-api
pm2 save
pm2 startup

# Serve frontend with nginx from artifacts/orbitdesk/dist/
```

---

## Database Setup

Run these on first deployment to create an admin account:

```sql
-- Insert super admin (password: change this in production!)
INSERT INTO users (name, email, password_hash, role, is_active)
VALUES (
  'Deepak Sharma',
  'deepak.sharma@dejoiy.com',
  encode(sha256(('Jaymaakaali@321' || 'orbitdesk_salt')::bytea), 'hex'),
  'super_admin',
  true
) ON CONFLICT (email) DO NOTHING;
```

Or use the existing credentials if migrating from Replit:
- **Email:** `deepak.sharma@dejoiy.com`
- **Password:** `Jaymaakaali@321`

---

## Email-to-Ticket Configuration

After deployment, go to **Settings → Email Notifications** to configure:
1. SMTP settings for outbound notifications
2. IMAP settings for email-to-ticket (configure your inbound mailbox)
3. Go to **Automation Rules** to set routing rules for incoming emails

---

## NGINX Configuration (for single-server setup)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend (static files)
    root /var/www/orbitdesk/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
