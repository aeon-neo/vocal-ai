# VocalAI Deployment Guide

This guide covers deploying VocalAI with the backend on Render.com and the frontend on Vercel.

## Architecture

- **Backend**: Node.js WebSocket server on Render.com
- **Frontend**: Static HTML/JS on Vercel
- **Database**: PostgreSQL (Render.com or external provider)
- **Communication**: WebSocket (Socket.IO) between frontend and backend

## Prerequisites

1. GitHub account with VocalAI repository
2. Render.com account
3. Vercel account
4. OpenAI API key
5. Hume API key (optional, for voice features)

## Step 1: Set Up PostgreSQL Database

### Option A: Use Existing PostgreSQL Server (Recommended)

If you already have a PostgreSQL server on Render, just create a new database:

1. **Connect to your existing PostgreSQL server**:
   ```bash
   # Get connection details from Render Dashboard > Your PostgreSQL > Connection Info
   psql -h <your-host>.render.com -U <your-user> -d postgres
   ```

2. **Create new database for VocalAI**:
   ```sql
   CREATE DATABASE vocal_ai_db;
   \c vocal_ai_db
   CREATE EXTENSION IF NOT EXISTS vector;
   \q
   ```

3. **Install VocalAI schema**:
   ```bash
   # From your local machine (with database/install.sql file)
   psql -h <your-host>.render.com -U <your-user> -d vocal_ai_db < database/install.sql
   ```

