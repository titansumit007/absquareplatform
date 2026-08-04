const { UpdateCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { randomUUID } = require('crypto');
const {
  ddb, getClaims, isInGroup, hasClientAccess, json, badRequest, forbidden, withErrorHandling, parseJsonBody, isValidId,
} = require('../lib/common');

const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
const TOPIC_ARN = process.env.STATUS_TOPIC_ARN;

const sns = new SNSClient({});
const VALID_STATUSES = ['open', 'in_progress', 'completed'];

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'CompanyUsers') && !isInGroup(claims, 'Admins')) {
    return forbidden('Company users or admins only');
  }

  const body = parseJsonBody(event);
  const { clientId, documentId, status } = body;
  if (!isValidId(clientId) || !isValidId(documentId) || !VALID_STATUSES.includes(status)) {
    return badRequest('A valid clientId, documentId, and status are required');
  }
  if (!(await hasClientAccess(claims, clientId, ACCESS_TABLE))) {
    return forbidden('You are not assigned to this client');
  }

  const existing = await ddb.send(new GetCommand({ TableName: DOCS_TABLE, Key: { clientId, documentId } }));
  if (!existing.Item) return json(404, { message: 'Document not found' });

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: DOCS_TABLE,
    Key: { clientId, documentId },
    ConditionExpression: 'attribute_exists(clientId)',
    UpdateExpression: 'SET #s = :status, updatedAt = :now, updatedBy = :by',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': status, ':now': now, ':by': claims.sub },
  }));

  // The status change itself has already been committed above and is the
  // part the caller actually needs to succeed. Notifications (in-app row +
  // email fan-out) are best-effort: a transient DynamoDB/SNS hiccup here
  // shouldn't turn an otherwise-successful status update into a 500 for the
  // company user, so failures are logged rather than thrown.
  try {
    await ddb.send(new PutCommand({
      TableName: NOTIFICATIONS_TABLE,
      Item: {
        userId: clientId,
        notificationId: `${Date.now()}#${randomUUID()}`,
        message: `A document's status changed to "${status}"`,
        documentId,
        read: false,
        createdAt: now,
      },
    }));
  } catch (err) {
    console.error('Failed to write in-app notification (status update still succeeded):', err);
  }

  try {
    // Deliberately no PHI in the message -- just enough to route the email.
    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify({ clientId, documentId, status, clientEmail: existing.Item.clientEmail }),
    }));
  } catch (err) {
    console.error('Failed to publish status-change notification (status update still succeeded):', err);
  }

  return json(200, { message: 'Status updated' });
});
