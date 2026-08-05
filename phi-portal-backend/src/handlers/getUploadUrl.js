const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const {
  ddb, getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody,
  sanitizeFileName, isAllowedUpload, ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES,
  retentionTimestamps, RETENTION_DAYS, buildActivityEntry,
} = require('../lib/common');

const s3 = new S3Client({});
const BUCKET = process.env.DOCUMENTS_BUCKET;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Clients')) return forbidden('Clients only');

  const body = parseJsonBody(event);
  const fileName = sanitizeFileName(body.fileName);
  const contentType = body.contentType;

  if (!fileName) return badRequest('fileName is required');
  if (!contentType || !ALLOWED_CONTENT_TYPES[contentType]) {
    return badRequest(`contentType must be one of: ${Object.keys(ALLOWED_CONTENT_TYPES).join(', ')}`);
  }
  if (!isAllowedUpload(fileName, contentType)) {
    return badRequest('The file extension does not match the declared content type');
  }

  const clientId = claims.sub;
  const documentId = randomUUID();
  const s3Key = `${clientId}/${documentId}/${fileName}`;

  // A presigned POST (rather than a presigned PUT) lets us enforce the
  // content type AND a hard size cap as conditions that S3 itself checks --
  // a presigned PUT URL has no mechanism to bound the upload size, so a
  // client could stream an arbitrarily large object straight into the
  // bucket. SSE-KMS encryption is applied automatically by the bucket's
  // default encryption configuration (see deployment guide, step 4), so it
  // does not need to be signed into the policy here.
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: s3Key,
    Conditions: [
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: {
      'Content-Type': contentType,
    },
    Expires: 300, // seconds
  });

  const now = new Date();
  const { uploadedAt, expiresAt, ttl } = retentionTimestamps(now);
  const uploadEntry = buildActivityEntry(claims, 'upload', 'Document uploaded');

  await ddb.send(new PutCommand({
    TableName: DOCS_TABLE,
    Item: {
      clientId,
      documentId,
      fileName,
      s3Key,
      contentType,
      status: 'open',
      uploadedAt,
      updatedAt: uploadedAt,
      expiresAt,
      ttl,
      uploadedBy: clientId,
      clientEmail: claims.email,
      activityLog: [uploadEntry],
      retentionDays: RETENTION_DAYS,
    },
  }));

  return json(200, {
    documentId,
    uploadUrl: url,
    uploadFields: fields,
    s3Key,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    expiresAt,
    retentionDays: RETENTION_DAYS,
  });
});
