const {
  SNSClient,
  CreateTopicCommand,
  GetSubscriptionAttributesCommand,
  SubscribeCommand,
  ListSubscriptionsByTopicCommand
} = require('@aws-sdk/client-sns');

const { updateUser } = require('./userStore');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TOPIC_PREFIX = process.env.SNS_TOPIC_PREFIX || 'receiptiq-user';
const sns = new SNSClient({ region: REGION });

/**
 * Called once during signup to create the per-user SNS topic, subscribe
 * the account email, and persist the initial notification state.
 */
async function initializeUserNotifications(user) {
  if (!notificationsEnabled()) {
    return updateLocalNotificationState(user.id, {
      notificationStatus: 'disabled',
      notificationMessage: 'SNS setup is disabled until AWS credentials are available.',
      snsTopicArn: null,
      snsSubscriptionArn: null
    });
  }

  try {
    const topicArn = await ensureUserTopic(user);
    const subscriptionArn = await ensureEmailSubscription(topicArn, user.email);

    // Always verify the actual confirmation state via the AWS API
    // instead of guessing from the ARN format.
    const confirmed = await checkSubscriptionConfirmed(subscriptionArn);

    const status = confirmed ? 'verified' : 'pending_verification';
    const message = confirmed
      ? 'SNS notification delivery is active for this account.'
      : 'Check your inbox and confirm the SNS subscription once to enable notifications.';

    return updateLocalNotificationState(user.id, {
      notificationStatus: status,
      notificationMessage: message,
      snsTopicArn: topicArn,
      snsSubscriptionArn: isRealArn(subscriptionArn) ? subscriptionArn : null
    });
  } catch (error) {
    console.error('Notification setup error:', error);
    return updateLocalNotificationState(user.id, {
      notificationStatus: 'disabled',
      notificationMessage: 'Account created, but SNS setup could not be completed yet.',
      snsTopicArn: null,
      snsSubscriptionArn: null
    });
  }
}

/**
 * Called on login and GET /me to refresh the notification state.
 * Never re-subscribes if a topic already exists — only checks status.
 */
async function refreshUserNotifications(user) {
  if (!user?.id) {
    return user;
  }

  if (!notificationsEnabled()) {
    return user;
  }

  // If there is no topic yet, do the full initialization.
  if (!user.snsTopicArn) {
    return initializeUserNotifications(user);
  }

  // If we have a stored subscription ARN, check its attributes directly.
  if (user.snsSubscriptionArn && isRealArn(user.snsSubscriptionArn)) {
    try {
      const confirmed = await checkSubscriptionConfirmed(user.snsSubscriptionArn);
      const status = confirmed ? 'verified' : 'pending_verification';
      const message = confirmed
        ? 'SNS notification delivery is active for this account.'
        : 'Check your inbox and confirm the SNS subscription to start receiving receipt updates.';

      return updateLocalNotificationState(user.id, {
        notificationStatus: status,
        notificationMessage: message,
        snsSubscriptionArn: user.snsSubscriptionArn
      });
    } catch (error) {
      // The stored ARN may be stale — fall through to topic-level lookup.
      console.error('Notification subscription ARN refresh error:', error);
    }
  }

  // Fallback: scan the topic's subscriptions for the user's email.
  try {
    const subscription = await findSubscription(user.snsTopicArn, user.email);

    if (!subscription || !isRealArn(subscription.SubscriptionArn)) {
      // Subscription is completely gone (deleted/unsubscribed/expired).
      // Re-subscribe once to send a fresh confirmation email.
      try {
        await sns.send(new SubscribeCommand({
          TopicArn: user.snsTopicArn,
          Protocol: 'email',
          Endpoint: user.email
        }));
        console.log('Re-subscribed %s to topic %s', user.email, user.snsTopicArn);
      } catch (resubError) {
        console.error('Re-subscribe failed:', resubError);
      }

      return updateLocalNotificationState(user.id, {
        notificationStatus: 'pending_verification',
        notificationMessage: 'A new confirmation email has been sent. Please check your inbox and confirm to enable notifications.',
        snsSubscriptionArn: null
      });
    }

    const confirmed = await checkSubscriptionConfirmed(subscription.SubscriptionArn);
    const status = confirmed ? 'verified' : 'pending_verification';
    const message = confirmed
      ? 'SNS notification delivery is active for this account.'
      : 'Check your inbox and confirm the SNS subscription to start receiving receipt updates.';

    return updateLocalNotificationState(user.id, {
      notificationStatus: status,
      notificationMessage: message,
      snsSubscriptionArn: isRealArn(subscription.SubscriptionArn) ? subscription.SubscriptionArn : null
    });
  } catch (error) {
    console.error('Notification refresh error:', error);
    return user;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureUserTopic(user) {
  const response = await sns.send(new CreateTopicCommand({
    Name: `${TOPIC_PREFIX}-${sanitizeTopicSuffix(user.id)}`
  }));

  return response.TopicArn;
}

async function ensureEmailSubscription(topicArn, email) {
  const existing = await findSubscription(topicArn, email);
  // Only reuse the subscription if it has a real confirmed/confirmable ARN.
  // "PendingConfirmation" and "Deleted" are NOT real ARNs — re-subscribe
  // so the user gets a fresh confirmation email.
  if (existing && isRealArn(existing.SubscriptionArn)) {
    return existing.SubscriptionArn;
  }

  // Do NOT use ReturnSubscriptionArn — without it, pending subscriptions
  // return 'pending confirmation' which is correctly detected as unconfirmed.
  const response = await sns.send(new SubscribeCommand({
    TopicArn: topicArn,
    Protocol: 'email',
    Endpoint: email
  }));

  return response.SubscriptionArn;
}

async function findSubscription(topicArn, email) {
  let nextToken;

  do {
    const response = await sns.send(new ListSubscriptionsByTopicCommand({
      TopicArn: topicArn,
      NextToken: nextToken
    }));

    const match = (response.Subscriptions || []).find((entry) => {
      return String(entry.Endpoint || '').toLowerCase() === String(email).toLowerCase();
    });

    if (match) {
      return match;
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return null;
}

/**
 * Check if a subscription is actually confirmed by calling the AWS API.
 * Returns true only if PendingConfirmation === 'false'.
 */
async function checkSubscriptionConfirmed(subscriptionArn) {
  if (!isRealArn(subscriptionArn)) {
    return false;
  }

  try {
    const response = await sns.send(new GetSubscriptionAttributesCommand({
      SubscriptionArn: subscriptionArn
    }));
    return response.Attributes?.PendingConfirmation === 'false';
  } catch (error) {
    // GetSubscriptionAttributes fails if the ARN is stale or deleted.
    return false;
  }
}

/**
 * Returns true only if the value looks like a real AWS SNS ARN.
 * Rejects placeholder strings like 'PendingConfirmation',
 * 'pending confirmation', 'Deleted', etc.
 */
function isRealArn(subscriptionArn) {
  return Boolean(
    subscriptionArn
    && typeof subscriptionArn === 'string'
    && subscriptionArn.startsWith('arn:aws:sns:')
  );
}

function notificationsEnabled() {
  return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function sanitizeTopicSuffix(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

async function updateLocalNotificationState(userId, changes) {
  return updateUser(userId, changes);
}

module.exports = {
  initializeUserNotifications,
  refreshUserNotifications
};
