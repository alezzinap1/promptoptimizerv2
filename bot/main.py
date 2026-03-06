"""
Точка входа приложения.
Инициализирует все компоненты и запускает Telegram бота.
"""
import asyncio
import logging
import os
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import TelegramObject
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def _require_env(key: str) -> str:
    val = os.getenv(key)
    if not val:
        logger.critical("Required env var '%s' is not set. Exiting.", key)
        sys.exit(1)
    return val


async def main() -> None:
    telegram_token = _require_env("TELEGRAM_BOT_TOKEN")
    openrouter_key = _require_env("OPENROUTER_API_KEY")
    db_path = os.getenv("DB_PATH", "data/agent.db")

    # ── Инициализация компонентов ──────────────────────────────────────────
    from bot.db.sqlite_manager import SQLiteManager
    from bot.services.llm_client import LLMService
    from bot.core.technique_registry import TechniqueRegistry
    from bot.handlers import commands_router, callbacks_router

    db = SQLiteManager(db_path)
    await db.init()
    logger.info("Database initialized at: %s", db_path)

    llm = LLMService(openrouter_key)
    logger.info("LLM service initialized")

    registry = TechniqueRegistry()
    logger.info("Technique registry: %d techniques loaded", len(registry.get_all_ids()))

    # ── Middleware для инжекции зависимостей ──────────────────────────────
    from aiogram import BaseMiddleware
    from typing import Callable, Awaitable, Any

    class DepsMiddleware(BaseMiddleware):
        async def __call__(
            self,
            handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
            event: TelegramObject,
            data: dict[str, Any],
        ) -> Any:
            data["db"] = db
            data["llm"] = llm
            data["registry"] = registry
            return await handler(event, data)

    # ── Бот и диспетчер ───────────────────────────────────────────────────
    bot = Bot(
        token=telegram_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    dp.update.middleware(DepsMiddleware())

    dp.include_router(commands_router)
    dp.include_router(callbacks_router)

    logger.info("Starting bot polling...")
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await bot.session.close()
        logger.info("Bot stopped.")


if __name__ == "__main__":
    asyncio.run(main())
