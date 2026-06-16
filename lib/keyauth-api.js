const crypto = require('crypto');
const { prisma } = require('./prisma');
const {
  generateSessionId,
  hashPassword,
  verifyPassword,
  addDuration,
} = require('./crypto');
const { success, failure } = require('./response');

function getParams(req) {
  return { ...req.body, ...req.query };
}

async function getApp(name, ownerId) {
  return prisma.application.findFirst({
    where: { name, ownerId, enabled: true },
  });
}

async function isBlacklisted(appId, type, value) {
  if (!value) return false;
  const entry = await prisma.blacklist.findUnique({
    where: { type_value_applicationId: { type, value, applicationId: appId } },
  });
  return !!entry;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0';
}

function formatSubscriptions(subscriptionDate, key = '') {
  return [{
    subscription: 'default',
    key,
    expiry: Math.floor(subscriptionDate.getTime() / 1000).toString(),
  }];
}

async function handleInit(req, res) {
  const { name, ownerid, ver } = getParams(req);
  if (!name || !ownerid) return failure(res, 'Missing name or ownerid');

  const app = await getApp(name, ownerid);
  if (!app) return failure(res, 'Invalid application');

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      sessionId,
      applicationId: app.id,
      ip: getClientIp(req),
      expiresAt,
    },
  });

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

  return success(res, 'Initialized', {
    sessionid: sessionId,
    appinfo: {
      numUsers: await prisma.user.count({ where: { applicationId: app.id } }),
      numOnlineUsers: await prisma.session.count({
        where: { applicationId: app.id, validated: true, expiresAt: { gt: new Date() } },
      }),
      numKeys: await prisma.license.count({ where: { applicationId: app.id } }),
      version: app.version,
      customerPanelLink: `${appUrl}/panel.html`,
    },
  });
}

async function handleRegister(req, res) {
  const { sessionid, username, pass, key, email, hwid } = getParams(req);
  if (!sessionid || !username || !pass || !key) {
    return failure(res, 'Missing required parameters');
  }

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || session.expiresAt < new Date()) return failure(res, 'Invalid session');
  if (session.validated) return failure(res, 'Session already in use');

  const app = session.application;
  if (await isBlacklisted(app.id, 'hwid', hwid)) return failure(res, 'HWID blacklisted');
  if (await isBlacklisted(app.id, 'ip', getClientIp(req))) return failure(res, 'IP blacklisted');

  const existing = await prisma.user.findUnique({
    where: { username_applicationId: { username, applicationId: app.id } },
  });
  if (existing) return failure(res, 'Username already taken');

  const license = await prisma.license.findFirst({
    where: { key, applicationId: app.id, used: false, banned: false },
  });
  if (!license) return failure(res, 'Invalid license key');

  const subscription = addDuration(new Date(), license.duration, license.durationUnit);

  const user = await prisma.user.create({
    data: {
      username,
      password: hashPassword(pass),
      email: email || null,
      hwid: hwid || null,
      ip: getClientIp(req),
      subscription,
      applicationId: app.id,
    },
  });

  await prisma.license.update({
    where: { id: license.id },
    data: { used: true, usedBy: username, hwid: hwid || null },
  });

  await prisma.session.update({
    where: { id: session.id },
    data: { validated: true, userId: user.id },
  });

  return success(res, 'Logged in!', {
    info: {
      username: user.username,
      subscriptions: formatSubscriptions(user.subscription || subscription, license.key),
      ip: user.ip,
      hwid: user.hwid,
      createdate: user.createdAt.toISOString(),
      lastlogin: new Date().toISOString(),
    },
  });
}

async function handleLogin(req, res) {
  const { sessionid, username, pass, hwid } = getParams(req);
  if (!sessionid || !username || !pass) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || session.expiresAt < new Date()) return failure(res, 'Invalid session');

  const app = session.application;
  const user = await prisma.user.findUnique({
    where: { username_applicationId: { username, applicationId: app.id } },
  });
  if (!user) return failure(res, 'Invalid credentials');
  if (user.banned) return failure(res, user.banReason || 'User is banned');
  if (!verifyPassword(pass, user.password)) return failure(res, 'Invalid credentials');

  if (app.hwidCheck && user.hwid && hwid && user.hwid !== hwid) {
    return failure(res, 'HWID mismatch');
  }
  if (await isBlacklisted(app.id, 'hwid', hwid)) return failure(res, 'HWID blacklisted');
  if (await isBlacklisted(app.id, 'ip', getClientIp(req))) return failure(res, 'IP blacklisted');

  if (user.subscription && user.subscription < new Date()) {
    return failure(res, 'Subscription expired');
  }

  if (!user.hwid && hwid) {
    await prisma.user.update({ where: { id: user.id }, data: { hwid } });
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { validated: true, userId: user.id },
  });

  return success(res, 'Logged in!', {
    info: {
      username: user.username,
      subscriptions: formatSubscriptions(user.subscription || new Date()),
      ip: getClientIp(req),
      hwid: hwid || user.hwid,
      createdate: user.createdAt.toISOString(),
      lastlogin: new Date().toISOString(),
    },
  });
}

