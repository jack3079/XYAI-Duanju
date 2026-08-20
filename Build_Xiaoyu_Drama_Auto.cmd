@echo off
setlocal EnableExtensions
set "CENTER_URL=%~1"
if not defined CENTER_URL (
  set /p "CENTER_URL=请输入小鱼智算中心 HTTPS 根地址："
)
if not defined CENTER_URL exit /b 2
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build_Xiaoyu_Drama_Auto.ps1" -ComputeCenterUrl "%CENTER_URL%"
exit /b %ERRORLEVEL%
