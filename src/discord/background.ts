const tasks = new Set<Promise<void>>();

export function runDiscordBackgroundTask(work: () => Promise<void>): void {
  const task = new Promise<void>((resolve) => setImmediate(resolve)).then(work);
  tasks.add(task);
  void task
    .catch((error) => console.error('Discord-bakgrundsjobb misslyckades:', error))
    .finally(() => tasks.delete(task));
}

export async function waitForDiscordBackgroundTasks(): Promise<void> {
  while (tasks.size > 0) {
    await Promise.allSettled([...tasks]);
  }
}
