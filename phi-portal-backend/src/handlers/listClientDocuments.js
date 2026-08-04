const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  ddb, getClaims, isInGroup, hasClientAccess, json, badRequest, forbidden, withErrorHandling, isValidId,
} = require('../lib/common');

const DOCS_TABLE = process.env.DOCUMENTS_TABLE;
const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;
const VALID_STATUSES = ['open', 'in_progress', 'completed'];

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'CompanyUsers') && !isInGroup(claims, 'Admins')) {
    return forbidden('Company users or admins only');
  }

  const clientId = event.queryStringParameters?.clientId;
  if (!isValidId(clientId)) return badRequest('A valid clientId query param is required');

  if (!(await hasClientAccess(claims, clientId, ACCESS_TABLE))) {
    return forbidden('You are not assigned to this client');
  }

  const status = event.queryStringParameters?.status;
  if (status && !VALID_STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const params = {
    TableName: DOCS_TABLE,
    KeyConditionExpression: 'clientId = :cid',
    ExpressionAttributeValues: { ':cid': clientId },
    ScanIndexForward: false,
  };
  if (status) {
    params.FilterExpression = '#s = :status';
    params.ExpressionAttributeNames = { '#s': 'status' };
    params.ExpressionAttributeValues[':status'] = status;
  }

  const result = await ddb.send(new QueryCommand(params));
  return json(200, { documents: result.Items || [] });
});
