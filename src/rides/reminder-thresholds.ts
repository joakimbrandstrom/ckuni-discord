/**
 * Pure threshold functions for reminder eligibility.
 * Extracted so they can be unit-tested without database or config dependencies.
 */

/**
 * Returns true when the 24h reminder should be sent for a ride that starts
 * `minutesUntilStart` minutes from now.
 */
export function needs24hReminder(sent: boolean, minutesUntilStart: number): boolean {
  return !sent && minutesUntilStart <= 24 * 60 && minutesUntilStart > 0;
}

/**
 * Returns true when the 30m reminder should be sent for a ride that starts
 * `minutesUntilStart` minutes from now.
 */
export function needs30mReminder(sent: boolean, minutesUntilStart: number): boolean {
  return !sent && minutesUntilStart <= 30 && minutesUntilStart > 0;
}
