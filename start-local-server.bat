@echo off
cd /d "%~dp0"
echo.
echo Serveur local KaayPrint sur http://localhost:8080
echo Ouvre : http://localhost:8080/index.html
echo (ou http://localhost:8080/acceuil.html apres connexion)
echo Ctrl+C pour arreter.
echo.
py -m http.server 8080
if errorlevel 1 python -m http.server 8080
if errorlevel 1 (
  echo Erreur : Python non trouve. Installe Python depuis python.org
  pause
)
