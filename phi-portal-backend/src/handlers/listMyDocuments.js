const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  ddb, getClaims, isInGroup, json, forbidden, withErrorHandling, isExpired, publicDocument, RETENTION_DAYS,
} = require('../lib/common');

const DOCS_TABLE = process.env.DOCUMENTS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Clients')) return forbidden('Clients only');

  const result = await ddb.send(new QueryCommand({
    TableName: DOCS_TABLE,
    KeyConditionExpression: 'clientId = :cid',
    ExpressionAttributeValues: { ':cid': claims.sub },
    ScanIndexForward: false,
  }));

  const documents = (result.Items || [])
    .filter((doc) => !isExpired(doc))
    .map(publicDocument);

  return json(200, { documents, retentionDays: RETENTION_DAYS });
});
