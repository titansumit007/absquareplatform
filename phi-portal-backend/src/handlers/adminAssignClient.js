const { PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody, ddb, isValidId } = require('../lib/common');

const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const body = parseJsonBody(event);
  const { userId, clientId, clientName } = body;
  if (!isValidId(userId) || !isValidId(clientId)) {
    return badRequest('A valid userId and clientId are required');
  }

  if (event.requestContext.http.method === 'DELETE') {
    await ddb.send(new DeleteCommand({ TableName: ACCESS_TABLE, Key: { userId, clientId } }));
    return json(200, { message: 'Assignment removed' });
  }

  const safeClientName = typeof clientName === 'string' && clientName.trim()
    ? clientName.trim().slice(0, 200)
    : clientId;

  await ddb.send(new PutCommand({
    TableName: ACCESS_TABLE,
    Item: {
      userId,
      clientId,
      clientName: safeClientName,
      assignedAt: new Date().toISOString(),
      assignedBy: claims.sub,
    },
  }));

  return json(200, { message: 'Client assigned' });
});
