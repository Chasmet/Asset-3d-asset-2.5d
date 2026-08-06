@echo off
setlocal
set APP_HOME=%~dp0
set DIST_DIR=%APP_HOME%.gradle-dist
set ZIP_PATH=%DIST_DIR%\gradle-8.7-bin.zip
set GRADLE_HOME=%DIST_DIR%\gradle-8.7
set DIST_URL=https://services.gradle.org/distributions/gradle-8.7-bin.zip

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
if not exist "%GRADLE_HOME%" (
  powershell -Command "Invoke-WebRequest -Uri '%DIST_URL%' -OutFile '%ZIP_PATH%'"
  powershell -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%DIST_DIR%' -Force"
)

call "%GRADLE_HOME%\bin\gradle.bat" %*
