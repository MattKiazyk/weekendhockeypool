export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
export const error = (message: string, status: number) => json({ error: message }, status)
export function validStart(
  value: unknown,
  league: 'nhl' | 'pwhl' | 'nfl' = 'nhl',
): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return (
    date.getUTCDay() === (league === 'nfl' ? 4 : 5) && date.toISOString().slice(0, 10) === value
  )
}
export const nowIso = () => new Date().toISOString()
