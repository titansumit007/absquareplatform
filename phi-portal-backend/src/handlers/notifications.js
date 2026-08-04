const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, getClaims, json, badRequest, forbidden, withErrorHandling, parseJsonBody } = require('../lib/common');

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!claims.sub) return forbidden('Not authenticated');

  if (event.requestContext.http.method === 'PATCH') {
    const body = parseJsonBody(event);
    if (!body.notificationId || typeof body.notificationId !== 'string') {
      return badRequest('notificationId is required');
    }
    // Key is scoped to claims.sub, so this can only ever mark the caller's
    // own notifications -- there is no way to pass another user's id here.
    try {
      await ddb.send(new UpdateCommand({
        TableName: NOTIFICATIONS_TABLE,
        Key: { userId: claims.sub, notificationId: body.notificationId },
        ConditionExpression: 'attribute_exists(userId)',
        UpdateExpression: 'SET #r = :true',
        ExpressionAttributeNames: { '#r': 'read' },
        ExpressionAttributeValues: { ':true': true },
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        throw Object.assign(new Error('Notification not found'), { statusCode: 404 });
      }
      throw err;
    }
    return json(200, { message: 'Marked read' });
  }

  const result = await ddb.send(new QueryCommand({
    TableName: NOTIFICATIONS_TABLE,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': claims.sub },
    ScanIndexForward: false,
    Limit: 50,
  }));

  return json(200, { notifications: result.Items || [] });
});
