const { mockClient } = require('aws-sdk-client-mock');
const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognitoMock = mockClient(CognitoIdentityProviderClient);

process.env.USER_POOL_ID = 'us-east-1_testpool';

const { handler } = require('../src/handlers/adminSetUserEnabled');

function adminEvent(body) {
  return {
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: '11111111-1111-1111-1111-111111111111',
            'cognito:groups': ['Admins'],
            email: 'admin@example.com',
          },
        },
      },
      http: { method: 'PATCH' },
    },
  };
}

beforeEach(() => {
  cognitoMock.reset();
});

describe('adminSetUserEnabled', () => {
  test('disables user when username is Cognito UUID (the failing prod case)', async () => {
    cognitoMock.on(AdminDisableUserCommand).resolves({});
    const res = await handler(adminEvent({
      username: 'b4c874c8-b0d1-702e-42f9-3336e7a85644',
      enabled: false,
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('User disabled');
    expect(cognitoMock.commandCalls(AdminDisableUserCommand)).toHaveLength(1);
  });

  test('enables user', async () => {
    cognitoMock.on(AdminEnableUserCommand).resolves({});
    const res = await handler(adminEvent({
      username: 'b4c874c8-b0d1-702e-42f9-3336e7a85644',
      enabled: true,
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('User enabled');
  });

  test('accepts string boolean enabled', async () => {
    cognitoMock.on(AdminDisableUserCommand).resolves({});
    const res = await handler(adminEvent({
      username: 'b4c874c8-b0d1-702e-42f9-3336e7a85644',
      enabled: 'false',
    }));
    expect(res.statusCode).toBe(200);
  });

  test('rejects missing enabled', async () => {
    const res = await handler(adminEvent({
      username: 'b4c874c8-b0d1-702e-42f9-3336e7a85644',
    }));
    expect(res.statusCode).toBe(400);
  });

  test('rejects garbage username', async () => {
    const res = await handler(adminEvent({ username: 'nope', enabled: false }));
    expect(res.statusCode).toBe(400);
  });

  test('forbids non-admins', async () => {
    const event = adminEvent({ username: 'b4c874c8-b0d1-702e-42f9-3336e7a85644', enabled: false });
    event.requestContext.authorizer.jwt.claims['cognito:groups'] = ['Clients'];
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });
});
