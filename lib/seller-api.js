const { prisma } = require('./prisma');
const { verifySellerAuth } = require('./app-generator');
const { generateLicenseKey } = require('./crypto');
const { success, failure } = require('./response');

const MAX_LICENSES_PER_REQUEST = 10000;

async function authenticate(req) {
  const ownerId = req.headers['x-owner-id'] || req.query.ownerid || req.body?.ownerid;
  const secret = req.headers['x-secret'] || req.query.secret || req.body?.secret;
  if (!ownerId || !secret) return null;
  return verifySellerAuth(ownerId, secret);
}

async function handleSellerApi(req, res) {
  const app = await authenticate(req);
  if (!app) return failure(res, 'Unauthorized', 401);

  const action = req.query.action || req.body?.action;
  if (!action) return failure(res, 'Missing action');

  try {
    switch (action) {
      case 'createapp':
        return failure(res, 'App already exists. Use dashboard to manage.');

      case 'fetchstats':
        return success(res, 'Stats retrieved', {
          stats: {
            users: await prisma.user.count({ where: { applicationId: app.id } }),
            licenses: await prisma.license.count({ where: { applicationId: app.id } }),
            unusedLicenses: await prisma.license.count({
              where: { applicationId: app.id, used: false },
            }),
            sessions: await prisma.session.count({
              where: { applicationId: app.id, validated: true },
            }),
          },
        });

      case 'createlicense': {
        const rawAmount = parseInt(req.query.amount || req.body?.amount || '1', 10);
        const amount = Math.min(Math.max(rawAmount, 1), MAX_LICENSES_PER_REQUEST);
        const duration = parseInt(req.query.duration || req.body?.duration || '30', 10);
        const durationUnit = req.query.durationUnit || req.body?.durationUnit || 'days';
        const note = req.query.note || req.body?.note || '';
        const keys = [];

        for (let i = 0; i < amount; i++) {
          const key = generateLicenseKey();
          await prisma.license.create({
            data: { key, duration, durationUnit, note, applicationId: app.id },
          });
          keys.push(key);
        }

        return success(res, `${keys.length} license(s) created`, { keys });
      }

      case 'fetchlicenses': {
        const licenses = await prisma.license.findMany({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        });
        return success(res, 'Licenses retrieved', {
          licenses: licenses.map((l) => ({
            key: l.key,
            used: l.used,
            banned: l.banned,
            note: l.note,
            usedBy: l.usedBy,
            duration: l.duration,
            durationUnit: l.durationUnit,
            createdAt: l.createdAt.toISOString(),
          })),
        });
      }

      case 'deletelicense': {
        const key = req.query.key || req.body?.key;
        if (!key) return failure(res, 'Missing key');
        await prisma.license.deleteMany({ where: { key, applicationId: app.id } });
        return success(res, 'License deleted');
      }

      case 'banlicense': {
        const key = req.query.key || req.body?.key;
        const reason = req.query.reason || req.body?.reason || 'Banned by seller';
        if (!key) return failure(res, 'Missing key');
        await prisma.license.updateMany({
          where: { key, applicationId: app.id },
          data: { banned: true, banReason: reason },
        });
        return success(res, 'License banned');
      }

      case 'unbanlicense': {
        const key = req.query.key || req.body?.key;
        if (!key) return failure(res, 'Missing key');
        await prisma.license.updateMany({
          where: { key, applicationId: app.id },
          data: { banned: false, banReason: null },
        });
        return success(res, 'License unbanned');
      }

      case 'setnote': {
        const key = req.query.key || req.body?.key;
        const note = req.query.note || req.body?.note || '';
        if (!key) return failure(res, 'Missing key');
        await prisma.license.updateMany({
          where: { key, applicationId: app.id },
          data: { note },
        });
        return success(res, 'Note updated');
      }

      case 'fetchusers': {
        const users = await prisma.user.findMany({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        });
        return success(res, 'Users retrieved', {
          users: users.map((u) => ({
            username: u.username,
            email: u.email,
            hwid: u.hwid,
            banned: u.banned,
            subscription: u.subscription?.toISOString(),
            createdAt: u.createdAt.toISOString(),
          })),
        });
      }

      case 'banuser': {
        const username = req.query.username || req.body?.username;
        const reason = req.query.reason || req.body?.reason || 'Banned by seller';
        if (!username) return failure(res, 'Missing username');
        await prisma.user.updateMany({
          where: { username, applicationId: app.id },
          data: { banned: true, banReason: reason },
        });
        return success(res, 'User banned');
      }

      case 'unbanuser': {
        const username = req.query.username || req.body?.username;
        if (!username) return failure(res, 'Missing username');
        await prisma.user.updateMany({
          where: { username, applicationId: app.id },
          data: { banned: false, banReason: null },
        });
        return success(res, 'User unbanned');
      }

      case 'deleteuser': {
        const username = req.query.username || req.body?.username;
        if (!username) return failure(res, 'Missing username');
        await prisma.user.deleteMany({ where: { username, applicationId: app.id } });
        return success(res, 'User deleted');
      }

      case 'addtime': {
        const username = req.query.username || req.body?.username;
        const days = parseInt(req.query.days || req.body?.days || '30', 10);
        if (!username) return failure(res, 'Missing username');
        const user = await prisma.user.findUnique({
          where: { username_applicationId: { username, applicationId: app.id } },
        });
        if (!user) return failure(res, 'User not found');
        const base = user.subscription && user.subscription > new Date() ? user.subscription : new Date();
        base.setDate(base.getDate() + days);
        await prisma.user.update({ where: { id: user.id }, data: { subscription: base } });
        return success(res, 'Time added');
      }

      case 'setvar': {
        const varId = req.query.varid || req.body?.varid;
        const value = req.query.value || req.body?.value;
        const authed = (req.query.authed || req.body?.authed) === 'true';
        if (!varId || value === undefined) return failure(res, 'Missing varid or value');
        await prisma.variable.upsert({
          where: { varId_applicationId: { varId, applicationId: app.id } },
          create: { varId, value, authed, applicationId: app.id },
          update: { value, authed },
        });
        return success(res, 'Variable set');
      }

      case 'delvar': {
        const varId = req.query.varid || req.body?.varid;
        if (!varId) return failure(res, 'Missing varid');
        await prisma.variable.deleteMany({ where: { varId, applicationId: app.id } });
        return success(res, 'Variable deleted');
      }

      case 'fetchvars': {
        const vars = await prisma.variable.findMany({ where: { applicationId: app.id } });
        return success(res, 'Variables retrieved', {
          variables: vars.map((v) => ({
            varId: v.varId,
            value: v.value,
            authed: v.authed,
          })),
        });
      }

      case 'addblacklist': {
        const type = req.query.blacklistType || req.body?.blacklistType;
        const value = req.query.value || req.body?.value;
        const reason = req.query.reason || req.body?.reason || '';
        if (!type || !value) return failure(res, 'Missing type or value');
        await prisma.blacklist.upsert({
          where: { type_value_applicationId: { type, value, applicationId: app.id } },
          create: { type, value, reason, applicationId: app.id },
          update: { reason },
        });
        return success(res, 'Added to blacklist');
      }

      case 'delblacklist': {
        const type = req.query.blacklistType || req.body?.blacklistType;
        const value = req.query.value || req.body?.value;
        if (!type || !value) return failure(res, 'Missing type or value');
        await prisma.blacklist.deleteMany({ where: { type, value, applicationId: app.id } });
        return success(res, 'Removed from blacklist');
      }

      case 'fetchblacklist': {
        const list = await prisma.blacklist.findMany({ where: { applicationId: app.id } });
        return success(res, 'Blacklist retrieved', {
          blacklist: list.map((b) => ({ type: b.type, value: b.value, reason: b.reason })),
        });
      }

      case 'updateapp': {
        const data = {};
        if (req.query.name || req.body?.name) data.name = req.query.name || req.body.name;
        if (req.query.version || req.body?.version) data.version = req.query.version || req.body.version;
        if (req.query.hwidCheck !== undefined || req.body?.hwidCheck !== undefined) {
          data.hwidCheck = (req.query.hwidCheck || req.body.hwidCheck) === 'true';
        }
        await prisma.application.update({ where: { id: app.id }, data });
        return success(res, 'App updated');
      }

      case 'addwebhook': {
        const url = req.query.url || req.body?.url;
        if (!url) return failure(res, 'Missing url');
        await prisma.webhook.create({ data: { url, applicationId: app.id } });
        return success(res, 'Webhook added');
      }

      case 'delalllicenses': {
        const used = req.query.used || req.body?.used;
        const where = { applicationId: app.id };
        if (used === 'true') where.used = true;
        if (used === 'false') where.used = false;
        await prisma.license.deleteMany({ where });
        return success(res, 'Licenses deleted');
      }

      default:
        return failure(res, 'Unknown action');
    }
  } catch (err) {
    console.error('Seller API error:', err);
    return failure(res, 'Internal server error', 500);
  }
}

module.exports = { handleSellerApi };
