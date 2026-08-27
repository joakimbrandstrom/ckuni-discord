import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCreateRideFields,
  parseRideBasicFields,
  parseRideDetailFields,
  parseRideScheduleFields,
  parseTemplateFields,
  parseTemplateRideFields,
} from '../src/rides/input.js';

const now = new Date('2026-08-11T10:00:00Z');

test('parses Swedish modal values in the configured timezone', () => {
  const result = parseCreateRideFields(
    {
      title: 'Tisdagens intervaller',
      date_time: '2026-08-11 19:00',
      duration: '60',
      ride_type: 'intervaller',
      details: 'Fyra hårda block\nhttps://www.zwift.com/events/123',
    },
    'Europe/Stockholm',
    now,
  );
  assert.equal(result.startsAt.toISOString(), '2026-08-11T17:00:00.000Z');
  assert.equal(result.rideType, 'intervals');
  assert.equal(result.description, 'Fyra hårda block');
  assert.equal(result.zwiftUrl, 'https://www.zwift.com/events/123');
});

test('parses rich metadata and template fields', () => {
  const result = parseTemplateFields({
    name: 'Tisdagsmall',
    title: 'Intervaller',
    duration: '75',
    ride_type: 'intervaller',
    details:
      'Beskrivning: Fyra block\nRutt/värld: Watopia\nTempo/träning: 2,5 W/kg\nAnteckningar: Samling i röstkanalen',
  });
  assert.equal(result.rideType, 'intervals');
  assert.equal(result.routeWorld, 'Watopia');
  assert.equal(result.paceWorkout, '2,5 W/kg');
  assert.equal(result.notes, 'Samling i röstkanalen');
});

test('parses template ride time and validates its optional URL', () => {
  const result = parseTemplateRideFields(
    { date_time: '2026-08-12 19:00', zwift_url: 'https://zwift.test/event' },
    'Europe/Stockholm',
    now,
  );
  assert.equal(result.startsAt.toISOString(), '2026-08-12T17:00:00.000Z');
  assert.equal(result.zwiftUrl, 'https://zwift.test/event');
  assert.throws(
    () =>
      parseTemplateRideFields(
        { date_time: '2026-08-12 19:00', zwift_url: 'inte-en-länk' },
        'Europe/Stockholm',
        now,
      ),
    /giltig webbadress/,
  );
});

test('validates date, duration, type and future start', () => {
  const base = {
    title: 'Pass',
    date_time: '2026-08-11 19:00',
    duration: '60',
    ride_type: 'socialt',
  };
  assert.throws(() => parseCreateRideFields({ ...base, date_time: '11/8 19' }, 'UTC', now));
  assert.throws(() => parseCreateRideFields({ ...base, duration: '10' }, 'UTC', now));
  assert.throws(() => parseCreateRideFields({ ...base, ride_type: 'okänd' }, 'UTC', now));
  assert.throws(
    () => parseCreateRideFields({ ...base, date_time: '2026-08-10 19:00' }, 'UTC', now),
    /framtiden/,
  );
});

test('parses separate date and time fields in the configured timezone', () => {
  const result = parseRideBasicFields(
    {
      title: 'Tisdagens intervaller',
      date: '2026-08-11',
      time: '19:00',
      duration: '60',
      ride_type: 'intervals',
    },
    'Europe/Stockholm',
    now,
  );

  assert.equal(result.startsAt.toISOString(), '2026-08-11T17:00:00.000Z');
  assert.equal(result.rideType, 'intervals');
});

test('parses schedule and detail fields without prefixed free text', () => {
  const schedule = parseRideScheduleFields(
    {
      date: '2026-08-12',
      time: '19:00',
      zwift_url: 'https://www.zwift.com/events/123',
      extra_comment: 'Ta med vatten.',
    },
    'Europe/Stockholm',
    now,
  );
  const details = parseRideDetailFields({
    zwift_url: 'https://www.zwift.com/events/123',
    description: 'Fyra block',
    route_world: 'Watopia',
    pace_workout: '2,5 W/kg',
    notes: 'Samling i röstkanalen',
  });

  assert.equal(schedule.startsAt.toISOString(), '2026-08-12T17:00:00.000Z');
  assert.equal(schedule.extraComment, 'Ta med vatten.');
  assert.deepEqual(details, {
    zwiftUrl: 'https://www.zwift.com/events/123',
    description: 'Fyra block',
    routeWorld: 'Watopia',
    paceWorkout: '2,5 W/kg',
    notes: 'Samling i röstkanalen',
  });
  assert.throws(
    () => parseRideDetailFields({ zwift_url: 'ftp://zwift.example/event' }),
    /http:\/\/ eller https:\/\//,
  );
  assert.throws(
    () => parseRideDetailFields({ description: 'x'.repeat(3000), notes: 'y'.repeat(600) }),
    /för långa/,
  );
});
