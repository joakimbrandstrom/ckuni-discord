import { registerGuildCommands } from './api.js';
import { commands } from './commands.js';

try {
  await registerGuildCommands(commands);
  console.log('Registered Discord guild commands.');
} catch (error) {
  console.error(error);
  process.exit(1);
}
