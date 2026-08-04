const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody, isValidEmail } = require('../lib/common');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const VALID_GROUPS = ['Clients', 'CompanyUsers', 'Admins'];

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const body = parseJsonBody(event);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const group = body.group;

  if (!isValidEmail(email)) return badRequest('A valid email address is required');
  if (!VALID_GROUPS.includes(group)) {
    return badRequest('group must be one of: Clients, CompanyUsers, Admins');
  }

  let created;
  try {
    created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: name || email },
      ],
      DesiredDeliveryMediums: ['EMAIL'], // Cognito emails the temporary password
    }));
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      return json(409, { message: 'A user with this email already exists' });
    }
    throw err;
  }

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    GroupName: group,
  }));

  const subAttr = created.User.Attributes.find(a => a.Name === 'sub');
  return json(200, {
    message: 'User created and emailed a temporary password',
    sub: subAttr ? subAttr.Value : null,
  });
});
