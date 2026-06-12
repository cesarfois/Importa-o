# Usage: .\deploy.ps1 "Your commit message"
param (
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage
)

Write-Host "Staging changes..." -ForegroundColor Cyan
git add .

Write-Host "Committing changes..." -ForegroundColor Cyan
git commit -m $CommitMessage

Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push origin main

Write-Host "Successfully pushed to GitHub! The VPS deployment workflow has been triggered." -ForegroundColor Green
