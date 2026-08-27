# Deploy su Railway

## 1. Crea il progetto
Crea un nuovo progetto Railway e aggiungi un database PostgreSQL con **+ New → Database → PostgreSQL**.
Il database deve restare privato: non serve Public Access/TCP Proxy.

## 2. Pubblica il codice
Metodo consigliato: estrai questo ZIP, crea un repository GitHub privato e carica il contenuto della cartella `cammarano-railway` nella root del repository. In Railway scegli **Deploy from GitHub repo**.
Alternativa: usa Railway CLI dalla cartella del progetto con `railway init` e `railway up`.

## 3. Collega PostgreSQL
Nel servizio FastAPI → Variables aggiungi:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Se il servizio database ha un nome diverso da `Postgres`, usa quel nome nel riferimento.

## 4. Crea i secret
Sul tuo PC puoi generare due secret con:

```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Esegui il comando due volte. Il primo sarà `SESSION_SECRET`, il secondo `AGENT_DEVICE_SECRET`.

## 5. Variabili Railway
Nel servizio FastAPI → Variables usa:

```
APP_ENV=production
APP_ORIGIN=https://INSERISCI-DOMINIO-RAILWAY
SESSION_SECRET=INSERISCI-SECRET-1
AGENT_DEVICE_ID=cammarano-local-agent-01
AGENT_DEVICE_SECRET=INSERISCI-SECRET-2
AGENT_TOKEN_TTL_SECONDS=900
SESSION_TTL_SECONDS=28800
AGENT_REQUEST_TIMEOUT_SECONDS=20
DATABASE_URL=${{Postgres.DATABASE_URL}}
VAPID_SUBJECT=mailto:TUA_EMAIL
```

`APP_ORIGIN` va aggiornato dopo aver generato il dominio pubblico Railway.

## 6. Genera dominio HTTPS
Nel servizio FastAPI apri **Settings → Networking → Public Networking → Generate Domain**.
Otterrai un dominio simile a:

```
https://cammarano-orders-production.up.railway.app
```

Aggiorna `APP_ORIGIN` con quel valore e applica/redeploy le variabili.

## 7. Configura il Local Agent Ubuntu
Nel file `.env` del Local Agent:

```
RAILWAY_AUTH_URL=https://TUO-DOMINIO.up.railway.app/api/agent/auth
RAILWAY_WS_URL=wss://TUO-DOMINIO.up.railway.app/ws/agent
RAILWAY_DEVICE_ID=cammarano-local-agent-01
```

Nel file:

```
secrets/railway_device_secret.txt
```

inserisci **esattamente** il valore di `AGENT_DEVICE_SECRET` configurato su Railway.

Mantieni i permessi compatibili con l'utente del container locale:

```
sudo chown 10001:10001 secrets/railway_device_secret.txt
sudo chmod 400 secrets/railway_device_secret.txt
```

Poi:

```
sudo docker compose down
sudo docker compose up -d
sudo docker compose logs -f --tail=100
```

Il log atteso è simile a:

```
Connected securely to Railway
```

## 8. Test Railway
Apri:

```
https://TUO-DOMINIO.up.railway.app/health
```

Con il Local Agent collegato deve risultare:

```
{"status":"ok","agent_online":true}
```

Poi apri la root del dominio. Comparirà la PWA con login/registrazione.

## 9. Test applicativo end-to-end
1. Registra un utente `OWNER`.
2. Esci.
3. Registra un utente `OPERATOR`.
4. Cerca `IGLU27`.
5. Aggiungilo alla comanda e modifica la quantità.
6. Seleziona il proprietario come destinatario.
7. Invia la comanda.
8. Accedi come proprietario e verifica le comande ricevute.

Utenti e comande master vengono salvati dal Local Agent in SQLite; Railway conserva una copia/relay delle comande e degli eventi in PostgreSQL.

## 10. Notifiche Web Push
Dopo il primo deploy puoi generare le chiavi VAPID usando un ambiente Python con le dipendenze del progetto:

```
python scripts/generate_vapid.py
```

Copia i due valori generati nelle Variables Railway:

```
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...
```

Effettua il redeploy. Dopo il login usa il pulsante **Attiva notifiche** nella PWA.

Nota iOS: per le notifiche Web Push la PWA deve essere aggiunta alla schermata Home e l'utente deve concedere il permesso alle notifiche.

## 11. Diagnostica
Backend Railway:
- `/health` verifica servizio e stato agent.
- Railway Deploy Logs mostra migrazioni Alembic e avvio Uvicorn.

Ubuntu Local Agent:

```
sudo docker compose ps
sudo docker compose logs --tail=200 local-agent
```

Non esporre SQL Server su Internet e non inserire le sue credenziali nelle Variables Railway.
