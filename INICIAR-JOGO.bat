@echo off
title Tecnico 26
cd /d "%~dp0"
echo Iniciando o Tecnico 26 (carreira + online)...
start "" http://localhost:3026
node server.js
pause
