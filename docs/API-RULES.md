# API Rules

This document defines the architecture and conventions for all API development.

---

## Backend API Design

### Response Structure
- **Always return HTTP 200** status code
- Even for errors, return 200 with an error `return_code`
- **Never** use HTTP error codes (4xx, 5xx) for API-level errors

### Return Code Pattern
Every API response must include a `return_code` field:

```json
{
  "return_code": "SUCCESS",  // or an error code
  "message": "Optional message",
  "data": {}  // Optional data fields
}
```

**Success Response:**
```json
{
  "return_code": "SUCCESS",
  "user": { ... },
  "token": "..."
}
```

**Error Response:**
```json
{
  "return_code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

### Standard Return Codes
Use descriptive, machine-readable return codes:
- `SUCCESS` - Operation completed successfully
- `MISSING_FIELDS` - Required fields are missing
- `INVALID_*` - Validation failed (e.g., `INVALID_EMAIL`, `INVALID_PASSWORD`)
- `NOT_FOUND` - Resource not found (e.g., `USER_NOT_FOUND`, `EVENT_NOT_FOUND`)
- `UNAUTHORIZED` - Authentication required or failed
- `FORBIDDEN` - User doesn't have permission
- `SERVER_ERROR` - Unexpected server error

### API Logging
- Add API logging to every route using `utils/apiLogger.js`
- Log requests, responses, and timing information

### File Headers
Every API route file must include a structured header:

```javascript
/*
=======================================================================================================================================
API Route: login_user
=======================================================================================================================================
Method: POST
Purpose: Authenticates a user using their email and password. Returns a token and basic user details upon success.
=======================================================================================================================================
Request Payload:
{
  "email": "user@example.com",         // string, required
  "password": "securepassword123"      // string, required
}

Success Response:
{
  "return_code": "SUCCESS",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // string, JWT token for auth
  "user": {
    "id": 123,                         // integer, unique user ID
    "name": "Andreas",                 // string, user's name
    "email": "user@example.com"        // string, user's email
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_CREDENTIALS"
"SERVER_ERROR"
=======================================================================================================================================
*/
```

### Code Comments
- Use extensive comments to explain what is happening
- Comment each major section of logic
- Explain WHY, not just WHAT

---

## Authentication

### JWT Authentication
- Use JWT (JSON Web Tokens) throughout the application
- Store auth configuration in `config/config.js`
- Only store the App_user ID in the JWT Token. use the database to find anything else you might need from there

### Middleware
- Use `/middleware/verifyToken.js` for authentication middleware
- **Always use a single `verifyToken` function** - no duplicates
- Use standard router pattern for authentication:
  - `verifyToken` - for routes requiring authentication
  - `optionalAuth` - for routes that work with or without auth

---

## Frontend API Client Design

### Error Handling Philosophy
- **API Client functions should NEVER throw errors for API-level failures**
- Only throw errors for network/connection failures (fetch failures, timeouts, server unreachable)
- Return structured response objects that let the caller decide how to handle errors

### Response Structure
API Client functions should return structured objects:

**For SUCCESS:**
```typescript
// Return the data directly
return response.guests;

// OR return with success flag
return { success: true, data: response.guests };
```

**For API Errors (non-SUCCESS return_code):**
```typescript
return {
  success: false,
  error: response.message || 'Operation failed',
  return_code: response.return_code
};
```

**For Network Errors:**
```typescript
// It's OK to throw for genuine network failures
throw new Error('Network request failed');
```

### Caller Responsibility
- The calling code decides how to handle API errors:
  - Show toast notification
  - Display inline error message
  - Redirect to login
  - Log and continue
  - etc.
- API client should NOT make these decisions

### Example Pattern

**Bad (throws on API error):**
```typescript
export const getGuests = async (eventId: number): Promise<Guest[]> => {
  const response = await apiCall('/api/guests/get_guests', { event_id: eventId });

  if (response.return_code !== 'SUCCESS') {
    throw new Error(response.message); // ❌ Don't throw!
  }

  return response.guests;
};
```

**Good (returns error info):**
```typescript
export const getGuests = async (eventId: number): Promise<{ success: boolean, guests?: Guest[], error?: string }> => {
  try {
    const response = await apiCall('/api/guests/get_guests', { event_id: eventId });

    if (response.return_code !== 'SUCCESS') {
      return {
        success: false,
        error: response.message || 'Failed to retrieve guests'
      };
    }

    return { success: true, guests: response.guests || [] };
  } catch (error) {
    // Only network errors reach here
    return {
      success: false,
      error: 'Network error - please check your connection'
    };
  }
};

// Usage in component:
const result = await getGuests(eventId);
if (result.success) {
  setGuests(result.guests);
} else {
  showToast(result.error); // Caller decides what to do
}
```

---

## Database

### Technology
- Use direct PostgreSQL (no ORM)
- Always use central database pooling with `/database.js`
- Single environment file `/.env`

### Schema
- Reference `/docs/DB-Schema.sql` for table and field definitions

### Query Best Practices
- **Do not use N+1 queries** - use JOINs or batch queries
- Use transaction wrapper for atomic operations
- Use destructured database import:
  ```javascript
  const { query } = require('../database');
  const { withTransaction } = require('../utils/transaction');
  ```

---

## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** Next.js, React, TypeScript
- **Database:** PostgreSQL
- **Development:** Windows
- **Testing:** Postman

---

## General

**Backend:** Always return HTTP 200 with `return_code`. Document all codes. Never throw HTTP errors.

**Frontend:** Never throw on non-SUCCESS return codes. Return structured objects. Let caller handle errors.

**Result:** Clean separation of concerns, predictable error handling, no red console errors.

**Passwords:** Do not hard code passwords. Always use values in the .env file and inform me if you need to add a new one