async function handleLicense(req, res) {
  const { sessionid, key, hwid } = getParams(req);
  if (!sessionid || !key) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || session.expiresAt < new Date()) return failure(res, 'Invalid session');

  const app = session.application;
  const license = await prisma.license.findFirst({
    where: { key, applicationId: app.id, banned: false },
  });
  if (!license) return failure(res, 'Invalid license key');

  if (await isBlacklisted(app.id, 'hwid', hwid)) return failure(res, 'HWID blacklisted');
  if (await isBlacklisted(app.id, 'ip', getClientIp(req))) return failure(res, 'IP blacklisted');

  const username = `user_${key.slice(0, 8)}`;

  const finishLogin = async (user) => {
    if (user.banned) return failure(res, user.banReason || 'User is banned');
    if (user.subscription && user.subscription < new Date()) {
      return failure(res, 'Subscription expired');
    }

    if (app.hwidCheck && user.hwid && hwid && user.hwid !== hwid) {
      return failure(res, 'HWID mismatch');
    }

    if (!user.hwid && hwid) {
      await prisma.user.update({ where: { id: user.id }, data: { hwid } });
      user.hwid = hwid;
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { validated: true, userId: user.id },
    });

    return success(res, 'Logged in!', {
      info: {
        username: user.username,
        subscriptions: formatSubscriptions(user.subscription || new Date(), license.key),
        ip: getClientIp(req),
        hwid: hwid || user.hwid,
        createdate: user.createdAt.toISOString(),
        lastlogin: new Date().toISOString(),
      },
    });
  };

  if (license.used) {
    const user = await prisma.user.findUnique({
      where: { username_applicationId: { username, applicationId: app.id } },
    });
    if (!user) return failure(res, 'License already used on another account');
    return finishLogin(user);
  }

  const subscription = addDuration(new Date(), license.duration, license.durationUnit);

  let user = await prisma.user.findUnique({
    where: { username_applicationId: { username, applicationId: app.id } },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        username,
        password: hashPassword(crypto.randomBytes(16).toString('hex')),
        hwid: hwid || null,
        ip: getClientIp(req),
        subscription,
        applicationId: app.id,
      },
    });
  }

  await prisma.license.update({
    where: { id: license.id },
    data: { used: true, usedBy: username, hwid: hwid || null },
  });

  return finishLogin(user);
}

async function handleLogout(req, res) {
  const { sessionid } = getParams(req);
  if (!sessionid) return failure(res, 'Missing sessionid');

  await prisma.session.deleteMany({ where: { sessionId: sessionid } });
  return success(res, 'Logged out');
}

async function handleCheck(req, res) {
  const { sessionid } = getParams(req);
  if (!sessionid) return failure(res, 'Missing sessionid');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { user: true },
  });
  if (!session || !session.validated || session.expiresAt < new Date()) {
    return failure(res, 'Session invalid');
  }

  return success(res, 'Session valid', {
    info: session.user
      ? {
          username: session.user.username,
          subscriptions: formatSubscriptions(session.user.subscription || new Date()),
        }
      : {},
  });
}

async function handleCheckBlack(req, res) {
  const { sessionid, hwid } = getParams(req);
  if (!sessionid) return failure(res, 'Missing sessionid');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || session.expiresAt < new Date()) return failure(res, 'Invalid session');

  const app = session.application;
  if (await isBlacklisted(app.id, 'hwid', hwid)) return failure(res, 'HWID blacklisted');
  if (await isBlacklisted(app.id, 'ip', getClientIp(req))) return failure(res, 'IP blacklisted');

  return success(res, 'Not blacklisted');
}

