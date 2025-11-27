# API Documentation Templates

## Overview Page Template

```markdown
# [API Name] API Documentation

## Overview

[API Name] enables you to [primary value proposition]. With this API, you can:
- [Key capability 1]
- [Key capability 2]
- [Key capability 3]

## Base URL

```
https://api.example.com/v1
```

## Authentication

All requests require authentication using [method]. See the [Authentication](#authentication) section for details.

## Rate Limits

- [Number] requests per [time period]
- Rate limit information is included in response headers

## Getting Started

1. [Obtain API credentials](#authentication)
2. [Make your first request](#quickstart)
3. [Explore common workflows](#tutorials)

## Support

- [Documentation](https://docs.example.com)
- [Support email](mailto:support@example.com)
- [Status page](https://status.example.com)
```

## Endpoint Documentation Template

```markdown
## [Endpoint Name]

[Brief description of what this endpoint does and when to use it.]

### HTTP Request

```http
[METHOD] /path/to/endpoint
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param1` | string | Yes | [Description including constraints] |
| `param2` | integer | No | [Description including defaults] |

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filter` | string | No | - | [Description of filter options] |
| `limit` | integer | No | 50 | [Description, max value] |

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | Bearer token for authentication |
| `Content-Type` | Yes | Must be `application/json` |

### Request Body

```json
{
  "field1": "string (required) - [description]",
  "field2": 123,
  "nested_object": {
    "sub_field": "value"
  }
}
```

### Response

**Success Response (200 OK)**

```json
{
  "id": "abc123",
  "field1": "value",
  "created_at": "2025-01-15T10:30:00Z"
}
```

**Error Response (400 Bad Request)**

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Field 'field1' is required",
    "details": []
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Invalid request parameters |
| 401 | Authentication failed |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Server error |

### Examples

**cURL**

```bash
curl -X POST https://api.example.com/v1/resource \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "field1": "value",
    "field2": 123
  }'
```

**Python**

```python
import requests

url = "https://api.example.com/v1/resource"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
}
data = {
    "field1": "value",
    "field2": 123
}

response = requests.post(url, headers=headers, json=data)
result = response.json()
print(result)
```

**JavaScript**

```javascript
const response = await fetch('https://api.example.com/v1/resource', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    field1: 'value',
    field2: 123
  })
});

const result = await response.json();
console.log(result);
```
```

## Authentication Section Template

```markdown
# Authentication

## API Key Authentication

All API requests require authentication using an API key passed in the `Authorization` header.

### Obtaining an API Key

1. Sign in to your account at [dashboard URL]
2. Navigate to Settings > API Keys
3. Click "Create New API Key"
4. Copy the key immediately (it won't be shown again)
5. Store the key securely

### Using Your API Key

Include your API key in the `Authorization` header with the `Bearer` scheme:

```http
Authorization: Bearer YOUR_API_KEY
```

### Example Request

```bash
curl https://api.example.com/v1/resource \
  -H "Authorization: Bearer your_api_key_here"
```

### Security Best Practices

- Never commit API keys to version control
- Use environment variables to store keys
- Rotate keys periodically
- Use different keys for development and production
- Revoke compromised keys immediately

### Key Permissions

API keys can have different permission levels:
- **Read**: Can view resources but not modify
- **Write**: Can create and update resources
- **Delete**: Can delete resources
- **Admin**: Full access to all operations
```

## Quickstart Guide Template

```markdown
# Quickstart Guide

Get up and running with the [API Name] API in under 5 minutes.

## Prerequisites

- [Requirement 1, e.g., API key]
- [Requirement 2, e.g., Programming environment]

## Step 1: Authentication

[Brief auth instructions or link to auth section]

## Step 2: Make Your First Request

Let's [describe what the example does]:

**Python**

```python
import requests

# Set up authentication
api_key = "your_api_key_here"
headers = {"Authorization": f"Bearer {api_key}"}

# Make the request
response = requests.get(
    "https://api.example.com/v1/resource",
    headers=headers
)

# Handle the response
if response.status_code == 200:
    data = response.json()
    print(f"Success! Retrieved {len(data)} items")
else:
    print(f"Error: {response.status_code}")
```

**Expected Response**

```json
{
  "items": [
    {"id": "1", "name": "Example"},
    {"id": "2", "name": "Another"}
  ],
  "total": 2
}
```

## Step 3: Common Operations

### [Operation 1]

[Brief code example]

### [Operation 2]

[Brief code example]

## Next Steps

- [Link to tutorial 1]
- [Link to tutorial 2]
- [Link to complete API reference]
```

## Error Documentation Template

```markdown
# Error Handling

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    }
  }
}
```

## HTTP Status Codes

| Status | Meaning | Description |
|--------|---------|-------------|
| 200 | OK | Request succeeded |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request format or parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Valid auth but insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Request conflicts with existing resource |
| 422 | Unprocessable Entity | Validation failed |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Temporary service issue |

## Error Codes

### Authentication Errors

| Code | HTTP Status | Description | Solution |
|------|-------------|-------------|----------|
| `AUTH_MISSING` | 401 | No authentication provided | Include Authorization header |
| `AUTH_INVALID` | 401 | Invalid API key or token | Check credentials and try again |
| `AUTH_EXPIRED` | 401 | Token has expired | Refresh your token |

### Validation Errors

| Code | HTTP Status | Description | Solution |
|------|-------------|-------------|----------|
| `VALIDATION_FAILED` | 422 | Request validation failed | Check error details for specific fields |
| `REQUIRED_FIELD` | 422 | Required field missing | Include all required fields |
| `INVALID_FORMAT` | 422 | Field format invalid | Check field format requirements |

### Rate Limiting

| Code | HTTP Status | Description | Solution |
|------|-------------|-------------|----------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Wait before retrying (see Retry-After header) |

## Error Handling Best Practices

### Retry Logic

```python
import time
import requests

def make_request_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        
        if response.status_code == 429:
            # Rate limited - wait and retry
            retry_after = int(response.headers.get('Retry-After', 60))
            print(f"Rate limited. Waiting {retry_after} seconds...")
            time.sleep(retry_after)
            continue
        
        if response.status_code >= 500:
            # Server error - exponential backoff
            wait_time = 2 ** attempt
            print(f"Server error. Retrying in {wait_time} seconds...")
            time.sleep(wait_time)
            continue
        
        # Client error - don't retry
        raise Exception(f"Request failed: {response.json()}")
    
    raise Exception("Max retries exceeded")
```

### Error Response Handling

```python
try:
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    result = response.json()
except requests.exceptions.HTTPError as e:
    error_data = e.response.json()
    error_code = error_data['error']['code']
    error_message = error_data['error']['message']
    print(f"API Error: {error_code} - {error_message}")
except requests.exceptions.RequestException as e:
    print(f"Network Error: {str(e)}")
```
```
