const { UpdateCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { randomUUID } = require('crypto');
const {
  ddb, getClaims, isInGroup, hasClientAccess, json, badRequest, forbidden, withErrorHandling, parseJsonBody, isValidId,
  isExpired, buildActivityEntry, nextActivityLog,
} = require('../lib/common');

const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE;
const TOPIC_ARN = process.env.STATUS_TOPIC_ARN;

const sns = new SNSClient({});
const VALID_STATUSES = ['open', 'in_progress', 'completed'];
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed' };

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
  if (isExpired(existing.Item)) {
    return json(410, { message: 'This document has passed its 30-day retention period and can no longer be updated.' });
  }

  const now = new Date().toISOString();
  const fromStatus = existing.Item.status;
  const entry = buildActivityEntry(
    claims,
    'status_change',
    `Status changed from "${STATUS_LABELS[fromStatus] || fromStatus}" to "${STATUS_LABELS[status]}"`
  );
  const activityLog = nextActivityLog(existing.Item.activityLog, entry);

  await ddb.send(new UpdateCommand({
    TableName: DOCS_TABLE,
    Key: { clientId, documentId },
    ConditionExpression: 'attribute_exists(clientId)',
    UpdateExpression: 'SET #s = :status, updatedAt = :now, updatedBy = :by, updatedByEmail = :email, activityLog = :log',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': status,
      ':now': now,
      ':by': claims.sub,
      ':email': claims.email || null,
      ':log': activityLog,
    },
  }));

  try {
    await ddb.send(new PutCommand({
      TableName: NOTIFICATIONS_TABLE,
      Item: {
        userId: clientId,
        notificationId: `${Date.now()}#${randomUUID()}`,
        message: `A document's status changed to "${STATUS_LABELS[status] || status}"`,
        documentId,
        read: false,
        createdAt: now,
      },
    }));
  } catch (err) {
    console.error('Failed to write in-app notification (status update still succeeded):', err);
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify({ clientId, documentId, status, clientEmail: existing.Item.clientEmail }),
    }));
  } catch (err) {
    console.error('Failed to publish status-change notification (status update still succeeded):', err);
  }

  return json(200, { message: 'Status updated', activityLog });
});
