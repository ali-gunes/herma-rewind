require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global Request Logger
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    if (Object.keys(req.body).length > 0) {
        console.log(`[Payload]:`, JSON.stringify(req.body, null, 2));
    }
    next();
});

// In-memory data structure
// { orderId: { id, status, statusCode, createdAt, updatedAt } }
let orders = {};

const STATUS_MAP = {
    [process.env.STATUS_PREPARING || 20]: 'Hazırlanıyor',
    [process.env.STATUS_PREPARED || 30]: 'Hazır',
    [process.env.STATUS_DELIVERED || 40]: 'Teslim Edildi'
};

// Healthcheck
app.get('/health', (req, res) => {
    res.json({ isHealthy: true });
});

// Order Ingest
app.post('/api/orders/ingest', (req, res) => {
    const { kdsOrderId, orderId } = req.body;
    const id = kdsOrderId || orderId;

    if (!id) {
        return res.status(400).json({ success: false, error: 'Order ID is required' });
    }

    const now = Date.now();
    const statusCode = parseInt(process.env.STATUS_PREPARING) || 20;

    const newOrder = {
        id: id,
        status: STATUS_MAP[statusCode],
        statusCode: statusCode,
        createdAt: now,
        updatedAt: now,
        timeStamp: now
    };

    orders[id] = newOrder;

    console.log(`[Order Ingest] New order: ${id} with status ${newOrder.status}`);

    res.json({
        success: true,
        order: newOrder
    });
});

// Update Status (matches the speech-to-text logic requirement)
app.post('/api/orders/update-local', async (req, res) => {
    const { id, statusCode } = req.body;

    if (!orders[id]) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const now = Date.now();
    orders[id].statusCode = statusCode;
    orders[id].status = STATUS_MAP[statusCode] || 'Bilinmiyor';
    orders[id].updatedAt = now;

    console.log(`[Order Update] Order: ${id} updated to status ${orders[id].status} (${statusCode})`);

    // Call the external update-status service
    try {
        const externalUrl = `${process.env.UPDATE_STATUS_BASE_URL}/update-status`;
        console.log(`[External Update] Calling ${externalUrl} for order ${id}`);

        // The requirement says: {"status": 30, "kdsOrderId":"A-123"}
        await axios.post(externalUrl, {
            status: statusCode,
            kdsOrderId: id
        });
        console.log(`[External Update] Success for order ${id}`);
    } catch (error) {
        console.error(`[External Update] Failed for order ${id}:`, error.message);
        // We still return success: true for the local update even if external fails, 
        // as per typical local-first UI behavior, but we logged the error.
    }

    res.json({ success: true, order: orders[id] });
});

// Toggle listening endpoint (for frontend to signal state change)
let isListening = false;
app.post('/api/listen/toggle', (req, res) => {
    isListening = !isListening;
    console.log(`[Listen Toggle] State changed to: ${isListening ? 'LISTENING' : 'IDLE'}`);
    res.json({ isListening });
});

// Mock external update-status service for testing if needed
app.post('/update-status', (req, res) => {
    console.log('[Mock External API] Received update:', req.body);
    res.json({ success: true });
});

// Get all orders
app.get('/api/orders', (req, res) => {
    res.json(Object.values(orders));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
