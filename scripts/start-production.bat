@echo off
cd /d "%~dp0\.."
if not exist ".venv\Scripts\activate.bat" (
  echo Creez d'abord l'environnement : python -m venv .venv
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" if not "%%a:~0,1%"=="#" set "%%a=%%b"
  )
)
echo Demarrage Gunicorn sur http://127.0.0.1:8000
gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 2 --timeout 120
