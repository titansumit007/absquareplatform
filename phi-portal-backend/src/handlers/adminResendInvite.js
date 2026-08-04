const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const {
  getClaims, isInGroup, json, badRequest, forbidden, withErrorHandling, parseJsonBody,
  isValidCognitoUsername,
} = require('../lib/common');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;

// Re-sends the same temporary-password invitation without creating a new
// account. Cognito only allows MessageAction: 'RESEND' while the user is
// still in FORCE_CHANGE_PASSWORD or UNCONFIRMED status -- i.e. exactly the
// "invite pending" users this button is meant for.
exports.handler = withErrorHandling(async (event) => {
  const claims = getClaims(event);
  if (!isInGroup(claims, 'Admins')) return forbidden('Admins only');

  const body = parseJsonBody(event);
  // Cognito Username is a UUID in this pool (email is a sign-in alias only).
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!isValidCognitoUsername(username)) return badRequest('A valid username is required');

  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      MessageAction: 'RESEND',
      DesiredDeliveryMediums: ['EMAIL'],
    }));
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      return json(404, { message: 'No user with that username exists' });
    }
    if (err.name === 'InvalidParameterException') {
      // Thrown when the user has already signed in and set their own password --
      // there's no pending invite left to resend.
      return json(409, { message: 'This user has already signed in; there is no pending invite to resend' });
    }
    throw err;
  }

  return json(200, { message: 'Invite resent' });
});
