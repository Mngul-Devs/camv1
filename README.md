# CamPark v6 (Full Stack Deployment)

## What This Is
CamPark is a snapshot-based parking occupancy platform. Cameras upload images via FTP, the YOLO worker processes them into zone states, the API serves data and admin tools, and the v6 frontend provides the operator UI.

This repository is a clean, deployment-ready snapshot of the full stack:
- v6 frontend UI
- Flask API backend
- YOLO worker
- PostgreSQL database
- FTP ingestion service
- Caddy reverse proxy

## Services Used
- **caddy**: reverse proxy for UI and API
- **api**: Flask admin UI + JSON API
- **worker**: YOLO inference pipeline + zone state updates
- **postgres**: persistence for all system data
- **ftp**: camera snapshot ingestion
- **redis**: optional queue backend (enabled but not required)

## Architecture Overview
1. Camera uploads snapshot to FTP (`/data/ftp/<camera>/incoming`)
2. Worker watches FTP directory and processes images
3. YOLO detections update zone occupancy in PostgreSQL
4. API serves admin UI and JSON endpoints
5. Frontend v6 renders the operator dashboard

## Repo Structure
```
frontend/          # v6 UI (Vite -> static build served by nginx)
services/          # api, worker, ftp, caddy, config
docker-compose.yml # production stack
.env.example       # environment template
```

## Deployment (Production)
1. Copy env:
   ```
   cp .env.example .env
   ```
2. Edit `.env` values for production passwords and hostnames.
3. Start the stack:
   ```
   docker compose up -d --build
   ```

Default endpoints:
- UI: `http://<server-ip>/`
- Admin/API: `http://<server-ip>/admin`
- Health: `http://<server-ip>/health`

Notes:
- YOLO model downloads automatically on first worker run (internet required).
- PostgreSQL data is stored in a Docker volume and persists across restarts.

## Objectives
- Use the v6 frontend as the primary UI
- Keep existing production data safe and intact
- Provide a clean, minimal repo for deployment and maintenance

## Current Plan
- Deploy full stack using Docker Compose
- Validate UI, API, and worker pipeline in production
- Stabilize v6 UX and operational flows

## Future Plan
- Server-side scheduler for API Console automation
- Persisted presets and routing in DB
- System monitoring dashboards and alerting
- Automated backups and TLS hardening

## Safety Notes
- Do not run `docker compose down -v` on production (this deletes the database volume).
- Always back up the DB before major upgrades.
