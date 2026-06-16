const { generateNonce } = require('./crypto');

function success(res, message, extra = {}) {
  return res.json({
    success: true,
    message,
    nonce: generateNonce(),
    ...extra,
  });
}

function failure(res, message, status = 400) {
  return res.status(status).json({
    success: false,
    message,
    nonce: generateNonce(),
  });
}

module.exports = { success, failure };
