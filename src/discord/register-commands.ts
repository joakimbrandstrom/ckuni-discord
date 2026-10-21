import { config } from '../config.js';
import { registerGuildCommands } from './api.js';
import { commandsWithZwift } from './commands.js';

try {
  await registerGuildCommands(
    commandsWithZwift({ results: config.ZWIFT_ENABLED && config.ZWIFT_RESULTS_ENABLED }),
  );
  console.log('Registered Discord guild commands.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
