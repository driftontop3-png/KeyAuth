const crypto = require('crypto');
const { customAlphabet } = require('nanoid');

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(alphabet, 10);
const licenseAlphabet = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 20);

function generateOwnerId() {
  return nanoid();
}

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(licenseAlphabet(5));
  }
  return segments.join('-');
}

function generateNonce() {
  return crypto.randomBytes(8).toString('hex');
}

function hashPassword(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(password, hash);
}

function addDuration(date, amount, unit) {
  const result = new Date(date);
  switch (unit) {
    case 'minutes':
      result.setMinutes(result.getMinutes() + amount);
      break;
    case 'hours':
      result.setHours(result.getHours() + amount);
      break;
    case 'days':
      result.setDate(result.getDate() + amount);
      break;
    case 'weeks':
      result.setDate(result.getDate() + amount * 7);
      break;
    case 'months':
      result.setMonth(result.getMonth() + amount);
      break;
    case 'years':
      result.setFullYear(result.getFullYear() + amount);
      break;
    case 'lifetime':
      result.setFullYear(result.getFullYear() + 100);
      break;
    default:
      result.setDate(result.getDate() + amount);
  }
  return result;
}

module.exports = {
  generateOwnerId,
  generateSecret,
  generateSessionId,
  generateLicenseKey,
  generateNonce,
  hashPassword,
  verifyPassword,
  addDuration,
};
