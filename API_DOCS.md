# Herma Rewind API Documentation

This document describes the available API endpoints for the Herma Rewind order management application.

## Base URL
Default: `http://localhost:3000`

## Endpoints

### 1. Ingest New Order
Receives a new order and saves it with initial status code 20 (Hazırlanıyor).

- **URL**: `/api/order/ingest`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body Options**:
    ```json
    { "kdsOrderId": "A-123" }
    ```
    OR
    ```json
    { "orderId": "B-456" }
    ```
- **Response**:
    ```json
    {
      "success": true,
      "order": {
        "id": "A-123",
        "status": "Hazırlanıyor",
        "statusCode": 20,
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000,
        "timeStamp": 1700000000000
      }
    }
    ```

### 2. Update Order Status (Internal/Frontend)
Used by the frontend to trigger status updates after speech recognition.

- **URL**: `/api/order/update-local`
- **Method**: `POST`
- **Body**:
    ```json
    { "id": "A-123", "statusCode": 30 }
    ```
- **Action**: Updates local memory and calls the external `UPDATE_STATUS_BASE_URL` defined in `.env`.

### 3. Toggle Speech Recognition
Inform the backend about the intended state of the microphone toggle.

- **URL**: `/api/listen/toggle`
- **Method**: `POST`
- **Response**:
    ```json
    { "isListening": true }
    ```

### 4. Get All Orders
Fetches the current list of orders in memory.

- **URL**: `/api/orders`
- **Method**: `GET`
- **Response**: `Array<Order>`

### 5. Health Check
Simple check to see if the server is running.

- **URL**: `/health`
- **Method**: `GET`
- **Response**: `{ "isHealthy": true }`

---

## Environment Variables (.env)
- `PORT`: Server port (default 3000).
- `STATUS_PREPARING`: Int code (default 20).
- `STATUS_PREPARED`: Int code (default 30).
- `STATUS_DELIVERED`: Int code (default 40).
- `UPDATE_STATUS_BASE_URL`: The external API to call for status updates.
