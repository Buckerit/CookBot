"""Async SQLAlchemy engine, session factory, and ORM table definitions."""

import logging
from sqlalchemy import Column, String, DateTime, func, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.dialects.postgresql import JSONB

from backend.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class RecipeRow(Base):
    __tablename__ = "recipes"
    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    data = Column(JSONB, nullable=False)


class SessionRow(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    recipe_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    data = Column(JSONB, nullable=False)


def _build_url(raw: str) -> str:
    """Normalise postgres:// / postgresql:// to the asyncpg dialect."""
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgresql://") and "+asyncpg" not in raw:
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw


engine = create_async_engine(
    _build_url(settings.database_url),
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, expire_on_commit=False
)


async def init_db() -> None:
    """Create all tables if they don't already exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ready")
