export type ClerkIdentityState = 'configured' | 'disabled' | 'misconfigured';

export function clerkIdentityState(
  environment: NodeJS.ProcessEnv = process.env,
): ClerkIdentityState {
  const publishableKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? '';
  const secretKey = environment.CLERK_SECRET_KEY?.trim() ?? '';

  if (!publishableKey && !secretKey) return 'disabled';
  if (!publishableKey || !secretKey) return 'misconfigured';
  return 'configured';
}

export function isClerkIdentityConfigured(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return clerkIdentityState(environment) === 'configured';
}

export function clerkAuthorizedParties(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuredHostnames = environment.DEDICATED_ALLOWED_HOSTNAMES
    ?.split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean) ?? [];

  return configuredHostnames.flatMap((hostname) => {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return [`http://${hostname}:3000`, `http://${hostname}`];
    }
    return [`https://${hostname}`];
  });
}
