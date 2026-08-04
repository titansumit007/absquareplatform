const { QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, isValidId } = require('../lib/common');

const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const userId = event.queryStringParameters?.userId;
  const clientId = event.queryStringParameters?.clientId;

  if (userId) {
    if (!isValidId(userId)) return badRequest('userId must be a valid id');
    const res = await ddb.send(new QueryCommand({
      TableName: ACCESS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }));
    return json(200, { assignments: res.Items || [] });
  }

  if (clientId) {
    if (!isValidId(clientId)) return badRequest('clientId must be a valid id');
    // Reverse lookup (which staff have access to this client) -- a small scan is fine
    // at this table's scale; add a GSI on clientId if this ever needs to run at volume.
    const res = await ddb.send(new ScanCommand({
      TableName: ACCESS_TABLE,
      FilterExpression: 'clientId = :cid',
      ExpressionAttributeValues: { ':cid': clientId },
    }));
    return json(200, { assignments: res.Items || [] });
  }

  return badRequest('userId or clientId query param is required');
});
