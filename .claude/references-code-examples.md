# Code Examples Guide

## General Principles

- All examples must be complete and runnable
- Include necessary imports/requirements
- Use realistic sample data, not placeholders like "xxx"
- Show error handling
- Add comments for complex parts
- Test examples before including them

## Language-Specific Examples

### cURL

Standard pattern for cURL examples:

```bash
# GET request
curl https://api.example.com/v1/resource \
  -H "Authorization: Bearer YOUR_API_KEY"

# POST request with JSON body
curl -X POST https://api.example.com/v1/resource \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example Resource",
    "value": 123
  }'

# With query parameters
curl "https://api.example.com/v1/resources?limit=10&offset=0" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Upload file
curl -X POST https://api.example.com/v1/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@/path/to/file.pdf"
```

### Python (requests library)

Standard pattern for Python examples:

```python
import requests
from typing import Dict, Any

# Configuration
API_KEY = "your_api_key_here"
BASE_URL = "https://api.example.com/v1"

def make_request(endpoint: str, method: str = "GET", data: Dict = None) -> Dict[str, Any]:
    """Make an authenticated API request."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    url = f"{BASE_URL}/{endpoint}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=data)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers)
        
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.HTTPError as e:
        error_data = e.response.json()
        print(f"API Error: {error_data.get('error', {}).get('message', 'Unknown error')}")
        raise
    except requests.exceptions.RequestException as e:
        print(f"Network Error: {str(e)}")
        raise

# Example usage
if __name__ == "__main__":
    # GET request
    resources = make_request("resources")
    print(f"Retrieved {len(resources)} resources")
    
    # POST request
    new_resource = {
        "name": "My Resource",
        "value": 42
    }
    created = make_request("resources", method="POST", data=new_resource)
    print(f"Created resource with ID: {created['id']}")
```

### JavaScript (Node.js with fetch)

Standard pattern for Node.js examples:

```javascript
// Using native fetch (Node.js 18+)
const API_KEY = 'your_api_key_here';
const BASE_URL = 'https://api.example.com/v1';

async function makeRequest(endpoint, options = {}) {
  const url = `${BASE_URL}/${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    }
  };
  
  const mergedOptions = { ...defaultOptions, ...options };
  
  try {
    const response = await fetch(url, mergedOptions);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.error.message}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Request failed:', error.message);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    // GET request
    const resources = await makeRequest('resources');
    console.log(`Retrieved ${resources.length} resources`);
    
    // POST request
    const newResource = {
      name: 'My Resource',
      value: 42
    };
    const created = await makeRequest('resources', {
      method: 'POST',
      body: JSON.stringify(newResource)
    });
    console.log(`Created resource with ID: ${created.id}`);
  } catch (error) {
    console.error('Failed:', error);
  }
}

