# API Documentation Standards

## Core Quality Principles

### Clarity and Accessibility
- Use plain, accessible language suitable for diverse audiences
- Define technical terms when first introduced
- Write in active voice and present tense
- Keep sentences and paragraphs concise
- Use consistent terminology throughout

### Completeness
- Document every endpoint, parameter, and response
- Include all authentication methods
- Provide error codes and handling guidance
- Document rate limits and usage policies
- Include versioning information and changelogs

### Practical Usability
- Provide working code examples in multiple languages (Python, JavaScript, cURL, etc.)
- Show complete request/response examples with realistic data
- Include quickstart guides for common workflows
- Demonstrate error handling patterns
- Link related endpoints and concepts

## Essential Components

### 1. Overview Section
- API purpose and value proposition
- Key capabilities and use cases
- Prerequisites and requirements
- Link to getting started guide

### 2. Authentication
- Supported authentication methods (API keys, OAuth, JWT, etc.)
- Step-by-step credential acquisition process
- How to include credentials in requests
- Security best practices
- Token refresh procedures (if applicable)

### 3. Endpoint Documentation
For each endpoint, document:
- HTTP method and URL path
- Purpose and use case
- Path parameters with types and constraints
- Query parameters with types, defaults, and constraints
- Request headers
- Request body schema with required/optional fields
- Response status codes
- Response body schema
- Response headers (if relevant)

### 4. Data Models
- Complete schemas for all request/response objects
- Field names, types, and descriptions
- Required vs optional fields
- Value constraints (enums, ranges, formats)
- Nested object structures
- Examples of complete objects

### 5. Error Handling
- Standard error response format
- Complete list of error codes with meanings
- Common error scenarios and solutions
- Retry strategies and backoff guidance

### 6. Rate Limiting
- Request limits (per second/minute/hour/day)
- Rate limit headers in responses
- Handling rate limit errors
- Best practices for staying within limits

### 7. Code Examples
- Multiple programming languages (prioritize Python, JavaScript, cURL)
- Complete, runnable examples (not fragments)
- Show authentication in context
- Demonstrate error handling
- Include comments explaining key parts
- Use realistic sample data

### 8. Tutorials and Guides
- Quickstart guide for first API call
- Common workflow tutorials
- Integration guides for popular frameworks
- Migration guides for version changes

## Writing Style Guidelines

### Language
- Use imperative mood for instructions: "Send a POST request" not "You can send a POST request"
- Be direct and specific: "Returns user ID" not "May return the user's identification"
- Avoid jargon unless necessary; define when used
- Use consistent verb tenses within sections

### Code Examples
- Test all code examples to ensure they work
- Use consistent formatting and style conventions
- Include necessary imports and setup
- Show complete context, not just fragments
- Comment complex or non-obvious parts

### Organization
- Structure documentation hierarchically
- Group related endpoints logically
- Provide clear navigation (TOC, breadcrumbs, search)
- Use descriptive, scannable headers
- Cross-reference related sections

## Common Patterns

### Pagination
Document:
- Pagination method (offset/limit, cursor-based, page numbers)
- Default and maximum page sizes
- How to request next/previous pages
- Total count availability
- Complete pagination example

### Filtering and Sorting
Document:
- Available filter parameters and operators
- Sort parameter format and options
- Default sort order
- Combining multiple filters
- Examples of common filter scenarios

### Webhooks
Document:
- Available webhook events
- Webhook payload structure
- Signature verification method
- Retry logic and failure handling
- Testing webhooks in development

### Versioning
Document:
- Current API version
- Version specification method (URL, header)
- Deprecation policy and timeline
- Changelog with breaking vs non-breaking changes
- Migration guides between versions
