export function signInReturnUrls(href: string) {
  return { forceRedirectUrl: href, signUpForceRedirectUrl: href }
}

// Assigning an identical URL with a hash can leave the existing document in place.
// Auth completion must reload it so account data is fetched with the new session.
export function navigateAfterAuth(to: string, replace = false, location = window.location) {
  const destination = new URL(to, location.href).href
  if (destination === location.href) location.reload()
  else if (replace) location.replace(destination)
  else location.assign(destination)
}
