# TakTak VPS Deployment Script (Windows Server 2022)
# Usage: .\deploy.ps1

Write-Host "🚀 Iniciando despliegue de TakTak en VPS..." -ForegroundColor Cyan

# 1. Detect Location
$isServerDir = (Split-Path -Leaf (Get-Location)) -eq "server"
$rootDir = if ($isServerDir) { Split-Path -Parent (Get-Location) } else { Get-Location }
$serverDir = if ($isServerDir) { Get-Location } else { Join-Path (Get-Location) "server" }

# 2. Check for Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js no encontrado. Instálalo desde https://nodejs.org/" -ForegroundColor Red
    return
}

# 3. Install Frontend Dependencies & Build (from Root)
Write-Host "📦 Preparando Frontend..." -ForegroundColor Yellow
Set-Location $rootDir
npm install
npm run build

# 4. Install & Build Backend (from Server)
Write-Host "📦 Preparando Backend..." -ForegroundColor Yellow
Set-Location $serverDir
npm install
npm run build # Compilar a JavaScript para máxima estabilidad

# 5. Start Backend (Production Mode)
Write-Host "🚀 Arrancando el Servidor TakTak (Modo Producción)..." -ForegroundColor Green
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    # Limpieza profunda
    pm2 delete taktak-vps 2>$null
    
    # Arrancar usando el código compilado (el método más estable en Windows)
    pm2 start ecosystem.config.cjs
    
    Write-Host "✅ TakTak está corriendo con PM2." -ForegroundColor Green
} else {
    Write-Host "⚠️ PM2 no encontrado. Ejecutando npm start..." -ForegroundColor Yellow
    npm start
}

Write-Host "🎉 Despliegue completado con éxito." -ForegroundColor Cyan
Write-Host "Accede en: http://157.90.244.93:3000" -ForegroundColor White
