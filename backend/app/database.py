from collections.abc import Iterator
from datetime import UTC, datetime

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

# Stable constraint names, so that Alembic migrations stay predictable.
NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes. PostgreSQL returns aware ones. Normalise both."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


_url = get_settings().database_url
# Fail fast rather than hang forever if the database cannot be reached.
_connect_args = {"connect_timeout": 10} if _url.startswith("postgresql") else {}
engine = create_engine(_url, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(connection, _record) -> None:
    if type(connection).__module__.startswith("sqlite3"):
        connection.execute("PRAGMA foreign_keys=ON")


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
