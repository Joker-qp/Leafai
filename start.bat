@echo off
title Leafai Web App

echo.
echo Leafai Web App Starting...
echo.

if exist .venv goto HASVENV

echo Creating virtual environment...
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
goto RUNAPP

:HASVENV
call .venv\Scripts\activate.bat

:RUNAPP
echo Starting server at http://127.0.0.1:8000
start http://127.0.0.1:8000
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause