from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "production"
    app_origin: str
    session_secret: str
    agent_device_id: str
    agent_device_secret: str
    agent_token_ttl_seconds: int = 900
    session_ttl_seconds: int = 28800
    agent_request_timeout_seconds: int = 20
    database_url: str
    vapid_private_key: str | None = None
    vapid_public_key: str | None = None
    vapid_subject: str = "mailto:admin@example.com"

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql+asyncpg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://") and "+asyncpg" not in v:
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    @field_validator("session_secret", "agent_device_secret")
    @classmethod
    def require_long_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("Secrets must be at least 32 characters long")
        return v

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
