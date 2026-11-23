# Cloud Deployment Guide (0 Kč – MongoDB Atlas M0 + Render.com)

This guide deploys the **BIOT NestJS Backend** to **Render.com** backed by **MongoDB Atlas (Free M0)**, and connects your local **IoT Gateway (`BR-001`) + IoT Node (`UZ-001`)** directly to the live cloud URL over HTTPS.

---

## Step 1: Create Free MongoDB Atlas M0 Cluster

1. Sign up or log in at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a new cluster using the **M0 Free** tier (AWS / Europe `eu-central-1` Frankfurt recommended).
3. Under **Database Access**:
   - Create a database user (e.g., `biot_user`) with **Read and write to any database** role and save the password.
4. Under **Network Access**:
   - Click **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) so Render's dynamic outbound IPs can connect.
5. Click **Connect → Drivers → Node.js** and copy the connection string. Add the database name `biot_inventory` before `?`:
   ```text
   mongodb+srv://biot_user:<PASSWORD>@cluster0.xxxxx.mongodb.net/biot_inventory?retryWrites=true&w=majority
   ```

---

## Step 2: Deploy Backend to Render.com (Blueprint)

1. Sign up or log in at [render.com](https://render.com) with your GitHub account.
2. Click **New + → Blueprint** (or **New + → Web Service**).
3. Connect the GitHub repository `templarjakub/uun-iot-inventory-monitoring` (`main` branch).
   - Render automatically detects [`render.yaml`](./render.yaml):
     - **Build Command**: `npm ci --include=dev && npm run build`
     - **Start Command**: `npm run start:prod`
     - **Health Check Path**: `/health`
     - **Auto-seed**: `SEED_ON_EMPTY=true` populates `PRD-001..003`, `BR-001`, `UZ-001`, `VM-001..002` automatically on first boot against an empty MongoDB database.
4. When prompted for the unsynced secret `MONGODB_URI`, paste your MongoDB Atlas connection string from Step 1.
5. Click **Apply / Deploy** and wait ~2 minutes for the build to complete.

---

## Step 3: Verify Cloud Backend

Replace `<your-service>` with your Render URL (e.g., `https://biot-inventory-backend.onrender.com`):

1. **Health check**: Open `https://<your-service>.onrender.com/health`
   - Expected response:
     ```json
     {
       "status": "ok",
       "service": "biot-inventory-backend",
       "storage": "mongodb",
       "connected": true
     }
     ```
2. **Swagger UI**: Open `https://<your-service>.onrender.com/docs` and test `GET /stockOverview/load`.

---

## Step 4: Connect Local IoT Node (`UZ-001`) + Gateway (`BR-001`) to the Cloud

From `iot/` on your machine (or Raspberry Pi):

```powershell
# Run the scripted end-to-end demo against the live cloud backend (auto-wakes Render free tier)
.\.venv\Scripts\python run_demo.py --backend-url https://<your-service>.onrender.com

# Or run interactive live presentation mode while viewing Swagger UI in your browser
.\.venv\Scripts\python run_demo.py --backend-url https://<your-service>.onrender.com --interactive
```

Or run the standalone Gateway pointing at the cloud backend:

```powershell
.\.venv\Scripts\python -m broker.local_broker --port 1883
.\.venv\Scripts\python -m gateway.iot_gateway --gateway-id BR-001 --backend-url https://<your-service>.onrender.com --backend-timeout 20
.\.venv\Scripts\python -m node.iot_node --node-id UZ-001 --interval 5.0
```

> **Note on Render Free Tier cold starts**: Render spins down free web services after 15 minutes of inactivity (~30–50s wake-up on the first request). If a request times out during wake-up, `BR-001` safely retains the measurement in its local SQLite queue and retries idempotently until acknowledged.
