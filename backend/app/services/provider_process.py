"""
AnimeSync — Anime Provider Subprocess Lifecycle Manager

Runs the local `anime-provider` Hono server alongside the FastAPI backend
(using Bun if installed, or the compiled Node.js bundle `dist-node/index.js`).
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx

from backend.app.config import BASE_DIR, settings

logger = logging.getLogger(__name__)


class ProviderProcessManager:
    def __init__(self) -> None:
        self._process: Optional[subprocess.Popen] = None
        self._started_by_us: bool = False
        self._log_file = None

    @property
    def provider_dir(self) -> Path:
        return BASE_DIR / "anime-provider"

    def _is_local_url(self) -> bool:
        parsed = urlparse(settings.ANIME_PROVIDER_URL)
        host = (parsed.hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "0.0.0.0", "::1")

    def _target_port(self) -> int:
        parsed = urlparse(settings.ANIME_PROVIDER_URL)
        return parsed.port or settings.ANIME_PROVIDER_PORT or 5000

    async def is_healthy(self, timeout: float = 1.5) -> bool:
        base = settings.ANIME_PROVIDER_URL.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(f"{base}/ping")
                return resp.status_code == 200
        except Exception:
            return False

    def _resolve_command(self) -> Optional[list[str]]:
        pdir = self.provider_dir
        if not pdir.exists():
            return None

        bun_bin = shutil.which("bun")
        if bun_bin and (pdir / "index.ts").exists():
            return [bun_bin, "index.ts"]

        node_bin = shutil.which("node")
        dist_entry = pdir / "dist-node" / "index.js"
        if node_bin:
            if not dist_entry.exists():
                npm_bin = shutil.which("npm")
                if npm_bin and (pdir / "package.json").exists():
                    try:
                        subprocess.run(
                            [npm_bin, "run", "build:node"],
                            cwd=str(pdir),
                            check=True,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            timeout=60,
                        )
                    except Exception as exc:
                        logger.warning("Failed to build anime-provider node bundle: %s", exc)
            if dist_entry.exists():
                return [node_bin, str(dist_entry)]

        return None

    async def ensure_started(self) -> bool:
        if os.getenv("PYTEST_CURRENT_TEST"):
            return False

        if await self.is_healthy(timeout=1.0):
            return True

        if not settings.ANIME_PROVIDER_AUTO_START or not self._is_local_url():
            return False

        if self._process and self._process.poll() is None:
            return await self.is_healthy(timeout=1.5)

        cmd = self._resolve_command()
        if not cmd:
            logger.warning("anime-provider runtime (bun/node) or bundle not found in %s", self.provider_dir)
            return False

        port = self._target_port()
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["HOST"] = "127.0.0.1"

        log_dir = BASE_DIR / "storage"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "anime-provider.log"

        try:
            self._log_file = open(log_path, "a", encoding="utf-8")
            self._process = subprocess.Popen(
                cmd,
                cwd=str(self.provider_dir),
                env=env,
                stdout=self._log_file,
                stderr=subprocess.STDOUT,
            )
            self._started_by_us = True
        except Exception as exc:
            logger.warning("Failed to launch anime-provider: %s", exc)
            return False

        for _ in range(20):
            if self._process.poll() is not None:
                logger.warning("anime-provider exited prematurely with code %s", self._process.returncode)
                return False
            if await self.is_healthy(timeout=0.75):
                logger.info("anime-provider running on port %s (PID %s)", port, self._process.pid)
                return True
            await asyncio.sleep(0.25)

        logger.warning("anime-provider did not respond on /ping within timeout")
        return False

    def stop(self) -> None:
        if self._started_by_us and self._process is not None:
            if self._process.poll() is None:
                try:
                    self._process.terminate()
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                except Exception:
                    pass
        self._process = None
        self._started_by_us = False
        if self._log_file is not None:
            try:
                self._log_file.close()
            except Exception:
                pass
            self._log_file = None


provider_process_manager = ProviderProcessManager()
