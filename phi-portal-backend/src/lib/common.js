const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// API Gateway HTTP API + JWT authorizer puts the verified Cognito token
// claims here. We never trust anything the client sends for identity --
// always read userId/groups from this object.
function getClaims(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const sub = claims.sub;
  let groups = claims['cognito:groups'] || [];
  if (typeof groups === 'string') {
    // HTTP API sometimes flattens the groups claim to a string like "[Clients]" or "Clients,Admins"
    groups = groups.replace(/[\[\]]/g, '').split(',').map(g => g.trim()).filter(Boolean);
  }
  return { sub, email: claims.email, groups };
}

function isInGroup(claims, groupName) {
  return Array.isArray(claims.groups) && claims.groups.includes(groupName);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// CORS is configured at the API Gateway (HTTP API) level and applies to every
// response automatically, including 4xx/5xx from the Lambda -- so handlers
// don't need to set Access-Control-* headers themselves. We do add a couple
// of defensive headers here since they're cheap and apply everywhere PHI
// might be reflected back to a browser.
const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: SECURITY_HEADERS,
    body: JSON.stringify(body),
  };
}

function badRequest(message) {
  return json(400, { message });
}

function forbidden(message) {
  return json(403, { message });
}

// Wraps a handler so an unexpected error (bad JSON body, a downstream AWS
// SDK exception, etc.) always becomes a clean 500 instead of a raw Lambda
// crash / stack trace leaking to the client.
function withErrorHandling(handler) {
  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (err) {
      if (err && err.statusCode) {
        return json(err.statusCode, { message: err.message });
      }
      console.error('Unhandled error in handler:', err);
      return json(500, { message: 'Internal server error' });
    }
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Cognito "sub" values are UUIDs too; client/user ids in this app are always
// Cognito subs, so the same pattern validates both.
function isValidId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

// Cognito "Username" in this pool is an auto-generated id (UUID-shaped), while
// email is only a sign-in alias. Older deployments incorrectly required email
// format here, which made every Disable/Delete call return 400. Accept either
// a UUID-like Cognito username or an email (for pools / users created that way).
function isValidCognitoUsername(value) {
  if (typeof value !== 'string') return false;
  const username = value.trim();
  if (!username || username.length > 128) return false;
  return isValidId(username) || isValidEmail(username);
}

// Cognito Admin APIs need a real boolean; tolerate JSON that arrived as
// "true"/"false" strings so a single mis-serialized body doesn't 400.
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Allow-list of document types this portal is meant to exchange. Deliberately
// excludes anything executable or script-bearing (html, svg, js, exe, etc.)
// so an uploaded file can never be rendered as active content even if it
// were ever opened directly rather than downloaded.
const ALLOWED_CONTENT_TYPES = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/tiff': ['tif', 'tiff'],
  'text/plain': ['txt'],
};
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// Strips path separators, control characters, and anything that isn't a
// "normal" filename character, then caps the length. This is what gets
// stored as the S3 key suffix (never trust a client-supplied filename to be
// safe for a key or a Content-Disposition header) and reflected back in the
// UI, where the frontend additionally HTML-escapes it before rendering.
function sanitizeFileName(rawName) {
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  const base = rawName
    .replace(/[\\/]/g, '_')          // no path separators
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f"]/g, '') // no control chars or quotes (Content-Disposition safety)
    .replace(/\.{2,}/g, '_')          // collapse runs of 2+ dots so '..' can't survive
                                       // (e.g. after '/' -> '_', "../.." becomes ".._..",
                                       // which still contains '..' unless we do this too)
    .trim()
    .slice(0, 200);
  return base || null;
}

function extensionOf(fileName) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName || '');
  return m ? m[1].toLowerCase() : '';
}

function isAllowedUpload(fileName, contentType) {
  const allowedExts = ALLOWED_CONTENT_TYPES[contentType];
  if (!allowedExts) return false;
  return allowedExts.includes(extensionOf(fileName));
}

// Shared access check: admins see all clients; company users need a row in CLIENT_ACCESS_TABLE.
async function hasClientAccess(claims, clientId, accessTable) {
  if (isInGroup(claims, 'Admins')) return true;
  if (!isInGroup(claims, 'CompanyUsers')) return false;
  const res = await ddb.send(new GetCommand({
    TableName: accessTable,
    Key: { userId: claims.sub, clientId },
  }));
  return !!res.Item;
}

module.exports = {
  ddb,
  getClaims,
  isInGroup,
  hasClientAccess,
  json,
  badRequest,
  forbidden,
  withErrorHandling,
  parseJsonBody,
  isValidId,
  isValidEmail,
  isValidCognitoUsername,
  parseBoolean,
  sanitizeFileName,
  extensionOf,
  isAllowedUpload,
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
};
