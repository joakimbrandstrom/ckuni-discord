import { commands } from './commands.js';
import { registerGuildCommands } from './api.js';

registerGuildCommands(commands)
  .then(() => {
    console.log('Registered Discord guild commands.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
