from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PLACEHOLDER = "CHANGE_ME"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = "postgresql+psycopg://edupredict:edupredict@127.0.0.1:5433/edupredict"
    secret_key: str
    access_token_expire_minutes: int = 60
    cors_origins: str = "http://localhost:5173"

    first_admin_email: str | None = None
    first_admin_password: str | None = None
    seed_demo_data: bool = False
    demo_password: str | None = None

    upload_dir: Path = BACKEND_DIR / "uploads"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_upload_rows: int = 20_000
    max_failed_logins: int = 5
    lockout_minutes: int = 15

    @model_validator(mode="after")
    def refuse_insecure_secret(self) -> Settings:
        if PLACEHOLDER in self.secret_key or len(self.secret_key) < 32:
            raise ValueError("SECRET_KEY must be a random value of at least 32 characters.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
