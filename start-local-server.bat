@echo off
cd /d "%~dp0"
echo.
echo Serveur Django Xaliss / KaayPrint sur http://127.0.0.1:8000
echo Connexion : http://127.0.0.1:8000/connexion/
echo Application : http://127.0.0.1:8000/app/
echo Ctrl+C pour arreter.
echo.
py manage.py runserver
if errorlevel 1 python manage.py runserver
if errorlevel 1 (
  echo Erreur : Python ou Django non trouve. Voir DJANGO.md
  pause
)
