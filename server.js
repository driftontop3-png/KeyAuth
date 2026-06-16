require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { handleKeyAuthApi } = require('./lib/keyauth-api');
const { handleSellerApi } = require('./lib/seller-api');
const { createApplication, getApplicationByOwnerId } = require('./lib/app-generator');
const { success, failure } = require('./lib/response');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/1.3', handleKeyAuthApi);
app.post('/api/1.3', handleKeyAuthApi);

app.get('/api/seller', handleSellerApi);
app.post('/api/seller', handleSellerApi);

app.post('/api/app/create', async (req, res) => {
  try {
    const { name } = req.body;
    const appData = await createApplication(name);
    return success(res, 'Application created automatically', { app: appData });
  } catch (err) {
    console.error('Create app error:', err);
    return failure(res, 'Failed to create application', 500);
  }
});

app.get('/api/app/:ownerId', async (req, res) => {
  try {
    const appData = await getApplicationByOwnerId(req.params.ownerId);
    if (!appData) return failure(res, 'Application not found', 404);
    return success(res, 'Application found', {
      app: {
        name: appData.name,
        ownerId: appData.ownerId,
        secret: appData.secret,
        version: appData.version,
        enabled: appData.enabled,
        hwidCheck: appData.hwidCheck,
        stats: appData._count,
      },
    });
  } catch (err) {
    console.error('Get app error:', err);
    return failure(res, 'Failed to fetch application', 500);
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'KeyAuth Self-Hosted' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`KeyAuth Self-Hosted running on http://localhost:${PORT}`);
  });
}

module.exports = app;
