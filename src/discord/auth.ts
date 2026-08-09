import type { DiscordInteraction } from './types.js';

/**
 * Returns true when the interacting member holds the Ride Leader or Admin role,
 * or when no role IDs are configured (open mode for development/testing).
 *
 * Exported for unit testing.
 */
export function isRideManager(
  interaction: DiscordInteraction,
  rideLeaderRoleId: string | undefined,
  adminRoleId: string | undefined
): boolean {
  if (!rideLeaderRoleId && !adminRoleId) return true;
  const memberRoles = interaction.member?.roles ?? [];
  if (rideLeaderRoleId && memberRoles.includes(rideLeaderRoleId)) return true;
  if (adminRoleId && memberRoles.includes(adminRoleId)) return true;
  return false;
}
