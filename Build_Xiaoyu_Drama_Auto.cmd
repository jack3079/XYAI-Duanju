@echo off
chcp 65001 >nul
setlocal
set /p XIAOYU_CENTER=请输入小鱼智算中心HTTPS地址（例如 https://api.example.com）: 
if "%XIAOYU_CENTER%"=="" (
  echo 地址不能为空。帮助请联系微信：echo169369
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build_Xiaoyu_Drama_Auto.ps1" "%XIAOYU_CENTER%"
if errorlevel 1 pause
endlocal
