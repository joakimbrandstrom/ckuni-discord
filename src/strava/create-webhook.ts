import { config, stravaConfigured } from '../config.js';

if (!stravaConfigured()) {
  console.error('Strava is not fully configured in the environment.');
  process.exit(1);
}

const callbackUrl = `${config.PUBLIC_BASE_URL}/strava/webhook`;
const body = new FormData();
body.set('client_id', config.STRAVA_CLIENT_ID!);
body.set('client_secret', config.STRAVA_CLIENT_SECRET!);
body.set('callback_url', callbackUrl);
body.set('verify_token', config.STRAVA_VERIFY_TOKEN!);

const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
  method: 'POST',
  body,
});

if (!response.ok) {
  console.error('Failed to create Strava webhook subscription.');
  process.exit(1);
}

console.log('Created Strava webhook subscription.');
