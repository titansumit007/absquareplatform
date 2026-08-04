const {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { QueryCommand, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const {
  ddb, getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody,
  isValidId, isValidCognitoUsername,
} = require('../lib/common');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;
const VALID_GROUPS = ['Clients', 'CompanyUsers', 'Admins'];

async function batchDeleteAccessRows(items) {
  if (!items || items.length === 0) return;
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [ACCESS_TABLE]: chunk.map((item) => ({
          DeleteRequest: { Key: { userId: item.userId, clientId: item.clientId } },
        })),
      },
    }));
  }
}

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const body = parseJsonBody(event);
  // username = Cognito Username (UUID in this pool; email is only an alias).
  // sub = immutable Cognito sub used as the FK in DynamoDB (ClientAccess, Documents).
  // Do NOT require email format for username — that caused Delete 400s in prod.
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const { sub, group, force } = body;
  if (!isValidCognitoUsername(username) || !isValidId(sub) || !VALID_GROUPS.includes(group)) {
    return badRequest('A valid username, sub, and group are required');
  }
  if (sub === claims.sub) {
    return forbidden('You cannot delete your own account');
  }

  if (group === 'Clients' && !force) {
    const docsRes = await ddb.send(new QueryCommand({
      TableName: DOCS_TABLE,
      KeyConditionExpression: 'clientId = :cid',
      FilterExpression: '#s <> :completed',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':cid': sub, ':completed': 'completed' },
    }));
    const unfinished = docsRes.Items || [];
    if (unfinished.length > 0) {
      return json(409, {
        message: `This client has ${unfinished.length} document(s) that aren't completed yet. Resend with force=true to delete anyway.`,
        unfinishedCount: unfinished.length,
      });
    }
  }

  // Clean up the access-mapping table BEFORE the Cognito deletion, which is
  // irreversible. If this DynamoDB step fails partway through, the Cognito
  // user still exists and an admin can safely retry the whole delete;
  // deleting Cognito first would risk leaving orphaned assignment rows with
  // no way to look the user back up if the cleanup step then failed.
  // (Uploaded documents themselves are intentionally left in place for
  // audit/retention purposes -- HIPAA generally expects records to be
  // retained even after an account is deactivated, not deleted alongside it.)
  if (group === 'Clients') {
    const res = await ddb.send(new ScanCommand({
      TableName: ACCESS_TABLE,
      FilterExpression: 'clientId = :cid',
      ExpressionAttributeValues: { ':cid': sub },
    }));
    await batchDeleteAccessRows(res.Items);
  } else if (group === 'CompanyUsers') {
    const res = await ddb.send(new QueryCommand({
      TableName: ACCESS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': sub },
    }));
    await batchDeleteAccessRows(res.Items);
  }

  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      return json(404, { message: 'No user with that username exists' });
    }
    throw err;
  }

  return json(200, { message: 'User deleted' });
});
