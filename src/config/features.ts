/**
 * Public builds of Watch Later are local-only.
 *
 * The account, SSO and cloud-sync code remains in the repository for future
 * development, but it must not be mounted in the Play build while the privacy
 * policy and store listing promise no account and no cloud profile. Set this
 * to true only when the legal documents and Data Safety answers are updated
 * for a release that actually offers accounts.
 */
export const AUTH_ENABLED = false;
