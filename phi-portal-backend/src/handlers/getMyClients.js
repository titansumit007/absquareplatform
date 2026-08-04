const { QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb, getClaims, isInGroup, json, forbidden, withErrorHandling } = require('../lib/common');

const ACCESS_TABLE = process.env.CLIENT_ACCESS_TABLE;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'CompanyUsers') && !isInGroup(claims, 'Admins')) {
    return forbidden('Company users or admins only');
  }

  // Admins see every client assignment that exists; company users see only their own.
  // Note: the admin path is a full table Scan -- fine at this table's scale
  // (assignment rows, not documents), but if the roster grows very large,
  // replace with a GSI keyed on a constant partition + clientId, or handle
  // pagination (ScanCommand's LastEvaluatedKey) explicitly.
  let items;
  if (isInGroup(claims, 'Admins')) {
    const result = await ddb.send(new ScanCommand({ TableName: ACCESS_TABLE }));
    items = result.Items || [];
  } else {
    const result = await ddb.send(new QueryCommand({
      TableName: ACCESS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': claims.sub },
    }));
    items = result.Items || [];
  }

  // de-dupe by clientId in case of the admin scan
  const seen = new Map();
  for (const it of items) seen.set(it.clientId, { clientId: it.clientId, clientName: it.clientName });

  return json(200, { clients: Array.from(seen.values()) });
});
