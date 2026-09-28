/** Translate only known user-facing failures at the Homey boundary.
 * Domain errors, unknown failures and structured validation errors remain intact. */
const errorKeys: Record<string, string> = {
  'Unknown monitor': 'unknownMonitor',
  'Monitor does not accept manual heartbeats': 'confirmationMethodRequired',
  'deliveredAt must be an ISO timestamp with timezone': 'invalidUpdateTime',
  'Add the Data Pulse Test Source device first': 'testSourceRequired',
  'Unknown test source action': 'unknownTestAction',
  'Test source has been removed': 'testSourceRemoved',
  'Heartbeat target changed': 'confirmationTargetChanged',
  'Watchdog runtime checkpoint failed': 'checkpointFailed',
};

export async function withUserErrors<T>(
  homey: { __(key: string): string },
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    const key =
      typeof message === 'string' && Object.hasOwn(errorKeys, message)
        ? errorKeys[message]
        : undefined;
    if (key) throw new Error(homey.__(`errors.${key}`), { cause: error });
    throw error;
  }
}
