const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({});
const FROM_EMAIL = process.env.FROM_EMAIL;
const APP_URL = process.env.APP_URL; // e.g. https://docs.joinabsquare.com

const VALID_STATUSES = ['open', 'in_progress', 'completed'];
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed' };

exports.handler = async (event) => {
  const failures = [];

  for (const record of event.Records) {
    try {
      const { status, clientEmail } = JSON.parse(record.Sns.Message);
      if (!clientEmail || !VALID_STATUSES.includes(status)) {
        // Malformed message -- log and move on rather than let one bad
        // message poison the whole batch (and, with a raw throw, cause SNS
        // to keep retrying/redriving forever).
        console.error('Skipping malformed status-change message:', record.Sns.Message);
        continue;
      }

      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [clientEmail] },
        Message: {
          Subject: { Data: 'A document status has been updated' },
          // Intentionally generic -- no document name, file contents, or PHI in the email body.
          Body: {
            Text: {
              Data: `One of your documents changed status to "${STATUS_LABELS[status]}". Log in at ${APP_URL} to view details.`,
            },
          },
        },
      }));
    } catch (err) {
      console.error('Failed to send status-change email for record:', record.Sns?.MessageId, err);
      failures.push(record.Sns?.MessageId);
    }
  }

  // Only fail the invocation (triggering SNS's own retry policy) if at
  // least one email genuinely failed to send due to an infrastructure
  // error, not for the malformed-message case above.
  if (failures.length) {
    throw new Error(`Failed to deliver ${failures.length} status-change email(s): ${failures.join(', ')}`);
  }
  return {};
};
