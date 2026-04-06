# GoHighLevel API Test Script
# Run with: .\test-api.ps1

$baseUrl = "http://localhost:3001"

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method = "GET",
        [string]$Endpoint,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    
    Write-Host "`n=== Testing: $Name ===" -ForegroundColor Cyan
    Write-Host "$Method $Endpoint" -ForegroundColor Gray
    
    try {
        $params = @{
            Uri = "$baseUrl$Endpoint"
            Method = $Method
            Headers = $Headers
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json)
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-RestMethod @params
        Write-Host "Status: SUCCESS" -ForegroundColor Green
        Write-Host "Response:" -ForegroundColor Yellow
        $response | ConvertTo-Json -Depth 3
    }
    catch {
        Write-Host "Status: ERROR" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            $errorBody = $reader.ReadToEnd()
            Write-Host "Response: $errorBody" -ForegroundColor Red
        }
    }
}

# Test 1: Health Check
Test-Endpoint -Name "Health Check" -Endpoint "/health"

# Test 2: API Info
Test-Endpoint -Name "API Info" -Endpoint "/api"

# Test 3: Get OAuth URL
Test-Endpoint -Name "Get OAuth URL" -Endpoint "/api/auth/ghl"

# Test 4: Dashboard Stats (without auth - should fail)
Test-Endpoint -Name "Dashboard Stats (No Auth)" -Endpoint "/api/dashboard/stats"

# Test 5: Users List (without auth - should fail)
Test-Endpoint -Name "Users List (No Auth)" -Endpoint "/api/users"

# Test 6: Contacts List (without auth - should fail)
Test-Endpoint -Name "Contacts List (No Auth)" -Endpoint "/api/contacts"

# Test 7: Opportunities List (without auth - should fail)
Test-Endpoint -Name "Opportunities List (No Auth)" -Endpoint "/api/opportunities"

Write-Host "`n=== Tests Complete ===" -ForegroundColor Cyan
Write-Host "To test authenticated endpoints, you need to:" -ForegroundColor Yellow
Write-Host "1. Visit the OAuth URL from test #3" -ForegroundColor White
Write-Host "2. Complete the OAuth flow with GoHighLevel" -ForegroundColor White
Write-Host "3. Use the returned token in Authorization header" -ForegroundColor White
