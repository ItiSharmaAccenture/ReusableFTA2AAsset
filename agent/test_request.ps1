# Send one A2A request to the local Property Upsell Agent.
#   .\test_request.ps1
# Edit $property below to try different Salesforce-verified values.

param(
    [string]$Url = "http://127.0.0.1:8001/",
    [int]$TimeoutSec = 300
)

$ErrorActionPreference = "Stop"

$property = [ordered]@{
    Property_Type__c        = "Townhome"
    Property_Size__c        = 1610
    Bedrooms__c             = 3
    Bathrooms__c            = 2
    Year_Built__c           = 2012
    Security_System_Base__c = "Command panel"
    Monitoring_Status__c    = "In Service"
}

$propertyJson = @{ property = $property } | ConvertTo-Json -Depth 5 -Compress
$text = "Recommend suitable upsell products for this property.`n`n" + $propertyJson

$payload = @{
    jsonrpc = "2.0"
    id      = "1"
    method  = "message/send"
    params  = @{
        message = @{
            messageId = [guid]::NewGuid().ToString()
            role      = "user"
            parts     = @(@{ text = $text })
        }
    }
} | ConvertTo-Json -Depth 10

Write-Host "POST $Url" -ForegroundColor Cyan
Write-Host "First call can take 60-90 seconds (whole catalogue goes through the model)..." -ForegroundColor DarkGray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $Url -Method Post -ContentType "application/json" `
        -Body $payload -TimeoutSec $TimeoutSec
}
catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Is the server running? Check http://127.0.0.1:8001/.well-known/agent-card.json" -ForegroundColor Yellow
    exit 1
}

if ($response.error) {
    Write-Host "JSON-RPC error:" -ForegroundColor Red
    $response.error | ConvertTo-Json -Depth 5
    exit 1
}

Write-Host ("Task state: " + $response.result.status.state) -ForegroundColor Green
Write-Host ""

foreach ($artifact in $response.result.artifacts) {
    foreach ($part in $artifact.parts) {
        if ($part.text) { $part.text }
    }
}
