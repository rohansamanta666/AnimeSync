from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.app.config import settings

class Base(DeclarativeBase):
    pass

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False}
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def init_db():
    # Ensure all models are imported before create_all
    from backend.app.models import download as _download_model  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        migrations = [
            "ALTER TABLE participants ADD COLUMN is_kicked BOOLEAN DEFAULT 0;",
            "ALTER TABLE episodes ADD COLUMN source_type VARCHAR(20) DEFAULT 'local' NOT NULL;",
            "ALTER TABLE episodes ADD COLUMN stream_url VARCHAR(2000);",
            "ALTER TABLE episodes ADD COLUMN subtitle_url VARCHAR(2000);",
        ]
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass

