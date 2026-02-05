@echo off
echo Starting local web server for Volunteer Hub...
echo.
echo Open your browser to: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
python -m http.server 8000
pause
