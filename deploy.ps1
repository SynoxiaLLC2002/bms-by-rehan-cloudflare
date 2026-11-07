# Creates or updates one BMS site on Cloudflare. Needs Docker Desktop running.
#
#   .\deploy.ps1 -Site my-site
#   .\deploy.ps1 -Site my-site -Domain example.com
#   .\deploy.ps1 -Site my-site -Domain example.com -Region weur
#
# -Region: where a NEW site's database and files live; pick where its visitors are.
# enam = US East (default), wnam = US West, weur, eeur, apac, oc.
#
# Run it again with the same -Site to update that site to this BMS version.
param(
  [Parameter(Mandatory = $true)][string]$Site,
  [string]$Domain = "",
  [string]$Region = "enam"
)
$here = $PSScriptRoot
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker Desktop is not running. Open Docker Desktop, wait until it says it is running, then try again." -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Force "$here\sites" | Out-Null
# node_modules and the Cloudflare sign-in live in Docker volumes, so Windows never sees them.
docker run --rm -it -p 8976:8976 -e BMS_REGION=$Region `
  -v "${here}:/app" `
  -v bms-cf-node-modules:/app/node_modules `
  -v bms-cf-home:/root `
  -v "${here}\sites:/state" `
  -w /app node:22-bookworm bash deploy/deploy.sh $Site $Domain
