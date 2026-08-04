const { CognitoIdentityProviderClient, ListUsersInGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling } = require('../lib/common');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const VALID_GROUPS = ['Clients', 'CompanyUsers', 'Admins'];

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const group = event.queryStringParameters?.group;
  if (!VALID_GROUPS.includes(group)) {
    return badRequest('group query param must be Clients, CompanyUsers, or Admins');
  }

  // ListUsersInGroupCommand pages at ~60 users per call by default -- loop
  // through NextToken so admin panels with more than 60 users in a group
  // don't silently show a truncated list.
  let users = [];
  let NextToken;
  do {
    const result = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: group,
      NextToken,
    }));
    users = users.concat((result.Users || []).map(u => ({
      username: u.Username,
      sub: u.Attributes.find(a => a.Name === 'sub')?.Value,
      email: u.Attributes.find(a => a.Name === 'email')?.Value,
      enabled: u.Enabled,
      status: u.UserStatus,
    })));
    NextToken = result.NextToken;
  } while (NextToken);

  return json(200, { users });
});
