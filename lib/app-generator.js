const { prisma } = require('./prisma');
const { generateOwnerId, generateSecret } = require('./crypto');

async function createApplication(name) {
  const ownerId = generateOwnerId();
  const secret = generateSecret();
  const appName = name || `App-${ownerId.slice(0, 6)}`;

  const app = await prisma.application.create({
    data: {
      name: appName,
      ownerId,
      secret,
      version: '1.0',
    },
  });

  return {
    id: app.id,
    name: app.name,
    ownerId: app.ownerId,
    secret: app.secret,
    version: app.version,
  };
}

async function getApplicationByOwnerId(ownerId) {
  return prisma.application.findUnique({
    where: { ownerId },
    include: {
      _count: {
        select: {
          users: true,
          licenses: true,
          sessions: true,
        },
      },
    },
  });
}

async function verifySellerAuth(ownerId, secret) {
  const app = await prisma.application.findUnique({ where: { ownerId } });
  if (!app || app.secret !== secret) return null;
  return app;
}

module.exports = {
  createApplication,
  getApplicationByOwnerId,
  verifySellerAuth,
};
