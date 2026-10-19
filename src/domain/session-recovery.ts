export function shouldForgetSession(status: number | undefined): boolean {
  return status === 401 || status === 404;
}
