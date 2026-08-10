import { requireStravaConfig, stravaConfigured } from '../config.js';

if (!stravaConfigured()) {
  console.error('Strava is not fully configured in the environment.');
  process.exit(1);
}

const stravaConfig = requireStravaConfig();
const callbackUrl = `${stravaConfig.publicBaseUrl}/strava/webhook`;
const body = new FormData();
body.set('client_id', stravaConfig.clientId);
body.set('client_secret', stravaConfig.clientSecret);
body.set('callback_url', callbackUrl);
body.set('verify_token', stravaConfig.verifyToken);

const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
  method: 'POST',
  body,
});

if (!response.ok) {
  console.error('Failed to create Strava webhook subscription.');
  process.exit(1);
}

console.log('Created Strava webhook subscription.');
