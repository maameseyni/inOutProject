@echo off
cd /d "%~dp0\.."
set PGPASSWORD=%POSTGRES_PASSWORD%
if "%PGPASSWORD%"=="" set PGPASSWORD=postgres
set DB=%POSTGRES_DB%
if "%DB%"=="" set DB=xaliss
set HOST=%POSTGRES_HOST%
if "%HOST%"=="" set HOST=localhost
set USER=%POSTGRES_USER%
if "%USER%"=="" set USER=postgres
if not exist "scripts\backups" mkdir "scripts\backups"
set OUT=scripts\backups\xaliss-%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%.sql
set OUT=%OUT: =0%
echo Sauvegarde vers %OUT%
pg_dump -h %HOST% -U %USER% -d %DB% -F p -f "%OUT%"
if errorlevel 1 (
  echo Echec. Verifiez que pg_dump est dans le PATH.
  pause
  exit /b 1
)
echo OK.
