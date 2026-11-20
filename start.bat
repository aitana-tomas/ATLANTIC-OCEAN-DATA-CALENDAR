@echo off
setlocal
cd /d "%~dp0"

echo ===============================================
echo ATLANTIC OCEAN DATA EXPLORER
echo ===============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python no esta instalado.
  echo Instala Python y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

for /f %%P in ('powershell -NoProfile -Command "$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8000); try { $probe.Start(); $probe.Stop(); Write-Output 8000 } catch { $fallback = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $fallback.Start(); $port = $fallback.LocalEndpoint.Port; $fallback.Stop(); Write-Output $port }"') do set "PORT=%%P"
if not defined PORT (
  echo ERROR: No se pudo encontrar un puerto disponible.
  pause
  exit /b 1
)

echo Iniciando servidor local...
start "" /B python -m http.server %PORT% --bind 127.0.0.1 >nul 2>&1
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORT%/index.html'; if ($r.StatusCode -eq 200 -and $r.Content.Contains('Atlantic Ocean')) { exit 0 } } catch {}; exit 1" >nul 2>&1
if errorlevel 1 (
  echo ERROR: El servidor no pudo cargar index.html desde esta carpeta.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:%PORT%/"

echo.
echo La aplicacion se ha abierto en el navegador.
echo URL: http://127.0.0.1:%PORT%/
echo Puedes cerrar esta ventana cuando termines.
pause
