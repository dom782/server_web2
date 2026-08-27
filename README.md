# Cammarano Railway Service

Backend FastAPI + Web/PWA + WebSocket broker + PostgreSQL cache/transport for the Cammarano Local Agent.

## Endpoints expected by the Local Agent
- `POST /api/agent/auth`
- `WSS /ws/agent`

## Railway variables
Required:
- `APP_ENV=production`
- `APP_ORIGIN=https://<your-domain>.up.railway.app`
- `SESSION_SECRET=<long random secret>`
- `AGENT_DEVICE_ID=cammarano-local-agent-01`
- `AGENT_DEVICE_SECRET=<same secret configured on the Ubuntu Local Agent>`
- `AGENT_TOKEN_TTL_SECONDS=900`
- `SESSION_TTL_SECONDS=28800`
- `AGENT_REQUEST_TIMEOUT_SECONDS=20`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`

Optional Web Push:
- `VAPID_PRIVATE_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT=mailto:<your email>`

## Local Agent configuration after Railway deploy
```
RAILWAY_AUTH_URL=https://<your-domain>.up.railway.app/api/agent/auth
RAILWAY_WS_URL=wss://<your-domain>.up.railway.app/ws/agent
RAILWAY_DEVICE_ID=cammarano-local-agent-01
```
Put the exact Railway `AGENT_DEVICE_SECRET` value in the Local Agent file:
`secrets/railway_device_secret.txt`

Then restart the Local Agent:
```
sudo docker compose down
sudo docker compose up -d
sudo docker compose logs -f --tail=100
```

For the full deployment procedure see `DEPLOY_RAILWAY.md`.
