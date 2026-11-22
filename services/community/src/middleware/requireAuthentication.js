const serviceName = process.env.SERVICE_NAME;
const serviceKey = process.env.AUTH_SERVICE_KEY;
const identityBaseUrl = process.env.IDENTITY_BASE_URL;

if (
  serviceName !== 'community' ||
  !/^[a-f0-9]{64}$/.test(serviceKey || '') ||
  !identityBaseUrl
) {
  throw new Error('Missing or invalid identity service configuration.');
}

function authError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function requireAuthentication(req, res, next) {
  const authorization = req.get('Authorization') || '';

  if (!/^Bearer [a-f0-9]{64}$/i.test(authorization)) {
    throw authError(401, 'UNAUTHORIZED', 'A valid session is required.');
  }

  try {
    const response = await fetch(
      identityBaseUrl.replace(/\/+$/, '') + '/internal/v1/auth/introspect',
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'X-Service-Name': serviceName,
          'X-Service-Key': serviceKey
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (response.status === 401) {
      throw authError(401, 'UNAUTHORIZED', 'A valid session is required.');
    }

    if (!response.ok) {
      throw authError(
        503,
        'AUTH_UNAVAILABLE',
        'Authentication is temporarily unavailable.'
      );
    }

    const { data } = await response.json();

    if (
      !data ||
      typeof data.userId !== 'string' ||
      !['ADMIN', 'RESIDENT'].includes(data.role) ||
      data.status !== 'ACTIVE' ||
      (data.role === 'RESIDENT' && !data.unitId)
    ) {
      throw authError(
        503,
        'AUTH_UNAVAILABLE',
        'Authentication is temporarily unavailable.'
      );
    }

    req.auth = {
      user: {
        id: data.userId,
        email: data.email,
        fullName: data.fullName,
        role: data.role,
        unitId: data.unitId,
        buildingId: data.buildingId
      }
    };
  } catch (error) {
    if (error.status) {
      throw error;
    }

    throw authError(
      503,
      'AUTH_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
  }

  next();
}

