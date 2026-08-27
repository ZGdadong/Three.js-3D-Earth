@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Three.js 3D 地球  一键启动
echo   访问地址: http://127.0.0.1:8080/index.html
echo   关闭: 按 Ctrl+C 或直接关掉本窗口
echo ============================================
echo.
echo 正在打开浏览器并启动本地服务器...
start "" http://127.0.0.1:8080/index.html
python -m http.server 8080 --bind 127.0.0.1
pause
