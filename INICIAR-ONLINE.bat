@echo off
title Tecnico 26 Online
cd /d "%~dp0"
echo Iniciando o servidor online...
start "" http://localhost:3026/online.html
node server.js
pause