main();
```

### JavaScript (Browser/Frontend)

Standard pattern for browser JavaScript:

```javascript
class APIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.example.com/v1';
  }
  
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    
    const defaultOptions = {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };
    
    const mergedOptions = { ...defaultOptions, ...options };
    
    try {
      const response = await fetch(url, mergedOptions);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error.message);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }
  
  async getResources() {
    return this.request('resources');
  }
  
  async createResource(data) {
    return this.request('resources', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

// Usage
const client = new APIClient('your_api_key_here');

// GET request
const resources = await client.getResources();
console.log(resources);

// POST request
const newResource = await client.createResource({
  name: 'My Resource',
  value: 42
});
console.log(newResource);
```

### TypeScript

Standard pattern for TypeScript examples:

```typescript
interface Resource {
  id: string;
  name: string;
  value: number;
  created_at: string;
}

interface APIError {
  error: {
    code: string;
    message: string;
  };
}

class APIClient {
  private apiKey: string;
  private baseUrl: string = 'https://api.example.com/v1';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };
    
    const mergedOptions = { ...defaultOptions, ...options };
    
    const response = await fetch(url, mergedOptions);
    
    if (!response.ok) {
      const errorData: APIError = await response.json();
      throw new Error(errorData.error.message);
    }
    
    return response.json();
  }
  
  async getResources(): Promise<Resource[]> {
    return this.request<Resource[]>('resources');
  }
  
  async createResource(data: Omit<Resource, 'id' | 'created_at'>): Promise<Resource> {
    return this.request<Resource>('resources', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

// Usage
const client = new APIClient('your_api_key_here');

const resources = await client.getResources();
console.log(resources);

const newResource = await client.createResource({
  name: 'My Resource',
  value: 42
});
console.log(newResource);
```

### Ruby

Standard pattern for Ruby examples:

```ruby
require 'net/http'
require 'json'
require 'uri'

class APIClient
  BASE_URL = 'https://api.example.com/v1'
  
  def initialize(api_key)
    @api_key = api_key
  end
  
  def get_resources
    request('resources', method: :get)
  end
  
  def create_resource(data)
    request('resources', method: :post, body: data)
  end
  
  private
  
  def request(endpoint, method: :get, body: nil)
    uri = URI("#{BASE_URL}/#{endpoint}")
    
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    
    request = case method
              when :get
                Net::HTTP::Get.new(uri)
              when :post
                Net::HTTP::Post.new(uri)
              when :put
                Net::HTTP::Put.new(uri)
              when :delete
                Net::HTTP::Delete.new(uri)
              end
    
    request['Authorization'] = "Bearer #{@api_key}"
    request['Content-Type'] = 'application/json'
    request.body = body.to_json if body
    
    response = http.request(request)
    
    if response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    else
      error = JSON.parse(response.body)
      raise "API Error: #{error['error']['message']}"
    end
  end
end

# Usage
client = APIClient.new('your_api_key_here')

resources = client.get_resources
puts "Retrieved #{resources.length} resources"

new_resource = client.create_resource(
  name: 'My Resource',
  value: 42
)
puts "Created resource: #{new_resource['id']}"
```

### Go

Standard pattern for Go examples:

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

const (
    BaseURL = "https://api.example.com/v1"
)

type APIClient struct {
    APIKey string
    Client *http.Client
}

type Resource struct {
    ID        string `json:"id"`
    Name      string `json:"name"`
    Value     int    `json:"value"`
    CreatedAt string `json:"created_at"`
}

type APIError struct {
    Error struct {
        Code    string `json:"code"`
        Message string `json:"message"`
    } `json:"error"`
}

func NewAPIClient(apiKey string) *APIClient {
    return &APIClient{
        APIKey: apiKey,
        Client: &http.Client{},
    }
}

func (c *APIClient) request(method, endpoint string, body interface{}) ([]byte, error) {
    url := fmt.Sprintf("%s/%s", BaseURL, endpoint)
    
    var reqBody io.Reader
    if body != nil {
        jsonData, err := json.Marshal(body)
        if err != nil {
            return nil, err
        }
        reqBody = bytes.NewBuffer(jsonData)
    }
    
    req, err := http.NewRequest(method, url, reqBody)
    if err != nil {
        return nil, err
    }
    
    req.Header.Set("Authorization", "Bearer "+c.APIKey)
    req.Header.Set("Content-Type", "application/json")
    
    resp, err := c.Client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    respBody, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    
    if resp.StatusCode >= 400 {
        var apiErr APIError
        json.Unmarshal(respBody, &apiErr)
        return nil, fmt.Errorf("API error: %s", apiErr.Error.Message)
    }
    
    return respBody, nil
}

func (c *APIClient) GetResources() ([]Resource, error) {
    data, err := c.request("GET", "resources", nil)
    if err != nil {
        return nil, err
    }
    
    var resources []Resource
    err = json.Unmarshal(data, &resources)
    return resources, err
}

func (c *APIClient) CreateResource(resource Resource) (*Resource, error) {
    data, err := c.request("POST", "resources", resource)
    if err != nil {
        return nil, err
    }
    
    var created Resource
    err = json.Unmarshal(data, &created)
    return &created, err
}

func main() {
    client := NewAPIClient("your_api_key_here")
    
    // Get resources
    resources, err := client.GetResources()
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Printf("Retrieved %d resources\n", len(resources))
    
    // Create resource
    newResource := Resource{
        Name:  "My Resource",
        Value: 42,
    }
    created, err := client.CreateResource(newResource)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Printf("Created resource: %s\n", created.ID)
}
```

## Pagination Examples

Show complete pagination implementation:

```python
def get_all_resources(api_key: str) -> list:
    """Fetch all resources using pagination."""
    all_resources = []
    offset = 0
    limit = 100
    
    while True:
        response = requests.get(
            f"https://api.example.com/v1/resources?limit={limit}&offset={offset}",
            headers={"Authorization": f"Bearer {api_key}"}
        )
        response.raise_for_status()
        data = response.json()
        
        all_resources.extend(data['items'])
        
        # Check if there are more pages
        if len(data['items']) < limit:
            break
        
        offset += limit
    
    return all_resources
```

## Error Handling Examples

Show realistic error handling:

```python
def safe_api_call(url: str, headers: dict, max_retries: int = 3):
    """Make API call with retry logic and error handling."""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.Timeout:
            if attempt == max_retries - 1:
                raise
            print(f"Timeout, retrying... (attempt {attempt + 1})")
            time.sleep(2 ** attempt)
        
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:  # Rate limit
                retry_after = int(e.response.headers.get('Retry-After', 60))
                print(f"Rate limited. Waiting {retry_after} seconds...")
                time.sleep(retry_after)
            elif e.response.status_code >= 500:  # Server error
                if attempt == max_retries - 1:
                    raise
                print(f"Server error, retrying... (attempt {attempt + 1})")
                time.sleep(2 ** attempt)
            else:  # Client error - don't retry
                raise
```
