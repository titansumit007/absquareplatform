const {
  CognitoIdentityProviderClient,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const {
  getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody,
  isValidCognitoUsername, parseBoolean,
} = require('../lib/common');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;

exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const body = parseJsonBody(event);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const enabled = parseBoolean(body.enabled);

  // Username is Cognito's Username (UUID for this pool), NOT the email alias.
  // Requiring email format here was the root cause of the Disable 400s in prod.
  if (!isValidCognitoUsername(username) || enabled === null) {
    return badRequest('A valid username and enabled (boolean) are required');
  }

  const Command = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
  try {
    await cognito.send(new Command({ UserPoolId: USER_POOL_ID, Username: username }));
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      return json(404, { message: 'No user with that username exists' });
    }
    throw err;
  }

  return json(200, { message: enabled ? 'User enabled' : 'User disabled' });
});