4. **Note your connection details** (you'll need these for environment variables):
   - Host: `<your-host>.render.com`
   - Port: `5432`
   - Database: `vocal_ai_db`
   - User: `<your-existing-user>`
   - Password: `<your-existing-password>`

### Option B: Create New PostgreSQL Database

If you want a separate PostgreSQL instance:

1. **Create PostgreSQL Database**:
   - Go to Render Dashboard > New > PostgreSQL
   - Name: `vocalai-db`
   - Plan: Free or Starter
   - Copy the Internal Database URL after creation

2. **Connect to Database and Install Schema**:
   ```bash
   # Get connection string from Render dashboard
   psql <INTERNAL_DATABASE_URL>

   # Create pgvector extension
   CREATE EXTENSION IF NOT EXISTS vector;

   # Exit and run schema installation
   psql <INTERNAL_DATABASE_URL> < database/install.sql
   ```

## Step 2: Deploy Backend Web Service to Render.com

### Using Render Dashboard

1. **Create Web Service**:
   - Go to Render Dashboard > New > Web Service
   - Connect your GitHub repository
   - Configuration:
     - **Name**: `vocalai-backend`
     - **Runtime**: Node
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm run video-server`
     - **Instance Type**: Free or Starter

2. **Set Environment Variables**:
   In Render Dashboard > Environment:
   ```
   OPENAI_API_KEY=sk-...
   HUME_API_KEY=... (optional)
   POSTGRES_HOST=<your-existing-host>.render.com
   POSTGRES_PORT=5432
   POSTGRES_DB=vocal_ai_db
   POSTGRES_USER=<your-existing-user>
   POSTGRES_PASSWORD=<your-existing-password>
   WHISPER_PROVIDER=openai
   CORS_ORIGIN=https://your-app.vercel.app
   ```

3. **Deploy**:
   - Click "Create Web Service"
   - Wait for deployment to complete
   - Note your backend URL: `https://vocalai-backend.onrender.com`

### Option B: Using render.yaml

1. Update `render.yaml` with your Vercel frontend URL
2. Push to GitHub
3. In Render Dashboard > New > Blueprint
4. Connect repository and select `render.yaml`
5. Add environment variables (they're marked as `sync: false`)

## Step 3: Ingest RAG Documents

After backend is deployed, you need to populate the knowledge base:

1. **Connect to your Render backend**:
   ```bash
   # SSH into Render shell (if available) or run locally with production DB
   export POSTGRES_HOST=<render-db-host>
   export POSTGRES_PORT=5432
   export POSTGRES_DB=<render-db-name>
   export POSTGRES_USER=<render-db-user>
   export POSTGRES_PASSWORD=<render-db-password>
   export OPENAI_API_KEY=sk-...
   ```

2. **Run RAG pipeline**:
   ```bash
   # Ingest specimen papers
   npm run ingest-pdfs specimen-papers pdfs/specimen-papers
   npm run seed-database specimen-papers
   npm run chunk specimen-papers
   npm run vectorize specimen-papers -- --analyze-docs

   # Ingest syllabus/marking schemes
   npm run ingest-pdfs syllabus pdfs/syllabus
   npm run seed-database syllabus
   npm run chunk syllabus
   npm run vectorize syllabus -- --analyze-docs
   ```

## Step 4: Deploy Frontend to Vercel

### Option A: Using Vercel Dashboard

1. **Go to Vercel Dashboard** > Add New > Project
2. **Import Git Repository** > Select VocalAI repo
3. **Configure Project**:
   - **Framework Preset**: Other
   - **Root Directory**: ./
   - **Build Command**: Leave empty
   - **Output Directory**: public
   - **Install Command**: Leave empty

4. **Update config.js**:
   Before deploying, update `public/config.js`:
   ```javascript
   window.VOCALAI_BACKEND_URL = "https://vocalai-backend.onrender.com";
   ```

5. **Deploy**:
   - Click "Deploy"
   - Wait for deployment
   - Note your frontend URL: `https://your-app.vercel.app`

### Option B: Using Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Update config.js with your Render backend URL
# Edit public/config.js

# Deploy
vercel --prod
```

## Step 5: Update CORS Configuration

1. Go back to Render Dashboard > vocalai-backend > Environment
2. Update `CORS_ORIGIN` to match your Vercel URL:
   ```
   CORS_ORIGIN=https://your-app.vercel.app
   ```
3. Save and redeploy backend

## Step 6: Test Deployment

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Check browser console for connection status
3. Enable camera/microphone
4. Select voice preference
5. Click start button
6. Test the examination flow

## Troubleshooting

### WebSocket Connection Failed

**Issue**: Frontend can't connect to backend WebSocket

**Solutions**:
1. Check `public/config.js` has correct Render URL
2. Verify CORS_ORIGIN in Render environment variables
3. Check Render backend logs for errors
4. Ensure Render service is running (not sleeping)

### Database Connection Failed

**Issue**: Backend can't connect to PostgreSQL

**Solutions**:
1. Verify all POSTGRES_* environment variables
2. Use Internal Database URL from Render (not external)
3. Check pgvector extension is installed:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```

### RAG Queries Return No Results

**Issue**: Examiner can't find relevant scenarios

**Solutions**:
1. Verify RAG pipeline completed successfully
2. Check knowledge_documents table has data:
   ```sql
   SELECT COUNT(*) FROM knowledge_documents;
   SELECT COUNT(*) FROM knowledge_embeddings;
   ```
3. Re-run vectorization if needed

### Voice Features Not Working

**Issue**: TTS or transcription fails

**Solutions**:
1. Check HUME_API_KEY is set (for TTS)
2. Check OPENAI_API_KEY is set (for Whisper)
3. Verify WHISPER_PROVIDER is set to "openai"
4. Check Render logs for API errors

### Render Free Tier Sleep

**Issue**: Backend goes to sleep after 15 minutes of inactivity

**Solutions**:
1. Upgrade to Render Starter plan ($7/month)
2. Use a service like UptimeRobot to ping your backend
3. Add a keep-alive route and ping it periodically

## Production Optimizations

### 1. Environment-Specific Config

Create separate config files for development/production:

```javascript
// public/config.production.js
window.VOCALAI_BACKEND_URL = "https://vocalai-backend.onrender.com";

// public/config.development.js
window.VOCALAI_BACKEND_URL = "http://localhost:5443";
```

### 2. WebSocket Reconnection

The frontend already has reconnection logic, but you can tune it:
- Check `socket.on("disconnect")` handler in video-chat.html
- Add exponential backoff if needed

### 3. Database Connection Pooling

Already configured in `storage.ts`:
- Default pool size: 10 connections
- Adjust via POSTGRES_POOL_SIZE environment variable

### 4. Video Frame Throttling

Already throttled to 1 frame per 10 seconds:
- Configured in `frame-processor.ts`
- Reduces API costs for emotion detection

## Cost Estimates

### Render.com (Backend)
- **Free Tier**: $0/month (backend sleeps after 15min, 750 hours/month)
- **Starter**: $7/month (backend always on)

### PostgreSQL (if creating new instance)
- **Free Tier**: $0/month (1GB storage, expires after 90 days)
- **Starter**: $7/month (10GB storage, persistent)
- **Note**: If using existing PostgreSQL server, no additional cost

### Vercel (Frontend)
- **Hobby**: $0/month (unlimited static sites)
- **Pro**: $20/month (if you need more bandwidth)

### OpenAI API
- **Whisper**: ~$0.006 per minute of audio
- **GPT-4o**: ~$0.015 per 1K tokens (Cortex)
- **GPT-4o-mini**: ~$0.0006 per 1K tokens (Insula, Logic, ExamPrep)

### Hume AI (Optional Voice)
- **Free Tier**: 1,000 API calls/month
- **Paid**: $0.05 per TTS request, $0.01 per prosody analysis

**Estimated Monthly Cost** (100 exams @ 10 min each):
- Render Backend: $7/month (Starter tier)
- PostgreSQL: $0/month (using existing server)
- Vercel: $0/month (Hobby tier)
- OpenAI: ~$15/month (Whisper + GPT)
- Hume: ~$10/month (TTS + Prosody)
- **Total**: ~$32/month (with existing PostgreSQL)
- **Total**: ~$39/month (with new PostgreSQL Starter)

## Security Checklist

- [ ] Update CORS_ORIGIN to specific Vercel domain (not *)
- [ ] Use environment variables for all secrets
- [ ] Enable HTTPS only (Render and Vercel do this by default)
- [ ] Set up rate limiting if needed
- [ ] Review database access permissions
- [ ] Monitor API usage and costs
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Back up database regularly

## Support

For deployment issues:
- Render Docs: https://render.com/docs
- Vercel Docs: https://vercel.com/docs
- Project Issues: https://github.com/your-repo/issues
