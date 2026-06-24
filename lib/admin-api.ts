import { ADMIN_PIN } from './constants'

export function verifyAdminPin(request: Request): boolean {
  const pin = request.headers.get('x-admin-pin')
  return pin === ADMIN_PIN
}

export function adminUnauthorized() {
  return Response.json({ error: 'غير مصرح' }, { status: 401 })
}
