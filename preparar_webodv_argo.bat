@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Arrastra el archivo .nc de webODV sobre este .bat.
  echo.
  pause
  exit /b 1
)

echo ===============================================
echo PREPARADOR WEBODV - ATLANTIC OCEAN DATA EXPLORER
echo ===============================================
echo.
echo Archivo:
echo %~1
echo.
echo Se procesara por bloques. No se cargara el NetCDF entero en RAM.
echo.

python "%~dp0preparar_webodv_argo.py" "%~1"

if errorlevel 1 (
  echo.
  echo ERROR durante el procesamiento.
  pause
  exit /b 1
)

echo.
echo Proceso terminado correctamente.
pause
