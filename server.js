require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const chalk = require('chalk');
const SpeechService = require('./src/speech-service');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory data store
let orders = {};

const STATUS_MAP = {
    [process.env.STATUS_PREPARING || 20]: 'Hazırlanıyor',
    [process.env.STATUS_PREPARED || 30]: 'Hazır',
    [process.env.STATUS_DELIVERED || 40]: 'Teslim Edildi'
};

// --- LOGIC FUNCTIONS ---

async function updateOrderLocally(id, statusCode) {
    // Fuzzy match logic
    let targetOrder = orders[id];

    // 1. Exact match failed? Try case-insensitive and numeric-only match
    if (!targetOrder) {
        const spokenIdClean = id.toUpperCase().replace('-', '');
        targetOrder = Object.values(orders).find(o => {
            const oIdClean = o.id.toUpperCase().replace('-', '');
            // Match if cleaned IDs are same OR if the spoken numeric part is in the order ID
            const numericPart = id.match(/\d+/);
            if (oIdClean === spokenIdClean) return true;
            if (numericPart && o.id.includes(numericPart[0])) return true;
            return false;
        });
    }

    if (!targetOrder) {
        console.log(chalk.red(`[Error]: Match found for ID "${id}", but order not found in system.`));
        speechService.speak("Anlayamadım");
        return;
    }

    const orderId = targetOrder.id;
    const now = Date.now();
    orders[orderId].statusCode = statusCode;
    orders[orderId].status = STATUS_MAP[statusCode] || 'Bilinmiyor';
    orders[orderId].updatedAt = now;

    console.log(chalk.green(`\n✅ [Action]: Order ${orderId} updated to ${orders[orderId].status} (${statusCode})`));
    speechService.speak(`Sipariş ${orderId} ${orders[orderId].status}`);

    // Call external API if configured
    if (process.env.UPDATE_STATUS_BASE_URL) {
        try {
            const externalUrl = `${process.env.UPDATE_STATUS_BASE_URL}/update-status`;
            const payload = { status: statusCode, kdsOrderId: orderId };
            await axios.post(externalUrl, payload);
        } catch (err) {
            console.error(chalk.red(`[External Alert]: Failed to update external KDS: ${err.message}`));
        }
    }
}

// --- SPEECH SERVICE ---

const speechService = new SpeechService(updateOrderLocally);
speechService.init();

// --- API ROUTES (Headless Ingestion) ---

app.post('/api/orders/ingest', (req, res) => {
    const { kdsOrderId, orderId } = req.body;
    const id = kdsOrderId || orderId;

    if (!id) return res.status(400).json({ success: false, error: 'Order ID required' });

    const statusCode = parseInt(process.env.STATUS_PREPARING) || 20;
    orders[id] = {
        id: id,
        status: STATUS_MAP[statusCode],
        statusCode: statusCode,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    console.log(chalk.magenta(`\n📥 [Ingest]: New order received: ${id}`));
    res.json({ success: true, order: orders[id] });
});

app.get('/api/orders', (req, res) => res.json(Object.values(orders)));

// --- STARTUP ---

console.clear();
console.log(chalk.bold.cyan('========================================'));
console.log(chalk.bold.cyan('   HERMA REWIND - OFFLINE VOICE CLI    '));
console.log(chalk.bold.cyan('========================================'));

app.listen(PORT, () => {
    console.log(chalk.gray(`📡 REST Ingest API active on port ${PORT}`));
    speechService.start();
});
