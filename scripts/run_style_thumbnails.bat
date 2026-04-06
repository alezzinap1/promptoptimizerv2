@echo off
REM === Запускайте ЭТОТ файл двойным щелчком или из обычного cmd.exe ===
REM Терминал внутри Cursor-агента часто не показывает вывод и «висит» на долгих командах.
REM В корне проекта нужен .env с OPENROUTER_API_KEY

cd /d "%~dp0.."
set PYTHONUNBUFFERED=1

echo Каталог: %CD%
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo Python not found in PATH. Install Python or add it to PATH.
  exit /b 1
)

python -m pip install -q httpx python-dotenv
if errorlevel 1 (
  echo pip install failed
  exit /b 1
)

echo.
python scripts\generate_style_thumbnails.py %*
set EXITCODE=%ERRORLEVEL%
echo.
echo Exit code: %EXITCODE%
exit /b %EXITCODE%
