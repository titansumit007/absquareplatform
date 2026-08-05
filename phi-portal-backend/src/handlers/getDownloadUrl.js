const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  ddb, getClaims, isInGroup, hasClientAccess, json, badRequest, forbidden, withErrorHandling, isValidId,
  isExpired, buildActivityEntry, nextActivityLog,
} = require('../lib/common');

const s3 = new S3Client({});
const BUCKET = process.env.DOCUMENTS_BUCKET;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;

const PREVIEWABLE = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'text/plain',
]);

// Presigned GET for a single document. Clients can only ever fetch their own
// documents (clientId is forced to their own sub, never taken from the
// query string); company users/admins must be assigned to that client.
// ?preview=1 returns an inline URL for in-app viewing and records a footprint.
exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  const documentId = event.queryStringParameters?.documentId;
  if (!isValidId(documentId)) return badRequest('A valid documentId query param is required');

  const preview = event.queryStringParameters?.preview === '1'
    || event.queryStringParameters?.preview === 'true';

  let clientId;
  if (isInGroup(claims, 'Clients')) {
    clientId = claims.sub;
  } else if (isInGroup(claims, 'CompanyUsers') || isInGroup(claims, 'Admins')) {
    clientId = event.queryStringParameters?.clientId;
    if (!isValidId(clientId)) return badRequest('A valid clientId query param is required');
    if (!(await hasClientAccess(claims, clientId, ACCESS_TABLE))) {
      return forbidden('You are not assigned to this client');
    }
  } else {
    return forbidden('Not authorized');
  }

  const existing = await ddb.send(new GetCommand({ TableName: DOCS_TABLE, Key: { clientId, documentId } }));
  if (!existing.Item) return json(404, { message: 'Document not found' });
  if (isExpired(existing.Item)) {
    return json(410, { message: 'This document has passed its 30-day retention period and is no longer available.' });
  }

  const contentType = existing.Item.contentType || 'application/octet-stream';
  if (preview && !PREVIEWABLE.has(contentType)) {
    return badRequest('In-app preview is available for PDF, images, and plain text only. Download the file instead.');
  }

  const safeName = (existing.Item.fileName || 'document').replace(/"/g, '');
  const disposition = preview
    ? `inline; filename="${safeName}"`
    : `attachment; filename="${safeName}"`;

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: existing.Item.s3Key,
      ResponseContentDisposition: disposition,
      ResponseContentType: contentType,
    }),
    { expiresIn: preview ? 120 : 60 }
  );

  const action = preview ? 'preview' : 'download';
  const entry = buildActivityEntry(claims, action, preview ? 'Opened in-app preview' : 'Downloaded file');
  const activityLog = nextActivityLog(existing.Item.activityLog, entry);
  try {
    await ddb.send(new UpdateCommand({
      TableName: DOCS_TABLE,
      Key: { clientId, documentId },
      UpdateExpression: 'SET activityLog = :log, updatedAt = :now',
      ExpressionAttributeValues: {
        ':log': activityLog,
        ':now': entry.at,
      },
    }));
  } catch (err) {
    console.error('Failed to write access footprint (URL still issued):', err);
  }

  return json(200, {
    downloadUrl,
    fileName: existing.Item.fileName,
    contentType,
    previewable: PREVIEWABLE.has(contentType),
    activityLog,
  });
});
