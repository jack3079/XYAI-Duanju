@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build_Xiaoyu_Drama.ps1" %*
exit /b %ERRORLEVEL%
