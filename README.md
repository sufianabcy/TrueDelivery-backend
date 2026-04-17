# TrueDelivery Backend

Backend API for TrueDelivery, an AI-powered parametric income protection platform for delivery partners.

This service powers onboarding persistence, disruption simulation, auto-claim generation, alerts, and admin summary data.

## Tech Stack

- Node.js
- Express 5
- CORS
- JSON file runtime state (`data/runtime.json`)

## Prerequisites

- Node.js 20+
- npm 10+

## Local Development

Install dependencies:

```bash
npm install
```

Run API server:

```bash
npm run dev
```

Production start command:

```bash
npm start
```

Server defaults to:

- `http://127.0.0.1:8787`

## Environment Variables

- `PORT` (optional): API port, defaults to `8787`
- `CORS_ORIGIN` (optional but recommended in production): comma-separated allowed frontend origins

Example:

```bash
PORT=8787
CORS_ORIGIN=https://your-frontend.vercel.app
```

## API Endpoints

- `GET /api/health`
- `GET /api/bootstrap`
- `PUT /api/worker`
- `POST /api/simulate-disruption`
- `POST /api/reset-demo`

## Deployment (Render)

Recommended service settings:

- Build command: `npm install`
- Start command: `npm start`

Set env vars in Render:

- `PORT` (Render generally injects this)
- `CORS_ORIGIN=https://<your-frontend-domain>`

## Data Persistence Note

Current persistence is file-based (`data/runtime.json`) and best suited for demos.
For production, replace with managed database storage.

## Project Structure

```text
backend/
  data/
    mockData.js
    runtime.json
  lib/
    appConfig.js
  index.js
  store.js
  package.json
```
