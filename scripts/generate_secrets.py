import secrets
print("SESSION_SECRET=" + secrets.token_urlsafe(48))
print("AGENT_DEVICE_SECRET=" + secrets.token_urlsafe(48))
