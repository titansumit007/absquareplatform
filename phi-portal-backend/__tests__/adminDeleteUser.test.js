const { mockClient } = require('aws-sdk-client-mock');
const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.USER_POOL_ID = 'us-east-1_testpool';
process.env.DOCUMENTS_TABLE = 'Documents';
process.env.CLIENT_ACCESS_TABLE = 'ClientAccess';

const { handler } = require('../src/handlers/adminDeleteUser');

const ADMIN_SUB = '11111111-1111-1111-1111-111111111111';
const TARGET_SUB = '22222222-2222-2222-2222-222222222222';
const TARGET_USERNAME = 'b4c874c8-b0d1-702e-42f9-3336e7a85644';

function adminEvent(body) {
  return {
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: ADMIN_SUB,
            'cognito:groups': ['Admins'],
          },
        },
      },
      http: { method: 'DELETE' },
    },
  };
}

beforeEach(() => {
  cognitoMock.reset();
  ddbMock.reset();
});

describe('adminDeleteUser', () => {
  test('deletes company user with Cognito UUID username (prod delete case)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    cognitoMock.on(AdminDeleteUserCommand).resolves({});

    const res = await handler(adminEvent({
      username: TARGET_USERNAME,
      sub: TARGET_SUB,
      group: 'CompanyUsers',
    }));

    expect(res.statusCode).toBe(200);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  test('rejects self-delete', async () => {
    const res = await handler(adminEvent({
      username: TARGET_USERNAME,
      sub: ADMIN_SUB,
      group: 'Admins',
    }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 409 when client has unfinished docs', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ documentId: 'd1', status: 'open' }],
    });
    const res = await handler(adminEvent({
      username: TARGET_USERNAME,
      sub: TARGET_SUB,
      group: 'Clients',
    }));
    expect(res.statusCode).toBe(409);
  });

  test('force-deletes client after unfinished check', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    const res = await handler(adminEvent({
      username: TARGET_USERNAME,
      sub: TARGET_SUB,
      group: 'Clients',
      force: true,
    }));
    expect(res.statusCode).toBe(200);
  });

  test('rejects email-format requirement regression: UUID username must pass', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    const res = await handler(adminEvent({
      username: TARGET_USERNAME,
      sub: TARGET_SUB,
      group: 'CompanyUsers',
    }));
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).toBe(200);
  });
});
