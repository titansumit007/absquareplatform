const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const {
  ddb, getClaims, isInGroup, hasClientAccess, json, badRequest, forbidden, withErrorHandling, isValidId,
} = require('../lib/common');

const s3 = new S3Client({});
const BUCKET = process.env.DOCUMENTS_BUCKET;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;

// Presigned GET for a single document. Clients can only ever fetch their own
// documents (clientId is forced to their own sub, never taken from the
// query string); company users/admins must be assigned to that client.
exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  const documentId = event.queryStringParameters?.documentId;
  if (!isValidId(documentId)) return badRequest('A valid documentId query param is required');

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

  // response-content-disposition forces the browser to download the file
  // rather than render it inline -- this is the key defense against a
  // maliciously-crafted file (e.g. an HTML file smuggled in under an
  // allowed extension) executing as active content in the portal's origin.
  const safeName = (existing.Item.fileName || 'document').replace(/"/g, '');
  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: existing.Item.s3Key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn: 60 }
  );

  return json(200, { downloadUrl, fileName: existing.Item.fileName });
});
