const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, getClaims, isInGroup, json, forbidden, withErrorHandling } = require('../lib/common');

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

  return json(200, { documents: result.Items || [] });
});
