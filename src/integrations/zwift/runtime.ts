import { config } from '../../config.js';
import { ZwiftService } from './service.js';

// Deliberately no network adapter until its access and data rights are reviewed.
export const zwift = new ZwiftService(config, undefined, (event) =>
  console.info('zwift.lookup', event),
);