async function handleUpgrade(req, res) {
  const { sessionid, username, key } = getParams(req);
  if (!sessionid || !username || !key) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || session.expiresAt < new Date()) return failure(res, 'Invalid session');

  const app = session.application;
  const user = await prisma.user.findUnique({
    where: { username_applicationId: { username, applicationId: app.id } },
  });
  if (!user) return failure(res, 'User not found');

  const license = await prisma.license.findFirst({
    where: { key, applicationId: app.id, used: false, banned: false },
  });
  if (!license) return failure(res, 'Invalid license key');

  const base = user.subscription && user.subscription > new Date() ? user.subscription : new Date();
  const subscription = addDuration(base, license.duration, license.durationUnit);

  await prisma.user.update({ where: { id: user.id }, data: { subscription } });
  await prisma.license.update({
    where: { id: license.id },
    data: { used: true, usedBy: username },
  });

  return success(res, 'Upgraded successfully');
}

async function handleVar(req, res) {
  const { sessionid, varid } = getParams(req);
  if (!sessionid || !varid) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { application: true },
  });
  if (!session || !session.validated) return failure(res, 'Invalid session');

  const variable = await prisma.variable.findUnique({
    where: { varId_applicationId: { varId: varid, applicationId: session.applicationId } },
  });
  if (!variable) return failure(res, 'Variable not found');
  if (variable.authed && !session.validated) return failure(res, 'Unauthorized');

  return success(res, 'Retrieved variable', { response: variable.value });
}

async function handleGetVar(req, res) {
  const { sessionid, var: varName } = getParams(req);
  if (!sessionid || !varName) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { user: true },
  });
  if (!session || !session.validated || !session.user) return failure(res, 'Invalid session');

  const variable = await prisma.userVariable.findUnique({
    where: { name_userId: { name: varName, userId: session.user.id } },
  });
  if (!variable) return failure(res, 'Variable not found');

  return success(res, 'Retrieved user variable', { response: variable.value });
}

async function handleSetVar(req, res) {
  const { sessionid, var: varName, data } = getParams(req);
  if (!sessionid || !varName || data === undefined) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { user: true },
  });
  if (!session || !session.validated || !session.user) return failure(res, 'Invalid session');

  await prisma.userVariable.upsert({
    where: { name_userId: { name: varName, userId: session.user.id } },
    create: { name: varName, value: data, userId: session.user.id },
    update: { value: data },
  });

  return success(res, 'Set user variable');
}

async function handleChatGet(req, res) {
  const { sessionid, channel } = getParams(req);
  if (!sessionid) return failure(res, 'Missing sessionid');

  const session = await prisma.session.findUnique({ where: { sessionId: sessionid } });
  if (!session || !session.validated) return failure(res, 'Invalid session');

  const messages = await prisma.chatMessage.findMany({
    where: { applicationId: session.applicationId, channel: channel || 'main' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return success(res, 'Retrieved messages', {
    messages: messages.reverse().map((m) => ({
      author: m.author,
      message: m.message,
      timestamp: m.createdAt.toISOString(),
    })),
  });
}

async function handleChatSend(req, res) {
  const { sessionid, message, channel } = getParams(req);
  if (!sessionid || !message) return failure(res, 'Missing required parameters');

  const session = await prisma.session.findUnique({
    where: { sessionId: sessionid },
    include: { user: true },
  });
  if (!session || !session.validated || !session.user) return failure(res, 'Invalid session');

  await prisma.chatMessage.create({
    data: {
      author: session.user.username,
      message,
      channel: channel || 'main',
      applicationId: session.applicationId,
    },
  });

  return success(res, 'Message sent');
}

const handlers = {
  init: handleInit,
  register: handleRegister,
  login: handleLogin,
  license: handleLicense,
  logout: handleLogout,
  check: handleCheck,
  checkblack: handleCheckBlack,
  upgrade: handleUpgrade,
  var: handleVar,
  getvar: handleGetVar,
  setvar: handleSetVar,
  chatget: handleChatGet,
  chatsend: handleChatSend,
};

async function handleKeyAuthApi(req, res) {
  const params = getParams(req);
  const type = params.type;
  if (!type || !handlers[type]) {
    return failure(res, 'Invalid type parameter');
  }
  req.query = { ...req.query, ...params };
  try {
    await handlers[type](req, res);
  } catch (err) {
    console.error('KeyAuth API error:', err);
    return failure(res, 'Internal server error', 500);
  }
}

module.exports = { handleKeyAuthApi };
